/**
 * Speech as a plain WAV file: 16 kHz, one channel, 16-bit. That is what whisper.cpp reads without
 * any converter installed, so the page turns its recording into this before sending it over.
 *
 * No Electron and no Node here, so the page (which encodes) and the node side (which checks) share
 * one definition of the format.
 */

export const WAV_RATE = 16_000

/** The longest recording the Grove takes: two minutes. Ten seconds of slack for the header and rounding. */
export const MAX_SECONDS = 120
export const MAX_WAV_BYTES = 44 + (MAX_SECONDS + 10) * WAV_RATE * 2

/** Samples between -1 and 1, one channel, to a WAV file's bytes. */
export function encodeWav(samples: Float32Array, rate = WAV_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true) // the size of this part
  view.setUint16(20, 1, true) // plain PCM
  view.setUint16(22, 1, true) // one channel
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // bytes a second
  view.setUint16(32, 2, true) // bytes a sample
  view.setUint16(34, 16, true) // bits a sample
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return bytes
}

/** Is this the kind of WAV `encodeWav` makes? Checked on the node side before anything is written. */
export function isSpeechWav(bytes: Uint8Array): boolean {
  if (bytes.length < 44 || bytes.length > MAX_WAV_BYTES) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length))
  return (
    text(0, 4) === 'RIFF' &&
    text(8, 4) === 'WAVE' &&
    text(12, 4) === 'fmt ' &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === WAV_RATE &&
    view.getUint16(34, true) === 16
  )
}
