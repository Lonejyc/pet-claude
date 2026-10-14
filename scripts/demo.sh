#!/bin/sh
# Rejoue toutes les animations du pet en simulant les hooks de Claude Code (l'app doit tourner).
# Reste à tester à la main : squeeze (clic), panique et chute (glisser), regard (bouger la souris).
TOKEN=$(cat "$HOME/Library/Application Support/io.github.lonejyc.pet-claude/token" 2>/dev/null)
send() { curl -s -m 1 -o /dev/null -H "X-Pet-Token: $TOKEN" --data "$2" "localhost:4242/$1"; }
tool() { echo "→ $1"; send PreToolUse "{\"tool_name\":\"$1\"}"; sleep 3; }

echo "== Tour réussi : 4 outils, puis confettis + bulle =="
tool Read; tool Bash; tool Edit; tool WebSearch
send Stop '{"last_assistant_message":"🟧 Tout est bouclé, regarde-moi ces confettis !"}'
sleep 7

echo "== Tour avec un échec : inquiet, puis bulle =="
tool Read
echo "→ échec"; send PostToolUseFailure '{"tool_name":"Read","error":"File does not exist"}'
sleep 3
send Stop '{"last_assistant_message":"🟧 Aïe, ce fichier n existe pas du tout. Je regarde ailleurs."}'

echo "== Deux sessions (projets 'boutique' et 'blog') : pastille de projet sur la bulle =="
echo "(pause de 13 s : le budget de répétition interdit au pet de reparler moins de 12 s après sa dernière bulle)"
sleep 13
sess() { send "$1" "{\"session_id\":\"$2\",\"cwd\":\"$3\",\"tool_name\":\"$4\",\"last_assistant_message\":\"$5\"}"; }
A=/Users/demo/boutique; B=/Users/demo/blog
sess SessionStart sess-a $A; sess SessionStart sess-b $B
sess PreToolUse sess-a $A Edit; sess PreToolUse sess-b $B Read; sleep 3
# A termine alors que B travaille encore : le pet reste au travail, la bulle porte la pastille "boutique"
sess Stop sess-a $A "" "🟧 La page panier est corrigée côté boutique."; sleep 8
sleep 13; sess Stop sess-b $B "" "🟧 J'ai relu le blog, rien à signaler ici."; sleep 8
sess SessionEnd sess-a $A; sess SessionEnd sess-b $B
