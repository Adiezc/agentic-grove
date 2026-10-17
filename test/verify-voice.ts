/**
 * Voice, checked without a microphone or a real whisper.cpp. Run with `npm run verify:voice`.
 *
 * A stand-in `whisper-cli` (a small shell script) plays whisper.cpp: it checks it was handed a
 * real WAV file with the flags the Grove uses, notes where that file was, and writes a transcript
 * the way whisper.cpp does. Then: the WAV format, refusals before anything touches the disk,
 * failures and time-outs, temporary files always deleted, and the model download's checks against
 * a small file served from this Mac.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-voice-'))
process.env.AGENTIC_GROVE_HOME = path.join(scratch, 'home')
const { MAX_WAV_BYTES, WAV_RATE, encodeWav, isSpeechWav } = await import('../core/voice/wav.ts')
const { VOICE_MODELS, cleanTranscript, downloadChecked, downloadModel, modelPath, transcribe, voiceStatus, whisperSetupScript } = await import('../core/voice/whisper.ts')

/* ---- The stand-in whisper-cli ------------------------------------------------------------- */

const cli = path.join(scratch, 'whisper-cli')
const calls = path.join(scratch, 'calls.log')
await fsp.writeFile(
  cli,
  `#!/bin/sh
# Stand-in for whisper.cpp's whisper-cli. Mode from FAKE_WHISPER.
model="" audio="" out="" txt=0 nt=0 lang=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m) model="$2"; shift ;;
    -f) audio="$2"; shift ;;
    -of) out="$2"; shift ;;
    -l) lang="$2"; shift ;;
    -otxt) txt=1 ;;
    -nt) nt=1 ;;
  esac
  shift
done
echo "model=$model audio=$audio out=$out lang=$lang txt=$txt nt=$nt" >> "${calls}"
[ -f "$model" ] || { echo "error: no model" >&2; exit 2; }
[ "$(head -c 4 "$audio")" = "RIFF" ] || { echo "error: not a wav" >&2; exit 3; }
case "$FAKE_WHISPER" in
  fail) echo "whisper_init: loading model" >&2; echo "error: failed to read audio" >&2; exit 1 ;;
  slow) sleep 5 ;;
  empty) printf ' [BLANK_AUDIO]\\n' > "$out.txt"; exit 0 ;;
esac
printf ' Hello, Grove. [BLANK_AUDIO]\\n (keyboard clicking) Send the builder to the scanner.\\n' > "$out.txt"
`,
  { mode: 0o700 }
)
const model = path.join(scratch, 'ggml-test.bin')
await fsp.writeFile(model, 'not really a model')

const speech = encodeWav(new Float32Array(WAV_RATE).map((_, i) => Math.sin(i / 10) * 0.3))
const lastCall = async () => (await fsp.readFile(calls, 'utf8').catch(() => '')).trim().split('\n').pop() ?? ''
const audioDirOf = (line: string) => path.dirname(/audio=(\S+)/.exec(line)?.[1] ?? '/nowhere/x')
const voiceTemps = async () => (await fsp.readdir(os.tmpdir())).filter((name) => name.startsWith('agentic-grove-voice-')).sort()

const cases: [string, () => Promise<void> | void][] = [
  ['a recording is packed as 16 kHz mono 16-bit WAV, and only that is accepted', () => {
    assert.ok(isSpeechWav(speech))
    assert.equal(speech.length, 44 + WAV_RATE * 2)
    const view = new DataView(speech.buffer)
    assert.equal(view.getUint32(24, true), 16000)
    assert.equal(view.getUint16(22, true), 1)
    // Loud samples are clipped, not wrapped round.
    const loud = new DataView(encodeWav(new Float32Array([2, -2])).buffer)
    assert.equal(loud.getInt16(44, true), 0x7fff)
    assert.equal(loud.getInt16(46, true), -0x8000)
    assert.ok(!isSpeechWav(encodeWav(new Float32Array(100), 44100)), 'another rate')
    assert.ok(!isSpeechWav(new TextEncoder().encode('RIFF....WAVEfmt nothing like a real header at all here')))
    assert.ok(!isSpeechWav(new Uint8Array(10)))
    const huge = encodeWav(new Float32Array((MAX_WAV_BYTES - 44) / 2 + 10))
    assert.ok(!isSpeechWav(huge), 'longer than the limit')
  }],
  ['what was said comes back as one clean line, and the temporary folder is gone', async () => {
    const before = await voiceTemps()
    const result = await transcribe(speech, { cli, model })
    assert.deepEqual(result, { ok: true, text: 'Hello, Grove. Send the builder to the scanner.' })
    const call = await lastCall()
    assert.ok(call.includes(`model=${model}`), call)
    assert.ok(call.includes('lang=en') && call.includes('txt=1') && call.includes('nt=1'), call)
    assert.ok(!fs.existsSync(audioDirOf(call)), 'the recording and transcript were deleted')
    assert.deepEqual(await voiceTemps(), before)
  }],
  ['anything but a WAV is refused before it touches the disk', async () => {
    await fsp.rm(calls, { force: true })
    for (const bad of ['hello', null, 42, [1, 2, 3], new Uint8Array(100), new TextEncoder().encode('#!/bin/sh\necho hi'), encodeWav(new Float32Array(10), 8000)]) {
      const result = await transcribe(bad, { cli, model })
      assert.equal(result.ok, false)
      assert.equal(result.error, 'That recording could not be read')
    }
    assert.equal(await lastCall(), '', 'whisper was never run')
  }],
  ['a whisper.cpp failure is reported in its own words, and still cleaned up', async () => {
    process.env.FAKE_WHISPER = 'fail'
    const result = await transcribe(speech, { cli, model })
    delete process.env.FAKE_WHISPER
    assert.equal(result.ok, false)
    assert.equal(result.error, 'error: failed to read audio')
    assert.ok(!fs.existsSync(audioDirOf(await lastCall())))
  }],
  ['listening that hangs is stopped, and still cleaned up', async () => {
    process.env.FAKE_WHISPER = 'slow'
    const result = await transcribe(speech, { cli, model, timeoutMs: 400 })
    delete process.env.FAKE_WHISPER
    assert.deepEqual(result, { ok: false, error: 'Listening took too long' })
    assert.ok(!fs.existsSync(audioDirOf(await lastCall())))
  }],
  ['silence says so rather than sending nothing', async () => {
    process.env.FAKE_WHISPER = 'empty'
    const result = await transcribe(speech, { cli, model })
    delete process.env.FAKE_WHISPER
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /No words were heard/)
  }],
  ['a missing whisper.cpp or model asks for set-up instead of failing', async () => {
    const result = await transcribe(speech)
    assert.equal(result.ok, false)
    assert.ok(result.missing === 'whisper' || result.missing === 'model', JSON.stringify(result))
    // A half-downloaded model does not count as there.
    await fsp.mkdir(path.dirname(modelPath('base.en')), { recursive: true })
    await fsp.writeFile(modelPath('base.en'), 'partial')
    const status = await voiceStatus()
    assert.equal(status.model, null)
    assert.equal(status.ready, false)
    if (!status.whisper) assert.equal(result.missing, 'whisper')
  }],
  ['the set-up script installs whisper.cpp with Homebrew, once', () => {
    const script = whisperSetupScript()
    assert.ok(script.startsWith('#!/bin/zsh -l\n'))
    assert.ok(script.includes('if command -v whisper-cli'))
    assert.ok(script.includes('brew install whisper-cpp || exit 1'))
    assert.ok(script.indexOf('command -v whisper-cli') < script.indexOf('brew install'))
  }],
  ['whisper notes in brackets are dropped from the text', () => {
    assert.equal(cleanTranscript(' [BLANK_AUDIO]\n'), '')
    assert.equal(cleanTranscript(' (wind blowing) Ship it.\n [MUSIC]'), 'Ship it.')
  }],
  ['the models are only the two published files, over https', () => {
    assert.deepEqual(Object.keys(VOICE_MODELS).sort(), ['base.en', 'small.en'])
    for (const each of Object.values(VOICE_MODELS)) {
      assert.match(each.url, /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/main\/ggml-[a-z.]+\.bin$/)
      assert.match(each.sha256, /^[0-9a-f]{64}$/)
    }
  }],
  ['a download is kept only when its size and checksum match', async () => {
    const body = Buffer.from('a stand-in speech model, 48 bytes long, exactly.')
    const sha256 = createHash('sha256').update(body).digest('hex')
    const server = http.createServer((request, response) => {
      if (request.url === '/moved') return response.writeHead(302, { location: '/model' }).end()
      if (request.url === '/away') return response.writeHead(302, { location: 'http://example.com/model' }).end()
      if (request.url === '/model') return response.end(body)
      response.writeHead(404).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const dest = path.join(scratch, 'downloaded.bin')
    const local = { allowHttp: true }
    try {
      let seen = 0
      await downloadChecked(`${base}/moved`, dest, { bytes: body.length, sha256 }, (received) => (seen = received), local)
      assert.deepEqual(await fsp.readFile(dest), body)
      assert.equal(seen, body.length)
      assert.ok(!fs.existsSync(`${dest}.part`))
      await fsp.rm(dest)

      await assert.rejects(downloadChecked(`${base}/model`, dest, { bytes: body.length, sha256: '0'.repeat(64) }, undefined, local), /checksum/)
      await assert.rejects(downloadChecked(`${base}/model`, dest, { bytes: body.length - 5, sha256 }, undefined, local), /bigger than expected/)
      await assert.rejects(downloadChecked(`${base}/model`, dest, { bytes: body.length + 5, sha256 }, undefined, local), /cut short/)
      await assert.rejects(downloadChecked(`${base}/missing`, dest, { bytes: body.length, sha256 }, undefined, local), /did not start/)
      // Plain http is refused for real downloads, and a redirect off to plain http even in the test.
      await assert.rejects(downloadChecked(`${base}/model`, dest, { bytes: body.length, sha256 }), /not over https/)
      await assert.rejects(downloadChecked(`${base}/away`, dest, { bytes: body.length, sha256 }, undefined, local), /not over https/)
      assert.ok(!fs.existsSync(dest) && !fs.existsSync(`${dest}.part`), 'nothing left behind')
    } finally {
      server.close()
    }
  }],
  ['only the two models can be asked for', async () => {
    assert.deepEqual(await downloadModel('tiny' as never), { ok: false, error: 'Unknown model' })
  }],
]

let failed = 0
for (const [name, check] of cases) {
  try {
    await check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
await fsp.rm(scratch, { recursive: true, force: true })
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} voice checks hold.`)
