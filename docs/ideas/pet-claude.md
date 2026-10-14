# Pet Claude : compagnon flottant branché sur Claude Code

## Problem Statement
Comment donner à Claude Code une présence visuelle et attachante, un pet
qui réagit à l'état réel de mon travail, sans reconstruire une interface
de chat ni polluer les réponses techniques ?

## Recommended Direction
Un pet-instrument d'abord, un pet-pilote ensuite. Une fenêtre Tauri
transparente, toujours au premier plan, reçoit les événements des hooks
de Claude Code via un petit serveur HTTP local et les traduit en
animations et en bulles courtes. Claude Code reste l'outil de travail
dans le terminal : le pet n'est pas une interface, c'est un témoin vivant.

La personnalité passe par un output style (ou un bloc CLAUDE.md), donc
c'est Claude lui-même qui répond en personnage, sans appel LLM
supplémentaire. En v2, une zone de saisie dans la fenêtre du pet permet
des questions rapides en personnage (`claude -p`), hors session
principale.

Le critère de succès est l'effet en démo : une réaction visuelle claire
et juste vaut mieux que dix réactions bavardes.

## Key Assumptions to Validate
- [ ] Les hooks exposent assez d'infos (outil, dernier message, résultat)
      pour alimenter le pet → faire un hook `Stop` qui poste le payload
      sur un serveur local et logger ce qu'on reçoit.
- [ ] Un output style fait répondre en personnage sans dégrader la
      qualité technique → comparer 5 prompts réels avec et sans.
- [ ] Une fenêtre Tauri transparente et always-on-top se comporte bien
      sur macOS (Spaces, plein écran, clics traversants) → prototype
      vide de 30 minutes.
- [ ] Le pet reste agréable après 2 jours d'usage → budget de
      répétition (1 réaction max toutes les X minutes) et test réel.

## MVP Scope
Dedans :
- Fenêtre Tauri transparente avec 1 pet (SVG ou emoji animé en CSS)
- 3 à 4 états : repos, travaille, content, inquiet
- Serveur HTTP local recevant les hooks `PreToolUse`, `Stop` et échec
  de test
- Bulle de texte courte alimentée par le dernier message de Claude
- Personnalité via un output style

Dehors : tout ce qui figure dans la liste ci-dessous.

## Not Doing (and Why)
- Interface de chat complète : Claude Code le fait déjà mieux.
- Mini-chat dans la fenêtre : prévu en v2, une fois les hooks validés.
- Mémoire en fichier markdown : demande un pet stable d'abord.
- Mécaniques de Tamagotchi (faim, fatigue, niveau) : risque de bruit,
  à ajouter seulement si le pet reste agréable.
- Génération de pet par description : séduisant, mais hors du noyau.
- Pet qui exécute des actions (PR, commandes) : permissions et sécurité
  hors sujet pour une v1.
- Pixel art animé à la main : mange le temps pour un gain faible au début.

## Open Questions
- Quel animal et quelle personnalité (sarcastique, zen, paresseux) ?
- Le pet commente-t-il chaque message ou seulement les moments clés ?
- Comment relier la bulle au bon message quand plusieurs sessions
  Claude Code tournent en parallèle ?
- Quel format pour le payload des hooks, et que contient-il vraiment ?
