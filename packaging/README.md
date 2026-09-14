# Empaquetage et publication

Easy CI est distribué sous forme d'**applications autonomes** construites avec PyInstaller : Python, pywebview et l'interface compilée sont embarqués, rien n'est à installer à part Git (pour les projets locaux).

| Fichier | Rôle |
|---|---|
| `packaging/pyinstaller/easy-ci.spec` | Recette PyInstaller (données embarquées, moteur de rendu par système, bundle macOS) |
| `.github/workflows/build.yml` | Construction réutilisable : interface, puis applications macOS arm64 / x64, Windows, Linux, vérification `--self-check`, archives zip |
| `.github/workflows/package.yml` | Construction à chaque push sur `main` (artefacts conservés 14 jours) |
| `.github/workflows/release.yml` | Publication d'une version sur un tag `v*.*.*` : GitHub Release + cask Homebrew |
| `scripts/bump_version.py` | Change la version dans `pyproject.toml` et `src/easy_ci/__init__.py` |
| `packaging/homebrew/` | Mise à jour du cask (`Casks/easy-ci.rb`) et mise en place du tap |
| `packaging/linux/` | Entrée de menu `.desktop` et script d'installation inclus dans l'archive Linux |

## Publier une version

```bash
python scripts/bump_version.py 0.2.0
```

```bash
git commit -am "chore: version 0.2.0" && git tag v0.2.0 && git push origin main v0.2.0
```

Le workflow **Release** vérifie que le tag correspond à la version du code, construit les quatre applications, les vérifie, puis crée la GitHub Release avec les archives et `SHA256SUMS.txt`. Un tag avec suffixe (`v0.2.0-beta.1`) crée une pré-version, sans mise à jour Homebrew.

Pour republier les fichiers d'une version : onglet **Actions › Release › Run workflow**, en indiquant le tag.

> Les téléchargements d'une GitHub Release ne sont publics que si le dépôt l'est. Pour un dépôt privé, les archives restent accessibles aux membres du dépôt (page Releases ou artefacts du workflow).

## Construire en local

L'interface doit être compilée avant PyInstaller :

```bash
npm --prefix frontend ci && npm --prefix frontend run build
```

```bash
.venv/bin/pip install -e ".[build]"
```

```bash
.venv/bin/pyinstaller packaging/pyinstaller/easy-ci.spec --noconfirm
```

Résultat : `dist/EasyCI/` et, sous macOS, `dist/EasyCI.app`. Sous Linux, installez aussi Qt (`pip install -e ".[build,qt]"`). Vérification sans ouvrir de fenêtre :

```bash
dist/EasyCI.app/Contents/MacOS/EasyCI --self-check
```

## Installer une version téléchargée

**macOS** : décompresser, glisser `EasyCI.app` dans Applications. L'application n'étant pas signée, le premier lancement se fait par clic droit › **Ouvrir** (ou `xattr -dr com.apple.quarantine /Applications/EasyCI.app`). Avec Homebrew : voir `packaging/homebrew/README.md`.

**Windows** : décompresser où vous le souhaitez et lancer `EasyCI.exe`. SmartScreen peut afficher « Windows a protégé votre ordinateur » : **Informations complémentaires › Exécuter quand même**. Le moteur WebView2, présent sur Windows 10 et 11 à jour, est requis.

**Linux** : décompresser puis lancer `./EasyCI/install.sh` (menu des applications et commande `easy-ci`). Qt WebEngine est embarqué mais s'appuie sur quelques bibliothèques système, présentes sur la plupart des bureaux ; sur une installation minimale Debian/Ubuntu :

```bash
sudo apt install libnss3 libxkbcommon-x11-0 libxcb-cursor0 libxcomposite1 libxdamage1 libxrandr2 libxtst6 libegl1
```

## Limites connues

- Pas de signature de code ni de notarisation (certificats Apple Developer et Authenticode payants) : avertissements au premier lancement.
- Pas de binaire universel macOS : deux archives, Apple Silicon et Intel (`macos-15-intel` est la dernière image Intel de GitHub).
- Linux x64 uniquement.
