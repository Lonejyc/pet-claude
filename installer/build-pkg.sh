#!/bin/sh
# Construit l'installateur macOS : installer/pet-claude-<version>.pkg (écrans d'accueil, case à cocher par option, lancement final).
set -e
. "$HOME/.cargo/env"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/build"
VERSION=$(python3 -c "import json;print(json.load(open('$HERE/../app/src-tauri/tauri.conf.json'))['version'])")
ARCH=$(uname -m)

rm -rf "$OUT"; mkdir -p "$OUT/payload/Applications"
(cd "$HERE/../app" && npm run tauri build -- --bundles app)
cp -R "$HERE/../app/src-tauri/target/release/bundle/macos/pet-claude.app" "$OUT/payload/Applications/"
codesign --force --deep --sign - "$OUT/payload/Applications/pet-claude.app"   # signature ad hoc : requise pour lancer un binaire arm64

pkgbuild --root "$OUT/payload" --identifier fr.perso.petclaude.app --version "$VERSION" --install-location / --scripts "$HERE/scripts/app" "$OUT/app.pkg"
for c in hooks login style launch; do
  pkgbuild --nopayload --identifier "fr.perso.petclaude.$c" --version "$VERSION" --scripts "$HERE/scripts/$c" "$OUT/$c.pkg"
done
sed "s/__VERSION__/$VERSION/g; s/__ARCH__/$ARCH/g" "$HERE/distribution.xml" > "$OUT/distribution.xml"
productbuild --distribution "$OUT/distribution.xml" --resources "$HERE/resources" --package-path "$OUT" "$HERE/pet-claude-$VERSION.pkg"
echo "Installateur : $HERE/pet-claude-$VERSION.pkg"
