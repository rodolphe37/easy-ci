#!/usr/bin/env bash
# Installe Easy CI pour l'utilisateur courant, depuis le dossier extrait de EasyCI-Linux-X64.zip :
#   unzip EasyCI-Linux-X64.zip && ./EasyCI/install.sh
#
# Copie l'application dans ~/.local/share/easy-ci, crée la commande `easy-ci` dans ~/.local/bin et
# une entrée de menu (.desktop) pour la retrouver dans le lanceur d'applications.
# Désinstallation : ./install.sh --uninstall
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
INSTALL_DIR="${DATA_HOME}/easy-ci"
BIN_DIR="${HOME}/.local/bin"
DESKTOP_FILE="${DATA_HOME}/applications/easy-ci.desktop"
ICON_FILE="${DATA_HOME}/icons/hicolor/512x512/apps/easy-ci.png"

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

if [[ ! -x "${SOURCE_DIR}/EasyCI" ]]; then
  echo "Exécutable EasyCI introuvable à côté de ce script : lancez-le depuis le dossier extrait de l'archive." >&2
  exit 1
fi

echo "Installation dans ${INSTALL_DIR}…"
if [[ "$SOURCE_DIR" != "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  cp -a "$SOURCE_DIR" "$INSTALL_DIR"
fi
chmod +x "${INSTALL_DIR}/EasyCI"

mkdir -p "$BIN_DIR" "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")"
ln -sf "${INSTALL_DIR}/EasyCI" "${BIN_DIR}/easy-ci"
cp "${INSTALL_DIR}/icon.png" "$ICON_FILE"
sed "s|^Exec=.*|Exec=${INSTALL_DIR}/EasyCI|" "${INSTALL_DIR}/easy-ci.desktop" > "$DESKTOP_FILE"
refresh_caches

echo "Easy CI est installé : lancez-le depuis le menu des applications ou avec la commande easy-ci."
if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
  echo "(${BIN_DIR} n'est pas dans votre PATH : ajoutez-le à votre profil shell pour utiliser la commande easy-ci.)"
fi
if ! command -v git >/dev/null 2>&1; then
  echo "Git n'est pas installé : il est nécessaire pour les projets locaux (ex. sudo apt install git)."
fi
