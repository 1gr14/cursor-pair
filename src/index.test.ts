import { describe, expect, expectTypeOf, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  changes,
  createChannel,
  draft,
  init,
  isChannel,
  listen,
  readNew,
  resetBaseline,
  send,
  sendDiff,
  status,
  type Message,
  type Role,
} from './index.js'

const makeProject = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-pair-test-'))

describe('createChannel', () => {
  it('creates the channel layout and auto-increments ids', () => {
    const dir = makeProject()
    const first = createChannel(dir)
    const second = createChannel(dir)
    expect(first.endsWith(path.join('.cursor-pair', '1'))).toBe(true)
    expect(second.endsWith(path.join('.cursor-pair', '2'))).toBe(true)
    expect(isChannel(first)).toBe(true)
    expect(fs.existsSync(path.join(first, 'to-cursor.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(first, 'to-external.jsonl'))).toBe(true)
  })

  it('accepts a custom id and refuses duplicates', () => {
    const dir = makeProject()
    const channel = createChannel(dir, 'fix-auth')
    expect(channel.endsWith(path.join('.cursor-pair', 'fix-auth'))).toBe(true)
    expect(() => createChannel(dir, 'fix-auth')).toThrow('already exists')
  })

  it('adds the channel dir to .git/info/exclude when the project is a git repo', () => {
    const dir = makeProject()
    fs.mkdirSync(path.join(dir, '.git'))
    createChannel(dir)
    const exclude = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude).toContain('.cursor-pair/')
  })
})

describe('send / readNew', () => {
  it('delivers only to the other role, only once, in order', () => {
    const channel = createChannel(makeProject())
    send(channel, 'external', { type: 'chat', text: 'hello cursor' })
    send(channel, 'external', { type: 'diff', patch: '--- a\n+++ b\n' })
    send(channel, 'cursor', { type: 'chat', text: 'hello external' })

    const forCursor = readNew(channel, 'cursor')
    expect(forCursor.map((m) => m.type)).toEqual(['chat', 'diff'])
    expect(forCursor.map((m) => m.seq)).toEqual([1, 2])
    expect(forCursor[0]?.from).toBe('external')

    // The sender never re-reads its own messages…
    const forExternal = readNew(channel, 'external')
    expect(forExternal.map((m) => m.text)).toEqual(['hello external'])

    // …and nothing is ever read twice.
    expect(readNew(channel, 'cursor')).toEqual([])
    expect(readNew(channel, 'external')).toEqual([])
  })

  it('acks reference the seq they confirm', () => {
    const channel = createChannel(makeProject())
    const diff = send(channel, 'external', { type: 'diff', patch: 'p' })
    send(channel, 'cursor', { type: 'ack', ref: diff.seq })
    const [ack] = readNew(channel, 'external')
    expect(ack.type).toBe('ack')
    expect(ack.ref).toBe(diff.seq)
  })

  it('counts totals and unread in status', () => {
    const channel = createChannel(makeProject())
    send(channel, 'external', { type: 'chat', text: 'one' })
    send(channel, 'external', { type: 'chat', text: 'two' })
    expect(status(channel).perRole.cursor).toEqual({ total: 2, unread: 2 })
    readNew(channel, 'cursor')
    expect(status(channel).perRole.cursor).toEqual({ total: 2, unread: 0 })
  })
})

describe('listen', () => {
  it('resolves when a message arrives mid-wait', async () => {
    const channel = createChannel(makeProject())
    setTimeout(() => send(channel, 'external', { type: 'chat', text: 'ping' }), 100)
    const messages = await listen(channel, 'cursor', { timeoutSec: 5, pollMs: 20 })
    expect(messages.map((m) => m.text)).toEqual(['ping'])
  })

  it('returns [] on timeout', async () => {
    const channel = createChannel(makeProject())
    const messages = await listen(channel, 'cursor', { timeoutSec: 0, pollMs: 20 })
    expect(messages).toEqual([])
  })
})

describe('init', () => {
  it('writes the Cursor command and the Claude skill into the project', () => {
    const dir = makeProject()
    const commandFile = init(dir, 'cursor')
    const skillFile = init(dir, 'claude')
    expect(commandFile).toBe(path.join(dir, '.cursor', 'commands', 'pair.md'))
    expect(skillFile).toBe(path.join(dir, '.claude', 'skills', 'cursor', 'SKILL.md'))
    expect(fs.readFileSync(commandFile, 'utf8')).toContain('/pair')
    expect(fs.readFileSync(skillFile, 'utf8')).toContain('name: cursor')
  })
})

describe('changes', () => {
  const makeGitProject = (): string => {
    const dir = makeProject()
    execFileSync('git', ['init', '-q'], { cwd: dir })
    return dir
  }

  it('returns one merged diff since the last read, then burns it', () => {
    const dir = makeGitProject()
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
    const channel = createChannel(dir)
    resetBaseline(channel, 'external')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'brand new\n')
    const diff = changes(channel, 'external')
    expect(diff).toContain('+two')
    expect(diff).toContain('b.txt')
    expect(changes(channel, 'external')).toBe('') // consumed — baseline advanced
  })

  it('keep peeks without consuming', () => {
    const dir = makeGitProject()
    const channel = createChannel(dir)
    resetBaseline(channel, 'external')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n')
    expect(changes(channel, 'external', { keep: true })).toContain('a.txt')
    expect(changes(channel, 'external')).toContain('a.txt') // still there
  })

  it('roles consume independently', () => {
    const dir = makeGitProject()
    const channel = createChannel(dir)
    resetBaseline(channel, 'external')
    resetBaseline(channel, 'cursor')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n')
    expect(changes(channel, 'external')).toContain('a.txt')
    expect(changes(channel, 'cursor')).toContain('a.txt') // cursor reads at its own pace
  })

  it('never leaks the channel itself into the diff', () => {
    const dir = makeGitProject()
    const channel = createChannel(dir)
    resetBaseline(channel, 'external')
    send(channel, 'cursor', { type: 'chat', text: 'channel noise' })
    expect(changes(channel, 'external')).toBe('')
  })

  it('throws outside a git repository', () => {
    const channel = createChannel(makeProject())
    expect(() => changes(channel, 'external')).toThrow('git repository')
  })
})

describe('draft / sendDiff', () => {
  it('drafts a copy, sends one normalized diff, clears drafts, leaves the real file alone', () => {
    const dir = makeProject()
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n')
    const channel = createChannel(dir)
    const [copy] = draft(channel, ['a.txt'])
    fs.writeFileSync(copy, 'one\nTWO\n')
    const message = sendDiff(channel, 'external')
    expect(message.type).toBe('diff')
    expect(message.patch).toContain('--- a/a.txt')
    expect(message.patch).toContain('+++ b/a.txt')
    expect(message.patch).toContain('+TWO')
    expect(fs.existsSync(path.join(channel, 'draft'))).toBe(false) // cleared
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('one\ntwo\n') // untouched
    const [received] = readNew(channel, 'cursor')
    expect(received.patch).toBe(message.patch)
  })

  it('bundles several drafts, including a brand-new file, into one message', () => {
    const dir = makeProject()
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hi\n')
    const channel = createChannel(dir)
    const [aCopy, bCopy] = draft(channel, ['a.txt', 'src/b.txt'])
    fs.writeFileSync(aCopy, 'hi there\n')
    fs.writeFileSync(bCopy, 'brand new\n')
    const message = sendDiff(channel, 'external')
    expect(message.patch).toContain('+hi there')
    expect(message.patch).toContain('--- /dev/null')
    expect(message.patch).toContain('+++ b/src/b.txt')
    expect(message.patch).toContain('+brand new')
  })

  it('refuses paths outside the project, empty drafts, and unchanged drafts', () => {
    const dir = makeProject()
    fs.writeFileSync(path.join(dir, 'a.txt'), 'same\n')
    const channel = createChannel(dir)
    expect(() => draft(channel, ['../evil.txt'])).toThrow('outside the project')
    expect(() => sendDiff(channel, 'external')).toThrow('no drafts')
    draft(channel, ['a.txt'])
    expect(() => sendDiff(channel, 'external')).toThrow('nothing to send')
  })
})

// Type-level tests. We test public types too, not just runtime behavior.
// This function is never called — `tsc` (and `tsgo`) check its body, nothing runs.
function assertTypes() {
  expectTypeOf<Role>().toEqualTypeOf<'external' | 'cursor'>()
  expectTypeOf<Message['type']>().toEqualTypeOf<'chat' | 'diff' | 'ack' | 'error'>()
  expectTypeOf(send).returns.toEqualTypeOf<Message>()
  expectTypeOf(listen).returns.resolves.toEqualTypeOf<Message[]>()
}

describe('types', () => {
  it('compile-time type assertions hold', () => {
    expect(typeof assertTypes).toBe('function') // referenced so tsc checks it; never invoked
  })
})
