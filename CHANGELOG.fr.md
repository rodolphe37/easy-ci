# Journal des modifications

Toutes les évolutions notables d'Easy CI sont consignées dans ce fichier (version anglaise : [CHANGELOG.md](CHANGELOG.md), à tenir à jour en même temps).

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/spec/v2.0.0.html).

## [Unreleased]

### Corrigé

- Après une mise à jour, l'application pouvait continuer d'afficher l'interface de la version précédente (par exemple sans la section *Notifications* des paramètres en 0.4.0) : le cache du moteur web resservait l'ancienne page. L'adresse de l'interface change désormais à chaque version installée.

## [0.4.0] - 2026-09-15

### Ajouté

- **Notifications système** quand un pipeline suivi échoue ou repasse au vert : message dans l'application avec un bouton *Voir*, et notification du système quand la fenêtre est en arrière-plan (AppleScript sous macOS, notification PowerShell sous Windows, `notify-send` ou D-Bus sous Linux, notification web dans le navigateur). *Paramètres › Notifications* permet de choisir les échecs et/ou les retours au vert, tous les dépôts ou seulement les favoris, et d'envoyer une notification d'essai ; `--test-notification` fait de même depuis un terminal.
- **Statistiques des exécutions** dans un nouvel onglet *Statistiques* de chaque dépôt : taux de réussite, durées médiane et P90 avec leur tendance, graphique des durées, et pour chaque job taux de réussite, durées et historique, sur les 20, 50 ou 100 dernières exécutions terminées, pour un workflow ou tous, sur toutes les branches ou la branche par défaut.
- **Détection des jobs instables** (« flaky ») : un job qui a échoué puis réussi sur le même commit (relance du job ou du pipeline) ou qui alterne souvent entre succès et échec est signalé, à partir de toutes les tentatives de chaque exécution (`filter=all` sur GitHub, jobs relancés sur GitLab).
- Mode démo : durées variables, un workflow qui ralentit et des tests instables pour explorer les statistiques, et un pipeline en échec qui déclenche une notification.
- Liens vers le site et la démo en ligne (https://easy-ci.netlify.app) dans les README.
- Le workflow de release redéploie le site pour que sa démo en ligne utilise la nouvelle version (build hook Netlify dans le secret `NETLIFY_BUILD_HOOK`, ignoré avec un avertissement s'il est absent).
- Notes de version bilingues : chaque GitHub Release reprend la section de la version dans `CHANGELOG.md` et `CHANGELOG.fr.md`, et la fenêtre de mise à jour les affiche dans la langue de l'interface.

### Modifié

- Les notes de version ne contiennent plus la liste des pull requests générée par GitHub (qui mentionnait notamment la mise à jour du cask Homebrew de la version précédente).

### Corrigé

- Dans les listes d'exécutions, l'auteur ne chevauche plus la branche et le commit quand la fenêtre est étroite : les informations sont tronquées et l'auteur n'est affiché que si la ligne est assez large.

## [0.3.0] - 2026-09-14

### Ajouté

- Interface en anglais : l'application suit la langue du système (français ou anglais, anglais pour les autres langues) et se change dans *Réglages › Apparence* ou depuis l'écran de connexion. La documentation intégrée, les messages d'erreur, les résultats de validation et les commentaires des pipelines générés sont également traduits.
- `npm run i18n:check` (lancé en CI) signale les textes d'interface écrits en dur et les écarts entre catalogues.

## [0.2.0] - 2026-09-14

### Ajouté

- Scripts d'installation et de mise à jour en une commande : macOS et Linux (`curl … | bash`), Windows (`irm … | iex`), avec options pour une version précise, un dépôt privé ou une archive locale.
- Tap Homebrew : `brew tap rodolphe37/easy-ci && brew install --cask easy-ci`.
- Détection des nouvelles versions : vérification de la dernière GitHub Release au démarrage puis toutes les 6 heures, affichage des notes de version et de la commande de mise à jour adaptée au mode d'installation (Homebrew, script, PowerShell), avec *Ignorer cette version*, un rappel dans la barre latérale et une section *Réglages › Mises à jour*.
- Métadonnées de version de l'exécutable Windows.
- Section À propos dans les Réglages avec des liens vers le code source, le suivi des problèmes et le journal des modifications.
- Fichiers de projet open source : licence MIT, README en anglais et en français, guide de contribution, code de conduite, politique de sécurité, guide d'assistance, modèles d'issues et de pull requests, configuration Dependabot, documentation d'architecture.

### Modifié

- Les scripts d'installation sont testés en CI sur l'archive construite pour chaque plateforme, suivis d'un autodiagnostic de l'application installée.
- Le workflow *Package* ne conserve plus les archives construites (elles peuvent être gardées à la demande lors d'un lancement manuel) ; les releases les gardent un jour avant de les publier.
- L'échec de l'ouverture de la pull request du cask Homebrew ne fait plus échouer la release.

### Corrigé

- Le cask Homebrew utilise la syntaxe actuelle `depends_on macos:` et la vérification d'URL par défaut (aucun avertissement d'obsolescence avec Homebrew 7).

## [0.1.0] - 2026-09-14

Première version publique.

### Ajouté

- **Surveillance** de GitHub Actions, GitLab CI/CD (y compris les instances auto-hébergées) et Bitbucket Pipelines, avec un compte par plateforme, découverte automatique des dépôts et des pipelines, ajouts manuels, dépôts masqués et favoris.
- **Statuts en direct**, tableau de bord général (workflows en échec, pipelines en cours, taux de réussite, santé des dépôts) et palette de commandes.
- **Détail des exécutions** : jobs regroupés par étape, steps, logs avec couleurs ANSI, sections repliables, recherche et horodatage, logs en direct sur GitLab et Bitbucket, annotations, extrait de l'erreur et accès direct à la ligne en échec ; relance (tous les jobs ou ceux en échec) et annulation.
- **Projets locaux** : détection des clones Git dans des dossiers racines, liaison manuelle ou clonage, état de la branche et du dépôt distant, fetch et pull en avance rapide (manuel ou automatique), état et diff des fichiers CI, ouverture dans le gestionnaire de fichiers, l'éditeur ou le terminal.
- **Édition des fichiers CI** dans le clone local : éditeur YAML CodeMirror avec complétion des mots-clés, validation en direct propre à chaque plateforme avec erreurs positionnées, CI Lint officiel de GitLab, aperçu des jobs, diff, protection contre les conflits, commit local sur une nouvelle branche, push et création de pull/merge request sur action explicite.
- **Génération de pipelines** à partir de la stack détectée (Node.js, Python, Go, Rust, Java/Kotlin, Android, PHP, Ruby, .NET, monorepos) : assistant en cinq étapes avec aperçu validé en direct — étapes, matrice de versions, cache, déclencheurs, image Docker et déploiement — écrit dans le clone local. Modèles déterministes, sans IA.
- **Mode démo** avec dépôts simulés, pipelines en cours et clones locaux.
- Documentation intégrée, thèmes clair et sombre, fenêtre native avec icônes de l'application pour macOS, Windows et Linux.
- CI/CD du projet : lint et tests sous Linux, macOS et Windows, applications PyInstaller autonomes pour macOS (Apple Silicon et Intel), Windows et Linux, GitHub Releases automatisées avec empreintes SHA-256.

[Unreleased]: https://github.com/rodolphe37/easy-ci/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/rodolphe37/easy-ci/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rodolphe37/easy-ci/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rodolphe37/easy-ci/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rodolphe37/easy-ci/releases/tag/v0.1.0
