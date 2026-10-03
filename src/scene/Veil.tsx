/**
 * The far veil: faint green mist lying on the floor beyond the stones, all the way round the grove.
 *
 * Past the outer rings the scene used to fall off into flat black, which made the grove feel like
 * objects on a table rather than a place. The concept art has depth there: a darkness that is not
 * quite empty. The veil supplies it as mist settled on the floor and lit from below: long soft
 * streaks circling the clearing, fading in past the stones and out into the fog.
 *
 * Kept deliberately faint and slow, because the Grove sits on a screen all day:
 *
 *   - **Quiet.** At rest it is a few per cent above the void, the darkest green in the palette.
 *     It must never be the first thing the eye lands on.
 *   - **Slow.** The streaks drift round over minutes, not seconds. No flicker, no shimmer.
 *   - **Truthful.** It brightens a little with `activity`, the same measure that drives the
 *     heartbeat, so even the horizon says "work is happening". It never turns amber; that colour
 *     belongs to stones that need you.
 *   - **Still under reduced motion.** `animate` false freezes it where it is.
 *
 * One flat ring, one small shader, no lights and no fog, so it costs next to nothing.
 */
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette } from '../theme/palette'

/**
 * Where the mist lies. The home camera looks down at about thirty degrees, so the true horizon is
 * never on screen: the "background" in the top part of the frame is really the far floor, fading
 * into fog. (A first version stood the veil up as a wall on the horizon and it was simply out of
 * shot.) So the mist lies on the floor, in a wide ring from just beyond the outermost stone places
 * out to where the fog takes over.
 */
const INNER = 7.5
const OUTER = 40
const LIFT = 0.025

export function Veil({ activity, animate }: { activity: number; animate: boolean }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uLevel: { value: 0 },
          uDeep: { value: new THREE.Color(palette.deep) },
          uVein: { value: new THREE.Color(palette.vein) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vAt;
          void main() {
            vAt = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uLevel;
          uniform vec3 uDeep;
          uniform vec3 uVein;
          varying vec2 vAt;

          // Value noise. Cheap, smooth, and plenty for something this soft.
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
          }

          void main() {
            // Polar, so the mist drifts round the grove rather than across it. Long soft streaks
            // along each circle, the way mist settles round a clearing; two layers at different
            // speeds so it never looks tiled.
            float r = length(vAt);
            float around = atan(vAt.y, vAt.x) * 3.0;
            float folds = noise(vec2(around + uTime * 0.008, r * 0.55)) * 0.6
                        + noise(vec2(around * 2.3 - uTime * 0.013, r * 1.1 + uTime * 0.003)) * 0.4;
            folds = smoothstep(0.42, 0.95, folds);

            // Fades in past the stones and out into the fog, so it has no edge anywhere.
            float ring = smoothstep(${INNER.toFixed(1)}, ${(INNER + 6).toFixed(1)}, r) * (1.0 - smoothstep(${(OUTER - 16).toFixed(1)}, ${OUTER.toFixed(1)}, r));

            vec3 colour = mix(uDeep, uVein, folds * 0.5);
            gl_FragColor = vec4(colour * folds * ring * uLevel, 1.0);
          }
        `,
      }),
    []
  )

  useFrame((_state, delta) => {
    if (animate) material.uniforms.uTime!.value += delta
    // At rest a faint presence; with work under way, up to about twice that. Judged against the
    // demo grove: a level of 0.4 was already competing with the tree. Eased, so a stone
    // starting or stopping never makes the horizon jump.
    const target = 0.1 + Math.min(1, activity) * 0.1
    const level = material.uniforms.uLevel!
    level.value += (target - level.value) * Math.min(1, delta * 0.5)
  })

  return (
    <mesh material={material} position={[0, LIFT, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} frustumCulled={false}>
      <ringGeometry args={[INNER, OUTER, 128, 1]} />
    </mesh>
  )
}
