/**
 * Voice in the page: PM's replies read aloud, and what you say recorded for the node side to turn
 * into text. Both stay on this Mac.
 *
 *   - **Speaking** uses the page's own `speechSynthesis`, which on a Mac is the system's voices
 *     (the ones in System Settings › Accessibility › Spoken Content). Offline and free.
 *   - **Listening** records with `MediaRecorder` while the mic is held, then decodes the recording
 *     to 16 kHz mono and packs it as a WAV (`core/voice/wav.ts`), which is what whisper.cpp reads
 *     without any other program installed. The bytes go over the bridge; nothing is saved here.
 */
import { MAX_SECONDS, WAV_RATE, encodeWav } from '../../core/voice/wav.ts'

/* ---- Speaking ------------------------------------------------------------------------------ */

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null)

/** The Mac's voices, English first. They load late on first use, so listen for `voiceschanged`. */
export function macVoices(): SpeechSynthesisVoice[] {
  const voices = synth()?.getVoices() ?? []
  return [...voices].sort((a, b) => Number(b.lang.startsWith('en')) - Number(a.lang.startsWith('en')) || a.name.localeCompare(b.name))
}

/** A reply as it should sound: no code blocks read out symbol by symbol, no markdown marks, no links. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (code left out) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[*_#>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.:;!?])/g, '$1')
    .trim()
}

export function speak(text: string, voiceName: string): void {
  const speech = synth()
  const words = speakable(text)
  if (!speech || !words) return
  speech.cancel()
  const utterance = new SpeechSynthesisUtterance(words)
  const voice = voiceName ? speech.getVoices().find((each) => each.name === voiceName) : undefined
  if (voice) utterance.voice = voice
  speech.speak(utterance)
}

/** Stop reading. Called when you type, hold the mic, or switch reading off. */
export function stopSpeaking(): void {
  const speech = synth()
  if (speech && (speech.speaking || speech.pending)) speech.cancel()
}

/* ---- Listening ----------------------------------------------------------------------------- */

export interface Recording {
  /** Stop and hand back the WAV bytes, or null when it was too short to be speech. */
  finish(): Promise<Uint8Array | null>
  /** Stop and throw it away. */
  cancel(): void
}

/**
 * Start recording from the microphone. Rejects when macOS or the person refuses the microphone.
 * Stops on its own after two minutes; `finish` still returns what was heard.
 */
export async function startRecording(onLimit: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  const started = Date.now()
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })
  const release = () => stream.getTracks().forEach((track) => track.stop())
  const limit = window.setTimeout(onLimit, MAX_SECONDS * 1000)
  recorder.start()

  const stop = async () => {
    window.clearTimeout(limit)
    if (recorder.state !== 'inactive') recorder.stop()
    await stopped
    release()
  }

  return {
    async finish() {
      await stop()
      // Under a third of a second is a tap, not speech.
      if (Date.now() - started < 300 || !chunks.length) return null
      return toWav(new Blob(chunks, { type: recorder.mimeType }))
    },
    cancel() {
      void stop()
    },
  }
}

/** The recording, decoded and resampled to 16 kHz mono by the browser itself, as a WAV. */
async function toWav(blob: Blob): Promise<Uint8Array> {
  const encoded = await blob.arrayBuffer()
  // An offline context never plays anything; decoding into it resamples to its rate.
  const context = new OfflineAudioContext(1, WAV_RATE, WAV_RATE)
  const audio = await context.decodeAudioData(encoded)
  const length = Math.min(audio.length, MAX_SECONDS * WAV_RATE)
  const mono = new Float32Array(length)
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const data = audio.getChannelData(channel)
    for (let i = 0; i < length; i += 1) mono[i]! += data[i]! / audio.numberOfChannels
  }
  return encodeWav(mono)
}
