import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claudeSkill, cursorCommand } from './assets.js'

export type InitTarget = 'claude' | 'cursor'

export type InitOptions = {
  /** For `claude`: install to `~/.claude` instead of the project's `.claude`. */
  global?: boolean
}

const write = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

/**
 * Write the prompt file for a target and return its path. `cursor` installs the `/pair` command; `claude` installs the
 * `/cursor` skill.
 */
export const init = (dir: string, target: InitTarget, options: InitOptions = {}): string => {
  if (target === 'cursor') {
    const commandFile = path.join(dir, '.cursor', 'commands', 'pair.md')
    write(commandFile, cursorCommand)
    return commandFile
  }
  const skillFile = path.join(
    options.global ? path.join(os.homedir(), '.claude') : path.join(dir, '.claude'),
    'skills',
    'cursor',
    'SKILL.md',
  )
  write(skillFile, claudeSkill)
  return skillFile
}
