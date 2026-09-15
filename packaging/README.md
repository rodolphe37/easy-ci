# Empaquetage et publication

Easy CI est distribué sous forme d'**applications autonomes** construites avec PyInstaller : Python, pywebview et l'interface compilée sont embarqués, rien n'est à installer à part Git (pour les projets locaux).

| Fichier | Rôle |
|---|---|
| `packaging/pyinstaller/easy-ci.spec` | Recette PyInstaller (données embarquées, moteur de rendu par système, bundle macOS) |
| `.github/workflows/build.yml` | Construction réutilisable : interface, puis applications macOS arm64 / x64, Windows, Linux, vérification `--self-check`, archives zip |
| `.github/workflows/package.yml` | Construction à chaque push sur `main` (artefacts conservés 14 jours) |
| `.github/workflows/release.yml` | Publication d'une version sur un tag `v*.*.*` : GitHub Release, cask Homebrew, redéploiement de la démo en ligne |
| `scripts/bump_version.py` | Change la version dans `pyproject.toml` et `src/easy_ci/__init__.py` |
| `scripts/release_notes.py` | Notes bilingues de la GitHub Release, tirées de `CHANGELOG.fr.md` et `CHANGELOG.md` |
| `packaging/homebrew/` | Mise à jour du cask (`Casks/easy-ci.rb`) et mise en place du tap |
| `packaging/macos/install.sh` | Installation / mise à jour macOS en une commande (`curl … | bash`), sans quarantaine Gatekeeper |
| `packaging/linux/` | Script d'installation Linux (`curl … | bash` ou depuis l'archive) et entrée de menu `.desktop` |
| `packaging/windows/install.ps1` | Installation / mise à jour Windows en une commande (`irm … | iex`) |
| `src/easy_ci/updates.py` | Détection des nouvelles versions dans l'application et commande de mise à jour selon l'installation |

## Publier une version

```bash
python scripts/bump_version.py 0.2.0
```

Déplacez ensuite les entrées *Unreleased* sous `## [0.2.0] - date` dans **les deux journaux** (`CHANGELOG.md` et `CHANGELOG.fr.md`), avec le lien de comparaison en bas de fichier. Ces sections forment les notes de la GitHub Release : un bloc français et un bloc anglais (encadrés par `<!-- lang:fr -->` / `<!-- lang:en -->`), dont le site et la fenêtre de mise à jour de l'application n'affichent que celui de la langue choisie. Aperçu : `python scripts/release_notes.py 0.2.0`.

```bash
git commit -am "chore: version 0.2.0" && git tag v0.2.0 && git push origin main v0.2.0
```

Le workflow **Release** vérifie que le tag correspond à la version du code et que les deux journaux contiennent la version, construit les quatre applications, les vérifie, puis crée la GitHub Release avec les archives et `SHA256SUMS.txt`. Un tag avec suffixe (`v0.2.0-beta.1`) crée une pré-version, sans mise à jour Homebrew ni de la démo en ligne.

Pour republier les fichiers d'une version : onglet **Actions › Release › Run workflow**, en indiquant le tag (les notes de la release sont alors régénérées à partir des journaux).

### Démo en ligne (https://easy-ci.netlify.app)

Le site embarque dans sa démo la dernière version publiée. Après la GitHub Release, le job **Mettre à jour la démo en ligne** appelle un *build hook* Netlify pour redéployer le site. Mise en place, une seule fois :

1. Netlify › site easy-ci › **Site configuration › Build & deploy › Continuous deployment › Build hooks › Add build hook** (nom : `Easy CI release`, branche : `main`), puis copier l'URL générée.
2. Dépôt easy-ci sur GitHub › **Settings › Secrets and variables › Actions › New repository secret** : nom `NETLIFY_BUILD_HOOK`, valeur : l'URL du hook.

Sans ce secret, la release se termine normalement avec un avertissement ; la démo peut alors être mise à jour à la main (**Deploys › Trigger deploy** sur Netlify).

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

## Installer une version

Les commandes d'installation (Homebrew, `curl | bash`, PowerShell) sont dans le [README](../README.md#installation). Les scripts téléchargent la dernière GitHub Release via les liens `releases/latest/download/…` (aucun appel à l'API pour un dépôt public) et acceptent :

| Variable | Effet |
|---|---|
| `EASY_CI_VERSION=v0.2.0` | Installer une version précise |
| `GITHUB_TOKEN` | Télécharger depuis un dépôt privé (passe par l'API GitHub) |
| `EASY_CI_ARCHIVE=/chemin/EasyCI-….zip` | Installer une archive déjà téléchargée (utilisé par la CI pour tester les scripts) |
| `EASY_CI_INSTALL_DIR` | Dossier de destination (macOS et Windows) |

Chaque construction de `build.yml` exécute le script d'installation de son système sur l'archive produite, puis lance `--self-check` sur l'application installée.

Téléchargement manuel : **macOS**, glisser `EasyCI.app` dans Applications puis clic droit › **Ouvrir** au premier lancement ; **Windows**, décompresser et lancer `EasyCI.exe` (SmartScreen : **Informations complémentaires › Exécuter quand même** ; WebView2 requis, présent sur Windows 10 et 11 à jour) ; **Linux**, `./EasyCI/install.sh`.

Qt WebEngine est embarqué dans la version Linux mais s'appuie sur quelques bibliothèques système, présentes sur la plupart des bureaux ; sur une installation minimale Debian/Ubuntu :

```bash
sudo apt install libnss3 libxkbcommon-x11-0 libxcb-cursor0 libxcomposite1 libxdamage1 libxrandr2 libxtst6 libegl1
```

## Détection des nouvelles versions

Au démarrage (après quelques secondes) puis toutes les 6 heures, l'application interroge `api.github.com/repos/rodolphe37/easy-ci/releases/latest` — la même source que les scripts et le cask, donc uniquement des versions réellement publiées (ni brouillons ni pré-versions). En cas d'échec (hors ligne, dépôt privé, quota), rien n'est affiché.

Si la version est plus récente, une fenêtre montre les nouveautés et la commande adaptée à l'installation détectée : `brew upgrade --cask easy-ci` si un dossier `Caskroom/easy-ci` existe, sinon le script `curl | bash` (macOS, Linux) ou PowerShell (Windows). « Ignorer cette version » est mémorisé dans les préférences ; la vérification se désactive dans Paramètres › Mises à jour.

## Limites connues

- Pas de signature de code ni de notarisation (certificats Apple Developer et Authenticode payants) : avertissements au premier lancement.
- Pas de binaire universel macOS : deux archives, Apple Silicon et Intel (`macos-15-intel` est la dernière image Intel de GitHub).
- Linux x64 uniquement.
