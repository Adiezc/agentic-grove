/**
 * The dimensions of the clearing, in one place.
 *
 * These numbers exist here rather than in the file that draws each thing because session three
 * lost two renders to exactly that: the mycelium ran at y = 0.014 and the dais top face was at
 * 0.06, two constants in two files that had to agree and did not, so the entire root network was
 * buried inside the platform. Anything that has to know how high the floor is at a given radius
 * asks `heightAt` instead of carrying its own copy.
 *
 * The scale is set by the concept art. Measuring `assets/concept/grove-main.png`, the dais spans
 * about 530 pixels across and the tree stands about 450 pixels tall, which fixes one world unit
 * at roughly 115 pixels of the original. Every proportion below follows from that, and the two
 * that matter most are these:
 *
 *   - **The tree is about two and a half times the height of a stone.** In the first pass they
 *     were nearly the same height, which is most of why that render read as a circle of pylons
 *     around a shrub rather than as a grove around a world tree.
 *   - **A stone is about two and a half times taller than it is wide.** Not five, which is what
 *     the first pass used and which turns a crystal into a pencil.
 */

/** The raised disc under the tree. Radius to the outer lip. */
export const DAIS_RADIUS = 2.45

/** Height of the dais's top face above the floor. */
export const DAIS_TOP = 0.075

/** The inner step, which the art shows as a second, slightly lower terrace inside the outer lip. */
export const DAIS_INNER_RADIUS = 2.02
export const DAIS_INNER_TOP = 0.052

/**
 * How high the ground is at a given distance from the trunk.
 *
 * Everything that lies *on* the ground — roots, mycelium, ground rings, the flare at a stone's
 * foot — places itself with this, so a strand crossing the dais edge steps down where the dais
 * actually ends rather than where someone guessed it did.
 */
export function heightAt(radius: number): number {
  if (radius < DAIS_INNER_RADIUS) return DAIS_INNER_TOP
  if (radius < DAIS_RADIUS) return DAIS_TOP
  return 0
}

/** Clearance for anything drawn as light lying on the ground, so it never z-fights the floor. */
export const LIGHT_LIFT = 0.006

/** Height of a runestone of scale 1, from its foot to the tip of its point. */
export const STONE_HEIGHT = 1.62

/** Height the tree's crown reaches. Used to frame the camera, so it lives with the other sizes. */
export const TREE_HEIGHT = 3.85

/**
 * How far the tree model is turned about its trunk, in radians.
 *
 * The model's own front is the reference plate's front. Once the tree had depth all round, the
 * best view of it turned out to be about forty-five degrees round from that: the canopy up on the left,
 * the deadwood sweeping away to the right. Turning the tree, rather than the camera, keeps the
 * stones and console composed exactly as the concept art has them. The root tips the mycelium
 * leaves from are turned by the same amount (`network.ts`), so the two stay joined.
 */
export const TREE_YAW = Math.PI / 4
