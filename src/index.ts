export { claudeSkill, codexSnippet, cursorCommand } from './assets.js'
export { changes, isGitProject, projectDir, resetBaseline, type ChangesOptions } from './changes.js'
export {
  CHANNEL_DIR,
  PROTOCOL_VERSION,
  ROLES,
  assertChannel,
  createChannel,
  inboxPath,
  isChannel,
  otherRole,
  readNew,
  send,
  status,
  type ChannelStatus,
  type Message,
  type MessageType,
  type Role,
  type SendInput,
} from './channel.js'
export { draft, sendDiff } from './draft.js'
export { init, type InitOptions, type InitTarget } from './init.js'
export { listen, type ListenOptions } from './listen.js'
