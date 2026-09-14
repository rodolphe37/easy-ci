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

# Métadonnées de l'exécutable Windows (Propriétés › Détails, lues par packaging/windows/install.ps1).
windows_version = None
if sys.platform == "win32":
    from PyInstaller.utils.win32 import versioninfo as vi

    numbers = tuple(int(part) for part in re.findall(r"\d+", VERSION.split("-")[0])[:3]) + (0,)
    windows_version = vi.VSVersionInfo(
        ffi=vi.FixedFileInfo(filevers=numbers, prodvers=numbers),
        kids=[
            vi.StringFileInfo([
                vi.StringTable("040C04B0", [
                    vi.StringStruct("CompanyName", "rodolphe37"),
                    vi.StringStruct("FileDescription", "Easy CI"),
                    vi.StringStruct("FileVersion", VERSION),
                    vi.StringStruct("InternalName", "EasyCI"),
                    vi.StringStruct("OriginalFilename", "EasyCI.exe"),
                    vi.StringStruct("ProductName", "Easy CI"),
                    vi.StringStruct("ProductVersion", VERSION),
                ])
            ]),
            vi.VarFileInfo([vi.VarStruct("Translation", [0x040C, 1200])]),
        ],
    )

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
    version=windows_version,
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
