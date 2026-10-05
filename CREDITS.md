# Credits

Agentic Grove exists because other people published their work and let others use it. This file
is written before the feature code, not after it, and it is a condition of the project rather
than a courtesy.

Every licence below was **read from the repository itself on 12 September 2026**, not taken on
trust from a project description. Where a repository has no licence file, that is stated plainly
and the consequence is stated with it.

---

## Code we use

### Station-Sciences/bot-crossing — MIT

<https://github.com/Station-Sciences/bot-crossing> · Copyright (c) 2026 Jarren Rocks

The one we owe the most to, and the original inspiration for this entire project.

**What we took:**

- `server/harnesses/` — the Claude Code, Codex and Cursor adapters, ported from JavaScript to
  TypeScript and living here as `core/harnesses/`. Close to a line-by-line translation: the file
  layouts, the caching strategy, the heuristics for deciding whether a session is running or
  waiting, and most of the hard-won comments explaining *why* each one is the way it is.
- `server/lib/fsutil.mjs` — the head/tail reading and JSONL-tolerance helpers, as
  `core/harnesses/fsutil.ts`.
- `server/scan.mjs` — the scan loop and the project-name disambiguation, as `core/scan.ts`.
- `server/harnesses/README.md` — the adapter contract. An unusually good document. Ours is
  adapted to our naming and keeps its structure and much of its wording.
- The **read-only discipline** towards other tools, which is now principle one of this project.
- The idea of an append-only `DECISIONS.md`, which this repo also keeps.

Because we copied substantial portions rather than merely reading them, MIT requires the
copyright notice to travel with the code. The full licence text is therefore kept in-tree at
[`core/harnesses/LICENSE-bot-crossing`](core/harnesses/LICENSE-bot-crossing), and every ported
file carries a header pointing at it.

**What we changed, and why it is not a criticism of the original:** we dropped its Windows and
Linux code paths, because this project is macOS-only and the removed branches were genuine
platform knowledge that would only rot here. Anyone wanting them should take them from
bot-crossing, where they are maintained. We also renamed its `Thread` to `Session`, which is the
word our brief uses. `core/harnesses/README.md` carries a field-by-field mapping so the two can
still be read side by side.

### Material Design Icons — Apache-2.0

<https://github.com/google/material-design-icons>

Icon set, if and where we use one. Not yet in the repository.

### Kay Lousberg asset packs — CC0

<https://kaylousberg.itch.io/> (found by way of bot-crossing)

Public-domain 3D kit pieces, available as placeholder geometry during the look-development
spike. Not yet in the repository. CC0 asks for nothing, which is exactly why it deserves a
mention here.

---

## Ideas we use, without taking code

### hoangsonww/Claude-Code-Agent-Monitor — MIT

<https://github.com/hoangsonww/Claude-Code-Agent-Monitor> · Copyright (c) 2026 - Now, Son Nguyen

**What we took: the idea, not the code.** It showed that Claude Code's hooks are the way to get
sub-second updates instead of a polled lag. The Grove's live updates (`core/hooks/`) follow that
approach but were written from scratch, so no code from it is in this repository.

If code from it is ever used, this entry moves under "Code we use" and gets the same treatment
as bot-crossing above: an in-tree licence file and per-file headers.

### matank001/clodfarm — MIT

<https://github.com/matank001/clodfarm> · Copyright (c) 2026 Duke Security, Inc.

A server-side "farm" of Claude Code agents. We read the whole repository at release 1.8.1 on
1 October 2026 (licence file read that day), as we did with bot-crossing and the projects above,
to see what it had worked out that the Grove had not. No code was copied.

**What we learnt and plan to use:**

- **Where Claude's official limits can be read.** Claude Code prints a `rate_limit_event` line in
  its `--output-format stream-json` output, carrying the five-hour and weekly figures. clodfarm
  reads it in `clodfarm/governor.py` and `clodfarm/runner.py`. That is the source for the Grove's
  press-to-check probe; see DECISIONS.md, "Official Claude limits: a probe you press, not the
  keychain".
- **A pace line.** Its budget governor spreads a weekly allowance over the week with one small pure
  function and gives a plain reason for every decision. A candidate for routing advice here.
- **A run as a folder of plain files** (what was started, its output, its exit code, a stop flag),
  so work survives the app restarting.
- **A stand-in `claude` for tests** that behaves over time (slow, failing, waiting), so a whole
  run can be checked without a subscription.
- **Schedules said in plain words** rather than as cron lines.

**What we deliberately did not take:** running agents with permission prompts switched off,
merging and pushing without review, probing usage on a timer, treating a missing figure as room
to spare, and sharing work across several people's accounts. Those suit an unattended server in a
container; the Grove runs on your own Mac, with your real files, and never invents a number.

### odysseus-dev/odysseus — AGPL-3.0-or-later

<https://github.com/odysseus-dev/odysseus> · Odysseus, the self-hosted AI workspace started by
PewDiePie ([pewdiepie-archdaemon](https://github.com/pewdiepie-archdaemon)) and built with its
contributors

A browser workspace for chat, agents, research, documents, email and local models. We read it on
6 October 2026 (licence file read that day) to see what it had worked out that the Grove had not.

**AGPL-3.0 is a copyleft licence: any of its code in the Grove would make the whole Grove AGPL.
So: ideas only, not one line of code.** Two projects Odysseus itself borrows from are MIT
(`anomalyco/opencode` and `AlexsJones/llmfit`); if the Grove ever uses them, the code comes from
those repositories directly, never from Odysseus's adapted copies.

**What we use:**

- **Security checks on every pull request**, explained in plain words: a secret scan, workflow
  linting, dependency review and CodeQL, with a table saying what each guards against and whether
  it blocks a merge. Ours are in `.github/workflows/security.yml` and `codeql.yml`, written for
  this repository; the table is in CONTRIBUTING.md.

**What we offer contributors, from the same reading** (CONTRIBUTING.md, "Also wanted: ideas from
Odysseus"): runs that always end in a word to you, a second try on a stronger model after a tell
(its "teacher escalation"), a look before PM hands web-read work to Builder (its approval gate
after untrusted content), a one-page threat model, a short "how it works now" map per area (its
`specs/`), an opencode adapter, and a landing page with a short clip per feature. Whoever builds
one writes it fresh; this entry then moves the idea under "What we use".

**What we deliberately do not take:** its everything-app scope (email, calendar, gallery), using a
ChatGPT plan by signing in as the Codex app, and a phone companion. The Grove is one calm cockpit,
on your own plan, on your Mac.

### Maciek-roboblog/Claude-Code-Usage-Monitor — MIT

<https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor> · Copyright (c) 2025 Maciej

MIT, so we *could* copy from it, but it is Python and we are not. What we take is the thinking:
the discipline of labelling every usage figure with its provenance — official, measured,
estimate or unknown — and the model of the rolling five-hour window. The principle that a dark
crystal facet beats a lying one comes from here.

### israriqbal/agent-ecologies — no licence file

<https://github.com/israriqbal/agent-ecologies>

**Checked on 12 September 2026: this repository has no `LICENSE` file.** Absent a licence, the
work is all rights reserved by default, and permission to copy has not been given. So: the
multi-model orchestration *concept* influenced our thinking, and **not one line of its code is
in this project.** If a licence appears later, this entry gets revisited.

### tobrun/dashboard-agent — no licence file

<https://github.com/tobrun/dashboard-agent>

**Checked on 12 September 2026: this repository has no `LICENSE` file.** Same position as above,
and worth stating just as plainly. No licence means all rights reserved, regardless of the code
being public and readable. **Ideas only. Not one line of code.** Reading a public repository for
inspiration is fine; copying from it without a licence is not, however small the fragment.

---

## Tools and libraries

The usual dependency tree, each under its own licence as declared in `package.json` — Electron,
Vite, React, TypeScript, and later Three.js with React Three Fiber, Zustand and Framer Motion.
`@electron/packager` (BSD-2-Clause) builds the Mac app for `npm run app` and `npm run dmg`; it is a
development tool only, and none of it ships inside the app.
They are credited by being declared, which is the convention, and no more is owed. The projects
above are named individually because they are people's side projects rather than infrastructure,
and because this project would not exist without them.

---

## If we have got this wrong

If you wrote something listed here and the attribution is inaccurate, the licence is stated
incorrectly, or you would rather it were credited differently — please open an issue and it
will be fixed as the next commit. If code of yours is here and you would rather it were not,
say so and it will be removed.

---

## Reference works

### Ogham inscriptions

The runestone inscriptions are words from the corpus of early Irish Ogham stones (fourth to
sixth century). Letter forms and the spellings and meanings of the words follow Damian McManus,
*A Guide to Ogam* (Maynooth, 1991). No text or images are copied from it; the letters are drawn in
code in `src/scene/runes.ts`.

### Concept art

The concept art in `assets/concept/` is AI renders made for this project, used as the target for
the scene's look. Nothing in the app is taken from it: the tree is modelled in Blender by
`scripts/build-world-tree-blender.py`, and everything else is drawn in code.
