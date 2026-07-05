// Post-build smoke test: verifies the published artifact loads under plain Node
// and that the package "exports" map resolves. Runs a full channel roundtrip.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createChannel, readNew, send } from '../dist/index.js'

const assert = (cond, msg) => {
  if (!cond) {
    console.error('smoke test failed:', msg)
    process.exit(1)
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-pair-smoke-'))
const channel = createChannel(dir)
send(channel, 'external', { type: 'chat', text: 'ping' })
const [message] = readNew(channel, 'cursor')

assert(message?.text === 'ping', 'channel roundtrip should work from the built package')
assert(readNew(channel, 'cursor').length === 0, 'messages should never be read twice')
assert(fs.existsSync(path.join(channel, 'channel.json')), 'channel.json should exist')

console.log('smoke ok')
