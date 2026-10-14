#!/bin/sh
# Retire pet-claude : ferme l'app, retire hooks / personnalité / lancement au démarrage, puis supprime l'app.
APP=/Applications/pet-claude.app
if [ -x "$APP/Contents/MacOS/app" ]; then
  "$APP/Contents/MacOS/app" --remove-hooks
  "$APP/Contents/MacOS/app" --disable-style
  "$APP/Contents/MacOS/app" --disable-login
fi
/usr/bin/pkill -f "pet-claude.app/Contents/MacOS/app" 2>/dev/null
rm -rf "$APP"
# réglages et secret du pet (ancien et nouvel identifiant)
rm -rf "$HOME/Library/Application Support/io.github.lonejyc.pet-claude" "$HOME/Library/Application Support/fr.perso.petclaude"
echo "pet-claude désinstallé. Sauvegarde d'origine de ta config Claude : ~/.claude/settings.json.bak-pet-claude"
