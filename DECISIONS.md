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


## The runestones are inscribed in Ogham, not runes

*25 September 2026*

There is no evidence the druids used runes. The futhark is Germanic and Norse. The script that
comes from the druids' world is Ogham: early Irish letters cut along the edges of standing stones,
mostly fourth to sixth century, each letter later named after a tree. It also matches the concept
art almost exactly: one stem line with groups of strokes on it. Each stone carries one real word
from the surviving inscriptions (MAQI, MUCOI, AVI, ANM, NETA, CELI, KOI; spellings and meanings per
McManus, *A Guide to Ogam*), read bottom to top as on the stones. See `src/scene/runes.ts`.

Each stone is also one of five cuts (chisel, spire, slab, stout, broken), some with small
companion crystals at the foot, all derived from the project id. One face always points at the
viewer, so the inscription sits on a face rather than across a corner.

## Roots and mycelium are joined at the root tips

*25 September 2026*

The Blender tree's roots and the grove's mycelium used to be grown separately and met nowhere.
The Blender build now exports each root tip, and the network starts every strand there, in the
root's direction, with the wood continued a little way along it. Changing the tree model means
rebuilding `world-tree-roots.json` with it.


## Two kinds of agent on the tree: tethered orbs and loose fireflies

*26 September 2026*

The concept art's flow (select a stone, open the tree's agents, send one) is built, visual only:
deploying plays the animation and lights the stone but spawns nothing until session nine.

Agents the Grove can run (Claude Code, Codex, an API model) hang from the branches on a thread of
light, because the tree can send them down the mycelium to a stone. Grok Bots drift loose round
the canopy, dashed and smaller, tied to nothing: they live in xAI's own app with no API, so they
cannot be sent anywhere and their card shows no state. That is the brief's cockpit-versus-launcher
line drawn as a picture instead of a label. Researcher is the one agent every grove starts with;
an empty bud marks where new ones will grow.

The camera never swings round a stone to frame it. Every rune faces the home camera, so the
stone and canopy shots only lean in from the home direction.


## A new grove is empty; stones only by choice

*26 September 2026*

Every folder any agent had run in used to become a stone by itself: twenty-nine on this machine,
most of them throwaway chat folders. Now a stone exists only for a folder you create or connect,
written into `grove.json`. A new grove is the tree, Researcher and three empty circles; more
circles appear once two are filled, always keeping two spare. The scan still watches everything,
so a session you start yourself inside a connected folder (or any folder under it) lights that
stone, and busy folders you have not connected are offered in the Connect menu. The Wildwood is
retired until something needs it. The concept art's six stones survive only as `?demo`.

Amber is the grove's one non-green colour and means "needs you", for both a waiting agent and a
recent failure. The heartbeat stays single; when two agents work on two projects, each stone
shows the working agent's face above it rather than the pulse splitting in two.

## Agents grow from the bud, and their place on the tree is worked out, not stored

*27 September 2026, session 6*

The bud in the canopy now opens a small form: tool (Claude Code, Codex or Grok Bot), name, one
line, a face from eight glyphs, and for a Grok Bot an optional https link. It writes an entry to
`grove.json`'s `agents` list through `parseAgent`, the same function that reads a hand-typed
entry, so the form cannot write something the loader would then refuse.

**Where an orb hangs is not in the file.** Each kind has a short list of places read off the
canopy by eye (seven on the branches, six in the air), and agents take them in the order they
grew. Storing coordinates would be state in a file meant for intent, and every new canopy would
need a migration. The cost is a limit: seven branch agents including Researcher, six fireflies.
A bonsai carrying more lanterns than that stops reading as a tree, and the form says so when a
kind is full rather than piling orbs on top of each other.

**Researcher is built in, not written.** It cannot be removed by accident, and no entry may take
the id `researcher`, so `Rune.agent: "researcher"` always means the same agent.

**A Grok Bot's link is looked up on the node side.** "Open in Grok" sends the agent's id, and the
main process reads the link from `grove.json` and checks it is https before the system opener
sees it. Page code never names what gets opened, which is the same rule `openSession` follows.

**Not done, on purpose:** importing Claude Code subagents from `~/.claude/agents/`. There are
none on this machine, so it could not be tested against anything real, and connecting one only
means something once session nine can spawn it.

## A new stone arrives: roots first, then the stone

*27 September 2026, session 6*

Creating or connecting a project used to make its stone appear between one frame and the next.
Now light runs from the trunk out along the new stone's roots (1.5s), and as it arrives the stone
pushes up out of the floor with a slight tremor and settles (1.7s), throwing a ring of light
across the ground. Its rune and beam wake only once it has stopped; its name and worker badges
wait too, so nothing floats over an empty spot.

Only stones that appear **while you watch** do this. The scene records which stones were already
there when the first real snapshot arrived, and those simply stand, so launching the app does not
replay every stone's arrival. Off under reduced motion.

The empty circle's plus now waits 350ms before appearing, and its menu is two choices, New and
Connect. The suggested folders moved one step in, behind Connect, and Connect goes straight to
the folder picker when there is nothing to suggest.

**No permission screen of our own.** macOS already asks before an app reads Documents, Desktop or
Downloads, and choosing a folder in its picker counts as permission for that folder. The scan
reads `~/.claude` and `~/.codex`, which macOS does not protect. A second, home-made prompt in
front of the real one would be friction with nothing behind it.

## Hooks: curl to a loopback listener, installed only from Settings

*27 September 2026, session 6*

Claude Code runs a command at each moment of a session and hands it a JSON description on stdin.
The Grove's hook is one line of `curl` that forwards that JSON to a listener inside the Grove on
`127.0.0.1:47819`. Seven events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
Notification, Stop, SessionEnd.

**The hook must never get in Claude Code's way.** `-s -o /dev/null` because a PreToolUse hook's
output can be read as an instruction; `-m 1` so a stuck Grove costs a session at most a second;
`|| true` so a closed Grove is not an error. Measured: about 33ms a call, most of it starting
curl, and 34ms with the Grove shut.

**The listener takes only what it expects.** Loopback only; a random token in the path, kept in
`~/.agentic-grove/hook-token`; and any request with an `Origin` header is refused, because a web
page can send requests to localhost and browsers always mark them. It answers before it parses.

**Hook state corrects the scan, it does not replace it.** A session's hook status wins unless the
transcript is more than ten seconds newer than the last call (the Grove missed something) or the
hook said "running" over two minutes ago and the scan disagrees (a crash sends no SessionEnd).
Held in memory only. A call from a session the scan has not seen yet triggers one rescan; any
other call redraws from the last scan straight away, which is the sub-second path.
`Notification` is the one thing only hooks can know: a permission prompt writes nothing to disk.

**Installing follows the consent rules from session 1.** Settings, from the rail's gear, shows
the exact lines that will be added or removed before anything is written. Applying is refused
if the file changed since it was shown. Our entries are found by `/agentic-grove/` in their
address, so Turn off removes ours and leaves everything else, including hooks added since. A
backup goes to `~/.agentic-grove/backups/` before every write. Checked against a copy of the
real settings: the existing SessionStart hook survives install, reinstall changes nothing, and
removal restores the file exactly.

**Not in this session:** the statusline hook, which is where official rate limits come from.
It belongs with the crystal (next), and it needs its own consent flow because Claude Code allows
only one statusline and a person may already have one.

## The crystal: official where a provider says so, counted where it does not

*27 September 2026, session 7*

**The statusline cannot reach the Grove from the desktop app.** Tested, not assumed: a
`statusLine` command that copied its input to a file was added to `~/.claude/settings.json` (with
consent and a backup), and a fresh desktop session ran its `SessionStart` hook but never the
statusline. Settings were then restored byte for byte. The official Claude five-hour and weekly
percentages only exist for people running Claude Code in a terminal, so the statusline route is
deferred to before the public release, for them. Reading the desktop app's private caches or its
login token was ruled out: undocumented, fragile, and it means handling credentials.

**What the crystal shows instead** (`core/usage/`, on its own one-minute timer, outside the scan):

- **Codex, official.** Every `token_count` event in a Codex rollout carries the five-hour and
  weekly `rate_limits` OpenAI reported. Better than the brief expected. The figure is true as of
  the last Codex turn, so its age travels with it, and once a window's reset time passes it
  becomes `unknown` rather than a stale percentage.
- **Claude Code, measured.** Tokens per message, summed over five hours and seven days from the
  transcripts, including subagents. Input, cache writes and output; cache reads left out, because
  they dwarf everything and cost a tenth as much. Messages are counted once by id (they are
  written several times while streaming, and resumed sessions can repeat them). Each file is read
  once, then only from where the last read stopped: a week here is 133MB and a refresh reads the
  new lines only. No percentage, ever: the limit is not visible, and dividing by a guess would be
  inventing the number. Checked against an independent count in Python: equal.

**How it looks.** A rim round the hexagon: left half Claude, right half Codex. An official limit
fills its half from the bottom with the headroom left, amber below 10%. A measured-only provider
is a dotted line (activity known, ceiling not). Unknown stays dark. Hover or click opens a
readout with every figure and its provenance; the wording lives in `core/usage/format.ts` so the
readout and the menu bar cannot disagree.

**The menu-bar shard** (`electron/tray.ts`). A template hexagon drawn by
`scripts/make-tray-icon.swift`, with the same figures in its menu, plus Open and Quit. Text
beside it only when an official limit is under 10% left. Closing the window no longer quits the
app: the Grove keeps listening from the menu bar, as the brief intended.

## Keyboard grove: arrows by what the screen shows, Enter only when nothing else wants it

*27 September 2026*

The grove has no rows, so an arrow means "the nearest place that way on screen"
(`src/scene/navigation.ts`): ground x is left and right, ground z is up and down, and sideways
drift counts double so right does not jump to something mostly above. Empty circles are targets
too, because they are where projects are made. Keyboard focus (`focused` in the flow store) is
separate from the chosen stone, as hovering is from clicking; the focused stone shows its label
and an empty circle warms and shows its plus.

Enter and R act only when no button or field has focus, since a focused button already owns
Enter. Opening moves focus into the panel or menu, retried on a timer because a panel is `inert`
for a frame and frames stop while the window is hidden. Esc now drops focus from whatever holds
it, so a closing menu cannot keep a button focused for the next Enter. The intro listens in the
capture phase and claims its right arrow, so one press does not also move the grove.

Announcements go through one live region (`Announcer`), in the words the labels and stone panel
use; the first move adds how the keys work. R reports runes honestly, which today is "no runes
yet". Tested in the packaged app by driving Chromium's own input over its debugging port: macOS
key injection does not deliver Esc to Electron windows, which looked like a bug and was not.

## Tells come from transcripts, not hooks

*27 September 2026*

The roadmap had Tells coming from hooks. Claude Code reports a failed tool call only through
`PostToolUseFailure`, which the Grove does not install, so hooks would have meant a second
settings change. Transcripts already record every failure (`is_error`) and every edit, for desktop
and terminal sessions, and they survive a restart. `core/harnesses/claude-tells.ts` reads the last
256KB of each Claude Code transcript touched in the last day, re-reading only when it grows.

Three tells: the same tool failing three times running, an edit exactly reversed by a later one,
and a turn ending straight after a failed call. Failures a person caused (a rejection, an
interruption, a permission rule's refusal) are not tells. Each carries one sentence saying what
triggered it. A stone keeps its three newest from the last day; its panel lists them in grey, not
amber, because amber means something needs you and a tell only might. The stone's light flickers
once when a tell is new (under five minutes old), never on launch for ones already there.

`npm run verify:tells` checks the reader against hand-written transcripts, since a quiet day has
no real tells and "found nothing" looks the same whether the reader works or not. Codex is not
read for tells yet.

## ChatGPT Dots replace Grok Bots; two provider marks, not five

*30 September 2026*

OpenAI announced Dots at DevDay on 29 September 2026: always-on agents that live in ChatGPT, run
on OpenAI's own machines, connect to thousands of apps, and do not count against ChatGPT limits.
Pro, Business Premium and Enterprise plans only. Far more people use ChatGPT and Claude than Grok,
so Adrian's call is to replace Grok Bots with Dots as the grove's always-on coworkers. Like Grok
Bots, Dots have no public API (checked 30 September 2026), so they are link-only fireflies.
`grok-bot` still loads from an older `grove.json` but is no longer offered.

The harness row (five glyphs) became two provider marks, Claude and ChatGPT, nothing else. Each
product lives under its company's mark: Claude Code and Cowork under Claude; Codex and Dots under
ChatGPT. Re-check for a Dots API before v1.

## Two kinds of work, drawn as two kinds of agent

*30 September 2026*

Claude Code and ChatGPT both have an everyday app and a coding agent, and the grove has to say
which is which. The rule: **agents that work in your folders hang from the branches** (Claude Code,
Codex) and can be sent to a stone; **everyday coworkers drift as fireflies** (Claude Cowork, ChatGPT
Dots) and open in their own app. `LINK_HARNESSES` in `core/state/schema.ts` is the one list that
decides it. Orb seals show the company, the label shows the product.

## Builder and Manager are built in, beside Researcher

*30 September 2026*

Every grove now starts with three agents: Researcher, Builder (code and files) and Manager (plans
the work and picks the tool for each job). Built in rather than written to `grove.json`, so they
cannot be deleted by accident; their ids are reserved. They run on Claude Code, or Codex when that
is the only one installed.

The Manager's choice is a small rule book in `core/routing.ts`, not a prompt, so it can be read and
tested (`npm run verify:routing`): project work to Claude Code or Codex, whichever has more
five-hour headroom (Claude Code on a tie or an unknown); everyday work to Cowork, then ChatGPT;
recurring work to a Dot, or a saved task without one; nothing that fits means saying what to
connect. Wired to the console in step 10.

## One-button setup opens Terminal

*30 September 2026*

A non-technical person should be able to start from nothing. Each missing tool (Claude Code, Codex)
gets one Set up button, in the first-launch walkthrough and in Settings. It writes a short script
to a private temp folder and opens it in Terminal: the maker's official installer (Anthropic's
`install.sh`; Homebrew or npm for Codex), then the tool's own sign-in. Visible rather than silent,
because sign-in needs the person and their browser anyway, and because a window that shows what
runs is one they can trust and stop. With no package manager it opens the tool's page instead.
Detection only checks the usual install locations; the Grove never reads sign-in details.

## Updates: a daily question to GitHub, and a download link

*30 September 2026*

Adrian will not pay for an Apple Developer account, and without one macOS will not accept a
self-installed update. So the Grove asks GitHub's public releases API once a day, only while
online, and shows a download button when a newer version exists. One unauthenticated GET with no
identifier: the no-telemetry principle holds, README.md says so plainly, and Settings can turn it
off. Everything you have made lives in `~/.agentic-grove`, outside the app, so replacing the app
never touches it. While the repository is private the check answers "Could not check".

## Settings live in grove.json, and graphics has three modes

*30 September 2026*

New settings (graphics, adapt automatically, check for updates, fireflies, counts, stone names,
motes) sit in `grove.json` beside the Claude plan, checked by the same parser as a hand edit, so
they survive updates and can be edited by hand.

Graphics modes: **Performance** (no reflections or bloom, 60 fps cap by drawing on a timer),
**Balanced** (half-resolution reflections), **Grove** (everything, at the screen's own refresh:
the renderer follows the display, so 120 on ProMotion). With "Adapt automatically" on, the grove
steps down one level when the whole Mac's CPU is over 80% for ten seconds or the frame rate sits
under three quarters of the target, and back up after a calm minute; with one screen only and the
Grove behind other windows for two minutes, it holds at Balanced until you return. Never above
your choice. Memory is not used: macOS keeps free memory near zero on purpose. A fully covered or
minimised window already costs nothing, because Chromium stops drawing it.

## Sub-stones: a big part of a project can stand as its own stone

*30 September 2026*

A project that is really two or three (Adrian's example: `Work` with big `Data` and
`Presentations` folders, or branches in separate worktrees) can split. A sub-stone is simply a
connected folder inside another stone's folder; the nearest folder already owns its sessions, and
worktree sessions are now matched on their working folder as well as the project root. It stands
further out than its parent, a little smaller, fanned either side of the line from the trunk, and
its roots grow from the parent stone rather than the tree.

One stone per project stays the default. The grove *offers* a split when at least two parts each
hold four or more sessions and a fifth of the stone's work (`splitsFor` in `core/state/stones.ts`),
in the stone's panel and the Projects list; "Split off a part" picks one by hand. `?demo&split`
shows two sub-stones off Build.

## The rail: six places that each do something

*30 September 2026*

Grove (home), Projects (every stone as a list, sub-stones under their parent, split offers,
connect or create), Agents (the canopy), Saved tasks (every rune, with a Run button that says it
waits for spawning), Activity (the raw session list), Settings. Each name slides out on hover.

## Smaller changes from Adrian's notes

*30 September 2026*

- The crystal's readout stayed open after a click elsewhere: `:focus-within` held it after the pin
  was released. Now a click outside or Esc closes it, and only keyboard focus keeps it open.
- The sparkle beside the console had no job and went. The plus now attaches files (or drop them on
  the console); they wait as chips until the console can send them (step 10).
- The stone panel's Agents / Open / Task became "Send an agent", "Open folder" (now working) and
  "New task", each with a line saying what it does.
- Clicking the tree opens its agents, through two invisible shapes rather than the 1.2M-triangle
  model, so the pointer test costs nothing.
- Mycelium: main runs a fifth thicker, a finer second run to each stone from the next-nearest root,
  and ten forks per run instead of seven.
- Home view: centred a little right of and below the tree, about eight per cent further back.
- Full screen: the interface is an eighth larger, and after six quiet seconds with nothing open the
  chrome fades back so the grove fills the display; any input brings it back.

## Official Claude five-hour figure: waiting on a decision

*30 September 2026*

The Claude app shows the five-hour and weekly percentages; the Grove still only counts tokens,
because the desktop app never runs Claude Code's statusline. The source the Claude apps use is an
account usage endpoint that needs the sign-in token Claude Code keeps in the macOS keychain.
Reading another tool's credential is a bigger step than reading its transcripts, so it waits for
Adrian's explicit decision. Options: (a) with consent, read the token and ask that endpoint every
five minutes (macOS shows its own permission prompt); (b) the statusline route, official for
terminal users only; (c) keep counting. The provider rings fill the moment an official figure exists.

**Update, same evening:** Adrian chose (a), behind a Settings switch that is off by default. The
code was written (`core/usage/claude-official.ts`, merged into the usage loop), but the coding
agent's own safety check refused to continue work that reads another app's keychain token, so it
is parked in a git stash ("official Claude limits via keychain") rather than committed. To resume,
Adrian allows it in the agent's permission settings (or applies the stash himself), then the
Settings switch is one small addition.

## Uninstall goes to the Trash, and undoes the hooks first

*30 September 2026*

Settings ends with Uninstall, in two steps: a list of exactly what will happen on this Mac, then
the button. In order: take the Grove's lines out of Claude Code's settings (the one change it made
to another tool; a backup is kept), optionally move `~/.agentic-grove` and the window's own storage
to the Trash (off by default, so coming back is painless), move the app bundle to the Trash, quit.
Trash rather than delete throughout, so a regretted uninstall is one drag to undo. It stops at the
first failure. Project folders, sessions, Claude Code and Codex are never touched. Running from
source there is no app bundle, so it only cleans up and quits.

## Sending an agent opens Terminal with your own Claude Code, not the Agent SDK

*30 September 2026, step 9*

The plan was to spawn agents inside the Grove through `@anthropic-ai/claude-agent-sdk`. Checked
before building: Anthropic's Agent SDK documentation says third-party developers may not offer
claude.ai login or subscription limits in their products, including agents built on the SDK,
without prior approval. So an SDK route would need an Anthropic API key billed per token, outside
a Pro or Max plan (at Opus 5.5 prices, roughly $1–10 per coding session). Adrian chose the launcher.

What happens now: "Send to <stone>" writes a one-off `.command` script and macOS opens it in
Terminal. The script `cd`s into the project and runs the official `claude` command with
`--session-id <uuid the Grove chose>`, `--name "<agent>: <task>"`, the agent's brief through
`--append-system-prompt`, an optional `--model`, and the task as the opening prompt. Codex gets the
brief and task as one opening prompt. The session is yours, on your plan, in a window you can
watch, answer and stop.

- **No shell injection.** The task, folder, name, model and brief are written to files and read
  inside double quotes, then gathered into a zsh array, so the task is always exactly one argument
  and nothing in it runs. Text starting with a dash gets a leading space so it cannot be read as an
  option. The temporary folder is deleted by the script before the tool starts.
  `test/verify-spawn.ts` runs real scripts against a stand-in `claude` to prove it.
- **The command's path is found, not looked up.** Only the fixed install places in
  `core/setup.ts` (`cliPath`), so nothing earlier on `PATH` can stand in for `claude`.
- **Runs are their own record** (`core/spawn/runs.ts`, `~/.agentic-grove/runs.json`), apart from
  `grove.json`, as the 30 September review asked: intent you edit stays separate from history the
  Grove writes. Saves go through one ordered queue with unique temporary files. Last 200 kept.
- **States move only on evidence**: starting → running / waiting (needs you) / finished → ended, or
  failed. The chosen session id lets hooks and the scan match a run exactly. Once hooks have spoken
  for a run, the scan may confirm it but not overrule them, because only hooks can tell "needs you"
  from "finished". Codex has no id flag or hooks, so its run takes the first new Codex session in
  that folder after launch, oldest run first. Nothing seen for 15 minutes is "failed", with why.
- **The deploy toast ticks only when the session is confirmed**, not when Terminal opens (review
  item 2). Before that it says "Starting in Terminal", and after eight seconds points you at the
  window in case Claude Code is asking to trust the folder. A missing command gets a "Set up" button.
  Real stones no longer light during a deployment; only the scan or hooks light them.
- **Built-in briefs** (`core/spawn/briefs.ts`): Researcher investigates and does not edit unless
  asked, Builder makes and checks the change, Manager plans and does not edit. Your own agents use
  their `systemPrompt`. The project's CLAUDE.md still applies.
- **The run panel** shows one run's task, state and the last 60 lines of its transcript (your
  words, the agent's text, one line per tool call), re-read every two seconds while open, read-only
  and tail-only. "Resume in Terminal" runs `claude --resume <id>` in the same folder; it is offered
  once the run is finished, closed or failed, so it does not open a second window on a live session.

Not built: stopping a run from the Grove (Ctrl-C in its window does it), Codex transcripts in the
panel, and the rune console sending tasks (step 10). An API-key engine could be added later as an
opt-in without changing run records.

## Mushrooms: projects worked on in the same hour

*30 September 2026*

Small dim-green caps grow on the ground between two stones when each had a session start, or
last move, in the same clock hour during the past week (`core/state/pairings.ts`). Only those two
moments count, because a session left open for days has not been worked on for days, and counting
its span would pair everything. One to five caps by shared hours; they fade over the week and are
gone after it. A sub-stone never pairs with its parent. Placed halfway round between the two
stones, a little nearer the tree, never on the dais. Sized so the tallest is about a sixth of a
stone: smaller vanished into the floor from the home view. `?demo` shows one fresh and one fading
pair. `npm run verify:pairings` checks the rule.

## One ordered way to change grove.json, and one scan loop at a time

*30 September 2026, from the project review*

Every change to `grove.json` now goes through `updateGrove` in `core/state/grove.ts`: read,
change, write as one step, queued behind any other change, with a unique temporary file per write.
If the file changes on disk between the read and the write (a hand edit), the change is made again
on the new version, up to three times. This fixes the lost update the review reproduced (two
settings saved together, one silently dropped) and makes two agents grown at once with one name
get distinct ids.

The scan loop drops a pass that finishes after the loop was stopped. `restartScanning` numbers each
restart and only the newest starts a loop, so overlapping refreshes cannot leave two loops running.
Snapshots are numbered when they start being built and one that finishes after a newer one was sent
is dropped, so older data never replaces newer on screen. `npm run verify:reliability` reproduces
all three faults; against the previous code four of its five checks fail.

## The rune console reads with rules, and shows its reading before sending

*30 September 2026, step 10*

Typing a job in the console and pressing Enter now sends it. `core/console.ts` decides who and
where with plain rules rather than a language model, because a model would need a per-token API
key or would run the subscription through this app. Who: an agent named at the start ("@builder",
"Researcher:", "ask the manager to"), else by how the job starts (planning words → Manager,
questions and looking-into words or a trailing "?" → Researcher, everything else → Builder; "do",
"can" and "should" are not question words, since "do the refactor" is building). Where: the
selected stone, else one named as a whole word (longest name first), else the only stone, else you
pick. A line above the pill shows the reading ("Builder → Shellter"); clicking the agent cycles
through the agents that can work in a folder, which is the override the review asked for. Enter
goes through the step 9 launcher, and the text clears only once Terminal opened without error.
Attached files go into the task as their paths (`webUtils.getPathForFile` in the preload, only for
files you dropped or picked). `npm run verify:console` checks the rules. The echo line is roadmap
idea 7 ("Echo test") in its simplest form.

## Attention: amber motes, quiet notifications, and the Grove always waits

*30 September 2026, step 11*

Following the brief's defaults, with one addition. In the grove: a stone that needs you is amber,
and an amber mote lifts off it and drifts to the trunk every seven seconds or so until you answer
(`src/scene/AttentionMotes.tsx`; none under reduced motion, where amber alone says it). Ambient motes
never leave the canopy, so only this one travels.

macOS notifications (`core/attention.ts`, `electron/notify.ts`) only for work the Grove started,
always silent, never while a Grove window is in front, and clicking one opens that run:

- **Failed**: always.
- **Finished**: when it had worked for a minute or more, so a quick back-and-forth in Terminal
  does not ping on every reply. A switch in Settings, on by default.
- **Needs you**: the addition. Off by default as the brief says, but a switch in Settings, because
  an agent blocked on a permission prompt makes no progress until you answer, and that is the one
  thing worth interrupting for if you leave the Grove behind other windows.

Answer or wait: the Grove never answers an agent's question or permission prompt. The run panel
says it is waiting and offers "Answer in Terminal", which brings Terminal forward
(`open -b com.apple.Terminal`; macOS only, listed for the Windows port). Auto-answering stays out,
as the brief's default. `npm run verify:attention` checks the rules.

## A health line, and a scene that fails visibly

*30 September 2026, from the project review (item 6)*

A calm grove is only trustworthy if a broken one cannot look calm. A small line under the counts,
bottom left, always shown (even with counts off), says one of: "Live" (hooks working), "Watching"
(scan only), "Updated 3 minutes ago" (no fresh picture for three scan intervals, at least 20
seconds), "Codex unread" (a tool could not be read), "grove.json has an error", or "Live updates
paused" (hooks on, listener not running). Stale wins over everything, since then nothing on screen
can be trusted. Never amber, which stays reserved for "needs you". Hover gives a sentence; clicking
opens Activity. Rules in `core/health.ts`, checked by `npm run verify:health`.

The 3D scene now sits inside `SceneGuard`: a component that throws, or the Mac taking the WebGL
context away, shows "The grove could not be drawn" with Try again and Use Performance graphics,
while the rail, console, crystal and panels keep working. Checked in the browser by forcing a
context loss and recovering.

## Stones keep their places

*30 September 2026, from the project review (item 8)*

Places used to be handed out by list order on every draw, so removing an early project slid every
later stone along one place. Now each top-level stone's place number is written on its entry in
`grove.json` (`"place": 2`, hand-editable) when it is connected, and a removed stone leaves an empty
circle where it stood. A new project takes the circle you clicked, or the lowest free one when
connected from the Projects panel; a taken number is never given twice. The empty circles are the
gaps first, then new places, keeping the old rule of three to start and two spare after. Sub-stones
take no number; they stand off their parent. Older groves without numbers keep their order-based
layout, and the next add or remove writes those numbers down, so nothing moves on upgrade. This is
a small exception to "grove.json stores intent, never state": where your stone stands is something
you chose, and hand-editing it is a feature. Rules in `core/state/places.ts`, shared by the node
side and the scene; `npm run verify:places` checks them against a disposable grove.

## Routing skips a used-up allowance, and the console shows the tool

*30 September 2026, from the project review (item 5)*

`route()` in `core/routing.ts` now skips a tool whose five-hour allowance is known to be at 0%, when
the other is installed; with both used up the job still goes to Claude Code and the reason says it
waits for a reset, never that there is room. `headroomFrom()` turns the crystal's report into the
figures `route()` compares, and drops any that describe a window already reset or a reading more
than five hours old. Sending a built-in agent now asks `route()` with the tools actually installed
(before, it only checked which command existed). The console's preview shows the tool beside the
agent ("Manager · Claude Code → Data"), with the reason on hover; when both tools are installed,
clicking it switches, and what is shown is what is sent. Your own agents always use their own tool.
Still open from the same review item: `newestRollouts()` in `core/usage/codex.ts` may miss a resumed
Codex conversation filed under an older date. `npm run verify:routing` now has 9 checks.

## Packaging: a real app bundle and a disk image, still unsigned

*30 September 2026, step 14*

`npm run app` and the new `npm run dmg` both go through `scripts/package.mjs`, which uses
`@electron/packager` (a development dependency, BSD-2-Clause) to build the bundle. The old shell
script copied Electron.app and renamed only the folder: the program inside was still "Electron", so
`app.isPackaged` was false in the Dock app and Settings → Uninstall could not find the app to move
to the Trash. Now the program and its four helpers are called "Agentic Grove", the bundle id is
`com.adiezc.agentic-grove`, and the version comes from package.json.

Still unsigned (Adrian's call): an ad-hoc signature so Apple Silicon runs it, and the README's
"Installing a download" explains the one-time Open Anyway in Privacy & Security (right-click → Open
no longer works for unnotarised apps on current macOS). The disk image is the usual drag-to-
Applications layout, Apple Silicon only, about 146 MB, built with macOS's own `hdiutil`. Checked:
mounted, the program and helpers renamed, the signature verifies, and the installed app starts and
completes a scan. Not done: publishing a GitHub release (needs Adrian, and a public repo for the
update check to see it), and the version is still 0.0.1.

## Agents without a branch, and finding a project

*30 September 2026, from the project review (item 8)*

The tree has seven branches and six firefly places. An agent past those (only possible by editing
`grove.json` by hand) used to vanish from everything. Now it keeps its place in the agent card's
pager and in the console's reading; it simply has no orb, and its card says so in one grey line.
A deployment from it sets out from the heart of the canopy. The Projects panel gets a "Find a
project" box once there are more than six projects, matching any part of a name. Grey rather than
amber for both lines: amber means something needs you, and `panel-note` (amber) had crept into two
places tonight that were only information; they now use a grey `panel-aside`.

## Find a tool before offering to install it

*30 September 2026, Adrian's report*

Set up ran the Claude Code installer although the Claude desktop app already carries its own copy
(under `~/Library/Application Support/Claude/claude-code/<version>/`), and the ChatGPT app carries
Codex (`ChatGPT.app/Contents/Resources/codex-cli/bin/codex`). The Grove only looked in the standard
install folders. Now `findCli` in `core/setup.ts` looks in three places, in order: the standard
install folders, wherever the user's own login shell finds it (`command -v`, fixed names only, four
second limit), and the copy inside the desktop app (newest version). Set up only appears when all
three are empty, the setup script itself checks `command -v` first and stops with "already
installed" if it finds one, and Settings says which copy is in use. Checked on this Mac: Claude Code
found at `~/.local/bin/claude`, Codex found inside ChatGPT.app, and the script stops early.

Found at the same time: neither copy is signed in for use from Terminal (`claude auth status`
exits 1 for both); the desktop app signs its own copy in privately. So one browser sign-in is
needed for the Terminal launcher whichever copy runs.

## One button to get ready

*30 September 2026, Adrian: "one button setup, or two at most if anything needs authorisation"*

The first-launch card used to show four rows (the Claude and ChatGPT apps, Claude Code, Codex),
each with its own button, and live updates were a separate switch in Settings behind a diff
review. A newcomer had to know which of those mattered. Now the card shows what is here, read-only,
and one button whose job is worked out by `core/readiness.ts`: install Claude Code if no tool is
here, sign in if a tool is here but signed out, turn on live updates if they are off, or nothing
if all is well. Live updates ride along with install and sign-in, so a newcomer presses once and
signs in once. The sentence under the button says everything the press will do, which is the
consent for changing Claude Code's settings; a backup is kept as before, and Settings still shows
the full diff for anyone who wants to read it first. Codex alone counts as ready. The desktop apps
are no longer in the first-launch card: they are useful but not needed, and stay in Settings.

**Signed in or not** is asked of the tool itself (`claude auth status --json`, `codex login
status`); only the yes or no is kept, never the account details in the answer. A tool that does
not answer in eight seconds counts as signed in, so a slow check never nags. The Grove looks again
whenever its window comes forward, which is the moment someone returns from signing in, so the
card updates by itself. The button takes nothing from the page: the main process works out the
step again from fresh facts before acting. `npm run verify:readiness` (11 checks, stand-in tools).

**Asking an agent to install it.** `INSTALL.md` is written for both a person and the AI agent they
hand it to: check the Mac and Node, clone, `npm ci`, `npm run app`, open, then hand over to the
Get ready button. It tells the agent not to edit Claude Code's or the Grove's settings itself. A
Mac-built app is not quarantined, so this route also skips the "Open Anyway" step a download needs.

## Claude Code's idle reminder is not "needs you"

*30 September 2026, found in the end-of-session checkup*

About a minute after a turn ends, Claude Code sends a `Notification` hook saying "Claude is waiting
for your input". The run book treated every `Notification` as a question, so the test run that
had finished turned amber a minute later and would have stayed that way. `parseHookCall` now marks
that reminder as `idle` (by `notification_type: "idle_prompt"`, or by its words on older
versions), and the run book ignores it. Permission prompts and questions still turn a run amber.
Stones are unchanged: for a stone, a finished turn already means "back with you".

## Official Claude limits: a probe you press, not the keychain

*1 October 2026, Adrian's call. Built 2 October 2026; see "What building it found" at the end.*

This replaces the choice recorded under "Official Claude five-hour figure: waiting on a decision".
The keychain route would read a sign-in credential to ask Anthropic for the figures. The probe
reads no credential: it runs your own Claude Code once and reads what Claude Code prints. The
keychain code stays in the git stash as a fallback and is not to be finished without a new decision.

**What the probe is.** One headless call to your own `claude`:
`claude -p --output-format stream-json --verbose "Reply with: ok"`. Among the lines it prints is
one of type `rate_limit_event`. Run by Adrian on this Mac on 1 October 2026 (Claude Code 2.1.286),
that line carried `rate_limit_info` with `status`, `rateLimitType`, `resetsAt`, `utilization`,
`isUsingOverage`, `surpassedThreshold`, and `unifiedWindows.five_hour` and `.seven_day`, each with
`utilization` (0 to 1) and `resetsAt` (epoch seconds). That day it read 91% of five hours and 12%
of the week. The idea and the field names come from clodfarm (MIT, `clodfarm/governor.py` and
`runner.py`); add it to `CREDITS.md` before writing the code.

**Rules for building it.**

- Off by default, behind a Settings switch (`officialClaudeLimits`), with the sentence beside it
  saying that each check sends one small request on your plan.
- It runs only when you press "Check now". No timer, and no check before a send. clodfarm probes
  every five minutes on its main model with no back-off; the Grove does not.
- Always the cheapest model, in an empty temporary folder, with a session id the Grove chose, so
  the scan and the hook listener can leave that session out of the scene and the notifications.
- Figures are labelled `official` with the time they were read, as Codex's are. A window missing
  from the line is `unknown`. A window whose reset time has passed is `unknown`. Nothing is filled in.
- If a check returns no such line, say "Claude Code did not report limits" and do not retry by
  itself. Anthropic's headless documentation is reported to say `-p` will later need an API key by
  default; if that happens the probe stops working and the figure goes back to `unknown`.
- The probe's own tokens are real use and stay in the measured count.

**Still to find out before or while building.** What one check costs in tokens (the result line
says); whether the hooks fire for a headless session; and whether the same figures already sit
somewhere under `~/.claude` that could be read for free, which would beat the probe.

**What building it found (2 October 2026, Claude Code 2.1.286).** Code in `core/usage/probe.ts`,
checked by `npm run verify:probe`; the switch and "Check now" are in Settings → Claude limits.

- *Is it stored for free under `~/.claude`?* No. Nothing outside the transcripts holds these
  figures, so the probe is needed.
- *Do hooks fire for a headless session?* Yes: a plain `claude -p` ran the `SessionStart` hooks.
  The probe therefore loads none of your settings (`--setting-sources ""`), which skips your hooks,
  plugins and instructions altogether.
- *What does a check cost?* About 620 tokens (586 in, 37 out) with no settings, no tools and a
  one-line system prompt. The same request with settings loaded cost about 9,200, almost all of it
  Claude Code's own system prompt and the hooks' output. Settings shows the real count after each check.

Three places where the build differs from the rules above, each on purpose:

- **A fixed folder, not a chosen session id.** Every check runs in `agentic-grove-limits-check` in
  the temp folder, and sessions and hook calls from that folder are left out of the grove. A
  remembered id would be forgotten when the Grove restarts; the folder still works.
- **A window with no official figure shows the counted tokens, not `unknown`.** The token count is
  true and already there, so it stays; the note says which window is counted and why. No percentage
  is ever filled in.
- **The reading is kept in memory only.** After a restart it shows "Not checked yet" until you
  press again. Switching the setting off forgets it at once.

## Photo mode

*2 October 2026. Roadmap idea 10, built ahead of the README screenshots (step 15).*

Press P, or PHOTO beside Home view. The interface fades out and one small bar stays: a depth
slider, Save image, Done. Esc or Done returns to the home view.

- **The camera is looser, only here.** Closer, further and higher than normal, and right-drag slides
  the frame. The everyday limits exist so nobody gets lost on a screen that is on all day; a
  photograph is the one time you want to.
- **Depth of field focuses on the point the camera turns about.** One slider, from everything sharp
  to only the centre. No focus picker: centring the thing you want sharp does the same job.
- **The image is the scene drawn again at three times the window's size** (longest side capped at
  6,000 pixels), read in the frame it was drawn. The alternative, keeping every frame readable
  (`preserveDrawingBuffer`), costs frame rate all day for a button pressed rarely.
- **Saved as an ordinary download**, so the app asks where to put it. No new channel between the
  page and the filesystem; `captureStill` stays development-only.
- **Names are hidden; worker orbs and empty circles stay**, because they are part of the scene.
- Photo mode always runs the bloom chain, even in Performance mode: the picture should be the
  full look. Nothing is stored in `grove.json`.

Checked in the browser demo: a 3072 × 2304 image from a 1024 × 768 window, and the drawing size
back to normal afterwards. The app's save dialog was not exercised.

## The tree answers

*2 October 2026. Roadmap idea 3.*

Type "what did I do yesterday?" into the console. The echo line says "The tree answers →
yesterday" before anything happens, Enter shows the answer above the console, and each stone
involved lights and shows its name as its line appears, in the order you came to them. Clicking a
line opens that stone. Esc, or the cross, puts the answer away.

- **Rules, not a model**, as with the console (`core/history.ts`). It understands today, yesterday,
  a weekday, "last Friday", this week, last week, and "the last N hours, days or weeks". A history
  question with no time in it means today.
- **A wrong reading costs one click.** "Ask an agent instead" on the echo line sends the same text
  to an agent as before.
- **Only what the records can support.** A session records when it started and when it was last
  written to, nothing in between. So a session counts for a period only if it started or was last
  worked on inside it. One that began before and was last touched after is counted apart, with
  the sentence "The Grove cannot tell whether it was used then." Per-day activity would need the
  hook history kept on disk, which it is not; that would be its own decision.
- **Its reach is said.** Projects on the grove only, and when a question goes back past the oldest
  session, the answer says when the grove's records start.
- Nothing is stored, and nothing leaves the Mac.

Checked against real data in the Electron window through its debugging port.

## Idle drift

*2 October 2026. Roadmap idea 17.*

After five minutes with no pointer or key activity, at the home view with nothing open, the camera
turns round the grove once in about ten minutes. Any movement stops it and eases the view home;
taking hold of the view yourself keeps it where the drift had got to.

It does not run under reduced motion, in photo mode, while a panel is open, or while any stone is
waiting or has failed: the camera must not turn away from the one thing that needs you. On by
default, with a switch under Settings → In the grove ("Turn slowly when left alone"). Adding
`?drift=10` to the dev preview's address shortens the wait to ten seconds, for judging the speed.

Checked in the browser preview with an empty grove: the view had turned after thirty seconds and
returned home on the next pointer movement. The demo grove never drifts, because one of its stones
is waiting.

## Your own agents: a brief, a model, and changing them

*2 October 2026. The rest of step 8.*

An agent you grow could only be given a name, a line and a face; its brief and model existed in
`grove.json` (`systemPrompt`, `model`) and were used at launch, but could only be typed by hand.
The grow form now has both, for agents that work in folders, and a pencil on the agent's card
opens the same form to change it.

- **The brief is sent ahead of every job** the agent is given, as the built-in agents' briefs are.
  Up to 4,000 characters. **The model** is passed to the tool as typed; empty means the tool's own
  choice, never a guess by the Grove.
- **Changing an agent keeps its id and its tool.** Runes and past runs refer to the id, and a
  different tool is a different agent, so the tool buttons are not shown when changing one.
- Everything goes through the same checks as a hand-typed entry (`updateAgent` beside `addAgent`).
- The built-in three cannot be changed from the interface; their briefs are in `core/spawn/briefs.ts`.

Checked in the Electron window against a disposable grove (`AGENTIC_GROVE_HOME`), and in
`npm run verify:reliability`.

## Windows is left to contributors

*3 October 2026*

Adrian has no Windows machine, and a Windows build nobody can run is a guess. So the public
release is Mac-only, and the Windows port is no longer something that has to happen before it.
The README's platform table and `CONTRIBUTING.md` ask for it as the most wanted contribution, with
a table of the Mac-specific pieces (session paths, tool lookup, Terminal launching, hooks, tray,
packaging). New code should still prefer cross-platform Electron APIs, so the port stays cheap.
This replaces the 26 September rule that Windows had to land first.

## The window's walls: a security pass before going public

*3 October 2026*

The window already had no node access (`contextIsolation` on, `nodeIntegration` off) and every
IPC handler checked its own input. Added, so a slip elsewhere (say a project name treated as HTML)
still cannot reach the Mac, all in `electron/security.ts` and `electron/page-rules.ts`:

- **A content security policy** in the built page: scripts only from the app, no eval, no
  network from the page. Written in at build time only; the dev server's hot reloading needs more.
  The tree model was loading drei's meshopt decoder, WebAssembly the policy refuses; the model
  uses no meshopt, so the decoder is now off rather than the policy loosened.
- **No navigation away, no new windows, no webviews, every permission refused.**
- **Chromium's sandbox** on the page (`sandbox: true`). The preload was already plain CommonJS.
- **Every IPC message must come from the Grove's own page** (a wrapper round `ipcMain.handle`).
- **Only `claude:`, `codex:` and `cursor:` links** go to the system opener from `openSession`.
- **Fuses** in the packaged app: run-as-Node, `NODE_OPTIONS` and `--inspect` off. Costs one
  development dependency, `@electron/fuses` (Electron's own, nothing ships). The file-protocol
  fuse stays on, since the page reads its model over `file://`.

Checked by `npm run verify:security` (10 checks) and by probing the built app over the debugging
port: outside fetch, `window.open`, navigation, inline scripts and notifications all refused, the
grove still drawn at 59 fps and settings still saved. The Dock app ignored `ELECTRON_RUN_AS_NODE`.

## The untested paths, tested

*3 October 2026*

Three things no one had exercised, now driven in the real app over the debugging port:

- **Photo mode's Save.** Saves a 4320 × 2700 PNG of the scene without the interface. Downloads are
  now limited to photo-mode PNGs (`will-download` in `electron/security.ts`); anything else is
  cancelled, and the save dialog opens on Pictures. The dialog itself was bypassed in the test.
- **Settings → Uninstall**, on a copy of the packaged app with a test grove and a test Claude
  settings file. Hooks came out (other settings kept, backup made), and the grove folder and the app
  went to the Trash. **Bug fixed:** the window's own storage came back after being trashed, because
  Chromium wrote session files on the way out. It is now trashed after the windows are closed, and
  the app exits without the usual shutdown. A grove started with `AGENTIC_GROVE_HOME` now keeps its
  window storage in `<folder>-window`, so tests never share the real app's.
- **The disk image**: the app and an Applications shortcut, valid ad-hoc signature, and Gatekeeper
  refusing it until Open Anyway, as the README says. Pressing Open Anyway needs a person.

## Carved messages: notes for next time

*3 October 2026*

Roadmap idea 9. One note per stone, per agent, and one on the tree, in `grove.json` under `notes`
(`on`, `id`, `text`, and `at` as a readable date). A note waits until work next starts there: a
session on that stone, a run of that agent, or either anywhere for the tree (`core/state/notes.ts`).
Then it is the first thing in that panel; after two and a half seconds open it counts as read,
leaves the file, and fades on screen until the panel closes. A stone with a note to read keeps its
name up in the scene. No amber, since a note is yours rather than something needing you. Notes on a
removed stone or agent go with it. Passing a note into the Claude Code session itself stays a later
step with its own consent. Checked by `npm run verify:notes` (8) and in the built app on a copy of
Adrian's grove.

## Saved tasks work, and the Grove suggests them

*3 October 2026*

Runes could only be written into `grove.json` by hand, and their Run button was still disabled
from before spawning existed. Now a stone's panel lists its runes with Run (through the same
Terminal launcher as the console; the node side reads the prompt from `grove.json`, the page only
names the rune), a bin that asks twice, and "Save a task you repeat here". Roadmap idea 6 sits on
top: when three or more sessions in one project opened with the same prompt (case, spacing and end
punctuation ignored, nothing fuzzier), the stone offers to save it; "No" is kept in
`declinedRunes`. Only the first prompt of each session counts, because later lines are
conversation. Prompts at the scan's 240-character cut-off are never offered, since they may be half
a job, and neither are the Claude app's "# Files mentioned by the user" headers (both found by
running the rule over Adrian's 107 real sessions, which now suggest nothing). A rune with no agent
goes to whoever the console would pick. Checked by `npm run verify:suggest-runes` (8) and in the
built app with made-up sessions under a fake home folder. Running a rune for real was not
exercised, to avoid starting a real Claude session; it is the console's launcher, which
`verify:spawn` covers.

## An hour left running: what the Grove costs

*3 October 2026*

The packaged app ran for an hour on a copy of Adrian's grove (Apple Silicon Mac, Grove graphics,
adaptive on), sampled every 30 seconds by total CPU time across its processes. The window happened
to spend part of the hour covered and part of it visible, which measured both cases:

- **Covered or minimised:** about **2% of one core**. Chromium stops drawing; what remains is the
  scan and the hook listener.
- **Visible:** about **67% of one core**, steady, drawing at 60 fps even with nothing happening.
- **Memory:** 300 to 530 MB across all processes, ending lower than it started. No sign of a leak.

The visible figure is too high for something meant to sit on a screen all day, against "calm by
default". The obvious next step is review item 8's quiet idle mode: draw fewer frames when nothing
is running or moving, and full speed again the moment something happens.

## Quiet mode: 8 frames a second when nothing is happening

*3 October 2026*

After the hour-long run showed a visible idle grove at two-thirds of a CPU core, the scene now
drops to 8 frames a second after ten seconds with no input, no agent running or waiting, no
deployment and no photo mode (`quiet` in `src/App.tsx`, through the existing frame cap). Any mouse
movement, key or scroll, or any work starting, brings full speed back at once. While quiet, the
adaptive graphics ignore the frame rate, so a slow-on-purpose grove is not mistaken for a slow Mac.
On by default, with a switch in Settings → Graphics.

Measured in the built app on a copy of Adrian's grove, visible, total CPU time of every process:
about 53% of a core awake, 20% quiet at 12 fps, **16% at 8 fps**, 11% at 4 fps. Roughly 6% is fixed
(the scan, and the interface's frosted panels re-blurring over a changing scene) and each frame per
second adds about 1%. 8 keeps the heartbeat readable; 4 looked like a slideshow. The page's own
JavaScript was 94% idle while quiet, so what remains is drawing, not code.

## The far floor: mist circling the clearing

*3 October 2026*

Adrian asked for the background to be "a tiny bit more interesting". The top third of the home
view was flat dark: the camera looks down at about thirty degrees, so what fills it is the far
floor fading into fog, not a sky. A first try stood a misty veil up on the horizon and it was
simply out of shot. `src/scene/Veil.tsx` instead lays faint green mist on the floor in a wide ring
from just past the stone places out into the fog, in long arcs that drift round the grove over
minutes. It brightens a little with the same activity measure as the heartbeat, never turns amber,
and holds still under reduced motion or with drifting motes switched off. One flat mesh and one
small shader. Judged in `?demo`: twice the final brightness already competed with the tree, so it
sits at the level where you notice depth before you notice mist.
