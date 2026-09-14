<p align="center">
  <img src="src/easy_ci/resources/icon.png" alt="Easy CI logo" width="160">
</p>

<h1 align="center">Easy CI</h1>

<p align="center">
  <strong>Monitor, fix, edit and generate your CI/CD pipelines — GitHub Actions, GitLab CI/CD and Bitbucket Pipelines — from one fast, native desktop app.</strong>
</p>

<p align="center">
  <a href="https://easy-ci.netlify.app"><strong>Website</strong></a> ·
  <a href="https://easy-ci.netlify.app/demo"><strong>Live demo</strong></a> ·
  <a href="https://easy-ci.netlify.app/download">Download</a> ·
  <a href="README.fr.md">🇫🇷 Lire en français</a>
</p>

<p align="center">
  <a href="https://github.com/rodolphe37/easy-ci/actions/workflows/ci.yml"><img src="https://github.com/rodolphe37/easy-ci/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/rodolphe37/easy-ci/actions/workflows/package.yml"><img src="https://github.com/rodolphe37/easy-ci/actions/workflows/package.yml/badge.svg" alt="Package"></a>
  <a href="https://github.com/rodolphe37/easy-ci/releases/latest"><img src="https://img.shields.io/github/v/release/rodolphe37/easy-ci?label=release&color=5b5bf0" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-5b5bf0.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-7D31FC.svg" alt="Platforms: macOS, Windows, Linux">
</p>

<p align="center">
  <a href="pyproject.toml"><img src="https://img.shields.io/badge/python-3.11%2B-1AA3FD.svg?logo=python&logoColor=white" alt="Python 3.11+"></a>
  <a href="frontend/package.json"><img src="https://img.shields.io/badge/React-TypeScript-3178C6.svg?logo=typescript&logoColor=white" alt="React + TypeScript"></a>
  <a href="https://github.com/astral-sh/ruff"><img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json" alt="Ruff"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome"></a>
  <img src="https://img.shields.io/github/downloads/rodolphe37/easy-ci/total?color=0ca30c" alt="Downloads">
</p>

<p align="center">
  <img src="docs/screenshots/overview.png" alt="Easy CI overview: failing workflows, live runs and repository health" width="900">
</p>

---

## Table of contents

- [Why Easy CI?](#why-easy-ci)
- [Features](#features)
- [Supported platforms](#supported-platforms)
- [Installation](#installation)
- [Getting started](#getting-started)
- [Privacy and security](#privacy-and-security)
- [Tech stack](#tech-stack)
- [Development](#development)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Why Easy CI?

Your pipelines live in several places: GitHub Actions for some projects, GitLab CI/CD at work, Bitbucket Pipelines for a client. Finding out *which* pipeline is red, *why*, and *how* to fix it means juggling browser tabs, scrolling through thousands of log lines and editing YAML blind.

Easy CI brings all of that into a single desktop app: every pipeline of every repository you can access, live statuses, logs that jump straight to the error, a YAML editor that validates as you type, and a wizard that writes a complete pipeline for your stack. Changes are made in **your local clone**, committed on a branch, and pushed or proposed as a pull request **only when you decide**.

<p align="center">
  <img src="docs/screenshots/run-failure.png" alt="Failed run: the failing test, the error excerpt and the log positioned on the error" width="900">
</p>

## Features

### Monitor

- **All your CI in one place** — GitHub Actions, GitLab CI/CD (gitlab.com and self-managed) and Bitbucket Pipelines, with one account per platform.
- **Automatic discovery** of every repository and pipeline you have access to; add others by `owner/name` or URL, hide the ones you don't care about, star favorites.
- **Live statuses** — running pipelines refreshed every few seconds, color-coded history, success rate and repository health at a glance.

### Diagnose

- **Run details** — jobs (grouped by stage on GitLab), steps, durations, triggering commit and author.
- **Readable logs** — ANSI colors, collapsible sections, search, timestamps, virtualized rendering for huge logs, **live logs** on GitLab and Bitbucket.
- **Failure analysis** — annotations and failing tests (GitHub, GitLab), an excerpt around the error and a one-click jump to the offending line.
- **Actions** — re-run everything or only failed jobs (where the platform supports it), cancel, open on the platform.

### Work locally

- **Local projects** — detects Git clones in your project folders, links them to their remote repository (or clones for you), shows branch, commits to pull or push and the state of every CI file.
- **Safe sync** — manual or automatic `git fetch`, fast-forward-only updates that never touch uncommitted work, open in Finder/Explorer, your editor (VS Code, Cursor, Zed, JetBrains…) or a terminal.

### Edit

- **YAML editor** (CodeMirror 6) with platform keywords completion, search, folding and **live validation** specific to each platform — errors underlined in place, plus the official **GitLab CI Lint** on demand.
- **Job preview** and **diff** against the remote branch; protection against external changes and unsaved edits.
- **Publish on your terms** — local commit on a dedicated branch, then push and pull/merge request **only on explicit action**.

### Generate

- **Pipeline wizard** — analyses the local clone and generates a complete pipeline: install, lint, type checking, tests, build, version matrix, cache, triggers, Docker image and deployment (with presets for Netlify, Vercel, Fly.io, Cloudflare, Render, Firebase, Serverless).
- **Stacks**: Node.js (npm, pnpm, Yarn, Bun), Python (pip, uv, Poetry, Pipenv), Go, Rust, Java/Kotlin (Maven, Gradle), Android, PHP, Ruby, .NET — including monorepos.
- **Deterministic templates, no AI** — same choices, same file; nothing is sent to a third-party service. The YAML preview is validated live.

### Desktop app

- **One-command install** on macOS, Linux and Windows, with **new version detection** and the right upgrade command for your install method.
- **Demo mode** to try everything without an account — also available as a [live demo in your browser](https://easy-ci.netlify.app/demo) (desktop screens), command palette (`⌘K` / `Ctrl+K`), light and dark themes, **built-in documentation**.
- **English and French interface**, following the system language, with a manual switch in *Settings › Appearance*.

## Supported platforms

| Capability | GitHub Actions | GitLab CI/CD | Bitbucket Pipelines |
|---|:---:|:---:|:---:|
| Discovery, statuses, history | ✅ | ✅ | ✅ |
| Jobs and logs | ✅ | ✅ | ✅ |
| Step-by-step details | ✅ | — | — |
| Live logs while running | — | ✅ | ✅ |
| Annotations / test reports | ✅ | ✅ | — |
| Re-run everything, cancel | ✅ | ✅ (new pipeline) | ✅ (new pipeline) |
| Re-run failed jobs only | ✅ | ✅ | — |
| Validation while editing | ✅ | ✅ + official CI Lint | ✅ |
| Pull / merge request creation | ✅ | ✅ | ✅ |
| Pipeline generation | ✅ | ✅ | ✅ |
| Self-managed instances | — (github.com) | ✅ | — (Bitbucket Cloud) |

## Installation

Easy CI ships as a self-contained app: no Python or Node.js required, only **Git** for local projects. Builds are not code-signed (Apple Developer and Authenticode certificates are paid), so pick the install method that suits you.

### macOS

Two options — pick one:

```bash
# Option 1: Homebrew — installs into /Applications, updates with `brew upgrade`,
# but expect a one-time right-click › Open on first launch (unsigned app).
brew trust --tap rodolphe37/easy-ci   # Homebrew 7+ asks you to approve third-party taps
brew tap rodolphe37/easy-ci
brew install --cask easy-ci
```

```bash
# Option 2: install script — no Gatekeeper warning at all (curl and ditto don't set the
# quarantine flag); re-run the same command to update.
curl -fsSL https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/macos/install.sh | bash
```

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/linux/install.sh | bash
```

Installs into `~/.local/share/easy-ci`, adds an `easy-ci` command and an application menu entry. Re-run to update; uninstall with `~/.local/share/easy-ci/install.sh --uninstall`. Linux x64 only for now.

### Windows

In PowerShell:

```powershell
irm https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/windows/install.ps1 | iex
```

Installs into `%LOCALAPPDATA%\Programs\EasyCI` with a Start menu shortcut — no administrator rights, no SmartScreen prompt. Re-run to update. Requires the WebView2 runtime (built into up-to-date Windows 10 and 11).

### Manual download

Grab the archive for your system from the [latest release](https://github.com/rodolphe37/easy-ci/releases/latest): `EasyCI-macOS-ARM64.zip` (Apple Silicon), `EasyCI-macOS-X64.zip` (Intel), `EasyCI-Windows-X64.zip`, `EasyCI-Linux-X64.zip`. Each release also publishes `SHA256SUMS.txt`.

Install script options (environment variables): `EASY_CI_VERSION=v0.2.0` for a specific version, `EASY_CI_ARCHIVE=/path/to/EasyCI-….zip` to install an archive you already downloaded. See [`packaging/README.md`](packaging/README.md) for details.

### Updates

Easy CI checks GitHub for a newer release at startup and every 6 hours. When one is available, a dialog shows the release notes and **the upgrade command matching how you installed it** (Homebrew, script or PowerShell). You can skip a version or turn the check off in **Settings › Updates**.

## Getting started

> [!TIP]
> Just want a look first? The [live demo](https://easy-ci.netlify.app/demo) runs the real app — interface and Python engine, via WebAssembly — in your browser on sample data, nothing to install.

1. Launch Easy CI and connect a platform — or click **Explore demo mode** to try everything with simulated data.
2. Create a token with the scopes below and paste it in (tokens are stored in your system keychain):

   | Platform | Credentials | Scopes |
   |---|---|---|
   | GitHub | Personal access token (or your GitHub CLI session) | `repo`, `workflow`, `read:org` |
   | GitLab (gitlab.com or self-managed) | Instance URL + personal access token | `api`, `read_user` |
   | Bitbucket Cloud | Atlassian email + API token, or a workspace/repository access token | Read repositories and pipelines, write pipelines |

3. Your repositories and pipelines appear automatically. Add other platforms any time in **Settings › Accounts**.
4. To edit or generate CI files, open a repository's **Local project** tab and link a folder (Easy CI can also scan your project folders or clone the repository for you).

The in-app **Documentation** (sidebar) walks through every feature step by step, including how to create each token.

## Privacy and security

- **Tokens stay on your machine**, in the operating system keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux), and are only ever sent to the platform they belong to.
- **No telemetry, no analytics, no AI.** The only other network request is the anonymous update check against the GitHub Releases API, which you can disable.
- **Nothing is pushed without your consent** — edits are written to your local clone; pushing and opening pull requests are separate, explicit actions.
- Git operations use **your own `git`** binary, credentials and configuration.

Found a vulnerability? Please report it privately — see [SECURITY.md](SECURITY.md).

## Tech stack

| Layer | Technologies |
|---|---|
| Desktop shell | [pywebview](https://pywebview.flowrl.com/) (Cocoa/WebKit on macOS, Edge WebView2 on Windows, Qt WebEngine on Linux) |
| Backend | Python 3.11+, [httpx](https://www.python-httpx.org/), [keyring](https://github.com/jaraco/keyring), [PyYAML](https://pyyaml.org/), [platformdirs](https://github.com/platformdirs/platformdirs) |
| Frontend | [React](https://react.dev/) + TypeScript, [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/), [TanStack Query](https://tanstack.com/query), [React Router](https://reactrouter.com/), [Radix UI](https://www.radix-ui.com/), [CodeMirror 6](https://codemirror.net/), [cmdk](https://cmdk.paco.me/), [Lucide](https://lucide.dev/), [i18next](https://www.i18next.com/) |
| Quality | [pytest](https://pytest.org/), [Ruff](https://docs.astral.sh/ruff/), strict TypeScript |
| Packaging and delivery | [PyInstaller](https://pyinstaller.org/), GitHub Actions (tests on 3 OS, builds for macOS arm64/x64, Windows, Linux), GitHub Releases, Homebrew tap |

How the pieces fit together is described in [docs/architecture.md](docs/architecture.md).

## Development

Prerequisites: **Python 3.11+**, **Node.js 20+**, **Git**.

```bash
git clone https://github.com/rodolphe37/easy-ci.git && cd easy-ci
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
npm --prefix frontend ci
npm --prefix frontend run build
```

Run the desktop app:

```bash
.venv/bin/easy-ci
```

With hot reload — start the Vite dev server, then open the desktop window on it:

```bash
npm --prefix frontend run dev
```

```bash
.venv/bin/easy-ci --dev --debug
```

Or develop in a regular browser (the Python API is served locally and proxied by Vite), then open http://localhost:5173:

```bash
.venv/bin/python -m easy_ci.devserver
```

Checks run by CI:

```bash
.venv/bin/pytest
```

```bash
.venv/bin/ruff check src tests scripts packaging
```

```bash
npm --prefix frontend run typecheck
```

```bash
npm --prefix frontend run i18n:check
```

On Linux, pywebview needs GTK (`python3-gi`, `gir1.2-webkit2-4.1`) or Qt (`pip install -e ".[qt]"`). Building the standalone app and publishing releases are covered in [packaging/README.md](packaging/README.md).

## Roadmap

Done:

- [x] GitHub Actions monitoring: discovery, statuses, run details, logs, failure analysis, re-run and cancel
- [x] GitLab CI/CD and Bitbucket Pipelines, multiple accounts, live logs
- [x] Local projects: clone detection, linking, Git status, sync, CI file diffs
- [x] CI file editing with validation, local commits, push and pull requests on demand
- [x] Pipeline generation from the detected stack
- [x] Project CI/CD: tests on 3 OS, standalone apps, GitHub Releases, Homebrew tap
- [x] One-command install and in-app update notifications
- [x] English and French interface and documentation (i18n)

Next ideas — feedback and contributions welcome:

- [ ] More interface languages (contributions welcome: one JSON catalog per language)
- [ ] Desktop notifications when a watched pipeline fails or recovers
- [ ] More providers: Azure Pipelines, CircleCI, Gitea/Forgejo Actions
- [ ] Linux arm64 builds, AppImage / Flatpak, winget package
- [ ] Workflow run statistics (durations, flaky jobs) over time

See the [issues](https://github.com/rodolphe37/easy-ci/issues) to discuss or pick something up.

## Contributing

Contributions of all sizes are welcome — bug reports, documentation fixes, translations, new stack detectors or providers. Please read [CONTRIBUTING.md](CONTRIBUTING.md) to get set up, and note that this project follows a [Code of Conduct](CODE_OF_CONDUCT.md). Changes are listed in the [CHANGELOG](CHANGELOG.md).

Need help? See [SUPPORT.md](SUPPORT.md).

## License

Easy CI is released under the [MIT License](LICENSE). © 2026 Rodolphe Augusto.

GitHub, GitLab and Bitbucket are trademarks of their respective owners; Easy CI is an independent project, not affiliated with or endorsed by them.
