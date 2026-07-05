# cursor-pair

> Pair your CLI agent with your Cursor agent — edits arrive as native Cursor
> diffs you accept or decline.

[![CI](https://github.com/1gr14/cursor-pair/actions/workflows/ci.yml/badge.svg)](https://github.com/1gr14/cursor-pair/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/cursor-pair.svg)](https://www.npmjs.com/package/cursor-pair)
[![coverage](https://codecov.io/gh/1gr14/cursor-pair/branch/main/graph/badge.svg)](https://codecov.io/gh/1gr14/cursor-pair)
[![license](https://img.shields.io/npm/l/cursor-pair.svg)](./LICENSE)

<!-- docs:start -->

You run an agent in the terminal — Claude Code, Codex — and keep the same folder
open in Cursor to review what it changed. The working-tree diff is your review
queue: you read it, you don't commit yet. The problem: every new request mutates
that one big diff, so you can't tell what the _last_ step changed without
re-reading everything.

cursor-pair gives the two agents a private local channel. The CLI agent stops
editing files itself: it sends each edit as a diff, and your Cursor agent
applies it with its own edit tools. Every step shows up in Cursor as a normal
agent edit — you accept or decline it hunk by hunk. Chat flows both ways, so you
can talk to your CLI agent without leaving Cursor.

The channel is a folder on your disk. No server, no network, nothing leaves your
machine.

```sh
# In Claude Code, type /cursor — the agent runs:
cursor-pair new
# => ./.cursor-pair/1

# In Cursor chat, paste:
#   /pair ./.cursor-pair/1
# From now on the CLI agent sends diffs, Cursor applies them, you review.
```

## Install

```sh
bun add -g cursor-pair
# or: npm install -g cursor-pair
```

Then install the prompt files — they teach each agent its role:

```sh
cursor-pair init cursor # .cursor/commands/pair.md       → /pair in Cursor
cursor-pair init claude # .claude/skills/cursor/SKILL.md → /cursor in Claude Code
cursor-pair init claude --global # …or into ~/.claude for all projects
cursor-pair init codex  # prints a snippet for AGENTS.md
```

## How a session works

1. `/cursor` in Claude Code — the agent creates a channel and gives you the
   `/pair` line for Cursor.
2. `/pair ./.cursor-pair/1` in Cursor — the agent connects and listens.
3. Ask Claude for changes. Instead of editing files, it sends unified diffs into
   the channel; Cursor applies each one with its own edit tools and confirms
   with an `ack` (or an `error` saying why not). You review every step in Cursor
   as usual.
4. Type into either chat. Messages you write in Cursor are forwarded to the CLI
   agent by default — it is the one doing the thinking; the Cursor side stays on
   a fast, cheap model and just applies.

Escape hatch, same on both sides: start a message with `..` and that agent
handles it itself instead of going through the channel — `..+` turns that mode
on for everything, `..-` turns it back off. Plain words work too — "do it
yourself" always wins. (Why not `!`? In Claude Code `!` opens bash mode, the
message would never reach the agent.)

## Changes are pulled, not pushed

The core trick. Nothing streams disk changes at the CLI agent — it would wake on
every keystroke. Instead each side has a private accumulator it reads when _it_
decides — normally right after waking up on a message:

```sh
cursor-pair changes ./.cursor-pair/1 --as external
# --- one merged unified diff of everything since this role last looked:
# the diffs Cursor applied, your declines (a decline reverts the file),
# your hand edits — folded together by git. Empty? "# no changes".
```

Reading consumes it: the baseline advances, the next call starts from now. Each
role has its own baseline, so the two agents stay in sync independently. The CLI
agent seeing its own applied edit come back is by design — that is how it
confirms what actually landed after your review. Under the hood it is a git tree
snapshot per role (your real index is never touched), so `.gitignore`d noise —
builds, `node_modules` — never shows up. Needs the project to be a git
repository.

## The channel on disk

```
.cursor-pair/1/
  channel.json       # protocol version, id, created at
  to-cursor.jsonl    # written by the CLI agent, read only by Cursor
  to-external.jsonl  # written by Cursor, read only by the CLI agent
  cursor.offset      # how far Cursor has read — only new messages are ever read
  external.offset
  external.baseline  # each role's "last seen" tree for `changes`
  cursor.baseline
```

One writer and one reader per file, byte offsets instead of re-reading, and the
folder is added to `.git/info/exclude` so it never shows up in your diff.
Messages are JSONL:

```json
{ "seq": 2, "ts": "2026-07-05T12:00:00Z", "from": "external", "type": "diff", "patch": "--- a/src/app.ts\n+++ b/src/app.ts\n@@ …" }
{ "seq": 1, "ts": "2026-07-05T12:00:03Z", "from": "cursor", "type": "ack", "ref": 2 }
```

| type    | meaning                                           |
| ------- | ------------------------------------------------- |
| `chat`  | text for the other side (user words, questions)   |
| `diff`  | a unified diff to apply exactly as given          |
| `ack`   | the diff in `ref` is applied                      |
| `error` | the diff in `ref` is not applied; `text` says why |

## CLI reference

```sh
cursor-pair new [id]                     # create a channel, print its path
cursor-pair send <channel> --as <role> [--type chat|diff|ack|error]
                [--text "..."] [--patch-file file|-] [--ref N]
cursor-pair listen <channel> --as <role> [--timeout 480] [--heartbeat 30]
cursor-pair changes <channel> --as <role> [--keep]
cursor-pair status <channel>             # message counts per side
cursor-pair init <claude|cursor|codex> [--global]
```

Roles: `external` (the CLI agent) and `cursor` (the IDE agent). `listen` blocks
until a message arrives, prints it as JSONL and exits 0; on timeout it exits 2.
Lines starting with `#` are heartbeats that keep IDE terminals from killing a
"silent" process. `changes` is read-once; `--keep` peeks without consuming.

## Scope and notes

- The IDE side is Cursor today because Cursor renders agent edits with an
  accept/decline review UI. The protocol itself is editor-agnostic — any agent
  that can run a CLI can take either role.
- If you only need "what changed since I last looked", staging reviewed files
  with `git add` gets you far. cursor-pair is for when you also want per-step
  accept/decline and a two-way line to the CLI agent.
- Not affiliated with Cursor (Anysphere) or Anthropic.

## Requirements

- **Bun 1+** or **Node.js 20+** (ESM only)
- **git** in the project — `changes` builds on git snapshots
- **TypeScript 5+** (optional — works in plain JS too)

<!-- docs:end -->

## Community

Questions, bugs, or want to hang with other builders? Join the 1gr14 community —
one hub for all our open-source projects, this one included. Get help, share
what you built, or just say hi:
[1gr14.dev/#community](https://1gr14.dev/#community)

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/). Security reports:
[SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)

---

Made by [1gr14](https://1gr14.dev), driven by
[community](https://1gr14.dev/#community)
