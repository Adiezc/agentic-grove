/**
 * Motes and fallstreaks: the air of the place.
 *
 * Two separate things that both happen to be small bright specks, kept in one file because they
 * share one instanced-mesh technique and neither is worth its own:
 *
 *   - **Motes** drift and rise near the tree. Ambient. They mean nothing, and saying so matters:
 *     the brief reserves a mote *detaching from a stone and travelling to the trunk* as the
 *     attention signal, and that signal only works if ambient motes are clearly a different
 *     thing. These ones never leave the canopy.
 *   - **Fallstreaks** are the thin vertical dotted lines falling through the concept art. Pure
 *     atmosphere, like rain lit from below. They are what stops the upper half of the frame from
 *     being empty black.
 *
 * Both are driven entirely from the vertex shader on a static instanced mesh, so animating a
 * thousand of them costs one uniform update per frame rather than a thousand matrix writes.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette, motion } from '../theme/palette'
import { seededRandom } from './geometry'

const MOTE_COUNT = 260
const STREAK_COUNT = 90

export function Motes({ activity }: { activity: number }) {
  /**
   * Per-mote constants, uploaded once as instanced attributes: where it drifts around, how fast,
   * and how big. The shader does the rest, so nothing here is touched again after startup.
   */
  const moteGeometry = useMemo(() => {
    const random = seededRandom(211)
    const geometry = new THREE.InstancedBufferGeometry()
    const base = new THREE.PlaneGeometry(0.018, 0.018)
    geometry.index = base.index
    geometry.attributes.position = base.attributes.position!
    geometry.attributes.uv = base.attributes.uv!

    const offsets = new Float32Array(MOTE_COUNT * 3)
    const seeds = new Float32Array(MOTE_COUNT * 3)
    for (let i = 0; i < MOTE_COUNT; i++) {
      // Clustered around and above the tree, thinning outwards, so the air near the canopy is
      // busiest. A uniform box of specks reads as dust on the lens instead.
      const theta = random() * Math.PI * 2
      const radius = Math.pow(random(), 0.65) * 3.6
      offsets[i * 3] = Math.cos(theta) * radius
      offsets[i * 3 + 1] = 0.25 + Math.pow(random(), 0.8) * 3.4
      offsets[i * 3 + 2] = Math.sin(theta) * radius * 0.8
      seeds[i * 3] = random() * 100
      seeds[i * 3 + 1] = 0.4 + random() * 1.4
      seeds[i * 3 + 2] = 0.35 + random() * 0.65
    }
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3))
    geometry.instanceCount = MOTE_COUNT
    return geometry
  }, [])

  const moteMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uColour: { value: new THREE.Color(palette.glow) },
          uActivity: { value: 0 },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aOffset;
          attribute vec3 aSeed;
          uniform float uTime;
          uniform float uActivity;
          varying float vFade;
          varying vec2 vUv;

          void main() {
            vUv = uv;
            float t = uTime * aSeed.y;

            // A slow lissajous wander, plus a steady rise that wraps. The wrap is what lets this
            // run forever with no state: everything is a function of time and the instance seed.
            vec3 drift = vec3(
              sin(t * 0.31 + aSeed.x) * 0.5,
              mod(uTime * 0.06 * aSeed.z + aSeed.x, 3.2),
              cos(t * 0.27 + aSeed.x * 1.7) * 0.4
            );
            vec3 world = aOffset + drift;

            // Fade in from the bottom and out at the top of the rise, so nothing pops in or out.
            vFade = smoothstep(0.0, 0.5, drift.y) * (1.0 - smoothstep(2.2, 3.2, drift.y));
            // A busier grove has more of them visible, which is a second, quieter reading of
            // system activity behind the heartbeat.
            vFade *= 0.35 + 0.65 * uActivity;

            // Billboarded: the mote always faces the camera, so a flat quad reads as a point of
            // light from any angle.
            vec4 viewPosition = viewMatrix * vec4(world, 1.0);
            viewPosition.xy += position.xy;
            gl_Position = projectionMatrix * viewPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColour;
          varying float vFade;
          varying vec2 vUv;

          void main() {
            // Round, soft-edged, brightest in the middle. Bloom turns this into a firefly.
            float d = length(vUv - 0.5) * 2.0;
            float alpha = (1.0 - smoothstep(0.0, 1.0, d)) * vFade;
            gl_FragColor = vec4(uColour, alpha);
          }
        `,
      }),
    []
  )

  /** The falling dotted lines. Same idea, but tall thin quads and a straight downward fall. */
  const streakGeometry = useMemo(() => {
    const random = seededRandom(307)
    const geometry = new THREE.InstancedBufferGeometry()
    const base = new THREE.PlaneGeometry(0.006, 1.1)
    geometry.index = base.index
    geometry.attributes.position = base.attributes.position!
    geometry.attributes.uv = base.attributes.uv!

    const offsets = new Float32Array(STREAK_COUNT * 3)
    const seeds = new Float32Array(STREAK_COUNT * 2)
    for (let i = 0; i < STREAK_COUNT; i++) {
      offsets[i * 3] = (random() - 0.5) * 22
      offsets[i * 3 + 1] = random() * 7
      // Spread in depth, including well behind the tree, so some pass behind it and some in
      // front. That parallax is most of what sells the scene as having depth at all.
      offsets[i * 3 + 2] = (random() - 0.5) * 14 - 2
      seeds[i * 2] = random() * 100
      seeds[i * 2 + 1] = 0.25 + random() * 0.5
    }
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 2))
    geometry.instanceCount = STREAK_COUNT
    return geometry
  }, [])

  const streakMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uColour: { value: new THREE.Color(palette.live) },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aOffset;
          attribute vec2 aSeed;
          uniform float uTime;
          varying vec2 vUv;
          varying float vSeed;

          void main() {
            vUv = uv;
            vSeed = aSeed.x;
            float fall = mod(aSeed.x + uTime * aSeed.y * 0.35, 1.0) * 9.0;
            vec3 world = aOffset + vec3(0.0, 7.0 - fall, 0.0);
            vec4 viewPosition = viewMatrix * vec4(world, 1.0);
            viewPosition.xy += position.xy;
            gl_Position = projectionMatrix * viewPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColour;
          uniform float uTime;
          varying vec2 vUv;
          varying float vSeed;

          void main() {
            // Dashes along the streak rather than a solid line, which is what the art shows and
            // what makes them read as data falling rather than as rain.
            float dashes = step(0.55, fract(vUv.y * 9.0 + vSeed));
            // Faded at both ends so a streak has no visible start or stop.
            float ends = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
            float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
            gl_FragColor = vec4(uColour, dashes * ends * across * 0.32);
          }
        `,
      }),
    []
  )

  const activityRef = useRef(0)

  useFrame((state, delta) => {
    // Damped, so a scan that finds three new running sessions does not snap the air thicker.
    activityRef.current = THREE.MathUtils.damp(activityRef.current, activity, 1.8, delta)
    moteMaterial.uniforms.uTime!.value = state.clock.elapsedTime * motion.moteDrift * 10
    moteMaterial.uniforms.uActivity!.value = activityRef.current
    streakMaterial.uniforms.uTime!.value = state.clock.elapsedTime
  })

  return (
    <group>
      <mesh geometry={moteGeometry} material={moteMaterial} frustumCulled={false} />
      <mesh geometry={streakGeometry} material={streakMaterial} frustumCulled={false} />
    </group>
  )
}
