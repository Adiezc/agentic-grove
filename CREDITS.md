# Credits

Agentic Grove exists because other people published their work and let others use it. This file
is written before the feature code, not after it, and it is a condition of the project rather
than a courtesy.

The initial reference review was made on **12 September 2026**; later readings have their own
dates below. The **13 October 2026** distribution audit follows the actual production build,
including package and font notices. Where upstream notices are incomplete or contradict package
metadata, that is recorded rather than silently guessed.

---

## Code we use

### pmndrs/meshline — MIT

[MeshLine](https://github.com/pmndrs/meshline/tree/4df8778398e086628076267c67552c079d39be85), read 14 October 2026. Copyright (c) 2016 Jaume Sanchez.

The previous/current/next direction averaging from `src/MeshLineMaterial.ts` and paired
side/width strip layout from `src/MeshLineGeometry.ts` are adapted in
`src/scene/myceliumStrip.ts`. Grove expands the floor wash on the ground plane with bounded
miter joins. Fine cores also adapt the projected previous/next expansion in `src/scene/Mycelium.tsx`
to keep ambient unowned hairs visible at shallow camera angles; the original journey coordinates are retained.
Project connections use physical tapered cord bodies. Their finest surface veins also use
the projected expansion at subpixel widths so the dense web remains visible at grazing angles.
Dash rendering, raycasting and the memcpy helper are not copied.
Credit follows the original spite/THREE.MeshLine work and pmndrs maintainers/contributors.
The full [MIT notice](licenses/meshline.txt) is preserved and bundled.

### leoawen/fluffytree-threejs — MIT

[FluffyTree](https://github.com/leoawen/fluffytree-threejs/tree/f39d9526aadecdf4026de8853e7891736c5063b3), read 13 October 2026. Copyright (c) 2025 Leonardo Soares Gonçalves.

The canopy material in `index.html/createCustomCanopyMaterial` is adapted in
`src/scene/foliageMaterial.ts`: smooth canopy gradients and soft world-up normals.
Grove retains its authored geometry and Standard materials, uses darker colours and
blends the normals. The initial Ashima-noise wind was subsequently replaced by the
Cortiz wind adaptation credited below. Wind is small and disabled with ambient motion
or reduced motion. Demo assets, the GUI and
embedded Perlin implementation are not copied. The full [MIT notice](licenses/fluffytree-threejs.txt) is retained.

### jakobrichert/space-colonization — MIT

[Space Colonization](https://github.com/jakobrichert/space-colonization/tree/34966a3cece4a1d6f69f26631db93ffec200f545), read 13 October 2026. The original notice reads Copyright (c) 2026 Jakob.

The nearest-node association, averaged-direction growth, attraction-point removal and
square-root leaf-count thickness from `src/tree.c` are ported to
`src/scene/colonizeRoots.ts`. Grove supplies seeds along existing roots, bounds the growth
to six small fans and uses a linear nearest search rather than the original spatial grid.
`src/scene/network.ts` turns the result into joined woody/mycelial twigs with inherited
project ownership. The raylib app is not included. The upstream method credits Adam Runions,
Brendan Lane and Przemyslaw Prusinkiewicz. The full [MIT notice](licenses/space-colonization.txt) is retained.

The same growth and thickness port now builds three-dimensional mycelial branches in
`src/scene/myceliumBundles.ts`; `src/scene/rootCord.ts` and `Mycelium.tsx` construct lit tapered
slender cord bodies with smooth green emission and luminous surface veins. The geometry approach follows
[Modeling Trees with a Space Colonization Algorithm (2007)](https://algorithmicbotany.org/papers/colonization.egwnp2007.pdf),
including its generalized-cylinder and pipe-model explanation. It is a stylized visual adaptation,
not a biological simulation of fungi. No paper text, figures or assets are copied.
Grove adds its own fork-and-rejoin fan layout, sparse luminous junctions and variable bundle
width around the credited growth system. User-supplied images guide the appearance only.

### ashima/webgl-noise — MIT

[ashima/webgl-noise](https://github.com/ashima/webgl-noise/tree/6abed1e77ed1e18b181627c35f688eb30c9fe75e), read 13 October 2026.

Ian McEwan and Ashima Arts authored the 3D simplex noise function, maintained by Stefan Gustavson.
`src/noise3D.glsl` is preserved verbatim in `src/scene/vendor/ashima-noise3D.glsl`.
Grove's woodland material uses it for fine grain and irregular moss coverage on the authored tree.
The original header and full [MIT notice](licenses/ashima-webgl-noise.txt) are retained.

### owenyuwono/dryad — MIT

[Dryad](https://github.com/owenyuwono/dryad/tree/e85729b779708c50b7d65ddd34d524f42da88705),
read 14 October 2026. Copyright (c) 2026 owenyuwono.

`barkHash`, `barkNoise`, `ridgeOctave`, `barkWarpFBM` and `ridgedFBM` from
`src/barkMaterial.js` are adapted in `src/scene/vendor/dryad-bark.glsl` and used by
`woodlandMaterial.ts` for living trunk and pale deadwood grain. Grove reduces the
ridge field to four antialiased octaves and samples authored strand angle/arc length,
with separate deadwood weathering and living moss. Baked colours, geometry and
heartbeat remain Grove's. No genome, skeletal wind, SDF renderer or demo assets
are imported. The full [MIT notice](licenses/dryad.txt) is packaged with the app.

### Poly Haven and ambientCG — CC0

Photographed textures in `assets/materials/`, downloaded 14 October 2026 and unmodified:
[Chinese Cedar Bark](https://polyhaven.com/a/chinese_cedar_bark) by Charlotte Baglioni and
[Rough Wood](https://polyhaven.com/a/rough_wood) by Rob Tuytel (Poly Haven), and
[Leaf Set 019](https://ambientcg.com/view?id=LeafSet019), photographed juniper-like scale-leaf sprays, by ambientCG (Lennart Demes). All are CC0, so
no credit is required; it is given anyway. `woodlandMaterial.ts` wraps the bark and deadwood
round every strand along its carved grain and uses them as brightness detail and normal maps,
keeping the baked palette; `foliageMaterial.ts` cuts each spray card to the photographed outline and
takes its scale pattern as brightness and its normal map as lighting. Sources are listed in [licenses/cc0-textures.txt](licenses/cc0-textures.txt).

### dgreenheck/ez-tree — MIT

[EZ-Tree](https://github.com/dgreenheck/ez-tree/tree/dcf309bd86bd521083d9c70f01f2de45fdc7c457),
read 14 October 2026. Copyright (c) 2024 Daniel Greenheck.

The branch-growth method in `src/lib/tree.js` (`#growBranch` and `generateChildBranches`)
is ported to Python in `scripts/build-world-tree-blender.py` (`ez_limb`, `ez_children`,
`pad_branches`) and grows the canopy boughs, their side branches and twigs baked into the tree model. Each branch
walks in short sections, kinks by a random gnarliness that grows as it thins (1/sqrt of its
radius) and turns toward a growth force by at most strength/radius; children sit in
stratified, shuffled slots along and around their parent. Grove steers toward the authored
foliage pads instead of a world axis, keeps twigs inside the pad they support, and flattens
them the way bonsai twigs are wired. No leaves, bark textures, presets, wind or demo assets
are imported. The full [MIT notice](licenses/ez-tree.txt) is packaged with the app.

### cortiz2894/stylized-components — MIT

[Stylized Components](https://github.com/cortiz2894/stylized-components/tree/1cece0a296b29299d1380c34feb5c158b2f04500),
read 14 October 2026. Copyright (c) 2026 Christian Ortiz (Cortiz).

The smooth hash/noise colour patches and height gradient from
`src/components/grassField/materials/pineLeafMaterial.ts`, plus the squared height
mask, world-to-local wind rotation, sway/flutter and pendulum dip from
`src/components/grassField/shaders/pineLeaf.ts`, are adapted in `foliageMaterial.ts`.
Grove retains its authored broad leaves, original material colours, Standard lighting
and reduced-motion controls, with restrained amplitudes and no external assets.
The luminance/desaturation treatment from `materials/barkMaterial.ts` is also adapted
in `woodlandMaterial.ts` to keep the deadwood pale as grain varies. The full
[MIT notice](licenses/stylized-components.txt) is packaged with the app.

### linusmossberg/reaction-diffusion — MIT

[linusmossberg/reaction-diffusion](https://github.com/linusmossberg/reaction-diffusion/tree/f4a7ffbbae22648a67350dd8a10d96632ca8ed61), read 13 October 2026. Copyright (c) 2020 Linus Mossberg.

The reaction, dissipation, diffusion weights and stable time step from
`shaders/reaction-diffusion.glsl` are adapted to an offline JavaScript generator,
`scripts/bake-woodland-mask.mjs`. Grove uses the isotropic case of its nine-point kernel,
periodic edges and deterministic seed patches to bake `assets/materials/woodland-lichen.png`.
The upstream shader cites the diffusion method by Andrew Witkin and Michael Kass.
Grove does not copy the demo UI, external libraries or images, and runs no live simulation.
The full [MIT notice](licenses/linus-mossberg-reaction-diffusion.txt) accompanies the adaptation.

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

---

## Ideas we use, without taking code

### jarrodwatts/claude-hud — MIT

<https://github.com/jarrodwatts/claude-hud> · Jarrod Watts and contributors

Its optional tools, agents and todos readouts informed the activity details shown when you open
a stone or run panel. We read the README and MIT licence at revision
`02d73c416b52b4e510a9be004fca469f961cd5bc` on 13 October 2026. Grove's bounded transcript
projection and panel code are independently written; no Claude HUD source or assets are copied.
The details stay inside the selected panel, show evidence timestamps and treat recorded tool
calls and reported todos as observations, never proof that tests passed or work was accepted.

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

Grove's interface uses React and React DOM, Three.js, React Three Fiber, drei, postprocessing,
React Three Postprocessing and Zustand. Phosphor supplies the icons and Geist Variable supplies
the locally bundled font. Thank you to their authors and the maintainers of the supporting
libraries that reach the bundle. Vite and TypeScript are development tools.

The build records the exact packages whose modules reach the renderer, main process and preload,
including transitive packages such as maath, n8ao and Babel's runtime helpers. `npm run build`
generates human credits, the Grove licence, complete available upstream licence texts and
embedded source notices in `dist/attribution/`. The signed Mac app carries these documents plus
Electron's MIT licence and its complete Chromium notices. Open them through **Agentic Grove →
About Agentic Grove**, **Settings → Credits and acknowledgements**, the adjacent native
Credits/Licences menu items or the menu-bar shard's
**About and credits** entry. Declaring dependencies alone does not replace their required notices.

Two packages need version-specific records in `attribution.json`: React Three Fiber 9.7.0 omits
its MIT file from npm, so we retain the original from its exact release commit. Maath 0.10.8
declares MIT but has no standalone licence or package-wide copyright notice in its published
package or release tree; `licenses/maath-0.10.8.txt` records that limitation, the declared terms
and their provenance without inventing a holder or substituting the new math repository's 2026
licence. Its embedded Max Kaufmann MIT and Stefan Gustavson public-domain notices are retained.
N8ao 2.0.1's metadata says ISC while its actual licence file is CC0-1.0; the supplied CC0 text
travels with the app and the mismatch is recorded. These exceptions require review on upgrade.

The Geist font's original SIL Open Font License is included in full. The tree model, scene
geometry, material code and menu-bar/logo assets are authored for Grove; no Material Design
Icons or Kay Lousberg asset packs are included. No Framer Motion code is bundled.

`@electron/packager` (BSD-2-Clause) builds the Mac app for `npm run app` and `npm run dmg`; it is a
development tool only, and none of it ships inside the app.

Research candidates do not become "code we use" merely because they have been suggested. Future
source, asset or algorithm adaptations get their own original notices and an accurate credit
when adopted. Ideas written independently are identified separately above.

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
