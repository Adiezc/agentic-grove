"""Cut the living-bark and deadwood patches out of Vermos's hand-painted bonsai and make them tile.

Source: "Bonsai" (https://skfb.ly/6XnsZ) by Vermos, CC BY 4.0
(http://creativecommons.org/licenses/by/4.0/). Download it from Sketchfab (signed in), unzip it,
and convert textures/Bonsai_Normal_DirectX.jpg to PNG first (the file is a GIF despite its name):
    sips -s format png Bonsai_Normal_DirectX.jpg --out Bonsai_Normal_DirectX.png
Then:
    blender --background --python scripts/tile-vermos-bark.py -- <unzipped>/textures assets/materials

The model's textures are a UV atlas painted for its own mesh, so they cannot wrap Grove's tree as
they are. Two clean rectangles are cut out (bark with vertical grain, and pale weathered
deadwood), their edges are cross-faded into each other so they repeat without a seam, they are
resampled to 512 px, and the DirectX normal map is converted to OpenGL's convention."""
import sys, os
import numpy as np
import bpy
src, out = sys.argv[sys.argv.index('--') + 1:]
SIZE = 512
# (name, file, x, y, w, h) with x, y from the image's top-left, in pixels of the 2048 map.
PATCHES = [
    ('vermos-bark-colour', 'Bonsai_Base_Color.jpg', 30, 560, 200, 320, False),
    ('vermos-bark-normal', 'Bonsai_Normal_DirectX.png', 30, 560, 200, 320, True),
    ('vermos-deadwood-colour', 'Bonsai_Base_Color.jpg', 1300, 470, 280, 380, False),
    ('vermos-deadwood-normal', 'Bonsai_Normal_DirectX.png', 1300, 470, 280, 380, True),
]
def load(name):
    image = bpy.data.images.load(os.path.join(src, name))
    image.colorspace_settings.name = 'Non-Color'  # keep stored values untouched
    image.pixels[0]  # forces the file to load, so size is known
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32); image.pixels.foreach_get(px)
    return px.reshape(h, w, 4)[::-1]  # top row first
cache = {}
for name, file, x, y, w, h, normal in PATCHES:
    img = cache.setdefault(file, load(file))
    patch = img[y:y + h, x:x + w, :3]
    # Seamless by overlap: the last strip of the patch is cross-faded into its first strip, then
    # dropped, so each edge continues into the opposite one. Most of the painting is untouched.
    def wrap(p, axis):
        n = p.shape[axis]; m = int(n * .22)
        a = np.linspace(0, 1, m, endpoint=False).reshape((-1, 1, 1) if axis == 0 else (1, -1, 1))
        head = np.take(p, range(m), axis); tail = np.take(p, range(n - m, n), axis)
        body = np.take(p, range(m, n - m), axis)
        return np.concatenate([head * a + tail * (1 - a), body], axis)
    patch = wrap(wrap(patch, 1), 0)
    h, w = patch.shape[:2]
    ys = np.linspace(0, h, SIZE, endpoint=False); xs = np.linspace(0, w, SIZE, endpoint=False)
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    y1 = (y0 + 1) % h; x1 = (x0 + 1) % w
    fy = (ys - y0)[:, None, None]; fx = (xs - x0)[None, :, None]
    tiled = (patch[y0][:, x0] * (1 - fy) * (1 - fx) + patch[y0][:, x1] * (1 - fy) * fx
             + patch[y1][:, x0] * fy * (1 - fx) + patch[y1][:, x1] * fy * fx)
    if normal:
        tiled[..., 1] = 1 - tiled[..., 1]          # DirectX green to OpenGL
        n = tiled * 2 - 1; n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
        tiled = n * 0.5 + 0.5
    rgba = np.concatenate([tiled, np.ones((SIZE, SIZE, 1), np.float32)], -1)[::-1]
    outimg = bpy.data.images.new(name, SIZE, SIZE)
    outimg.colorspace_settings.name = 'Non-Color'
    outimg.pixels.foreach_set(rgba.astype(np.float32).ravel())
    settings = bpy.context.scene.render.image_settings
    settings.file_format = 'JPEG'; settings.quality = 92; settings.color_management = 'OVERRIDE'
    settings.view_settings.view_transform = 'Standard'
    outimg.save_render(os.path.join(out, name + '.jpg'))
    print('saved', name)
