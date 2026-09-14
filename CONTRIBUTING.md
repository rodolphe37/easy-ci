# Contributing to Easy CI

*[Français ci-dessous ⬇️](#contribuer-à-easy-ci)*

Thanks for your interest in Easy CI! Bug reports, documentation fixes, translations, new stack detectors, new CI providers — every contribution helps. This guide explains how to get set up and what we look for in a pull request.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** — use the [bug report template](https://github.com/rodolphe37/easy-ci/issues/new?template=bug_report.yml). Include your version (Settings › Updates), OS and install method.
- **Suggest a feature** — use the [feature request template](https://github.com/rodolphe37/easy-ci/issues/new?template=feature_request.yml). Describe the problem before the solution.
- **Improve the docs** — the README files, [`docs/`](docs/) and the in-app documentation (`frontend/src/components/docs/DocsContent.tsx`).
- **Write code** — issues labelled `good first issue` or `help wanted` are a good starting point. For anything larger than a small fix, please open an issue first so we can agree on the approach.

Security vulnerabilities must be reported privately — see [SECURITY.md](SECURITY.md).

## Development setup

Prerequisites: **Python 3.11+**, **Node.js 20+**, **Git**.

```bash
git clone https://github.com/<your-username>/easy-ci.git
cd easy-ci
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
npm --prefix frontend ci
npm --prefix frontend run build
```

Run the app in a desktop window:

```bash
.venv/bin/easy-ci
```

For day-to-day UI work, run the API and the Vite dev server, then open http://localhost:5173 in your browser (hot reload):

```bash
.venv/bin/python -m easy_ci.devserver
```

```bash
npm --prefix frontend run dev
```

Use **demo mode** (“Explorer en mode démo”) to work without any account: it simulates GitHub, GitLab and Bitbucket repositories, running pipelines, logs and local clones. New features should work in demo mode too (`src/easy_ci/demo.py`, `src/easy_ci/local/demo.py`).

On Linux, pywebview needs GTK (`python3-gi`, `gir1.2-webkit2-4.1`) or Qt (`pip install -e ".[qt]"`).

## Project layout

The architecture is described in [docs/architecture.md](docs/architecture.md). In short:

- `src/easy_ci/` — Python backend: a single `api.py` entry point called by the UI, one package per provider (`github/`, `gitlab/`, `bitbucket/`), local Git projects (`local/`), pipeline generation (`generation/`), validation, logs, updates.
- `frontend/` — React + TypeScript UI, compiled into `src/easy_ci/web/`.
- `tests/` — pytest suite (HTTP calls mocked with `httpx.MockTransport`, real Git repositories in temporary folders).
- `packaging/`, `.github/workflows/` — standalone builds, install scripts, CI and releases.

## Before opening a pull request

Run the same checks as CI:

```bash
.venv/bin/pytest
```

```bash
.venv/bin/ruff check src tests scripts packaging
```

```bash
npm --prefix frontend run typecheck
```

And please make sure that:

- **Tests** cover new behaviour and bug fixes (a failing test first is ideal).
- **UI changes** were checked in both light and dark themes; include a screenshot or short recording in the PR.
- **User-facing text** is written in French for now, consistent with the rest of the interface (an English translation is planned; don't add English strings in the UI yet).
- **Documentation** is updated when behaviour changes: in-app docs, README (English and French) and [CHANGELOG.md](CHANGELOG.md) under *Unreleased*.
- **No new network destinations** or data collection: tokens are only sent to their own platform, and nothing is pushed without an explicit user action. Discuss any change to this in an issue first.
- The PR does **one thing**; unrelated refactors belong in separate PRs.

## Coding guidelines

- **Python**: type hints, standard library first, small focused modules. Formatting and lint rules are in `pyproject.toml` (Ruff). Providers normalise their data into the common format consumed by the UI; errors raised to the UI are `EasyCIError` subclasses with a clear French message.
- **TypeScript/React**: strict typing, TanStack Query for server state, the shared primitives in `frontend/src/components/ui/`, Tailwind design tokens from `index.css` (no hard-coded colours).
- **Comments** explain *why*, not *what*. Existing code comments are in French; follow the language of the file you edit.
- **Pipeline generation** stays deterministic (templates, no AI): same options, same output. Every generated file must pass `validation.validate` — see `tests/test_generation.py`.

### Adding a stack to the pipeline generator

1. Detect it in `src/easy_ci/generation/detect.py` (evidence files, version, package manager, commands).
2. Render it for the three providers in `src/easy_ci/generation/render.py` (setup actions, images, cache).
3. Add a fixture project to `PROJECTS` in `tests/test_generation.py` — the parametrised tests check the output is valid for GitHub, GitLab and Bitbucket.
4. List it in the in-app documentation and the README.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/), in French or English, for example:

```text
feat: génération des pipelines pour Elixir
fix(gitlab): logs en direct interrompus après 10 minutes
docs: guide de création du token Bitbucket
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `ci`, `build`, `chore`.

## Releases (maintainers)

Releases are automated from a version tag — see [packaging/README.md](packaging/README.md):

```bash
python scripts/bump_version.py 0.2.0
```

Then move the *Unreleased* entries of the changelog under the new version, commit, tag `v0.2.0` and push the tag.

---

# Contribuer à Easy CI

Merci de votre intérêt ! Signalements de bugs, corrections de documentation, traductions, nouveaux détecteurs de stack ou nouvelles plateformes : toute contribution est utile. En participant, vous acceptez le [code de conduite](CODE_OF_CONDUCT.md).

**En bref :**

1. Pour un bug ou une idée, ouvrez une [issue](https://github.com/rodolphe37/easy-ci/issues/new/choose) (en français ou en anglais). Pour une modification importante, discutons de l'approche avant de coder. Les failles de sécurité se signalent en privé ([SECURITY.md](SECURITY.md)).
2. Installez l'environnement : Python 3.11+, Node.js 20+, Git, puis `pip install -e ".[dev]"` et `npm --prefix frontend ci` (voir ci-dessus). Le **mode démo** permet de tout tester sans compte.
3. Avant la pull request, lancez `pytest`, `ruff check src tests scripts packaging` et `npm --prefix frontend run typecheck`.
4. Ajoutez des tests, vérifiez l'interface en thème clair et sombre (capture dans la PR), rédigez les textes de l'interface en français, mettez à jour la documentation intégrée, les README et le [CHANGELOG](CHANGELOG.md) (*Unreleased*).
5. Respectez les principes du projet : aucune nouvelle destination réseau ni collecte de données, rien n'est envoyé sans action explicite de l'utilisateur, génération de pipelines déterministe (sans IA).
6. Messages de commit au format [Conventional Commits](https://www.conventionalcommits.org/fr/) (`feat:`, `fix:`, `docs:`…), une PR par sujet.
