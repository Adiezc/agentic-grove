/**
 * The mycelial network: roots, not wires.
 *
 * The brief is specific about this and it is worth honouring precisely. These are *not* orbits
 * and *not* cables — they hug the ground, they branch, they wander, and they carry light from the
 * tree out to a stone when an agent deploys there. Get that wrong and the metaphor becomes
 * decoration, which is the difference between a world and a diagram.
 *
 * Two layers, as in the art:
 *   - a dim resting web that is always there, because the connection exists whether or not
 *     anything is travelling along it
 *   - a bright pulse that runs from trunk to stone when work is happening at that stone
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette, motion } from '../theme/palette'
import { at, mergeAll, seededRandom, taperedTube } from './geometry'

/**
 * A root path from the tree base to a stone.
 *
 * The wander is the whole trick. A straight line, or even a clean arc, reads as infrastructure;
 * three off-axis control points with a seeded wobble read as something grown. The path also lifts
 * a few millimetres off the floor at its midpoint, because a root perfectly flat on the ground
 * z-fights with it and flickers.
 */
/**
 * How far out the raised dais extends, and how tall its top face is.
 *
 * The roots have to ride *over* the dais and then step down onto the floor beyond it. The first
 * version ran them all at y = 0.014, which is underneath a dais whose top face is at 0.06 — so
 * the entire network was buried inside the platform and the scene rendered with no visible roots
 * at all. The art's roots are among its most prominent features, so this was not a subtle miss.
 */
const DAIS_RADIUS = 2.3
const DAIS_TOP = 0.062

/** Sit on whatever surface is underneath at this distance from the trunk. */
const heightAt = (radius: number) => (radius < DAIS_RADIUS ? DAIS_TOP + 0.016 : 0.018)

function rootPath(to: [number, number], seed: number): THREE.CatmullRomCurve3 {
  const random = seededRandom(seed)
  const target = new THREE.Vector3(to[0], 0, to[1])
  const distance = target.length()
  const direction = target.clone().normalize()
  // Perpendicular on the ground plane, to push the middle of the root off the direct line.
  const side = new THREE.Vector3(-direction.z, 0, direction.x)

  const points: THREE.Vector3[] = [new THREE.Vector3(0, DAIS_TOP + 0.05, 0)]
  // An extra control point right at the dais edge, so the step down happens there rather than
  // being smoothed into a ramp across the whole floor.
  for (const t of [0.2, 0.4, DAIS_RADIUS / distance, 0.75]) {
    if (t >= 1) continue
    const sway = (random() - 0.5) * distance * 0.34
    const alongRadius = distance * t
    points.push(
      direction
        .clone()
        .multiplyScalar(alongRadius)
        .add(side.clone().multiplyScalar(sway))
        .setY(heightAt(alongRadius))
    )
  }
  points.push(target.setY(0.018))
  return new THREE.CatmullRomCurve3(points)
}

export interface MyceliumLink {
  id: string
  to: [number, number]
  /** True when something is working at that stone, which is what sends light down the root. */
  active: boolean
}

export function Mycelium({ links }: { links: MyceliumLink[] }) {
  const paths = useMemo(
    () => links.map((link, index) => ({ link, curve: rootPath(link.to, 101 + index * 17) })),
    [links]
  )

  /**
   * Every resting root, merged into one mesh.
   *
   * Thin. At 0.032 these rendered as pale tubes lying on the floor, overcorrected from being
   * invisible straight past what the art shows, which is a filament rather than a pipe.
   */
  const restGeometry = useMemo(
    () => mergeAll(paths.map(({ curve }) => taperedTube(curve, (t) => 0.013 * (1 - t * 0.45) + 0.004, 72, 5))),
    [paths]
  )

  /**
   * The resting web.
   *
   * Brightened a long way from the first attempt, which used the darkest green in the palette
   * and rendered as nothing at all. In the concept art every root glows — the network is
   * *always* connected, and what changes with activity is how hard the light runs through it,
   * not whether it exists. That is also the truer metaphor: a project you are not working on is
   * still attached to the tree.
   */
  const restMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.live,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  )

  /**
   * The travelling pulse.
   *
   * A shader rather than a moving mesh, because a mesh would have to be repositioned along the
   * curve on the CPU every frame for every link. Here the geometry never moves: the tube's `v`
   * coordinate runs 0 to 1 along its length, so a moving window in the fragment shader *is* the
   * pulse, and the whole thing costs one uniform per link per frame.
   */
  const pulseMaterials = useMemo(
    () =>
      paths.map(
        () =>
          new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
              uTime: { value: 0 },
              uActive: { value: 0 },
              uColour: { value: new THREE.Color(palette.core) },
              uGlow: { value: new THREE.Color(palette.live) },
            },
            vertexShader: /* glsl */ `
              varying vec2 vUv;
              void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `,
            fragmentShader: /* glsl */ `
              uniform float uTime;
              uniform float uActive;
              uniform vec3 uColour;
              uniform vec3 uGlow;
              varying vec2 vUv;

              void main() {
                // vUv.y runs from the tree (0) to the stone (1). The head of the pulse travels
                // along it; fract() makes it repeat without any state to keep.
                float head = fract(uTime);
                float d = vUv.y - head;

                // A short bright core with a long tail behind it, so the pulse reads as moving
                // *towards* the stone rather than as a bead sliding along a wire.
                float core = exp(-pow(d * 26.0, 2.0));
                float tail = smoothstep(0.0, -0.42, d) * exp(d * 4.5) * 0.55;

                // Always a faint standing glow, so an active root is visible between pulses.
                float base = 0.16;

                float amount = (core + tail + base) * uActive;
                vec3 colour = mix(uGlow, uColour, clamp(core * 1.4, 0.0, 1.0));
                gl_FragColor = vec4(colour, clamp(amount, 0.0, 1.0));
              }
            `,
          })
      ),
    [paths]
  )

  /** Slightly fatter than the resting root, so the light appears to swell the root it runs in. */
  const pulseGeometries = useMemo(
    () => paths.map(({ curve }) => taperedTube(curve, (t) => 0.019 * (1 - t * 0.4) + 0.006, 96, 6)),
    [paths]
  )

  /**
   * Side filaments: short offshoots that branch off a root and simply stop.
   *
   * One root per stone is a hub-and-spoke diagram, which is exactly what the brief says the
   * mycelium must not be. Real mycelium branches constantly and most branches lead nowhere, and
   * adding that is the difference between a wiring harness and something grown. They carry no
   * meaning and never light up — they are texture.
   */
  const filaments = useMemo(() => {
    const random = seededRandom(89)
    return paths.flatMap(({ curve }) =>
      [0.28, 0.52, 0.78].map((t) => {
        const from = curve.getPointAt(t)
        const tangent = curve.getTangentAt(t)
        const side = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(random() < 0.5 ? 1 : -1)
        const reach = 0.3 + random() * 0.55
        const branch = new THREE.CatmullRomCurve3([
          from.clone(),
          from.clone().add(side.clone().multiplyScalar(reach * 0.45)).add(tangent.clone().multiplyScalar(reach * 0.3)),
          from.clone().add(side.clone().multiplyScalar(reach)).add(tangent.clone().multiplyScalar(reach * 0.15)),
        ])
        return taperedTube(branch, (u) => 0.008 * (1 - u) + 0.002, 18, 4)
      })
    )
  }, [paths])

  const filamentGeometry = useMemo(() => mergeAll(filaments), [filaments])

  /** Bright nodes where roots cross, as in the art. Purely visual; they mean nothing. */
  const nodeGeometry = useMemo(() => {
    const random = seededRandom(53)
    return mergeAll(
      paths.flatMap(({ curve }) =>
        [0.32, 0.66].map((t) => {
          const point = curve.getPointAt(t)
          const size = 0.016 + random() * 0.013
          return at(new THREE.SphereGeometry(size, 8, 8), point.x, point.y + 0.004, point.z)
        })
      )
    )
  }, [paths])

  const nodeMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.live,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  )

  const activeRef = useRef<number[]>(links.map(() => 0))

  useFrame((state, delta) => {
    paths.forEach(({ link }, index) => {
      const material = pulseMaterials[index]
      if (!material) return
      // Eased rather than switched, so a stone finishing its work fades its root out over about
      // a second instead of the light vanishing. Abrupt changes are what make a scene feel like
      // a status page.
      const target = link.active ? 1 : 0
      const current = activeRef.current[index] ?? 0
      const next = THREE.MathUtils.damp(current, target, 3.2, delta)
      activeRef.current[index] = next
      material.uniforms.uActive!.value = next
      material.uniforms.uTime!.value = state.clock.elapsedTime * motion.myceliumFlow + index * 0.37
    })
  })

  return (
    <group>
      {restGeometry ? <mesh geometry={restGeometry} material={restMaterial} /> : null}
      {filamentGeometry ? <mesh geometry={filamentGeometry} material={restMaterial} /> : null}
      {pulseGeometries.map((geometry, i) => {
        const material = pulseMaterials[i]
        if (!material) return null
        return <mesh key={`pulse-${i}`} geometry={geometry} material={material} />
      })}
      {nodeGeometry ? <mesh geometry={nodeGeometry} material={nodeMaterial} /> : null}
    </group>
  )
}
