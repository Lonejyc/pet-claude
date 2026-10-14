#!/bin/sh
# Régénère l'icône de l'app depuis le pet 3D (rendu Chrome) et celle de la barre de menus (silhouette 2D) : rendu par Chrome (serveur de dev sur :1420), puis formats macOS via `tauri icon`.
# Prérequis : `npm run tauri dev` (ou `npm run dev`) lancé dans app/.
set -e
. "$HOME/.cargo/env"
cd "$(dirname "$0")/../app"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --window-size=1024,1024 --virtual-time-budget=4000 --screenshot=app-icon.png http://localhost:1420/icon.html
cp app-icon.png public/app-icon.png
# icône de la barre de menus : silhouette 2D noir et blanc (image template)
python3 ../scripts/make-tray-icon.py src-tauri/icons/tray.png
npx tauri icon app-icon.png
rm -rf src-tauri/icons/android src-tauri/icons/ios
