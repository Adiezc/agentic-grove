# Agentic Grove

A desktop interface for running and watching AI agents. It is meant to sit open on a third
screen all day while you work on your main screens: you glance over, see how many agents are
working and whether anything needs you, and look away again.

It is not a chat app. It is a cockpit.

**Status: early, and changing quickly.** The grove shows your real projects and agent sessions,
live, with usage headroom per provider. Sending agents to work from inside the Grove is next.

MIT licensed. No telemetry, ever.

## Where it runs, and what it works with

| | |
| --- | --- |
| **macOS** (Apple Silicon) | Supported. This is the only platform today. |
| **Windows** | Not yet. Planned; several pieces (setup, hooks, packaging) are Mac-specific for now. |
| **Linux** | Not yet. Likely before Windows, since most of the Mac code carries over. |

The Grove works with the two AI providers most people use today: **Claude** (the Claude app,
Claude Code, Cowork) and **ChatGPT** (the ChatGPT app, Codex, Dots). Ideally you have the Claude
or ChatGPT desktop app as well as the command-line tools; if something is missing, the first-launch
walkthrough and Settings help you get it in a click or two.

Those two are a starting point, not a wall. Other providers and locally run models (Ollama, LM
Studio and the like) can be added: each tool the Grove understands is one small adapter in
`core/harnesses/`, and the contract is in its README. Contributions are welcome.

---

## Getting started

```bash
git clone https://github.com/Adiezc/agentic-grove.git
cd agentic-grove
npm install
npm run dev
```

On first launch Researcher walks you through the grove. If Claude Code or Codex is missing, the
second card has a Set up button for each: it opens Terminal, runs the maker's official installer,
then asks you to sign in. You can do the same later in Settings.

Downloadable builds will appear under [Releases](https://github.com/Adiezc/agentic-grove/releases).
They are not signed with an Apple certificate, so the first time you open one, macOS asks you to
confirm: right-click the app, choose Open, then Open again.

## What it can and cannot see

This project tries hard not to lie to you. Some things are knowable and some are not, and the
interface is built to show the difference rather than hide it.

| Tool | What the Grove can do |
| --- | --- |
| Claude Code (terminal and desktop) | **Watch, and soon drive.** Every session, live through its hooks |
| Codex | **Watch, and soon drive.** Every session, with OpenAI's own five-hour and weekly figures |
| Claude Cowork | **Link only.** Everyday work in the Claude app; the Grove opens it |
| ChatGPT Dots | **Link only.** OpenAI's always-on agents; no public API yet |
| Cursor | **Watch**, in principle. Adapter written but unverified; see `core/harnesses/README.md` |

"Link only" means the Grove can open it for you and nothing more, and the interface shows those
as loose fireflies rather than agents on the tree. A figure the Grove cannot know honestly is shown
as unknown rather than guessed.

## Privacy and the network

Everything the Grove reads stays on your Mac. It sends nothing about you, your projects or your
usage anywhere. The one network request it makes by itself is **checking for updates**: once a
day, while you are online, it asks GitHub's public releases page for the newest version number.
That request carries no identifier. It exists so you can hear about new versions, and you can turn
it off in Settings. The Grove never installs anything by itself; you download new versions when
you choose.

Your grove (projects, agents, settings) lives in `~/.agentic-grove/grove.json`, outside the app,
so an update never touches it. It is plain JSON and meant to be edited by hand if you like.

## For contributors

```bash
npm run scan     # print every agent session on this machine
npm run watch    # the same thing on the live poll loop
npm run verify   # check the scanner against the raw files, independently
npm run verify:routing  # the Manager's rules for which tool takes which job
npm run typecheck
```

`verify` is the one worth knowing about. It counts the files on disk with its own separate code
and fails if the scanner disagrees, because a wrong number looks exactly like a right one.

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
- [ROADMAP.md](ROADMAP.md) — the build plan, and ranked ideas for future sessions
- `core/harnesses/README.md` — the adapter contract, if you want to add support for another tool

## Licence

MIT. See [LICENSE](LICENSE).
