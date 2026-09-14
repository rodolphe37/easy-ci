# Cask Homebrew

Après chaque version, le job `homebrew` de `.github/workflows/release.yml` :

1. calcule l'empreinte SHA-256 des deux archives macOS (Apple Silicon et Intel) ;
2. met à jour `Casks/easy-ci.rb` avec `packaging/homebrew/bump_cask.py` et ouvre une pull request dans ce dépôt ;
3. pousse le même cask dans le **tap** Homebrew, un dépôt séparé.

## Mise en place

Déjà fait : dépôt public, tap [`rodolphe37/homebrew-easy-ci`](https://github.com/rodolphe37/homebrew-easy-ci) initialisé avec la version 0.1.0. Reste à faire une seule fois pour que les versions suivantes l'alimentent automatiquement :

1. **Créer un token à portée limitée** : [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) › *Fine-grained token* › *Only select repositories* : `homebrew-easy-ci` › *Repository permissions* › **Contents : Read and write**.
2. **L'enregistrer dans ce dépôt** : *Settings › Secrets and variables › Actions › New repository secret*, nom `HOMEBREW_TAP_TOKEN`.
3. **Autoriser les pull requests des workflows** : *Settings › Actions › General › Workflow permissions* › cocher *Allow GitHub Actions to create and approve pull requests* (mise à jour de `Casks/easy-ci.rb` dans ce dépôt).

Si le tap porte un autre nom ou appartient à une autre organisation, créez la variable de dépôt `HOMEBREW_TAP_REPOSITORY` (ex. `mon-orga/homebrew-outils`). Tant que le secret n'existe pas, l'étape de publication dans le tap affiche un avertissement et la version est publiée normalement.

## Installation pour les utilisateurs

```bash
brew trust --tap rodolphe37/easy-ci   # Homebrew 7+ : approbation des taps tiers
brew tap rodolphe37/easy-ci
brew install --cask easy-ci
```

Vérifier le cask après modification : `brew audit --cask --strict --online rodolphe37/easy-ci/easy-ci`.

## Tester le script à la main

```bash
python3 packaging/homebrew/bump_cask.py --version 0.2.0 --arm-sha256 <64 caractères hexa> --intel-sha256 <64 caractères hexa>
```
