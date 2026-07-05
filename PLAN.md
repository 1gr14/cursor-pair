# cursor-pair — plan / backlog

Working doc, not published. Status: **dev** (private, unpublished, `dev` branch
— no releases fire).

## The idea

A CLI agent (Claude Code, Codex) and the Cursor agent work in the same folder.
The CLI agent stops editing files itself: it sends each edit as a unified diff
over a private local channel (a folder on disk); the Cursor agent applies it
with its own edit tools, so the user reviews every step natively in Cursor —
accept/decline, hunk by hunk. Chat flows both ways: messages typed in Cursor are
forwarded to the CLI agent by default.

Decisions already made (see README for the user-facing story):

- Name: **unscoped `cursor-pair`** on npm (short beats scope; the GitHub repo
  stays in the `1gr14` org); commands: `/cursor` in Claude Code, `/pair` in
  Cursor (second word of the package = the Cursor command).
- Transport: file mailbox, two one-way JSONL files + byte offsets — a role never
  re-reads anything and never sees its own messages. No network.
- Channel id = its path (`./.cursor-pair/1`), so several sessions per folder
  just work.
- Protocol: `chat` / `diff` / `ack` / `error`. Applying a diff must be confirmed
  (`ack`) or refused (`error` + reason) — nothing else is mandated; what happens
  after the confirmation is the external agent's call, from context.
- Cursor side runs a fast cheap model — it only applies and relays.
- **Changes are pulled, not pushed** (the core trick): nothing streams disk
  changes at the CLI agent. Each role has its own baseline (a git tree snapshot,
  per-role temp index — the user's real index is untouched);
  `cursor-pair changes --as <role>` prints one merged diff of everything since
  that role last looked and advances the baseline (read-once, "burns"). Declines
  and hand edits fold in naturally; the CLI agent seeing its own applied edit
  come back confirms state. Protocol rule: pull `changes` on every wake-up.
  Requires git.
- Escape prefixes, same on both sides: `..` (handle it yourself, once), `..+`
  direct mode on, `..-` off. Not `!` — that is bash mode in Claude Code.
- `.cursor-pair/` goes to `.git/info/exclude`, not `.gitignore` — the user's
  diff stays clean.

## Done (v0 scaffold)

- [x] Repo from blank0, renamed, `dev` branch, no publish.
- [x] CLI: `new`, `send`, `listen` (heartbeat, timeout, exit 2), `changes`
      (read-once merged diff per role, `--keep` to peek), `status`,
      `init <claude|cursor|codex>` — zero runtime deps.
- [x] Library API (`createChannel`, `send`, `readNew`, `listen`, `init`) +
      tests + smoke.
- [x] Prompt assets: Claude skill (`/cursor`), Cursor command (`/pair`), Codex
      AGENTS.md snippet.
- [x] README with the problem statement and the protocol.

## POC — validate the risks, in this order

- [ ] **Listen-loop survival in Cursor** — the make-or-break. Cursor kills
      terminal commands after ~90s of _silence_ (heartbeat should cover it) and
      checkpoints after ~25 tool calls per turn ("continue?"). Measure how long
      a `/pair` session actually lives; tune `--heartbeat`/`--timeout`; document
      `cursor.agent.terminalTimeout`.
- [ ] **Diff application fidelity** — does the Cursor agent (on a cheap model)
      apply unified diffs exactly? Try context drift, new files, deletions,
      renames. Maybe the diff format needs to be simpler (full-file replace as a
      fallback?).
- [ ] **End-to-end dogfood** — run a real session on a real project from both
      sides; fix the prompt files where the agents stumble.
- [ ] **`beforeSubmitPrompt` hook experiment** — Cursor hooks get the user's
      prompt before the model does and can return JSON. If a hook can forward
      the message into the channel _and_ block the model call, proxy mode
      becomes free and instant (no Cursor agent turn at all).

## Next (v0.2 candidates)

- [ ] **Push nudge** (optional daemon on top of the pull model): watch the
      worktree and, when changes settle (debounced), drop a short "disk changed"
      ping into the channel so an idle external agent wakes and pulls `changes`
      — enables "real-time review of my typing" without streaming diffs. The
      pull model already covers awareness; this only adds wake-up.
- [ ] `stop` hook on the Cursor side → auto-send "turn finished" into the
      channel without an LLM step.
- [ ] `send --text` from stdin/file for long chat messages (shell quoting).
- [ ] `init all`; `init codex` writing into `AGENTS.md` instead of printing.
- [ ] Cross-editor: check what VS Code Copilot / Windsurf offer for the applier
      role.
- [ ] Watch Cursor SDK (`@cursor/sdk`, beta since 2026-04): today it spawns its
      own agents and can't join the user's IDE session, so it doesn't fit;
      revisit if SDK edits ever land in the IDE review UI.

## Release checklist (when POC holds up)

- [ ] Reserve `cursor-pair` on npm + OIDC Trusted Publisher (bootstrap-publish
      flow — Sergei runs it).
- [ ] GitHub repo `1gr14/cursor-pair`, public, `main` default + "Protected main"
      ruleset.
- [ ] README polish per 1gr14-docs/voice; site sync.
- [ ] `bun run release 0.1.0`.

## Open questions

- The Claude skill installs as `.claude/skills/cursor/` so the command is
  `/cursor` — generic name, could clash with other tooling. Acceptable?
- Heartbeat cadence and listen timeout defaults — tune after the POC.
- Should `ack` carry a result summary (files touched, hunks applied)? Maybe
  unnecessary now — `changes` already tells the external agent what landed.
- Prompts call the global `cursor-pair` bin (works pre-publish via `bun link`).
  Decide before release: keep global-install story or switch prompts to
  `bunx cursor-pair` (zero-install, but breaks local pre-publish testing).
