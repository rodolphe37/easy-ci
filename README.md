# Easy CI

Application desktop (macOS, Windows, Linux) pour superviser et piloter vos pipelines CI/CD.

- **GitHub Actions, GitLab CI/CD et Bitbucket Pipelines** dans une même interface, avec un compte par plateforme (GitLab auto-hébergé pris en charge)
- **Détection automatique** des pipelines sur tous les dépôts accessibles
- **Statuts en direct** : exécutions en cours suivies toutes les quelques secondes, historique coloré
- **Détail d'une exécution** : jobs (par stage sur GitLab), étapes, logs (couleurs ANSI, sections repliables, recherche), **logs en direct** sur GitLab et Bitbucket
- **Analyse des échecs** : annotations, extrait du log autour de l'erreur, saut direct à la ligne fautive
- **Actions** : relancer (tout ou seulement les jobs en échec), annuler, ouvrir sur la plateforme
- **Fichiers CI** : lecture des YAML avec coloration syntaxique et résumé (déclencheurs, stages, jobs, dépendances, inclusions)
- **Gestion des dépôts** : découverte automatique, ajout manuel (`owner/nom` ou URL), masquage, favoris
- **Projets locaux** : détection des clones Git dans vos dossiers de projets, liaison ou clonage, branche et commits à récupérer ou à pousser, état et diff des fichiers CI locaux, récupération et mise à jour (avance rapide) manuelles ou automatiques, ouverture dans le Finder, l'éditeur ou un terminal
- **Édition des fichiers CI dans le clone local** : éditeur YAML (suggestions de mots-clés, recherche, repli), validation en direct propre à chaque plateforme avec erreurs soulignées (et CI Lint officiel pour GitLab), aperçu des jobs, diff avec la branche distante, protection contre les modifications externes et les pertes non enregistrées
- **Génération de pipelines** : assistant qui détecte la stack du clone local (Node.js, Python, Go, Rust, Java/Kotlin, Android, PHP, Ruby, .NET, monorepos), propose les étapes, déclencheurs, image Docker et déploiement, affiche le YAML validé en direct et l'écrit dans le dossier local — modèles déterministes, sans IA
- **Publication à la demande** : commit local sur une branche dédiée, puis envoi et pull request / merge request uniquement sur action explicite
- **Documentation intégrée** (menu Documentation) : connexion de chaque plateforme pas à pas, chaque fonctionnalité, dépannage
- **Installation en une commande** (Homebrew, `curl | bash`, PowerShell) et **détection des nouvelles versions** avec la commande de mise à jour adaptée
- **Mode démo** pour essayer sans compte, palette de commandes `⌘K`, thèmes clair et sombre

## Architecture

```
┌──────────────────────── Fenêtre native (pywebview) ────────────────────────┐
│  Interface React + TypeScript (Vite, Tailwind, TanStack Query)             │
│            │ window.pywebview.api.call(method, params)                     │
│            ▼                                                               │
│  Backend Python : api.py → {github,gitlab,bitbucket}/service.py → http.py  │
│                   logs.py (analyse des logs) · storage.py (trousseau OS)   │
└────────────────────────────────────────────────────────────────────────────┘
```

| Dossier | Rôle |
|---|---|
| `src/easy_ci/api.py` | Point d'entrée unique appelé par l'interface (enveloppe `{ok, data \| error}`) |
| `src/easy_ci/http.py` | Client HTTP commun : ETag, pagination, quotas, erreurs traduites |
| `src/easy_ci/providers.py` | Description des plateformes (libellés, capacités) et assemblage des scans |
| `src/easy_ci/github/`, `gitlab/`, `bitbucket/` | Opérations propres à chaque plateforme, normalisées dans un format commun |
| `src/easy_ci/workflow_yaml.py` | Résumé des fichiers `.github/workflows`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml` |
| `src/easy_ci/logs.py` | Découpage des logs : ANSI, groupes, erreurs, extraits de contexte |
| `src/easy_ci/demo.py` | Données simulées, dont des exécutions qui avancent en temps réel |
| `src/easy_ci/validation.py` | Validation des fichiers CI (syntaxe YAML et structure GitHub, GitLab, Bitbucket) avec positions des erreurs |
| `src/easy_ci/generation/` | Détection de stack (`detect.py`) et génération des pipelines GitHub, GitLab et Bitbucket (`render.py`) |
| `src/easy_ci/local/` | Projets locaux : appels au `git` de la machine, rapprochement des remotes, détection des clones, ouverture dans l'éditeur |
| `src/easy_ci/updates.py` | Détection des nouvelles versions (API GitHub « latest release ») et commande de mise à jour selon l'installation |
| `src/easy_ci/storage.py` | Identifiants dans le trousseau du système (un par plateforme), préférences en JSON |
| `packaging/`, `.github/workflows/` | Recette PyInstaller, cask Homebrew, installation Linux ; CI, construction et publication des versions |
| `src/easy_ci/resources/` | Icônes de l'application (macOS, Windows, Linux) |
| `frontend/` | Interface React ; compilée dans `src/easy_ci/web/` |
| `branding/`, `scripts/` | Images sources de la marque et script de génération des icônes |

## Installation

Easy CI est une application autonome : ni Python ni Node ne sont nécessaires, seulement **Git** pour les projets locaux. Elle n'est pas signée (certificats Apple et Microsoft payants) : choisissez la méthode qui vous convient.

### macOS

Deux possibilités au choix :

```bash
# Option 1 : Homebrew — installation dans /Applications, mise à jour avec brew upgrade,
# mais clic droit › Ouvrir au premier lancement (Homebrew applique la quarantaine).
brew tap rodolphe37/easy-ci
brew install --cask easy-ci
```

```bash
# Option 2 : script d'installation — aucun avertissement Gatekeeper (curl et ditto n'appliquent pas
# la quarantaine) ; pour mettre à jour, relancer la même commande.
curl -fsSL https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/macos/install.sh | bash
```

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/linux/install.sh | bash
```

Installe dans `~/.local/share/easy-ci`, crée la commande `easy-ci` et l'entrée du menu des applications. Mise à jour : relancer la commande ; désinstallation : `~/.local/share/easy-ci/install.sh --uninstall`.

### Windows

Dans PowerShell :

```powershell
irm https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/windows/install.ps1 | iex
```

Installe dans `%LOCALAPPDATA%\Programs\EasyCI` avec un raccourci dans le menu Démarrer, sans droits administrateur ni écran SmartScreen. Mise à jour : relancer la commande.

### Téléchargement manuel

Les archives de chaque version sont dans les **[Releases](https://github.com/rodolphe37/easy-ci/releases/latest)** : `EasyCI-macOS-ARM64.zip` (Apple Silicon), `EasyCI-macOS-X64.zip` (Intel), `EasyCI-Windows-X64.zip`, `EasyCI-Linux-X64.zip`.

Options des scripts (variables d'environnement) : `EASY_CI_VERSION=v0.2.0` pour une version précise, `GITHUB_TOKEN` pour un dépôt privé, `EASY_CI_ARCHIVE` pour installer une archive déjà téléchargée.

### Mises à jour

Easy CI vérifie au démarrage, puis toutes les 6 heures, si une version plus récente est publiée sur GitHub. Si c'est le cas, une fenêtre affiche les nouveautés et **la commande de mise à jour adaptée à votre installation** (Homebrew, script ou PowerShell), à copier dans un terminal. « Ignorer cette version » la fait taire pour cette version ; la vérification se désactive dans **Paramètres › Mises à jour**.

## CI/CD du projet

| Workflow | Déclenchement | Rôle |
|---|---|---|
| [CI](.github/workflows/ci.yml) | push sur `main`, pull requests | Lint (ruff), tests sur Linux, macOS et Windows (Python 3.11 et 3.13), typage et build de l'interface |
| [Package](.github/workflows/package.yml) | push sur `main` | Construit les applications autonomes des quatre plateformes et les vérifie (artefacts 14 jours) |
| [Release](.github/workflows/release.yml) | tag `v*.*.*` ou lancement manuel | Vérifie la version, construit, publie la GitHub Release (+ `SHA256SUMS.txt`) et met à jour le cask Homebrew |

Publier une version :

```bash
python scripts/bump_version.py 0.2.0
```

```bash
git commit -am "chore: version 0.2.0" && git tag v0.2.0 && git push origin main v0.2.0
```

Détails, construction locale et limites : [packaging/README.md](packaging/README.md).

## Installation depuis les sources

Prérequis : Python 3.11+, Node.js 20+, Git (pour les projets locaux).

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
npm --prefix frontend install
npm --prefix frontend run build
```

Sous Linux, pywebview a besoin de GTK (`python3-gi`, `gir1.2-webkit2-4.1`) ou de Qt (`pip install -e ".[qt]"`).

## Lancer l'application

```bash
.venv/bin/easy-ci
```

Au premier lancement, connectez une plateforme, ou explorez le **mode démo** :

| Plateforme | Identifiants | Droits |
|---|---|---|
| GitHub | *Personal access token* (ou session GitHub CLI) | `repo`, `workflow`, `read:org` |
| GitLab (gitlab.com ou auto-hébergé) | Adresse de l'instance + *personal access token* | `api`, `read_user` |
| Bitbucket Cloud | E-mail Atlassian + API token, ou access token de workspace/dépôt | lecture dépôts et pipelines, écriture pipelines |

Les autres plateformes s'ajoutent ensuite dans **Paramètres › Comptes**. Le guide complet est accessible depuis l'écran de connexion (« Guide pas à pas ») et dans l'application (menu **Documentation**).

Tous les dépôts accessibles avec vos comptes sont ajoutés automatiquement. Pour en suivre d'autres ou en masquer : page **Dépôts** › *Ajouter un dépôt*, ou menu `⋯` d'un dépôt.

## Développement

Rechargement à chaud de l'interface dans la fenêtre desktop :

```bash
npm --prefix frontend run dev
```

```bash
.venv/bin/easy-ci --dev --debug
```

Ou directement dans un navigateur, l'API Python étant servie en local (Vite redirige `/api`) :

```bash
.venv/bin/python -m easy_ci.devserver
```

puis ouvrir http://localhost:5173.

Logo et icônes : les images sources sont dans `branding/`. Après modification, régénérez le logo nettoyé, les variantes claire et sombre et les icônes `.icns`, `.ico` et `.png` :

```bash
.venv/bin/pip install -e ".[brand]"
```

```bash
.venv/bin/python scripts/build_brand_assets.py
```

Tests, lint et vérification des types :

```bash
.venv/bin/pytest
```

```bash
.venv/bin/ruff check src tests scripts packaging
```

```bash
npm --prefix frontend run typecheck
```

## Feuille de route

| # | Étape | Statut |
|---|---|---|
| 0 | Supervision GitHub Actions : scan, statuts, détail, logs, erreurs, gestion des dépôts, documentation | ✅ Terminé |
| 1 | GitLab CI et Bitbucket Pipelines : comptes multiples, pipelines, jobs, logs en direct | ✅ Terminé |
| 2 | Projets locaux : détection des clones, liaison, état Git, récupération, comparaison des fichiers CI | ✅ Terminé |
| 3 | Édition des fichiers CI en local avec validation, commit local, push et pull request à la demande | ✅ Terminé |
| 4 | Génération automatique de pipelines selon la stack détectée (assistant, modèles sans IA) | ✅ Terminé |
| 5 | CI/CD du projet : tests multi-OS, applications autonomes macOS / Windows / Linux, GitHub Releases, cask Homebrew | ✅ Terminé |
| 6 | Installation en une commande (Homebrew, curl, PowerShell) et détection des nouvelles versions dans l'application | ✅ Terminé |
