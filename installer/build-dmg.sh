#!/bin/sh
# Construit l'image disque : installer/Claude-pet-<version>.dmg (l'app et un raccourci vers Applications, à glisser-déposer).
# Hooks Claude Code et lancement au démarrage sont activés par l'app elle-même à sa première ouverture (cf. setup.rs, first_run_in) :
# même résultat que le .pkg avec ses cases cochées par défaut.
set -e
. "$HOME/.cargo/env"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/build-dmg"
VERSION=$(python3 -c "import json;print(json.load(open('$HERE/../app/src-tauri/tauri.conf.json'))['version'])")
DMG="$HERE/Claude-pet-$VERSION.dmg"
VOL="Claude pet"

rm -rf "$OUT"; mkdir -p "$OUT/stage"
# createUpdaterArtifacts exige la clé de signature des mises à jour (sans mot de passe) ; hors du dépôt, à sauvegarder
export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$HOME/.tauri/claude-pet.key}" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
(cd "$HERE/../app" && npm run tauri build -- --bundles app)
cp -R "$HERE/../app/src-tauri/target/release/bundle/macos/Claude pet.app" "$OUT/stage/"
codesign --force --deep --sign - "$OUT/stage/Claude pet.app"   # signature ad hoc : requise pour lancer un binaire arm64

# archive de mise à jour : refaite APRÈS le codesign (celle de Tauri contient l'app non signée, qui ne se lancerait pas en arm64), puis signée + latest.json
TAR="$HERE/Claude-pet-$VERSION.app.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$TAR" -C "$OUT/stage" "Claude pet.app"
(cd "$HERE/../app" && env -u TAURI_SIGNING_PRIVATE_KEY npm run tauri signer sign -- -f "$TAURI_SIGNING_PRIVATE_KEY" -p "" "$TAR" >/dev/null)
python3 - "$VERSION" "$TAR" "$HERE/../docs/releases/$VERSION.md" "$HERE/latest.json" <<'PY'
import json, sys, os, datetime
version, tar, notes, out = sys.argv[1:]
json.dump({"version": version, "notes": open(notes).read() if os.path.exists(notes) else "",
  "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "platforms": {"darwin-aarch64": {"signature": open(tar + ".sig").read().strip(),
    "url": f"https://github.com/Lonejyc/pet-claude/releases/download/v{version}/" + os.path.basename(tar)}}}, open(out, "w"), indent=2)
PY
ln -s /Applications "$OUT/stage/Applications"

# image modifiable, mise en page de la fenêtre (icônes côte à côte), puis compression
hdiutil detach "/Volumes/$VOL" 2>/dev/null || true
hdiutil create -srcfolder "$OUT/stage" -volname "$VOL" -fs HFS+ -format UDRW -ov "$OUT/rw.dmg" >/dev/null
hdiutil attach "$OUT/rw.dmg" -mountpoint "/Volumes/$VOL" -noautoopen >/dev/null
osascript <<APPLESCRIPT || echo "mise en page de la fenêtre ignorée (Finder indisponible) : l'image reste utilisable"
tell application "Finder"
  tell disk "$VOL"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 120, 740, 460}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 112
    set position of item "Claude pet.app" of container window to {135, 150}
    set position of item "Applications" of container window to {405, 150}
    close
    open
    update without registering applications
    delay 1
    close
  end tell
end tell
APPLESCRIPT
sync
hdiutil detach "/Volumes/$VOL" >/dev/null
rm -f "$DMG"
hdiutil convert "$OUT/rw.dmg" -format UDZO -imagekey zlib-level=9 -o "$DMG" >/dev/null
rm -rf "$OUT"
echo "Image disque : $DMG"
echo "À joindre à la release v$VERSION : $DMG, $TAR, $TAR.sig, $HERE/latest.json"
