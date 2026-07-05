import { readNew, type Message, type Role } from './channel.js'

export type ListenOptions = {
  /** Give up after this many seconds with no messages. Default 480. */
  timeoutSec?: number
  /** Poll interval in milliseconds. Default 300. */
  pollMs?: number
  /** Call `onHeartbeat` this often, in seconds. Default 30; 0 disables. */
  heartbeatSec?: number
  /** Called on every heartbeat with the seconds waited so far. */
  onHeartbeat?: (waitedSec: number) => void
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Block until at least one new message arrives for `role`, then return the batch. Returns `[]` on timeout. Polling
 * keeps it dependency-free and works on every OS; the heartbeat lets callers print activity so IDE terminals don't kill
 * a "silent" process.
 */
export const listen = async (channel: string, role: Role, options: ListenOptions = {}): Promise<Message[]> => {
  const { timeoutSec = 480, pollMs = 300, heartbeatSec = 30, onHeartbeat } = options
  const start = Date.now()
  let lastBeat = start
  for (;;) {
    const messages = readNew(channel, role)
    if (messages.length > 0) return messages
    const now = Date.now()
    if (now - start >= timeoutSec * 1000) return []
    if (heartbeatSec > 0 && onHeartbeat && now - lastBeat >= heartbeatSec * 1000) {
      onHeartbeat(Math.round((now - start) / 1000))
      lastBeat = now
    }
    await sleep(pollMs)
  }
}
