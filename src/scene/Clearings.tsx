/**
 * Clearings, drawn: a low ring of small stones round each group, its name on the ground in front,
 * and mycelium running between the stones inside it.
 *
 * Who stands where is decided in `core/state/clearings.ts` and `layout.ts`; this file only draws.
 *
 * **The ring is quiet.** Dark stones barely above the floor and a faint line on the ground: enough
 * to see that these stones belong together, never enough to compete with the stones themselves.
 *
 * **The threads are the same organism as the roots.** Every stone keeps its own root to the tree;
 * inside a clearing, thin strands of mycelium also run from each stone to its neighbours. They
 * breathe with the one heartbeat, and when a stone in the clearing is working, light runs out
 * from it along the strands to the others, so you can see work in one project touching the rest.
 * Amber reaches them only when a stone in the clearing needs you, as everywhere else.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette } from '../theme/palette'
import { seededRandom, taperedTube } from './geometry'
import { heartbeatFrame } from './heartbeat'
import type { ClearingSpec } from './layout'
import { LABEL_FONT, useLabelFontReady, type StoneSpec } from './Runestone'
import { heightAt } from './stage'

type Place = [number, number]

/** A number from a string, so the same clearing always grows the same ring. */
function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const groundAt = (x: number, z: number) => heightAt(Math.hypot(x, z))

/* -------------------------------------------------------------------------------------------
 * The ring
 * ---------------------------------------------------------------------------------------- */

const PEBBLE = new THREE.DodecahedronGeometry(1, 0)
/** Roughly how far apart the ring's stones stand, along the circle. */
const PEBBLE_STEP = 0.6

function Ring({ clearing }: { clearing: ClearingSpec }) {
  const { centre, radius } = clearing
  const count = Math.max(10, Math.round((Math.PI * 2 * radius) / PEBBLE_STEP))
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#1d2c23', emissive: palette.deep, emissiveIntensity: 0.7, roughness: 0.85, flatShading: true }),
    []
  )
  const line = useMemo(() => new THREE.MeshBasicMaterial({ color: palette.vein, transparent: true, opacity: 0.32, depthWrite: false }), [])
  const lineGeometry = useMemo(() => new THREE.RingGeometry(radius - 0.012, radius + 0.012, 160), [radius])

  useEffect(() => {
    const target = mesh.current
    if (!target) return
    const random = seededRandom(hash(clearing.name))
    const matrix = new THREE.Matrix4()
    const rotation = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const scale = new THREE.Vector3()
    const position = new THREE.Vector3()
    for (let index = 0; index < count; index++) {
      const angle = ((index + (random() - 0.5) * 0.5) / count) * Math.PI * 2
      const reach = radius + (random() - 0.5) * 0.12
      const x = centre[0] + Math.cos(angle) * reach
      const z = centre[1] + Math.sin(angle) * reach
      // Sized against a runestone (about 1.6 tall): the biggest is a tenth of one, so they read as
      // a ring laid on the ground, not a wall.
      const width = 0.09 + random() * 0.08
      const height = 0.05 + random() * 0.09
      position.set(x, groundAt(x, z) + height * 0.35, z)
      rotation.setFromEuler(euler.set((random() - 0.5) * 0.5, random() * Math.PI * 2, (random() - 0.5) * 0.5))
      scale.set(width, height, width * (0.7 + random() * 0.5))
      target.setMatrixAt(index, matrix.compose(position, rotation, scale))
    }
    target.instanceMatrix.needsUpdate = true
  }, [clearing.name, centre[0], centre[1], radius, count])

  useEffect(() => () => [material, line, lineGeometry].forEach((each) => each.dispose()), [material, line, lineGeometry])

  return (
    <>
      <instancedMesh ref={mesh} args={[PEBBLE, material, count]} frustumCulled={false} />
      <mesh geometry={lineGeometry} material={line} rotation-x={-Math.PI / 2} position={[centre[0], groundAt(...centre) + 0.006, centre[1]]} renderOrder={1} />
    </>
  )
}

/* -------------------------------------------------------------------------------------------
 * The name, on the ground in front of the ring
 * ---------------------------------------------------------------------------------------- */

function Name({ clearing }: { clearing: ClearingSpec }) {
  const fontReady = useLabelFontReady()
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 192
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(2, 2)
      ctx.fillStyle = palette.glow
      ctx.font = LABEL_FONT.replace('30px', '40px')
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      if (ctx.measureText(clearing.name).width > 496) ctx.fillText(clearing.name, 256, 48, 496)
      else ctx.fillText(clearing.name, 256, 48)
    }
    const canvasTexture = new THREE.CanvasTexture(canvas)
    canvasTexture.colorSpace = THREE.SRGBColorSpace
    canvasTexture.anisotropy = 4
    return canvasTexture
  }, [clearing.name, fontReady])
  useEffect(() => () => texture.dispose(), [texture])

  const x = clearing.centre[0]
  const z = clearing.centre[1] + clearing.radius + 0.42
  // Laid nearly flat, tipped a little towards the camera so it can still be read from the home view.
  return (
    <mesh position={[x, groundAt(x, z) + 0.02, z]} rotation-x={-Math.PI / 2 + 0.38} renderOrder={9}>
      <planeGeometry args={[3.2, 0.6]} />
      <meshBasicMaterial map={texture} transparent opacity={0.6} depthWrite={false} />
    </mesh>
  )
}

/* -------------------------------------------------------------------------------------------
 * Mycelium between the clearing's stones
 * ---------------------------------------------------------------------------------------- */

const threadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** v runs from the first stone to the second, so a window of light can travel either way. */
const threadFragment = /* glsl */ `
  uniform vec3 uColour;
  uniform vec3 uHot;
  uniform vec3 uAmber;
  uniform float uTime;
  uniform float uBeat;
  uniform float uFromA;
  uniform float uFromB;
  uniform float uAttention;
  varying vec2 vUv;
  void main() {
    float travel = fract(uTime * 0.32);
    float fromA = uFromA * smoothstep(0.14, 0.0, abs(travel - vUv.y));
    float fromB = uFromB * smoothstep(0.14, 0.0, abs(travel - (1.0 - vUv.y)));
    float hot = max(fromA, fromB);
    vec3 colour = mix(mix(uColour, uHot, hot), uAmber, uAttention * 0.65);
    float light = 0.55 + 0.35 * uBeat + hot * 1.4;
    gl_FragColor = vec4(colour * light, 0.7 + hot * 0.3);
  }
`

const BUSY = new Set(['running'])
const NEEDS_YOU = new Set(['waiting', 'errored'])

/** Five fibres between two stones, wandering a little, thicker where they leave each stone. */
function threadGeometry(a: Place, b: Place, seed: number): THREE.BufferGeometry {
  const random = seededRandom(seed)
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const length = Math.hypot(dx, dz)
  const across: Place = [-dz / length, dx / length]
  // Start just outside each stone's base, so the strands come out of the ground beside it.
  const start: Place = [a[0] + (dx / length) * 0.38, a[1] + (dz / length) * 0.38]
  const end: Place = [b[0] - (dx / length) * 0.38, b[1] - (dz / length) * 0.38]
  const parts: THREE.BufferGeometry[] = []
  for (let fibre = 0; fibre < 5; fibre++) {
    const points = [0, 0.33, 0.66, 1].map((t, index) => {
      const sway = index === 0 || index === 3 ? (random() - 0.5) * 0.12 : (random() - 0.5) * 0.7
      const x = start[0] + (end[0] - start[0]) * t + across[0] * sway
      const z = start[1] + (end[1] - start[1]) * t + across[1] * sway
      return new THREE.Vector3(x, groundAt(x, z) + 0.022, z)
    })
    const curve = new THREE.CatmullRomCurve3(points)
    const thickness = fibre === 0 ? 0.028 : 0.014
    parts.push(taperedTube(curve, (t) => thickness * (0.55 + 0.45 * Math.abs(t * 2 - 1)), 40, 5))
  }
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  return merged
}

/** Join several indexed geometries with the same attributes into one, so a link is one draw call. */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (const part of parts) {
    const offset = positions.length / 3
    positions.push(...(part.getAttribute('position').array as Float32Array))
    uvs.push(...(part.getAttribute('uv').array as Float32Array))
    for (const index of part.getIndex()!.array) indices.push(index + offset)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}

function Thread({ a, b, animate }: { a: StoneSpec; b: StoneSpec; animate: boolean }) {
  const geometry = useMemo(() => threadGeometry(a.at, b.at, hash(`${a.id}\n${b.id}`)), [a.id, b.id, a.at[0], a.at[1], b.at[0], b.at[1]])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: threadVertex,
        fragmentShader: threadFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColour: { value: new THREE.Color(palette.live) },
          uHot: { value: new THREE.Color(palette.energy) },
          uAmber: { value: new THREE.Color(palette.waiting) },
          uTime: { value: 0 },
          uBeat: { value: 0.3 },
          uFromA: { value: 0 },
          uFromB: { value: 0 },
          uAttention: { value: 0 },
        },
      }),
    []
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((state, delta) => {
    const u = material.uniforms
    const busy = (BUSY.has(a.status) ? 1 : 0) + (BUSY.has(b.status) ? 1 : 0)
    const wanted = NEEDS_YOU.has(a.status) || NEEDS_YOU.has(b.status)
    const time = state.clock.elapsedTime
    // Under reduced motion the strands hold still at a steady glow, lit through when work is on.
    u.uTime!.value = animate ? time : 0.5
    u.uBeat!.value = animate ? heartbeatFrame(time, busy / 2, wanted).pulse : 0.3
    const damp = (from: number, to: number) => (animate ? THREE.MathUtils.damp(from, to, 2, delta) : to)
    u.uFromA!.value = damp(u.uFromA!.value as number, BUSY.has(a.status) ? 1 : 0)
    u.uFromB!.value = damp(u.uFromB!.value as number, BUSY.has(b.status) ? 1 : 0)
    u.uAttention!.value = damp(u.uAttention!.value as number, wanted ? 1 : 0)
  })

  return <mesh geometry={geometry} material={material} renderOrder={2} />
}

/** Neighbours round the circle: one strand for two stones, a closed loop for three or more. */
function links(members: string[]): [string, string][] {
  if (members.length < 2) return []
  if (members.length === 2) return [[members[0]!, members[1]!]]
  return members.map((id, index) => [id, members[(index + 1) % members.length]!])
}

export function Clearings({ clearings, stones, animate }: { clearings: ClearingSpec[]; stones: StoneSpec[]; animate: boolean }) {
  const byId = useMemo(() => new Map(stones.map((stone) => [stone.id, stone])), [stones])
  return (
    <>
      {clearings.map((clearing) => (
        <group key={clearing.name}>
          <Ring clearing={clearing} />
          <Name clearing={clearing} />
          {links(clearing.members).map(([one, two]) => {
            const a = byId.get(one)
            const b = byId.get(two)
            return a && b ? <Thread key={`${one}\n${two}`} a={a} b={b} animate={animate} /> : null
          })}
        </group>
      ))}
    </>
  )
}
