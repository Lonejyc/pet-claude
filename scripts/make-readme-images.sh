#!/bin/sh
# Régénère les images du README (docs/images) depuis le vrai pet 3D rendu par Chrome.
# Prérequis : `npm run tauri dev` (ou `npm run dev`) lancé dans app/ (serveur sur :1420).
set -e
cd "$(dirname "$0")/../app"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=2 \
  --window-size=1500,310 --virtual-time-budget=4000 --screenshot=../docs/images/etats.png http://localhost:1420/showcase.html
cp app-icon.png ../docs/images/icone.png
