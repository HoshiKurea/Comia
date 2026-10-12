"""Parse PDFs produced by tests/e2e/export.spec.ts with PyMuPDF.

Run from the project root: python scripts/verify-export-artifacts.py
This verifies the saved browser exports rather than constructing test PDFs.
"""
from pathlib import Path
import json
import math
import hashlib
import fitz


def near(actual, expected):
    if not math.isclose(actual, expected, abs_tol=0.01):
        raise AssertionError(f"Expected {expected}, received {actual}")


root = Path(__file__).resolve().parents[1] / "output" / "playwright"
results = []
with fitz.open(root / "export-snapshot.pdf") as document:
    assert len(document) == 2, "Snapshot must keep two pages"
    for index, (width, height, expected) in enumerate([
        (15.36, 19.2, (255, 0, 0)),
        (19.2, 24, (0, 255, 0)),
    ]):
        page = document[index]
        near(page.rect.width, width)
        near(page.rect.height, height)
        pixmap = page.get_pixmap(alpha=False, colorspace=fitz.csRGB)
        pixel = pixmap.pixel(pixmap.width // 2, pixmap.height // 2)
        assert pixel == expected, f"Page {index + 1}: {pixel} != {expected}"
        results.append({"page": index + 1, "points": [page.rect.width, page.rect.height], "centerRGB": pixel})

with fitz.open(root / "export-large-paper.pdf") as document:
    assert len(document) == 1
    page = document[0]
    near(page.rect.width, 16384)
    near(page.rect.height, 16)
    results.append({"largePaperPoints": [page.rect.width, page.rect.height]})

with fitz.open(root / "vertical-font.pdf") as document:
    assert len(document) == 1
    page = document[0]
    near(page.rect.width, 160)
    near(page.rect.height, 500)
    images = page.get_images(full=True)
    assert len(images) == 1, "Vertical text PDF must contain one page raster"
    xref, mask = images[0][:2]
    encoded = fitz.Pixmap(document, xref)
    expected = fitz.Pixmap(str(root / "vertical-font.png"))
    if encoded.alpha:
        encoded = fitz.Pixmap(encoded, 0)
    if expected.alpha:
        expected = fitz.Pixmap(expected, 0)
    assert (encoded.width, encoded.height, encoded.n) == (160, 500, 3)
    assert encoded.samples == expected.samples, "PDF vertical glyph pixels differ from the independently checked PNG"
    if mask:
        alpha = fitz.Pixmap(document, mask)
        assert all(value == 255 for value in alpha.samples), "Unexpected transparency in the white page raster"
    placements = page.get_image_rects(xref)
    assert len(placements) == 1
    for actual, target in zip(placements[0], page.rect):
        near(actual, target)
    results.append({"verticalGlyphs": 15, "raster": [160, 500], "pdfPngRGB": "identical", "pagePlacement": "full paper"})

paper_sizes = json.loads((root / "export-mixed-paper.json").read_text(encoding="utf-8"))
with fitz.open(root / "export-mixed-paper.pdf") as document:
    assert len(document) == len(paper_sizes) == 3, "Mixed PDF must have three pages without an initial blank"
    for index, expected in enumerate(paper_sizes):
        page = document[index]
        near(page.rect.width, expected["width"] / expected["dpi"] * 72)
        near(page.rect.height, expected["height"] / expected["dpi"] * 72)
        # jsPDF shares its resource dictionary across pages. Count actual placed
        # rasters, rather than unused images merely listed in that dictionary.
        images = [image for image in page.get_images(full=True) if page.get_image_rects(image[0])]
        assert len(images) == 1
        image = fitz.Pixmap(document, images[0][0])
        rgba = tuple(int(expected["color"][i:i + 2], 16) for i in (1, 3, 5))
        assert image.pixel(image.width // 2, image.height // 2)[:3] == rgba, "Wrong narrative order/background"
        placements = page.get_image_rects(images[0][0])
        assert len(placements) == 1
        for actual, target in zip(placements[0], page.rect):
            near(actual, target)
        results.append({"mixedPaperPage": index + 1, "points": [page.rect.width, page.rect.height], "rasterRGB": rgba, "pagePlacement": "full paper"})

for shape in ["rect", "roundRect", "circle", "cloud", "spiky"]:
    with fitz.open(root / f"bubble-{shape}-edge.pdf") as document:
        assert len(document) == 1, f"{shape}: expected one complete page"
        page = document[0]
        near(page.rect.width, 800 / 300 * 72)
        near(page.rect.height, 600 / 300 * 72)
        images = [image for image in page.get_images(full=True) if page.get_image_rects(image[0])]
        assert len(images) == 1, f"{shape}: expected one placed raster"
        encoded = fitz.Pixmap(document, images[0][0])
        expected = fitz.Pixmap(str(root / f"bubble-{shape}-edge.png"))
        if encoded.alpha:
            encoded = fitz.Pixmap(encoded, 0)
        if expected.alpha:
            expected = fitz.Pixmap(expected, 0)
        assert (encoded.width, encoded.height, encoded.n) == (800, 600, 3)
        assert encoded.samples == expected.samples, f"{shape}: PDF outline pixels differ from the exact-screen PNG"
        if images[0][1]:
            assert all(value == 255 for value in fitz.Pixmap(document, images[0][1]).samples)
        placements = page.get_image_rects(images[0][0])
        assert len(placements) == 1
        for actual, target in zip(placements[0], page.rect):
            near(actual, target)
        results.append({"bubbleShape": shape, "raster": [800, 600], "pdfPngRGB": "identical", "pagePlacement": "full paper"})

baseline_hashes = None
for sample in ["first", "last"]:
    hashes = []
    with fitz.open(Path("output/performance") / f"mixed-pdf-{sample}.pdf") as document:
        assert len(document) == 20, "Actual UI benchmark PDF must contain all 20 pages"
        for page in document:
            near(page.rect.width, 2480 / 300 * 72)
            near(page.rect.height, 3508 / 300 * 72)
            images = [image for image in page.get_images(full=True) if page.get_image_rects(image[0])]
            assert len(images) == 1
            image = fitz.Pixmap(document, images[0][0])
            assert (image.width, image.height, image.n) == (2480, 3508, 3)
            hashes.append(hashlib.sha256(image.samples).hexdigest())
            for actual, target in zip(page.get_image_rects(images[0][0])[0], page.rect):
                near(actual, target)
    assert len(set(hashes)) == 20, "Distinct narrative pages must not repeat one raster"
    if baseline_hashes is None:
        baseline_hashes = hashes
    else:
        assert hashes == baseline_hashes, "First/last actual UI PDFs must retain all 20 exact RGB rasters"
    results.append({"actualPdfBenchmark": sample, "pages": 20, "raster": [2480, 3508], "pagePlacement": "full paper", "pageRgbSha256": hashes})

print(json.dumps({"parser": f"PyMuPDF {fitz.VersionBind}", "checks": results, "result": "passed"}))
