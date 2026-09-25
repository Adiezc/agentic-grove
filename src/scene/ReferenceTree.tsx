import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { palette } from '../theme/palette'
import { mergeAll, taperedTube } from './geometry'
import { heartbeatFrame } from './heartbeat'
import type { Network } from './network'
import { DAIS_INNER_TOP, TREE_YAW } from './stage'

/** How far the wood carries on along the network past each root tip, in grove units. */
const ROOT_CONTINUATION = 0.55

/** `_glow` at a root tip in the model. Must match ROOT_TIP_GLOW in the Blender build script. */
const ROOT_TIP_GLOW = 1.6

interface ReferenceTreeProps {
  activity: number
  animate: boolean
  attention: boolean
  network: Network
}

function sampleStart(curve: THREE.CatmullRomCurve3, portion: number, lift = 0) {
  return new THREE.CatmullRomCurve3(
    Array.from({ length: 21 }, (_, index) => {
      const point = curve.getPointAt((index / 20) * portion).clone()
      point.y += lift
      return point
    })
  )
}

function activityTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context) {
    const centre = size / 2
    const gradient = context.createRadialGradient(centre, centre, 0, centre, centre, centre)
    gradient.addColorStop(0, 'rgba(210,255,226,0.96)')
    gradient.addColorStop(0.07, 'rgba(114,246,162,0.72)')
    gradient.addColorStop(0.3, 'rgba(66,178,110,0.24)')
    gradient.addColorStop(0.68, 'rgba(18,77,42,0.06)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Lets the bark around the veins glow, as it does in the concept art.
 *
 * The Blender model carries a per-vertex `_glow` value: 1 right beside a vein, fading to 0 a few
 * centimetres away, and brighter low on the trunk. Three's standard material has no slot for a
 * value like that, so a few lines are spliced into its shader to add it as extra emissive light.
 * `strength` is shared by every wood material and set each frame from the heartbeat, so the
 * bark breathes together with the veins instead of sitting at a fixed brightness.
 */
function addBarkGlow(material: THREE.MeshStandardMaterial, strength: { value: number }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.barkGlow = strength
    shader.uniforms.barkGlowColor = { value: new THREE.Color(palette.energy) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _glow;\nvarying float vBarkGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBarkGlow = _glow;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float barkGlow;\nuniform vec3 barkGlowColor;\nvarying float vBarkGlow;'
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += barkGlowColor * vBarkGlow * barkGlow;'
      )
  }
  // Without this, three would reuse a compiled program from a wood material that has no glow.
  material.customProgramCacheKey = () => 'bark-glow'
}

/**
 * The concept tree, kept still, with live roots grown from the exact same curves as Mycelium.
 *
 * The Blender GLB follows the four reference plates and carries baked bark vertex colours.
 * Its roots overlap the first sections of the live network, so physical wood narrows into a
 * luminous mycelial strand rather than stopping at the edge of the model.
 */
export function ReferenceTree({ activity, attention, animate, network }: ReferenceTreeProps) {
  const modelUrl = new URL('../../assets/models/world-tree-blender.glb', import.meta.url).href
  const { scene: sourceTree } = useGLTF(modelUrl, false)
  const model = useMemo(() => {
    const clone = sourceTree.clone(true)
    const energyMaterials: THREE.MeshStandardMaterial[] = []
    const foliageMaterials: THREE.MeshStandardMaterial[] = []
    const woodMaterials: THREE.MeshStandardMaterial[] = []
    const barkGlow = { value: 0 }
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      object.receiveShadow = true
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      const cloned = materials.map((material) => material.clone())
      object.material = Array.isArray(object.material) ? cloned : cloned[0]!
      for (const material of cloned) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue
        if (material.name.includes('Glow')) {
          energyMaterials.push(material)
        } else if (material.name.includes('Leaf')) {
          material.side = THREE.DoubleSide
          material.emissive.copy(material.color)
          foliageMaterials.push(material)
        } else {
          // A small ambient floor keeps the baked grain visible without flattening its shadows.
          material.emissive.set('#11180f')
          if (object.geometry.hasAttribute('_glow')) addBarkGlow(material, barkGlow)
          woodMaterials.push(material)
        }
      }
    })
    // Blender exports metres with Y up. Fit the crown to the existing grove and put the
    // lowest root exactly on its platform, independently of authoring-camera coordinates.
    const bounds = new THREE.Box3().setFromObject(clone)
    const scale = 4.25 / bounds.getSize(new THREE.Vector3()).y
    clone.scale.setScalar(scale)
    clone.position.y = -bounds.min.y * scale
    return { tree: clone, energyMaterials, foliageMaterials, woodMaterials, barkGlow }
  }, [sourceTree])

  useEffect(() => () => {
    for (const material of [...model.energyMaterials, ...model.foliageMaterials, ...model.woodMaterials]) {
      material.dispose()
    }
  }, [model])

  /* The strands that leave a root tip, each drawn relative to the tree group's origin. */
  const rootBorn = useMemo(
    () => network.strands.filter((strand) => strand.rootRadius !== undefined),
    [network]
  )

  /*
   * The wood carried on past each root tip.
   *
   * It starts at exactly the model's tip radius, on exactly the tip, heading the same way — the
   * network is grown from those tips — and thins to nothing over the next half metre. So a root
   * narrows into a line of light instead of stopping beside one. The light core running inside it
   * comes out of the wood as the wood runs out, which is what the concept art shows.
   */
  const rootWood = useMemo(
    () =>
      mergeAll(
        rootBorn.map((strand) => {
          const portion = Math.min(1, ROOT_CONTINUATION / strand.curve.getLength())
          const curve = sampleStart(strand.curve, portion, -DAIS_INNER_TOP)
          const start = strand.rootRadius ?? 0.012
          const tube = taperedTube(curve, (t) => start * (1 - t) ** 1.25 + 0.0008, 28, 7)
          // The same `_glow` the model's root ends carry, rising along the stretch, so the
          // bark shader lights this wood exactly as bright as the root it continues, and
          // brighter as it thins into the mycelium core.
          const uv = tube.getAttribute('uv') as THREE.BufferAttribute
          const glow = new Float32Array(uv.count)
          for (let i = 0; i < uv.count; i++) glow[i] = ROOT_TIP_GLOW + uv.getY(i) * 1.4
          tube.setAttribute('_glow', new THREE.BufferAttribute(glow, 1))
          return tube
        })
      ),
    [rootBorn]
  )

  /* A brighter vein along the same stretch, sitting on top of the wood, so the light is seen to
   * run out of the root rather than starting where the wood ends. */
  const rootLight = useMemo(
    () =>
      mergeAll(
        rootBorn.map((strand) => {
          const portion = Math.min(1, (ROOT_CONTINUATION * 1.4) / strand.curve.getLength())
          const curve = sampleStart(strand.curve, portion, -DAIS_INNER_TOP + (strand.rootRadius ?? 0.012) * 0.55)
          return taperedTube(curve, (t) => 0.0042 * (1 - t) ** 0.8 + 0.0012, 32, 5)
        })
      ),
    [rootBorn]
  )

  // Matched to the model's baked living-wood bark as it renders under this group's lights, and
  // lit by the same heartbeat-driven bark glow.
  const woodMaterial = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      color: '#6a5d49',
      roughness: 0.78,
      metalness: 0.0,
      emissive: new THREE.Color('#11180f'),
      emissiveIntensity: 0.15,
    })
    addBarkGlow(material, model.barkGlow)
    return material
  }, [model])

  const rootLightMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.live,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  )

  const auraMap = useMemo(activityTexture, [])
  const aura = useRef<THREE.Sprite>(null)
  const auraLight = useRef<THREE.PointLight>(null)
  const smoothedActivity = useRef(0)

  useFrame((state, delta) => {
    smoothedActivity.current = THREE.MathUtils.damp(smoothedActivity.current, activity, 1.7, delta)
    const workload = smoothedActivity.current
    const pulse = animate ? heartbeatFrame(state.clock.elapsedTime, workload, attention).pulse : 0.28
    const beat = pulse * (0.28 + workload * 0.78 + (attention ? 0.28 : 0))

    // The surface lines are meant to be faint now that most of the light is in the grooves.
    for (const material of model.energyMaterials) material.emissiveIntensity = 1.2 + workload * 0.9 + beat * 2.2
    for (const material of model.foliageMaterials) material.emissiveIntensity = 0.14 + workload * 0.10 + beat * 0.20
    for (const material of model.woodMaterials) material.emissiveIntensity = 0.12 + beat * 0.10
    // Kept under the bloom threshold at rest, so only the veins themselves blow out and the bark
    // around them reads as lit wood; each beat pushes it briefly over.
    // Raised when the glow moved from painted lines into the grooves: the grooves are narrow and
    // mostly in shadow, so they need more light per pixel to read as lit from inside.
    model.barkGlow.value = 0.36 + workload * 0.18 + beat * 0.45
    rootLightMaterial.opacity = 0.64 + workload * 0.12 + beat * 0.22

    if (aura.current) {
      const radius = 2.45 + workload * 2.7 + beat * 0.82
      aura.current.scale.set(radius, radius, 1)
      ;(aura.current.material as THREE.SpriteMaterial).opacity =
        0.035 + workload * 0.06 + beat * 0.075
    }
    if (auraLight.current) {
      auraLight.current.intensity = 0.22 + workload * 0.75 + beat * 1.45
      auraLight.current.distance = 5.5 + workload * 6.2 + beat * 1.8
    }
  })

  return (
    <group position={[0, DAIS_INNER_TOP, 0]}>
      <sprite ref={aura} position={[0, 1.45, -0.95]} renderOrder={0}>
        <spriteMaterial
          map={auraMap}
          color={palette.energy}
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>

      {rootWood ? <mesh geometry={rootWood} material={woodMaterial} renderOrder={1} /> : null}
      {rootLight ? <mesh geometry={rootLight} material={rootLightMaterial} renderOrder={3} /> : null}

      <group rotation={[0, TREE_YAW, 0]}>
        <primitive object={model.tree} />
      </group>

      {/* Model-local lighting preserves the reference's pale shari and shaded living wood even
          though the wider grove intentionally keeps its environmental light close to black. */}
      <hemisphereLight args={[palette.glow, palette.ground, 0.24]} />
      <directionalLight position={[-4, 7, 5]} intensity={1.65} color="#fff2db" />
      <directionalLight position={[5, 4, 3]} intensity={0.36} color={palette.vein} />

      <pointLight
        ref={auraLight}
        position={[0, 0.95, 0.3]}
        color={palette.energy}
        intensity={0.7}
        distance={8}
        decay={2}
      />
    </group>
  )
}

useGLTF.preload(new URL('../../assets/models/world-tree-blender.glb', import.meta.url).href, false)
