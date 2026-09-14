#!/usr/bin/env bash
# Installe ou met à jour Easy CI pour l'utilisateur courant (sans sudo).
#
# Depuis Internet (dernière GitHub Release) :
#   curl -fsSL https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/linux/install.sh | bash
# Depuis une archive déjà téléchargée :
#   unzip EasyCI-Linux-X64.zip && ./EasyCI/install.sh
#
# Copie l'application dans ~/.local/share/easy-ci, crée la commande `easy-ci` dans ~/.local/bin et
# une entrée de menu (.desktop + icône) : sous Linux, c'est ce qui fait apparaître l'application
# dans le lanceur. Pour mettre à jour, relancer la même commande. Désinstallation : --uninstall.
#
# Variables facultatives :
#   EASY_CI_VERSION=v0.2.0   installer une version précise plutôt que la dernière
#   GITHUB_TOKEN=…           télécharger depuis un dépôt privé (token avec accès en lecture)
#   EASY_CI_ARCHIVE=…zip     installer une archive déjà téléchargée (hors ligne, tests de la CI)
set -euo pipefail

REPO="${EASY_CI_REPOSITORY:-rodolphe37/easy-ci}"
ASSET="EasyCI-Linux-X64.zip"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
INSTALL_DIR="${DATA_HOME}/easy-ci"
BIN_DIR="${HOME}/.local/bin"
DESKTOP_FILE="${DATA_HOME}/applications/easy-ci.desktop"
ICON_FILE="${DATA_HOME}/icons/hicolor/512x512/apps/easy-ci.png"

fail() { echo "Erreur : $*" >&2; exit 1; }

refresh_caches() {
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${DATA_HOME}/applications" >/dev/null 2>&1 || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "${DATA_HOME}/icons/hicolor" >/dev/null 2>&1 || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -rf "$INSTALL_DIR" "$BIN_DIR/easy-ci" "$DESKTOP_FILE" "$ICON_FILE"
  refresh_caches
  echo "Easy CI a été désinstallé (vos préférences restent dans ~/.local/share/Easy CI)."
  exit 0
fi

[[ "$(uname -s)" == "Linux" ]] || fail "ce script est destiné à Linux (macOS : packaging/macos/install.sh)."
[[ "$(uname -m)" == "x86_64" ]] || fail "seule l'architecture x86_64 est publiée pour l'instant."

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Lancé depuis un dossier extrait (./EasyCI/install.sh) : pas de téléchargement.
# Via `curl | bash`, BASH_SOURCE est vide ou pointe vers un fichier sans application à côté.
script_dir=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [[ -n "$script_dir" && -x "${script_dir}/EasyCI" ]]; then
  source_dir="$script_dir"
elif [[ -n "${EASY_CI_ARCHIVE:-}" ]]; then
  [[ -f "$EASY_CI_ARCHIVE" ]] || fail "archive introuvable : $EASY_CI_ARCHIVE"
  command -v unzip >/dev/null 2>&1 || fail "unzip est nécessaire (ex. sudo apt install unzip)."
  unzip -q "$EASY_CI_ARCHIVE" -d "$workdir"
  source_dir="$workdir/EasyCI"
  [[ -x "$source_dir/EasyCI" ]] || fail "archive inattendue : exécutable EasyCI introuvable."
else
  command -v curl >/dev/null 2>&1 || fail "curl est nécessaire."
  command -v unzip >/dev/null 2>&1 || fail "unzip est nécessaire (ex. sudo apt install unzip)."
  if [[ -n "${EASY_CI_VERSION:-}" ]]; then version_path="download/${EASY_CI_VERSION}"; else version_path="latest/download"; fi
  echo "Téléchargement d'Easy CI…"
  if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    curl -fL --progress-bar -o "$workdir/$ASSET" "https://github.com/${REPO}/releases/${version_path}/${ASSET}" \
      || fail "téléchargement impossible. Le dépôt est-il public et une version publiée ? (https://github.com/${REPO}/releases)"
  else
    command -v python3 >/dev/null 2>&1 || fail "python3 est nécessaire avec GITHUB_TOKEN."
    api="https://api.github.com/repos/${REPO}/releases/latest"
    [[ -n "${EASY_CI_VERSION:-}" ]] && api="https://api.github.com/repos/${REPO}/releases/tags/${EASY_CI_VERSION}"
    curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" -o "$workdir/release.json" "$api" \
      || fail "version introuvable (token sans accès au dépôt ?)."
    asset_url="$(python3 - "$workdir/release.json" "$ASSET" <<'PY'
import json, sys
release = json.load(open(sys.argv[1]))
print(next((a["url"] for a in release.get("assets", []) if a["name"] == sys.argv[2]), ""))
PY
)"
    [[ -n "$asset_url" ]] || fail "fichier ${ASSET} absent de la version."
    curl -fL --progress-bar -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/octet-stream" -o "$workdir/$ASSET" "$asset_url" \
      || fail "téléchargement impossible."
  fi
  unzip -q "$workdir/$ASSET" -d "$workdir"
  source_dir="$workdir/EasyCI"
  [[ -x "$source_dir/EasyCI" ]] || fail "archive inattendue : exécutable EasyCI introuvable."
fi

pkill -x EasyCI >/dev/null 2>&1 && { echo "Fermeture d'Easy CI en cours d'exécution…"; sleep 1; } || true

echo "Installation dans ${INSTALL_DIR}…"
if [[ "$source_dir" != "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  cp -a "$source_dir" "$INSTALL_DIR"
fi
chmod +x "${INSTALL_DIR}/EasyCI" "${INSTALL_DIR}/install.sh"

mkdir -p "$BIN_DIR" "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")"
ln -sf "${INSTALL_DIR}/EasyCI" "${BIN_DIR}/easy-ci"
cp "${INSTALL_DIR}/icon.png" "$ICON_FILE"
sed "s|^Exec=.*|Exec=${INSTALL_DIR}/EasyCI|" "${INSTALL_DIR}/easy-ci.desktop" > "$DESKTOP_FILE"
refresh_caches

version="$("${INSTALL_DIR}/EasyCI" --version 2>/dev/null || echo "Easy CI")"
echo ""
echo "${version} est installé : lancez-le depuis le menu des applications ou avec la commande easy-ci."
echo "Mise à jour : relancer la commande d'installation. Désinstallation : ${INSTALL_DIR}/install.sh --uninstall"
if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
  echo "(${BIN_DIR} n'est pas dans votre PATH : ajoutez-le à votre profil shell pour utiliser la commande easy-ci.)"
fi
command -v git >/dev/null 2>&1 || echo "Git est nécessaire pour les projets locaux (ex. sudo apt install git)."
