#!/usr/bin/env node
import fs from 'node:fs'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { codexSnippet } from './assets.js'
import { changes, resetBaseline } from './changes.js'
import { createChannel, ROLES, send, status, type MessageType, type Role, type SendInput } from './channel.js'
import { init, type InitTarget } from './init.js'
import { listen } from './listen.js'

const HELP = `cursor-pair — a private local channel between a CLI agent and your Cursor agent

Usage:
  cursor-pair new [id]                         create a channel, print its path
  cursor-pair send <channel> --as <role> [--type chat|diff|ack|error]
                  [--text "..."] [--patch-file file|-] [--ref N]
  cursor-pair listen <channel> --as <role> [--timeout 480] [--heartbeat 30] [--poll 300]
  cursor-pair changes <channel> --as <role> [--keep]
                                               everything that changed on disk since
                                               this role last looked (read-once)
  cursor-pair status <channel>                 message counts per side
  cursor-pair init <claude|cursor|codex> [--global]
                                               install the prompt files
  cursor-pair help

Roles: external (the CLI agent) | cursor (the IDE agent).
listen exits 0 with messages (JSONL on stdout), 2 on timeout; # lines are heartbeats.
changes needs the project to be a git repository.
`

const fail = (message: string): never => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const parseRole = (value: string | undefined): Role => {
  if (value === 'external' || value === 'cursor') return value
  return fail(`--as must be "external" or "cursor", got: ${value ?? '(missing)'}`)
}

const parseType = (value: string | undefined): MessageType => {
  if (value === undefined) return 'chat'
  if (value === 'chat' || value === 'diff' || value === 'ack' || value === 'error') return value
  return fail(`--type must be chat|diff|ack|error, got: ${value}`)
}

const parseIntOption = (name: string, value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fail(`--${name} must be a number >= 0`)
  return parsed
}

const runNew = (args: string[]): number => {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} })
  const channel = createChannel(process.cwd(), positionals[0])
  for (const role of ROLES) {
    try {
      resetBaseline(channel, role)
    } catch {
      // Not a git repo (or no git) — `changes` will set its baseline lazily.
    }
  }
  const relative = `./${channel.startsWith(process.cwd()) ? channel.slice(process.cwd().length + 1) : channel}`
  console.log(relative)
  console.error(`paste into Cursor chat: /pair ${relative}`)
  return 0
}

const runSend = (args: string[]): number => {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      as: { type: 'string' },
      type: { type: 'string' },
      text: { type: 'string' },
      'patch-file': { type: 'string' },
      ref: { type: 'string' },
    },
  })
  const channel = positionals[0] ?? fail('send needs a channel path')
  const from = parseRole(values.as)
  const input: SendInput = { type: parseType(values.type) }
  if (values.text !== undefined) input.text = values.text
  if (values['patch-file'] !== undefined) {
    const file = values['patch-file']
    input.patch = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8')
  }
  if (values.ref !== undefined) input.ref = parseIntOption('ref', values.ref, 0)
  if (input.type === 'diff' && input.patch === undefined) {
    return fail('a diff message needs --patch-file (use "-" for stdin)')
  }
  const message = send(channel, from, input)
  console.log(JSON.stringify(message))
  return 0
}

const runListen = async (args: string[]): Promise<number> => {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      as: { type: 'string' },
      timeout: { type: 'string' },
      heartbeat: { type: 'string' },
      poll: { type: 'string' },
    },
  })
  const channel = positionals[0] ?? fail('listen needs a channel path')
  const role = parseRole(values.as)
  const timeoutSec = parseIntOption('timeout', values.timeout, 480)
  const messages = await listen(channel, role, {
    timeoutSec,
    heartbeatSec: parseIntOption('heartbeat', values.heartbeat, 30),
    pollMs: parseIntOption('poll', values.poll, 300),
    onHeartbeat: (waitedSec) => {
      console.log(`# waiting ${String(waitedSec)}s`)
    },
  })
  if (messages.length === 0) {
    console.log(`# timeout after ${String(timeoutSec)}s, no new messages`)
    return 2
  }
  for (const message of messages) console.log(JSON.stringify(message))
  return 0
}

const runChanges = (args: string[]): number => {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { as: { type: 'string' }, keep: { type: 'boolean' } },
  })
  const channel = positionals[0] ?? fail('changes needs a channel path')
  const diff = changes(channel, parseRole(values.as), { keep: values.keep })
  if (diff === '') {
    console.log('# no changes')
    return 0
  }
  process.stdout.write(diff)
  return 0
}

const runStatus = (args: string[]): number => {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} })
  const channel = positionals[0] ?? fail('status needs a channel path')
  console.log(JSON.stringify(status(channel), null, 2))
  return 0
}

const runInit = (args: string[]): number => {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { global: { type: 'boolean' } },
  })
  const target = positionals[0]
  if (target === 'codex') {
    console.log(codexSnippet)
    return 0
  }
  if (target !== 'claude' && target !== 'cursor') {
    return fail('init needs a target: claude | cursor | codex')
  }
  const file = init(process.cwd(), target as InitTarget, { global: values.global })
  console.log(file)
  console.error(
    target === 'cursor' ? 'installed — type /pair <channel> in Cursor chat' : 'installed — type /cursor in Claude Code',
  )
  return 0
}

const main = async (): Promise<number> => {
  const argv = process.argv.slice(2)
  const command = argv.at(0)
  const rest = argv.slice(1)
  try {
    switch (command) {
      case 'new':
        return runNew(rest)
      case 'send':
        return runSend(rest)
      case 'listen':
        return await runListen(rest)
      case 'changes':
        return runChanges(rest)
      case 'status':
        return runStatus(rest)
      case 'init':
        return runInit(rest)
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        console.log(HELP)
        return command === undefined ? 1 : 0
      default:
        return fail(`unknown command: ${command} (see \`cursor-pair help\`)`)
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

process.exit(await main())
