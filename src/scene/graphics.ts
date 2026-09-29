/**
 * Which graphics level the grove is actually drawing at, and why.
 *
 * You choose a mode in Settings (Performance, Balanced, Grove). With "Adapt automatically" on, the
 * grove may draw *below* that mode for a while, never above it, and says why in Settings:
 *
 *   busy     the whole Mac's CPU has been above 80% for about ten seconds. You need the machine
 *            more than the grove needs its reflections. Recovers after a calm minute.
 *   slow     the frame rate has sat well under the screen's refresh for several seconds.
 *   away     one screen only, and the Grove has not been the front window for two minutes, so it
 *            is probably behind whatever you are doing. Back to your mode the moment you return.
 *            With two or more screens it stays at full detail, because it is likely on one of its own.
 *
 * A window that is minimised or fully covered costs nothing at all: the browser engine stops
 * drawing it outright, which beats any lower mode.
 *
 * **Frame rate.** Grove and Balanced draw at whatever the screen refreshes at: 60 on most Macs,
 * 120 on a ProMotion MacBook Pro. Performance holds 60 on every screen, which on a 120Hz display
 * halves the work.
 */
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { GraphicsMode } from '../../core/state/schema.ts'
import type { QualityPreset } from './Grove'

const LEVELS: GraphicsMode[] = ['performance', 'balanced', 'grove']
const levelOf = (mode: GraphicsMode) => LEVELS.indexOf(mode)

export type Reason = 'chosen' | 'busy' | 'slow' | 'away'

export interface Drawing {
  mode: GraphicsMode
  reason: Reason
  /** The screen's refresh rate as measured, rounded to a common one. `null` until measured. */
  refreshHz: number | null
}

export const useDrawing = create<Drawing>(() => ({ mode: 'grove', reason: 'chosen', refreshHz: null }))

/** What each mode turns into for the scene. */
export function sceneFor(mode: GraphicsMode): { quality: QualityPreset; post: boolean; maxFps?: number } {
  if (mode === 'performance') return { quality: 'low', post: false, maxFps: 60 }
  if (mode === 'balanced') return { quality: 'balanced', post: true }
  return { quality: 'high', post: true }
}

const BUSY_CPU = 80
const CALM_CPU = 55
const AWAY_MS = 2 * 60_000
const RECOVER_MS = 60_000
const SLOW_SECONDS = 6

/** Round a measured rate to the refresh rates screens actually have. */
function roundRefresh(fps: number): number {
  const common = [30, 60, 90, 120, 144]
  return common.reduce((best, rate) => (Math.abs(rate - fps) < Math.abs(best - fps) ? rate : best), 60)
}

/**
 * Keep `useDrawing` up to date. Call once, from the top of the app. `fps` is the renderer's latest
 * one-second sample; `cpu` the Mac's, from each snapshot.
 */
export function useAdaptiveGraphics(options: {
  chosen: GraphicsMode
  adaptive: boolean
  fps: number | null
  cpu: number | null
  displays: number
}): void {
  const { chosen, adaptive, fps, cpu, displays } = options
  const state = useRef({ busySince: 0, calmSince: 0, slowFor: 0, blurredAt: 0, peakFps: 0, dropped: 0 })

  // Whether the Grove is the front window. `document.hasFocus` is false while another app is in front.
  useEffect(() => {
    const onBlur = () => (state.current.blurredAt = Date.now())
    const onFocus = () => (state.current.blurredAt = 0)
    if (!document.hasFocus()) onBlur()
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // Re-decide on every frame-rate sample (once a second) and every snapshot.
  useEffect(() => {
    const now = Date.now()
    const s = state.current
    if (fps !== null && fps > s.peakFps) s.peakFps = fps
    const refreshHz = s.peakFps > 20 ? roundRefresh(s.peakFps) : null

    if (!adaptive) {
      s.dropped = 0
      useDrawing.setState({ mode: chosen, reason: 'chosen', refreshHz })
      return
    }

    if (cpu !== null && cpu >= BUSY_CPU) {
      s.busySince ||= now
      s.calmSince = 0
    } else if (cpu !== null && cpu <= CALM_CPU) {
      s.calmSince ||= now
      s.busySince = 0
    }
    const target = chosen === 'performance' ? 60 : (refreshHz ?? 60)
    s.slowFor = fps !== null && fps < target * 0.75 ? s.slowFor + 1 : 0

    const away = displays <= 1 && s.blurredAt > 0 && now - s.blurredAt > AWAY_MS
    const busy = s.busySince > 0 && now - s.busySince > 10_000
    const slow = s.slowFor >= SLOW_SECONDS
    let reason: Reason = useDrawing.getState().reason

    if (busy || slow) {
      // One step at a time, then wait for the next verdict, so a brief spike costs one level.
      s.dropped = Math.min(levelOf(chosen), s.dropped + 1)
      s.busySince = busy ? now : s.busySince
      s.slowFor = 0
      reason = busy ? 'busy' : 'slow'
    } else if (s.dropped > 0 && s.calmSince > 0 && now - s.calmSince > RECOVER_MS) {
      s.dropped -= 1
      s.calmSince = now
      if (s.dropped === 0) reason = 'chosen'
    }

    let level = levelOf(chosen) - s.dropped
    if (away) {
      level = Math.min(level, levelOf('balanced'))
      if (level < levelOf(chosen)) reason = 'away'
    } else if (reason === 'away') {
      reason = s.dropped > 0 ? 'busy' : 'chosen'
    }
    const mode = LEVELS[Math.max(0, level)]!
    if (mode === chosen) reason = 'chosen'
    useDrawing.setState({ mode, reason, refreshHz })
  }, [chosen, adaptive, fps, cpu, displays])
}
