import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertChannel, send, type Message, type Role } from './channel.js'
import { projectDir } from './changes.js'

/**
 * The draft flow: the external agent never writes a unified diff by hand and never sends whole files. It edits COPIES
 * with its normal edit tools — `draft` makes the copies, `sendDiff` turns them into one machine-computed diff message
 * and clears them.
 */

const draftDir = (channel: string): string => path.join(channel, 'draft')

/**
 * Copy project files into the channel's draft dir and return the copies' paths. A path that does not exist in the
 * project becomes an empty draft — that is how new files are created.
 */
export const draft = (channel: string, files: string[]): string[] => {
  assertChannel(channel)
  if (files.length === 0) throw new Error('draft needs at least one file path')
  const project = projectDir(channel)
  return files.map((file) => {
    const resolved = path.isAbsolute(file) ? file : path.resolve(project, file)
    const relative = path.relative(project, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`file is outside the project: ${file}`)
    }
    const copy = path.join(draftDir(channel), relative)
    fs.mkdirSync(path.dirname(copy), { recursive: true })
    if (fs.existsSync(resolved)) fs.copyFileSync(resolved, copy)
    else fs.writeFileSync(copy, '')
    return copy
  })
}

const walk = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))

/**
 * `git diff --no-index` prints the temp paths and exits 1 whenever the files differ — both would confuse an agent, so
 * we absorb the exit code here and rewrite the headers to project-relative `a/<rel> b/<rel>` below.
 */
const diffFiles = (project: string, from: string, to: string): string => {
  try {
    execFileSync('git', ['diff', '--no-index', '--', from, to], {
      cwd: project,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    })
    return '' // exit 0 — identical
  } catch (error) {
    const failure = error as { status?: number; stdout?: string }
    if (failure.status !== 1 || typeof failure.stdout !== 'string') throw error
    return failure.stdout
  }
}

const normalizeHeaders = (diff: string, relative: string, isNew: boolean): string => {
  let inHead = true
  return diff
    .split('\n')
    .map((line) => {
      if (!inHead) return line
      if (line.startsWith('@@')) {
        inHead = false
        return line
      }
      if (line.startsWith('diff --git ')) return `diff --git a/${relative} b/${relative}`
      if (line.startsWith('--- ')) return isNew ? '--- /dev/null' : `--- a/${relative}`
      if (line.startsWith('+++ ')) return `+++ b/${relative}`
      return line
    })
    .join('\n')
}

/**
 * Diff every drafted file against the project, send the result as ONE `diff` message from `from`, and clear the draft
 * dir. Throws when there is nothing drafted or nothing changed.
 */
export const sendDiff = (channel: string, from: Role): Message => {
  assertChannel(channel)
  const dir = draftDir(channel)
  if (!fs.existsSync(dir)) {
    throw new Error(`no drafts in ${channel} — start with \`cursor-pair draft <channel> <file>\``)
  }
  const project = projectDir(channel)
  const patches = walk(dir)
    .map((copy) => {
      const relative = path.relative(dir, copy)
      const original = path.join(project, relative)
      const isNew = !fs.existsSync(original)
      const diff = diffFiles(project, isNew ? os.devNull : original, copy)
      return diff === '' ? '' : normalizeHeaders(diff, relative, isNew)
    })
    .filter((patch) => patch !== '')
  if (patches.length === 0) {
    throw new Error('drafts are identical to the project files — nothing to send')
  }
  const message = send(channel, from, { type: 'diff', patch: patches.join('') })
  fs.rmSync(dir, { recursive: true, force: true })
  return message
}
