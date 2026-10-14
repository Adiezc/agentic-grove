// Bark noise and antialiased ridged FBM adapted from owenyuwono/dryad,
// src/barkMaterial.js, e85729b779708c50b7d65ddd34d524f42da88705.
// Copyright (c) 2026 owenyuwono. MIT: licenses/dryad.txt.
// Grove uses four octaves and authored strand coordinates; no genome, SDF,
// bone skinning or demo assets are included.
const int BARK_FBM_OCTAVES = 4;
float barkHash(vec3 p) {
    p = fract(p * vec3(127.1, 311.7, 74.7));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z) * 2.0 - 1.0;
}

// 3-D value noise: trilinear interpolation of lattice hashes.
// Smoothstep kernel gives C1 continuity.
float barkNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f); // smoothstep

    float n000 = barkHash(i + vec3(0.0, 0.0, 0.0));
    float n100 = barkHash(i + vec3(1.0, 0.0, 0.0));
    float n010 = barkHash(i + vec3(0.0, 1.0, 0.0));
    float n110 = barkHash(i + vec3(1.0, 1.0, 0.0));
    float n001 = barkHash(i + vec3(0.0, 0.0, 1.0));
    float n101 = barkHash(i + vec3(1.0, 0.0, 1.0));
    float n011 = barkHash(i + vec3(0.0, 1.0, 1.0));
    float n111 = barkHash(i + vec3(1.0, 1.0, 1.0));

    return mix(
        mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
        mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
        u.z);
}

// Single ridge-noise octave: sharp valley / rounded ridge shape.
// (1 - |n|)^2 maps the center of each noise cell to 1 and the
// borders to 0, giving bright ridges on a dark base.
// Power of 2 gives a broader flat top and sharper valley — more furrow-like.
float ridgeOctave(vec3 p) {
    float n = barkNoise(p);
    n = 1.0 - abs(n);
    return n * n;
}

// Low-frequency FBM for domain warp input (2 octaves, very cheap).
vec3 barkWarpFBM(vec3 p) {
    float a = barkNoise(p);
    float b = barkNoise(p * 2.07 + vec3(3.17, 1.43, 2.71));
    return vec3(a + 0.5 * b, b + 0.5 * a, a * b) * 0.5;
}

// Single-layer ridged FBM at a given frequency (no domain warp — caller warps).
// 5 octaves.  Returns h in [0, 1] where 1 = ridge top, 0 = groove bottom.
// The power(h, 0.7) sharpens the transition, making furrows crisper.
//
// fw: pixel-footprint scale of the base sampling position (precomputed by caller
//     as max(fwidth(pw.x), fwidth(pw.y), fwidth(pw.z))).  Each octave fades out
//     smoothly via smoothstep when its detail would be sub-pixel, preventing
//     high-frequency aliasing from octaves the screen can't resolve.
float ridgedFBM(vec3 pw, float freq, float fw) {
    float amp   = 1.0;
    float total = 0.0;
    float norm  = 0.0;
    for (int oct = 0; oct < BARK_FBM_OCTAVES; oct++) {
        // Band-limit: fade out this octave when its pixel footprint >= ~1 px.
        // Wider fade band (0.35→1.3) preserves fine grain a little longer on zoom-in
        // before band-limiting, without re-introducing shimmer at distance.
        float octFw   = fw * freq;
        float aaFade  = 1.0 - smoothstep(0.35, 1.3, octFw);
        total += ridgeOctave(pw * freq) * amp * aaFade;
        norm  += amp;
        freq  *= 2.13;   // slightly irrational lacunarity -> no aliasing
        amp   *= 0.52;   // gain < 0.5 keeps ridges dominant
    }
    float h = clamp(total / norm, 0.0, 1.0);
    // Sharpening: push ridge peaks up and furrow bottoms down for crisper look.
    return pow(h, 0.5);
}
