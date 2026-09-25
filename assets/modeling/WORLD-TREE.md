# World tree in Grove

Grove now loads `assets/models/world-tree-blender.glb`, authored in Blender from the four reference plates in `world-tree-views/`. The previous `world-tree-v1.glb` remains available for comparison.

## Rebuild

```sh
npm run build:tree-model
npm run build
```

The model command runs `scripts/build-world-tree-blender.py` using the installed Blender application on macOS, or `blender` on PATH elsewhere. Set `BLENDER_BIN` to choose another installation. It rebuilds geometry, bakes bark colour, renders four comparison views and exports the GLB. A failed Blender script or export fails the command.

Default review outputs, including the editable `.blend`, are in `assets/modeling/world-tree-review/` (ignored by Git). `TREE_REVIEW_DIR` can put these elsewhere. `TREE_SAMPLES=96` increases the comparison render quality; default is 48. The last completed review used 96 samples in Blender 5.2.2 LTS.

## Runtime contract

- glTF uses Y up. `ReferenceTree.tsx` fits the crown to 4.25 units and places the lowest root on the dais.
- `WT Baked Bark` materials carry vertex colours baked from Blender's procedural wood shader. No remote textures or decoders are needed.
- `WT Leaf` materials receive subtle green ambient emission and use double-sided leaf geometry.
- `WT Root Glow` follows the existing activity heartbeat, together with the root network and aura.
- The carved wood also carries a custom `_glow` vertex attribute (exported with `export_attributes`): 1 beside a vein, fading within a few centimetres, brighter low on the trunk. `ReferenceTree.tsx` splices it into the wood shader as extra emissive light and drives its strength from the heartbeat, kept under the bloom threshold at rest. Veins run along fibre crests with fine branching veins either side.
- The exported tree has 463,388 triangles. Canopy twigs, rootlets and glow are reduced before baking; the carved wood is not, because its resolution is set in `carved()` and decimation would erase the grooves the bark colour depends on. Review renders show the exported geometry.
- Wood surface (23 September 2026): each strand is sculpted as a bundle of twisted fibres with real grooves and cracks. `carved()` writes `groove` and `tone` attributes per vertex, sampled along each strand's own direction, and the wood shader turns them into colour before the bake. Canopy branches use a separate darker `WT Branch Wood`. Deadwood is baked much paler than the Blender renders strictly need, because Grove's dim, warm lighting compresses the difference between the two woods. The previous model and script are backed up in `world-tree-studio/backup-2026-09-23-before-wood/`.
- This change retains the existing fixture-driven activity source. It does not add live agent wiring.

- Depth pass (25 September 2026): the braid is authored deeper (`DEPTH_SCALE`, `depth_swell`) and big strands have deeper cross-sections (`STRAND_DEPTH_FATNESS`), so the tree reads solid from every orbit angle, not only the front. Canopy pads are built from domed clusters of rounded clumps with sprigs facing outward, instead of a thin scattered disc. The build also renders five three-quarter and side views (`quarter-*.png`, `side-right.png`, `grove-home.png`) for review, because the four axis-aligned plates can all match while the angles between them stay flat.
- Root hand-off: every root ends at a fixed radius and carries a vein. The build writes `assets/models/world-tree-roots.json` (tip position, direction and radius, in ReferenceTree's local space). `network.ts` starts every stone's strand at a root tip, and `ReferenceTree.tsx` continues the wood along it, thinning to nothing, so each root narrows into its mycelium strand. **Rebuild the model and the JSON together**; the JSON also assumes ReferenceTree's 4.25-unit fit.
- 360-degree pass (25 September 2026): the tree is turned about its own trunk by an angle that varies with height (`TWIST_KEYS`), so tiers and deadwood hooks point in different directions like a styled bonsai, and eight extra pads (`extra_pads`) sit either side of the canopy-to-deadwood line. Roots and rootlets brighten towards their tips (`ROOT_TIP_GLOW`); the JSON also lists every rootlet tip, and Grove grows a light hair from each. Review renders now include `diagonal-*.png`, straight down the tree's lean, which is where it used to look flat.
- Inner-light pass (25 September 2026): the glow comes mostly from inside. `_glow` is now highest deep in the grooves low on the trunk (`INNER_GLOW`), a dim core (`WT Inner Glow`, driven separately in ReferenceTree) runs up inside the braid and shows through gaps, and the surface lines are down to one faint line on two trunk strands plus one per root, running to the tip. Flow 6 no longer arches into a deadwood hook, canopy twigs start under each pad's centre so they stay hidden, the two low side pads are tucked closer to the trunk, and five pads fill the back of the crown.
- The glowing inner core was replaced by a solid wood core (`Inner core`), because it showed through gaps in the braid as flat green panels. Groove glow is softer (`INNER_GLOW` 0.55). Grove turns the whole model by `TREE_YAW` (45°, in `stage.ts`) so the best angle is the home view; `network.ts` turns the root tips by the same amount.
- The previous model and scene files are backed up in `world-tree-studio/backup-2026-09-25-before-depth/`.

## Fidelity and verification

The front, left and back comparisons are orthographic. The reference's TOP panel is interpreted as an elevated view, so its comparison uses an elevated camera rather than a strict top projection.

Continuous wood flows, hooked deadwood, separate lower foliage tiers, branching roots and luminous channels are implemented. This remains an approximation: fine braid topology, bark relief, foliage distribution and the elevated silhouette differ from the pictures. Integration follows the user's instruction to put the closest available version into Grove; it does not imply an exact-match approval.

Validation: Blender rebuild/export, four-view visual inspection, production TypeScript/Vite build, GLB structure/material checks and live Grove home/orbit checks. The optimized preview reached 60 FPS at high quality on this machine; this is a local observation rather than a performance guarantee. Vite still reports the existing large JavaScript chunk warning.
