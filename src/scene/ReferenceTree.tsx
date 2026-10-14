import { useGLTF, useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { palette } from '../theme/palette'
import { mergeAll } from './geometry'
import { heartbeatFrame } from './heartbeat'
import type { Network } from './network'
import { DAIS_INNER_TOP, TREE_YAW, TREE_SCALE } from './stage'
import { addWoodlandSurface } from './woodlandMaterial'
import { addFoliageSurface } from './foliageMaterial'
import { rootBoundary, weldedRoot, barkIslands, type BarkVertex } from './rootWeld'
import type { MyceliumSignal } from './myceliumFlow'
import { HYPHA_BODY, HYPHA_GLOW, HYPHA_TIP_GLOW } from './rootTransition'

/** `_glow` at a root tip in the model. Must match ROOT_TIP_GLOW in the Blender build script. */
const ROOT_TIP_GLOW = 1.6

interface ReferenceTreeProps {
  activity: number
  animate: boolean
  foliageMotion?: boolean
  attention: boolean
  network: Network
  signals: React.RefObject<Map<string | null, MyceliumSignal>>
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
function addBarkGlow(
  material: THREE.MeshStandardMaterial,
  strength: { value: number },
  colour: { value: THREE.Color },
  hypha: { value: THREE.Color }
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.barkGlow = strength
    // Shared, like `strength`, so the whole tree's glow can lean amber at once.
    shader.uniforms.barkGlowColor = colour
    shader.uniforms.hyphaTipEmission = hypha
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _glow;\nvarying float vBarkGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBarkGlow = _glow;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float barkGlow;\nuniform vec3 barkGlowColor;\nuniform vec3 hyphaTipEmission;\nvarying float vBarkGlow;'
      )
      // Towards a root tip the wood takes on the mycelium's own body colour and light, so the
      // root has already become a hypha where the network takes over. Only root tips reach this
      // `_glow` band (the trunk's grooves stop at about 0.55), so the trunk is untouched.
      .replace('#include <metalnessmap_fragment>', `
        float hyphaTip = smoothstep(${HYPHA_TIP_GLOW[0].toFixed(2)}, ${HYPHA_TIP_GLOW[1].toFixed(2)}, vBarkGlow);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${new THREE.Color(HYPHA_BODY).toArray().join(',')}), hyphaTip);
        roughnessFactor = mix(roughnessFactor, 0.58, hyphaTip);
        #include <metalnessmap_fragment>`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += barkGlowColor * vBarkGlow * barkGlow * (1.0 - hyphaTip);
        totalEmissiveRadiance = mix(totalEmissiveRadiance, hyphaTipEmission, hyphaTip);`
      )
  }
  // Without this, three would reuse a compiled program from a wood material that has no glow.
  material.customProgramCacheKey = () => 'bark-glow-hypha'
}

/**
 * The concept tree, kept still, with live roots grown from the exact same curves as Mycelium.
 *
 * The Blender GLB follows the four reference plates and carries baked bark vertex colours.
 * Its exact root boundaries continue into the live network, so physical wood narrows into a
 * luminous mycelial strand rather than stopping at the edge of the model.
 */
export function ReferenceTree({ activity, attention, animate, foliageMotion = false, network, signals }: ReferenceTreeProps) {
  const modelUrl = new URL('../../assets/models/world-tree-blender.glb', import.meta.url).href
  // No Draco and no meshopt: the model uses neither, and the meshopt decoder is WebAssembly that
  // the page's security policy (`electron/page-rules.ts`) rightly refuses to compile.
  const { scene: sourceTree } = useGLTF(modelUrl, false, false)
  const lichen = useTexture(new URL('../../assets/materials/woodland-lichen.png', import.meta.url).href)
  lichen.wrapS = lichen.wrapT = THREE.RepeatWrapping
  // Photographed bark and leaf (Poly Haven and ambientCG, CC0; see CREDITS.md).
  const [livingBark, livingNormal, deadBark, deadNormal, leafColour, leafOpacity] = useTexture([
    new URL('../../assets/materials/bark-living-colour.jpg', import.meta.url).href,
    new URL('../../assets/materials/bark-living-normal.jpg', import.meta.url).href,
    new URL('../../assets/materials/deadwood-colour.jpg', import.meta.url).href,
    new URL('../../assets/materials/deadwood-normal.jpg', import.meta.url).href,
    new URL('../../assets/materials/leaf-colour.jpg', import.meta.url).href,
    new URL('../../assets/materials/leaf-opacity.jpg', import.meta.url).href,
  ]) as THREE.Texture[]
  const bark = useMemo(() => {
    for (const texture of [livingBark!, livingNormal!, deadBark!, deadNormal!]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping
      texture.anisotropy = 8
    }
    livingBark!.colorSpace = deadBark!.colorSpace = THREE.SRGBColorSpace
    return { living: livingBark!, livingNormal: livingNormal!, dead: deadBark!, deadNormal: deadNormal! }
  }, [livingBark, livingNormal, deadBark, deadNormal])
  const leaf = useMemo(() => {
    // glTF texture coordinates start at the top of the image.
    leafColour!.flipY = leafOpacity!.flipY = false
    leafColour!.colorSpace = THREE.SRGBColorSpace
    leafColour!.needsUpdate = leafOpacity!.needsUpdate = true
    return { colour: leafColour!, opacity: leafOpacity! }
  }, [leafColour, leafOpacity])
  // A review-only baseline switch allows identical camera/light comparisons.
  const woodland = !new URLSearchParams(window.location.search).has('baselineWood')
  const foliageUniforms = useMemo(() => ({ time: { value: 0 }, wind: { value: 0 } }), [])
  const model = useMemo(() => {
    const clone = sourceTree.clone(true)
    const energyMaterials: THREE.MeshStandardMaterial[] = []
    const foliageMaterials: THREE.MeshStandardMaterial[] = []
    const woodMaterials: THREE.MeshStandardMaterial[] = []
    const barkGlow = { value: 0 }
    const barkGlowColour = { value: new THREE.Color(palette.energy) }
    const hyphaTip = { value: new THREE.Color(HYPHA_GLOW) }
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
          if (woodland) addFoliageSurface(material, foliageUniforms, leaf)
          foliageMaterials.push(material)
        } else {
          // A small ambient floor keeps the baked grain visible without flattening its shadows.
          material.emissive.set('#11180f')
          if (object.geometry.hasAttribute('_glow')) addBarkGlow(material, barkGlow, barkGlowColour, hyphaTip)
          if (woodland && material.name.includes('Bark')) addWoodlandSurface(material, lichen, bark)
          woodMaterials.push(material)
        }
      }
    })
    // Blender exports metres with Y up. Fit the whole model to the grove's height, and stand its
    // floor (Blender's z = 0) on the platform. Not its lowest point: the strand feet are buried a
    // little below the floor on purpose, so their ends never show. The Blender build uses the same
    // rule for the root tips it writes out.
    const bounds = new THREE.Box3().setFromObject(clone)
    const scale = 4.25 * TREE_SCALE / bounds.getSize(new THREE.Vector3()).y
    clone.scale.setScalar(scale)
    clone.updateMatrixWorld(true)
    const barkSamples: BarkVertex[] = []
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      if (!object.name.includes('Carved_Anatomy')) return
      const islands = barkIslands(object.geometry)
      const positions = object.geometry.getAttribute('position')
      const colours = object.geometry.getAttribute('color')
      const normals = object.geometry.getAttribute('normal')
      const glow = object.geometry.getAttribute('_glow')
      const grain = object.geometry.getAttribute('_grain')
      const repeats = object.geometry.getAttribute('_bark')
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld)
      if (!colours) return
      for (let i = 0; i < positions.count; i++) {
        const at = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)
        if (at.y > 0.12) continue
        at.applyAxisAngle(new THREE.Vector3(0, 1, 0), TREE_YAW)
        barkSamples.push({ at, island: islands[i]!, colour: new THREE.Color().fromBufferAttribute(colours, i),
          normal: new THREE.Vector3().fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix).applyAxisAngle(new THREE.Vector3(0, 1, 0), TREE_YAW),
          glow: glow?.getX(i) ?? ROOT_TIP_GLOW,
          grain: grain ? new THREE.Vector3().fromBufferAttribute(grain, i) : undefined,
          bark: repeats?.getX(i) })
      }
    })
    const veinColours = energyMaterials.map((material) => material.emissive.clone())
    return { tree: clone, energyMaterials, foliageMaterials, woodMaterials, barkGlow, barkGlowColour, hyphaTip, veinColours, barkSamples, bark }
  }, [sourceTree, lichen, woodland, foliageUniforms, bark, leaf])

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

  // Each owner retains its original growth/attention signal, while the root body
  // remains one uninterrupted mesh all the way from the authored ring to the network.
  const roots = useMemo(() => {
    const byOwner = new Map<string | null, THREE.BufferGeometry[]>()
    for (const strand of rootBorn) {
      const geometry = weldedRoot(strand, rootBoundary(strand, model.barkSamples))
      const list = byOwner.get(strand.owner) ?? []
      list.push(geometry)
      byOwner.set(strand.owner, list)
    }
    return [...byOwner].map(([owner, pieces]) => {
      const geometry = mergeAll(pieces)
      if (pieces.length > 1) pieces.forEach(piece => piece.dispose())
      const emission = { value: new THREE.Color(HYPHA_GLOW) }
      const growth = { value: 1 }
      const material = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true,
        roughness: 0.78, emissive: '#11180f', emissiveIntensity: 0.15 })
      addBarkGlow(material, model.barkGlow, model.barkGlowColour, model.hyphaTip)
      if (woodland) addWoodlandSurface(material, lichen, model.bark)
      const previous = material.onBeforeCompile, key = material.customProgramCacheKey()
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer)
        shader.uniforms.hyphaEmission = emission
        shader.uniforms.rootGrowth = growth
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float rootBlend; attribute float rootJourney; varying float vRootBlend; varying float vRootJourney;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRootBlend = rootBlend; vRootJourney = rootJourney;')
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vRootBlend; varying float vRootJourney; uniform vec3 hyphaEmission; uniform float rootGrowth;')
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vRootBlend >= 1.0 && vRootJourney > rootGrowth * 1.2) discard;')
          .replace('#include <metalnessmap_fragment>', `
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${new THREE.Color(HYPHA_BODY).toArray().join(',')}), vRootBlend);
            roughnessFactor = mix(roughnessFactor, 0.58, vRootBlend);
            #include <metalnessmap_fragment>`)
          .replace('#include <lights_physical_fragment>', `
            totalEmissiveRadiance = mix(totalEmissiveRadiance, hyphaEmission, vRootBlend);
            #include <lights_physical_fragment>`)
      }
      material.customProgramCacheKey = () => key + ':welded-root'
      return { owner, geometry, material, emission, growth }
    })
  }, [rootBorn, model, woodland, lichen])
  useEffect(() => () => roots.forEach(root => { root.geometry?.dispose(); root.material.dispose() }), [roots])

  const auraLight = useRef<THREE.PointLight>(null)
  const smoothedActivity = useRef(0)
  const amber = useRef(0)
  const amberColour = useMemo(() => new THREE.Color(palette.waiting), [])
  const energyColour = useMemo(() => new THREE.Color(palette.energy), [])

  useFrame((state, delta) => {
    foliageUniforms.time.value = state.clock.elapsedTime
    foliageUniforms.wind.value = animate && foliageMotion ? 0.014 : 0
    smoothedActivity.current = THREE.MathUtils.damp(smoothedActivity.current, activity, 1.7, delta)
    const workload = smoothedActivity.current
    const pulse = animate ? heartbeatFrame(state.clock.elapsedTime, workload, attention).pulse : 0.28
    const beat = pulse * (0.28 + workload * 0.78 + (attention ? 0.28 : 0))

    // The surface lines are meant to be faint now that most of the light is in the grooves.
    for (const material of model.energyMaterials) material.emissiveIntensity = 1.2 + workload * 0.9 + beat * 2.2
    for (const material of model.foliageMaterials) material.emissiveIntensity = 0.06 + workload * 0.04 + beat * 0.08
    for (const material of model.woodMaterials) material.emissiveIntensity = 0.12 + beat * 0.10
    // Kept under the bloom threshold at rest, so only the veins themselves blow out and the bark
    // around them reads as lit wood; each beat pushes it briefly over.
    // Raised when the glow moved from painted lines into the grooves: the grooves are narrow and
    // mostly in shadow, so they need more light per pixel to read as lit from inside.
    model.barkGlow.value = 0.36 + workload * 0.18 + beat * 0.45
    for (const root of roots) {
      const signal = signals.current.get(root.owner)
      root.growth.value = signal?.grow ?? 1
      root.material.emissiveIntensity = 0.12 + beat * 0.10
      root.emission.value.set(HYPHA_GLOW).lerp(amberColour, (signal?.attention ?? 0) * 0.25)
        .multiplyScalar(0.85 + pulse * 0.3)
    }

    // Something needs you: the tree's light leans amber, and leans furthest on each beat. The
    // veins are one heartbeat with the mycelium, so they change colour together with it.
    amber.current = THREE.MathUtils.damp(amber.current, attention ? 1 : 0, 1.4, delta)
    const lean = amber.current * (0.35 + pulse * 0.55)
    model.barkGlowColour.value.copy(energyColour).lerp(amberColour, lean)
    model.energyMaterials.forEach((material, i) => {
      material.emissive.copy(model.veinColours[i]!).lerp(amberColour, lean)
    })
    auraLight.current?.color.copy(energyColour).lerp(amberColour, lean)
    // The same light the network's cords carry (Mycelium's cord material), so tip and cord match.
    model.hyphaTip.value.set(HYPHA_GLOW).lerp(amberColour, lean * 0.25).multiplyScalar(0.85 + pulse * 0.3)

    if (auraLight.current) {
      auraLight.current.intensity = 0.22 + workload * 0.75 + beat * 1.45
      auraLight.current.distance = 5.5 + workload * 6.2 + beat * 1.8
    }
  })

  return (
    <group position={[0, DAIS_INNER_TOP, 0]}>
      {/* There used to be a soft glowing disc here too, a sprite just behind the trunk that swelled
          with the heartbeat. From the old high view the trunk hid it; from the lower home view of
          3 October 2026, and from any side, it floated beside the tree as a green dot (Adrian
          asked what it was). Removed: the point light below still carries the heartbeat's glow
          onto the wood, and the home view looked the same without it. */}

      {roots.map(root => root.geometry ? <mesh key={root.owner ?? 'ambient'} geometry={root.geometry}
        material={root.material} receiveShadow /> : null)}

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

useGLTF.preload(new URL('../../assets/models/world-tree-blender.glb', import.meta.url).href, false, false)
