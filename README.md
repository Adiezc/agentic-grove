# Agentic Grove

A desktop interface for running and watching AI agents. It is meant to sit open on a third
screen all day while you work on your main screens: you glance over, see how many agents are
working and whether anything needs you, and look away again.

It is not a chat app. It is a cockpit.

**Status: early. Session one of a multi-session build.** Right now it scans your machine and
prints what it finds. There is no grove to look at yet.

macOS only. MIT licensed. No telemetry, ever — everything stays on your machine.

---

## What works today

```bash
npm install
npm run scan
```

Prints every Claude Code and Codex session on this machine: project, status, model, last
activity. Read-only. It does not touch a single file belonging to another tool.

## What it can and cannot see

This project tries hard not to lie to you. Some things are knowable and some are not, and the
interface is built to show the difference rather than hide it.

| Tool | What the Grove can do |
| --- | --- |
| Claude Code (CLI and desktop) | **Watch and drive.** See every session; spawn, resume and interrupt agents |
| Anthropic API (your own key) | **Drive, with exact accounting.** Per-call token counts and rate-limit headroom |
| xAI API (your own key) | **Drive, with exact accounting.** Runs Grove agents on Grok models |
| OpenAI API / Codex CLI | **Watch.** Token counts read from local session files, so estimated |
| Cursor | **Watch**, in principle. Adapter written but unverified — see `core/harnesses/README.md` |
| Claude Cowork | **Link only.** A cloud product with no local control surface |
| ChatGPT (consumer app) | **Link only.** No local control surface. Codex CLI is the drivable one |
| Grok Bot | **Link only.** No documented REST API, and it bills against its own usage pool |

"Link only" means the Grove can open it for you and nothing more. Those tiles are marked as
such in the interface. A figure the Grove cannot know honestly is shown as unknown rather than
guessed.

## Principles

1. **Read-only towards other people's tools.** The Grove never writes to another tool's session
   or transcript data. It may write to another tool's *config* — installing Claude Code hooks,
   for instance — only with your explicit consent, showing the exact change, and reversibly.
2. **Never invent a number.** Unknown is a valid and honest state. Every figure carries its
   provenance: official, measured, estimate or unknown.
3. **Minimal text.** If it can be a light, a colour or a movement, it should not be a word.
4. **Calm by default.** It is on screen all day. Nothing pulls the eye unless it has earned it.
5. **Credit generously.** This exists because other people published their work. See
   [CREDITS.md](CREDITS.md).

## Documents

- [CREDITS.md](CREDITS.md) — every project this borrows from, what was taken, under which licence
- [DECISIONS.md](DECISIONS.md) — append-only log of architectural decisions and why
- `core/harnesses/README.md` — the adapter contract, if you want to add support for another tool

## Licence

MIT. See [LICENSE](LICENSE).
