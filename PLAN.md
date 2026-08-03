# cursor-pair — plan / backlog

Working doc, not published to npm (`files` ships only dist/README/LICENSE).
Status: **early** — `cursor-pair` 0.1.0 is on npm (OIDC provenance), repo public
at github.com/1gr14/cursor-pair.

## Where it stands

Everything described in the README works end-to-end and survived four dogfood
rounds: the channel, the draft flow, read-once `changes`, both prompt files with
iron rules, the ⌘⏎ interrupt flow. The README is the source of truth for how it
works and why; this file tracks only what is left.

## Next

- [ ] Long-run `listen` check: does `--timeout 3600 --heartbeat 30` survive a
      full hour inside one Cursor turn? The forum lore (~90s silence kill,
      tool-call checkpoints) looks stale — verify empirically, then tune the
      default timeout and heartbeat.
- [ ] `init` takes several targets at once — `cursor-pair init claude cursor` /
      `init codex claude` (plus `init all`) instead of one command per target.
- [ ] Decide the invocation story in the prompts: now that the package is on
      npm, `bunx cursor-pair` (zero-install) works — or keep the global-bin
      story (`bun add -g`). Pick one and align README + prompts.
- [ ] README/site sync + a voice-guide pass before announcing anywhere.

## Later (v0.2 candidates)

- [ ] **Agentless extension mode — the big v2 direction** (Sergei's idea,
      2026-07-06). Drop the Cursor agent entirely: Claude edits files directly,
      and our own VS Code/Cursor EXTENSION renders the review — diff every
      change against the role baseline (the `changes` machinery, already built),
      highlight hunks inline, per-hunk Accept (advance baseline) / Decline
      (revert hunk). Verified: no other way in — the Cursor SDK is strictly
      headless (zero editor-UI APIs), and there is no public command/deeplink to
      feed an arbitrary diff into Cursor's native accept/decline UI. VS Code's
      stable SCM API (`createSourceControl` + `quickDiffProvider`) gives gutter
      markers and an inline diff peek against a custom baseline for free; the
      accept/decline buttons are ours to build. Kills the listen loop, apply
      fidelity risk, and all Cursor-side tokens; works in any VS Code fork.
      Cost: the hunk UI itself, and the chat proxy needs its own input box.
- [ ] File deletion and rename through the draft flow — today a draft can change
      or create a file, not remove one.
- [ ] Push nudge: an optional watcher that drops a "disk changed" ping into the
      channel when hand edits settle, so an idle external agent wakes and pulls
      `changes` — real-time commentary on the user's own typing.
- [ ] `send --text` from stdin/file (shell quoting on long chat messages).
- [ ] Other IDE-side appliers (VS Code Copilot, Windsurf) — the protocol is
      already editor-agnostic.
- [ ] Cursor SDK (`@cursor/sdk`): today it cannot join the user's IDE session;
      revisit if SDK edits ever land in the IDE review UI.

## Open questions

- The Claude skill installs as `.claude/skills/cursor/` so the command is
  `/cursor` — a generic name that could clash with other tooling. Acceptable?

## Lessons learned — don't redo these

- **Cursor hooks relay — parked (2026-07-06).** A `beforeSubmitPrompt` relay
  plus `stop`-followup loop failed live: queued messages reach the hook only
  when the queue delivers them (so it cannot unblock the chat), and the followup
  was swallowed by our own relay ("Submission blocked by hook"), killing the
  loop. Revisit only if Cursor starts delivering prompts to hooks at submit
  time.
- **Prompt discipline = hard numbered rules.** Four dogfood rounds, the same
  lesson each time: prose gets drifted past, iron rules survive. Current set:
  changes-first on every wake-up and a background listener before ending any
  turn (Claude side); forward-don't-answer and every-turn-ends-in-listen (Cursor
  side).
