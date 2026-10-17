/**
 * Talking to PM: what you say becomes text on this Mac, with whisper.cpp.
 *
 * Nothing leaves the Mac and nothing is paid for. The page records while you hold the mic, turns
 * the recording into a small WAV file (`wav.ts`) and hands the bytes over; this writes them to a
 * private temporary folder, runs `whisper-cli` on them, reads the text back and deletes the folder,
 * whatever happened. The text goes into the console for you to read before you send it.
 *
 * Two things have to be on the Mac first, and neither is installed without you saying so:
 *
 *   - **whisper.cpp**, the free program that does the listening, from Homebrew (`whisper-cpp`).
 *     The Grove opens Terminal running the install, the way it sets up Claude Code and Codex.
 *   - **A speech model**, the file whisper.cpp listens with. Downloaded once from whisper.cpp's own
 *     page on Hugging Face into `~/.agentic-grove/voice`, after you have seen its size and pressed
 *     Download. Checked against its published SHA-256 before it is kept.
 *
 * whisper.cpp is by Georgi Gerganov and contributors (MIT); the models are OpenAI's Whisper (MIT).
 * See CREDITS.md.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { groveHome } from '../state/grove.ts'
import { isSpeechWav } from './wav.ts'
import { VOICE_MODELS, type VoiceModelId } from './models.ts'

/** Where Homebrew puts `whisper-cli`: Apple Silicon first, then Intel. */
const WHISPER_PLACES = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli']
const BREW_PLACES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']

export { VOICE_MODELS, type VoiceModel, type VoiceModelId } from './models.ts'

export const voiceDir = (): string => path.join(groveHome(), 'voice')
export const modelPath = (id: VoiceModelId): string => path.join(voiceDir(), `ggml-${id}.bin`)

export interface VoiceDownload {
  model: VoiceModelId
  received: number
  total: number
}

export interface VoiceStatus {
  /** Where `whisper-cli` is, or null when whisper.cpp is not installed. */
  whisper: string | null
  /** Whether Homebrew is here, so the set-up button can install whisper.cpp. */
  brew: boolean
  /** The model in use (small if both are here), or null when none is downloaded yet. */
  model: VoiceModelId | null
  /** A download in progress. */
  downloading: VoiceDownload | null
  /** Why the last download stopped, until the next one starts. */
  downloadError: string | null
  /** Ready to listen: whisper.cpp and a model are both here. */
  ready: boolean
}

const exists = (file: string) => fsp.access(file, fs.constants.X_OK).then(() => true, () => false)
const firstThere = async (places: string[]) => {
  for (const place of places) if (await exists(place)) return place
  return null
}

let downloading: VoiceDownload | null = null
let downloadError: string | null = null

export async function voiceStatus(): Promise<VoiceStatus> {
  const [whisper, brew] = await Promise.all([firstThere(WHISPER_PLACES), firstThere(BREW_PLACES)])
  let model: VoiceModelId | null = null
  for (const id of ['small.en', 'base.en'] as const) {
    const size = await fsp.stat(modelPath(id)).then((stat) => stat.size, () => -1)
    if (size === VOICE_MODELS[id].bytes) {
      model = id
      break
    }
  }
  return { whisper, brew: Boolean(brew), model, downloading, downloadError, ready: Boolean(whisper && model) }
}

/**
 * The Terminal script that installs whisper.cpp, opened by the set-up button. A login shell so
 * Homebrew is on the path, and a last look first so a second copy is never installed.
 */
export function whisperSetupScript(): string {
  return [
    '#!/bin/zsh -l',
    'clear',
    'echo "Agentic Grove: setting up voice"',
    'echo ""',
    'if command -v whisper-cli >/dev/null 2>&1; then',
    '  echo "whisper.cpp is already installed at $(command -v whisper-cli). Nothing to install."',
    '  echo "You can close this window."',
    '  exit 0',
    'fi',
    'echo "Installing whisper.cpp with Homebrew. It is free and listens on this Mac only."',
    'brew install whisper-cpp || exit 1',
    'echo ""',
    'echo "Done. You can close this window and go back to the Grove."',
    '',
  ].join('\n')
}

/**
 * Download a model, once, after the person pressed Download. Saved beside its final name as
 * `.part` and only renamed into place once its size and SHA-256 match what was published, so a
 * cut-off or altered file is never used. One download at a time.
 */
export async function downloadModel(id: VoiceModelId): Promise<{ ok: boolean; error?: string }> {
  const model = VOICE_MODELS[id]
  if (!model) return { ok: false, error: 'Unknown model' }
  if (downloading) return { ok: false, error: 'A download is already running' }
  downloading = { model: id, received: 0, total: model.bytes }
  downloadError = null
  try {
    await fsp.mkdir(voiceDir(), { recursive: true, mode: 0o700 })
    await downloadChecked(model.url, modelPath(id), { bytes: model.bytes, sha256: model.sha256 }, (received) => {
      if (downloading) downloading.received = received
    })
    return { ok: true }
  } catch (error) {
    downloadError = error instanceof Error ? error.message : String(error)
    return { ok: false, error: downloadError }
  } finally {
    downloading = null
  }
}

/**
 * Fetch `url` to `dest`, following at most five redirects and only ever over https, and keep it
 * only if it is exactly `expected`. Exported for `npm run verify:voice`, which serves a small file
 * from this Mac (`allowHttp` lets that one test use plain http on localhost).
 */
export async function downloadChecked(
  url: string,
  dest: string,
  expected: { bytes: number; sha256: string },
  onProgress: (received: number) => void = () => undefined,
  options: { allowHttp?: boolean } = {}
): Promise<void> {
  const part = `${dest}.part`
  try {
    let address = url
    let response: Response | null = null
    for (let hop = 0; hop <= 5; hop += 1) {
      const parsed = new URL(address)
      const local = options.allowHttp && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'
      if (parsed.protocol !== 'https:' && !local) throw new Error('Refused a download that was not over https')
      response = await fetch(address, { redirect: 'manual' })
      const next = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && next) {
        address = new URL(next, address).href
        continue
      }
      break
    }
    if (!response || !response.ok || !response.body) throw new Error(`The download did not start (${response?.status ?? 'no answer'})`)
    const hash = createHash('sha256')
    const out = fs.createWriteStream(part, { mode: 0o600 })
    let received = 0
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        received += chunk.length
        if (received > expected.bytes) throw new Error('The file was bigger than expected, so it was not kept')
        hash.update(chunk)
        if (!out.write(chunk)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
        onProgress(received)
      }
    } finally {
      await new Promise<void>((resolve) => out.end(() => resolve()))
    }
    if (received !== expected.bytes) throw new Error('The download was cut short. Try again.')
    if (hash.digest('hex') !== expected.sha256) throw new Error('The file did not match its published checksum, so it was not kept')
    await fsp.rename(part, dest)
  } finally {
    await fsp.rm(part, { force: true })
  }
}

export interface Transcript {
  ok: boolean
  text?: string
  error?: string
  /** What is missing, so the mic can show its set-up step instead. */
  missing?: 'whisper' | 'model'
}

/**
 * What you said, as text. `bytes` must be a WAV made by `encodeWav`; anything else is refused
 * before it touches the disk. `cli` and `model` are for `npm run verify:voice`; the app leaves them
 * out and the usual places are used.
 */
export async function transcribe(bytes: unknown, options: { cli?: string; model?: string; timeoutMs?: number } = {}): Promise<Transcript> {
  if (!(bytes instanceof Uint8Array) || !isSpeechWav(bytes)) return { ok: false, error: 'That recording could not be read' }
  const status = options.cli && options.model ? null : await voiceStatus()
  const cli = options.cli ?? status?.whisper
  if (!cli) return { ok: false, missing: 'whisper', error: 'whisper.cpp is not installed' }
  const model = options.model ?? (status?.model ? modelPath(status.model) : null)
  if (!model) return { ok: false, missing: 'model', error: 'The speech model is not downloaded yet' }

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-voice-'))
  try {
    const audio = path.join(dir, 'speech.wav')
    const base = path.join(dir, 'speech')
    await fsp.writeFile(audio, bytes, { mode: 0o600 })
    // -nt no timestamps, -np nothing but the result, -otxt -of: the text into speech.txt.
    const args = ['-m', model, '-f', audio, '-l', 'en', '-nt', '-np', '-otxt', '-of', base]
    await new Promise<void>((resolve, reject) => {
      execFile(cli, args, { timeout: options.timeoutMs ?? 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
        if (error) reject(new Error(error.killed ? 'Listening took too long' : (String(stderr).trim().split('\n').pop() || error.message)))
        else resolve()
      })
    })
    const text = cleanTranscript(await fsp.readFile(`${base}.txt`, 'utf8'))
    return text ? { ok: true, text } : { ok: false, error: 'No words were heard. Hold the mic while you speak.' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

/** whisper.cpp's text on one line, without its "[BLANK_AUDIO]" and "(wind blowing)" notes. */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
