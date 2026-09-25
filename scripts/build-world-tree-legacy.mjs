import fs from 'node:fs/promises'
import path from 'node:path'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

class NodeFileReader {
  result = null
  onloadend = null
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = value
      this.onloadend?.()
    })
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`
      this.onloadend?.()
    })
  }
}
globalThis.FileReader = NodeFileReader

const output = path.resolve('assets/models/world-tree-v1.glb')

function randomGenerator(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function taperedTube(curve, radiusAt, segments = 64, radialSegments = 8) {
  const frames = curve.computeFrenetFrames(segments, false)
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    curve.getPointAt(t, point)
    const radius = Math.max(radiusAt(t), 0.0001)
    for (let j = 0; j <= radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2
      const frameNormal = frames.normals[i]
      const frameBinormal = frames.binormals[i]
      normal
        .set(
          -Math.cos(angle) * frameNormal.x + Math.sin(angle) * frameBinormal.x,
          -Math.cos(angle) * frameNormal.y + Math.sin(angle) * frameBinormal.y,
          -Math.cos(angle) * frameNormal.z + Math.sin(angle) * frameBinormal.z
        )
        .normalize()
      positions.push(point.x + normal.x * radius, point.y + normal.y * radius, point.z + normal.z * radius)
      normals.push(normal.x, normal.y, normal.z)
      uvs.push(j / radialSegments, t)
    }
  }
  for (let i = 1; i <= segments; i++) {
    for (let j = 1; j <= radialSegments; j++) {
      const a = (radialSegments + 1) * (i - 1) + j - 1
      const b = (radialSegments + 1) * i + j - 1
      const c = (radialSegments + 1) * i + j
      const d = (radialSegments + 1) * (i - 1) + j
      indices.push(a, b, d, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}

function curve(points) {
  return new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
}

function tube(group, name, points, radius, material, endScale = 0.08, segments = 52, radial = 8) {
  const geometry = taperedTube(
    curve(points),
    (t) => radius * ((1 - t) ** 1.15 * (1 - endScale) + endScale),
    segments,
    radial
  )
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  group.add(mesh)
  return mesh
}

const paleWood = new THREE.MeshStandardMaterial({
  name: 'Pale weathered deadwood',
  color: '#bdc7b6',
  roughness: 0.62,
  metalness: 0.01,
  emissive: '#26352b',
  emissiveIntensity: 0.42,
})
const livingWood = new THREE.MeshStandardMaterial({
  name: 'Living dark wood',
  color: '#3e5944',
  roughness: 0.78,
  metalness: 0.0,
  emissive: '#112519',
  emissiveIntensity: 0.36,
})
const shadowWood = new THREE.MeshStandardMaterial({
  name: 'Deep bark grooves',
  color: '#18291d',
  roughness: 0.88,
  metalness: 0.0,
  emissive: '#08120c',
  emissiveIntensity: 0.3,
})
const energy = new THREE.MeshStandardMaterial({
  name: 'Emerald inner channels',
  color: '#65e88f',
  emissive: '#72f6a2',
  emissiveIntensity: 2.25,
  roughness: 0.32,
  metalness: 0.0,
})
const foliageMaterials = ['#145f35', '#1d7845', '#319558'].map(
  (color, index) =>
    new THREE.MeshStandardMaterial({
      name: `Evergreen foliage ${index + 1}`,
      color,
      emissive: index === 2 ? '#17532f' : index === 1 ? '#103d24' : '#0a2917',
      emissiveIntensity: index === 2 ? 0.78 : 0.6,
      roughness: 0.82,
      metalness: 0.0,
    })
)

const model = new THREE.Group()
model.name = 'Agentic Grove World Tree'

const spine = [
  [0, 0.02, 0],
  [-0.12, 0.48, 0.05],
  [0.08, 0.96, -0.08],
  [0.26, 1.42, 0.04],
  [0.05, 1.88, 0.1],
  [-0.28, 2.28, 0.03],
  [-0.62, 2.65, -0.05],
  [-0.72, 3.08, 0.01],
  [-0.66, 3.48, 0],
]

// A continuous core prevents the braided surface from separating into pipes when viewed side-on.
tube(model, 'continuous living core', spine, 0.42, shadowWood, 0.24, 92, 12)

const random = randomGenerator(713)
for (let strand = 0; strand < 9; strand++) {
  const phase = (strand / 9) * Math.PI * 2
  const points = spine.map(([x, y, z], index) => {
    const t = index / (spine.length - 1)
    const outer = 0.34 * (1 - t) + 0.105
    const angle = phase + t * Math.PI * 1.5
    const shoulder = Math.sin(t * Math.PI) * (strand % 3 === 0 ? 0.08 : 0)
    return [x + Math.cos(angle) * (outer + shoulder), y, z + Math.sin(angle) * outer]
  })
  tube(
    model,
    `braided trunk strand ${strand + 1}`,
    points,
    0.17 - strand * 0.0045,
    strand === 1 || strand === 4 || strand === 7 ? paleWood : livingWood,
    0.34,
    88,
    9
  )
}

// Broad crossing ribbons make the trunk read as carved, interwoven wood rather than bundled pipes.
const trunkRibbons = [
  { p: [[-0.34, 0.08, 0.18], [-0.42, 0.72, 0.24], [0.12, 1.25, 0.22], [0.28, 1.72, 0.14], [-0.1, 2.22, 0.08], [-0.72, 2.74, 0.04]], r: 0.19, m: paleWood },
  { p: [[0.3, 0.06, -0.12], [0.38, 0.62, -0.16], [0.02, 1.18, -0.2], [-0.12, 1.72, -0.12], [0.26, 2.14, -0.04], [0.52, 2.46, 0.02]], r: 0.17, m: livingWood },
  { p: [[-0.04, 0.04, 0.32], [0.08, 0.58, 0.37], [0.34, 1.02, 0.3], [0.05, 1.54, 0.25], [-0.48, 1.98, 0.18], [-1.08, 2.28, 0.1]], r: 0.155, m: paleWood },
]
trunkRibbons.forEach((ribbon, index) => tube(model, `crossing trunk ribbon ${index + 1}`, ribbon.p, ribbon.r, ribbon.m, 0.18, 72, 9))
trunkRibbons.forEach((ribbon, index) => {
  const grain = ribbon.p.map(([x, y, z]) => [x - ribbon.r * 0.12, y, z + ribbon.r * 0.82])
  tube(model, `crossing trunk grain ${index + 1}`, grain, 0.013, shadowWood, 0.35, 70, 5)
})

const branches = [
  { p: [[-0.5, 2.72, 0], [-0.98, 3.04, 0.03], [-1.65, 3.18, 0.04], [-2.32, 3.1, 0]], r: 0.15 },
  { p: [[-0.32, 2.42, 0.02], [-0.88, 2.7, 0.08], [-1.55, 2.74, 0.12], [-2.15, 2.58, 0.08]], r: 0.145 },
  { p: [[0.06, 1.76, 0.04], [-0.46, 2.04, 0.1], [-1.12, 2.04, 0.16], [-1.76, 1.88, 0.12]], r: 0.155 },
  { p: [[-0.38, 3.04, -0.05], [0.04, 3.28, -0.03], [0.58, 3.32, 0], [1.02, 3.15, 0.04]], r: 0.12 },
  { p: [[-0.64, 3.24, 0], [-0.7, 3.58, 0.02], [-0.65, 3.84, 0]], r: 0.11 },
  { p: [[-0.12, 2.18, -0.1], [0.25, 2.45, -0.15], [0.64, 2.57, -0.12], [0.98, 2.5, -0.04]], r: 0.105 },
]
branches.forEach((branch, index) => tube(model, `living branch ${index + 1}`, branch.p, branch.r, livingWood, 0.06, 48, 7))

const deadwood = [
  // Uneven, partially broken jins reproduce the reference's wind-carved right-hand silhouette.
  // Their bends deliberately avoid a repeated fan so they read as old branches, not spikes.
  { p: [[0.02, 1.08, 0.05], [0.48, 1.24, 0.17], [0.94, 1.5, 0.23], [1.38, 1.72, 0.17], [1.72, 2.02, 0.08], [1.9, 2.34, 0.02]], r: 0.235 },
  { p: [[0.08, 1.5, -0.02], [0.52, 1.68, -0.13], [0.92, 1.98, -0.15], [1.24, 2.32, -0.05], [1.3, 2.66, 0.05], [1.2, 2.88, 0.1]], r: 0.19 },
  { p: [[-0.02, 0.9, -0.08], [0.5, 0.94, -0.14], [0.98, 1.08, -0.08], [1.38, 1.32, 0.01], [1.62, 1.62, 0.06]], r: 0.17 },
  { p: [[0.08, 1.92, 0.01], [0.42, 2.18, 0.08], [0.62, 2.5, 0.13], [0.58, 2.82, 0.1], [0.42, 3.04, 0.04]], r: 0.125 },
  { p: [[0.84, 1.9, 0.12], [1.18, 2.02, 0.22], [1.48, 2.2, 0.24], [1.62, 2.46, 0.18]], r: 0.09 },
  { p: [[0.4, 2.48, -0.08], [0.76, 2.66, -0.18], [1.08, 2.9, -0.12], [1.2, 3.14, -0.02]], r: 0.08 },
]
deadwood.forEach((limb, index) => {
  tube(model, `hooked deadwood limb ${index + 1}`, limb.p, limb.r, paleWood, 0.025, 56, 9)
  const darkGrain = limb.p.map(([x, y, z]) => [x, y + limb.r * 0.06, z + limb.r * 0.86])
  tube(model, `deadwood grain ${index + 1}`, darkGrain, 0.012, shadowWood, 0.2, 54, 5)
  if (index % 2 === 0) {
    const litGrain = limb.p.map(([x, y, z]) => [x - limb.r * 0.12, y - limb.r * 0.08, z + limb.r * 0.91])
    tube(model, `deadwood energy seam ${index + 1}`, litGrain, 0.007, energy, 0.18, 54, 5)
  }
})

// Thin bark ridges and lit channels follow the trunk's sweep rather than sitting as straight stripes.
for (let i = 0; i < 9; i++) {
  const phase = (i / 9) * Math.PI * 2
  const points = spine.slice(0, 7).map(([x, y, z], index) => {
    const t = index / 6
    const outer = 0.37 * (1 - t) + 0.13
    const angle = phase + t * Math.PI * 1.25
    return [x + Math.cos(angle) * outer, y + 0.01, z + Math.sin(angle) * outer]
  })
  tube(model, `bark ridge ${i + 1}`, points, 0.022, i % 4 === 0 ? energy : shadowWood, 0.38, 62, 5)
}

// Radial roots form a real flare and give the live mycelium geometry somewhere physical to enter.
for (let i = 0; i < 24; i++) {
  const angle = (i / 24) * Math.PI * 2 + (random() - 0.5) * 0.16
  const reach = 0.95 + random() * 0.8
  const bend = (random() - 0.5) * 0.35
  const points = [
    [Math.cos(angle) * 0.18, 0.58 + random() * 0.2, Math.sin(angle) * 0.18],
    [Math.cos(angle + bend * 0.3) * reach * 0.45, 0.18, Math.sin(angle + bend * 0.3) * reach * 0.45],
    [Math.cos(angle + bend) * reach, 0.035, Math.sin(angle + bend) * reach],
    [Math.cos(angle + bend * 1.25) * reach * 1.25, 0.012, Math.sin(angle + bend * 1.25) * reach * 1.25],
  ]
  tube(model, `root ${i + 1}`, points, 0.075 + random() * 0.075, i % 5 === 0 ? paleWood : livingWood, 0.028, 42, 7)
  if (i % 2 === 0) {
    const lit = points.map(([x, y, z]) => [x, y + 0.025, z])
    tube(model, `root light ${i + 1}`, lit, 0.012, energy, 0.12, 36, 5)
  }
}

const pads = [
  { at: [-0.7, 4.0, 0], spread: [1.15, 0.15, 0.66], count: 92 },
  { at: [-1.4, 3.62, 0.02], spread: [1.08, 0.14, 0.58], count: 78 },
  { at: [0.12, 3.55, 0.0], spread: [0.86, 0.14, 0.52], count: 62 },
  { at: [-1.9, 3.12, 0.08], spread: [0.92, 0.13, 0.5], count: 66 },
  { at: [-0.78, 3.08, 0.1], spread: [0.92, 0.13, 0.5], count: 68 },
  { at: [0.55, 3.18, 0.05], spread: [0.67, 0.12, 0.42], count: 48 },
  { at: [-1.65, 2.58, 0.13], spread: [0.82, 0.12, 0.42], count: 56 },
  { at: [-1.02, 2.08, 0.16], spread: [0.7, 0.11, 0.38], count: 46 },
  { at: [-0.56, 4.22, -0.02], spread: [0.58, 0.12, 0.38], count: 40 },
  { at: [0.42, 2.66, -0.04], spread: [0.5, 0.1, 0.34], count: 36 },
]

const foliageByTone = [[], [], []]
const leafShape = new THREE.DodecahedronGeometry(1, 0)
pads.forEach((pad, padIndex) => {
  for (let i = 0; i < pad.count * 4; i++) {
    const theta = random() * Math.PI * 2
    const radius = random() ** 0.62
    const edge = 1 - radius * radius
    const position = new THREE.Vector3(
      pad.at[0] + Math.cos(theta) * radius * pad.spread[0],
      pad.at[1] + edge * pad.spread[1] * 0.75 + (random() - 0.5) * pad.spread[1],
      pad.at[2] + Math.sin(theta) * radius * pad.spread[2]
    )
    const scale = 0.032 + random() * 0.034
    const matrix = new THREE.Matrix4().compose(
      position,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI)),
      new THREE.Vector3(scale * (1.35 + random() * 0.65), scale * (0.5 + random() * 0.3), scale * (0.72 + random() * 0.3))
    )
    const geometry = leafShape.clone().applyMatrix4(matrix)
    foliageByTone[(i + padIndex) % 3].push(geometry)
  }
})

foliageByTone.forEach((geometries, index) => {
  const geometry = mergeGeometries(geometries, false)
  const mesh = new THREE.Mesh(geometry, foliageMaterials[index])
  mesh.name = `foliage clusters ${index + 1}`
  model.add(mesh)
})

model.traverse((object) => {
  if (object.isMesh) {
    object.castShadow = true
    object.receiveShadow = true
  }
})

await fs.mkdir(path.dirname(output), { recursive: true })
const exporter = new GLTFExporter()
const binary = await exporter.parseAsync(model, {
  binary: true,
  onlyVisible: true,
  trs: false,
  maxTextureSize: 2048,
})
await fs.writeFile(output, Buffer.from(binary))
console.log(`wrote ${output}`)
