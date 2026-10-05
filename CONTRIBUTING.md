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
