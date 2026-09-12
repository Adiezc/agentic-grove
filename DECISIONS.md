# Decisions

Things that are settled, and why. **Append-only.** If a later session disagrees with one of
these, it is not necessarily wrong — but it has to argue with the *reason*, in a new entry at
the bottom, rather than quietly work around it or edit history.

The format is borrowed from bot-crossing's `DECISIONS.md`, for the reason it gives: the same
questions kept arriving one at a time, and answering them one at a time produced a codebase with
three answers to each.

Entries are dated. Anything undated predates the habit.

---

## The Grove writes `grove.json`. It may write another tool's config only with consent

*12 September 2026, session 1*

The brief carried a contradiction worth resolving before it became code. Principle one said
"read-only towards other people's tools — the Grove writes `grove.json` and nothing else", while
the architecture section called for installing Claude Code hooks, which necessarily means
writing to `~/.claude/settings.json`. A tool's own config is very much "somebody else's tool".

Both halves are right; the principle was just phrased too absolutely. So, precisely:

- **Another tool's session data, transcripts and records are never written to. No exceptions.**
  That is somebody's actual work, the Grove is a viewer, and an adapter that seems to need a
  write does not need one. bot-crossing learned this the hard way — it used to write one
  `isArchived` flag, the write landed on disk and still did not *mean* anything, because the
  desktop app serves from the copy it loaded at launch. Holding that together cost it a
  re-assert on every scan and a fake *pending* state. Their write-up is worth reading.
- **Another tool's config may be written**, because hooks are the entire difference between a
  cockpit that feels alive and one that lags a poll behind. But only: on explicit action, never
  on launch; showing the exact change before making it; reversibly, with an uninstall that
  restores what was there; and never silently on upgrade.

The distinction is meaningful because the first kind of write is invisible and destroys work,
while the second is visible, consented and undoable.

## MIT credit is a file in the tree, not a line in CREDITS.md

*12 September 2026, session 1*

We port bot-crossing's harness adapters close to verbatim. MIT permits that and asks one thing
in return: that the copyright notice and licence text travel *with* the copied code. A link in
`CREDITS.md` is courtesy; carrying the licence is the actual condition.

So the full text sits at `core/harnesses/LICENSE-bot-crossing`, and every ported file opens with
a header naming the original and pointing at it. Cheap, correct, and it means someone reading
`core/harnesses/` in isolation — which is exactly how they will read it if they vendor it
onwards — still knows where it came from.

The same treatment applies to anything taken from Claude-Code-Agent-Monitor later.

## Every licence is read from the repository, not from the brief

*12 September 2026, session 1*

Checking the five reference repositories rather than trusting the summary turned up one
difference that mattered. The brief described `israriqbal/agent-ecologies` as "licence unclear,
verify before copying". It has **no `LICENSE` file at all**, which is not unclear — absent a
licence, the work is all rights reserved and permission has simply not been given. It belongs in
the same category as `tobrun/dashboard-agent`: ideas only, not one line of code.

So licences get read from the repository, with the date of reading recorded in `CREDITS.md`, and
`CREDITS.md` is updated *before* code is taken rather than after.

## Status is a heuristic, and the code says so

*12 September 2026, session 1*

There is no API that reports "this agent session is running". It is inferred, and the honest
version of the inference is layered:

- **Measured.** `~/.claude/sessions/*.json` carries a real pid, and `process.kill(pid, 0)` is a
  true test of whether that process exists. This is the strongest signal available.
- **Inferred.** A recent file mtime plus a live process. A session paused mid-thought and one
  grinding away look identical on disk.
- **Inferred, and subtler.** A live process is *not* the same as work in progress: the CLI holds
  its process open while sitting at the prompt, and the desktop app pre-warms idle sessions. So
  the tail of the transcript is read to see whether the last assistant message called a tool
  (mid-turn) or called nothing (the turn is back with you, and the session is *waiting*, which
  for the Grove is a different colour entirely). This distinction is bot-crossing's and it is
  the single best idea in their adapter.

Per principle two, the scan output labels which kind each figure is instead of flattening them
into a confident boolean. A stone that glows "waiting" when it is actually thinking is a small
lie told every fifteen seconds.

## macOS only means the Windows and Linux branches go

*12 September 2026, session 1*

bot-crossing runs on three platforms, and roughly sixty lines of its adapters are that: MSIX
redirection of `%APPDATA%` for Microsoft Store installs, `XDG_CONFIG_HOME`, a table of Linux
terminal emulators and their flag conventions, drive-letter path decoding.

All of it is real, hard-won knowledge, and all of it is dead weight here. This project is
macOS-only by decision, the code has to stay readable by someone who is not a software engineer,
and platform branches that never execute cannot be tested and will rot silently.

So they are gone, and `CREDITS.md` says where to find them maintained. If the Grove ever wants
another platform, the right move is to take those branches from bot-crossing again rather than
to reconstruct them from memory.

## `Thread` becomes `Session`

*12 September 2026, session 1*

bot-crossing calls the unit of work a `Thread`, which is right in its world of astronauts and
also collides with the other thing "thread" means in a codebase. Our brief consistently says
*session*, which is also what Claude Code and Codex call them in their own files.

Renaming costs us easy diffing against upstream, which is a real loss if they fix a bug we
inherited. It is paid for with a field-by-field mapping table in `core/harnesses/README.md`, so
the two can still be read side by side.

## Codex subagent rollouts are not sessions

*12 September 2026, session 1*

Codex writes a rollout transcript for every thread, including ones a task spawned for itself —
its own review and guardian passes. On this machine they are a clear majority of the files on
disk. Their `session_meta` record names them: a `parent_thread_id`, a `source.subagent`, or a
`thread_source` that is not a plain user thread.

They are filtered out, because a runestone represents work a person is doing and a guardian
pass is the machinery of one session rather than a session of its own. bot-crossing filters the
equivalent rows out of Codex's database but not the loose transcripts; we filter both, because
we read the head of each rollout anyway.

The count is reported rather than hidden: "23 rollouts, 9 sessions, 14 subagent passes" is
useful, and a quietly shorter list is not.

## Cursor's adapter ships unverified, and says so

*12 September 2026, session 1*

Cursor is not installed on this machine — `~/.cursor` does not exist. The adapter is ported
anyway, because it is small and because the alternative is a gap that looks like a decision. It
will compile, `detect()` will return false, and it will contribute nothing.

What it will *not* do is guess. No file format is invented for a directory nobody has looked in.
It is marked unverified in `core/harnesses/README.md`, and the first person to run this with
Cursor installed should expect to fix it.

## Electron, not Tauri

*12 September 2026, brief, confirmed session 1*

Settled in the brief and worth recording with its reasoning, because it is the decision most
likely to be second-guessed by someone arriving later with an opinion about bundle size.

The Grove needs Node in-process for continuous file scanning and for spawning agents, a
menu-bar tray item, an always-on-top mini window, and native notifications. The entire
reference ecosystem is Node. Tauri would save something like 140MB of download and cost weeks of
Rust to reach the same place. Bundle weight is explicitly not a concern for an app that lives on
a third screen.

## The `claude` CLI is not on this machine, so the SDK is the spawn path

*12 September 2026, session 1*

The environment check found no `claude` binary anywhere — not on `PATH`, not in `~/.claude/local`,
not in `/opt/homebrew/bin`. The author runs the desktop app, which does not install the CLI.

The brief's section 4.3 assumed `claude -p --output-format stream-json` was available. It is
not, and session 9 should reach for `@anthropic-ai/claude-agent-sdk` instead — which is the
better answer regardless, since it gives a typed event stream rather than parsed stdout. Shelling
out stays a fallback for machines that do have the CLI, and must be feature-detected rather than
assumed.

## Machinery is recognised by what it is, not by not being on a list

*12 September 2026, session 1*

Both Claude Code and Codex write a transcript for every subagent they spawn for themselves. On
this machine that was 18 of 44 Claude transcripts and 17 of 23 Codex rollouts — in both cases
the majority of the files on disk. Each would have stood in the grove as a stone nobody had
ever typed at.

The first version of the Codex filter got this wrong in an instructive way. It asked whether
`thread_source` was one of the values known to be fine — `user`, `interactive` — and threw away
everything else. That would have silently hidden every `chatgpt_handoff` session: a real
conversation, handed over from ChatGPT, whose only crime was a `thread_source` nobody had
thought of yet.

So machinery is recognised positively, by carrying a `parent_thread_id` or a subagent marker in
its `source`. Checked across every rollout on this machine, those two signals agree perfectly
and neither ever appears on a session a person had. Recognising machinery by what it *is* fails
safely — a new kind of subagent shows up as a stone until we notice. Recognising it by absence
from a list of the known-good fails by hiding somebody's actual work, which is the failure you
do not find out about.

The Claude side needed no filter at all, as it happens: subagent transcripts are nested a folder
deeper, and reading one level deep excludes them structurally. That was luck rather than design,
so it is now written down in `scanTranscripts` — a future change to a recursive walk would
silently add eighteen stones.

## The scanner is checked against a second implementation, not against itself

*12 September 2026, session 1*

`npm run verify` counts the files on disk with its own code and complains if the scanner
disagrees with it. It deliberately does not import the adapters' helpers, because sharing them
would make the two agree by construction, which is the one thing a check must not do.

This is worth the duplication because the failure mode here is invisible. A grove showing six
agents when four are running looks exactly like a grove showing four, and nothing about it feels
wrong. The check found both bugs above within a minute of being written, having watched a
hand-read scan look entirely plausible for several minutes before that.

Both counts are asserted in a way that would fail rather than drift: the live Claude process is
checked by pid, and nothing may report `running` without one.
