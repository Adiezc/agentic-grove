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

  /**
   * The trunk and the deadwood.
   *
   * Corrected after a second sampling pass, and the correction was large enough to be worth
   * recording. The first read put the wood at `#477156`, a mid green-grey, and the trunk came out
   * as a dark green arc that vanished into the background. Sampling the *upper decile* of the
   * deadwood region rather than its mean gives `#9db192` — the wood in the art is a pale bleached
   * sage, closer to driftwood or bone than to bark, and it is one of the brightest things in the
   * frame after the light itself.
   *
   * That is what a bonsai's `jin` and `shari` actually are: stripped, weathered, sun-bleached
   * wood. Getting it dark is the single easiest way to lose the tree.
   */
  bone: '#9db192',
  /** Where the wood catches the key light, along the top of a limb. Nearly white. */
  boneLit: '#d8e2d2',
  /** The shadowed side, and the grooves between the strands of the braid. */
  boneShadow: '#2f3d33',

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
  /** Work energy. Kept inside the living green language of the supplied Grove art. */
  energy: '#72f6a2',

  /* Interface. Neutral on purpose — see the note above. */
  /** Labels, stone names, the console's own text. */
  text: '#c8c7ca',
  /** Placeholder text, inactive rail icons, secondary figures. */
  textDim: '#5c6f62',
  /** Hairlines: the console's border, panel edges. */
  line: '#16241a',

  /* Attention. The one colour in the grove that is not green, and so the one that means "you".
   * Amber rather than red: firelight against the forest, clearly different at the edge of vision
   * without turning a screen that is open all day into an alarm panel. */
  /** A session holding the turn back, waiting for you. The grove's heartbeat turns this colour. */
  waiting: '#f2b44c',
  /** A recent failure. The same family, a shade deeper, so both read as "look here". */
  errored: '#e8903a',
} as const

/**
 * Motion tokens.
 *
 * "Calm by default" is a principle, so the numbers are slow. The warm activity field is the one
 * thing allowed to breathe, and it does so with total system activity. The tree itself stays still.
 */
export const motion = {
  /** Seconds per activity-glow breath when nothing at all is happening. */
  breathIdleSeconds: 9.0,
  /** Seconds per activity-glow breath when the grove is fully busy. */
  breathBusySeconds: 1.85,
  /** How fast light travels along a root carrying an agent, in world units per second. */
  myceliumFlow: 0.68,
  /** Drift speed of the motes. Slow enough that you notice them only at the edge of vision. */
  moteDrift: 0.09,
  /** How far the camera leans with the mouse. Gentle parallax, per the brief's default. */
  parallax: 0.055,
} as const

/** Camera, matched to the elevated three-quarter view of the supplied concept frames. */
export const camera = {
  /* Pulled back and narrowed after the first render. The elevation still comes from the ring
   * ellipse ratio in the art (about 14 degrees), but the first attempt put the camera at z=10
   * with the stones out at radius 5, which cropped the near two stones at the frame edge and
   * made them twice the height of the tree. The art's grove sits comfortably inside the frame
   * with dark margin all round, and getting that back was mostly distance, not lens. */
  /* Reframed once the tree was rebuilt to the art's real proportions. The tree grew from 2.9
   * units to 3.85 and the stones shrank from 2.7 to about 1.6, which is the ratio the art
   * actually has — roughly two and a half to one — and the old framing cropped the new crown.
   * Distance and target height moved; the elevation did not, because that is the one number in
   * this file that was measured rather than chosen. */
  /* Pulled back again, same elevation, when the tree gained depth and the stones moved out to
   * give it room. */
  /* Nudged on 30 September 2026 at Adrian's request: the view centres a little right of and below
   * the tree, and sits about eight per cent further back. Same direction, so the elevation holds. */
  /* Lowered and brought in on 3 October 2026, to a framing Adrian set up by hand and asked to
   * keep: about fifteen degrees down instead of thirty, thirteen and a half units from the trunk,
   * the tree centred and filling the window, aimed above its middle so it stands just clear of the
   * console. The tree is the interface. The stones' places were then laid out around this view
   * (`src/scene/layout.ts`) rather than the camera backing off to fit the old ones. The stone
   * close-up keeps the old thirty-degree angle (`STONE_OFFSET` in Grove.tsx), since every rune
   * faces it.
   * position = target + 13.5 * (0, sin 15°, cos 15°) */
  fov: 30,
  position: [0.3, 6.09, 13.04] as [number, number, number],
  target: [0.3, 2.6, 0] as [number, number, number],
} as const
