# Cask Homebrew

Après chaque version, le job `homebrew` de `.github/workflows/release.yml` :

1. calcule l'empreinte SHA-256 des deux archives macOS (Apple Silicon et Intel) ;
2. met à jour `Casks/easy-ci.rb` avec `packaging/homebrew/bump_cask.py` et ouvre une pull request dans ce dépôt ;
3. pousse le même cask dans le **tap** Homebrew, un dépôt séparé.

## Mise en place (une seule fois)

1. **Rendre les téléchargements publics.** Homebrew télécharge les archives sans authentification : les GitHub Releases doivent être publiques (dépôt public, ou dépôt public dédié aux versions).
2. **Créer le tap** : un dépôt GitHub **public** nommé `homebrew-easy-ci` (le préfixe `homebrew-` est obligatoire), avec un premier commit (un README suffit). Le cask y est créé automatiquement à la première publication.
3. **Créer un token à portée limitée** : [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) › *Fine-grained token* › *Only select repositories* : `homebrew-easy-ci` › *Repository permissions* › **Contents : Read and write**.
4. **L'enregistrer dans ce dépôt** : *Settings › Secrets and variables › Actions › New repository secret*, nom `HOMEBREW_TAP_TOKEN`.
5. **Autoriser les pull requests des workflows** : *Settings › Actions › General › Workflow permissions* › cocher *Allow GitHub Actions to create and approve pull requests*.

Si le tap porte un autre nom ou appartient à une autre organisation, créez la variable de dépôt `HOMEBREW_TAP_REPOSITORY` (ex. `mon-orga/homebrew-outils`).

Tant que le secret n'existe pas, l'étape de publication dans le tap affiche un avertissement et la version est publiée normalement.

## Installation pour les utilisateurs

```bash
brew tap rodolphe37/easy-ci
brew install --cask easy-ci
```

## Tester le script à la main

```bash
python3 packaging/homebrew/bump_cask.py --version 0.2.0 --arm-sha256 <64 caractères hexa> --intel-sha256 <64 caractères hexa>
```
