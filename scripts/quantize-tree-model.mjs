import { readFileSync, writeFileSync } from 'node:fs'

// Shrinks the Blender tree GLB by storing normals, texture coordinates and vertex colours as small
// integers (KHR_mesh_quantization), which three.js reads natively. Draco and meshopt would shrink it
// further, but both decoders are WebAssembly that the page's security policy refuses to compile.
// Positions stay float: the foliage shader reads `position.y` in model space for its wind mask, and
// the root weld samples exact bark positions. Running it twice changes nothing.

const FLOAT = 5126, BYTE = 5120, UNSIGNED_SHORT = 5123
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
const EXT = 'KHR_mesh_quantization'

const file = process.argv[2]
if (!file) throw new Error('usage: node scripts/quantize-tree-model.mjs <model.glb>')
const glb = readFileSync(file)
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`)
const jsonLength = glb.readUInt32LE(12)
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'))
const bin = glb.subarray(28 + jsonLength, 28 + jsonLength + glb.readUInt32LE(20 + jsonLength))

function floats(accessor) {
  const view = gltf.bufferViews[accessor.bufferView]
  const width = SIZES[accessor.type]
  if (view.byteStride && view.byteStride !== width * 4) return undefined
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const out = new Float32Array(accessor.count * width)
  for (let i = 0; i < out.length; i++) out[i] = bin.readFloatLE(start + i * 4)
  return out
}

// One packed attribute: integers per component, padded so every vertex starts on four bytes.
function pack(values, width, Typed, scale, signed) {
  const bytesPer = Typed.BYTES_PER_ELEMENT
  const stride = Math.ceil((width * bytesPer) / 4) * 4
  const count = values.length / width
  const bytes = Buffer.alloc(count * stride)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const lo = signed ? -scale : 0
  const min = new Array(width).fill(Infinity), max = new Array(width).fill(-Infinity)
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < width; c++) {
      const q = Math.max(lo, Math.min(scale, Math.round(values[i * width + c] * scale)))
      const at = i * stride + c * bytesPer
      if (bytesPer === 1) view.setInt8(at, q)
      else view.setUint16(at, q, true)
      min[c] = Math.min(min[c], q / scale)
      max[c] = Math.max(max[c], q / scale)
    }
  }
  return { bytes, stride, min, max }
}

// Leaf textures clamp at their edges, so foliage texture coordinates a little past 1 (the atlas
// sprays overhang by 2.5 %) sample the same texel when clamped to 1.
const clampsUv = (mesh) => mesh.name === 'WorldTree Foliage'

const replaced = new Map()
const users = new Map()
for (const accessor of gltf.accessors) users.set(accessor.bufferView, (users.get(accessor.bufferView) ?? 0) + 1)

for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    for (const [name, index] of Object.entries(primitive.attributes)) {
      const accessor = gltf.accessors[index]
      if (accessor.componentType !== FLOAT || accessor.sparse) continue
      if (users.get(accessor.bufferView) !== 1 || replaced.has(accessor.bufferView)) continue
      const values = floats(accessor)
      if (!values) continue
      let lo = Infinity, hi = -Infinity
      for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v }
      let packed, componentType
      if (name === 'NORMAL') {
        // Eight bits a component is about half a degree; three renormalises in the vertex shader.
        packed = pack(values, 3, Int8Array, 127, true)
        componentType = BYTE
      } else if (name.startsWith('TEXCOORD_') && lo >= 0 && (hi <= 1 || clampsUv(mesh))) {
        packed = pack(values, 2, Uint16Array, 65535, false)
        componentType = UNSIGNED_SHORT
      } else if (name.startsWith('COLOR_') && lo >= 0 && hi <= 1) {
        // Sixteen bits, not eight: the darkest bark is under 1 % linear, where eight bits band.
        packed = pack(values, SIZES[accessor.type], Uint16Array, 65535, false)
        componentType = UNSIGNED_SHORT
      } else continue
      replaced.set(accessor.bufferView, packed)
      Object.assign(accessor, { componentType, normalized: true, byteOffset: 0, min: packed.min, max: packed.max })
      if (name === 'NORMAL' || name.startsWith('TEXCOORD_')) { delete accessor.min; delete accessor.max }
    }
  }
}

if (replaced.size === 0) {
  console.log(`${file}: already quantized`)
  process.exit(0)
}

// Lay every buffer view out again, in order, each on a four-byte boundary.
const chunks = []
let offset = 0
gltf.bufferViews.forEach((view, index) => {
  const packed = replaced.get(index)
  const bytes = packed ? packed.bytes : bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
  const pad = (4 - (offset % 4)) % 4
  if (pad) chunks.push(Buffer.alloc(pad))
  offset += pad
  view.byteOffset = offset
  view.byteLength = bytes.length
  if (packed) view.byteStride = packed.stride
  chunks.push(bytes)
  offset += bytes.length
})
const body = Buffer.concat([...chunks, Buffer.alloc((4 - (offset % 4)) % 4)])
gltf.buffers[0].byteLength = offset
for (const list of ['extensionsUsed', 'extensionsRequired']) {
  gltf[list] = [...new Set([...(gltf[list] ?? []), EXT])]
}

let json = Buffer.from(JSON.stringify(gltf), 'utf8')
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + 8 + json.length + 8 + body.length, 8)
const chunk = (type, data) => {
  const head = Buffer.alloc(8)
  head.writeUInt32LE(data.length, 0)
  head.writeUInt32LE(type, 4)
  return [head, data]
}
writeFileSync(file, Buffer.concat([header, ...chunk(0x4e4f534a, json), ...chunk(0x004e4942, body)]))
console.log(`${file}: ${(glb.length / 1e6).toFixed(1)} MB -> ${((12 + 16 + json.length + body.length) / 1e6).toFixed(1)} MB, ${replaced.size} attributes quantized`)
