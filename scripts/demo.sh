#!/bin/sh
# Rejoue toutes les animations du pet en simulant les hooks de Claude Code (l'app doit tourner).
# Reste à tester à la main : squeeze (clic), panique et chute (glisser), regard (bouger la souris).
send() { curl -s -m 1 -o /dev/null --data "$2" "localhost:4242/$1"; }
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
