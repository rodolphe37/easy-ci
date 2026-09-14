# Security Policy

*[Français ci-dessous ⬇️](#politique-de-sécurité)*

## Supported versions

Easy CI is pre-1.0 and does not maintain parallel release branches. Security fixes are released as a new version from `main`; please update to the [latest release](https://github.com/rodolphe37/easy-ci/releases/latest) (the app notifies you when one is available).

| Version | Supported |
|---|---|
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report it privately through [GitHub Security Advisories](https://github.com/rodolphe37/easy-ci/security/advisories/new) ("Report a vulnerability"). If that is not possible, contact the maintainer [@rodolphe37](https://github.com/rodolphe37) privately via GitHub.

Please include:

- a description of the issue and its potential impact;
- steps to reproduce (a minimal proof of concept is ideal);
- the affected version, operating system and install method (Homebrew, install script, archive, source);
- any suggested fix or mitigation.

### What to expect

- An acknowledgement within **5 working days**.
- An initial assessment within **10 working days**, with a remediation plan if the report is confirmed.
- Credit in the release notes and the advisory, unless you prefer to remain anonymous.

Please give us a reasonable time to release a fix before any public disclosure.

## Scope

Particularly relevant areas:

- handling of platform tokens (system keychain storage, requests sent only to the matching platform);
- the local development server (`easy_ci.devserver`, meant to listen on `127.0.0.1` only);
- Git operations on local clones, file writes limited to CI configuration files;
- install scripts (`packaging/*/install.*`) and the update check.

Out of scope: vulnerabilities in GitHub, GitLab or Bitbucket themselves (report them to those vendors), and issues requiring an already compromised machine or user account.

---

# Politique de sécurité

## Versions prises en charge

Easy CI est en version 0.x et ne maintient pas de branches parallèles. Les correctifs de sécurité sont publiés dans une nouvelle version : mettez à jour vers la [dernière version](https://github.com/rodolphe37/easy-ci/releases/latest) (l'application vous prévient quand elle est disponible).

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique pour une faille de sécurité.**

Signalez-la en privé via les [GitHub Security Advisories](https://github.com/rodolphe37/easy-ci/security/advisories/new) (« Report a vulnerability ») ou, à défaut, par message privé à [@rodolphe37](https://github.com/rodolphe37) sur GitHub, en indiquant : description et impact, étapes pour reproduire, version, système et méthode d'installation, et une piste de correction si vous en avez une.

Accusé de réception sous **5 jours ouvrés**, première analyse sous **10 jours ouvrés**, et mention dans les notes de version si vous le souhaitez. Merci de laisser le temps de publier un correctif avant toute divulgation publique.
