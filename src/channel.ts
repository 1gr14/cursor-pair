import fs from 'node:fs'
import path from 'node:path'

/** Folder (inside the paired project) that holds all channels. */
export const CHANNEL_DIR = '.cursor-pair'

export const PROTOCOL_VERSION = 1

/**
 * Who is talking. `external` is the CLI agent (Claude Code, Codex); `cursor` is the IDE agent that applies diffs.
 */
export type Role = 'external' | 'cursor'

export type MessageType = 'chat' | 'diff' | 'ack' | 'error'

export type Message = {
  /** Per-direction sequence number, 1-based. */
  seq: number
  /** ISO timestamp set by the sender. */
  ts: string
  from: Role
  type: MessageType
  /** Chat text, or the note on an ack/error. */
  text?: string
  /** Unified diff payload for type `diff`. */
  patch?: string
  /** The seq of the message this ack/error replies to. */
  ref?: number
}

export type SendInput = {
  type: MessageType
  text?: string
  patch?: string
  ref?: number
}

export const ROLES: readonly Role[] = ['external', 'cursor']

export const otherRole = (role: Role): Role => (role === 'external' ? 'cursor' : 'external')

/** The file a role reads: messages addressed to it. Each file has one writer and one reader. */
export const inboxPath = (channel: string, role: Role): string => path.join(channel, `to-${role}.jsonl`)

/** Byte offset of what `role` has already read from its inbox. */
const offsetPath = (channel: string, role: Role): string => path.join(channel, `${role}.offset`)

/** Last seq written into `to-<role>.jsonl` (owned by the single writer of that file). */
const seqPath = (channel: string, role: Role): string => path.join(channel, `to-${role}.seq`)

const readInt = (file: string): number => {
  if (!fs.existsSync(file)) return 0
  const value = Number(fs.readFileSync(file, 'utf8').trim())
  return Number.isFinite(value) ? value : 0
}

/**
 * Create a channel under `<dir>/.cursor-pair/<id>` and return its path. Without an id, picks the next free integer (1,
 * 2, …). Also adds `.cursor-pair/` to `.git/info/exclude` so the channel never shows up in the user's diff.
 */
export const createChannel = (dir: string, id?: string): string => {
  const base = path.resolve(dir, CHANNEL_DIR)
  fs.mkdirSync(base, { recursive: true })
  let name = id
  if (name === undefined || name === '') {
    let n = 1
    while (fs.existsSync(path.join(base, String(n)))) n += 1
    name = String(n)
  }
  const channel = path.join(base, name)
  if (fs.existsSync(path.join(channel, 'channel.json'))) {
    throw new Error(`channel already exists: ${channel}`)
  }
  fs.mkdirSync(channel, { recursive: true })
  const meta = { version: PROTOCOL_VERSION, id: name, createdAt: new Date().toISOString() }
  fs.writeFileSync(path.join(channel, 'channel.json'), `${JSON.stringify(meta, null, 2)}\n`)
  for (const role of ROLES) {
    fs.writeFileSync(inboxPath(channel, role), '')
    fs.writeFileSync(offsetPath(channel, role), '0')
    fs.writeFileSync(seqPath(channel, role), '0')
  }
  excludeFromGit(dir)
  return channel
}

export const isChannel = (channel: string): boolean => fs.existsSync(path.join(channel, 'channel.json'))

export const assertChannel = (channel: string): void => {
  if (!isChannel(channel)) {
    throw new Error(`not a cursor-pair channel: ${channel} (create one with \`cursor-pair new\`)`)
  }
}

/** Append a message from `from` to the other role's inbox. Returns it with its seq. */
export const send = (channel: string, from: Role, input: SendInput): Message => {
  assertChannel(channel)
  const to = otherRole(from)
  const seq = readInt(seqPath(channel, to)) + 1
  const message: Message = {
    seq,
    ts: new Date().toISOString(),
    from,
    type: input.type,
    ...(input.text === undefined ? {} : { text: input.text }),
    ...(input.patch === undefined ? {} : { patch: input.patch }),
    ...(input.ref === undefined ? {} : { ref: input.ref }),
  }
  fs.writeFileSync(seqPath(channel, to), String(seq))
  fs.appendFileSync(inboxPath(channel, to), `${JSON.stringify(message)}\n`)
  return message
}

/**
 * Read the messages addressed to `role` that arrived since the last read, and advance the stored offset — so nothing is
 * ever re-read, and a role never sees its own messages. Returns `[]` when there is nothing new.
 */
export const readNew = (channel: string, role: Role): Message[] => {
  assertChannel(channel)
  const file = inboxPath(channel, role)
  const offsetFile = offsetPath(channel, role)
  const offset = readInt(offsetFile)
  const size = fs.statSync(file).size
  if (size <= offset) return []
  const buffer = Buffer.alloc(size - offset)
  const fd = fs.openSync(file, 'r')
  try {
    fs.readSync(fd, buffer, 0, buffer.length, offset)
  } finally {
    fs.closeSync(fd)
  }
  const chunk = buffer.toString('utf8')
  // Only consume up to the last full line — never split a half-written message.
  const lastNewline = chunk.lastIndexOf('\n')
  if (lastNewline === -1) return []
  const complete = chunk.slice(0, lastNewline)
  fs.writeFileSync(offsetFile, String(offset + Buffer.byteLength(complete, 'utf8') + 1))
  return complete
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Message)
}

export type ChannelStatus = {
  channel: string
  perRole: Record<Role, { total: number; unread: number }>
}

export const status = (channel: string): ChannelStatus => {
  assertChannel(channel)
  const perRole = {} as ChannelStatus['perRole']
  for (const role of ROLES) {
    const file = inboxPath(channel, role)
    const content = fs.readFileSync(file, 'utf8')
    const total = content === '' ? 0 : content.split('\n').filter((line) => line !== '').length
    const unread = fs.statSync(file).size > readInt(offsetPath(channel, role)) ? 1 : 0
    perRole[role] = { total, unread: unread === 1 ? countUnread(channel, role) : 0 }
  }
  return { channel, perRole }
}

const countUnread = (channel: string, role: Role): number => {
  const file = inboxPath(channel, role)
  const offset = readInt(offsetPath(channel, role))
  const content = fs.readFileSync(file, 'utf8')
  const rest = Buffer.from(content, 'utf8').subarray(offset).toString('utf8')
  return rest.split('\n').filter((line) => line !== '').length
}

/** Keep the channel folder out of the user's git diff — local exclude, not .gitignore. */
const excludeFromGit = (dir: string): void => {
  const gitDir = path.join(dir, '.git')
  if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) return
  const infoDir = path.join(gitDir, 'info')
  fs.mkdirSync(infoDir, { recursive: true })
  const excludeFile = path.join(infoDir, 'exclude')
  const line = `${CHANNEL_DIR}/`
  const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : ''
  if (current.split('\n').includes(line)) return
  const prefix = current === '' || current.endsWith('\n') ? '' : '\n'
  fs.appendFileSync(excludeFile, `${prefix}${line}\n`)
}
