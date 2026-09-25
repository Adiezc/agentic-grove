"""World Tree: Blender-authored anatomical reconstruction for Grove.

Run from the application repository: npm run build:tree-model
Keeps reference plates and deterministic authoring source in the repository. Front, left and back
are orthographic. The reference-labelled top comparison uses an elevated camera;
it is not a strict top projection. This is an approximation, not a 1:1 replica.
"""

from __future__ import annotations

import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

SEED = 713
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REVIEW_DIR = os.environ.get("TREE_REVIEW_DIR", os.path.join(HERE, "assets", "modeling", "world-tree-review"))
REF_DIR = os.path.join(HERE, "assets", "modeling", "world-tree-views")
RENDER_DIR = os.path.join(REVIEW_DIR, "renders")
# TREE_EXPORT_DIR lets a candidate be reviewed without replacing the model Grove loads.
EXPORT_DIR = os.environ.get("TREE_EXPORT_DIR", os.path.join(HERE, "assets", "models"))
BLEND_PATH = os.path.join(REVIEW_DIR, "world-tree.blend")

RES_X, RES_Y = 768, 512
SAMPLES = int(os.environ.get("TREE_SAMPLES", "48"))

rng = random.Random(SEED)


# --------------------------------------------------------------------------------------
# scene helpers
# --------------------------------------------------------------------------------------

def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (
        bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.objects,
        bpy.data.images, bpy.data.lights, bpy.data.cameras, bpy.data.node_groups,
    ):
        for item in list(block):
            block.remove(item)


def link(obj: bpy.types.Object) -> bpy.types.Object:
    bpy.context.collection.objects.link(obj)
    return obj


def activate(obj: bpy.types.Object) -> None:
    for other in bpy.context.selected_objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


# --------------------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------------------

def _principled(mat):
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return nt, bsdf


def wood_material(name, pale, mid, crevice, roughness, cavity_strength, spec=0.46, tone_offset=0.40):
    """Driftwood shader. Its only job now is to be baked into vertex colours.

    The pattern itself is computed per vertex by carved(), along each strand's own direction,
    and handed over as two attributes:
      tone   -0.5 to 0.5: long pale and darker streaks running with the grain;
      groove  0 to 1: the grooves between cords and the cracks along the grain.
    A world-space noise texture was tried first and smeared into camouflage blotches, because
    the strands run in every direction. Meshes without the attributes (canopy twigs, rootlets)
    read them as 0, which gives an even mid tone with only ambient occlusion on top.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt, bsdf = _principled(mat)

    def attribute(label, y):
        node = nt.nodes.new("ShaderNodeAttribute")
        node.location = (-1300, y)
        node.attribute_name = label
        return node.outputs["Fac"]

    def ramp(value, y, stops):
        node = nt.nodes.new("ShaderNodeValToRGB")
        node.location = (-1100, y)
        elements = node.color_ramp.elements
        elements[0].position, elements[0].color = stops[0]
        elements[1].position, elements[1].color = stops[1]
        nt.links.new(value, node.inputs["Fac"])
        return node.outputs["Color"]

    def math_node(operation, a, b, y):
        node = nt.nodes.new("ShaderNodeMath")
        node.operation = operation
        node.location = (-880, y)
        for socket, value in zip(node.inputs, (a, b)):
            if isinstance(value, float):
                socket.default_value = value
            else:
                nt.links.new(value, socket)
        return node.outputs[0]

    # --- tone: the offset sets the balance of dark and bright fibres. Living wood sits toward
    # the darker end with a few bright fibres; deadwood sits toward the bleached end. It also
    # decides where a mesh without the attribute lands.
    tone = math_node("ADD", attribute("tone", -150), tone_offset, -150)
    body = ramp(tone, -150, ((0.0, (*mid, 1.0)), (1.0, (*pale, 1.0))))

    # --- cavity: whichever is darker wins, the carved groove or real ambient occlusion where
    # braided strands press together
    groove = ramp(attribute("groove", 300), 300, ((0.15, (0, 0, 0, 1)), (0.70, (1, 1, 1, 1))))
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.location = (-1300, 520)
    ao.only_local = True
    ao.samples = 16
    ao.inputs["Distance"].default_value = 0.18
    occlusion = ramp(ao.outputs["AO"], 520, ((0.25, (1, 1, 1, 1)), (0.85, (0, 0, 0, 1))))
    cavity = math_node("MAXIMUM", occlusion, groove, 420)
    # deadwood uses a lower strength so the bleached blades stay pale overall
    cavity = math_node("MULTIPLY", cavity, cavity_strength, 420)

    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.location = (-640, 60)
    nt.links.new(cavity, mix.inputs["Factor"])
    nt.links.new(body, mix.inputs[6])
    mix.inputs[7].default_value = (*crevice, 1.0)

    # --- the reference's bark turns green around the veins, as if stained by the light
    stain = nt.nodes.new("ShaderNodeMix")
    stain.data_type = "RGBA"
    stain.location = (-400, 60)
    nt.links.new(math_node("MULTIPLY", attribute("_glow", 700), 0.30, 700), stain.inputs["Factor"])
    nt.links.new(mix.outputs[2], stain.inputs[6])
    stain.inputs[7].default_value = (0.05, 0.20, 0.07, 1.0)
    nt.links.new(stain.outputs[2], bsdf.inputs["Base Color"])

    bsdf.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = spec
    return mat


def leaf_material(name, colour, sheen):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt, bsdf = _principled(mat)
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.70
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = sheen
    return mat


def glow_material(name, colour, strength):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.location = (200, 0)
    emit.inputs["Color"].default_value = (*colour, 1.0)
    emit.inputs["Strength"].default_value = strength
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def halo_material(name, colour, strength):
    """Soft sheath around the veins: emissive toward the core, transparent at the silhouette.
    This stands in for a compositor bloom, which Blender 5 will not run in background here."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.location = (380, 0)
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.location = (160, -120)
    emit.inputs["Color"].default_value = (*colour, 1.0)
    emit.inputs["Strength"].default_value = strength
    trans = nt.nodes.new("ShaderNodeBsdfTransparent")
    trans.location = (160, 80)
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.location = (-60, 120)
    lw.inputs["Blend"].default_value = 0.16
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (120, 260)
    ramp.color_ramp.elements[0].position = 0.10
    ramp.color_ramp.elements[1].position = 0.80
    nt.links.new(lw.outputs["Facing"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mix.inputs["Fac"])
    nt.links.new(emit.outputs["Emission"], mix.inputs[1])
    nt.links.new(trans.outputs["BSDF"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    mat.use_backface_culling = False
    return mat


def flat_material(name, colour, roughness=0.9):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt, bsdf = _principled(mat)
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


# --------------------------------------------------------------------------------------
# curve helpers
# --------------------------------------------------------------------------------------

def resample(points, count):
    """Catmull-Rom resample of a control polyline into `count` smooth samples."""
    pts = [Vector(p) for p in points]
    if len(pts) < 2:
        return pts
    ext = [pts[0] - (pts[1] - pts[0])] + pts + [pts[-1] + (pts[-1] - pts[-2])]
    out = []
    segs = len(pts) - 1
    for i in range(count):
        t = i / (count - 1) * segs
        k = min(int(t), segs - 1)
        f = t - k
        p0, p1, p2, p3 = ext[k], ext[k + 1], ext[k + 2], ext[k + 3]
        f2, f3 = f * f, f * f * f
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * f
                          + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * f3))
    return out


def lerp_radii(radii, count):
    if len(radii) == 1:
        return [radii[0]] * count
    out = []
    segs = len(radii) - 1
    for i in range(count):
        t = i / (count - 1) * segs
        k = min(int(t), segs - 1)
        f = t - k
        out.append(radii[k] * (1 - f) + radii[k + 1] * f)
    return out


def make_curve(name, points, radii, material, samples=48, bevel=1.0,
               bevel_object=None, tilt=0.0, caps=True, res_u=1, res_v=4):
    co = resample(points, samples)
    rad = lerp_radii(radii, samples)
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = res_u
    data.bevel_resolution = res_v
    data.use_fill_caps = caps
    if bevel_object is not None:
        data.bevel_mode = "OBJECT"
        data.bevel_object = bevel_object
    else:
        data.bevel_depth = bevel
    spline = data.splines.new("NURBS")
    spline.points.add(len(co) - 1)
    for i, (p, r) in enumerate(zip(co, rad)):
        spline.points[i].co = (p.x, p.y, p.z, 1.0)
        spline.points[i].radius = r
        spline.points[i].tilt = tilt
    spline.order_u = 4
    spline.use_endpoint_u = True
    obj = link(bpy.data.objects.new(name, data))
    obj.data.materials.append(material)
    return obj


def jitter(points, amount, freq=1.0, offset=0.0, taper_ends=True):
    """Organic wander applied to a polyline using coherent noise."""
    out = []
    n = len(points)
    for i, p in enumerate(points):
        v = Vector(p)
        w = 1.0
        if taper_ends:
            t = i / max(1, n - 1)
            w = math.sin(math.pi * min(1.0, max(0.0, t))) ** 0.6
        seed_v = Vector((v.x * freq + offset, v.y * freq + offset * 1.7, v.z * freq))
        d = noise.noise_vector(seed_v)
        out.append(v + d * amount * w)
    return out


def ribbon(name, points, half_widths, material, thickness=0.34, scoop=0.55,
           plane_normal=(0.0, 1.0, 0.0), samples=72, sections=14, twist=0.0):
    """A flat, scooped deadwood blade.

    The reference jin are not round horns: they are wide in the plane of their sweep, thin
    across it, hollowed on the inner face, and they taper to a needle point. A curve bevel
    cannot express that, so the cross-sections are built directly.
    """
    co = resample(points, samples)
    wid = lerp_radii(half_widths, samples)
    pn = Vector(plane_normal).normalized()

    verts, faces = [], []
    ring_len = sections
    for i in range(samples):
        a = co[max(0, i - 1)]
        b = co[min(samples - 1, i + 1)]
        t = (b - a).normalized()
        wide = pn.cross(t)
        if wide.length < 1e-5:
            wide = Vector((1, 0, 0)).cross(t)
        wide.normalize()
        thin = t.cross(wide).normalized()
        # twisting the section along the blade stops it reading as a flat paddle
        ang_t = twist * (i / (samples - 1))
        ct, st = math.cos(ang_t), math.sin(ang_t)
        wide, thin = wide * ct + thin * st, thin * ct - wide * st
        w = wid[i]
        th = w * thickness
        for k in range(ring_len):
            ang = k / ring_len * math.tau
            c, sn = math.cos(ang), math.sin(ang)
            # asymmetric section: the inner face is scooped out
            off = wide * (w * c) + thin * (th * sn - th * scoop * (c * c))
            verts.append(co[i] + off)

    for i in range(samples - 1):
        for k in range(ring_len):
            k2 = (k + 1) % ring_len
            faces.append([i * ring_len + k, i * ring_len + k2,
                          (i + 1) * ring_len + k2, (i + 1) * ring_len + k])
    # caps
    faces.append(list(range(ring_len - 1, -1, -1)))
    base = (samples - 1) * ring_len
    faces.append([base + k for k in range(ring_len)])

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.validate()
    mesh.materials.append(material)
    obj = link(bpy.data.objects.new(name, mesh))
    return obj


def fuse(objects, name, voxel, adaptivity=0.18, smooth_iters=2):
    """Convert curves to mesh, join, and voxel-remesh into one continuous surface."""
    if not objects:
        return None
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.convert(target="MESH")

    target = bpy.context.view_layer.objects.active
    if len(objects) > 1:
        bpy.ops.object.join()
        target = bpy.context.view_layer.objects.active
    target.name = name

    activate(target)
    mod = target.modifiers.new("fuse", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = voxel
    mod.adaptivity = adaptivity
    mod.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=mod.name)

    if smooth_iters:
        sm = target.modifiers.new("relax", "SMOOTH")
        sm.factor = 0.55
        sm.iterations = smooth_iters
        bpy.ops.object.modifier_apply(modifier=sm.name)

    bpy.ops.object.shade_smooth()
    return target


# --------------------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------------------

reset_scene()
scene = bpy.context.scene

MAT_LIVING = wood_material(
    "WT Living Wood",
    # colours measured from the reference trunk: warm brown grooves, taupe body, pale ridges
    pale=(0.64, 0.55, 0.40), mid=(0.12, 0.080, 0.042), crevice=(0.018, 0.011, 0.006),
    roughness=0.60, cavity_strength=0.92,
)
MAT_DEAD = wood_material(
    "WT Deadwood",
    # bleached: in the reference the jin is clearly paler than the trunk, with only the
    # deepest cracks going dark, so most fibres sit at the pale end and grooves darken less
    # pushed further than the Blender renders need: Grove's dim warm lighting compresses the
    # difference between the two woods, so the bake has to carry more of it
    pale=(0.93, 0.91, 0.84), mid=(0.62, 0.59, 0.50), crevice=(0.09, 0.075, 0.05),
    roughness=0.68, cavity_strength=0.38, spec=0.24, tone_offset=0.82,
)
# Canopy branches are thin and dark in the reference, mostly hidden in the leaves. Sharing the
# trunk material made them read as pale horns sticking out of the pads.
MAT_BRANCH = wood_material(
    "WT Branch Wood",
    pale=(0.26, 0.20, 0.13), mid=(0.07, 0.05, 0.03), crevice=(0.015, 0.010, 0.006),
    roughness=0.65, cavity_strength=0.8,
)
MAT_GLOW = glow_material("WT Heart Glow", (0.110, 1.000, 0.290), 46.0)
MAT_GLOW_SOFT = glow_material("WT Root Glow", (0.005, 0.980, 0.100), 5.0)
MAT_HALO = halo_material("WT Glow Halo", (0.008, 0.780, 0.075), 3.0)
MAT_LEAF = [
    leaf_material("WT Leaf Deep", (0.026, 0.112, 0.048), 0.30),
    leaf_material("WT Leaf Mid", (0.018, 0.22, 0.07), 0.38),
    leaf_material("WT Leaf Light", (0.05, 0.40, 0.14), 0.46),
]
MAT_FLOOR = flat_material("WT Floor", (0.046, 0.046, 0.046), 0.70)

# flattened bevel profile for wind-carved deadwood ribbons
prof = bpy.data.curves.new("jin profile", "CURVE")
prof.dimensions = "2D"
sp = prof.splines.new("NURBS")
sp.points.add(11)
for i in range(12):
    a = i / 12 * math.tau
    sp.points[i].co = (math.cos(a) * 1.18, math.sin(a) * 0.28, 0, 1)
sp.use_cyclic_u = True
sp.order_u = 3
JIN_PROFILE = link(bpy.data.objects.new("jin profile", prof))
JIN_PROFILE.hide_render = True
JIN_PROFILE.hide_viewport = True

# Anatomy follows explicit root-to-crown flows traced in front-plate pixels.
# Depth is authored per continuous flow, with real open spaces between strands.
#
# DEPTH_SCALE turns each flow's authored depth value into metres. It was 0.55, and at that value
# the braid was only about a metre thick front to back: orbiting in Grove, the strands lined up
# behind one another and the tree read as a cut-out. The left reference plate shows the braid
# nearly as wide as the front one does. Depth cannot change the front outline, so this is free
# as far as the front match is concerned.
DEPTH_SCALE = .80
# How far the whole tree leans away in depth as it goes right: canopy toward +Y, deadwood toward
# -Y, which is what the left plate shows.
DEPTH_SHEAR = .72
# The braid is thicker in depth low down, where the reference trunk is broadest from the side,
# and narrows towards the crown so the canopy boughs still meet where the plates put them.
def depth_swell(z):
    return 1.0 + .25 * max(0.0, min(1.0, (2.6 - z) / 2.0))

def plate_raw(points, depth=0):
    out = []
    for p in points:
        x, z = p[:2]
        y = p[2] if len(p) > 2 else depth
        wx = (x-384)*8.1/768-.05
        wz = 2.45+(256-z)*8.1/768
        out.append(Vector((wx, y*DEPTH_SCALE*depth_swell(wz) - wx*DEPTH_SHEAR, wz)))
    return out


# The spiral. Traced from two plates, everything in the tree lay close to one vertical plane: the
# line from the canopy (-X, +Y) to the deadwood (+X, -Y). Looking along that line, the tiers and
# hooks stacked behind one another into a column. A real bonsai is styled the other way: branches
# leave the trunk in a spiral, each tier pointing a different way, so it has depth from any side.
#
# So each horizontal slice of the tree is turned about the trunk's own centre by an angle that
# changes with height. The trunk strands wind round one another as they climb, and the tiers and
# deadwood hooks fan out to different sides. Base and roots are not turned. Radians, by height in
# metres; values in between are eased.
TWIST_KEYS = [(0.0, 0.0), (0.9, 0.0), (1.7, .42), (2.45, .90), (3.1, .12), (3.7, -.80), (4.3, -.42), (4.8, -.2)]


def twist_at(z):
    if z <= TWIST_KEYS[0][0]:
        return TWIST_KEYS[0][1]
    for (z0, a0), (z1, a1) in zip(TWIST_KEYS, TWIST_KEYS[1:]):
        if z <= z1:
            t = (z - z0) / (z1 - z0)
            t = t * t * (3 - 2 * t)
            return a0 + (a1 - a0) * t
    return TWIST_KEYS[-1][1]


TRUNK_AXIS = []  # (z, x, y) samples of the untwisted trunk centre, filled once the flows exist


def axis_at(z):
    if not TRUNK_AXIS:
        return Vector((0.0, 0.0))
    if z <= TRUNK_AXIS[0][0]:
        return Vector(TRUNK_AXIS[0][1:])
    for a, b in zip(TRUNK_AXIS, TRUNK_AXIS[1:]):
        if z <= b[0]:
            t = (z - a[0]) / max(1e-6, b[0] - a[0])
            return Vector(a[1:]).lerp(Vector(b[1:]), t)
    return Vector(TRUNK_AXIS[-1][1:])


def twisted(v):
    angle = twist_at(v.z)
    if abs(angle) < 1e-6:
        return v.copy()
    c = axis_at(v.z)
    dx, dy = v.x - c.x, v.y - c.y
    ca, sa = math.cos(angle), math.sin(angle)
    return Vector((c.x + dx * ca - dy * sa, c.y + dx * sa + dy * ca, v.z))


def plate(points, depth=0):
    return [twisted(v) for v in plate_raw(points, depth)]

wood_parts=[]
glow_parts=[]
branch_parts=[]
fine_parts=[]

# How the braided wood surface is sculpted. Each strand in the reference is itself a bundle of
# rounded fibres with narrow dark grooves between them, broken by short cracks along the grain.
# That relief has to be real geometry: the bark colour is baked into vertex colours, and painted
# detail finer than the mesh is averaged away by the bake.
CORD_GROOVE_DEPTH = .26   # how deep the grooves between fibres cut, as a share of strand radius
CRACK_DEPTH = .08         # short checks along the grain
TWIST_PER_METRE = 1.6     # radians; how quickly the fibres spiral round the strand
STRAND_DEPTH_FATNESS = 1.35  # big strands' depth relative to their width
GLOW_WASH_WIDTH = .035    # metres; how far the soft light spreads either side of a vein
INNER_GLOW = .55          # `_glow` deep in a groove, low on the trunk: the light from inside


def cord_surface(c, a, along, twist, cords, phase):
    """Radius multiplier, groove amount (0 on a fibre's crest, 1 deep in a groove or crack)
    and tone streak at angle `a` round the strand, `along` metres from its base.

    Every pattern is sampled in the strand's own (along, around) space, so streaks and cracks
    always run with the grain whichever way the strand points. Shared by the mesh and the glow
    channels so the channels can sit exactly in the grooves instead of floating over them."""
    # |sin| gives rounded crests with sharp V-shaped valleys between them, like twisted cord.
    # The fibres vary in width, so the angle is nudged by slow noise before it is used.
    wobble = .35 * noise.noise(Vector((along * .9, phase * 3, 0)))
    crest = abs(math.sin(cords * (a - twist + wobble / cords) / 2)) ** .6
    # a ring round the strand in noise space: radius 2 gives about a dozen features around it
    ring = Vector((math.cos(a) * 2.0, math.sin(a) * 2.0, phase * 7))
    # cracks: stretched along the strand (coarse along, fine around) so they come out as dashes
    crack_noise = noise.noise(ring * 1.6 + Vector((0, 0, along * 3.2)))
    crack = min(1.0, max(0.0, (crack_noise - .30) / .12)) * crest
    # each fibre gets its own shade, which is what makes the reference read as streaked wood
    # rather than a painted surface; slower noise on top keeps whole regions from matching
    fibre = math.floor(cords * (a - twist + wobble / cords) / math.tau)
    fibre_tone = noise.noise(Vector((fibre * 3.1 + phase, along * .4, 0)))
    tone = (.90 * fibre_tone
            + .35 * noise.noise(ring * .7 + Vector((along * .9, 0, 0)))
            + .20 * noise.noise(ring * 1.8 + Vector((0, along * 2.2, 0))))
    lumps = .03 * noise.noise(ring * .8 + Vector((0, 0, along * 4)))
    factor = 1.06 - CORD_GROOVE_DEPTH * (1 - crest) - CRACK_DEPTH * crack + lumps
    # mathutils noise rarely leaves +-0.5, so the streaks are stretched to use the full range
    return factor, max(1 - crest, crack), max(-.5, min(.5, tone * 1.7))


def carved(name, controls, radii, material, glow=False, phase=0, tip_glow=False):
    # Big strands get the dense surface the eye lands on; thin roots stay cheap.
    big = max(radii) > .15
    rings, sides = (150, 64) if big else (70, 24)
    cords = (9 if big else 5) + int(phase * 10) % 3
    co=resample(controls, rings)
    rr=lerp_radii(radii,rings)
    vertices=[]; faces=[]; grooves=[]; tones=[]
    frames=[]; twists=[]; alongs=[]
    along=0.0
    for i,(c,r) in enumerate(zip(co,rr)):
        if i: along += (c-co[i-1]).length
        alongs.append(along)
        tangent=(co[min(i+1,rings-1)]-co[max(0,i-1)]).normalized()
        u=tangent.cross(Vector((0,1,0))).normalized()
        if u.length<.01: u=tangent.cross(Vector((1,0,0))).normalized()
        v=tangent.cross(u).normalized()
        # a slightly flattened, wandering section keeps strands from reading as perfect tubes
        u=u*(1+.07*math.sin(along*2.4+phase))
        # Big strands are deeper front-to-back than they are wide. `v` lies close to the depth
        # axis, so this adds mass seen from the side without touching the front outline. Spreading
        # the strands further apart in depth instead turned the trunk into a cage.
        if big: v=v*STRAND_DEPTH_FATNESS
        frames.append((u,v))
        twist = phase + along*TWIST_PER_METRE + .3*math.sin(along*1.7+phase)
        twists.append(twist)
        for j in range(sides):
            a=j*math.tau/sides
            factor, groove, tone = cord_surface(c, a, along, twist, cords, phase)
            vertices.append(c+r*factor*(u*math.cos(a)+v*math.sin(a)))
            grooves.append(groove); tones.append(tone)
    for i in range(rings-1):
        for j in range(sides):
            a=i*sides+j; b=i*sides+(j+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces.extend([tuple(reversed(range(sides))),tuple((rings-1)*sides+j for j in range(sides))])
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(vertices,[],faces); mesh.materials.append(material)

    def on_surface(i, a, lift):
        """A point on the sculpted surface, pushed out by `lift` so glow is not buried."""
        factor, _, _ = cord_surface(co[i], a, alongs[i], twists[i], cords, phase)
        u,v=frames[i]
        return co[i]+(rr[i]*factor+lift)*(u*math.cos(a)+v*math.sin(a))

    # Veins run along the crest of a fibre, so they spiral with the braid the way they do in the
    # reference and stay visible from the side; laid in the grooves they were hidden by the
    # fibres either side. Each channel is an angle per ring: the twist plus a fixed fibre.
    channels=[]
    # One faint line per glowing strand, where there used to be three plus a dozen branching
    # veins. The light is meant to read as coming from inside the tree, through the grooves
    # (see `washes` below), with only a line or two on the surface.
    if glow:
        starts=(-math.pi/2,)
        for start in starts:
            groove_index=round(cords*(start+phase*.15-twists[0])/math.tau)
            channels.append([twists[i]+(groove_index+.5)*math.tau/cords for i in range(rings)])

    # How strongly the wood itself glows at each vertex: a soft band either side of every vein,
    # plus a faint overall glow low on the trunk, where the reference is brightest. Grove turns
    # this into light on the bark that pulses with the heartbeat.
    washes=[]
    for i in range(rings):
        low=1-min(1,max(0,(co[i].z-.8)/2.2))*.7
        for j in range(sides):
            a=j*math.tau/sides
            near=0.0
            for angles in channels:
                d=abs((a-angles[i]+math.pi)%math.tau-math.pi)*rr[i]
                near=max(near,math.exp(-(d/GLOW_WASH_WIDTH)**2))
            # Light from inside: the deep grooves between fibres glow, most strongly low on the
            # trunk, as if the braid were lit from within and the light leaked out of the cracks.
            inner=INNER_GLOW*grooves[i*sides+j]**1.6*low*(1 if big else .5)
            wash=max(inner,near*.55*low)
            if tip_glow:
                # Roots light up towards their tips, all the way round, so by the time a root
                # hands over to the mycelium it is already the same light. This is what makes the
                # join seamless rather than a brown stick touching a green line.
                t=i/(rings-1)
                ramp=max(0.0,min(1.0,(t-.40)/.60))
                wash=max(wash,ROOT_TIP_GLOW*ramp*ramp*(3-2*ramp))
            washes.append(wash)

    # The wood shader reads these to colour the grain exactly where the geometry carves it.
    mesh.attributes.new('groove','FLOAT','POINT').data.foreach_set('value',grooves)
    mesh.attributes.new('tone','FLOAT','POINT').data.foreach_set('value',tones)
    # The leading underscore is what makes the glTF exporter keep a custom attribute.
    mesh.attributes.new('_glow','FLOAT','POINT').data.foreach_set('value',washes)
    ob=link(bpy.data.objects.new(name,mesh)); wood_parts.append(ob)
    for f in mesh.polygons:f.use_smooth=True

    # A local generator, so adding veins here cannot shift the random roots built later.
    local=random.Random(int(phase*1000)+rings)
    for angles in channels:
        radius=[max(.0008,min(.007,r*.035))*math.sin(math.pi*(.04+.92*i/(rings-1))) for i,r in enumerate(rr)]
        if tip_glow:
            # a root's line runs right to the tip, where the mycelium picks it up
            radius=[max(.0015,min(.007,r*.035)) for r in rr]
        line=[on_surface(i, angles[i], radius[i]*.5) for i in range(rings)]
        glow_parts.append(make_curve(name+' channel',line,radius,MAT_GLOW_SOFT,samples=64,res_v=2))
        # Fine veins branch off and climb over the neighbouring fibre, alternating sides, so the
        # channels read as a network rather than isolated stripes.
        for f in range(0):
            first=int(local.uniform(.08,.85)*(rings-1)); span=max(6,rings//local.choice((6,8,10)))
            side=1 if f%2 else -1
            climb=(math.tau/cords)*local.uniform(.6,1.4)
            line=[]
            for step in range(span):
                i=min(rings-1,first+step)
                t=step/(span-1)
                line.append(on_surface(i,angles[i]+side*climb*(t**.7),.002))
            glow_parts.append(make_curve(name+' vein',line,[.004,.0028,.0006],MAT_GLOW_SOFT,samples=20,res_v=2))
    return ob

# The deadwood flows (3, 4, 5) end with their tips pulled back in depth: the left plate shows
# the hooks staying close to the trunk, and depth changes cannot alter the front outline.
flows=[
 ([(294,486,-.50),(337,443,-.48),(360,390,-.48),(435,347,-.35),(492,298,-.12),(476,260,.05),(415,231,.25),(387,190,.45),(380,144,.60),(345,104,.68),(345,54,.7)],[.045,.16,.22,.24,.25,.22,.18,.16,.11,.07,.005]),
 ([(456,487,-.1),(400,451,-.38),(398,408,-.60),(448,370,-.64),(505,339,-.54),(511,288,-.32),(469,252,-.18),(418,220,.04),(403,171,.35),(377,122,.6)],[.025,.14,.22,.25,.24,.20,.16,.13,.10,.018]),
 ([(243,485,.18),(302,458,.22),(347,408,.25),(406,372,.38),(461,344,.42),(479,301,.50),(450,264,.55),(383,227,.65),(346,193,.75),(317,168,.90)],[.008,.10,.15,.20,.21,.19,.16,.14,.09,.008]),
 ([(523,485,.6),(474,457,.42),(458,411,.30),(477,367,.15),(523,320,.1),(553,271,.05),(551,234,.05),(569,205,.15),(616,203,.35),(658,180,.45)],[.008,.10,.16,.21,.20,.20,.19,.14,.10,.001]),
 ([(346,490,-.7),(372,447,-.75),(408,402,-.78),(464,375,-.82),(528,343,-.83),(590,330,-.55),(635,306,-.1),(670,260,.2)],[.012,.11,.18,.22,.23,.16,.09,.001]),
 ([(390,487,.80),(375,439,.72),(401,392,.62),(466,359,.58),(528,335,.49),(584,348,.55),(630,337,.75),(659,307,.95)],[.01,.14,.18,.22,.20,.14,.08,.001]),
 # Ends in the braid now. It used to arch out over the top and finish, still thick, inside a
 # deadwood hook, which read as a living branch growing out of dead wood.
 ([(571,484,1.0),(495,457,.95),(463,419,.9),(449,369,.8),(460,320,.7),(432,274,.72),(410,236,.74),(398,205,.72)],[.005,.075,.12,.13,.14,.12,.08,.01]),
]
flows.extend([
 ([(321,484,-.3),(366,443,-.4),(385,400,-.62),(450,359,-.45),(480,325,.16),(467,287,.46),(433,259,.2),(394,228,-.15),(360,196,.3)],[.01,.075,.11,.12,.13,.12,.10,.07,.005]),
 ([(484,485,.5),(427,453,.28),(421,411,-.1),(479,374,-.36),(538,340,-.7),(572,325,-.75),(600,305,-.7),(624,286,-.65)],[.007,.085,.11,.12,.095,.07,.04,.001]),
])
# The trunk centre the spiral turns about: the mean of the two main living flows, untwisted.
_axis_a = resample(plate_raw(flows[0][0]), 60)
_axis_b = resample(plate_raw(flows[1][0]), 60)
TRUNK_AXIS.extend(sorted(((a.z + b.z) / 2, (a.x + b.x) / 2, (a.y + b.y) / 2) for a, b in zip(_axis_a, _axis_b)))

for i,(pts,rr) in enumerate(flows):
    carved('Anatomical flow %02d'%i,plate(pts),rr,MAT_DEAD if i in (3,4,5) else MAT_LIVING,i in (0,2),i*.7)
# Low living branch curls out of the main braid and supports the detached low pad.
carved('Low left bough',plate([(395,381,-.45),(427,334,-.5),(417,300,-.45),(385,286,-.38),(350,297,-.2),(309,277,.0),(273,259,.2)]),[.12,.115,.10,.095,.07,.045,.006],MAT_LIVING,False)
# Roots descend from the braid, bend across the ground and divide recursively.
# Uneven angular spacing and branch length avoid the previous conical root skirt.
ROOT_TIP_RADIUS = .016
ROOT_TIP_GLOW = 1.6   # `_glow` at a root tip; Grove's mycelium core is about this bright at rest
ROOT_TIPS = []
ROOTLET_TIPS = []
for i in range(19):
    a=i*math.tau/19+rng.uniform(-.09,.09)
    start=Vector((.12+math.cos(a)*.25,.08+math.sin(a)*.22,.65+rng.uniform(-.12,.22)))
    reach=rng.uniform(1.10,1.65)
    direction=Vector((math.cos(a),math.sin(a),0))
    side=Vector((-math.sin(a),math.cos(a),0))
    tip=direction*reach+Vector((.12,.08,.035))
    pts=[start,start.lerp(tip,.25)+side*rng.uniform(-.16,.16)+Vector((0,0,-.13)),
         start.lerp(tip,.53)+side*rng.uniform(-.12,.12)+Vector((0,0,-.13)),
         start.lerp(tip,.79)+side*.05+Vector((0,0,-.09)),tip]
    # Every root carries a vein now, and ends at a hand-off radius instead of a needle point:
    # Grove continues each one as a thinner strand of wood and then as the mycelium, starting
    # exactly at this tip and leaving in this direction. See ROOT_TIPS below.
    carved('Root %02d'%i,pts,[.13,.10,.058,.030,ROOT_TIP_RADIUS],MAT_LIVING,True,i,tip_glow=True)
    ROOT_TIPS.append((tip.copy(),(tip-pts[3]).normalized(),ROOT_TIP_RADIUS))
    for j in (-1,1):
        split=pts[2].lerp(pts[3],rng.uniform(.1,.6))
        end=tip+side*j*rng.uniform(.12,.30)+direction*rng.uniform(.08,.35)
        end.z=.02
        mid=split.lerp(end,.5)+side*j*.06;mid.z=.04
        fine_parts.append(make_curve('Root fork',[split,mid,end],[.031,.017,.0015],MAT_LIVING,samples=25,res_v=2))
        ROOTLET_TIPS.append((end.copy(),(end-mid).normalized()))
        for k in (-1,1):
            last=end+direction*rng.uniform(.12,.24)+side*k*rng.uniform(.07,.16)
            last.z=.016
            fine_parts.append(make_curve('Fine root fork',[mid,mid.lerp(last,.63)+side*k*.04,last],[.012,.006,.0008],MAT_LIVING,samples=18,res_v=1))
            ROOTLET_TIPS.append((last.copy(),(last-mid).normalized()))

# Visible buttress roots are individually directed from the reference's front base.
front_roots=[
 [(360,411,-.35),(345,436,-.35),(328,457,-.3),(297,471,-.2),(269,481,-.12)],
 [(381,402,-.6),(370,433,-.62),(358,453,-.62),(348,475,-.6),(324,488,-.5)],
 [(403,417,-.65),(397,442,-.75),(413,463,-.8),(442,479,-.9),(469,488,-.9)],
 [(428,402,-.32),(433,438,-.4),(451,457,-.5),(481,471,-.4),(510,485,-.3)],
 [(462,404,.2),(461,435,.18),(481,451,.12),(518,465,.08),(546,480,0)],
 [(343,434,.2),(318,448,.24),(299,462,.2),(270,467,.24),(238,483,.2)],
]
for i,pts in enumerate(front_roots):
    carved('Front buttress %02d'%i,plate(pts),[.105,.095,.07,.045,.002],MAT_LIVING,False,i*.8)

# Separated, irregular foliage islands match the reference plate tiers.
pad_specs=[
 (333,38,72,18,.70),(315,74,106,18,.78),(244,106,91,18,.87),
 (411,87,76,17,.65),(479,124,74,17,.45),
 # the first is tucked in from the traced (186,193,.95): seen from the side its bough stuck out
 (222,190,70,19,.60),(271,166,74,17,.75),(300,193,64,16,.58),
 (242,251,62,18,.4),(310,259,70,17,.28),
]
# pad size front-to-back relative to side-to-side, read off the left plate
PAD_DEPTH_RATIO = .86
PADS=[]
for i,(x,z,width,height,y) in enumerate(pad_specs):
    c=plate([(x,z,y)])[0];rx=width*8.1/768;ry=rx*PAD_DEPTH_RATIO
    PADS.append((c,rx,ry,height*8.1/768*.57,.72))
    attach=plate([(350 if z<100 else (380 if z<150 else 375),112 if z<100 else (155 if z<150 else 224),.55)])[0]
    if z>235:attach=plate([(309,277,0)])[0]
    branch_parts.append(make_curve('Supporting bough', [attach,attach.lerp(c,.35)-Vector((0,.02,.18)),attach.lerp(c,.68)+Vector((0,.03,.025)),c-Vector((0,0,.14))],[.045,.028,.014],MAT_BRANCH,samples=30,res_v=3))
    for k in range(9):
        # Twigs spread from just under the pad's own centre and stop well inside its rim, so they
        # sit hidden in the underside. Starting them back along the bough made a fan of parallel
        # sticks hanging out below the foliage.
        a=k*math.tau/9+.4
        tip=c+Vector((math.cos(a)*rx*.62,math.sin(a)*ry*.62,-.06))
        hub=c-Vector((0,0,.14))
        branch_parts.append(make_curve('Canopy ramification',[hub,hub.lerp(tip,.55)+Vector((0,0,.02)),tip],[.02,.012,.002],MAT_BRANCH,samples=16,res_v=2))

# Pads all round the trunk. The traced tiers all hang to one side, which is right from the
# front and wrong from anywhere else: turn the tree and the canopy vanished behind the trunk.
# These sit out to either side of the canopy-to-deadwood line, at heights between the traced
# tiers, which is where a bonsai grower would have styled the back and side branches. From the
# front they mostly overlap the traced pads, so the home view keeps its composition.
ACROSS = Vector((.58, .81, 0))   # square to the canopy-to-deadwood line, on the ground
def across(degrees):
    return Matrix.Rotation(math.radians(degrees), 3, 'Z') @ ACROSS
extra_pads=[
 # attach point on the trunk (plate pixels), direction, distance (m), height offset (m), radius (m)
 ((380,155,.55), across(12), 1.18, -.05, .68),
 ((375,224,.55), -across(8), 1.22, -.12, .72),
 ((350,112,.55), across(-28), 1.10, .06, .60),
 ((350,112,.55), -across(24), 1.05, .12, .58),
 ((395,290,.1), across(30), .80, .10, .56),   # tucked in: it hung out on a long bare branch
 ((380,190,.4), -across(-40), 1.10, -.02, .58),
 ((400,250,.3), across(-15), .95, .08, .55),
 ((370,140,.5), -across(60), 1.10, .0, .52),
 # The back of the crown (+Y, away from the home camera) was thin: bare boughs between pads.
 ((360,120,.6), Vector((0,1,0)), 1.05, .10, .62),
 ((375,175,.5), Vector((-.5,.87,0)), 1.05, .0, .60),
 ((370,150,.5), Vector((.45,.9,0)), 1.00, -.04, .56),
 ((355,95,.6), Vector((-.2,.98,0)), .70, .22, .52),
 ((380,205,.45), Vector((.1,1,0)), 1.02, -.10, .58),
]
for attach_px, direction, distance, lift, rx in extra_pads:
    attach=plate([attach_px])[0]
    c=attach+direction*distance+Vector((0,0,lift))
    ry=rx*PAD_DEPTH_RATIO
    PADS.append((c,rx,ry,.1,.72))
    branch_parts.append(make_curve('Supporting bough', [attach,attach.lerp(c,.35)-Vector((0,.02,.16)),attach.lerp(c,.68)+Vector((0,.03,.025)),c-Vector((0,0,.14))],[.05,.03,.014],MAT_BRANCH,samples=30,res_v=3))
    for k in range(7):
        # Twigs spread from just under the pad's own centre and stop well inside its rim, so they
        # sit hidden in the underside. Starting them back along the bough made a fan of parallel
        # sticks hanging out below the foliage.
        a=k*math.tau/7+.4
        tip=c+Vector((math.cos(a)*rx*.62,math.sin(a)*ry*.62,-.06))
        hub=c-Vector((0,0,.14))
        branch_parts.append(make_curve('Canopy ramification',[hub,hub.lerp(tip,.55)+Vector((0,0,.02)),tip],[.02,.012,.002],MAT_BRANCH,samples=16,res_v=2))

# A solid core of wood up the inside of the braid. The strands wander apart as they twist, and
# the gaps between them used to show a glowing core as flat green panels. Filling them with wood
# keeps the trunk a solid mass; the light now comes only from its grooves (`INNER_GLOW`).
_core=[]
for k in range(12):
    z=.35+k*(3.2-.35)/11
    c=axis_at(z)
    _core.append(Vector((c.x,c.y,z)))
carved('Inner core',_core,[.18,.25,.27,.25,.21,.15],MAT_LIVING,False,4.2)

def join_parts(parts,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]
    bpy.ops.object.convert(target='MESH');bpy.ops.object.join()
    ob=bpy.context.object;ob.name=name
    return ob
WOOD=join_parts(wood_parts,'WorldTree Carved Anatomy')
JIN=WOOD
FINE=join_parts(fine_parts,'WorldTree Rootlets')
GLOW=join_parts(glow_parts,'WorldTree Continuous Channels')
BRANCHES=join_parts(branch_parts,'WorldTree Canopy Branches')

def leaf_shape(lobes, lobe_depth, cup, aspect, steps=6):
    verts = [Vector((0.0, -0.15, 0.0))]
    for i in range(steps):
        a = -math.pi * 0.5 + math.pi * 2.0 * i / steps
        r = 1.0 + 0.035 * math.cos(lobes * (a + math.pi * 0.5))
        x = math.cos(a) * r * aspect
        y = math.sin(a) * r * .38
        verts.append(Vector((x, y, -cup * (x * x + y * y * 0.4))))
    faces = [[0, i + 1, (i + 1) % steps + 1] for i in range(steps)]
    return verts, faces


def sprig_templates(count=16):
    out = []
    for _ in range(count):
        verts, faces = [], []
        leaves = rng.randint(5, 8)
        for k in range(leaves):
            lv, lf = leaf_shape(rng.choice((3, 5, 5, 7)), rng.uniform(0.22, 0.40),
                                rng.uniform(0.10, 0.26), rng.uniform(0.95, 1.35))
            spin = rng.uniform(0, math.tau) if k == 0 else (k / leaves) * math.tau + rng.uniform(-0.3, 0.3)
            mtx = (Matrix.Rotation(spin, 4, "Z")
                   @ Matrix.Translation(Vector((rng.uniform(0.35, 0.95), 0.0, rng.uniform(-0.18, 0.18))))
                   @ Matrix.Rotation(rng.uniform(0.15, 0.85), 4, "Y")
                   @ Matrix.Rotation(rng.uniform(-0.4, 0.4), 4, "X")
                   @ Matrix.Diagonal((0.55, 0.55, 0.55, 1.0)))
            base = len(verts)
            verts.extend([mtx @ v for v in lv])
            faces.extend([[base + i for i in f] for f in lf])
        out.append((verts, faces))
    return out


TEMPLATES = sprig_templates()

# How the canopy pads are built.
#
# The previous pads scattered sprigs through a thin disc, about ten centimetres thick. From the
# front camera that read fine, but from any other angle each tier was a flat plate. The reference
# pads are cumulus clouds: every tier is a cushion of rounded clumps, lit on top, dark in the
# gaps between them and underneath. So each pad is now a set of flattened spheres, domed higher
# in the middle, and the sprigs sit on the surface of each sphere facing outward. The bumps
# are what make the pad read as a solid mass from the side.
SPRIG_BUDGET = 5600        # total sprigs; the foliage cost scales with this, ~39 triangles each
CLUMP_RADIUS = (.19, .31)  # metres
CLUMP_SQUASH = .72         # clumps are wider than tall, like the reference
PAD_DOME = .26             # how much higher the centre clumps sit than the rim ones


def pad_clumps(c, rx, ry):
    """Clump centres and radii for one pad: a domed upper layer plus a darker underside."""
    area = math.pi * rx * ry
    count = max(7, int(area / .11))
    clumps = []
    for k in range(count):
        # sunflower spiral spacing keeps clumps evenly spread without a visible grid
        u = math.sqrt((k + .5) / count) * rng.uniform(.9, 1.0)
        a = k * 2.39996 + rng.uniform(-.25, .25)
        r = rng.uniform(*CLUMP_RADIUS) * (1.0 - .25 * u)
        dome = PAD_DOME * math.cos(min(1.0, u) * math.pi * .5) ** .8
        centre = c + Vector((math.cos(a) * rx * u * .88, math.sin(a) * ry * u * .88, dome - .02))
        clumps.append((centre, r, 1.0 - .45 * u))
    # the underside: fewer, lower clumps, which fill the pad in so light cannot see through it
    for k in range(max(3, count // 3)):
        u = math.sqrt(rng.random()) * .7
        a = rng.uniform(0, math.tau)
        centre = c + Vector((math.cos(a) * rx * u, math.sin(a) * ry * u, -.14))
        clumps.append((centre, rng.uniform(*CLUMP_RADIUS) * .9, .0))
    return clumps


pad_sets = []
for c, rx, ry, th, dens in PADS:
    pad_sets.append(pad_clumps(c, rx, ry))
surface = sum(r * r * (.35 + .65 * height) for clumps in pad_sets for _, r, height in clumps)

all_v, all_f, all_m = [], [], []
for clumps in pad_sets:
    for centre, radius, height in clumps:
        n = max(3, int(SPRIG_BUDGET * radius * radius * (.35 + .65 * height) / surface))
        for _ in range(n):
            # Outward direction, biased upward: the underside of a clump is hidden by the one
            # below it, so sprigs spent there would be invisible triangles.
            nz = rng.uniform(-.35, 1.0) if rng.random() < .25 else rng.uniform(.1, 1.0) ** .7
            a = rng.uniform(0, math.tau)
            ring = math.sqrt(max(0.0, 1 - nz * nz))
            normal = Vector((math.cos(a) * ring, math.sin(a) * ring, nz))
            offset = normal * radius * rng.uniform(.80, 1.04)
            offset.z *= CLUMP_SQUASH
            p = centre + offset
            p += noise.noise_vector(p * 3.1) * .025
            s = rng.uniform(.050, .080)
            orient = normal.to_track_quat("Z", "Y").to_matrix().to_4x4()
            mtx = (Matrix.Translation(p) @ orient
                   @ Matrix.Rotation(rng.uniform(0, math.tau), 4, "Z")
                   @ Matrix.Rotation(rng.uniform(-.35, .35), 4, "X")
                   @ Matrix.Diagonal((s * rng.uniform(.9, 1.25), s * rng.uniform(.9, 1.25), s, 1.0)))
            verts, faces = TEMPLATES[rng.randrange(len(TEMPLATES))]
            base = len(all_v)
            all_v.extend([mtx @ v for v in verts])
            # Lit where the clump faces the sky and sits high in the pad; deep where it turns
            # under or sits in the underside layer. That split is what draws each bump.
            light = .6 * nz + .5 * height + rng.uniform(-.18, .18)
            mi = 2 if light > .78 else (1 if light > .32 else 0)
            for f in faces:
                all_f.append([base + k for k in f])
                all_m.append(mi)

leaf_mesh = bpy.data.meshes.new("WorldTree Foliage")
leaf_mesh.from_pydata([tuple(v) for v in all_v], [], all_f)
leaf_mesh.validate()
for m in MAT_LEAF:
    leaf_mesh.materials.append(m)
for poly, mi in zip(leaf_mesh.polygons, all_m):
    poly.material_index = mi
for polygon in leaf_mesh.polygons:
    polygon.use_smooth = True
FOLIAGE = link(bpy.data.objects.new("WorldTree Foliage", leaf_mesh))

# ---- floor -------------------------------------------------------------------------
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.030))
FLOOR = bpy.context.active_object
FLOOR.name = "Studio Floor"
FLOOR.data.materials.append(MAT_FLOOR)


# --------------------------------------------------------------------------------------
# lighting, world, render setup
# --------------------------------------------------------------------------------------

world = bpy.data.worlds.new("WT World")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.0300, 0.0300, 0.0312, 1.0)
bg.inputs["Strength"].default_value = 1.0


def sun_light(name, direction, energy, angle=0.06, colour=(1, 1, 1)):
    data = bpy.data.lights.new(name, "SUN")
    data.energy = energy
    data.angle = angle
    data.color = colour
    obj = link(bpy.data.objects.new(name, data))
    obj.rotation_euler = Vector(direction).normalized().to_track_quat("-Z", "Y").to_euler()
    return obj


def area_light(name, loc, target, energy, size, colour=(1, 1, 1)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.color = colour
    obj = link(bpy.data.objects.new(name, data))
    obj.location = loc
    d = (Vector(target) - Vector(loc)).normalized()
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return obj


KEY = area_light("key", (-6.5, -8.0, 7.5), (-0.8, 0.1, 2.9), 2800, 6.0, (1.0, 0.975, 0.935))
FILL = area_light("fill", (8.5, -6.0, 3.8), (0.6, 0.0, 2.1), 950, 9.0, (0.84, 0.90, 1.0))
RIM = area_light("rim", (3.2, 9.0, 7.5), (0.2, 0.2, 2.9), 1600, 7.0, (0.82, 0.96, 0.90))
TOPL = area_light("toplight", (-1.2, 1.2, 12.0), (-1.1, 0.7, 3.6), 700, 8.0)

scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.cycles.transmission_bounces = 2
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.get_devices()
        if any(d.type == backend for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type in (backend, "CPU")
            scene.cycles.device = "GPU"
            print(f"[world-tree] cycles device: {backend}")
            break
except Exception as exc:  # pragma: no cover
    print(f"[world-tree] GPU setup skipped: {exc}")

scene.render.resolution_x = RES_X
scene.render.resolution_y = RES_Y
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Base Contrast"
scene.view_settings.exposure = -0.34

# No compositor: Blender 5's node-group compositor short-circuits background renders here,
# so the vein bloom is produced in-scene with translucent emissive halo shells instead.
if hasattr(scene, "compositing_node_group"):
    scene.compositing_node_group = None
else:
    scene.use_nodes = False

cam_data = bpy.data.cameras.new("turnaround cam")
cam_data.type = "ORTHO"
CAM = link(bpy.data.objects.new("turnaround cam", cam_data))
scene.camera = CAM

CENTER_X, CENTER_Y, CENTER_Z = -0.05, 0.10, 2.45
ORTHO = 8.1

VIEWS = {
    "front": ((CENTER_X, -16.0, CENTER_Z), (math.pi / 2, 0.0, 0.0), ORTHO),
    "left": ((-16.0, CENTER_Y, CENTER_Z), (math.pi / 2, 0.0, -math.pi / 2), ORTHO),
    "back": ((CENTER_X, 16.0, CENTER_Z), (math.pi / 2, 0.0, math.pi), ORTHO),
    "top": ((-0.35, 0.45, 18.0), (0.0, 0.0, 0.0), ORTHO),
}

os.makedirs(RENDER_DIR, exist_ok=True)
os.makedirs(EXPORT_DIR, exist_ok=True)

# Bake procedural bark into vertex colours, which glTF preserves without external textures.
# Optimize first, then render the same geometry and materials that will run in Grove.
# The carved wood is not decimated: its resolution is set in carved(), and collapsing edges
# would erase the grooves that the bark colour depends on.
for ob, ratio in ((FINE,.55),(BRANCHES,.55),(GLOW,.50)):
    activate(ob)
    modifier=ob.modifiers.new('Realtime topology','DECIMATE')
    modifier.ratio=ratio
    bpy.ops.object.modifier_apply(modifier=modifier.name)

# The rootlets brighten towards their ends for the same reason the roots do: each one carries on
# into a mycelium hair in Grove (see ROOTLET_TIPS), so it has to already be light when it gets there.
_rootlet_glow=[]
for v in FINE.data.vertices:
    r=math.hypot(v.co.x-.12,v.co.y-.08)
    t=max(0.0,min(1.0,(r-.75)/1.0))
    _rootlet_glow.append(ROOT_TIP_GLOW*t*t*(3-2*t))
FINE.data.attributes.new('_glow','FLOAT','POINT').data.foreach_set('value',_rootlet_glow)

REVIEW_GLOW=[]
scene.cycles.samples=8
scene.render.bake.target='VERTEX_COLORS'
scene.render.bake.use_pass_direct=False
scene.render.bake.use_pass_indirect=False
scene.render.bake.use_pass_color=True
for ob in (WOOD,FINE,BRANCHES):
    activate(ob)
    attr=ob.data.color_attributes.new(name='BarkColor',type='BYTE_COLOR',domain='CORNER')
    ob.data.color_attributes.active_color=attr
    print('[world-tree] baking bark:',ob.name,flush=True)
    bpy.ops.object.bake(type='DIFFUSE')
    # The bake stores one colour per corner. Average shared corners to avoid millions
    # of duplicated glTF vertices while retaining the baked grain on the mesh.
    import numpy as np
    loop_colors=np.empty(len(ob.data.loops)*4,dtype=np.float32)
    attr.data.foreach_get('color',loop_colors)
    vertex_indices=np.empty(len(ob.data.loops),dtype=np.int32)
    ob.data.loops.foreach_get('vertex_index',vertex_indices)
    totals=np.zeros((len(ob.data.vertices),4),dtype=np.float32)
    np.add.at(totals,vertex_indices,loop_colors.reshape(-1,4))
    counts=np.bincount(vertex_indices,minlength=len(ob.data.vertices))
    totals/=np.maximum(counts,1)[:,None]
    ob.data.color_attributes.remove(attr)
    attr=ob.data.color_attributes.new(name='BarkColor',type='BYTE_COLOR',domain='POINT')
    attr.data.foreach_set('color',totals.reshape(-1))
    ob.data.color_attributes.active_color=attr
    mat=bpy.data.materials.new('WT Baked Bark '+ob.name)
    mat.use_nodes=True
    nt,bsdf=_principled(mat)
    color=nt.nodes.new('ShaderNodeVertexColor');color.layer_name='BarkColor'
    nt.links.new(color.outputs['Color'],bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value=.78
    bsdf.inputs['Specular IOR Level'].default_value=.25
    # Review renders only: light the bark from the `_glow` attribute the way Grove does at
    # runtime. Removed again before export, where Grove drives it from the heartbeat instead.
    glow_attr=nt.nodes.new('ShaderNodeAttribute');glow_attr.attribute_name='_glow'
    bsdf.inputs['Emission Color'].default_value=(0.10,1.0,0.30,1.0)
    glow_scale=nt.nodes.new('ShaderNodeMath');glow_scale.operation='MULTIPLY';glow_scale.inputs[1].default_value=0.8
    nt.links.new(glow_attr.outputs['Fac'],glow_scale.inputs[0])
    nt.links.new(glow_scale.outputs[0],bsdf.inputs['Emission Strength'])
    REVIEW_GLOW.append((nt,bsdf))
    ob.data.materials.clear();ob.data.materials.append(mat)
    for polygon in ob.data.polygons:polygon.material_index=0
scene.cycles.samples=SAMPLES

for name, (loc, rot, scale) in VIEWS.items():
    CAM.location = loc
    CAM.rotation_euler = Euler(rot, "XYZ")
    if name == "top":
        CAM.location = (-.35, -10.5, 14.0)
        CAM.rotation_euler = (Vector((-.35,.45,2.0))-CAM.location).to_track_quat("-Z","Y").to_euler()
    CAM.data.ortho_scale = scale
    FLOOR.hide_render = name == "top"
    scene.render.filepath = os.path.join(RENDER_DIR, f"{name}.png")
    print(f"[world-tree] rendering {name}")
    bpy.ops.render.render(write_still=True)

# Three-quarter review views. The four reference plates are all axis-aligned, and a model can
# match all four while still being flat in between; in Grove the camera orbits, so the angles
# between the plates are the ones a viewer actually sees most.
EXTRA_VIEWS = {
    "quarter-front-left": (-35.0, 10.0),
    "quarter-front-right": (35.0, 10.0),
    "quarter-back-left": (-145.0, 10.0),
    "side-right": (90.0, 4.0),
    "grove-home": (0.0, 16.0),
    # straight down the canopy-to-deadwood line, from each end: the angles that used to look flat
    "diagonal-deadwood-end": (55.0, 18.0),
    "diagonal-canopy-end": (-125.0, 18.0),
}
for name, (azimuth, elevation) in EXTRA_VIEWS.items():
    az, el = math.radians(azimuth), math.radians(elevation)
    target = Vector((CENTER_X, CENTER_Y, CENTER_Z))
    # azimuth 0 is the front camera (-Y), positive turns toward +X
    CAM.location = target + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * 16.0
    CAM.rotation_euler = (target - CAM.location).to_track_quat("-Z", "Y").to_euler()
    CAM.data.ortho_scale = ORTHO
    scene.render.filepath = os.path.join(RENDER_DIR, f"{name}.png")
    print(f"[world-tree] rendering {name}")
    bpy.ops.render.render(write_still=True)

FLOOR.hide_render = False


# --------------------------------------------------------------------------------------
# contact sheet: references (left block) vs renders (right block)
# --------------------------------------------------------------------------------------

def load_pixels(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    import numpy as np
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(h, w, 4), w, h


def build_sheet():
    import numpy as np
    order = ["front", "left", "back", "top"]
    tiles = {}
    for n in order:
        tiles[("ref", n)] = load_pixels(os.path.join(REF_DIR, f"{n}.png"))
        tiles[("out", n)] = load_pixels(os.path.join(RENDER_DIR, f"{n}.png"))
    w, h = RES_X, RES_Y
    sheet = np.zeros((h * 2, w * 4, 4), dtype=np.float32)
    sheet[..., 3] = 1.0
    layout = {  # (row, col) with row 0 = top of the image
        ("ref", "front"): (0, 0), ("ref", "left"): (0, 1),
        ("out", "front"): (0, 2), ("out", "left"): (0, 3),
        ("ref", "back"): (1, 0), ("ref", "top"): (1, 1),
        ("out", "back"): (1, 2), ("out", "top"): (1, 3),
    }
    for key, (row, col) in layout.items():
        arr, aw, ah = tiles[key]
        if (aw, ah) != (w, h):
            continue
        # bpy pixel buffers are bottom-up; rows are flipped back at save time
        r0 = (1 - row) * h
        sheet[r0:r0 + h, col * w:(col + 1) * w] = arr
    out = bpy.data.images.new("reference-vs-model", w * 4, h * 2, alpha=False, float_buffer=False)
    out.pixels.foreach_set(sheet.reshape(-1))
    out.filepath_raw = os.path.join(RENDER_DIR, "reference-vs-model.png")
    out.file_format = "PNG"
    out.save()


def silhouette_check():
    """Red = reference only, green = model only, white = agreement. Prints IoU."""
    import numpy as np

    def mask(path):
        arr, w, h = load_pixels(path)
        rgb = arr[..., :3]
        # the studio background is flat, so take a corner as the reference value
        bg = rgb[h - 4:h - 1, 1:4].reshape(-1, 3).mean(axis=0)
        return (np.abs(rgb - bg).max(axis=2) > 0.030), w, h

    ref, w, h = mask(os.path.join(REF_DIR, "front.png"))
    mod, mw, mh = mask(os.path.join(RENDER_DIR, "front.png"))
    if (w, h) != (mw, mh):
        return
    inter = float((ref & mod).sum())
    union = float((ref | mod).sum())
    print(f"[world-tree] front silhouette IoU = {inter / max(1.0, union):.3f}")

    out_arr = np.zeros((h, w, 4), dtype=np.float32)
    out_arr[..., 3] = 1.0
    out_arr[ref & ~mod] = (0.85, 0.10, 0.12, 1.0)
    out_arr[mod & ~ref] = (0.12, 0.80, 0.30, 1.0)
    out_arr[ref & mod] = (0.92, 0.92, 0.92, 1.0)
    img = bpy.data.images.new("silhouette-front", w, h, alpha=False, float_buffer=False)
    img.pixels.foreach_set(out_arr.reshape(-1))
    img.filepath_raw = os.path.join(RENDER_DIR, "silhouette-front.png")
    img.file_format = "PNG"
    img.save()


try:
    build_sheet()
except Exception as exc:  # pragma: no cover
    print(f"[world-tree] contact sheet skipped: {exc}")

# --------------------------------------------------------------------------------------
# export + save
# --------------------------------------------------------------------------------------

for nt, bsdf in REVIEW_GLOW:
    for link_ in list(bsdf.inputs['Emission Strength'].links):
        nt.links.remove(link_)
    bsdf.inputs['Emission Strength'].default_value = 0.0

for o in bpy.context.selected_objects:
    o.select_set(False)
for o in (WOOD, FINE, JIN, GLOW, BRANCHES, FOLIAGE):
    o.select_set(True)
bpy.context.view_layer.objects.active = WOOD
try:
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(EXPORT_DIR, "world-tree-blender.glb"),
        export_format="GLB", use_selection=True, export_apply=True,
        export_draco_mesh_compression_enable=False,
        export_draco_mesh_compression_level=6,
        # carries `_glow`, which Grove reads to light the bark around the veins
        export_attributes=True,
    )
except Exception as exc:  # pragma: no cover
    raise RuntimeError("World-tree export failed") from exc

# Root tips, in Grove's coordinates, so the mycelium can leave each root exactly where the wood
# ends and in the direction it was heading. Without this the two were grown independently and met
# nowhere: the wood stopped, and the light began somewhere else.
#
# Grove fits the model with the same rule ReferenceTree.tsx uses: glTF is Y up (Blender x, z, -y),
# scaled so the whole exported model is GROVE_TREE_HEIGHT tall, lowest point on the floor. If that
# rule changes there, change it here too.
GROVE_TREE_HEIGHT = 4.25
exported = (WOOD, FINE, GLOW, BRANCHES, FOLIAGE)
zs = [(o.matrix_world @ v.co).z for o in exported for v in o.data.vertices]
low, high = min(zs), max(zs)
fit = GROVE_TREE_HEIGHT / (high - low)

def to_grove(v):
    return [round(v.x * fit, 4), round((v.z - low) * fit, 4), round(-v.y * fit, 4)]

roots_json = {
    "note": "Generated by scripts/build-world-tree-blender.py. Root tips in ReferenceTree's local space.",
    "scale": round(fit, 5),
    "tips": [
        {"at": to_grove(tip), "direction": [round(d.x, 4), round(d.z, 4), round(-d.y, 4)], "radius": round(r * fit, 4)}
        for tip, d, r in ROOT_TIPS
    ],
    "rootlets": [
        {"at": to_grove(tip), "direction": [round(d.x, 4), round(d.z, 4), round(-d.y, 4)]}
        for tip, d in ROOTLET_TIPS
    ],
}
with open(os.path.join(EXPORT_DIR, "world-tree-roots.json"), "w") as handle:
    json.dump(roots_json, handle, indent=1)

bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

tris = sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in {WOOD, FINE, JIN, GLOW, BRANCHES, FOLIAGE})
print(f"[world-tree] objects={len(bpy.data.objects)} triangles={tris}")
