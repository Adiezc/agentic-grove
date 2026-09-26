/**
 * An empty circle in the grove: a place where a project's stone can stand.
 *
 * At rest it is two faint rings on the floor, the footprint a stone would leave, so a new grove
 * reads as a clearing waiting to be filled rather than an unfinished scene. Hovering lifts it and
 * shows a plus; clicking opens two choices beside it, create a new project or connect one you
 * already have, with the folders your agents have been busy in offered first.
 *
 * The menu is DOM, through drei's `<Html>`, for the same reason the agent orbs are: it is a few
 * buttons that need focus, a keyboard and a screen-reader name, and it only exists while open.
 */
import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { FolderOpen, FolderSimple, Plus } from '@phosphor-icons/react'
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

export function EmptyPlace({ place }: { place: Place }) {
  const [hovered, setHovered] = useState(false)
  const open = useFlow((state) => state.placeIndex === place.index)
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

  // Eased, so the circle warms when you come near rather than switching on.
  useFrame((_, delta) => {
    glow.current = THREE.MathUtils.damp(glow.current, hovered || open ? 1 : 0, 6, delta)
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

      {hovered && !open ? (
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

/** The two choices, and the folders your agents have already been working in. */
function PlaceMenu() {
  const suggestions = useGrove((state) => state.snapshot?.grove.suggestions ?? NO_SUGGESTIONS)
  const bridge = typeof window !== 'undefined' ? window.grove : undefined
  const back = useFlow((state) => state.back)
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

  return (
    <div className="place-menu" role="dialog" aria-label="New runestone">
      <div className="place-choices">
        <button type="button" className="place-choice" disabled={!bridge || busy} onClick={() => bridge && run(bridge.createProject)}>
          <Plus size={20} weight="thin" />
          <span>Create</span>
        </button>
        <button type="button" className="place-choice" disabled={!bridge || busy} onClick={() => bridge && run(bridge.browseProject)}>
          <FolderOpen size={20} weight="thin" />
          <span>Connect</span>
        </button>
      </div>
      {suggestions.length ? (
        <ul className="place-suggestions" aria-label="Recent folders">
          {suggestions.map((suggestion) => (
            <li key={suggestion.path}>
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
      ) : null}
      {error ? <p className="place-error">{error}</p> : null}
    </div>
  )
}
