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

---

## `grove.json` stores intent, never state

*12 September 2026, session 2*

Runestones are derived fresh from the sessions on disk on every scan. `grove.json` holds only
what the user has *decided*: that a stone is hidden, that it should be called something else, the
runes carved on it, the agent definitions in the tree. Normally its `stones` array is empty.

The alternative — writing a stone record the first time a project is seen — was the obvious
design and is worse in a way that compounds. It creates a second copy of the truth that has to
be kept in step with the disk, and then every question about a moved, renamed or deleted
repository becomes a reconciliation problem. bot-crossing's `isArchived` story is the same
lesson from the other side: state you write about somebody else's data is state you then have to
defend.

Deriving instead means a new project simply appears, a deleted one simply goes, and there is no
stale-record class of bug at all. It also keeps the file small enough that the brief's
requirement — a person can edit it by hand — stays true rather than aspirational.

Wisps are not in the file for the same reason, only stronger: a wisp is one-off work that fades
when it is done. Persisting one would fill the grove with debris from finished work.

## Scratch workspaces and the home directory go to the Wildwood

*12 September 2026, session 2*

Four Claude desktop scratch workspaces and one session run from `~` were, on this machine, about
to become five monoliths — one of them named after the home folder, the others called things like
`scratch-2026-09-03-bc2de4`. They pass the brief's test for permanent scenery, "has a directory
on disk", and fail the spirit of it completely.

They are real work with no project home, which is precisely what the Wildwood is for. So both
patterns are assumed into it, and the assumption is beatable in both directions: `"wildwood":
true` sends a real project there, and `"wildwood": false` insists a scratch folder really is a
project. The assumption is also *stated* in the interface — the Wildwood says why each resident
is there — because an assumption you cannot see is indistinguishable from a bug.

The pattern list is deliberately short and deliberately specific. A general rule like "folders
with a uuid in the name" would eventually swallow somebody's actual repository.

## An error stops being an alarm after a day

*12 September 2026, session 2*

`running` and `waiting` are already bounded by recency inside the adapters, but `errored` is
sticky: a session that failed last Tuesday still reports `errored` today, because that is
genuinely what its transcript says. Left alone, one old failure lights a stone red for ever, and
a grove with a permanent red stone in it teaches you to ignore red — which costs you the next
real one.

So after `ERROR_ALARM_MS`, a day, an error stops setting the stone's colour. The session still
reports it; nothing is thrown away and nothing is rewritten. Only the alarm decays.

A day rather than an hour because it has to survive overnight: something that broke while you
were asleep should still be red when you sit down. This is the number in the project most
obviously chosen rather than derived, and it should be revisited once the grove is on screen and
the effect can actually be judged.

## The bridge is push, whole snapshots, and types-only

*12 September 2026, session 2*

Three choices about the seam between node and the interface, all made once so they do not get
argued per-feature.

**Push, not pull.** The node side scans on its own timer and sends the result; the renderer
subscribes. A renderer polling on its own interval means two clocks to keep in step and a window
that is always up to half a poll out of date.

**Whole snapshots, not diffs.** A few tens of kilobytes every few seconds, and in exchange the
renderer can never drift out of step with the disk: there is no patch to mis-apply and no resync
path to get wrong. If this ever becomes a real cost, the honest fix is scanning less often, not
inventing a protocol.

**`bridge.ts` carries types only, no runtime imports.** The renderer needs the shape of a
snapshot and must never pull in anything that imports `electron`, which is how a renderer bundle
ends up trying to `require('electron')` in a browser context. And `ipcRenderer` itself is never
exposed — only named functions — because handing it over exposes every channel in the app,
including ones added later by somebody who had not thought about it.

## The scan loop belongs to the main process

*12 September 2026, session 2*

Not to a React component, and not to the renderer at all. The Grove is meant to keep watching
with its window closed, sitting in the menu bar with a tray shard — that is most of the point of
it. A loop owned by the main process survives the window closing; one owned by a component does
not, and discovering that in session seven would mean moving it then.

The main process also keeps the latest snapshot and sends it to any window on `did-finish-load`,
so a window opening just after a scan draws immediately rather than showing an empty grove for a
full interval.

## Writes to `grove.json` are atomic, and nothing is written unasked

*12 September 2026, session 2*

Write to a temporary file in the same directory, then rename over the original. A rename within
one filesystem either happens or does not, so a crash or a full disk mid-write cannot leave a
half-written grove. Truncating the real file and writing into it is how people lose
configuration, and this is the only file this project writes.

Separately: loading a missing `grove.json` does not create one, and loading a malformed one does
not rewrite it. The Grove runs on defaults and says what it could not read, per entry, in terms
the person who typed it can act on. Both alternatives are bad — refusing to start over a stray
comma costs you the application, and quietly "fixing" the file throws away what you meant.

The renderer is never allowed to name a file for the node side to act on. `revealGroveFile`
resolves the path on the node side; `openSession` hands its `ref` to the adapter, which
pattern-checks every id before anything reaches the OS opener.

## The ugly list is not designed, on purpose

*12 September 2026, session 2*

`src/App.tsx` and `src/index.css` exist to prove the chain works on real data and are expected
to be deleted when the scene arrives. There is exactly enough CSS to make the list legible, and
one colour — a stone that wants you is findable while scrolling, because that is the premise of
the whole app.

Styling it further would be work thrown away, and worse: a half-styled debug view is the easiest
way to start quietly accepting a look nobody chose, which is the one thing the look-development
spike exists to prevent.

---

## The camera angle is derived from the concept art, not chosen

*13 September 2026, session 3*

The ground rings in `assets/concept/grove-main.png` are about 0.24 as tall as they are wide. A
circle on the floor projects to an ellipse of that ratio when the camera sits roughly 14 degrees
above the plane, so that is where the camera sits, at a 28 degree field of view about 15 units
back.

Worth writing down because the obvious choice is wrong in an interesting way. A 45-degree
isometric view is what these scenes usually end up being, and it produces a completely different
picture: you look down *onto* a diagram. The low angle is most of why the art reads as standing
in a clearing rather than inspecting a map, and it was the single most important number in the
session.

## The palette is sampled, never typed

*13 September 2026, session 3*

Every colour in `src/theme/palette.ts` was read out of the concept art with a colour picker. The
fastest way to drift off a visual direction is to type a green that feels about right.

Three things the sampling caught that guessing would not have:

- **The ground is nearly black.** `#020904`, covering about four-fifths of the image. Not dark
  green — black with a green bias.
- **The monoliths are darker than the background is bright.** `#000f05`. They are silhouettes lit
  only by their own rune and a rim, not glowing objects.
- **The text is grey.** `#c8c7ca`, not green. Green is reserved for *state*.

That last one turned out to be the rule that keeps the whole thing calm enough to leave open all
day: green means something is alive, grey means it is a label. It is principle four in colour
form, and it came from a colour picker rather than from taste.

## Four rendering mistakes, and what each one taught

*13 September 2026, session 3*

The first render was badly wrong and the fixes are worth recording, because each was a general
lesson rather than a tweak.

**Additive blending sums past white.** The canopy was six hundred translucent quads each *adding*
light, which saturates long before the edge of a pad, so it rendered as glowing clouds. Foliage
needs normal blending and depth writing, so a leaf occludes the leaf behind it. A small bright
minority — every twelfth leaf, additive — gives the sparkle without the mass going white.

**A view-dependent term on a flat face is a constant.** A fresnel rim was meant to pick out the
silhouette edges of the stones; on a six-sided prism, where each face has one normal, it lit
whole panels and the stones came out as grey road signs. Pointing the normals radially outwards,
as if the prism were a cylinder, makes the shading sweep around the stone: black where a face
turns towards you, bright along the edge where it turns away.

**Things bury each other.** The entire mycelial network was invisible for two renders because it
ran at y = 0.014 underneath a dais whose top face was at 0.06. Two constants in two files that
had to agree and did not.

**A rune carved on one face is invisible from behind.** Five of the six stones had their backs to
the camera. Stones now turn to face the viewer by default, with the per-stone `turn` as a
deviation from that rather than an absolute rotation — which is also the correct behaviour for
the real thing, since the entire premise is that one look tells you everything.

## Never trust a frame rate you have not seen settle

*13 September 2026, session 3*

The spike reported 39fps, then 1fps, then 3fps, and every one of those numbers was false. Two
separate causes, both worth knowing:

- **A sample taken after a hot reload measures shader compilation**, not the scene.
- **A sample taken while the window is hidden measures the browser's background throttle.** A
  hidden tab gets one animation frame per second, and the counter faithfully reported that.

Chasing the first false reading nearly led to gutting the floor reflections, which were never the
problem. What settled it was instrumenting rather than optimising: draw calls and triangle counts
alongside the rate, because a scene at 3fps with 60 draw calls and 40,000 triangles is not heavy,
it is broken, and knowing which decides everything about what you do next.

The honest figure, measured in Electron on an M4 after the scene had settled: **59 fps, 219 draw
calls, 80,000 triangles, 18 shader programs.** And the reading that matters more: the `low`
preset, with half the draw calls and half the triangles, also renders at 61fps. The scene is
capped by the display's refresh rate, not by the GPU, so there is real headroom in hand.

## Merge anything static that shares a material

*13 September 2026, session 3*

The scene reached 327 draw calls before anyone looked at why, and almost none of it was the tree
or the stones: it was fifty-odd individually drawn roots, filaments, ground rings and nodes, each
a few hundred triangles. A draw call costs about the same whether it draws 50 triangles or 5,000.

Merging the static ground layer and sharing one material across all six stones took it to 219.
The stones themselves stay separate meshes because each is hovered, lit and rotated on its own —
merging those would trade a real interaction for a saving that is not needed.

## Development tooling earned its place in the repo

*13 September 2026, session 3*

Three small things went in that are not features, and each paid for itself inside the session:

- **The renderer's console is forwarded to the terminal in development.** On an app whose whole
  front end is a 3D scene, a shader that fails to compile looks exactly like a scene that is
  meant to be dark.
- **A still capture**, on the `s` key or `VITE_GROVE_CAPTURE=1`. Judging a look means putting a
  still beside the reference, and "take a screenshot yourself" is not a workflow.
- **`VITE_GROVE_QUALITY`**, so each preset's cost can be measured on a cold launch rather than by
  pressing a key and hoping the reading settles.

All three are development-only. The capture handler is not even registered in a packaged build,
since a shipped app has no reason to be able to write PNGs of itself.

---

## The roots and the mycelium are one generator, not two

*13 September 2026, session 4*

The first render had the tree's roots and the grove's mycelium built by different files out of
different curves, and they met nowhere: the roots stopped in a tidy flare at the trunk and the
mycelium started as six separate squiggles somewhere out on the floor. It read as a tree standing
on a diagram.

`network.ts` now grows the whole thing in one recursive walk from the trunk base — the dense delta
on the dais and the long runs out to the stones are the same organism at two distances — and
`WorldTree` and `Mycelium` draw parts of one result. They cannot drift apart because there is
nothing to drift.

The part worth stealing is how a pulse travels it. Every strand records **where along its stone's
journey it sits**, and that number is baked into the `v` texture coordinate. A fork two thirds of
the way out carries `v ≈ 0.66`. One travelling window in the fragment shader then lights the root,
then the forks it passes, then the forks off those, in order, with no per-fork state and no work on
the CPU at all — one uniform per stone per frame for a network of about two hundred strands.

## Everything on the floor is drawn twice

*13 September 2026, session 4*

A root in the concept art is not a green tube lying on stone. It is a hair-thin, nearly white line
with a soft wash of green bleeding out of it onto something wet. Drawn as a tube alone you get the
line and none of the wash, and the floor reads as green spaghetti; drawn as a wash alone there is
nothing to look at.

So each strand is a tapered tube for the hot core plus a flat ribbon under it, roughly fourteen
times wider, at very low opacity. That second layer is most of what makes the scene look wet, and
it costs almost nothing — the ribbons for the whole network merge into one mesh per stone.

One trap: the ribbon has to be built with a fixed world up-vector rather than the curve's own
binormal. A Frenet frame rolls wherever the curve dips, which stands the ribbon on its edge — and a
ribbon on edge at a fourteen-degree camera is invisible.

## Wood is a dielectric, and the metalness slider is a trap

*13 September 2026, session 4*

Three attempts at the trunk, each wrong in a way worth recording.

**Chalky.** Roughness 0.62 with an emissive floor of 0.42 lit every face to the same value, and
bleached wood came out as pale plasticine. The emissive was the culprit: it fills in exactly the
shadow that gives a limb its form.

**Pewter.** Dropping the emissive and adding metalness to bring back some sheen turned the trunk
into a machined grey limb. Metal takes its colour from what it reflects, and in a scene that is
98% black there is nothing to reflect, so a metallic object goes grey however it is tinted.

**Right.** Almost no metalness, middling roughness, and one hard key light doing all the work. The
colour then survives, because a dielectric keeps its own.

There is a companion mistake in the colour itself. The first sampling pass read the *mean* of the
trunk region — `#477156` — and the tree vanished into the background. The art's wood is mostly
dark, and it is the upper decile, `#9db192`, that says what the material should be: the wood is
pale and the *scene* is dark, which is not the same thing as the wood being mid-green.

## A braid needs a gap, and the light has to sit in it

*13 September 2026, session 4*

The trunk in the art is not a tube, it is several woody cords twisting around each other with deep
channels between them, and light runs up the channels rather than over the surface. Two numbers
decide whether any of that is visible, and the first two renders got both wrong.

**Cords must be thinner than their spacing.** Set equal, they overlap so far that they fuse into
one lumpy tube and the braid disappears — which is what happened, and it is why the second render
still looked like a smooth grey limb.

**The groove floor is computed, not guessed.** Twice the light was placed at a fraction of the cord
offset that turned out to be *inside* the wood, and the trunk showed no green above the base at
all. Where two cylinders of a given radius and spacing actually intersect is four lines of
trigonometry, and writing those four lines is how the problem stopped recurring.

## A stone is a quartz point, and the ridge is the whole thing

*13 September 2026, session 4*

The first pass built the runestones as cones on cylinders, all six identical bar a scale factor,
and about twice as tall as they should have been. Three corrections:

**Chisel, not spike.** Real quartz terminates in two or three big slanted planes meeting along a
short ridge that sits off to one side. A symmetric point is a signpost. Because the ridge is
off-axis and runs at its own angle, it also gives every stone a silhouette you can tell apart from
any direction, which is the entire premise of the grove.

**The cut is derived from the project id, not authored.** Hand-authoring a crystal per stone works
for six fixtures and not at all for the real thing, where stones appear and vanish as work moves
between folders. A hash of the id, fed to the seeded generator, gives a project the same
distinctive stone every time it appears, on any machine, with nothing saved anywhere.

**Two-and-a-half to one, not five to one.** Measured off the art: seventy pixels across to a
hundred and eighty tall, and about two fifths the height of the tree. The first pass had them
nearly as tall as the tree, which is most of why that render looked like a circle of pylons around
a shrub.

## Fresnel on a flat face is a trap in both directions

*13 September 2026, session 4*

Session three found that a *lit* material on a six-sided prism gives one uniform value per face and
turns the stones into road signs, and replaced it with a fresnel term. Session four found the same
failure from the other side: at a fourteen-degree camera a stone's whole front face is close to
edge-on, so a **broad** fresnel lights all of it evenly and the stones come out as pale paper
cutouts.

Two things fixed it. The silhouette term was sharpened to an exponent of eleven, so only the last
few degrees of turn reach it. And the facet seams were drawn explicitly, as `EdgesGeometry` lines
at low opacity — the fresnel can only ever draw the outline, and it is the *interior* seams that
make a black shape read as cut glass rather than as a hole in the picture.

## The canopy is offset, and that is what makes it a bonsai

*13 September 2026, session 4*

The single number that stopped the tree reading as an acacia was moving the crown left of the
trunk rather than sitting it on top. A canopy centred over its own trunk is a savannah tree
whatever else is done to it; the art's foliage mass hangs to the left of the deadwood by nearly
half its own width, with a second storey of foliage below the fork on a long left branch.

Two supporting details. The pads are domed rather than flat, and their rims are pushed in and out
by a couple of low-frequency waves — at this camera angle the silhouette of the rim is almost all
you see of a pad, and a perfect ellipse reads as a dinner plate. And the leaves have to be small
and numerous rather than large and few: at 3cm they are visible triangles and the canopy looks
like confetti, at 1.7cm with twice as many it is foliage.

The deadwood also gets its own material, paler than the living trunk. In the art the jin is
visibly bleached against the trunk it grows from, and drawing both with one material loses the
contrast that the deadwood exists to provide.
