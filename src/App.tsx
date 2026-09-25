/**
 * The look-development spike.
 *
 * Session three's whole job, from the build plan: one scene, dark, bloomed, the palette from the
 * concept art, and a judgement about whether full 3D is the right call before anything is built
 * on top of it. So this is the grove, laid out to match `assets/concept/grove-main.png` as closely
 * as a real-time scene can, and nothing else.
 *
 * **No real data, deliberately.** The six stones are fixtures from the art. Wiring in the fifteen
 * real ones would change the composition and make the only question this session is asking —
 * does it look like the art — impossible to answer. Session four connects the scan. The real
 * data is one click away behind the rail's pulse icon, so the two can be compared.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import '@fontsource-variable/geist'
import { GroveScene, SPIKE_STONES, type PerfSample, type QualityPreset } from './scene/Grove'
import { Counts, Crystal, HarnessRow, HoverReadout, Rail, RuneConsole, usePrefersReducedMotion } from './hud/Hud'
import { SessionList } from './SessionList'
import { useGrove } from './store/grove'
import './hud/hud.css'

export function App() {
  const [dataOpen, setDataOpen] = useState(false)
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

  const running = SPIKE_STONES.filter(
    (stone) => stone.status === 'running' || stone.status === 'waiting'
  ).length

  return (
    <div className="grove-root">
      <div className="grove-canvas">
        <GroveScene
          quality={quality}
          // Under `prefers-reduced-motion` the scene renders once and holds: no heartbeat, no
          // motes, no parallax, no travelling light. It is still the same picture, which is the
          // test of whether the composition works rather than the movement.
          animate={!reducedMotion}
          post={post}
          onPerf={onPerf}
          onHoverStone={setHovered}
          viewResetKey={viewResetKey}
        />
      </div>

      <div className="hud">
        <Rail onToggleData={() => setDataOpen((open) => !open)} dataOpen={dataOpen} />
        <HarnessRow />
        <Crystal />
        {/* The numbers from the concept art, since the scene is the art's six stones. */}
        <Counts agents={SPIKE_STONES.length} running={running} tasks={12} />
        <RuneConsole />
        <HoverReadout name={hovered ? (SPIKE_STONES.find((s) => s.id === hovered)?.name ?? null) : null} />
        <button
          type="button"
          className="view-home"
          onClick={() => setViewResetKey((key) => key + 1)}
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
