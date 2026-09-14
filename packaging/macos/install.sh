#!/usr/bin/env bash
# Installe ou met à jour Easy CI sur macOS depuis la dernière GitHub Release :
#   curl -fsSL https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/macos/install.sh | bash
#
# Alternative au cask Homebrew (brew install --cask easy-ci), pas une étape en plus.
# Avantage de ce script : aucun avertissement Gatekeeper au premier lancement. macOS ne pose
# l'attribut de quarantaine que sur les fichiers écrits par un programme qui le demande
# (navigateurs, Mail, AirDrop… et Homebrew, volontairement). curl et ditto lancés depuis un
# terminal ne le font pas ; le `xattr` final n'est qu'une sécurité.
# Pour mettre à jour : relancer la même commande (Easy CI l'affiche quand une version sort).
#
# Variables facultatives :
#   EASY_CI_VERSION=v0.2.0   installer une version précise plutôt que la dernière
#   GITHUB_TOKEN=…           télécharger depuis un dépôt privé (token avec accès en lecture)
#   EASY_CI_ARCHIVE=…zip     installer une archive déjà téléchargée (hors ligne, tests de la CI)
#   EASY_CI_INSTALL_DIR=…    dossier de destination (par défaut /Applications)
set -euo pipefail

REPO="${EASY_CI_REPOSITORY:-rodolphe37/easy-ci}"
APP_NAME="EasyCI.app"
INSTALL_DIR="${EASY_CI_INSTALL_DIR:-/Applications}"

fail() { echo "Erreur : $*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || fail "ce script est destiné à macOS (Linux : packaging/linux/install.sh)."
command -v curl >/dev/null 2>&1 || fail "curl est nécessaire."

case "$(uname -m)" in
  arm64) arch="ARM64" ;;
  x86_64)
    # Terminal lancé sous Rosetta sur un Mac Apple Silicon : on installe quand même la version native.
    if [[ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" == "1" ]]; then arch="ARM64"; else arch="X64"; fi
    ;;
  *) fail "architecture non prise en charge : $(uname -m)" ;;
esac
asset="EasyCI-macOS-${arch}.zip"

workdir="$(mktemp -d -t easy-ci-install)"
trap 'rm -rf "$workdir"' EXIT

# Dépôt public : liens directs de GitHub (aucun appel à l'API, rien à analyser).
# Dépôt privé (GITHUB_TOKEN) : l'API est nécessaire pour obtenir l'identifiant du fichier.
download() {
  local version_path
  if [[ -n "${EASY_CI_VERSION:-}" ]]; then version_path="download/${EASY_CI_VERSION}"; else version_path="latest/download"; fi
  if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    curl -fL --progress-bar -o "$workdir/$asset" "https://github.com/${REPO}/releases/${version_path}/${asset}" \
      || fail "téléchargement impossible. Le dépôt est-il public et une version publiée ? (https://github.com/${REPO}/releases)"
    return
  fi
  command -v python3 >/dev/null 2>&1 || fail "python3 est nécessaire avec GITHUB_TOKEN (xcode-select --install)."
  local api="https://api.github.com/repos/${REPO}/releases/latest"
  [[ -n "${EASY_CI_VERSION:-}" ]] && api="https://api.github.com/repos/${REPO}/releases/tags/${EASY_CI_VERSION}"
  curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" -o "$workdir/release.json" "$api" \
    || fail "version introuvable (token sans accès au dépôt ?)."
  local asset_url
  asset_url="$(python3 - "$workdir/release.json" "$asset" <<'PY'
import json, sys
release = json.load(open(sys.argv[1]))
print(next((a["url"] for a in release.get("assets", []) if a["name"] == sys.argv[2]), ""))
PY
)"
  [[ -n "$asset_url" ]] || fail "fichier ${asset} absent de la version."
  curl -fL --progress-bar -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/octet-stream" -o "$workdir/$asset" "$asset_url" \
    || fail "téléchargement impossible."
}

if [[ -n "${EASY_CI_ARCHIVE:-}" ]]; then
  [[ -f "$EASY_CI_ARCHIVE" ]] || fail "archive introuvable : $EASY_CI_ARCHIVE"
  cp "$EASY_CI_ARCHIVE" "$workdir/$asset"
else
  echo "Téléchargement d'Easy CI (${arch})…"
  download
fi

echo "Décompression…"
ditto -x -k "$workdir/$asset" "$workdir/app"
[[ -d "$workdir/app/$APP_NAME" ]] || fail "archive inattendue : ${APP_NAME} introuvable."
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$workdir/app/$APP_NAME/Contents/Info.plist" 2>/dev/null || echo '?')"

mkdir -p "$INSTALL_DIR" 2>/dev/null || true
if [[ ! -w "$INSTALL_DIR" ]]; then
  echo "${INSTALL_DIR} n'est pas accessible en écriture : installation dans ~/Applications." >&2
  INSTALL_DIR="${HOME}/Applications"
  mkdir -p "$INSTALL_DIR"
fi

if pgrep -xq EasyCI; then
  echo "Fermeture d'Easy CI en cours d'exécution…"
  osascript -e 'quit app "Easy CI"' >/dev/null 2>&1 || true
  sleep 2
  pkill -x EasyCI >/dev/null 2>&1 || true
fi

echo "Installation dans ${INSTALL_DIR}/${APP_NAME}…"
rm -rf "${INSTALL_DIR:?}/${APP_NAME}"
# ditto plutôt que cp/unzip : conserve les attributs dont dépend la signature ad hoc du bundle.
ditto "$workdir/app/$APP_NAME" "${INSTALL_DIR}/${APP_NAME}"
xattr -cr "${INSTALL_DIR}/${APP_NAME}" 2>/dev/null || true

echo ""
echo "Easy CI ${version} est installé dans ${INSTALL_DIR}/${APP_NAME}."
echo "Lancez-le depuis le Launchpad ou avec : open -a \"${INSTALL_DIR}/${APP_NAME}\""
command -v git >/dev/null 2>&1 || echo "Git est nécessaire pour les projets locaux : xcode-select --install"
