"""Regenerate public, blank screenshots from the locally retained sources.

Requires Pillow and Node.js. It uses the current preset geometry.
The source screenshots stay outside public/ and are never included in the site.
"""

import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads(subprocess.check_output(
    ["node", "--input-type=module", "-e",
     "import {originalPresets, BUILTIN_TOP_CROP} from './original-presets.js'; console.log(JSON.stringify({originalPresets, BUILTIN_TOP_CROP}))"],
    cwd=ROOT, text=True, encoding="utf-8"
))
PRESETS = DATA["originalPresets"]
TOP_CROP = DATA["BUILTIN_TOP_CROP"]
SOURCES = {
    "detail1": "Screenshot_20261015_101027.jpg",
    "detail": "Screenshot_20260923_230154.jpg",
    "detail3": "Screenshot_20261015_100737.jpg",
    "workflow": "Screenshot_20260923_230031.jpg",
}


for name, source_name in SOURCES.items():
    image = Image.open(ROOT / "source-templates" / source_name).convert("RGB")
    original = image.copy()
    draw = ImageDraw.Draw(image)
    for label, _, (x0, y0, x1, y1), *options in PRESETS[name]:
        label_end = options[1] if len(options) > 1 else 0
        pad = 7 if name in ("detail", "workflow") else 4
        left = max(0, x0 - pad)
        if name in ("detail1", "detail3") and label_end:
            left = max(left, label_end + 5)
        box = (left, max(0, y0 - pad),
               min(image.width - 1, x1 + pad), min(image.height - 1, y1 + pad))
        if name in ("detail1", "detail3"):
            # The card text sits on uniform grey; other values sit on white.
            sample_x = 1000 if "· 课程" in label else 350
            color = original.getpixel((sample_x, (y0 + y1) // 2))
        else:
            samples = [original.getpixel((x, y)) for x, y in (
                (box[0], max(0, box[1] - 12)),
                (box[2], max(0, box[1] - 12)),
                (box[0], min(image.height - 1, box[3] + 12)),
                (box[2], min(image.height - 1, box[3] + 12)),
            )]
            color = tuple(sorted(pixel[channel] for pixel in samples)[len(samples) // 2]
                          for channel in range(3))
        draw.rectangle(box, fill=color)

    if name == "detail3":
        # The source begins halfway through the preceding student row.
        draw.rectangle((0, 427, image.width - 1, 461), fill=(255, 255, 255))

    # Remove the phone's status bar while retaining the app title below it.
    image = image.crop((0, TOP_CROP, image.width, image.height))
    destination = ROOT / "public" / "assets" / f"blank-{name}.png"
    image.save(destination, optimize=True)
    print(destination, image.size)
