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
import { Counts, Crystal, HarnessRow, HoverReadout, Rail, RuneConsole, usePrefersReducedMotion } from './hud/Hud'
import { SessionList } from './SessionList'
import { AgentCard, DeployToast, GrowCard, PickHint, StonePanel } from './hud/Flow'
import { Intro } from './hud/Intro'
import { SettingsPanel } from './hud/Settings'
import { useFlow } from './store/flow'
import { useGrove } from './store/grove'
import { emptyPlaces, layoutStones } from './scene/layout'
import { DEMO } from './demo'
import { useTree } from './agents/tree'
import './hud/hud.css'

/** Who the demo shows working on its running stones, as in the concept art's frame 1. */
const DEMO_WORKERS: Record<string, string> = { research: 'researcher', build: 'builder', connect: 'researcher' }

/** Shared, so an empty grove is the same value from one render to the next. */
const NO_STONES: never[] = []

export function App() {
  const [dataOpen, setDataOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [perf, setPerf] = useState<PerfSample | null>(null)
  const [post, setPost] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const [viewResetKey, setViewResetKey] = useState(0)
  /* Startable at a given preset, so each one's cost can be measured on a cold launch rather
   * than by pressing `q` and hoping the reading settles:
   *     VITE_GROVE_QUALITY=low npm run dev
   * Anything unrecognised falls through to 'high', which is what the look is judged at. */
  const [quality, setQuality] = useState<QualityPreset>(() => {
    const wanted = import.meta.env.VITE_GROVE_QUALITY
    return wanted === 'low' || wanted === 'balanced' ? wanted : 'high'
  })
  const reducedMotion = usePrefersReducedMotion()
  const consoleInput = useRef<HTMLInputElement>(null)
  const tree = useTree()
  const view = useFlow((state) => state.view)
  const stoneId = useFlow((state) => state.stoneId)
  const statusOverrides = useFlow((state) => state.statusOverrides)
  const openAgents = useFlow((state) => state.openAgents)

  const snapshot = useGrove((state) => state.snapshot)
  const deployment = useFlow((state) => state.deployment)

  /* Your projects, from the scan. A new grove has none, and that is the intended first sight: the
   * tree, Researcher, and three empty circles. The concept art's six stones appear only in demo
   * mode (`?demo`), for judging the scene against the art in a browser tab.
   *
   * Deploying is still only an animation, so on real stones it may light the target while the
   * light is travelling and no longer: saying a project is running when nothing was started
   * there would break the one rule the grove cannot break, which is not to invent state. The
   * demo stones are pretend anyway, so there the deployment is allowed to stick. */
  const real = snapshot?.grove.stones ?? NO_STONES
  const stones = useMemo(() => {
    const base = DEMO ? SPIKE_STONES : layoutStones(real)
    return base.map((stone) => {
      const lit = DEMO ? statusOverrides[stone.id] : deployment?.stoneId === stone.id ? 'running' : undefined
      // While an agent is on its way, or (in the demo) once it has landed, its face joins the
      // stone's workers so you can see who went where.
      const sent = deployment?.stoneId === stone.id ? deployment.agentId : DEMO ? DEMO_WORKERS[stone.id] : undefined
      const workers = sent && !stone.workers?.includes(sent) ? [...(stone.workers ?? []), sent] : stone.workers
      return { ...stone, status: lit ?? stone.status, workers }
    })
  }, [real, deployment, statusOverrides])
  const empty = useMemo(() => (DEMO ? [] : emptyPlaces(real.length)), [real.length])
  const selectedName = stones.find((stone) => stone.id === stoneId)?.name
  const goHome = () => {
    useFlow.setState({ view: 'home', stoneId: null, pendingAgentId: null })
    setDataOpen(false)
    setViewResetKey((key) => key + 1)
  }
  const showDebug = new URLSearchParams(window.location.search).has('debug')

  // The scan keeps running behind the scene even though the spike does not draw it, so opening
  // the data panel shows something immediately rather than scanning from cold.
  const connect = useGrove((state) => state.connect)
  useEffect(() => connect(), [connect])

  /* Two keys, both for judging the spike rather than for the finished app:
   *   d  the real session data, the same as the rail's pulse icon
   *   q  step down the quality presets, to see what the reflections actually cost */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Esc steps back out of the flow, and works from inside the console too.
      if (event.key === 'Escape') {
        if (event.target instanceof HTMLInputElement) event.target.blur()
        setSettingsOpen(false)
        useFlow.getState().back()
        return
      }
      if (event.target instanceof HTMLInputElement) return
      if (event.key === 'd') setDataOpen((open) => !open)
      if (event.key === 'b') setPost((on) => !on)
      if (event.key === 's') void window.grove?.captureStill()
      if (event.key === 'q') {
        setQuality((current) => (current === 'high' ? 'balanced' : current === 'balanced' ? 'low' : 'high'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  const running = stones.filter(
    (stone) => stone.status === 'running' || stone.status === 'waiting'
  ).length

  return (
    <div className="grove-root">
      <div className="grove-canvas">
        <GroveScene
          stones={stones}
          empty={empty}
          quality={quality}
          // Under `prefers-reduced-motion` the scene renders once and holds: no heartbeat, no
          // motes, no parallax, no travelling light. It is still the same picture, which is the
          // test of whether the composition works rather than the movement.
          animate={!reducedMotion}
          post={post}
          onPerf={onPerf}
          onHoverStone={setHovered}
          viewResetKey={viewResetKey}
          ready={DEMO || snapshot !== null}
        />
      </div>

      <div className={`hud${view === 'stone' ? ' is-panel' : ''}`}>
        <Rail
          onToggleData={() => setDataOpen((open) => !open)}
          dataOpen={dataOpen}
          onHome={goHome}
          onAgents={openAgents}
          inAgents={view === 'agents'}
          onSettings={() => setSettingsOpen((open) => !open)}
          settingsOpen={settingsOpen}
        />
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <HarnessRow />
        <Crystal />
        {/* Agents are the tree's definitions; tasks are the runes carved on stones, honestly zero
            until runes can be made. 12 is the art's number, for the demo. */}
        <Counts
          agents={tree.agents.length}
          running={running}
          tasks={DEMO ? 12 : real.reduce((sum, stone) => sum + stone.runes.length, 0)}
        />
        <RuneConsole inputRef={consoleInput} placeholder={selectedName ? `Task for ${selectedName}...` : undefined} />
        <StonePanel stones={stones} onAddTask={() => consoleInput.current?.focus()} />
        <AgentCard stones={stones} />
        <GrowCard />
        <DeployToast stones={stones} />
        <PickHint />
        <Intro />
        <HoverReadout name={hovered ? (stones.find((s) => s.id === hovered)?.name ?? null) : null} />
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
