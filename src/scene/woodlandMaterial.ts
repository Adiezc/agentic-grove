/** Woodland surfaces use owenyuwono/Dryad's ridge field (MIT: licenses/dryad.txt)
 * on authored branch coordinates, Cortiz bark luminance/desaturation
 * (MIT: licenses/stylized-components.txt), plus Ashima Arts' MIT simplex noise.
 * Ian McEwan/Ashima Arts; maintained by Stefan Gustavson. Full original header is
 * in vendor/ashima-noise3D.glsl; licence: ../../licenses/ashima-webgl-noise.txt.
 * The lichen texture is baked from Linus Mossberg's MIT reaction-diffusion code.
 * This layer preserves the baked colours and the existing heartbeat shader hook.
 *
 * Photographed detail: Poly Haven's "Chinese Cedar Bark" (Charlotte Baglioni) for living wood
 * and "Rough Wood" (Rob Tuytel) for deadwood, both CC0 (see CREDITS.md). Each is wrapped round
 * a strand along its carved grain, a whole number of times (`_bark`), and supplies brightness
 * detail and a normal map. The baked colours stay in charge of the palette.
 */
import * as THREE from 'three'
import simplex from './vendor/ashima-noise3D.glsl?raw'
import dryadBark from './vendor/dryad-bark.glsl?raw'
import treeRoots from '../../assets/models/world-tree-roots.json'
import { DAIS_INNER_TOP, TREE_YAW, TREE_SCALE } from './stage'

export interface BarkTextures {
  living: THREE.Texture
  livingNormal: THREE.Texture
  dead: THREE.Texture
  deadNormal: THREE.Texture
}

/** Metres of strand one copy of the bark covers along its length. Matches BARK_TILE in the
 * Blender build, which sets how many copies go round. */
const BARK_TILE = 0.42

export function addWoodlandSurface(material: THREE.MeshStandardMaterial, mask: THREE.Texture, bark: BarkTextures) {
  const previous = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.uniforms.woodlandMask = { value: mask }
    shader.uniforms.barkLiving = { value: bark.living }
    shader.uniforms.barkLivingNormal = { value: bark.livingNormal }
    shader.uniforms.barkDead = { value: bark.dead }
    shader.uniforms.barkDeadNormal = { value: bark.deadNormal }
    // The Blender mesh and runtime root extensions use different local spaces.
    // Sample both in the model's original space so their grain and moss meet.
    shader.uniforms.woodlandToTree = { value: new THREE.Matrix4()
      .makeScale(1 / (treeRoots.scale * TREE_SCALE), 1 / (treeRoots.scale * TREE_SCALE), 1 / (treeRoots.scale * TREE_SCALE))
      .multiply(new THREE.Matrix4().makeRotationY(-TREE_YAW))
      .multiply(new THREE.Matrix4().makeTranslation(0, -DAIS_INNER_TOP, 0)) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 _grain; attribute float _bark; varying vec3 vWoodlandGrain; varying float vDeadwood; varying vec3 vWoodlandPosition; varying float vBarkRepeats;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWoodlandPosition = (modelMatrix * vec4(position, 1.0)).xyz; vWoodlandGrain = vec3(cos(_grain.x * 6.2831853), sin(_grain.x * 6.2831853), _grain.y); vDeadwood = _grain.z; vBarkRepeats = max(_bark, 1.0);')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWoodlandPosition;
varying vec3 vWoodlandGrain;
varying float vDeadwood;
varying float vBarkRepeats;
uniform sampler2D woodlandMask;
uniform sampler2D barkLiving;
uniform sampler2D barkLivingNormal;
uniform sampler2D barkDead;
uniform sampler2D barkDeadNormal;
uniform mat4 woodlandToTree;
${simplex}
${dryadBark}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
// Object-space sampling needs no UVs and stays attached to the authored tree.
vec3 woodlandP = (woodlandToTree * vec4(vWoodlandPosition, 1.0)).xyz;
// Dryad's band-limited ridge field follows the actual carved strand, including
// horizontal deadwood hooks. Interpolating sine/cosine prevents an angular UV seam.
vec3 grainDomain = vec3(vWoodlandGrain.xy * 2.4, vWoodlandGrain.z * 0.55);
grainDomain += barkWarpFBM(grainDomain * 0.8) * 0.22;
float grainFootprint = max(max(fwidth(grainDomain.x), fwidth(grainDomain.y)), fwidth(grainDomain.z));
float woodlandGrain = ridgedFBM(grainDomain, 4.0, grainFootprint);
float woodlandChecks = smoothstep(0.32, 0.67, barkNoise(vec3(grainDomain.xy * 2.0, grainDomain.z * 10.0)))
  * (1.0 - smoothstep(0.48, 0.75, woodlandGrain));
float woodlandHeight = woodlandGrain - woodlandChecks * 0.22;
float deadwood = clamp(vDeadwood, 0.0, 1.0);
// The photographed bark's coordinates: round the strand from the interpolated angle (no seam
// in the varying), along it in metres. Where the angle wraps, u jumps by a whole number of
// copies, which the texture hides; derivatives come from a half-turned copy there, so the
// mip level does not jump and draw a line down the strand.
float barkTurn = atan(vWoodlandGrain.y, vWoodlandGrain.x) / 6.2831853;
float barkTurnB = atan(-vWoodlandGrain.y, -vWoodlandGrain.x) / 6.2831853;
vec2 barkUv = vec2(barkTurn * vBarkRepeats, vWoodlandGrain.z / ${BARK_TILE.toFixed(2)});
vec2 barkUvB = vec2(barkTurnB * vBarkRepeats, barkUv.y);
vec2 barkDx = dFdx(barkUv), barkDy = dFdy(barkUv);
vec2 barkDxB = dFdx(barkUvB), barkDyB = dFdy(barkUvB);
if (abs(barkDxB.x) + abs(barkDyB.x) < abs(barkDx.x) + abs(barkDy.x)) { barkDx = barkDxB; barkDy = barkDyB; }
vec3 barkTexel = mix(textureGrad(barkLiving, barkUv, barkDx, barkDy).rgb, textureGrad(barkDead, barkUv, barkDx, barkDy).rgb, deadwood);
// Each texture's own average (its smallest mip) turns the photograph into brightness detail
// around 1, so the baked palette is kept and only the fibres, plates and checks come through.
vec3 barkMean = mix(textureLod(barkLiving, vec2(0.5), 12.0).rgb, textureLod(barkDead, vec2(0.5), 12.0).rgb, deadwood);
float barkDetail = dot(barkTexel, vec3(0.2126, 0.7152, 0.0722)) / max(dot(barkMean, vec3(0.2126, 0.7152, 0.0722)), 0.02);
diffuseColor.rgb *= mix(1.0, clamp(barkDetail, 0.25, 1.9), mix(0.8, 0.9, deadwood));
float woodlandPatch = snoise(woodlandP * 2.8);
diffuseColor.rgb *= mix(0.84 + woodlandHeight * 0.25, 0.86 + woodlandHeight * 0.22, deadwood);
// Preserve pale shari, with weathered recesses rather than living moss.
float woodLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(woodLuma), diffuseColor.rgb, 0.38), deadwood * 0.7);
// Living bark: the baked colour comes out golden under the grove's warm key light, while the
// concept trunk is a cool grey-taupe. Pull its saturation down rather than re-tuning the bake.
diffuseColor.rgb = mix(diffuseColor.rgb, woodLuma * vec3(0.96, 1.0, 0.93), 0.42 * (1.0 - deadwood));
float woodlandLichen = texture2D(woodlandMask, woodlandP.xz * 0.6 + woodlandP.y * 0.12).r;
// Moss is sparse, concentrated near the roots; pale shari remains legible above.
float woodlandBase = 1.0 - smoothstep(0.25, 2.0, woodlandP.y);
float woodlandMoss = smoothstep(0.10, 0.55, woodlandPatch) * woodlandBase
  * smoothstep(0.18, 0.75, woodlandLichen) * 0.5 * (1.0 - deadwood);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.105, 0.028), woodlandMoss);
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
// Crevices in the photograph are rougher than the polished ridges between them.
roughnessFactor = mix(0.93 - woodlandHeight * 0.16, 0.96 - woodlandHeight * 0.08, deadwood) + (1.0 - clamp(barkDetail, 0.0, 1.0)) * 0.05;
`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
// Fine relief from the existing grain, without extra textures or added triangles.
vec3 woodlandDx = dFdx(-vViewPosition);
vec3 woodlandDy = dFdy(-vViewPosition);
vec3 woodlandR1 = cross(woodlandDy, normal);
vec3 woodlandR2 = cross(normal, woodlandDx);
float woodlandDet = dot(woodlandDx, woodlandR1);
vec3 woodlandSlope = sign(woodlandDet) * (dFdx(woodlandHeight) * woodlandR1 + dFdy(woodlandHeight) * woodlandR2);
normal = normalize(max(abs(woodlandDet), 0.00000001) * normal - woodlandSlope * mix(0.004, 0.0025, deadwood));
// The photographed bark's normal map, in a frame built from the bark coordinates' screen
// derivatives (a cotangent frame), since the meshes carry no tangents.
vec3 barkR1 = cross(woodlandDy, normal), barkR2 = cross(normal, woodlandDx);
vec3 barkT = barkR1 * barkDx.x + barkR2 * barkDy.x;
vec3 barkB = barkR1 * barkDx.y + barkR2 * barkDy.y;
float barkScale = inversesqrt(max(max(dot(barkT, barkT), dot(barkB, barkB)), 1e-20));
vec3 barkN = mix(textureGrad(barkLivingNormal, barkUv, barkDx, barkDy).xyz, textureGrad(barkDeadNormal, barkUv, barkDx, barkDy).xyz, deadwood) * 2.0 - 1.0;
barkN.xy *= mix(1.1, 1.3, deadwood);
normal = normalize(mat3(barkT * barkScale, barkB * barkScale, normal) * barkN);
`)
  }
  material.customProgramCacheKey = () => `${previousKey}:woodland-dryad-photo-v1`
}
