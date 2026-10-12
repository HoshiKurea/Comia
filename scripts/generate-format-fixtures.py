"""Deterministic tiny fixtures for image format boundary tests (Pillow 12.2)."""
from pathlib import Path
from PIL import Image

out = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "formats"
out.mkdir(parents=True, exist_ok=True)
red = Image.new("RGBA", (16, 16), (255, 0, 0, 255))
blue = Image.new("RGBA", (16, 16), (0, 0, 255, 255))
red.save(out / "red.png")
red.save(out / "red.webp", format="WEBP", lossless=True)
red.save(out / "red.avif", format="AVIF", quality=100)
transparent = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
for yy in range(16):
    for xx in range(8):
        transparent.putpixel((xx, yy), (255, 0, 0, 255))
transparent.save(out / "transparent.png")
transparent.save(out / "transparent.webp", format="WEBP", lossless=True)
transparent.save(out / "transparent.avif", format="AVIF", quality=100)
gif_transparent = Image.new("P", (16, 16), 0)
gif_transparent.putpalette([0, 0, 0, 255, 0, 0] + [0] * 762)
for yy in range(16):
    for xx in range(8):
        gif_transparent.putpixel((xx, yy), 1)
gif_transparent.save(out / "transparent.gif", transparency=0)
red.save(out / "red-first.webp", format="WEBP", save_all=True, append_images=[blue], duration=[100, 100], loop=0, lossless=True)
red.save(out / "red-first.avif", format="AVIF", save_all=True, append_images=[blue], duration=[100, 100], loop=0)
red.convert("P").save(out / "red-first.gif", format="GIF", save_all=True, append_images=[blue.convert("P")], duration=[100, 100], loop=0)
turned = Image.new("RGB", (16, 8))
for y in range(8):
    for x in range(16):
        turned.putpixel((x, y), (255, 0, 0) if x < 8 else (0, 0, 255))
for orientation in range(1, 9):
    exif = Image.Exif()
    exif[274] = orientation
    turned.save(out / f"orientation-{orientation}.jpg", format="JPEG", quality=100, subsampling=0, exif=exif)
print("Wrote", len(list(out.iterdir())), "fixtures to", out)
