# Cask Homebrew d'Easy CI : installation dans /Applications, mises à jour avec `brew upgrade`.
#
# Ce fichier est versionné avec l'application ; `brew install --cask easy-ci` nécessite en plus
# un tap, c'est-à-dire un dépôt GitHub public nommé homebrew-easy-ci contenant Casks/easy-ci.rb.
# La version et les empreintes sont mises à jour automatiquement à chaque publication
# (.github/workflows/release.yml, packaging/homebrew/bump_cask.py) : ne les modifiez pas à la main.
#
# L'application n'est pas signée : Homebrew conserve l'attribut de quarantaine, un clic droit ›
# Ouvrir reste nécessaire au premier lancement (ou `xattr -dr com.apple.quarantine /Applications/EasyCI.app`).
# Pour une installation sans cet avertissement : packaging/macos/install.sh (curl | bash).
# Easy CI détecte une installation Homebrew et propose alors `brew upgrade --cask easy-ci`.
cask "easy-ci" do
  arch arm: "ARM64", intel: "X64"

  version "0.6.6"
  sha256 arm:   "95c24bb491b306e0ddf487bd67d88069939038bd86ac734db785f998058cb547",
         intel: "47e3360b63158328f00c3010ddfee9fd11c51856c4705cd2ec8da8cc76e11907"

  url "https://github.com/rodolphe37/easy-ci/releases/download/v#{version}/EasyCI-macOS-#{arch}.zip"
  name "Easy CI"
  desc "Superviser, modifier et générer vos pipelines CI/CD (GitHub, GitLab, Bitbucket)"
  homepage "https://github.com/rodolphe37/easy-ci"

  auto_updates false
  depends_on macos: :big_sur

  app "EasyCI.app"

  zap trash: [
    "~/Library/Application Support/Easy CI",
    "~/Library/Caches/Easy CI",
    "~/Library/WebKit/io.github.rodolphe37.easyci",
  ]
end
