# Harness adapters

A **harness** is whatever runs the agent sessions you want to see in the grove — Claude Code,
Codex, Cursor, and so on. The Grove does not care which one you use: it asks every harness
present on the machine for its sessions and draws whatever comes back.

> Adapted from the adapter contract in
> [Station-Sciences/bot-crossing](https://github.com/Station-Sciences/bot-crossing) (MIT), whose
> `server/harnesses/README.md` is an unusually good document and is worth reading in the
> original too. The licence is in [LICENSE-bot-crossing](LICENSE-bot-crossing); what was taken
> and what was changed is in [CREDITS.md](../../CREDITS.md).

Adding one is meant to be **one new file in this directory**, plus one line in `index.ts`.
Nothing in `core/scan.ts`, nothing in `electron/`, and nothing under `src/` should need to
change. If you find yourself editing those to land a harness, that is a bug in this seam —
please say so in the issue or PR, because the next person will hit it too.

## The shape of it

```ts
// core/harnesses/my-harness.ts
import type { HarnessAdapter } from './types.ts'

const adapter: HarnessAdapter = {
  id: 'my-harness',         // stable, kebab-case, used as a key and an id prefix
  name: 'My Harness',       // what a person sees
  detect,                   // () => Promise<boolean>
  scanSessions,             // () => Promise<Session[]>
  openSession,              // (ref) => OpenResult
  newSession,               // (dir) => OpenResult
  diagnostic,               // optional: () => Promise<string>
  paths: { … },            // where you look, for the scan command to print
}

export default adapter
```

Then in `index.ts`:

```ts
import myHarness from './my-harness.ts'
export const HARNESSES: HarnessAdapter[] = [claudeCode, codex, cursor, myHarness]
```

The full interface, with the reasoning for each field, is in [`types.ts`](types.ts). Read that
before this.

### `detect()`

Is this harness on this machine at all? Usually just "does its data directory exist". Keep it
cheap — it runs on every scan, so that installing a tool while the Grove is open is noticed on
the next poll rather than at the next restart. Returning `false` means the harness is skipped
entirely and no stone for it ever appears. Throwing is read as `false`.

### `scanSessions()`

The real work: return one `Session` per session the harness knows about.

Throwing is survivable — the scan loop catches it, records it in `problems`, and carries on with
the other harnesses, so one broken adapter costs you its own sessions and nothing else. Prefer
throwing over returning something invented.

Leave `harness` and `harnessName` blank. The scan loop fills them in, which saves an adapter
from having to know its own name twice.

### `openSession(ref)` / `newSession(dir)`

Return `{ ok: true, url }` and the URL goes to the OS opener. `openSession` gets the `ref` from
the session it belongs to; `newSession` gets an absolute directory.

If your harness has no deep link, return `{ ok: false, error: '…' }` and say why. The interface
shows the message rather than pretending the click worked — see `cursor.ts`, which has no
per-session link and says so in a sentence a person can act on.

Treat `ref` as untrusted by the time it arrives: it has been through the renderer. Pattern-check
any id before it reaches a URL.

### `diagnostic()` — optional, and worth having

Why a harness that is plainly installed might still look thin. Without somewhere to say it, that
failure is invisible: sessions quietly lose their titles and nothing explains why. `codex.ts`
uses it to report that the Node running the scan is too old to read Codex's database; `cursor.ts`
uses it to admit it has never been run against real data.

### There is no `setArchived`, and that is deliberate

The Grove does not write to a harness. Not the transcripts, not the session records, not one
flag. An adapter *reports* the `archived` field and that is the whole of its involvement.

bot-crossing learned this the hard way, and their write-up is worth reading. They used to write
one `isArchived` flag onto Claude Code's own session record. The write landed on disk and still
did not *mean* anything: the desktop app serves from the copy it loaded at launch, so an archived
session stayed in its list until the app restarted, and the app rewrote the record from memory
the next time it touched it. Holding that together took a re-assert on every scan, a process
sweep to guess whether the app had re-read the file, and a fake *pending* state for the gap
between them.

Archiving in the harness's own interface still works and is still the right way to do it. Your
adapter reports it and the stone goes quiet on the next poll.

## Ground rules

These are inherited from bot-crossing and they are not negotiable. Each one is a scar.

- **Read-only. No exceptions.** A harness's transcripts and records are somebody's actual work.
  The Grove is a viewer. If an adapter seems to need a write, it does not — open an issue.
- **Never read from or execute anything inside another application's bundle.** Only files under
  the user's own home directory. bot-crossing has a Gatekeeper story about this that ends with
  two applications in the Trash: running a binary out of somebody else's `.app` is how you get
  the OS blaming you for it.
- **Never block the scan.** It runs on a timer, all day. Cache anything expensive against file
  mtime — see `transcriptMeta` in `claude-code.ts`, which is what keeps a 27MB transcript from
  being reparsed every few seconds.
- **Read heads and tails, not whole files.** `readHead` and `readTail` in `fsutil.ts` pull one
  chunk and drop the partial line at the cut, so `JSON.parse` never sees half a record.
- **Expect malformed data.** A session being written *right now* is the normal case, not the
  exception. Skip that record and move on; never throw the pass away over one bad line.
- **Never widen an id collision.** The Grove keys everything it remembers about a session on
  `id`. Two harnesses handing back the same id would merge two unrelated sessions into one.
  Prefix yours with your harness id.
- **Say how much you know.** Every status carries a `Provenance`. If your harness records no
  focus history, `unreadProvenance` is `'unknown'` — not `'measured'` with `unread: false`.
  "I cannot tell" and "no" are different answers and the grove renders them differently.
- **Machinery is not a session.** Both Claude Code and Codex write transcripts for subagents
  they spawned for themselves. On the machine this was written on those were 18 of 44 Claude
  transcripts and 17 of 23 Codex rollouts. Each would stand in the grove as a stone nobody has
  ever typed at. Filter them, and recognise them by what they *are* — a parent id, a subagent
  marker — rather than by not being on a list of the kinds you know about.

## Mapping to bot-crossing's `Thread`

If you are reading this next to bot-crossing's adapters, the names differ. Our brief says
*session* throughout, and so do Claude Code and Codex in their own files, so `Thread` became
`Session` (see DECISIONS.md). Everything else is either the same field or a deliberate change:

| bot-crossing | here | note |
| --- | --- | --- |
| `Thread` | `Session` | rename only |
| `scanThreads()` | `scanSessions()` | rename only |
| `openThread()` | `openSession()` | rename only |
| `running` / `unread` / `hasError` booleans | `status` + `statusProvenance` | three booleans that could contradict each other become one enum: `running`, `waiting`, `idle`, `errored`, plus how much to trust it |
| — | `waiting` status | bot-crossing computes the same thing via `awaitingReply` and reports it as `unread`; the grove needs it as a state of its own, because a stone waiting for you is a different colour from one working |
| — | `statusProvenance`, `unreadProvenance` | new. Principle two of this project |
| `lastFocusedAt: 0` meaning unknown | `unreadProvenance: 'unknown'` | said out loud rather than encoded in a zero |
| `starred`, `routine`, `prState` | dropped | bot-crossing's own interface needs them; nothing in the grove reads them yet. Easy to add back |
| `harness`, `harnessName` | same | still filled in by the scan loop |
| `ref` | same | still opaque, still round-trips through JSON |
| Windows and Linux paths | dropped | macOS only. See DECISIONS.md; take them from bot-crossing if you need them |

## Checking your work

`npm run verify` is the real test, and it is worth understanding what it does: it counts the
files on disk with *its own* code and complains if the scanner disagrees with it. Two
implementations that agree are worth far more than one that looks convincing, so when you add a
harness, add its reconciliation there too — the count it should produce, and why.

Beyond that:

1. `npx tsc --noEmit` — the adapter has to satisfy `HarnessAdapter` with no casts.
2. `npm run scan` — your harness should appear in the list at the top with a session count. If
   it says "not installed on this machine" when it plainly is, stop there: nothing else will
   work until `detect()` finds it.
3. Check the numbers against the tool itself. Open your harness, count what it lists, and make
   them match. If they do not, the scanner is wrong — fix it rather than adjusting what you
   expected.
4. `npm run watch` leaves the poll loop running. Start a session in your harness and it should
   appear within a few seconds; finish it and the status should change. This is the one that
   catches a cache keyed on the wrong thing.
5. Then, and only then, look at it in the grove.

## Starting points

Verified on a real machine, on the date given:

- **Claude Code** *(12 September 2026)* — desktop records one per session in
  `~/Library/Application Support/Claude/claude-code-sessions/<account>/<org>/local_*.json`; CLI
  transcripts in `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`; live processes, with a
  real pid, in `~/.claude/sessions/*.json`. **Subagent transcripts are nested one level deeper**,
  in `<encoded-cwd>/<parentSessionId>/subagents/agent-*.jsonl`, and reading only the top level is
  what keeps them out.
- **Codex** *(12 September 2026)* — one row per session in `~/.codex/state_<n>.sqlite`, which is
  undocumented private state whose schema changes between versions, hence the column probing in
  `codex.ts`. Transcripts in `~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl`, records
  shaped `{ timestamp, type, payload }`. Note that the rollout's filename UUID is not the same
  as its `payload.session_id`; the database joins on the filename one.
- **Cursor** *(unverified)* — `~/.cursor/projects/<encoded-cwd>/agent-transcripts/<uuid>/<uuid>.jsonl`,
  per bot-crossing. Not installed on the machine this was written on, so `cursor.ts` has never
  been run against real data. If you have Cursor, you are the first person to test it.

For anything else, the fastest way in is to start a throwaway session in that tool and watch
which files change:

```bash
find ~ -maxdepth 4 -newermt '-2 minutes' -type f 2>/dev/null | grep -iv Library/Caches
```
