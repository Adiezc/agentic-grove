/**
 * The rune marks carved on the monoliths, drawn to canvas textures.
 *
 * Redrawn against the art after the first pass got the *shape* of them right and the composition
 * wrong. Every rune in `assets/concept/grove-main.png` is built the same way: a single hairline
 * stem running most of the height of the stone, with one mark on it. The first version drew only
 * the mark, floating in the middle of the face, and the stones lost the vertical emphasis that
 * makes them read as inscribed rather than stickered.
 *
 * The stem is also what makes a rune legible at forty pixels tall and half-lost in bloom, which is
 * the size these actually have to work at. You see the line first and the mark second.
 *
 * Drawn in code rather than shipped as files, for one reason worth stating: a rune has to change
 * brightness with the state of its project, from barely there on an idle stone to blown out on a
 * running one. A texture drawn white and tinted by its material does that for free; a green PNG
 * would need six variants and would still be wrong at the edges.
 *
 * They are brand marks, not interface icons. The interface icons in the rail come from Phosphor,
 * as they should — nobody should be hand-drawing a gear.
 */

export type RuneId = 'ascend' | 'ring' | 'thrice' | 'bind' | 'mark' | 'tally'

/** Where the stem starts and stops, as a fraction of the canvas. Shared by every rune. */
const STEM_TOP = 0.1
const STEM_BOTTOM = 0.9

/** How each rune is drawn, on a square canvas of side `s`, in white on transparent. */
const DRAWINGS: Record<RuneId, (ctx: CanvasRenderingContext2D, s: number) => void> = {
  /** An upward arrow on a full stem. The art's Research stone. */
  ascend: (ctx, s) => {
    const x = s / 2
    line(ctx, x, s * STEM_BOTTOM, x, s * STEM_TOP)
    line(ctx, x, s * STEM_TOP, x - s * 0.115, s * STEM_TOP + s * 0.13)
    line(ctx, x, s * STEM_TOP, x + s * 0.115, s * STEM_TOP + s * 0.13)
  },

  /** A stem through an open ring at its middle. The art's clearest mark, and the most legible. */
  ring: (ctx, s) => {
    const x = s / 2
    line(ctx, x, s * STEM_TOP, x, s * STEM_BOTTOM)
    // Drawn over the stem rather than broken around it, exactly as in the art.
    circle(ctx, x, s * 0.5, s * 0.105)
  },

  /** Three crossed marks down the stem. */
  thrice: (ctx, s) => {
    const x = s / 2
    const r = s * 0.062
    line(ctx, x, s * STEM_TOP, x, s * STEM_BOTTOM)
    for (const y of [0.37, 0.5, 0.63]) {
      line(ctx, x - r, s * y - r, x + r, s * y + r)
      line(ctx, x + r, s * y - r, x - r, s * y + r)
    }
  },

  /** A ring low on the stem, so it reads as weighted downwards against `ring`. */
  bind: (ctx, s) => {
    const x = s / 2
    line(ctx, x, s * STEM_TOP, x, s * STEM_BOTTOM)
    circle(ctx, x, s * 0.66, s * 0.1)
    dot(ctx, x, s * 0.66, s * 0.03)
  },

  /** A stem broken by a gap, with a dot in it. */
  mark: (ctx, s) => {
    const x = s / 2
    line(ctx, x, s * STEM_TOP, x, s * 0.44)
    dot(ctx, x, s * 0.53, s * 0.038)
    line(ctx, x, s * 0.62, x, s * STEM_BOTTOM)
  },

  /** A column of four dots strung on the stem. */
  tally: (ctx, s) => {
    const x = s / 2
    line(ctx, x, s * STEM_TOP, x, s * STEM_BOTTOM)
    for (const y of [0.36, 0.46, 0.56, 0.66]) dot(ctx, x, s * y, s * 0.038)
  },
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Draw one rune to a canvas.
 *
 * 256px square: the runes are a handful of strokes, so there is nothing for more resolution to
 * resolve, and every stone carries one. White on transparent, so the material decides the colour.
 */
export function drawRune(id: RuneId, size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  // Thinner than the first pass. In the art these are hairlines that bloom outwards, and a heavy
  // stroke plus bloom gives a fat glowing worm rather than a cut line.
  ctx.lineWidth = size * 0.018
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  DRAWINGS[id](ctx, size)
  return canvas
}

/** Every rune, in the order they appear around the grove in the concept art. */
export const RUNE_IDS: RuneId[] = ['ascend', 'ring', 'thrice', 'bind', 'mark', 'tally']
