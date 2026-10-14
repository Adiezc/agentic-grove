/** Woodland surfaces use owenyuwono/Dryad's ridge field (MIT: licenses/dryad.txt)
 * on authored branch coordinates, Cortiz bark luminance/desaturation
 * (MIT: licenses/stylized-components.txt), plus Ashima Arts' MIT simplex noise.
 * Ian McEwan/Ashima Arts; maintained by Stefan Gustavson. Full original header is
 * in vendor/ashima-noise3D.glsl; licence: ../../licenses/ashima-webgl-noise.txt.
 * The lichen texture is baked from Linus Mossberg's MIT reaction-diffusion code.
 * This layer preserves the baked colours and the existing heartbeat shader hook.
 */
import * as THREE from 'three'
import simplex from './vendor/ashima-noise3D.glsl?raw'
import dryadBark from './vendor/dryad-bark.glsl?raw'
import treeRoots from '../../assets/models/world-tree-roots.json'
import { DAIS_INNER_TOP, TREE_YAW, TREE_SCALE } from './stage'

export function addWoodlandSurface(material: THREE.MeshStandardMaterial, mask: THREE.Texture) {
  const previous = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.uniforms.woodlandMask = { value: mask }
    // The Blender mesh and runtime root extensions use different local spaces.
    // Sample both in the model's original space so their grain and moss meet.
    shader.uniforms.woodlandToTree = { value: new THREE.Matrix4()
      .makeScale(1 / (treeRoots.scale * TREE_SCALE), 1 / (treeRoots.scale * TREE_SCALE), 1 / (treeRoots.scale * TREE_SCALE))
      .multiply(new THREE.Matrix4().makeRotationY(-TREE_YAW))
      .multiply(new THREE.Matrix4().makeTranslation(0, -DAIS_INNER_TOP, 0)) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 _grain; varying vec3 vWoodlandGrain; varying float vDeadwood; varying vec3 vWoodlandPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWoodlandPosition = (modelMatrix * vec4(position, 1.0)).xyz; vWoodlandGrain = vec3(cos(_grain.x * 6.2831853), sin(_grain.x * 6.2831853), _grain.y); vDeadwood = _grain.z;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWoodlandPosition;
varying vec3 vWoodlandGrain;
varying float vDeadwood;
uniform sampler2D woodlandMask;
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
float woodlandPatch = snoise(woodlandP * 2.8);
diffuseColor.rgb *= mix(0.68 + woodlandHeight * 0.50, 0.76 + woodlandHeight * 0.40, deadwood);
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
roughnessFactor = mix(0.93 - woodlandHeight * 0.16, 0.96 - woodlandHeight * 0.08, deadwood);
`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
// Fine relief from the existing grain, without extra textures or added triangles.
vec3 woodlandDx = dFdx(-vViewPosition);
vec3 woodlandDy = dFdy(-vViewPosition);
vec3 woodlandR1 = cross(woodlandDy, normal);
vec3 woodlandR2 = cross(normal, woodlandDx);
float woodlandDet = dot(woodlandDx, woodlandR1);
vec3 woodlandSlope = sign(woodlandDet) * (dFdx(woodlandHeight) * woodlandR1 + dFdy(woodlandHeight) * woodlandR2);
normal = normalize(max(abs(woodlandDet), 0.00000001) * normal - woodlandSlope * mix(0.007, 0.004, deadwood));
`)
  }
  material.customProgramCacheKey = () => `${previousKey}:woodland-dryad-v4`
}
