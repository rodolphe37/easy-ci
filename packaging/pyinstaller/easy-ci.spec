# Spécification PyInstaller d'Easy CI.
#
# Construction (depuis la racine du dépôt, interface déjà compilée dans src/easy_ci/web) :
#   pyinstaller packaging/pyinstaller/easy-ci.spec --noconfirm
#
# Produit dist/EasyCI/ (dossier autonome) et, sous macOS, dist/EasyCI.app.
# PyInstaller ne fait pas de compilation croisée : chaque système se construit sur lui-même
# (matrice de .github/workflows/build.yml).

import re
import sys
from pathlib import Path

# __file__ n'est pas défini dans un fichier .spec : SPECPATH est la variable fournie par PyInstaller.
SPEC_DIR = Path(SPECPATH).resolve()  # noqa: F821
ROOT = SPEC_DIR.parents[1]
PACKAGE = ROOT / "src" / "easy_ci"
VERSION = re.search(r'__version__\s*=\s*"([^"]+)"', (PACKAGE / "__init__.py").read_text()).group(1)

if not (PACKAGE / "web" / "index.html").exists():
    raise SystemExit("Interface non compilée : lancez « npm --prefix frontend ci && npm --prefix frontend run build » avant PyInstaller.")

# Fichiers non Python : chargés à l'exécution via Path(__file__).parent / "web" et / "resources".
datas = [
    (str(PACKAGE / "web"), "easy_ci/web"),
    (str(PACKAGE / "resources"), "easy_ci/resources"),
]

# pywebview choisit son moteur de rendu dynamiquement : PyInstaller ne peut pas le deviner.
if sys.platform == "darwin":
    hiddenimports = ["webview.platforms.cocoa"]
    icon = str(PACKAGE / "resources" / "icon.icns")
elif sys.platform == "win32":
    hiddenimports = ["webview.platforms.winforms", "webview.platforms.edgechromium", "clr_loader", "pythonnet"]
    icon = str(PACKAGE / "resources" / "icon.ico")
else:
    hiddenimports = ["webview.platforms.qt", "qtpy"]
    icon = None  # Linux : icône fournie par le fichier .desktop et par la fenêtre elle-même

a = Analysis(
    [str(PACKAGE / "__main__.py")],
    pathex=[str(ROOT / "src")],
    datas=datas,
    hiddenimports=hiddenimports,
    # Modules lourds inutiles embarqués par certaines dépendances.
    excludes=["tkinter", "matplotlib", "numpy", "PIL", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="EasyCI",
    console=False,
    icon=icon,
    upx=False,
)

coll = COLLECT(exe, a.binaries, a.datas, name="EasyCI", upx=False)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="EasyCI.app",
        icon=icon,
        bundle_identifier="io.github.rodolphe37.easyci",
        version=VERSION,
        info_plist={
            "CFBundleName": "Easy CI",
            "CFBundleDisplayName": "Easy CI",
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "LSMinimumSystemVersion": "11.0",
            "LSApplicationCategoryType": "public.app-category.developer-tools",
            "NSHighResolutionCapable": True,
            "NSRequiresAquaSystemAppearance": False,
        },
    )
