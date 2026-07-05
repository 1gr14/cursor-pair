import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { assertChannel, type Role } from './channel.js'

export type ChangesOptions = {
  /** Peek at the diff without consuming it — the baseline stays where it was. */
  keep?: boolean
}

/** The project folder a channel belongs to: channels live at `<project>/.cursor-pair/<id>`. */
export const projectDir = (channel: string): string => path.dirname(path.dirname(path.resolve(channel)))

const baselinePath = (channel: string, role: Role): string => path.join(channel, `${role}.baseline`)

const git = (project: string, args: string[], indexFile?: string): string =>
  execFileSync('git', args, {
    cwd: project,
    env: indexFile === undefined ? process.env : { ...process.env, GIT_INDEX_FILE: indexFile },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })

export const isGitProject = (channel: string): boolean => {
  try {
    git(projectDir(channel), ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

/**
 * Snapshot the working tree into a git tree object, using a per-role temporary index so the user's real index (staged
 * files) is never touched. Respects `.gitignore` and `.git/info/exclude` — so builds, `node_modules`, and the channel
 * itself never show up in a diff.
 */
const snapshot = (channel: string, role: Role): string => {
  const project = projectDir(channel)
  const indexFile = path.resolve(channel, `${role}.index`)
  fs.rmSync(indexFile, { force: true })
  git(project, ['add', '-A', '--', '.'], indexFile)
  return git(project, ['write-tree'], indexFile).trim()
}

/** Record the current working tree as `role`'s baseline — its "last seen" state. */
export const resetBaseline = (channel: string, role: Role): void => {
  fs.writeFileSync(baselinePath(channel, role), `${snapshot(channel, role)}\n`)
}

/**
 * One merged unified diff of everything that changed on disk since `role` last looked — agent edits applied through the
 * channel, the user's declines (a decline reverts the file), hand edits, all folded together by git. Reading consumes
 * it: the baseline advances, so the next call returns only what happened after this one. Each role has its own baseline
 * and reads at its own pace. Returns `''` when nothing changed.
 */
export const changes = (channel: string, role: Role, options: ChangesOptions = {}): string => {
  assertChannel(channel)
  if (!isGitProject(channel)) {
    throw new Error(`changes needs the project to be a git repository: ${projectDir(channel)}`)
  }
  const file = baselinePath(channel, role)
  if (!fs.existsSync(file)) {
    // No baseline yet — this moment becomes the starting point.
    resetBaseline(channel, role)
    return ''
  }
  const baseline = fs.readFileSync(file, 'utf8').trim()
  const current = snapshot(channel, role)
  if (current === baseline) return ''
  const diff = git(projectDir(channel), ['diff', baseline, current])
  if (options.keep !== true) fs.writeFileSync(file, `${current}\n`)
  return diff
}
