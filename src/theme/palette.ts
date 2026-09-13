/**
 * The palette, sampled from the concept art rather than invented.
 *
 * Every value below was read out of `assets/concept/grove-main.png` with a colour picker, not
 * chosen. That matters: the brief says the visual direction is not negotiable, and the fastest
 * way to drift off it is to type a green that feels about right.
 *
 * Three things the sampling turned up that guessing would have got wrong:
 *
 *   1. **The ground is nearly black.** `#020904` covers about four-fifths of the image. Not
 *      "dark green" — black with a green bias, two or three values above zero.
 *   2. **The monoliths are darker than the background is bright.** `#000F05`. They read as
 *      silhouettes, lit only by their own rune and a thin rim. They are not glowing objects.
 *   3. **The text is grey, not green.** `#C8C7CA`. Green is reserved for *state* — a stone that
 *      is working, a root carrying an agent. That single restraint is what makes the scene calm
 *      enough to leave open all day, and it is principle four of the project in colour form.
 *
 * So: green means something is alive. Grey means it is a label. If a new element wants to be
 * green, it has to be earning it.
 */

export const palette = {
  /** The void. Everything sits on this. */
  ground: '#020904',
  /** Very slightly lifted, for the dais and the near ground where light pools. */
  groundLit: '#04150a',

  /** Monolith bodies. Darker than the sky, which is what makes them read as silhouettes. */
  stone: '#000f05',
  /** The thin lit edge down a monolith's near corner. */
  stoneRim: '#295135',

  /** The trunk: desaturated green-grey, closer to weathered bone than to wood. */
  bark: '#477156',
  barkShadow: '#29322a',

  /* The green ramp, dark to blown-out. Ordered so a status can walk up it. */
  /** Faint structure: ground rings, dormant mycelium, an idle stone's rune. */
  deep: '#092b15',
  /** A resting glow. */
  moss: '#124d2a',
  /** Mid: an active root, canopy shadow. */
  vein: '#2e6f48',
  /** Bright: a running stone's rune, a lit root. */
  live: '#42b26e',
  /** Brighter: canopy leaves catching light. */
  leaf: '#7beb9c',
  /** Highlight, on the edge of clipping. */
  glow: '#94d7ad',
  /** The blown-out core of anything bloomed. Near-white mint, never pure white. */
  core: '#bff3d8',

  /* Interface. Neutral on purpose — see the note above. */
  /** Labels, stone names, the console's own text. */
  text: '#c8c7ca',
  /** Placeholder text, inactive rail icons, secondary figures. */
  textDim: '#5c6f62',
  /** Hairlines: the console's border, panel edges. */
  line: '#16241a',

  /* State, for later sessions. Kept here so nothing invents its own amber. */
  /** A session holding the turn back, waiting for you. */
  waiting: '#e8c468',
  /** A recent failure. */
  errored: '#e06c5f',
} as const

/**
 * Motion tokens.
 *
 * "Calm by default" is a principle, so the numbers are slow. The heartbeat is the one thing that
 * is allowed to change speed, and it does so with total system activity — an idle grove breathes
 * about as fast as someone asleep, and a busy one about as fast as someone walking.
 */
export const motion = {
  /** Seconds per canopy breath when nothing at all is happening. */
  breathIdleSeconds: 6.5,
  /** Seconds per breath when the grove is fully busy. */
  breathBusySeconds: 2.2,
  /** How fast light travels along a root carrying an agent, in world units per second. */
  myceliumFlow: 0.55,
  /** Drift speed of the motes. Slow enough that you notice them only at the edge of vision. */
  moteDrift: 0.09,
  /** How far the camera leans with the mouse. Gentle parallax, per the brief's default. */
  parallax: 0.055,
} as const

/** Camera, read off the concept art's own perspective. See `Grove.tsx` for the derivation. */
export const camera = {
  /* Pulled back and narrowed after the first render. The elevation still comes from the ring
   * ellipse ratio in the art (about 14 degrees), but the first attempt put the camera at z=10
   * with the stones out at radius 5, which cropped the near two stones at the frame edge and
   * made them twice the height of the tree. The art's grove sits comfortably inside the frame
   * with dark margin all round, and getting that back was mostly distance, not lens. */
  fov: 28,
  position: [0, 3.05, 15.4] as [number, number, number],
  target: [0, 1.35, 0] as [number, number, number],
} as const
