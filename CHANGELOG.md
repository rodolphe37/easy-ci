# Changelog

All notable changes to Easy CI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-09-14

### Added

- English interface: the app follows the system language (French or English, English otherwise) and can be switched in *Settings › Appearance* or from the sign-in screen. Built-in documentation, error messages, validation results and generated pipeline comments are translated too.
- `npm run i18n:check` (run in CI) flags hard-coded interface text and catalog mismatches.

## [0.2.0] - 2026-09-14

### Added

- One-command install and update scripts: macOS and Linux (`curl … | bash`), Windows (`irm … | iex`), with options for a specific version, a private repository or a local archive.
- Homebrew tap: `brew tap rodolphe37/easy-ci && brew install --cask easy-ci`.
- New version detection: checks the latest GitHub release at startup and every 6 hours, shows release notes and the upgrade command matching the install method (Homebrew, script, PowerShell), with *Skip this version*, a sidebar reminder and a *Settings › Updates* section.
- Windows executable version metadata.
- About section in Settings with links to the source code, issue tracker and changelog.
- Open source project files: MIT license, English and French README, contributing guide, code of conduct, security policy, support guide, issue and pull request templates, Dependabot configuration, architecture documentation.

### Changed

- Install scripts are tested in CI on the archive built for each platform, followed by a self-check of the installed app.
- The *Package* workflow no longer stores build archives (they can be kept on demand from a manual run); releases keep them for one day before publishing them.
- A failure to open the Homebrew cask pull request no longer fails the release.

### Fixed

- Homebrew cask uses the current `depends_on macos:` syntax and default URL verification (no deprecation warnings with Homebrew 7).

## [0.1.0] - 2026-09-14

First public version.

### Added

- **Monitoring** of GitHub Actions, GitLab CI/CD (including self-managed instances) and Bitbucket Pipelines, with one account per platform, automatic repository and pipeline discovery, manual additions, hidden repositories and favorites.
- **Live statuses**, overview dashboard (failing workflows, running pipelines, success rate, repository health) and command palette.
- **Run details**: jobs grouped by stage, steps, logs with ANSI colors, collapsible sections, search and timestamps, live logs on GitLab and Bitbucket, annotations, error excerpt and jump to the failing line; re-run (all or failed jobs) and cancel.
- **Local projects**: detection of Git clones in root folders, manual link or clone, branch and remote status, fetch and fast-forward pull (manual or automatic), CI file states and diffs, open in file manager, editor or terminal.
- **CI file editing** in the local clone: CodeMirror YAML editor with keyword completion, live per-platform validation with positioned errors, official GitLab CI Lint, job preview, diff, conflict protection, local commit on a new branch, push and pull/merge request creation on explicit action.
- **Pipeline generation** from the detected stack (Node.js, Python, Go, Rust, Java/Kotlin, Android, PHP, Ruby, .NET, monorepos): five-step wizard with live validated preview — steps, version matrix, cache, triggers, Docker image and deployment — written to the local clone. Deterministic templates, no AI.
- **Demo mode** with simulated repositories, running pipelines and local clones.
- Built-in documentation, light and dark themes, native window with app icons for macOS, Windows and Linux.
- Project CI/CD: lint and tests on Linux, macOS and Windows, standalone PyInstaller apps for macOS (Apple Silicon and Intel), Windows and Linux, automated GitHub Releases with SHA-256 checksums.

[Unreleased]: https://github.com/rodolphe37/easy-ci/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/rodolphe37/easy-ci/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rodolphe37/easy-ci/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rodolphe37/easy-ci/releases/tag/v0.1.0
