/**
 * The mycelial network, drawn.
 *
 * The shape of it is not decided here — `network.ts` grows the whole thing, roots and mycelium
 * together, as one branching system leaving the trunk. This file is only about how that system
 * is rendered.
 *
 * Project connections have lit, tapered root bodies with a luminous vein on the upper surface.
 * Space-colonized branches supply fine physical hyphae around the main connections.
 * MeshLine-derived surface veins keep fine fibres visible; only ambient unowned filaments
 * carry a faint floor wash.
 *
 * **The network is always lit.** What changes with activity is how hard the light runs through
 * it, not whether it exists — a project nobody is working on is still attached to the tree.
 *
 * **A pulse lights a whole subtree in order.** The strands carry their position along their
 * stone's journey in their `v` coordinate, so one travelling window in the fragment shader lights
 * the root, then the forks it passes, then the forks off those, all in sequence, with no state
 * anywhere and one uniform per stone per frame.
 *
 * **A new stone's roots fill with light first.** When a project is created or connected, a bright
 * front runs from the trunk out along that stone's roots, leaving them lit behind it, and the
 * stone rises out of the ground as it arrives (`Runestone.tsx`). The same `v` coordinate does it:
 * one more uniform, `uGrow`, saying how far the front has got.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette, motion } from '../theme/palette'
import { mergeAll, taperedTube } from './geometry'
import type { Network, Strand } from './network'
import { heartbeatFrame } from './heartbeat'
import { myceliumStrip } from './myceliumStrip'
import { junctionBrightness, ownerPhase, type MyceliumSignal } from './myceliumFlow'
import { cordRadius, CordVein } from './rootCord'
import { HYPHA_BODY, HYPHA_GLOW } from './rootTransition'

/** How much wider than its core a strand's floor wash is. Generous: it is a wash, not an outline. */
const HALO_WIDTH = 8

/** How long the light takes to run from the trunk to a new stone. */
const GROW_SECONDS = 1.5

const VERTEX = /* glsl */ `
  // Projected previous/next strip expansion adapted from MeshLine's vertex shader.
  // Copyright (c) 2016 Jaume Sanchez. See licenses/meshline.txt and CREDITS.md.
  attribute vec3 aCentre;
  attribute vec3 aPrevious;
  attribute vec3 aNext;
  attribute float aSide;
  uniform vec2 uResolution;
  uniform float uHalo;
  varying vec2 vUv;
  attribute float aFilament;
  attribute float aTipFade;
  attribute float aDensity;
  varying float vFilament;
  varying float vTipFade;
  varying float vDensity;
  void main() {
    vUv = uv;
    vFilament = aFilament;
    vTipFade = aTipFade;
    vDensity = aDensity;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    if (aFilament > 0.5 && uHalo < 0.5) {
      vec4 centre = projectionMatrix * modelViewMatrix * vec4(aCentre, 1.0);
      vec4 previous = projectionMatrix * modelViewMatrix * vec4(aPrevious, 1.0);
      vec4 next = projectionMatrix * modelViewMatrix * vec4(aNext, 1.0);
      vec2 direction = (next.xy / next.w - previous.xy / previous.w) * uResolution;
      direction /= max(length(direction), 0.00001);
      vec2 perpendicular = vec2(-direction.y, direction.x);
      // Fine fibres keep a subpixel-to-one-pixel presence at grazing angles.
      float pixels = 0.45 + aDensity * 0.18;
      gl_Position = centre;
      gl_Position.xy += perpendicular / uResolution * pixels * centre.w * aSide;
      gl_Position.z -= 0.00002 * centre.w;
    }
  }
`

/**
 * One shader for both layers.
 *
 * `uHalo` switches on the across-the-strand fade, which is the only difference between the wash
 * and the core: a tube's `u` runs around its circumference and means nothing, a ribbon's runs
 * across its width and is exactly what needs to fall off.
 */
const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uActive;
  uniform float uHalo;
  uniform float uRest;
  uniform float uHeartbeat;
  uniform float uFailed;
  uniform float uAttention;
  uniform float uGrow;
  uniform vec3 uAmber;
  uniform vec3 uColour;
  uniform vec3 uHot;
  uniform vec3 uFailure;
  varying vec2 vUv;
  varying float vFilament;
  varying float vTipFade;
  varying float vDensity;

  void main() {
    // vUv.y runs from the trunk (0) to the stone (1) across the whole subtree, not per strand.
    float head = fract(uTime);
    float d = vUv.y - head;

    // A short bright core with a long tail behind it, so the light reads as travelling towards
    // the stone rather than as a bead sliding along a wire.
    float core = exp(-pow(d * 24.0, 2.0));
    float tail = (1.0 - smoothstep(-0.4, 0.0, d)) * exp(min(d, 0.0) * 4.5) * 0.5;
    float travelling = (core + tail) * uActive;

    float amount = uRest * (1.0 + uHeartbeat * 1.15) + travelling;

    // A new stone's roots: dim ahead of the growth front, lit behind it, and a hot band at the
    // front itself. The front runs a little past 1 so the band clears the stone's end before
    // it goes out. Once uGrow reaches 1 all three terms collapse to the plain resting network.
    float front = uGrow * 1.2;
    float growing = 1.0 - step(1.0, uGrow);
    float behind = 1.0 - smoothstep(front - 0.1, front, vUv.y);
    float band = exp(-pow((vUv.y - front) * 16.0, 2.0)) * growing;
    amount = amount * mix(0.18, 1.0, max(behind, 1.0 - growing)) + band * 1.6;

    // Across the strand, for the wash only.
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float edge = smoothstep(0.0, max(fwidth(across), 0.08), across);
    float fineCore = pow(across, 0.65) * edge;
    float fade = mix(mix(1.0, fineCore, vFilament), pow(across, 2.2) * 0.16, uHalo);
    fade *= vTipFade * vDensity;

    vec3 living = mix(uColour, uHot, clamp(core * uActive * 1.6 + uHeartbeat * 0.24 + band, 0.0, 1.0));
    vec3 colour = mix(living, uFailure, uFailed * 0.62);
    // Something needs you: the whole organism leans amber, and each beat pushes it further.
    colour = mix(colour, uAmber, clamp(uAttention, 0.0, 1.0));
    gl_FragColor = vec4(colour, clamp(amount * fade, 0.0, 1.0));
  }
`

function makeMaterial(halo: boolean, rest: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1440, 900) },
      uActive: { value: 0 },
      uHalo: { value: halo ? 1 : 0 },
      uRest: { value: rest },
      uHeartbeat: { value: 0 },
      uFailed: { value: 0 },
      uAttention: { value: 0 },
      uGrow: { value: 1 },
      uAmber: { value: new THREE.Color(palette.waiting) },
      uColour: { value: new THREE.Color(halo ? palette.vein : palette.live) },
      uHot: { value: new THREE.Color(palette.energy) },
      uFailure: { value: new THREE.Color(palette.errored) },
    },
  })
}

/** Core and wash geometry for a set of strands, merged into one mesh each. */
function build(strands: Strand[]): { core: THREE.BufferGeometry | null; halo: THREE.BufferGeometry | null; body: THREE.BufferGeometry | null } {
  const cores: THREE.BufferGeometry[] = []
  const halos: THREE.BufferGeometry[] = []
  const bodies: THREE.BufferGeometry[] = []
  for (const strand of strands) {
    const v: [number, number] = [strand.from, strand.to]
    // Segment counts scale with how important a strand is. A third-generation hair 15cm long
    // does not need 72 segments, and there are a lot of them.
    const segments = strand.bundle ? Math.max(16, Math.min(96, Math.ceil(strand.curve.getLength() * 18)))
      : strand.depth === 0 ? 84 : strand.depth === 1 ? 26 : 12
    const radial = strand.depth === 0 ? 6 : 4
    const physical = strand.owner !== null
    const ribbon = !!strand.bundle || (!physical && strand.depth > 0 && strand.rootRadius === undefined)
    // The complete root-born surface is welded to the authored tree in ReferenceTree.
    if (physical && strand.rootRadius === undefined) {
      bodies.push(taperedTube(strand.curve, (t) => cordRadius(strand, t), segments, strand.depth < 2 ? 8 : 6, false, v))
    }
    const core = ribbon
      ? myceliumStrip(physical ? new CordVein(strand) : strand.curve, (t) => Math.max(0.001, THREE.MathUtils.lerp(strand.r0, strand.r1, t) * 2.8), segments, v)
      : taperedTube(physical ? new CordVein(strand) : strand.curve,
        (t) => Math.min(strand.r0 + (strand.r1 - strand.r0) * t, physical ? cordRadius(strand, t) * 0.23 : Infinity), segments, radial, false, v)
    // Each bundled fibre used to carry a broad wash. Their overlap made a shaded sheet.
    // Keep only a narrow wash under the original paths; the full fan is actual fibre geometry.
    const halo = strand.bundle || physical ? null : myceliumStrip(
        strand.curve,
        // The main runs got a thinner core when they began at the root tips (it has to come out
        // of a root, so it cannot be fatter than one), so their wash is widened to keep the
        // same soft band of green on the floor the art has.
        (t) => (strand.r0 + (strand.r1 - strand.r0) * t) * HALO_WIDTH * (strand.depth === 0 ? 1.9 : 1.2),
        Math.max(12, Math.round(segments / 2)),
        v,
        -0.004
      )
    const layers: [THREE.BufferGeometry, boolean][] = [[core, ribbon]]
    if (halo) layers.push([halo, true])
    for (const [geometry, strip] of layers) {
      const count = geometry.getAttribute('position').count
      const tipFade = new Float32Array(count), density = new Float32Array(count), filament = new Float32Array(count)
      const rings = strip ? count / 2 : count / (radial + 1)
      const centres = new Float32Array(count * 3), previous = new Float32Array(count * 3), next = new Float32Array(count * 3)
      const sides = new Float32Array(count)
      if (strip) {
        const positions = geometry.getAttribute('position')
        const centreAt = (ring: number) => new THREE.Vector3()
          .fromBufferAttribute(positions, ring * 2)
          .add(new THREE.Vector3().fromBufferAttribute(positions, ring * 2 + 1)).multiplyScalar(0.5)
        for (let ring = 0; ring < rings; ring++) {
          const centre = centreAt(ring), before = centreAt(Math.max(0, ring - 1)), after = centreAt(Math.min(rings - 1, ring + 1))
          for (let side = 0; side < 2; side++) {
            const i = ring * 2 + side
            centre.toArray(centres, i * 3); before.toArray(previous, i * 3); after.toArray(next, i * 3)
            sides[i] = side === 0 ? -1 : 1
          }
        }
      }
      for (let i = 0; i < count; i++) {
        const t = Math.floor(i / (strip ? 2 : radial + 1)) / (rings - 1)
        tipFade[i] = strand.terminal || (strand.depth > 0 && !strand.bridge && !strand.bundle && !strand.connectedTip && strand.rootRadius === undefined)
          ? 1 - THREE.MathUtils.smoothstep(t, 0.5, 1) : 1
        density[i] = strand.glow ?? (strand.bundle ? 0.82 : strand.depth >= 2 ? 0.56 : strand.depth === 1 ? 0.78 : 1)
        filament[i] = strip ? 1 : 0
      }
      geometry.setAttribute('aFilament', new THREE.BufferAttribute(filament, 1))
      geometry.setAttribute('aTipFade', new THREE.BufferAttribute(tipFade, 1))
      geometry.setAttribute('aDensity', new THREE.BufferAttribute(density, 1))
      geometry.setAttribute('aCentre', new THREE.BufferAttribute(centres, 3))
      geometry.setAttribute('aPrevious', new THREE.BufferAttribute(previous, 3))
      geometry.setAttribute('aNext', new THREE.BufferAttribute(next, 3))
      geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1))
    }
    cores.push(core)
    if (halo) halos.push(halo)
  }
  return { core: mergeAll(cores), halo: mergeAll(halos), body: mergeAll(bodies) }
}

/** Smooth luminous hyphae retain rounded volume; a surface vein carries the task pulse. */
function cordMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: HYPHA_BODY, roughness: 0.58,
    emissive: HYPHA_GLOW, emissiveIntensity: 0.85 })
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey()
  const growth = { value: 1 }
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.uniforms.cordGrowth = growth
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vCordJourney;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCordJourney = uv.y;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCordJourney;\nuniform float cordGrowth;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vCordJourney > cordGrowth * 1.2) discard;')
  }
  material.customProgramCacheKey = () => key + ':root-cord'
  return { material, growth }
}

/**
 * The bright junctions, as one screen-facing point cloud.
 *
 * `Points` rather than meshes because these are flares — light with no shape of its own — and a
 * flare has to face the camera. One draw call for all of them, and the star texture is drawn in
 * code so it can be four-pointed, which is what the art's junctions actually are.
 */
function Nodes({ network, signals }: { network: Network; signals: React.RefObject<Map<string | null, MyceliumSignal>> }) {
  const texture = useMemo(() => starTexture(), [])

  const { geometry, owners, at01 } = useMemo(() => {
    const positions = new Float32Array(network.nodes.length * 3)
    const sizes = new Float32Array(network.nodes.length)
    const alphas = new Float32Array(network.nodes.length)
    const ownerList: (string | null)[] = []
    const positionAlong: number[] = []
    network.nodes.forEach((node, i) => {
      positions[i * 3] = node.at.x
      positions[i * 3 + 1] = node.at.y + 0.01
      positions[i * 3 + 2] = node.at.z
      sizes[i] = node.size * 26
      alphas[i] = 0.35
      ownerList.push(node.owner)
      positionAlong.push(node.at01)
    })
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    buffer.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    buffer.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
    buffer.setAttribute('aColour', new THREE.BufferAttribute(new Float32Array(network.nodes.length * 3), 3))
    return { geometry: buffer, owners: ownerList, at01: positionAlong }
  }, [network])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uMap: { value: texture }, uColour: { value: new THREE.Color(palette.energy) } },
        vertexShader: /* glsl */ `
          attribute float aSize;
          attribute float aAlpha;
          attribute vec3 aColour;
          varying float vAlpha;
          varying vec3 vColour;
          void main() {
            vAlpha = aAlpha;
            vColour = aColour;
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            // Attenuated with distance, so a node at the back of the grove is smaller than one
            // at the front. Without this they all read at the same size and the floor flattens.
            gl_PointSize = aSize * (10.0 / -viewPosition.z);
            gl_Position = projectionMatrix * viewPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uColour;
          varying float vAlpha;
          varying vec3 vColour;
          void main() {
            vec4 texel = texture2D(uMap, gl_PointCoord);
            gl_FragColor = vec4(vColour, texel.a * vAlpha);
          }
        `,
      }),
    [texture]
  )

  const livingColour = useMemo(() => new THREE.Color('#9cffe2'), [])
  const attentionColour = useMemo(() => new THREE.Color(palette.waiting), [])
  const colour = useMemo(() => new THREE.Color(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => { material.dispose(); texture.dispose() }, [material, texture])
  useFrame(() => {
    const alpha = geometry.getAttribute('aAlpha') as THREE.BufferAttribute
    const array = alpha.array as Float32Array
    let changed = false
    const colours = geometry.getAttribute('aColour') as THREE.BufferAttribute
    for (let i = 0; i < array.length; i++) {
      const owner = owners[i]
      const signal = signals.current.get(owner ?? null)
      // A junction sits at a low resting brightness and flares when its stone is working. The
      // one at the stone's own foot flares hardest, which is where the eye should land.
      const want = signal ? junctionBrightness(at01[i] ?? 0, signal) : 0
      colour.copy(livingColour).lerp(attentionColour, signal?.attention ?? 0)
      colours.setXYZ(i, colour.r, colour.g, colour.b)
      if (Math.abs((array[i] ?? 0) - want) > 0.001) {
        array[i] = want
        changed = true
      }
    }
    if (changed) alpha.needsUpdate = true
    colours.needsUpdate = true
  })

  return <points geometry={geometry} material={material} />
}

/** A four-pointed star, drawn once to a small canvas. */
function starTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const centre = size / 2
    // The round core.
    const core = ctx.createRadialGradient(centre, centre, 0, centre, centre, size * 0.17)
    core.addColorStop(0, 'rgba(255,255,255,1)')
    core.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = core
    ctx.fillRect(0, 0, size, size)
    // Two spikes, one long and horizontal and one shorter and vertical, which is what a wet
    // floor does to a small bright light in the art.
    ctx.globalCompositeOperation = 'lighter'
    for (const [w, h] of [
      [size * 0.5, size * 0.012],
      [size * 0.014, size * 0.3],
    ]) {
      const spike = ctx.createLinearGradient(centre - w!, 0, centre + w!, 0)
      spike.addColorStop(0, 'rgba(255,255,255,0)')
      spike.addColorStop(0.5, 'rgba(255,255,255,0.85)')
      spike.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = spike
      ctx.fillRect(centre - w!, centre - h! / 2, w! * 2, h!)
      ctx.save()
      ctx.translate(centre, centre)
      ctx.rotate(Math.PI / 2)
      ctx.translate(-centre, -centre)
      ctx.fillRect(centre - w!, centre - h! / 2, w! * 2, h!)
      ctx.restore()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

interface MyceliumProps {
  signals: React.RefObject<Map<string | null, MyceliumSignal>>
  network: Network
  /** Stones that have just appeared. Their roots fill with light from the trunk outwards. */
  arriving: ReadonlySet<string>
  /** Stone ids with something happening on them, which is what sends light down a root. */
  active: ReadonlySet<string>
  /** Stone ids holding a turn back. These receive the subtle second attention beat. */
  attention: ReadonlySet<string>
  /** Reserved for genuine failure; the only state allowed to tint the organism red. */
  failed: ReadonlySet<string>
  activity: number
  animate: boolean
}

export function Mycelium({ network, arriving, active, attention, failed, activity, animate, signals }: MyceliumProps) {
  /* Grouped by owner, because a pulse belongs to a stone: everything one stone's light travels
   * through is one mesh with one uniform, and everything owned by nobody is one more. That is
   * about fifteen draw calls for the entire floor. */
  const groups = useMemo(() => {
    const byOwner = new Map<string | null, Strand[]>()
    for (const strand of network.strands) {
      const list = byOwner.get(strand.owner)
      if (list) list.push(strand)
      else byOwner.set(strand.owner, [strand])
    }
    return [...byOwner.entries()].map(([owner, strands]) => ({
      owner,
      ...build(strands),
      cord: cordMaterial(),
      pathLength: Math.max(1, ...strands.filter((s) => s.from === 0 && s.to === 1).map((s) => s.curve.getLength())),
      // The unowned delta under the tree rests brighter than the long runs, because in the art
      // the ground right under the trunk is the brightest part of the floor by a wide margin.
      coreMaterial: makeMaterial(false, owner === null ? 0.58 : 0.5),
      haloMaterial: makeMaterial(true, owner === null ? 0.46 : 0.38),
      // Read when the network is rebuilt, which is exactly when a stone is added: its roots are
      // part of the new network and start unlit. Everything else starts fully grown.
      grow: owner !== null && arriving.has(owner) ? 0 : 1,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network])

  /* Disposed on unmount. Three does not free GPU buffers when a React tree goes away, and this
   * file builds a lot of them — on a hot reload without this the memory climbs every save. */
  useEffect(
    () => () => {
      for (const group of groups) {
        group.core?.dispose()
        group.halo?.dispose()
        group.body?.dispose()
        group.coreMaterial.dispose()
        group.haloMaterial.dispose()
        group.cord.material.dispose()
      }
    },
    [groups]
  )

  /** Eased activity per stone, shared with the junction flares so the two cannot disagree. */
  const brightness = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    const owners = new Set(groups.map((group) => group.owner))
    for (const owner of brightness.current.keys()) if (!owners.has(owner)) brightness.current.delete(owner)
    for (const owner of signals.current.keys()) if (!owners.has(owner)) signals.current.delete(owner)
  }, [groups])
  /** How far the whole network leans amber, eased so it warms and cools over a couple of seconds. */
  const amber = useRef(0)
  const cordAmber = useMemo(() => new THREE.Color(palette.waiting), [])

  useFrame((state, delta) => {
    const wanted = attention.size > 0 || failed.size > 0
    const organismBeat = animate ? heartbeatFrame(state.clock.elapsedTime, activity, wanted).pulse : 0.28
    amber.current = animate ? THREE.MathUtils.damp(amber.current, wanted ? 1 : 0, 1.4, delta) : wanted ? 1 : 0
    groups.forEach((group) => {
      const owner = group.owner
      const want = owner && active.has(owner) ? 1 : 0
      const current = owner ? (brightness.current.get(owner) ?? 0) : 0
      // Eased rather than switched: a stone finishing its work should fade its root out over
      // about a second. Abrupt changes are what make a scene feel like a status page.
      const next = animate ? THREE.MathUtils.damp(current, want, 3.2, delta) : want
      if (owner) brightness.current.set(owner, next)

      const needsAttention = owner ? attention.has(owner) : false
      const isFailed = owner ? failed.has(owner) : false
      const attentionLift = needsAttention ? organismBeat * 0.48 : 0
      const time = (animate ? state.clock.elapsedTime * motion.myceliumFlow * (0.72 + activity * 0.7) / group.pathLength : 0) + ownerPhase(owner)
      if (group.grow < 1) group.grow = animate ? Math.min(1, group.grow + delta / GROW_SECONDS) : 1
      const tint = Math.min(1, amber.current * (0.18 + organismBeat * 0.5) + (needsAttention || isFailed ? 0.5 : 0))
      group.cord.growth.value = group.grow
      group.cord.material.emissive.set(HYPHA_GLOW).lerp(cordAmber, tint * 0.25)
      group.cord.material.emissiveIntensity = 0.85 + organismBeat * 0.3
      signals.current.set(owner, { active: next + attentionLift, attention: tint, grow: group.grow,
        beat: organismBeat * (0.28 + activity * 0.72) + attentionLift, time })
      for (const material of [group.coreMaterial, group.haloMaterial]) {
        material.uniforms.uResolution!.value.set(state.size.width, state.size.height)
        material.uniforms.uGrow!.value = group.grow
        material.uniforms.uActive!.value = next + attentionLift
        material.uniforms.uTime!.value = time
        material.uniforms.uHeartbeat!.value = organismBeat * (0.28 + activity * 0.72) + attentionLift
        material.uniforms.uFailed!.value = isFailed ? 1 : 0
        // Everywhere a little, beating; along the roots to the stone that wants you, a lot.
        material.uniforms.uAttention!.value =
          tint
      }
    })
  })

  return (
    <group>
      {groups.map((group, i) => (
        <group key={group.owner ?? `unowned-${i}`}>
          {group.body ? <mesh geometry={group.body} material={group.cord.material} receiveShadow /> : null}
          {group.halo ? <mesh geometry={group.halo} material={group.haloMaterial} renderOrder={1} /> : null}
          {group.core ? <mesh geometry={group.core} material={group.coreMaterial} renderOrder={2} /> : null}
        </group>
      ))}
      <Nodes network={network} signals={signals} />
    </group>
  )
}
