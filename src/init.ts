import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claudeSkill, cursorCommand } from './assets.js'

export type InitTarget = 'claude' | 'cursor'

export type InitOptions = {
  /** For `claude`: install to `~/.claude` instead of the project's `.claude`. */
  global?: boolean
}

/**
 * Write the prompt file for a target and return its path. `cursor` installs the `/pair` command; `claude` installs the
 * `/cursor` skill.
 */
export const init = (dir: string, target: InitTarget, options: InitOptions = {}): string => {
  const file =
    target === 'cursor'
      ? path.join(dir, '.cursor', 'commands', 'pair.md')
      : path.join(
          options.global ? path.join(os.homedir(), '.claude') : path.join(dir, '.claude'),
          'skills',
          'cursor',
          'SKILL.md',
        )
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, target === 'cursor' ? cursorCommand : claudeSkill)
  return file
}
