/**
 * Tap to talk: the mic in the console, and the card that sets voice up the first time.
 *
 * Tap the mic (or ⌥M) and talk freely, for as long as five minutes; tap again, or stop talking for
 * a few seconds, and what you said lands in the console as text, for you to read and send with
 * Enter as usual (Adrian, 18 October 2026: talk to the grove the way you talk to a person).
 * Nothing is sent on its own. The listening happens on this
 * Mac with whisper.cpp (`core/voice/whisper.ts`).
 *
 * Until whisper.cpp and its speech model are here, pressing the mic opens a short set-up card
 * instead, like Get ready: install whisper.cpp in Terminal, then download the model after seeing
 * its size. macOS Dictation (Fn twice) is named there too, as the way that needs no install.
 */
import { useEffect, useRef } from 'react'
import { Check, Microphone, X } from '@phosphor-icons/react'
import { create } from 'zustand'
import { VOICE_MODELS, type VoiceModelId } from '../../core/voice/models.ts'
import type { VoiceStatusView } from '../../electron/bridge.ts'
import { startRecording, stopSpeaking, type Recording } from './voice'

type Phase = 'idle' | 'starting' | 'recording' | 'listening'

interface VoiceState {
  status: VoiceStatusView | null
  phase: Phase
  card: boolean
  error: string | null
}

export const useVoice = create<VoiceState>(() => ({ status: null, phase: 'idle', card: false, error: null }))

async function refreshStatus(): Promise<VoiceStatusView | null> {
  const status = await window.grove?.voiceStatus().catch(() => null)
  if (status) useVoice.setState({ status })
  return status ?? null
}

const megabytes = (bytes: number) => Math.round(bytes / 1_000_000)

/**
 * The mic button, for inside the console's form. Tap and talk as long as you like; tap again, or
 * just stop talking for a few seconds, and what you said lands in the console. `onText` gets it.
 */
export function MicButton({ onText }: { onText: (text: string) => void }) {
  const { status, phase } = useVoice()
  const recording = useRef<Recording | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  useEffect(() => {
    void refreshStatus()
    const onFocus = () => void refreshStatus()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const begin = async () => {
    if (useVoice.getState().phase !== 'idle') return
    stopSpeaking()
    const fresh = await refreshStatus()
    if (!fresh?.ready || fresh.microphone === 'denied' || fresh.microphone === 'restricted') {
      useVoice.setState({ card: true, error: null })
      return
    }
    useVoice.setState({ phase: 'starting', error: null, card: false })
    try {
      recording.current = await startRecording(() => void end())
      useVoice.setState({ phase: 'recording' })
    } catch (failure) {
      const blocked = failure instanceof DOMException && failure.name === 'NotAllowedError'
      useVoice.setState({
        phase: 'idle',
        card: true,
        error: blocked
          ? 'The microphone is turned off for the Grove. Turn it on in System Settings › Privacy & Security › Microphone.'
          : 'The microphone did not start. Is one connected?',
      })
    }
  }

  const end = async () => {
    const current = recording.current
    recording.current = null
    if (!current) return
    useVoice.setState({ phase: 'listening' })
    try {
      const wav = await current.finish()
      // A tap with nothing said is not an error: just stop.
      if (!wav) return useVoice.setState({ phase: 'idle' })
      const result = await window.grove!.voiceTranscribe(wav)
      if (result.ok && result.text) {
        onTextRef.current(result.text)
        useVoice.setState({ phase: 'idle', error: null })
      } else if (result.ok) {
        useVoice.setState({ phase: 'idle' })
      } else {
        if (result.missing) void refreshStatus()
        useVoice.setState({ phase: 'idle', card: true, error: result.error ?? 'That could not be heard' })
      }
    } catch {
      useVoice.setState({ phase: 'idle', card: true, error: 'That recording could not be read' })
    }
  }

  const toggle = () => {
    const now = useVoice.getState().phase
    if (now === 'idle') void begin()
    else if (now === 'recording') void end()
  }

  // ⌥M starts and stops it from anywhere in the window, like the button.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'KeyM' || !event.altKey || event.metaKey || event.ctrlKey || event.repeat) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  if (!window.grove) return null
  const ready = Boolean(status?.ready)
  const label = phase === 'recording' ? 'Listening. Tap to stop' : phase === 'listening' ? 'Writing down what you said' : 'Talk'
  return (
    <button
      type="button"
      className={`console-send console-mic is-${phase}${ready ? '' : ' is-unset'}`}
      aria-label={label}
      title={label}
      aria-pressed={phase === 'recording'}
      disabled={phase === 'listening' || phase === 'starting'}
      onClick={toggle}
    >
      <Microphone size={20} weight={phase === 'recording' ? 'fill' : 'thin'} />
    </button>
  )
}

/** The set-up card above the console, or a line saying why the last try did not work. */
export function VoiceCard() {
  const { status, card, error } = useVoice()

  // While the card is open, look again every second and a half: Terminal or a download may finish.
  useEffect(() => {
    if (!card) return
    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), 1500)
    return () => window.clearInterval(timer)
  }, [card])

  if (!card || !window.grove) return null
  const close = () => useVoice.setState({ card: false, error: null })
  const blocked = status?.microphone === 'denied' || status?.microphone === 'restricted'
  const download = (model: VoiceModelId) => void window.grove!.voiceDownload(model).then(() => refreshStatus())

  if (status?.ready && !blocked) {
    return (
      <div className="answer-card voice-card" role="status">
        <button type="button" className="panel-close" onClick={close} aria-label="Close">
          <X size={14} weight="thin" />
        </button>
        <p className="answer-headline">{error ?? 'Voice is ready.'}</p>
      </div>
    )
  }

  const going = status?.downloading
  return (
    <div className="answer-card voice-card" role="dialog" aria-label="Set up talking to PM">
      <button type="button" className="panel-close" onClick={close} aria-label="Close">
        <X size={14} weight="thin" />
      </button>
      <p className="answer-headline">Talk to PM</p>
      <p className="voice-line">Once set up, tap the mic and talk; your words appear in the console. It listens on this Mac only, free.</p>
      {error ? <p className="panel-error voice-line">{error}</p> : null}
      {blocked ? (
        <p className="voice-line voice-warn">macOS has the microphone turned off for the Grove. Turn it on in System Settings › Privacy & Security › Microphone.</p>
      ) : null}
      <ol className="voice-steps">
        <li className={status?.whisper ? 'is-done' : ''}>
          <span className="voice-step-head">
            {status?.whisper ? <Check size={12} weight="bold" aria-hidden="true" /> : null}
            Install whisper.cpp
          </span>
          {status?.whisper ? null : status?.brew ? (
            <>
              <span className="voice-line">The free program that turns speech into text. Opens Terminal and installs it with Homebrew.</span>
              <button type="button" className="setting-button is-primary" onClick={() => void window.grove!.voiceSetUp()}>
                Install in Terminal
              </button>
            </>
          ) : (
            <span className="voice-line">Needs Homebrew first, from brew.sh. Then press the mic again.</span>
          )}
        </li>
        <li className={status?.model ? 'is-done' : ''}>
          <span className="voice-step-head">
            {status?.model ? <Check size={12} weight="bold" aria-hidden="true" /> : null}
            Download the speech model
          </span>
          {status?.model ? null : going ? (
            <span className="voice-line">
              Downloading {VOICE_MODELS[going.model].label}: {megabytes(going.received)} of {megabytes(going.total)} MB
            </span>
          ) : (
            <>
              <span className="voice-line">
                Once, from whisper.cpp's page on Hugging Face, into ~/.agentic-grove/voice. Checked before it is kept.
              </span>
              {status?.downloadError ? <span className="panel-error voice-line">{status.downloadError}</span> : null}
              <span className="voice-choices">
                <button type="button" className="setting-button is-primary" onClick={() => download('base.en')}>
                  Download {megabytes(VOICE_MODELS['base.en'].bytes)} MB
                </button>
                <button type="button" className="setting-button" onClick={() => download('small.en')} title="Hears better, takes about three times as long">
                  More accurate, {megabytes(VOICE_MODELS['small.en'].bytes)} MB
                </button>
              </span>
            </>
          )}
        </li>
      </ol>
      <p className="setting-fine voice-line">Nothing to install: press Fn twice in the console to use macOS Dictation instead.</p>
    </div>
  )
}
