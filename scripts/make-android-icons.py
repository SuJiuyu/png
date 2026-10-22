"""Draw the app's Android launcher icons with Pillow."""

from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "res"
SIZE = 1024
BLUE = (58, 153, 241, 255)


def foreground():
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((274, 193, 768, 819), radius=62, fill=(19, 105, 192, 95))
    draw.rounded_rectangle((255, 173, 749, 799), radius=62, fill="white")
    draw.rounded_rectangle((322, 284, 565, 319), radius=17, fill=(49, 137, 225))
    for y, width in ((394, 310), (503, 285), (612, 235)):
        draw.rounded_rectangle((322, y, 322 + width, y + 29), radius=14, fill=(170, 207, 239))

    # Pencil and its dark point remain clear even at launcher sizes.
    draw.polygon([(530, 724), (696, 558), (735, 597), (569, 763)], fill=(252, 180, 55))
    draw.polygon([(530, 724), (569, 763), (508, 786)], fill=(255, 219, 150))
    draw.polygon([(508, 786), (529, 777), (517, 764)], fill=(48, 74, 103))
    draw.polygon([(696, 558), (713, 541), (752, 580), (735, 597)], fill=(41, 98, 168))
    return image


fg = foreground()
for density, icon_size, foreground_size in (
    ("mdpi", 48, 108),
    ("hdpi", 72, 162),
    ("xhdpi", 96, 216),
    ("xxhdpi", 144, 324),
    ("xxxhdpi", 192, 432),
):
    directory = ROOT / f"mipmap-{density}"
    directory.mkdir(parents=True, exist_ok=True)
    fg.resize((foreground_size, foreground_size), Image.Resampling.LANCZOS).save(directory / "ic_launcher_foreground.png")

    base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=225, fill=255)
    base.paste(BLUE, (0, 0, SIZE, SIZE), mask)
    base.alpha_composite(fg)
    base.resize((icon_size, icon_size), Image.Resampling.LANCZOS).save(directory / "ic_launcher.png")

    round_mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(round_mask).ellipse((0, 0, SIZE - 1, SIZE - 1), fill=255)
    round_base = Image.new("RGBA", (SIZE, SIZE), BLUE)
    round_base.alpha_composite(fg)
    round_base.putalpha(round_mask)
    round_base.resize((icon_size, icon_size), Image.Resampling.LANCZOS).save(directory / "ic_launcher_round.png")

print("Android launcher icons generated")
