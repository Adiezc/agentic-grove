/**
 * An empty circle in the grove: a place where a project's stone can stand.
 *
 * At rest it is two faint rings on the floor, the footprint a stone would leave, so a new grove
 * reads as a clearing waiting to be filled rather than an unfinished scene. Hovering warms the
 * rings at once and shows a plus a moment later; clicking opens two choices, New or Connect.
 * Connect is where the folders your agents have been busy in are offered, one step in, so the
 * first thing you see is a choice of two rather than a list.
 *
 * The menu is DOM, through drei's `<Html>`, for the same reason the agent orbs are: it is a few
 * buttons that need focus, a keyboard and a screen-reader name, and it only exists while open.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { CaretLeft, FolderOpen, FolderSimple, FolderSimplePlus, Plus } from '@phosphor-icons/react'
import * as THREE from 'three'
import type { ProjectResult } from '../../electron/bridge.ts'
import { useFlow } from '../store/flow'
import { useGrove } from '../store/grove'
import { palette } from '../theme/palette'
import { groundRing } from './geometry'
import type { EmptyPlace as Place } from './layout'

/** One shared empty list. A selector returning a fresh `[]` each time looks like a new value on
 *  every read, and React re-renders for ever trying to catch up with it. */
const NO_SUGGESTIONS: never[] = []

const RINGS = [0.45, 0.74].map((radius) => groundRing(radius, radius > 0.6 ? 0.006 : 0.009, 96))

/**
 * How long the pointer has to rest on a circle before its plus appears.
 *
 * Long enough that sweeping the pointer across the floor does not make pluses blink on and off
 * under it, short enough that someone who means it never feels they are waiting.
 */
const PLUS_DELAY_MS = 350

export function EmptyPlace({ place }: { place: Place }) {
  const [hovered, setHovered] = useState(false)
  const [showPlus, setShowPlus] = useState(false)
  const open = useFlow((state) => state.placeIndex === place.index)
  // Reached with the arrow keys: warm the circle and show its plus, exactly as a resting pointer does.
  const focused = useFlow((state) => state.focused === `place-${place.index}`)
  const openPlace = useFlow((state) => state.openPlace)
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.live,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  )
  const glow = useRef(0)

  useEffect(() => {
    if (!hovered) {
      setShowPlus(false)
      return
    }
    const timer = window.setTimeout(() => setShowPlus(true), PLUS_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [hovered])

  // Eased, so the circle warms when you come near rather than switching on.
  useFrame((_, delta) => {
    glow.current = THREE.MathUtils.damp(glow.current, hovered || focused || open ? 1 : 0, 6, delta)
    material.opacity = 0.24 + glow.current * 0.4
  })

  return (
    <group position={[place.at[0], 0.012, place.at[1]]}>
      {RINGS.map((geometry, i) => (
        <mesh key={i} geometry={geometry} material={material} />
      ))}
      {/* An invisible disc to hover and click, since two hairlines are too thin to aim at. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          setHovered(false)
          document.body.style.cursor = ''
        }}
        onClick={(event) => {
          event.stopPropagation()
          openPlace(place.index)
        }}
      >
        <circleGeometry args={[0.8, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {(showPlus || focused) && !open ? (
        <Html position={[0, 0.45, 0]} center zIndexRange={[15, 10]} style={{ pointerEvents: 'none' }}>
          <span className="place-plus" aria-hidden="true">
            <Plus size={18} weight="thin" />
          </span>
        </Html>
      ) : null}
      {open ? (
        <Html position={[0, 0.5, 0]} center zIndexRange={[30, 20]}>
          <PlaceMenu />
        </Html>
      ) : null}
    </group>
  )
}

/**
 * The menu, in two steps.
 *
 *   choose   New or Connect, and nothing else.
 *   connect  The folders your agents have been busy in, and "Choose folder" for anything else.
 *            Skipped straight to the folder picker when there is nothing to suggest.
 */
function PlaceMenu() {
  const suggestions = useGrove((state) => state.snapshot?.grove.suggestions ?? NO_SUGGESTIONS)
  const bridge = typeof window !== 'undefined' ? window.grove : undefined
  const back = useFlow((state) => state.back)
  const [step, setStep] = useState<'choose' | 'connect'>('choose')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<ProjectResult>) => {
    setBusy(true)
    setError(null)
    const result = await action().catch((reason: unknown) => ({ ok: false, error: String(reason) }) as ProjectResult)
    setBusy(false)
    if (result.ok) back()
    else if (!result.cancelled) setError(result.error ?? 'That did not work')
  }

  const connect = () => {
    if (!bridge) return
    if (suggestions.length) setStep('connect')
    else void run(bridge.browseProject)
  }

  if (step === 'connect') {
    return (
      <div className="place-menu is-step" role="dialog" aria-label="Connect a project">
        <button type="button" className="place-back" onClick={() => setStep('choose')} disabled={busy}>
          <CaretLeft size={12} weight="thin" />
          <span>Connect</span>
        </button>
        <ul className="place-suggestions" aria-label="Folders your agents have worked in">
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.path} style={{ animationDelay: `${index * 35}ms` }}>
              <button
                type="button"
                className="place-suggestion"
                disabled={!bridge || busy}
                title={suggestion.path}
                onClick={() => bridge && run(() => bridge.connectSuggested(suggestion.path))}
              >
                <FolderSimple size={14} weight="thin" />
                <span>{suggestion.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="place-suggestion place-browse"
          disabled={!bridge || busy}
          onClick={() => bridge && run(bridge.browseProject)}
        >
          <FolderOpen size={14} weight="thin" />
          <span>Choose folder</span>
        </button>
        {error ? <p className="place-error">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="place-menu" role="dialog" aria-label="New runestone">
      <div className="place-choices">
        <button type="button" className="place-choice" disabled={!bridge || busy} onClick={() => bridge && run(bridge.createProject)}>
          <FolderSimplePlus size={20} weight="thin" />
          <span>New</span>
        </button>
        <button type="button" className="place-choice" disabled={!bridge || busy} onClick={connect}>
          <FolderOpen size={20} weight="thin" />
          <span>Connect</span>
        </button>
      </div>
      {error ? <p className="place-error">{error}</p> : null}
    </div>
  )
}
