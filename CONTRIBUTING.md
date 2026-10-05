# Contributing

Contributions are welcome. Open an issue first for anything larger than a small fix, so we can
agree on the approach before you spend time on it.

## Most wanted: a Windows version

The Grove runs on macOS only. **A Windows port is the single most useful thing you could
contribute**, and the maintainer has no Windows machine to build or test one. If you use Windows
and know (or want to learn) Electron, this is yours to take.

Most of the app is already cross-platform: the scanner, the scene, `grove.json`, routing and the
interface are plain TypeScript and Electron. The work is in the places that talk to macOS. A rough
estimate is 10 to 14 hours. The pieces, as far as we know them:

| Area | Where | What is Mac-specific today |
| --- | --- | --- |
| Finding sessions | `core/harnesses/claude-code.ts` | The Claude desktop app's sessions under `~/Library/Application Support/Claude/`. Find the Windows equivalent (probably under `%APPDATA%`). |
| Finding the tools | `core/setup.ts` | Where `claude` and `codex` live (`/opt/homebrew`, `/usr/local`, the Claude app bundle) and the login-shell `command -v` lookup. |
| Starting agents | `core/spawn/launch.ts` | Writes a `.command` script and opens it in Terminal. Needs a Windows Terminal or PowerShell equivalent, with the same care about quoting (read the file's header first). |
| One-button setup | `core/setup.ts`, `electron/main.ts` | The install and sign-in scripts open in Terminal. |
| Claude Code hooks | `core/hooks/` | The hook commands written into Claude Code's settings assume a Unix shell. |
| Tray, notifications, window | `electron/` | The menu-bar shard, `titleBarStyle: 'hiddenInset'`, and focus behaviour. |
| Packaging | `scripts/package.mjs` | Builds a `.app` and `.dmg`. Needs an `.exe` installer and an `.ico` icon. |
| Secrets | (none stored yet) | The plan is the macOS keychain for any API key. On Windows, use Electron's `safeStorage`. |

The checks under `test/` (`npm run verify`, `npm run verify:spawn` and the rest) should pass on
Windows too; they are the quickest way to see what breaks. Please keep these rules:

- **Read-only towards other tools.** Never write another tool's sessions or transcripts.
- **Never invent a number.** Unknown is a valid answer.
- **No telemetry.** Everything stays on the machine.

A Linux version is welcome too, and is probably smaller, since most of the Mac code carries over.

## Also wanted: ideas from Odysseus

These came from reading [Odysseus](https://github.com/odysseus-dev/odysseus), the self-hosted AI
workspace started by PewDiePie. **Odysseus is AGPL-licensed, so please do not copy its code:**
any of it here would force the whole Grove to change licence. Take the idea, write it fresh for
the Grove, and say in your pull request that you did. Details in [CREDITS.md](CREDITS.md).

Each one is open to whoever wants it. Comment on or open an issue first so two people do not build
the same thing. Times are rough, for someone who has read the files named.

### 1. Runs that always end in a word to you (2 to 4 hours)

A job the Grove started should never just go quiet. Today `core/attention.ts` tells you when a run
fails, finishes after a minute or more, or (if switched on) needs you. Not covered: a run that was
working and **ended without finishing** (Terminal closed, Claude Code crashed), and one that says
"running" but has had **no hook and no transcript movement** for a long time. Both should end in
one quiet notice. Runs and their states are in `core/spawn/runs.ts`; add the cases to
`test/verify-attention.ts`. Odysseus's `bg_monitor` has the rule worth keeping: a job is marked
"told" only after the telling worked, so a crash means a retry, never silence.

### 2. A second try on a stronger model, after a tell (half a day)

Tells (`core/harnesses/claude-tells.ts`) already flag work that looks unsure: the same tool failing
three times, an edit undone, a turn ending on an error. When a run on a lighter model shows a tell,
offer one quiet option beside it in the stone's panel (`src/hud/Flow.tsx`): **try again on a
stronger model** (Haiku or Sonnet to Opus, or the other provider). Models live in `core/models.ts`,
and routing already skips a used-up allowance (`core/routing.ts`). Rules: an offer, never automatic;
say which model and what it costs in allowance before anything is sent. Odysseus calls this
"teacher escalation".

### 3. A look before PM hands web-read work to Builder (half a day, plus a decision)

Researcher can read the web (`core/spawn/briefs.ts`). Web pages can carry instructions aimed at
agents. If Researcher read the web during a PM job, PM's next hand-off to Builder, which changes
files, should show you the plan and wait for a yes, even on a small job. Two routes: a rule in PM's
brief (cheap, but only a request to the model), or a Claude Code `PreToolUse` hook that answers
"ask" when a session that fetched the web starts a subagent (a real gate, but the Grove's hook
would answer back for the first time, which needs its own consent; see DECISIONS.md). Please open
an issue to agree the route before building.

### 4. A one-page threat model (2 to 3 hours, no code)

`THREAT_MODEL.md` at the root: what the Grove trusts, what it defends against, and its known gaps,
in one page. The material exists: `electron/security.ts`, the hook listener in `core/hooks/`, the
launcher's quoting rules in `core/spawn/launch.ts`, and DECISIONS.md, "The window's walls". Odysseus's
`THREAT_MODEL.md` is a good shape to follow: trust boundary, a table, numbered known gaps.

### 5. A short "how it works now" map per area (a day, no code)

`DECISIONS.md` records *why*, and is long. A `docs/specs/` folder with one short file per area
(scan, hooks, spawn, usage, state, scene, interface) would say *what is true now*: which file owns
what, how it behaves, how it fails. Each starts with the commit it was checked against, and an
index says which file to open for which job. Code wins when the two disagree. It lets a new
contributor, or a coding agent, read only what the task needs.

### 6. An adapter for opencode (a day, needs opencode on a Mac)

[opencode](https://github.com/anomalyco/opencode) is a popular open coding agent, MIT-licensed and
written in TypeScript. Each tool the Grove understands is one adapter in `core/harnesses/`; the
contract is that folder's README, and `cursor.ts` is the smallest example. Find where opencode keeps
its sessions on a Mac and read them **read-only**, like every other adapter. Please test against real
opencode sessions: the Cursor adapter, written without any, is still untested.

### 7. A landing page with a short clip per feature (a day)

A GitHub Pages site: what the Grove is, a muted few-second clip for each thing it does (demo mode
is `?demo` in `npm run dev`; photo mode is P), the download link, and what you need. Use the
screenshots in `assets/screenshots/` as the visual standard. No analytics, no trackers, no outside
fonts: the Grove has no telemetry, and its page should not either.

## Other good places to start

- **More tools and models.** Each tool the Grove understands is one adapter in `core/harnesses/`;
  the contract is in that folder's README.
- **Bugs.** Open an issue with what you did, what you expected and what happened.

## Working on the code

```bash
npm install
npm run dev        # the interface in a browser; add ?demo to the address for sample data
npm run scan       # print every agent session on this machine
npm run watch      # the same thing on the live poll loop
npm run verify     # check the scanner against the raw files, independently
npm run typecheck
npm run app        # build the Mac app into ~/Applications
npm run dmg        # build release/Agentic-Grove-<version>-arm64.dmg for a GitHub release
```

Each part with rules of its own has a `verify:` script beside it (`routing`, `spawn`, `console`,
`attention`, `health`, `places`, `readiness`, `reliability`, `pairings`, `tells`, `probe`,
`history`, `codex-usage`, `twins`, `suggest-runes`, `notes`, `models`, `security`); they run in
seconds and touch nothing of yours. GitHub runs all of them on every push, except `verify`, which
needs the agent sessions on a real Mac.

`verify` is the one worth knowing about. It counts the files on disk with its own separate code
and fails if the scanner disagrees, because a wrong number looks exactly like a right one.

## The checks GitHub runs

Every pull request, every push to `main`, and (for the security ones) once a week. You do not
start them; a red cross on your pull request means one needs a look.

| Check | What it protects against | Blocks a merge? |
| --- | --- | --- |
| **CI** (`ci.yml`) | A change that breaks the types, the build or any `verify:` rule | Yes |
| **Secret scan** (gitleaks) | An API key, token or password committed by mistake, even if a later commit deleted it | Yes |
| **Workflow files** (actionlint, zizmor) | A broken automation file, or one that could leak the repository's access token | Yes |
| **New dependencies** (dependency review) | A pull request that adds a library version with a known high or critical hole | Yes |
| **npm audit** | Known holes in the libraries already used, Electron included | No, it warns |
| **CodeQL** | Real bugs in the Grove's own code: paths escaping their folder, text reaching a shell | No, findings go to the Security tab |

Every action in those files is pinned to an exact commit, not a movable tag, and Dependabot
proposes updates monthly. To run the same checks on your Mac first:

```bash
brew install actionlint zizmor gitleaks
actionlint && zizmor .github && gitleaks git --redact .
```

The idea for these checks, and for this table, came from Odysseus; see [CREDITS.md](CREDITS.md).

Comments explain *why*, in full sentences, and plain code beats clever code. Match the files
around the one you are changing.
