/**
 * The grove: the scene, and the interface over it.
 *
 * Your projects stand as the runestones: the ones you created or connected, nothing else. The
 * concept art's six fixtures appear only in demo mode; see `demo.ts`.
 * The raw session data is one click away behind the rail's pulse icon, so the scene can always
 * be checked against the truth underneath it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import '@fontsource-variable/geist'
import { GroveScene, SPIKE_STONES, type PerfSample, type QualityPreset } from './scene/Grove'
import { Announcer, Counts, HealthLine, Rail, RuneConsole, useFullScreen, useIdle, usePrefersReducedMotion, type RailPanel } from './hud/Hud'
import { ProjectsPanel, RunesPanel } from './hud/Panels'
import { Providers } from './hud/Providers'
import { SessionList } from './SessionList'
import { SceneGuard } from './scene/SceneGuard'
import { AgentCard, DeployToast, GrowCard, PickHint, RunPanel, STATE_LABEL, StonePanel, useRuns } from './hud/Flow'
import type { RunState } from '../core/spawn/runs.ts'
import { pairings, type Pairing } from '../core/state/pairings.ts'

/** Run states in which the agent is still at the stone: sent and not yet confirmed, working, or asking. */
const LIVE_RUN: ReadonlySet<RunState> = new Set(['starting', 'running', 'waiting'])
import { Intro } from './hud/Intro'
import { SettingsPanel } from './hud/Settings'
import { useFlow } from './store/flow'
import { useGrove } from './store/grove'
import { Crystal } from './hud/Crystal'
import { childPlace, emptyPlaces, layoutStones, stonePlaces, twinPlace } from './scene/layout'
import { step, type Direction, type Target } from './scene/navigation'
import { DEMO } from './demo'
import { useTree } from './agents/tree'
import { saveSettings, useSettings } from './store/settings'
import { usePhoto } from './store/photo'
import { useAnswer } from './store/answer'
import { PhotoBar } from './hud/Photo'
import { sceneFor, useAdaptiveGraphics, useDrawing } from './scene/graphics'
import './hud/hud.css'

/**
 * `?demo&split` adds two sub-stones branching off Build, to judge how a project that splits looks.
 * Kept out of plain `?demo`, which exists to compare against the concept art.
 */
const SPLIT = DEMO && new URLSearchParams(window.location.search).has('split')
/** `?demo&twin` stands a worktree of Research beside it, on its own branch, to judge twin stones. */
const TWIN = DEMO && new URLSearchParams(window.location.search).has('twin')
const buildAt = SPIKE_STONES.find((stone) => stone.id === 'build')!.at
const researchAt = SPIKE_STONES.find((stone) => stone.id === 'research')!.at
const DEMO_STONES = [
  ...SPIKE_STONES.map((stone) => (TWIN && stone.id === 'research' ? { ...stone, branch: 'main' } : stone)),
  ...(SPLIT
    ? [
        { id: 'build/web', name: 'Web', rune: 'celi' as const, status: 'running' as const, at: childPlace(buildAt, 0), scale: 0.74, turn: 0.1, parent: 'build' },
        { id: 'build/api', name: 'API', rune: 'avi' as const, status: 'idle' as const, at: childPlace(buildAt, 1), scale: 0.72, turn: -0.12, parent: 'build' },
      ]
    : []),
  ...(TWIN
    ? [
        { id: 'research-wt', name: 'new-survey', branch: 'new-survey', rune: 'neta' as const, status: 'running' as const, at: twinPlace(researchAt, 0), scale: 0.84, turn: -0.08, parent: 'research', twin: true },
      ]
    : []),
]

/** Who the demo shows working on its running stones, as in the concept art's frame 1. */
const DEMO_WORKERS: Record<string, string> = { research: 'researcher', build: 'builder', connect: 'researcher' }
/** Two pairings for judging the mushrooms against the art: one busy and fresh, one light and fading. */
const DEMO_PAIRS: Pairing[] = [
  { a: 'compute', b: 'data', hours: 8, freshness: 1 },
  { a: 'build', b: 'connect', hours: 2, freshness: 0.4 },
]

const ARROWS: Record<string, Direction | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

/**
 * Move keyboard focus into something that has only just been asked to open. A panel stays
 * `inert` until React has re-rendered it, and a focus call on an inert element is silently
 * ignored, so this keeps trying for about half a second until focus has actually arrived. A timer
 * rather than animation frames, because frames stop while the window is hidden.
 */
function focusSoon(selector: string): void {
  let tries = 0
  const attempt = () => {
    const element = document.querySelector<HTMLElement>(selector)
    element?.focus()
    if (element && document.activeElement === element) return
    if ((tries += 1) < 20) window.setTimeout(attempt, 25)
  }
  window.setTimeout(attempt, 0)
}

const driftSeconds = Number(new URLSearchParams(window.location.search).get('drift'))
/** How long the grove waits, untouched, before the camera starts its slow turn. */
const DRIFT_AFTER_MS = driftSeconds > 0 ? driftSeconds * 1000 : 5 * 60_000

/** Shared, so an empty grove is the same value from one render to the next. */
const NO_STONES: never[] = []

export function App() {
  const [dataOpen, setDataOpen] = useState(false)
  /** Bumped to draw the scene again from scratch, after it failed. */
  const [sceneKey, setSceneKey] = useState(0)
  const [contextLost, setContextLost] = useState(false)
  const [panel, setPanel] = useState<RailPanel>(null)
  const settingsOpen = panel === 'settings'
  const [perf, setPerf] = useState<PerfSample | null>(null)
  const [post, setPost] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const [viewResetKey, setViewResetKey] = useState(0)
  /* The graphics mode comes from Settings, stepped down by `useAdaptiveGraphics` when the Mac is
   * busy. A preset forced here, for measuring one preset's cost on a cold launch, wins over both:
   *     VITE_GROVE_QUALITY=low npm run dev
   * The `q` key cycles the forced preset while judging the look. */
  const [forced, setForced] = useState<QualityPreset | null>(() => {
    const wanted = import.meta.env.VITE_GROVE_QUALITY
    return wanted === 'low' || wanted === 'balanced' || wanted === 'high' ? wanted : null
  })
  const settings = useSettings()
  const drawing = useDrawing((state) => state.mode)
  const scene = sceneFor(drawing)
  const quality = forced ?? scene.quality
  const reducedMotion = usePrefersReducedMotion()
  const fullScreen = useFullScreen()
  const consoleInput = useRef<HTMLInputElement>(null)
  const tree = useTree()
  const view = useFlow((state) => state.view)
  const stoneId = useFlow((state) => state.stoneId)
  const statusOverrides = useFlow((state) => state.statusOverrides)
  const openAgents = useFlow((state) => state.openAgents)
  const photo = usePhoto((state) => state.on)

  const snapshot = useGrove((state) => state.snapshot)
  const deployment = useFlow((state) => state.deployment)
  const runs = useRuns()
  useAdaptiveGraphics({
    chosen: settings.graphics,
    adaptive: settings.adaptiveGraphics,
    fps: perf?.fps ?? null,
    cpu: snapshot?.system.cpu ?? null,
    displays: snapshot?.displays ?? 1,
  })

  /* Your projects, from the scan. A new grove has none, and that is the intended first sight: the
   * tree, Researcher, and three empty circles. The concept art's six stones appear only in demo
   * mode (`?demo`), for judging the scene against the art in a browser tab.
   *
   * A real stone lights only when the scan or the hooks say work is happening there, never
   * because a deployment is in flight: a Terminal window that has not started Claude Code yet is
   * not work, and saying otherwise would break the one rule the grove cannot break, which is not
   * to invent state. The demo stones are pretend, so there the deployment is allowed to stick.
   *
   * An agent you sent shows its face above the stone for as long as its run is live, so "who is
   * working there" names the agent, not only the tool. */
  const real = snapshot?.grove.stones ?? NO_STONES
  const stones = useMemo(() => {
    const base = DEMO ? DEMO_STONES : layoutStones(real)
    return base.map((stone) => {
      const lit = DEMO ? statusOverrides[stone.id] : undefined
      // While an agent is on its way, or (in the demo) once it has landed, its face joins the
      // stone's workers so you can see who went where.
      const sent = deployment?.stoneId === stone.id ? deployment.agentId : DEMO ? DEMO_WORKERS[stone.id] : undefined
      const live = runs.filter((run) => run.stoneId === stone.id && LIVE_RUN.has(run.state)).map((run) => run.agentId)
      const workers = [...new Set([...(stone.workers ?? []), ...live, ...(sent ? [sent] : [])])]
      return { ...stone, status: lit ?? stone.status, workers }
    })
  }, [real, deployment, statusOverrides, runs])
  // Worked out once per snapshot, against the snapshot's own clock, so a quiet grove does not redo it.
  const snapshotAt = snapshot?.at ?? 0
  const pairs = useMemo(() => (DEMO ? DEMO_PAIRS : pairings(real, snapshotAt)), [real, snapshotAt])
  // Keyed on the places themselves, so the circles are only worked out again when a stone comes or goes.
  const usedKey = [...stonePlaces(real).values()].sort((a, b) => a - b).join(',')
  const empty = useMemo(() => (DEMO ? [] : emptyPlaces(usedKey ? usedKey.split(',').map(Number) : [])), [usedKey])
  const selectedName = stones.find((stone) => stone.id === stoneId)?.name
  const goHome = () => {
    useFlow.setState({ view: 'home', stoneId: null, pendingAgentId: null })
    setDataOpen(false)
    setViewResetKey((key) => key + 1)
  }
  const showDebug = new URLSearchParams(window.location.search).has('debug')
  // Photo mode starts from the home view with everything closed, and hands the home view back after.
  const enterPhoto = () => {
    setPanel(null)
    goHome()
    usePhoto.getState().enter()
  }
  const leavePhoto = () => {
    usePhoto.getState().leave()
    goHome()
  }

  /* ---- Keyboard grove: arrows move between stones and empty circles, Enter opens. ---- */

  const targets = useMemo<Target[]>(
    () => [
      ...stones.map((stone) => ({ id: stone.id, at: stone.at })),
      ...empty.map((place) => ({ id: `place-${place.index}`, at: place.at })),
    ],
    [stones, empty]
  )
  const focused = useFlow((state) => state.focused)
  const [announcement, setAnnouncement] = useState('')

  // Whatever the pointer rests on is announced, as it always was.
  useEffect(() => {
    const name = hovered ? stones.find((stone) => stone.id === hovered)?.name : undefined
    if (name) setAnnouncement(`${name} runestone`)
  }, [hovered, stones])

  /** One sentence about a target, in the words the labels and the stone panel already use. */
  const describe = useCallback(
    (id: string): string => {
      if (id.startsWith('place-')) return 'Empty place. Enter to create or connect a project.'
      const stone = stones.find((candidate) => candidate.id === id)
      if (!stone) return ''
      const check = stone.tells?.[0] ? ` Worth checking: ${stone.tells[0].detail}.` : ''
      return `${stone.name} runestone, ${STATE_LABEL[stone.status].toLowerCase()}.${check} Enter to open.`
    },
    [stones]
  )

  // A stone that disappears (hidden, disconnected) takes the keyboard focus with it.
  useEffect(() => {
    if (focused && !targets.some((target) => target.id === focused)) useFlow.getState().focus(null)
  }, [focused, targets])

  // The scan keeps running behind the scene even though the spike does not draw it, so opening
  // the data panel shows something immediately rather than scanning from cold.
  const connect = useGrove((state) => state.connect)
  useEffect(() => connect(), [connect])
  // A clicked notification opens its run: the stone chosen, the run panel showing.
  useEffect(
    () =>
      window.grove?.onFocusRun((runId) => {
        const run = useGrove.getState().snapshot?.runs.find((each) => each.id === runId)
        if (!run || useFlow.getState().deployment) return
        useFlow.setState({ stoneId: run.stoneId, placeIndex: null })
        useFlow.getState().openRun(runId)
      }),
    []
  )

  /**
   * The keyboard grove's keys. Returns true when it handled the key.
   *
   * Enter and R act only when nothing else has keyboard focus: a focused button already owns
   * Enter, and taking it would break every button on screen. The arrows work from anywhere but
   * the agents view, whose card has its own controls.
   */
  const moveFocus = useCallback(
    (event: KeyboardEvent): boolean => {
      const flow = useFlow.getState()
      if (flow.view === 'agents' || flow.deployment) return false
      const direction = ARROWS[event.key]
      if (direction) {
        event.preventDefault()
        const next = step(targets, flow.focused, direction)
        if (next && next !== flow.focused) {
          flow.focus(next)
          // The first move also says how the keys work, once, in the same breath.
          setAnnouncement(describe(next) + (flow.focused ? '' : ' Arrow keys move between places. Escape goes back.'))
        }
        return true
      }
      const free = document.activeElement === document.body || document.activeElement === null
      if (!free || !flow.focused) return false
      if (event.key === 'Enter') {
        event.preventDefault()
        if (flow.focused.startsWith('place-')) {
          flow.openPlace(Number(flow.focused.slice('place-'.length)))
          focusSoon('.place-menu button:not(:disabled)')
        } else {
          flow.selectStone(flow.focused)
          focusSoon('.stone-panel.is-open .panel-row:not(:disabled)')
        }
        return true
      }
      if (event.key === 'r' && !flow.focused.startsWith('place-')) {
        const stone = real.find((candidate) => candidate.id === flow.focused)
        const runes = stone?.runes ?? []
        const name = stones.find((candidate) => candidate.id === flow.focused)?.name ?? 'This stone'
        setAnnouncement(
          runes.length
            ? `${name} has ${runes.length} ${runes.length === 1 ? 'rune' : 'runes'}: ${runes.map((rune) => rune.name).join(', ')}.`
            : `${name} has no runes yet.`
        )
        return true
      }
      return false
    },
    [targets, describe, real, stones]
  )

  /* Two keys, both for judging the spike rather than for the finished app:
   *   d  the real session data, the same as the rail's pulse icon
   *   q  step down the quality presets, to see what the reflections actually cost */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Esc steps back out of the flow, and works from inside the console too.
      if (usePhoto.getState().on) {
        // Photo mode owns the keyboard while it is up: Esc leaves, Enter takes the picture.
        if (event.key === 'Escape') leavePhoto()
        else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) usePhoto.getState().save()
        return
      }
      if (event.key === 'Escape') {
        // Let go of whatever has focus, not only the console. Otherwise a button inside the menu
        // being closed keeps focus for a moment, and an Enter pressed straight after lands on it.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        setPanel(null)
        // An answer on screen is the first thing Esc puts away.
        if (useAnswer.getState().answer) return useAnswer.getState().clear()
        useFlow.getState().back()
        return
      }
      if (event.target instanceof HTMLInputElement) return
      if (event.defaultPrevented) return
      if (moveFocus(event)) return
      if (event.key === 'd') setDataOpen((open) => !open)
      if (event.key === 'b') setPost((on) => !on)
      if (event.key === 'p') enterPhoto()
      if (event.key === 's') void window.grove?.captureStill()
      if (event.key === 'q') {
        setForced((current) => (current === 'high' ? 'balanced' : current === 'balanced' ? 'low' : current === 'low' ? null : 'high'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moveFocus])

  const reported = useRef(false)
  const onPerf = useCallback((sample: PerfSample) => {
    setPerf(sample)
    /* Log once, after the scene has had a few seconds to compile its shaders and settle.
     *
     * Every early reading of this spike was junk, and both reasons are worth knowing about: a
     * sample taken straight after a hot reload measures shader compilation, and a sample taken
     * while the window is hidden measures the browser's background throttle rather than the
     * scene. A settled figure printed to the terminal is the only one worth quoting. */
    if (!reported.current && sample.fps > 5) {
      reported.current = true
      console.log(
        `grove-perf: ${sample.fps} fps, ${sample.drawCalls} draw calls, ${sample.triangles} triangles, ${sample.programs} shader programs`
      )
      // With VITE_GROVE_CAPTURE set, save a still as soon as the scene has settled. The point is
      // that a still taken at the wrong moment is worse than none: the first two seconds are
      // shader compilation and a half-built scene.
      if (import.meta.env.VITE_GROVE_CAPTURE) void window.grove?.captureStill()
    }
  }, [])

  // In full screen, with nothing open, the interface fades back after a few quiet seconds.
  const resting = useIdle(fullScreen && !panel && !dataOpen && view === 'home' && !deployment)

  /* Idle drift: after five quiet minutes at the home view the camera turns slowly, so a grove left
   * on a spare screen is never a frozen picture. Not while anything is open, not in photo mode, not
   * under reduced motion, and never while a stone wants you: the camera must not turn away from the
   * one thing on screen that matters. `?drift=10` shortens the wait to ten seconds, for judging it. */
  const needsYou = stones.some((stone) => stone.status === 'waiting' || stone.status === 'errored')
  const drifting = useIdle(
    settings.idleDrift && !reducedMotion && !photo && !panel && !dataOpen && view === 'home' && !stoneId && !deployment && !needsYou,
    DRIFT_AFTER_MS
  )

  // The whole interface is sized in rem, so full screen scales it by changing one number.
  useEffect(() => {
    document.documentElement.classList.toggle('is-fullscreen', fullScreen)
  }, [fullScreen])

  const running = stones.filter(
    (stone) => stone.status === 'running' || stone.status === 'waiting'
  ).length

  return (
    <div className="grove-root">
      <div className="grove-canvas">
        <SceneGuard
          lost={contextLost}
          onRetry={() => {
            setContextLost(false)
            setSceneKey((key) => key + 1)
          }}
          onLighter={() => {
            void saveSettings({ graphics: 'performance' })
            setContextLost(false)
            setSceneKey((key) => key + 1)
          }}
        >
        <GroveScene
          key={sceneKey}
          onContextLost={() => setContextLost(true)}
          stones={stones}
          empty={empty}
          pairs={pairs}
          quality={quality}
          // Under `prefers-reduced-motion` the scene renders once and holds: no heartbeat, no
          // motes, no parallax, no travelling light. It is still the same picture, which is the
          // test of whether the composition works rather than the movement.
          animate={!reducedMotion}
          post={post && (forced ? true : scene.post)}
          maxFps={forced ? undefined : scene.maxFps}
          onPerf={onPerf}
          onHoverStone={setHovered}
          viewResetKey={viewResetKey}
          drift={drifting}
          ready={DEMO || snapshot !== null}
        />
        </SceneGuard>
      </div>

      {photo ? <PhotoBar onDone={leavePhoto} /> : null}
      <div className={`hud${view === 'stone' || view === 'run' ? ' is-panel' : ''}${resting ? ' is-resting' : ''}${photo ? ' is-photo' : ''}`} inert={photo}>
        <Rail
          panel={panel}
          onPanel={setPanel}
          onToggleData={() => setDataOpen((open) => !open)}
          dataOpen={dataOpen}
          onHome={() => {
            setPanel(null)
            goHome()
          }}
          onAgents={() => {
            setPanel(null)
            openAgents()
          }}
          inAgents={view === 'agents'}
        />
        <SettingsPanel open={settingsOpen} onClose={() => setPanel(null)} />
        <ProjectsPanel open={panel === 'projects'} onClose={() => setPanel(null)} stones={stones} real={real} />
        <RunesPanel open={panel === 'runes'} onClose={() => setPanel(null)} real={real} />
        <Providers />
        <Crystal />
        {/* Agents are the tree's definitions; tasks are the runes carved on stones, honestly zero
            until runes can be made. 12 is the art's number, for the demo. */}
        {settings.showCounts ? <Counts
          agents={tree.agents.length}
          running={running}
          tasks={DEMO ? 12 : real.reduce((sum, stone) => sum + stone.runes.length, 0)}
        /> : null}
        <HealthLine onOpen={() => setDataOpen(true)} />
        <RuneConsole inputRef={consoleInput} stones={stones} placeholder={selectedName ? `Task for ${selectedName}...` : undefined} />
        <StonePanel stones={stones} onAddTask={() => consoleInput.current?.focus()} />
        <AgentCard stones={stones} />
        <RunPanel stones={stones} />
        <GrowCard />
        <DeployToast stones={stones} />
        <PickHint />
        <Intro hidden={panel !== null} />
        <Announcer message={announcement} />
        <button type="button" className="view-home view-photo" onClick={enterPhoto} aria-label="Photo mode: frame the grove and save an image" title="Photo mode (P)">
          PHOTO
        </button>
        <button
          type="button"
          className="view-home"
          onClick={goHome}
          aria-label="Return to the Grove home view"
          title="Return to home view"
        >
          HOME VIEW
        </button>

        {showDebug ? <p className="fps">
          <b>{perf?.fps ?? '--'} fps</b>
          <br />
          {perf ? `${perf.drawCalls} calls · ${(perf.triangles / 1000).toFixed(1)}k tris` : ''}
          <br />
          {quality}
          {post ? '' : ' · no post'} · q, b, s
          <br />
          d for real data
          {reducedMotion ? (
            <>
              <br />
              reduced motion
            </>
          ) : null}
        </p> : null}

        {dataOpen ? (
          <div className="data-panel">
            <button
              type="button"
              className="data-panel-close"
              onClick={() => setDataOpen(false)}
              aria-label="Close session data"
            >
              <X size={16} weight="thin" />
            </button>
            <SessionList />
          </div>
        ) : null}
      </div>
    </div>
  )
}
