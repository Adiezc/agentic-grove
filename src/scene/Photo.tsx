/**
 * The scene's half of photo mode: depth of field, and taking the picture.
 *
 * **How the picture is taken.** The grove is drawn again at several times the window's resolution,
 * and the canvas is read in the same frame it was drawn. Reading in the same frame matters: the
 * browser clears a WebGL canvas once the frame has been shown, and the usual way round that
 * (`preserveDrawingBuffer`) slows every frame of every day for the sake of a button pressed once a
 * month. The image is then offered as an ordinary download, so the app asks where to save it and
 * a browser tab puts it in Downloads, with no extra reach into the filesystem.
 *
 * Both parts need the post-processing chain (they run after it), so photo mode always has it on.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { DepthOfField } from '@react-three/postprocessing'
import type { DepthOfFieldEffect } from 'postprocessing'
import * as THREE from 'three'
import { usePhoto } from '../store/photo'

/** The longest side of a saved image, in pixels. Past this, graphics cards start refusing. */
const LONGEST_SIDE = 6000
/** How many times the window's size to aim for. Three turns a 1440-wide window into 4320. */
const SCALE = 3
/** Frames to let pass after resizing, so reflections and bloom are drawn at the new size too. */
const SETTLE_FRAMES = 3

/** After the post-processing chain, which draws at priority 1. */
const AFTER_POST = 2

const stamp = (date: Date) => {
  const two = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
}

/** Takes one picture each time `shots` goes up. Mounted only in photo mode. */
export function PhotoShot() {
  const shots = usePhoto((state) => state.shots)
  const gl = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const setDpr = useThree((state) => state.setDpr)
  const invalidate = useThree((state) => state.invalidate)
  const wait = useRef(0)
  const before = useRef(1)
  const taken = useRef(shots)

  useEffect(() => {
    if (shots === taken.current) return
    taken.current = shots
    before.current = gl.getPixelRatio()
    setDpr(Math.max(before.current, Math.min(SCALE, LONGEST_SIDE / Math.max(size.width, size.height))))
    wait.current = SETTLE_FRAMES
    invalidate()
    // Only a new press of Save takes a picture; a window resized mid-shot does not start another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots])

  useFrame(() => {
    if (wait.current === 0) return
    wait.current -= 1
    if (wait.current > 0) return invalidate()
    let error: string | undefined
    try {
      const link = document.createElement('a')
      link.href = gl.domElement.toDataURL('image/png')
      link.download = `agentic-grove-${stamp(new Date())}.png`
      link.click()
    } catch (problem) {
      error = problem instanceof Error ? problem.message : String(problem)
    }
    setDpr(before.current)
    invalidate()
    usePhoto.getState().saved(error)
  }, AFTER_POST)

  return null
}

/**
 * Depth of field, focused on the point the camera turns about, so whatever you centre is what
 * stays sharp. Goes inside the effect composer.
 */
export function PhotoFocus({ depth }: { depth: number }) {
  const effect = useRef<DepthOfFieldEffect>(null)
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3 } | null
  useFrame(() => {
    if (controls?.target && effect.current?.target) effect.current.target.copy(controls.target)
  })
  return <DepthOfField ref={effect} target={[0, 2.4, 0]} worldFocusRange={10 - depth * 7} bokehScale={1 + depth * 5} />
}
