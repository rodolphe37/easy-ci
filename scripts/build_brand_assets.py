"""Génère les assets de marque (logo, icônes d'application) à partir des images sources.

Usage :
    .venv/bin/python scripts/build_brand_assets.py [--logo PATH] [--icon PATH]

Sources attendues : `branding/easy-ci-logo.png` (fond transparent) et
`branding/easy-ci-icon.png` (carré arrondi sombre sur fond blanc), en 1024 px ou plus.

Produit :
- frontend/src/assets/brand/  : logo (thème clair), logo-dark (thème sombre), mark (petites tailles)
- src/easy_ci/resources/      : icon.png (fenêtre / Linux), icon.ico (Windows), icon.icns (macOS)
- frontend/public/favicon.png
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BRANDING = ROOT / "branding"
WEB_BRAND = ROOT / "frontend" / "src" / "assets" / "brand"
RESOURCES = ROOT / "src" / "easy_ci" / "resources"
PUBLIC = ROOT / "frontend" / "public"

# Forme du carré arrondi de l'icône source (mesurée sur l'image) : super-ellipse d'exposant ~3.8.
SQUIRCLE_EXPONENT = 3.8


def squircle_bounds(icon: np.ndarray) -> tuple[int, int, int, int]:
    """Boîte englobante du carré arrondi sombre (x0, y0, x1, y1 inclus)."""
    dark = icon[..., :3].astype(int).sum(axis=2) < 300
    rows = np.where(dark.any(axis=1))[0]
    cols = np.where(dark.any(axis=0))[0]
    return int(cols.min()), int(rows.min()), int(cols.max()), int(rows.max())


def squircle_mask(width: int, height: int, inset: float = 2.0, supersample: int = 4) -> Image.Image:
    """Masque anti-aliasé d'une super-ellipse remplissant width × height."""
    w, h = width * supersample, height * supersample
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    a = w / 2 - inset * supersample
    b = h / 2 - inset * supersample
    u = np.abs((xs + 0.5 - w / 2) / a)
    v = np.abs((ys + 0.5 - h / 2) / b)
    inside = (u**SQUIRCLE_EXPONENT + v**SQUIRCLE_EXPONENT) <= 1.0
    mask = Image.fromarray((inside * 255).astype(np.uint8), "L")
    return mask.resize((width, height), Image.Resampling.LANCZOS)


def build_icon_tile(source: Path) -> Image.Image:
    """Isole le carré arrondi de l'icône source sur fond transparent (carré, pleine taille)."""
    image = Image.open(source).convert("RGBA")
    x0, y0, x1, y1 = squircle_bounds(np.array(image))
    tile = image.crop((x0, y0, x1 + 1, y1 + 1))
    size = max(tile.size)
    tile = tile.resize((size, size), Image.Resampling.LANCZOS)
    tile.putalpha(squircle_mask(size, size))
    return tile


def macos_icon(tile: Image.Image, canvas: int = 1024) -> Image.Image:
    """Grille d'icône macOS : carré arrondi de 824 px centré sur 1024 px, avec ombre portée douce."""
    body = round(canvas * 824 / 1024)
    offset = (canvas - body) // 2
    scaled = tile.resize((body, body), Image.Resampling.LANCZOS)

    shadow_alpha = scaled.getchannel("A").point(lambda a: a * 0.45)
    shadow = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    shadow_layer = Image.new("RGBA", (body, body), (0, 0, 0, 255))
    shadow_layer.putalpha(shadow_alpha)
    shadow.paste(shadow_layer, (offset, offset + round(canvas * 10 / 1024)), shadow_layer)
    shadow = shadow.filter(ImageFilter.GaussianBlur(canvas * 14 / 1024))

    result = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    result.alpha_composite(shadow)
    result.alpha_composite(scaled, (offset, offset))
    return result


def clean_logo(source: Path) -> Image.Image:
    """Supprime le voile semi-transparent laissé par le détourage et recadre au contenu."""
    image = np.array(Image.open(source).convert("RGBA")).astype(np.float32)
    alpha = image[..., 3]
    # Le halo parasite est quasi transparent (< 64) ; le dessin est opaque (> 190).
    low, high = 90.0, 190.0
    image[..., 3] = np.clip((alpha - low) / (high - low), 0, 1) * 255
    cleaned = Image.fromarray(image.astype(np.uint8), "RGBA")
    bbox = cleaned.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    cleaned = cleaned.crop(bbox)
    return square(cleaned, margin=0.02)


def dark_logo(tile: Image.Image) -> Image.Image:
    """Version sombre du logo : l'illustration de l'icône, sans le fond du carré arrondi."""
    image = np.array(tile).astype(np.float32)
    rgb = image[..., :3]
    background = np.array([8, 16, 38], dtype=np.float32)  # bleu nuit du fond de l'icône
    distance = np.sqrt(((rgb - background) ** 2).sum(axis=2))
    # Fondu progressif : le fond disparaît, les panneaux et traits restent visibles.
    keep = np.clip((distance - 14.0) / 40.0, 0, 1)
    image[..., 3] = image[..., 3] * keep
    result = Image.fromarray(image.astype(np.uint8), "RGBA")
    return square(result.crop(result.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()), margin=0.02)


def mark(tile: Image.Image, canvas: int = 512) -> Image.Image:
    """Symbole ∞ seul, reposé sur un carré arrondi bleu nuit : lisible même à 20 px."""
    size = tile.size[0]
    # Zone du ∞ dans l'icône (proportions mesurées), serrée pour exclure les panneaux voisins.
    box = (round(size * 0.318), round(size * 0.37), round(size * 0.692), round(size * 0.585))
    region = np.array(tile.crop(box)).astype(np.float32)
    # Le ∞ est très lumineux ; fond et bordures des panneaux sont sombres.
    brightness = region[..., :3].max(axis=2)
    region[..., 3] = np.clip((brightness - 90.0) / 70.0, 0, 1) * 255
    symbol = Image.fromarray(region.astype(np.uint8), "RGBA")
    symbol = symbol.crop(symbol.getchannel("A").point(lambda a: 255 if a > 40 else 0).getbbox())

    result = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    background = Image.new("RGBA", (canvas, canvas), (11, 20, 46, 255))
    # Léger dégradé vertical pour donner du relief, comme l'icône.
    gradient = np.linspace(1.18, 0.82, canvas, dtype=np.float32)[:, None, None]
    background_array = np.array(background).astype(np.float32)
    background_array[..., :3] = np.clip(background_array[..., :3] * gradient, 0, 255)
    background = Image.fromarray(background_array.astype(np.uint8), "RGBA")
    background.putalpha(squircle_mask(canvas, canvas, inset=0))
    result.alpha_composite(background)

    width = round(canvas * 0.74)
    height = round(symbol.height * width / symbol.width)
    symbol = symbol.resize((width, height), Image.Resampling.LANCZOS)
    result.alpha_composite(symbol, ((canvas - width) // 2, (canvas - height) // 2))
    return result


def square(image: Image.Image, margin: float = 0.0) -> Image.Image:
    side = round(max(image.size) * (1 + 2 * margin))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(image, ((side - image.width) // 2, (side - image.height) // 2))
    return canvas


def save_png(image: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.resize((size, size), Image.Resampling.LANCZOS).save(path, optimize=True)


def build_icns(icon: Image.Image, destination: Path) -> bool:
    if not shutil.which("iconutil"):
        print("iconutil indisponible (hors macOS) : icon.icns non généré.")
        return False
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for base in (16, 32, 128, 256, 512):
            save_png(icon, iconset / f"icon_{base}x{base}.png", base)
            save_png(icon, iconset / f"icon_{base}x{base}@2x.png", base * 2)
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(destination)], check=True)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--logo", type=Path, default=BRANDING / "easy-ci-logo.png")
    parser.add_argument("--icon", type=Path, default=BRANDING / "easy-ci-icon.png")
    args = parser.parse_args()

    tile = build_icon_tile(args.icon)

    save_png(clean_logo(args.logo), WEB_BRAND / "logo.png", 640)
    save_png(dark_logo(tile), WEB_BRAND / "logo-dark.png", 640)
    save_png(mark(tile), WEB_BRAND / "mark.png", 128)
    save_png(tile, WEB_BRAND / "icon.png", 256)

    app_icon = macos_icon(tile)
    save_png(app_icon, RESOURCES / "icon.png", 512)
    app_icon.save(RESOURCES / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    build_icns(app_icon, RESOURCES / "icon.icns")
    save_png(tile, PUBLIC / "favicon.png", 64)

    for path in sorted([*WEB_BRAND.glob("*"), *RESOURCES.glob("icon.*"), PUBLIC / "favicon.png"]):
        print(f"{path.relative_to(ROOT)}  ({path.stat().st_size // 1024} Ko)")


if __name__ == "__main__":
    main()
