/**
 * The rune marks carved on the monoliths, drawn to canvas textures.
 *
 * These are traced from the concept art: an arrow, a ringed stem, three crossed marks, a stem and
 * a dot, a column of dots. Each is two or three strokes, which is the point — they have to stay
 * legible when a stone is forty pixels tall and half-hidden behind bloom.
 *
 * Drawn in code rather than shipped as files for one reason worth stating: a rune has to be able
 * to *change brightness* with the state of its project, from barely-there on an idle stone to
 * blown out on a running one. A texture drawn white and tinted by an emissive material does that
 * for free; a green PNG would need six variants and would still be wrong at the edges.
 *
 * They are brand marks, not interface icons. The interface icons in the rail come from Phosphor,
 * as they should — nobody should be hand-drawing a gear.
 */

export type RuneId = 'ascend' | 'ring' | 'thrice' | 'bind' | 'mark' | 'tally'

/** How each rune is drawn, on a square canvas of side `s`, in white on transparent. */
const DRAWINGS: Record<RuneId, (ctx: CanvasRenderingContext2D, s: number) => void> = {
  /** An upward arrow. In the art this is the stone labelled Research. */
  ascend: (ctx, s) => {
    const x = s / 2
    line(ctx, x, s * 0.82, x, s * 0.2)
    line(ctx, x, s * 0.2, x - s * 0.13, s * 0.35)
    line(ctx, x, s * 0.2, x + s * 0.13, s * 0.35)
  },

  /** A ring on a stem. */
  ring: (ctx, s) => {
    const x = s / 2
    circle(ctx, x, s * 0.34, s * 0.12)
    line(ctx, x, s * 0.46, x, s * 0.82)
  },

  /** Three crossed marks stacked. */
  thrice: (ctx, s) => {
    const x = s / 2
    const r = s * 0.075
    for (const y of [s * 0.3, s * 0.5, s * 0.7]) {
      line(ctx, x - r, y - r, x + r, y + r)
      line(ctx, x + r, y - r, x - r, y + r)
    }
  },

  /** A stem through a low ring. */
  bind: (ctx, s) => {
    const x = s / 2
    line(ctx, x, s * 0.18, x, s * 0.5)
    circle(ctx, x, s * 0.62, s * 0.115)
  },

  /** A stem with a dot beneath it. */
  mark: (ctx, s) => {
    const x = s / 2
    line(ctx, x, s * 0.2, x, s * 0.6)
    dot(ctx, x, s * 0.76, s * 0.035)
  },

  /** A column of four dots. */
  tally: (ctx, s) => {
    const x = s / 2
    for (const y of [0.3, 0.435, 0.57, 0.705]) dot(ctx, x, s * y, s * 0.032)
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
 * resolve, and every stone carries one. White on transparent so the material decides the colour.
 */
export function drawRune(id: RuneId, size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  // Scaled with the canvas so the weight is right whatever size it is asked for. Round caps
  // because every mark in the concept art is cut rather than printed.
  ctx.lineWidth = size * 0.028
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  DRAWINGS[id](ctx, size)
  return canvas
}

/** Every rune, in the order they appear around the grove in the concept art. */
export const RUNE_IDS: RuneId[] = ['ascend', 'ring', 'thrice', 'bind', 'mark', 'tally']
