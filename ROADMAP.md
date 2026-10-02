# Roadmap

Where Agentic Grove is going. The build runs in numbered steps, each about one working session;
ideas are ranked by how much they help against what they cost, favouring ideas that reuse data
the Grove already has (the scan plus Claude Code hooks). Decisions made along the way are in
[DECISIONS.md](DECISIONS.md).

## The build plan

| | Step | Status |
| --- | --- | --- |
| 1 | Repo, Electron skeleton, harness adapters returning real sessions | Done |
| 2 | Poll loop, IPC bridge, live sessions on screen | Done |
| 3 | Look-development spike: scene, bloom, the tree, a runestone | Done |
| 4 | Real session data in the scene: a stone per project, lit when running | Done |
| 5 | Heartbeat driven by real activity, mycelium, drifting motes | Done |
| 6 | Hook installer and local listener, so changes arrive instantly | Done |
| 7 | The crystal (usage and rate-limit headroom, with provenance), and a menu-bar shard | Done |
| 8 | Agent definitions, the tree panel, the agent carousel | Partly: built-in Researcher, Builder, Manager |
| 9 | Spawning agents, deploy-to-runestone animation, live transcript view | Done: launches your own Claude Code or Codex in Terminal (see DECISIONS.md) |
| 10 | The rune console: natural-language routing to an agent and a stone | Done: plain rules with a preview (`core/console.ts`) |
| 11 | Attention: motes, notifications, answer-or-wait behaviour | Done: see DECISIONS.md |
| 12–13 | Settings, onboarding, empty states, keyboard shortcuts, performance presets | Partly: settings, graphics modes, one-button setup, update check |
| 14 | Packaging, notarised Mac build, DMG | Done, unsigned: `npm run dmg` (no release published yet) |
| 15 | README with an honest capability table, screenshots, a demo GIF | |

Before the public release:

- **A downloadable build.** Step 14 (packaging, DMG) and a first GitHub release, or the update
  check has nothing to find. Unsigned, so the README explains the one-time "Open anyway".
- **Windows support.**
- **Official Claude limits. Done 2 October 2026**, by a different route: a check you press in
  Settings runs your own Claude Code once and reads the limits it prints (`core/usage/probe.ts`).
  Off by default. It works for desktop-app and terminal users alike, so the statusline route is
  no longer needed.

## The long-run aim

Written down on 30 September 2026 so later work can be judged against it. In the long run the
Grove is an **agentic operating system**. Picture someone in a café with a laptop: the Grove runs
all their agents and AI connectors (for now Claude, ChatGPT and their agents), they give it a
project, an objective or a vision, and agents from different providers work on it together, for
hours at first and days later on, asking the person questions only when they need to. Everything
in the build plan should move towards that without breaking the principles: honest numbers, calm
by default, read-only towards other tools.

## From Adrian's notes, 30 September 2026

| | Note | Status |
| --- | --- | --- |
| 1 | One-button setup for Claude Code and Codex, first time and in Settings | Done |
| 2 | Builder and Manager on the tree by default, beside Researcher | Done (routing rules in `core/routing.ts`; wired in step 10) |
| 3 | Limit providers to Claude and ChatGPT; replace Grok Bots with ChatGPT Dots | Done |
| 4 | Crystal readout does not close on a click elsewhere | Fixed |
| 5 | The plus beside the console takes files | Done (sent with the console, step 10) |
| 6 | Click the tree to see its agents | Done |
| 7 | Rail tabs that do something | Done: Projects, Saved tasks, Activity |
| 8 | More settings, kept through updates | Done |
| 9 | Daily update check and a download button | Done (needs a public repo and releases) |
| 10 | Full screen more immersive, interface a little larger | Done |
| 11 | Agents / Open / Task clearer | Done |
| 12 | Graphics modes: Performance, Balanced, Grove, adapting to load | Done |
| 13 | Five-hour usage at a glance, week on hover, per provider | Done. Codex from its own records; Claude from a check you press in Settings (off by default), see DECISIONS.md |
| 19 | Help install the Claude and ChatGPT apps too | Done (opens each maker's download page) |
| 20 | README: platforms (Mac only; Linux, then Windows) and room for other models | Done |
| 14 | Thicker mycelium | Done |
| 15 | Home view slightly right, down and further out | Done, to be judged |
| 16 | Remove the sparkle icon | Done |
| 17 | Sub-stones for big parts of a project | Done (suggested, never automatic) |
| 18 | The agentic operating system | The long-run aim, above |

## Chosen for future sessions

Picked on 27 September 2026, after step 6. Ranked, most important first.

1. **Keyboard grove. Done 27 September 2026.** Arrow
   keys walk between stones, Enter opens one, R lists its runes, Esc goes back. The whole grove is
   usable without a mouse. Each move is announced through the existing live region, which
   `HoverReadout` in `src/hud/Hud.tsx` already flags as the half-answer waiting for this. Ranked
   first because accessibility is a requirement for release, not a nice-to-have.
2. **Tells. Done 27 September 2026, from transcripts rather than hooks.** When an agent's work looks unsure, its light
   flickers once. Signals, all from hooks: the same tool call failing several times in a row, an edit
   undone by a later edit, or a session that ends straight after an error. A quiet flag for work worth
   checking, never an alarm. Say what triggered it on hover, so the flag can be judged, not trusted.
3. **The tree answers. Done 2 October 2026** (`core/history.ts`, `src/hud/Answer.tsx`,
   `npm run verify:history`). Ask the console
   about your own history, such as "what did I do on Tuesday?", and the stones involved light up in
   order while the answer is written out. The world becomes the answer. Answers come from the scan
   and hook history on this machine; say so when the history does not reach back far enough.
4. **Clearings (about one session).** Group stones into small clearings by theme, such as work, side
   projects or experiments, with a low ring of stones round each. It organises the grove without
   folders, and it is what keeps a grove of 25 stones readable. Clearings are yours
   to name and arrange; the Grove may suggest one, never file a stone on its own.
5. **Passing agents (about one session). Needs spawning and the console (steps 9 and 10).** A
   generic task typed into the console, one that fits no existing agent, creates a general-purpose
   agent for it. It arrives as a wisp does, at the trunk, but stays for follow-ups instead of fading
   straight away. If the next three prompts go elsewhere, it finishes, walks off and is gone; nothing
   is saved. When passing agents keep being called up for the same kind of task, the Grove offers
   to make one a permanent agent on the tree, never a silent promotion. Extends wisps, the one-off tasks that spark at the trunk and fade.
6. **Suggested runes (about one session). Needs runes (steps 8 to 10) first.** Spot prompts sent
   more than once in the same project, such as "run the tests" or "review the diff", from
   transcripts and `UserPromptSubmit` hooks. Offer to carve each into that stone as a rune. Nothing
   is carved without a yes, and a declined suggestion stays declined. Ranked high because it turns
   habits into one-click tasks, which is the Grove doing work, not just showing it.
7. **Echo test (about half a session). Needs the console's routing (step 10).** Type a prompt
   without running it, and a ghost wisp shows which stone and agent the console would pick. A preview
   before committing to anything, and the cheapest way to learn how routing thinks.
8. **Twin stones (about half a session). Can be built now.** Two stones for the same repo on
   different branches or worktrees stand side by side, joined at the base. The scan already records
   each session's worktree (`worktree` in `core/harnesses/types.ts`), so the data is there.
9. **Carved messages (about half a session).** Leave a note for your future self on a stone, an agent
   or the tree. When the next session starts there, the note is shown first, then fades once read.
   Passing the note into the Claude Code session itself (through a `SessionStart` hook's output)
   would be a second step with its own consent, because the current hook deliberately says nothing
   back.
10. **Photo mode. Done 2 October 2026** (`src/scene/Photo.tsx`, `src/hud/Photo.tsx`; P, or PHOTO beside
    Home view). Hide the interface, adjust the angle and depth of field,
    and save a high-resolution image. Good for sharing, and it makes the README screenshots of
    step 15, so build it before then.
11. **Pollination (about one session). Needs runes, and builds on suggested runes.** When a rune
    works well on one stone (it has run several times and ended cleanly), a seed drifts through the
    roots to other stones with a similar tech stack and offers to plant the same rune there. Good
    habits spread between projects. Same consent rule as suggested runes: an offer, never a planting.
12. **Ambient sound, off by default (about half a session).** A low tone that follows the heartbeat,
    slower at rest and quicker while agents work, plus a soft chime when an agent finishes. For when
    the Grove is open but out of view. Until then the Grove makes no sound at all. Pair it with step 11, the attention
    system.
13. **Hand-offs as light (about half a session).** When one session starts right after another
    finishes in the same project, a pulse travels through the roots between them, so chained work
    reads as a chain. Hooks already give exact start and end times, so this can come any time after
    step 6.
14. **Mushrooms. Done 30 September 2026** (`core/state/pairings.ts`, `src/scene/Mushrooms.tsx`). Small caps spring up where the roots of two
    stones cross, when both stones had a session in the same hour. They map which projects you work
    on together, and fade if the pairing stops.
15. **Caustics under the stones (about half a session). Can be built now.** A running stone throws
    slowly moving light patterns onto the moss around it, like light through water. Shows activity
    without adding UI. Keep it to a projected texture so the frame rate does not notice; still under
    reduced motion.
16. **Root depth (about half a session). Can be built now.** The longer a project has been worked on,
    the deeper and wider its roots spread under the ground. Driven by the span of its session history
    in the scan, eased so the difference between a week and a month shows more than between one year
    and two. The oldest projects look the most settled.
17. **Idle drift (about half a session).** After 5 minutes with no input, the camera starts a very
    slow orbit, so the Grove works as a screensaver on a spare screen. Any input stops it and eases
    the camera home. Off under reduced motion, and paused while a stone needs attention so the
    camera does not turn away from it.
18. **Agents grow over time (about one session). Keep it subtle.** An agent's orb gains detail as it
    completes sessions, a faint extra ring or a little more inner light, so a month-old agent looks
    lived-in beside a new one. The change should be noticed over weeks, not seen in a day; no
    levels, counters or badges.
19. **Apprentices (about one session). Needs agent definitions (step 8).** A new agent made from
    an old one's prompt starts as a small light that follows its parent round the tree until it has
    run a few sessions on its own, then takes its own place. Pairs with "agents grow over time".
20. **Eclipse (about half a session).** When more than 10 agents are working at once, the light dims,
    a ring appears around the tree, and then it passes. A rare event you remember. Shown at most once
    a day, and as a still ring with no dimming under reduced motion.
21. **Morning dew (about half a session).** The first time the Grove opens each day, the scene starts
    misty and clears as it loads. Stones with overnight activity break through the mist first. Delight
    more than information, so last; fits the polish steps (12 and 13).

## Not for v1

Recorded so they are not lost. Ranked the same way.

1. **Fireflies as notifications. Built in step 11** (`src/scene/AttentionMotes.tsx`). When an agent needs you, a mote detaches from its stone and
   drifts to hover near the trunk. Subtle, but you notice it from the corner of your eye. Likely absorbed
   by step 11.
2. **Withering.** A project untouched for weeks slowly loses leaves above its stone. A visual
   memento of neglect, and genuinely useful information. Matches the default for
   neglected work.
3. **Archive grove.** Completed projects walk off to a second, dimmer clearing rather than
   vanishing.
4. **Grove sharing.** Export a `grove.json` as a starting configuration others can import. Fits the
   open-source intent.
5. **Seeded stones.** Plant a runestone from a template, a prompt pack or skill set, and it grows as
   the project accumulates work.
6. **Seasons.** The grove shifts palette with the system clock, colder and dimmer at night.

The earlier "Ambient drone" note is folded into item 2 of the chosen list.
