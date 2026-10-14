/**
 * Offline adaptation of shaders/reaction-diffusion.glsl by Linus Mossberg.
 * Copyright (c) 2020 Linus Mossberg. MIT: licenses/linus-mossberg-reaction-diffusion.txt.
 * Source revision: f4a7ffbbae22648a67350dd8a10d96632ca8ed61.
 * Uses its isotropic nine-point diffusion kernel, reaction/dissipation and time step.
 * The kernel's upstream research credit is Andrew Witkin and Michael Kass.
 * Grove adds deterministic seed patches, periodic boundaries and PNG output, and
 * omits spatial parameter fields, anisotropy and mouse input. Nothing runs per frame.
 */
import fs from 'node:fs'
import { deflateSync } from 'node:zlib'

const size = 128
let a = new Float64Array(size * size).fill(1)
let b = new Float64Array(size * size)
let nextA = new Float64Array(a.length)
let nextB = new Float64Array(b.length)
for (let patch = 0; patch < 28; patch++) {
  const cx = (patch * 47 + 13) % size, cy = (patch * 31 + 7) % size
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
    if (x * x + y * y > 9) continue
    const i = ((cy + y + size) % size) * size + (cx + x + size) % size
    a[i] = 0.5; b[i] = 1
  }
}
const at = (x, y) => ((y + size) % size) * size + (x + size) % size
for (let step = 0; step < 2200; step++) {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x
    const axial = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)]
    const diagonal = [at(x - 1, y - 1), at(x + 1, y - 1), at(x - 1, y + 1), at(x + 1, y + 1)]
    // Upstream a1 = 0.5 gives d = 0, h = v = 4 and denominator 6.
    const lap = (field) => (diagonal.reduce((s, j) => s + field[j], 0)
      + 4 * axial.reduce((s, j) => s + field[j], 0) - 20 * field[i]) / 6
    const reaction = a[i] * b[i] * b[i]
    const feed = 0.036, kill = 0.062, diffusionScale = 1, dt = 1 / (4 * diffusionScale)
    nextA[i] = a[i] + (-reaction + feed * (1 - a[i]) + lap(a) * diffusionScale) * dt
    nextB[i] = b[i] + (reaction - b[i] * (kill + feed) + lap(b) * diffusionScale * 0.5) * dt
  }
  ;[a, nextA] = [nextA, a]; [b, nextB] = [nextB, b]
}

// A tiny dependency-free grayscale PNG writer keeps this authoring tool reproducible.
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}
const header = Buffer.alloc(13)
header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8
const pixels = Buffer.alloc(size * (size + 1))
let minimum = 255, maximum = 0
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const value = b[y * size + x]
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Unstable woodland mask')
  const shade = Math.round(Math.min(1, value * 3.5) * 255)
  pixels[y * (size + 1) + x + 1] = shade
  minimum = Math.min(minimum, shade); maximum = Math.max(maximum, shade)
}
if (maximum - minimum < 50) throw new Error('Woodland mask lost its pattern contrast')
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
fs.writeFileSync(new URL('../assets/materials/woodland-lichen.png', import.meta.url), png)
console.log(`Baked ${size}×${size} woodland lichen mask (${png.length} bytes)`)
