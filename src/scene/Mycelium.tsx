/**
 * The mycelial network, drawn.
 *
 * The shape of it is not decided here — `network.ts` grows the whole thing, roots and mycelium
 * together, as one branching system leaving the trunk. This file is only about how that system
 * is *rendered*, and there are three ideas in it worth knowing.
 *
 * **Every strand is drawn twice.** In the art a root is not a green tube lying on the floor; it
 * is a hair-thin, nearly white line with a soft wash of green bleeding out of it onto wet stone.
 * Drawn as a tube alone you get the line and none of the wash, and the floor reads as green
 * spaghetti. So each strand is a hot core plus a wide, faint ribbon lying flat underneath it.
 * That second layer is most of what makes the scene look wet.
 *
 * **The network is always lit.** What changes with activity is how hard the light runs through
 * it, not whether it exists — a project nobody is working on is still attached to the tree.
 *
 * **A pulse lights a whole subtree in order.** The strands carry their position along their
 * stone's journey in their `v` coordinate, so one travelling window in the fragment shader lights
 * the root, then the forks it passes, then the forks off those, all in sequence, with no state
 * anywhere and one uniform per stone per frame.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette, motion } from '../theme/palette'
import { flatRibbon, mergeAll, taperedTube } from './geometry'
import type { Network, Strand } from './network'

/** How much wider than its core a strand's floor wash is. Generous: it is a wash, not an outline. */
const HALO_WIDTH = 14

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
  uniform vec3 uColour;
  uniform vec3 uHot;
  varying vec2 vUv;

  void main() {
    // vUv.y runs from the trunk (0) to the stone (1) across the whole subtree, not per strand.
    float head = fract(uTime);
    float d = vUv.y - head;

    // A short bright core with a long tail behind it, so the light reads as travelling towards
    // the stone rather than as a bead sliding along a wire.
    float core = exp(-pow(d * 24.0, 2.0));
    float tail = smoothstep(0.0, -0.4, d) * exp(d * 4.5) * 0.5;
    float travelling = (core + tail) * uActive;

    float amount = uRest + travelling;

    // Across the strand, for the wash only.
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float fade = mix(1.0, pow(across, 2.2) * 0.32, uHalo);

    vec3 colour = mix(uColour, uHot, clamp(core * uActive * 1.6, 0.0, 1.0));
    gl_FragColor = vec4(colour, clamp(amount * fade, 0.0, 1.0));
  }
`

function makeMaterial(halo: boolean, rest: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uActive: { value: 0 },
      uHalo: { value: halo ? 1 : 0 },
      uRest: { value: rest },
      uColour: { value: new THREE.Color(halo ? palette.vein : palette.live) },
      uHot: { value: new THREE.Color(palette.core) },
    },
  })
}

/** Core and wash geometry for a set of strands, merged into one mesh each. */
function build(strands: Strand[]): { core: THREE.BufferGeometry | null; halo: THREE.BufferGeometry | null } {
  const cores: THREE.BufferGeometry[] = []
  const halos: THREE.BufferGeometry[] = []
  for (const strand of strands) {
    const v: [number, number] = [strand.from, strand.to]
    // Segment counts scale with how important a strand is. A third-generation hair 15cm long
    // does not need 72 segments, and there are a lot of them.
    const segments = strand.depth === 0 ? 84 : strand.depth === 1 ? 26 : 12
    const radial = strand.depth === 0 ? 5 : 4
    cores.push(
      taperedTube(strand.curve, (t) => strand.r0 + (strand.r1 - strand.r0) * t, segments, radial, false, v)
    )
    halos.push(
      flatRibbon(
        strand.curve,
        (t) => (strand.r0 + (strand.r1 - strand.r0) * t) * HALO_WIDTH,
        Math.max(12, Math.round(segments / 2)),
        -0.004,
        v
      )
    )
  }
  return { core: mergeAll(cores), halo: mergeAll(halos) }
}

/**
 * The bright junctions, as one screen-facing point cloud.
 *
 * `Points` rather than meshes because these are flares — light with no shape of its own — and a
 * flare has to face the camera. One draw call for all of them, and the star texture is drawn in
 * code so it can be four-pointed, which is what the art's junctions actually are.
 */
function Nodes({ network, brightness }: { network: Network; brightness: React.RefObject<Map<string, number>> }) {
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
    return { geometry: buffer, owners: ownerList, at01: positionAlong }
  }, [network])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uMap: { value: texture }, uColour: { value: new THREE.Color(palette.core) } },
        vertexShader: /* glsl */ `
          attribute float aSize;
          attribute float aAlpha;
          varying float vAlpha;
          void main() {
            vAlpha = aAlpha;
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
          void main() {
            vec4 texel = texture2D(uMap, gl_PointCoord);
            gl_FragColor = vec4(uColour, texel.a * vAlpha);
          }
        `,
      }),
    [texture]
  )

  useFrame(() => {
    const alpha = geometry.getAttribute('aAlpha') as THREE.BufferAttribute
    const array = alpha.array as Float32Array
    let changed = false
    for (let i = 0; i < array.length; i++) {
      const owner = owners[i]
      const active = owner ? (brightness.current?.get(owner) ?? 0) : 0
      // A junction sits at a low resting brightness and flares when its stone is working. The
      // one at the stone's own foot flares hardest, which is where the eye should land.
      const want = 0.3 + active * 0.75 * (0.4 + (at01[i] ?? 0) * 0.6)
      if (Math.abs((array[i] ?? 0) - want) > 0.001) {
        array[i] = want
        changed = true
      }
    }
    if (changed) alpha.needsUpdate = true
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
  network: Network
  /** Stone ids with something happening on them, which is what sends light down a root. */
  active: ReadonlySet<string>
}

export function Mycelium({ network, active }: MyceliumProps) {
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
      // The unowned delta under the tree rests brighter than the long runs, because in the art
      // the ground right under the trunk is the brightest part of the floor by a wide margin.
      coreMaterial: makeMaterial(false, owner === null ? 0.7 : 0.62),
      haloMaterial: makeMaterial(true, owner === null ? 1.1 : 1.0),
    }))
  }, [network])

  /* Disposed on unmount. Three does not free GPU buffers when a React tree goes away, and this
   * file builds a lot of them — on a hot reload without this the memory climbs every save. */
  useEffect(
    () => () => {
      for (const group of groups) {
        group.core?.dispose()
        group.halo?.dispose()
        group.coreMaterial.dispose()
        group.haloMaterial.dispose()
      }
    },
    [groups]
  )

  /** Eased activity per stone, shared with the junction flares so the two cannot disagree. */
  const brightness = useRef<Map<string, number>>(new Map())

  useFrame((state, delta) => {
    groups.forEach((group, index) => {
      const owner = group.owner
      const want = owner && active.has(owner) ? 1 : 0
      const current = owner ? (brightness.current.get(owner) ?? 0) : 0
      // Eased rather than switched: a stone finishing its work should fade its root out over
      // about a second. Abrupt changes are what make a scene feel like a status page.
      const next = THREE.MathUtils.damp(current, want, 3.2, delta)
      if (owner) brightness.current.set(owner, next)

      const time = state.clock.elapsedTime * motion.myceliumFlow + index * 0.37
      for (const material of [group.coreMaterial, group.haloMaterial]) {
        material.uniforms.uActive!.value = next
        material.uniforms.uTime!.value = time
      }
    })
  })

  return (
    <group>
      {groups.map((group, i) => (
        <group key={group.owner ?? `unowned-${i}`}>
          {group.halo ? <mesh geometry={group.halo} material={group.haloMaterial} renderOrder={1} /> : null}
          {group.core ? <mesh geometry={group.core} material={group.coreMaterial} renderOrder={2} /> : null}
        </group>
      ))}
      <Nodes network={network} brightness={brightness} />
    </group>
  )
}
