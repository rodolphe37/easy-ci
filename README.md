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
- **Documentation intégrée** (menu Documentation) : connexion de chaque plateforme pas à pas, chaque fonctionnalité, dépannage
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
| `src/easy_ci/local/` | Projets locaux : appels au `git` de la machine, rapprochement des remotes, détection des clones, ouverture dans l'éditeur |
| `src/easy_ci/storage.py` | Identifiants dans le trousseau du système (un par plateforme), préférences en JSON |
| `src/easy_ci/resources/` | Icônes de l'application (macOS, Windows, Linux) |
| `frontend/` | Interface React ; compilée dans `src/easy_ci/web/` |
| `branding/`, `scripts/` | Images sources de la marque et script de génération des icônes |

## Installation

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

Tests et vérification des types :

```bash
.venv/bin/pytest
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
| 3 | Édition des fichiers CI en local avec validation, commit local, push et pull request à la demande | 🚧 Prochaine étape |
| 4 | Génération automatique de pipelines selon la stack détectée | À venir |
