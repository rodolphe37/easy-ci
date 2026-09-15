# Architecture

Easy CI is a desktop application made of a **Python backend** and a **React + TypeScript interface**, displayed in a native window by [pywebview](https://pywebview.flowrl.com/). No web server is exposed: the interface calls Python directly through the pywebview bridge.

```text
┌──────────────────────────── Native window (pywebview) ────────────────────────────┐
│                                                                                    │
│  React + TypeScript UI  (Vite, Tailwind CSS, TanStack Query, CodeMirror 6)         │
│        │  window.pywebview.api.call(method, params)  →  {ok, data | error}         │
│        ▼                                                                           │
│  api.py ── github/ · gitlab/ · bitbucket/ ── http.py ──────────▶ platform REST APIs │
│     │                                                                              │
│     ├── local/ ─────────────────────────────────────────────────▶ user's git CLI   │
│     ├── generation/ · validation.py · workflow_yaml.py · logs.py                   │
│     ├── storage.py ─────────────────────────────▶ OS keychain + settings.json      │
│     └── updates.py ─────────────────────────────▶ GitHub Releases API              │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## Request flow

1. A React component calls a function of `frontend/src/lib/api.ts`, usually through a TanStack Query hook (`frontend/src/hooks/`).
2. `api.ts` forwards the call to `window.pywebview.api.call(method, params)` in the desktop app, or to `POST /api/call` on the development server (`easy_ci.devserver`, proxied by Vite).
3. `Api.call` in `src/easy_ci/api.py` dispatches to a handler and always returns an envelope: `{"ok": true, "data": …}` or `{"ok": false, "error": {"code", "message"}}`. Errors meant for the user are `EasyCIError` subclasses whose message is translated with `tr()` into the language sent by the UI with each call (`src/easy_ci/i18n.py`, catalog in `src/easy_ci/locales/`).
4. Provider services fetch and **normalise** platform data (repositories, workflows, runs, jobs, logs) into a common format, so the UI never needs to know which platform it is displaying.

Repositories are identified everywhere by a key `provider:full_name` (for example `gitlab:group/subgroup/project`).

## Backend — `src/easy_ci/`

| Module | Responsibility |
|---|---|
| `api.py` | Single entry point called by the UI; accounts, demo mode, dispatch, error envelope |
| `app.py`, `__main__.py` | Native window, folder picker, macOS identity; command line (`--dev`, `--debug`, `--version`, `--self-check`) |
| `devserver.py` | Local HTTP server for browser-based development (listens on `127.0.0.1`, checks the request origin) |
| `http.py` | Shared HTTP client: ETag caching, pagination, rate limits, translated errors |
| `providers.py`, `state.py`, `refs.py` | Provider descriptions and capabilities, status normalisation, parsing of `owner/name` and URLs |
| `github/`, `gitlab/`, `bitbucket/` | Platform clients and services: scans, runs, jobs, logs, re-run and cancel, pull/merge requests, GitLab CI Lint |
| `logs.py` | Log parsing: ANSI colors, groups and GitLab sections, error detection, context excerpts |
| `workflow_yaml.py` | Summary of CI files (triggers, stages, jobs, dependencies, includes) |
| `validation.py` | Validation of CI files with YAML positions: syntax plus GitHub, GitLab and Bitbucket structure |
| `generation/` | Stack detection from project files (`detect.py`) and deterministic pipeline rendering for the three providers (`render.py`) |
| `local/` | Local projects: `git` subprocess wrapper, remote matching, clone discovery, CI file read/write, commits and push, opening folders |
| `storage.py` | Credentials in the system keychain (one entry per provider) and JSON settings in the user config directory |
| `stats.py` | Run statistics over time: success rate, duration percentiles and trend, unstable (flaky) jobs from retries and alternating results |
| `notifications.py` | Native desktop notifications (AppleScript on macOS, PowerShell toast on Windows, `notify-send` or D-Bus on Linux) |
| `updates.py` | New version detection and upgrade instructions per install method |
| `selfcheck.py` | Installation self-check used by CI on packaged builds |
| `demo.py`, `local/demo.py`, `generation/demo_projects.py` | Simulated data for demo mode: repositories, runs progressing in real time, local clones |
| `resources/`, `web/` | App icons; compiled frontend (generated, not committed) |

## Frontend — `frontend/src/`

| Folder | Responsibility |
|---|---|
| `lib/` | API client, shared TypeScript types, provider helpers, formatting utilities |
| `hooks/` | Session and settings, repository scans, pipeline state-change notifications, local projects, update checks |
| `pages/` | Overview, repositories, repository, run, editor, pipeline generator, settings, documentation |
| `components/` | Layout (sidebar, top bar, command palette), run statistics panel, log viewer, YAML viewer and editor, publish flow, local project panel, in-app documentation, UI primitives |

The interface uses design tokens defined in `index.css` for the light and dark themes.

## Notifications and statistics

- **Notifications** reuse the periodic repository scans: `hooks/notifications.tsx` compares the latest completed run of each workflow with the previous scan and reports transitions (failing, back to green). The first scan is a baseline, so nothing is reported at startup. The engine only displays the message (`notify`); scans keep refreshing while the window is in the background.
- **Statistics** (`get_run_stats`) list the latest runs, fetch the jobs of every attempt (`list_job_attempts`: GitHub `filter=all`, GitLab `include_retried`), cache them for completed runs and summarise them in `stats.py`, which has no network access and is unit-tested.

## Local Git operations

Easy CI deliberately uses the Git binary installed on the machine (`local/git.py`), so SSH keys, credential helpers and configuration behave exactly as in the user's terminal. Prompts are disabled (`GIT_TERMINAL_PROMPT=0`), writes are limited to CI configuration files and are atomic, and a file changed outside the app is never overwritten silently. Pulls are fast-forward only and skipped when the working tree has changes.

## Tests — `tests/`

- Platform services are tested against recorded-style responses through `httpx.MockTransport`.
- Local project tests create real Git repositories in temporary folders with an isolated Git configuration.
- Pipeline generation is tested for every supported stack and provider: each generated file must pass the validator.
- `test_packaging.py` checks version consistency, the Homebrew cask bump script and the project's own workflows.

## Packaging and delivery

See [packaging/README.md](../packaging/README.md): PyInstaller spec, reusable build workflow for macOS arm64/x64, Windows and Linux, install scripts tested in CI, GitHub Releases and the Homebrew tap.
