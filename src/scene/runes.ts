/**
 * The inscriptions on the runestones, in Ogham, drawn to canvas textures.
 *
 * **Why Ogham.** The druids left no runes. Runes (the futhark) are Germanic and Norse. The script
 * that comes out of the druids' world is Ogham: the early Irish alphabet cut into standing stones
 * across Ireland, western Britain and the Isle of Man, mostly in the fourth to sixth centuries.
 * Around four hundred of those stones survive. Each letter was later named after a tree — beith
 * the birch, dair the oak, iodhadh the yew — which suits a grove built round a world tree.
 *
 * **Why it fits the art.** An Ogham letter is a group of one to five strokes on a single stem line,
 * the *druim*. On a real stone the druim is the stone's own edge, and the text runs from the
 * bottom up. The concept art's marks are already built that way: one hairline running most of the
 * height of the stone, with marks on it. So this is the art's composition with real letters on it,
 * and it keeps what made the first version work: you see the line first, then the marks, even at
 * forty pixels tall and half lost in bloom.
 *
 * **What is written.** Each stone carries one word that turns up again and again in the surviving
 * inscriptions, where they mostly record a person and their lineage: `X MAQI Y`, "X son of Y".
 * They are real Primitive Irish words, spelled the way the stones spell them. See `INSCRIPTIONS`.
 *
 * Drawn in code rather than shipped as files, for one reason worth stating: an inscription has to
 * change brightness with the state of its project, from barely there on an idle stone to blown out
 * on a running one. A texture drawn white and tinted by its material does that for free.
 *
 * They are brand marks, not interface icons. The interface icons in the rail come from Phosphor,
 * as they should — nobody should be hand-drawing a gear.
 */

/**
 * The four families (*aicmí*) of Ogham letters, by where their strokes sit on the stem.
 *
 *   right    strokes out to one side      B L F S N
 *   left     strokes out to the other     H D T C Q
 *   across   long strokes slanting across M G NG Z R
 *   notch    the vowels, notches on the edge itself, drawn here as dots on the stem  A O U E I
 */
type Family = 'right' | 'left' | 'across' | 'notch'

/** Each letter is a family and a count, one to five. The count is the letter's place in its family. */
const OGHAM: Record<string, [Family, number]> = {
  B: ['right', 1], L: ['right', 2], F: ['right', 3], V: ['right', 3], S: ['right', 4], N: ['right', 5],
  H: ['left', 1], D: ['left', 2], T: ['left', 3], C: ['left', 4], K: ['left', 4], Q: ['left', 5],
  M: ['across', 1], G: ['across', 2], Z: ['across', 4], R: ['across', 5],
  A: ['notch', 1], O: ['notch', 2], U: ['notch', 3], E: ['notch', 4], I: ['notch', 5],
}

export type RuneId = 'maqi' | 'mucoi' | 'avi' | 'anm' | 'neta' | 'celi' | 'koi'

export interface Inscription {
  /** The word as the stones spell it, in the conventional transliteration. */
  text: string
  /** What it means, for anyone reading this file or hovering a stone later. */
  meaning: string
}

/**
 * The words, all taken from the formulae of the surviving Ogham stones. Transliteration and
 * meanings follow the standard reference, Damian McManus, *A Guide to Ogam* (1991).
 */
export const INSCRIPTIONS: Record<RuneId, Inscription> = {
  /** The commonest word in the whole corpus: the "son of" in "X MAQI Y". */
  maqi: { text: 'MAQI', meaning: 'son of' },
  /** "Of the kindred", naming the people a person belonged to. */
  mucoi: { text: 'MUCOI', meaning: 'of the kindred of' },
  /** "Grandson", or more loosely, descendant. */
  avi: { text: 'AVI', meaning: 'descendant of' },
  /** "Name", opening a handful of inscriptions: "the name of X". */
  anm: { text: 'ANM', meaning: 'name' },
  /** "Champion", a common element in personal names. */
  neta: { text: 'NETA', meaning: 'champion' },
  /** "Follower", or client, of a lord or a saint. */
  celi: { text: 'CELI', meaning: 'follower of' },
  /** "Here", as in "here lies". Spelled with the C letter on the stones. */
  koi: { text: 'KOI', meaning: 'here' },
}

/** Every inscription, in the order the fixtures use them. */
export const RUNE_IDS: RuneId[] = ['anm', 'maqi', 'mucoi', 'celi', 'neta', 'avi', 'koi']

/**
 * An inscription for any project, from its id.
 *
 * The fixtures name theirs, but the real grove has one stone per folder on disk and nobody should
 * have to choose a word for each. Hashing keeps a project's word the same on every launch.
 */
export function runeFor(id: string): RuneId {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return RUNE_IDS[(hash >>> 0) % RUNE_IDS.length]!
}

/** Where the stem starts and stops, as a fraction of the canvas height. Shared by every stone. */
const STEM_TOP = 0.06
const STEM_BOTTOM = 0.94

/**
 * Draw one inscription to a canvas, white on transparent, so the material decides the colour.
 *
 * Twice as tall as it is wide, matching the panel it is shown on. Letters are laid out from the
 * bottom up, as on the stones, and spaced so a five-stroke letter still reads as one group: the gap
 * between letters is well over twice the gap between strokes.
 */
export function drawRune(id: RuneId, width = 256): HTMLCanvasElement {
  const height = width * 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  // Thin. In the art these are hairlines that bloom outwards, and a heavy stroke plus bloom gives
  // a fat glowing worm rather than a cut line.
  ctx.lineWidth = width * 0.02
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const x = width / 2
  const top = height * STEM_TOP
  const bottom = height * STEM_BOTTOM
  line(ctx, x, bottom, x, top)

  const letters = [...INSCRIPTIONS[id].text].map((letter) => OGHAM[letter]).filter((l) => l !== undefined)

  // Measure in stroke gaps: each letter takes (count - 1) gaps, and each space between letters
  // takes LETTER_GAP of them. The text is centred on the stem with a clear run at both ends,
  // which is how the stones leave it too.
  const LETTER_GAP = 2.6
  const units = letters.reduce((sum, [, count]) => sum + (count - 1), 0) + (letters.length - 1) * LETTER_GAP
  const span = (bottom - top) * 0.74
  const gap = Math.min(height * 0.034, span / Math.max(units, 1))
  let y = (top + bottom) / 2 + (units * gap) / 2

  // A small, fixed wobble per stroke, so it reads as cut by hand rather than printed.
  let wobbleSeed = id.length * 97
  const wobble = () => {
    wobbleSeed = (wobbleSeed * 16807) % 2147483647
    return (wobbleSeed / 2147483647 - 0.5) * 2
  }

  const reach = width * 0.2
  for (const [family, count] of letters) {
    for (let k = 0; k < count; k++) {
      const at = y - k * gap
      const length = reach * (1 + wobble() * 0.06)
      const tilt = wobble() * width * 0.006
      if (family === 'right') line(ctx, x, at, x + length, at + tilt)
      else if (family === 'left') line(ctx, x - length, at + tilt, x, at)
      else if (family === 'across') line(ctx, x - length * 0.8, at + gap * 0.45, x + length * 0.8, at - gap * 0.45)
      // Small enough that five vowel dots stay five dots after bloom, not one bead chain.
      else dot(ctx, x, at, width * 0.024)
    }
    y -= (count - 1) * gap + LETTER_GAP * gap
  }
  return canvas
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}
