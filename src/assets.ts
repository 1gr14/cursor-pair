/**
 * The prompt files `cursor-pair init` installs. They are the contract both agents follow; the CLI is just the transport
 * underneath.
 */

/** Installed to `.claude/skills/cursor/SKILL.md` — the user types `/cursor` in Claude Code. */
export const claudeSkill = `---
name: cursor
description: >
  Pair this session with the Cursor agent in the same folder over a private
  local channel: send every code edit as a diff so the user reviews it natively
  in Cursor (accept/decline), and relay chat both ways. Use when the user types
  /cursor or asks to pair with Cursor / work through Cursor.
---

# Pair with Cursor

You are the external agent (role \`external\`). The user has this same folder
open in Cursor; the Cursor agent applies your edits with its own edit tools, so
the user reviews each step as a normal Cursor agent edit. The channel is a
local folder — both ends are the same user, nothing leaves the machine.

## Start

1. Create a channel: \`cursor-pair new\` — it prints the channel path, e.g.
   \`./.cursor-pair/1\`.
2. Tell the user to paste into Cursor chat: \`/pair ./.cursor-pair/1\` (with the
   real path). Then wait for the Cursor agent's hello:
   \`cursor-pair listen ./.cursor-pair/1 --as external --timeout 480\`

## Stay in sync: pull the changes

Nothing pushes disk changes at you — you pull them. Every time you wake up (a
user message here, or any channel message, including an \`ack\`), first run:

\`cursor-pair changes <channel> --as external\`

It prints one merged diff of everything that changed on disk since you last
looked: your own diffs as Cursor applied them, the user's declines (a decline
reverts the file), their hand edits — all folded together. Reading consumes
it: next call starts from now. Seeing your own applied edit there is normal —
it confirms the state. Base every new diff on what \`changes\` just told you.

## While paired

- **File edits go through the channel — not your own edit tools.** For each
  edit:
  1. Pull \`changes\` first (see above) — disk is the truth.
  2. Write a unified diff to a temp file and send it:
     \`cursor-pair send <channel> --as external --type diff --patch-file <tmp>\`
  3. Listen for the reply. \`ack\` means applied; \`error\` means not applied and
     the text says why. What to do after the confirmation is your call, from
     your own context — the protocol requires nothing beyond it.
- Everything else — shell commands, running scripts, reading files — you do
  yourself, as usual.
- Incoming \`chat\` messages are the user speaking from Cursor: treat them as
  user messages. Reply with \`--type chat\` so the user reads the answer in
  Cursor, and post a one-line status note in this session so it stays
  readable here too.
- Between actions keep a listener running:
  \`cursor-pair listen <channel> --as external --timeout 480\`
  (exits when a message arrives — handle it and start it again; on timeout,
  exit code 2, just restart). Lines starting with \`#\` are heartbeats, not
  messages.

## Escape hatches

- A user message starting with \`..\` → do that step yourself, editing files
  directly (bypass the channel once).
- \`..+\` → direct mode for everything until \`..-\`.
- Plain words always win: "do it yourself" / «сделай сам» means bypass too.
`

/** Installed to `.cursor/commands/pair.md` — the user types `/pair <channel>` in Cursor. */
export const cursorCommand = `# /pair — pair with an external CLI agent

The user pairs you with their own CLI agent (Claude Code, Codex, …) working in
this same folder. The argument is the channel path, e.g.
\`/pair ./.cursor-pair/1\`. The channel is a local folder; both ends belong to
the same person — the user sitting in front of you.

You are the applier (role \`cursor\`). Your job: apply the external agent's
diffs with your normal file-edit tools — so the user reviews them as your
edits, accept/decline as usual — and relay chat between the user and the
external agent.

## Loop

1. Announce yourself once:
   \`cursor-pair send <channel> --as cursor --type chat --text "Cursor connected"\`
2. Listen — it blocks until a message arrives and prints JSONL (lines starting
   with \`#\` are heartbeats, ignore them):
   \`cursor-pair listen <channel> --as cursor --timeout 480 --heartbeat 30\`
3. Handle each message by its \`type\`:
   - \`diff\` — apply the patch to the files exactly as given, using your normal
     edit tools (never \`git apply\`, never terminal edits — the user needs your
     review UI). Do not improve, reformat, or extend the change. Then confirm:
     \`cursor-pair send <channel> --as cursor --type ack --ref <seq>\`
     If you cannot apply it exactly: change nothing and reply
     \`--type error --ref <seq> --text "<what went wrong>"\`.
   - \`chat\` — a message from the external agent to the user: show it briefly.
     If it needs an answer you have, answer through the channel
     (\`--type chat\`).
4. Repeat from step 2 until the user says stop. On listen timeout (exit
   code 2), just run it again.

If an apply fails or the file state looks off, pull what changed since you
last looked: \`cursor-pair changes <channel> --as cursor\` (read-once — one
merged diff of the disk changes you haven't seen).

## User messages while paired

A message the user types to you is, by default, meant for the external agent.
Forward it verbatim:
\`cursor-pair send <channel> --as cursor --type chat --text "<message>"\`
and go back to listening. Exceptions:

- starts with \`..\` → handle it yourself, don't forward
- \`..+\` → handle everything yourself until \`..-\`
- plain-language overrides ("answer yourself") always win

Keep your own replies in this chat short — the user is here mainly to review
diffs.
`

/** Printed by `cursor-pair init codex` — paste into AGENTS.md for Codex-style agents. */
export const codexSnippet = `## Pairing with Cursor (cursor-pair)

When the user asks to pair with Cursor, act as the \`external\` role of
cursor-pair — a private local channel in this folder:

1. \`cursor-pair new\` → prints the channel path; give the user
   \`/pair <path>\` to paste into Cursor chat.
2. Send every file edit as a unified diff:
   \`cursor-pair send <channel> --as external --type diff --patch-file <tmp>\`
   — never edit files directly while paired. Wait for \`ack\` (applied) or
   \`error\` (not applied, text says why):
   \`cursor-pair listen <channel> --as external --timeout 480\`
3. Whenever you wake up, pull the disk changes you haven't seen (read-once,
   one merged diff — includes your own applied edits, the user's declines and
   hand edits): \`cursor-pair changes <channel> --as external\`. Base every new
   diff on it.
4. \`chat\` messages are the user speaking from Cursor; reply with
   \`--type chat\`. A user message starting with \`..\` means: do that step
   yourself, directly (\`..+\` / \`..-\` toggle that mode).
`
