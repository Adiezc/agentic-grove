/**
 * Gradient/colour variation and world-space sway additionally adapted from
 * cortiz2894/stylized-components pineLeafMaterial.ts and shaders/pineLeaf.ts,
 * revision 1cece0a296b29299d1380c34feb5c158b2f04500.
 * Copyright (c) 2026 Christian Ortiz (Cortiz). MIT: licenses/stylized-components.txt.
 * Grove retains the original leaf colours, geometry and reduced-motion controls.
 *
 * Canopy gradient, soft normals and height-weighted wind adapted from
 * leoawen/fluffytree-threejs index.html/createCustomCanopyMaterial.
 * Copyright (c) 2025 Leonardo Soares Gonçalves. MIT: licenses/fluffytree-threejs.txt.
 * Revision f39d9526aadecdf4026de8853e7891736c5063b3.
 * Grove retains Standard materials, leaf geometry and dark colours; blends instead
 * of replacing normals, and previously used already credited Ashima noise rather than the
 * demo's embedded Perlin functions in the first pass. Cortiz's smooth colour
 * noise and wind now supply variation. No demo model, textures or GUI are copied.
 */
import * as THREE from 'three'

export interface FoliageUniforms {
  time: { value: number }
  wind: { value: number }
}

/**
 * Juniper foliage from ambientCG's "Leaf Set 019" (CC0), three photographed scale-leaf sprays:
 * its opacity cuts each spray card to the real outline, and its colour supplies the fine scale
 * pattern as brightness around 1, so the canopy keeps Grove's own three greens. The model's
 * UVs (JUNIPER_SPRAYS in the Blender build) point each card at one of the three sprays.
 */
export interface LeafTextures {
  colour: THREE.Texture
  opacity: THREE.Texture
  normal: THREE.Texture
}

/** Mean linear brightness of the photographed sprays, measured over their opaque pixels. */
const LEAF_MEAN_LUMA = 0.120

export function addFoliageSurface(material: THREE.MeshStandardMaterial, uniforms: FoliageUniforms, leaf: LeafTextures) {
  material.roughness = 0.88
  // Standard alpha cut-out; three's alpha map reads the green channel of the opacity image.
  material.alphaMap = leaf.opacity
  // Low, because a distant spray's opacity is averaged with the gaps between its scales in the
  // smaller mip levels; a high threshold eats the outer pads away.
  material.alphaTest = 0.28
  // The atlas's own normal map lets each scale catch the light; three builds the tangent frame
  // from the UVs, so the model needs no tangents.
  material.normalMap = leaf.normal
  material.normalScale.set(0.9, 0.9)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.foliageTime = uniforms.time
    shader.uniforms.foliageWind = uniforms.wind
    shader.uniforms.leafColour = { value: leaf.colour }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vFoliagePosition;
varying vec3 vFoliageWorld;
uniform float foliageTime;
uniform float foliageWind;
`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
// Cortiz: squared height mask, world-space wind transformed back into local
// space, slow sway and small flutter. Wind=0 also makes pendulum dip exactly zero.
vec3 leafWorld = (modelMatrix * vec4(position, 1.0)).xyz;
float leafHeight = clamp((position.y - 0.8) / 4.4, 0.0, 1.0);
float leafMask = leafHeight * leafHeight;
mat3 leafRotation = mat3(normalize(vec3(modelMatrix[0])), normalize(vec3(modelMatrix[1])), normalize(vec3(modelMatrix[2])));
vec3 leafDirection = transpose(leafRotation) * normalize(vec3(1.0, 0.0, 1.0));
float leafSway = sin(dot(leafWorld.xz, normalize(vec2(1.0))) * 1.2 + foliageTime * 0.6);
float leafFlutter = sin(foliageTime * 1.9 + leafWorld.y * 2.3 + leafWorld.x) * 0.16;
float leafWave = leafSway + leafFlutter;
transformed += leafDirection * leafWave * foliageWind * leafMask;
transformed.y -= abs(leafWave) * foliageWind * leafMask * 0.2;
vFoliagePosition = position;
vFoliageWorld = leafWorld;
`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFoliagePosition;
varying vec3 vFoliageWorld;
uniform sampler2D leafColour;
      float _lfHash(vec3 p) {
        p = fract( p * vec3( 127.1, 311.7, 74.7 ) );
        p += dot( p, p.yzx + 19.19 );
        return fract( ( p.x + p.y ) * p.z );
      }
      float _lfNoise(vec3 p) {
        vec3 i = floor( p );
        vec3 f = fract( p );
        vec3 w = f * f * ( 3.0 - 2.0 * f );
        return mix(
          mix( mix( _lfHash( i ),               _lfHash( i + vec3(1,0,0) ), w.x ),
               mix( _lfHash( i + vec3(0,1,0) ), _lfHash( i + vec3(1,1,0) ), w.x ), w.y ),
          mix( mix( _lfHash( i + vec3(0,0,1) ), _lfHash( i + vec3(1,0,1) ), w.x ),
               mix( _lfHash( i + vec3(0,1,1) ), _lfHash( i + vec3(1,1,1) ), w.x ), w.y ),
          w.z );
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
// Cortiz's height gradient and smooth world-space colour patches, retaining
// Grove's leaf material colours and separating sunlit clumps from shaded ones.
float canopyGradient = pow(clamp((vFoliagePosition.y - 0.8) / 4.4, 0.0, 1.0), 1.15);
vec3 canopyShadow = vec3(0.44, 0.61, 0.46);
vec3 canopyLit = vec3(0.96, 1.04, 0.78);
vec3 leaf = diffuseColor.rgb * mix(canopyShadow, canopyLit, canopyGradient);
float leafPatch = _lfNoise(vFoliageWorld * 2.2) - 0.5;
leaf += (leaf * vec3(1.35, 1.16, 0.72) - leaf) * leafPatch * 1.3;
diffuseColor.rgb = max(leaf, vec3(0.0));
// The sprays' scale pattern and paler new growth, as brightness only.
float leafLuma = dot(texture2D(leafColour, vAlphaMapUv).rgb, vec3(0.2126, 0.7152, 0.0722));
diffuseColor.rgb *= clamp(mix(1.0, leafLuma / ${LEAF_MEAN_LUMA}, 0.9), 0.35, 1.8);
`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
// Blend FluffyTree's world-up foliage normals with the authored leaf normals.
vec3 foliageUp = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
normal = normalize(mix(normal, foliageUp, 0.22));
`)
  }
  material.customProgramCacheKey = () => 'grove-fluffytree-cortiz-juniper-v1'
}
