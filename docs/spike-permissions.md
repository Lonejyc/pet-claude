# Spike T06 : valider une permission en un clic depuis le pet

**Verdict : faisable.** Le hook `PermissionRequest` de Claude Code est bloquant et accepte une décision `allow` / `deny` en JSON.
Le pet peut donc afficher « Autoriser / Refuser » et répondre à la place de la boîte de dialogue du terminal.
Une réserve à vérifier à la main (ci-dessous) : le comportement en session interactive quand le hook ne répond pas.

## Ce qui a été prouvé avec un vrai Claude Code (2.1.326)

Prototype : un script de hook qui enregistre la charge utile reçue, attend `DELAY` secondes, puis répond `allow` ou `deny`.
Lancé via `claude -p "… touch <fichier>" --settings <hook> --setting-sources project --permission-mode default` dans un dossier temporaire.

| Cas | Résultat |
|---|---|
| Hook répond `allow` | la commande Bash s'exécute, le fichier est créé |
| Hook répond `deny` + `message` | la commande n'est pas exécutée ; Claude cite le message (« Refusé depuis le prototype du pet ») |
| Hook répond `allow` après 5 s | Claude attend : 12 s au total contre 8 s sans attente, le fichier est créé → **le hook est bloquant** |

Charge utile reçue sur stdin (réelle) : `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort`,
`hook_event_name: "PermissionRequest"`, `tool_name`, `tool_input` (ex. `{"command": "touch slow.txt", "description": "…"}`),
`permission_suggestions` (optionnel). Pas de `tool_use_id`.

## Format de réponse (stdout, exit 0)

```json
{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}
{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Refusé depuis le pet"}}}
```

- Le pet n'utilisera **que** `behavior` et `message`. Pas de `updatedInput` ni de `updatedPermissions` (le pet ne réécrit pas les commandes
  et ne modifie pas les règles de permission de l'utilisateur).
- Les règles `deny`/`ask` de l'utilisateur restent évaluées : un « Autoriser » ne contourne pas un refus explicite.
- Exit 2 n'est **pas** pris en compte pour cet événement ; tout code autre que 0 est une erreur non bloquante (la décision est ignorée).
- Sans réponse (sortie vide, hook en échec, timeout), le flux de permission continue normalement.

## Limites et risques

1. **Timeout** : 600 s par défaut. Il faut fixer `"timeout"` (en secondes) sur le hook du pet, sinon Claude attend jusqu'à 10 min si le pet
   ne répond jamais.
2. **Hook en `curl`** : la commande actuelle (`curl -s -m 1 … || true`) coupe à 1 s. Pour cet événement : `curl -s -m 25 …` (stdout du curl = JSON
   renvoyé par le pet) avec `"timeout": 30`. `|| true` garde exit 0 si le pet est fermé → pas de décision → dialogue normal du terminal.
3. **`is_ours` (`setup.rs`)** reconnaît les hooks du pet par le préfixe `curl -s -m 1 ` : à élargir à `curl -s -m ` sous peine de ne plus
   savoir retirer ce hook à la désinstallation.
4. **Non vérifié (à tester à la main en session interactive)** : (a) quand le pet est fermé ou ne répond pas, le dialogue du terminal
   s'affiche bien ; (b) pendant que le hook attend, le dialogue est-il déjà visible dans le terminal, et que se passe-t-il si on y répond
   avant le pet ? La doc ne le dit pas pour le terminal. `claude -p` ne peut pas le tester (il ne peut pas afficher de dialogue).
5. **Attente perçue** : si l'utilisateur ignore le pet, la boîte du terminal peut apparaître après le délai du hook. Délai du pet : 20 s
   au plus, avec décompte visible.
6. **Hooks en parallèle** : les hooks `PermissionRequest` d'autres outils (ex. un statut iTerm) tournent en même temps, sans conflit.

## Sécurité

- Le serveur reste en `127.0.0.1` avec `Host` vérifié et `X-Pet-Token` obligatoire (déjà en place dans `server.rs`).
- Une décision ne naît que d'un **clic dans la fenêtre du pet** (commande Tauri `decide`, appelée par le front). Aucune route HTTP ne
  permet d'approuver : un processus local ne peut pas s'auto-autoriser en postant sur le port 4242.
- La commande affichée (`tool_input`) est tronquée et rendue en texte (`textContent`), jamais interprétée ni exécutée.
- Une demande sans réponse retombe sur le comportement normal (jamais d'« allow » par défaut).

## Découpage proposé

- **T06b : socle Rust.** Hook `PermissionRequest` installé avec `timeout` et `curl -m 25` ; `is_ours` élargi ; route qui **retient** la requête
  HTTP (canal par identifiant) jusqu'à la décision ou 20 s ; commande `decide(id, allow)` ; tests (timeout → corps vide, décision
  → JSON exact, plus de `allow` par défaut).
- **T06c : interface.** Bulle « Autoriser / Refuser » avec outil et commande tronquée, décompte, raccourcis (Entrée / Échap quand la bulle a
  le focus), file d'attente si plusieurs demandes, retour au dialogue du terminal à l'expiration.
