# PLAN.md — Feuille de route du pet (à copier à la racine du repo)

## Context

Le pet observe Claude Code (hooks → états) et propose un mini-chat. Cette feuille de route le fait passer
de « observateur » à « contrôleur périphérique » (notifications, permissions, drag & drop, raccourci
global), enrichit multi-session / mini-chat / macOS, et refait **les sons** (aujourd'hui 63 lignes
d'oscillateurs purs dans `app/src/sound.ts` : ça sonne « généré »).

Le fichier est conçu pour être consommé par une boucle : **une tâche = un commit local, jamais de push**.

État du repo (exploration) : Tauri 2 / Rust (`app/src-tauri/src/`), front TS sans framework (`app/src/`),
tests uniquement Rust (`cargo test`), **aucun test front, aucun lint**, CI = `tsc --noEmit` + build + `cargo test`.
Hooks écoutés : `EVENTS` dans `setup.rs:9` (5 événements). Settings dupliqués à 3 endroits
(`main.ts`, `settings.ts`, `default_settings` dans `setup.rs:222`).

---

## Protocole de la boucle (à respecter à chaque itération)

Lancement : `/loop Exécute le protocole de PLAN.md (une tâche par itération)` — sans intervalle (auto-rythmé).

1. **Branche** : travailler sur `feat/roadmap` (la créer depuis `main` si absente). Ne jamais committer sur `main`.
2. **Choisir** la première tâche `[ ]` dont toutes les dépendances (`dep:`) sont `[x]` ou `[?]` (`[?]` = code vérifié par les tests, seule la perception humaine reste à valider). La passer à `[~]`.
   Aucune tâche éligible → s'arrêter (`ScheduleWakeup stop`) et résumer.
3. **Cadrer** : relire les fichiers cités, énoncer hypothèses et critères de succès. Doute bloquant →
   passer la tâche à `[!]` avec la raison, ne pas inventer, passer à la suivante.
4. **Implémenter** minimal et chirurgical (règles de `CLAUDE.md` : pas d'abstraction spéculative, style existant,
   réutiliser l'existant, commentaires en français, marqueur `ponytail:` pour un raccourci assumé).
5. **Definition of Done — tout doit être vert avant commit** :
   - [ ] `cd app && npx tsc --noEmit` propre
   - [ ] `cd app && npm test` (vitest, dès T00) vert, avec des tests **écrits pour la tâche** (logique pure)
   - [ ] `cd app/src-tauri && cargo test` vert + `cargo clippy -- -D warnings` sur les fichiers touchés (après T00)
   - [ ] `cd app && npm run build` OK
   - [ ] **Fonctionnalité vérifiée pour de vrai** : lancer l'app (`npm run tauri dev`, skill `run`) et exercer le
         scénario d'acceptation de la tâche ; pour les événements Claude Code, simuler avec `scripts/demo.sh`
         ou un `curl -X POST` sur `127.0.0.1:4242` avec `X-Pet-Token`.
   - [ ] **UI/UX** : capture d'écran (computer-use) ou `app/showcase.html` ; vérifier états, bulle, réglages,
         thème clair/sombre de la fenêtre réglages, pas de régression du click-through ni du drag.
         Si une vérification visuelle/auditive est impossible → NE PAS marquer `[x]` : marquer `[?]`
         (« à valider par l'humain ») et lister exactement quoi regarder/écouter.
   - [ ] Revue du diff (`git diff`) : chaque ligne découle de la tâche ; aucun orphelin laissé ; pas de code mort
         touché hors scope ; clés de réglages ajoutées aux 3 endroits.
   - [ ] Doc : une ligne dans `README.md` (liste des fonctionnalités) si visible utilisateur.
6. **Commit local** (autorisation explicite pour cette boucle, dérogation à « ne commits pas tout seul ») :
   `git add` des seuls fichiers de la tâche + `PLAN.md`, message `feat(Txx): …` (ou `fix`/`test`/`chore`), en français,
   **sans `Co-Authored-By`**, **sans `git push`**. Hooks git non contournés (`--no-verify` interdit).
7. **Mettre à jour PLAN.md** : `[x]` + hash court du commit (même commit que la tâche), ou `[?]` / `[!]` + note.
8. Une seule tâche par itération. Échec répété (2 essais) → `[!]` + diagnostic, tâche suivante.

Légende : `[ ]` à faire · `[~]` en cours · `[x]` terminé et vérifié · `[?]` code fini, validation humaine attendue · `[!]` bloqué.

---

## Tâches

### Phase 0 — Fondations

- [x] **T00 — Infra de tests front + lint** (commit `feat(T00)`)
  Ajouter `vitest` (devDependency) et script `npm test` ; `cargo clippy` dans la CI ; étape `npm test` dans
  `.github/workflows/ci.yml`. Un premier test sur `sessions.ts` (`touch`/`prune`/`color`).
  *Accept.* : `npm test`, `cargo clippy -- -D warnings`, CI mise à jour. *Fichiers* : `app/package.json`, `ci.yml`.

- [?] **T01 — Événements de hooks étendus + correctif BUG.md n°1 et n°2**  dep: T00
  *Fait (commit `feat(T01)`)* : tests auto verts, 3 hooks reçus en vrai (200) et migration des `settings.json` constatée.
  *À valider par l'humain* : (1) lancer Bash dans Claude Code → le clavier s'arrête dès que la commande finit ; (2) Échap pendant un outil → le pet se rendort après ~10 min sans activité (ou aussitôt qu'un nouveau prompt est envoyé : il passe « au travail » proprement).
  Ajouter `PostToolUse`, `UserPromptSubmit`, `Notification` à `EVENTS` (`setup.rs:9`, taille du tableau) et au
  routage `server.rs` ; l'événement Tauri `hook` transporte déjà `{event, session, cwd, tool, message}`.
  `main.ts:111-145` : `PostToolUse` coupe le clavier (BUG n°2) ; `UserPromptSubmit` remet `busy=false` puis `true`
  et un timeout de sécurité (~10 min sans hook) libère la session (BUG n°1, `sessions.ts:49`).
  `refresh_hooks_if_outdated` doit migrer les hooks déjà installés.
  *Accept.* : tests Rust (hook valide/refusé, migration), test vitest du timeout ; Échap pendant un outil → le pet
  se rendort ; le clavier s'arrête à la fin de la commande. Mettre à jour `BUG.md` (n°1, n°2 corrigés).

### Phase 1 — Sons (demande prioritaire : « trop simple, trop IA »)

Diagnostic : un oscillateur + une rampe exponentielle = timbre « bip 8-bit » identique partout, aucune
variation, aucun bruit, aucune pièce. Pistes : bruit filtré, FM/harmoniques inharmoniques, attaque/déclin
multi-couches, micro-variations aléatoires, courte réverb, mastering (compresseur doux).

- [?] **T02 — Moteur audio** dep: T00
  *Fait (commit `feat(T02)`)* : `audio-math.ts` (+ tests) et moteur dans `sound.ts` : bus master, réverb de pièce (convolver), bruit rose, `voice`/`noiseHit`, humanisation, variantes sans répétition. Pas de compresseur : celui de Chrome écrasait les sons faibles ~4x (mesuré). Niveaux mesurés hors ligne = ceux de l'ancien moteur, 10 sons finis, non silencieux, pics < 0,15.
  *À valider par l'humain* : écouter `key` (clac + 3 hauteurs) et `tada` (avec réverb) dans l'app ; vérifier l'absence de clics.
  Refondre le cœur de `sound.ts` : bus master (`DynamicsCompressor` + `GainNode` volume), buffer de bruit blanc/rose
  partagé, helpers `noiseHit(filtre, durée, enveloppe)` et `layer([...])`, réverb de pièce courte (`ConvolverNode`
  avec impulsion générée une fois), humanisation (détune ±, vitesse/volume aléatoires, round-robin pour ne jamais
  rejouer deux fois le même son). Conserver l'API publique `sound.*`, `setSoundConfig`, la reprise après veille.
  *Accept.* : tests vitest sur les fonctions pures (enveloppes, tirage round-robin, mapping volume) ; aucun clic/
  saturation à fort volume ; `[?]` écoute humaine.

- [?] **T03 — Refonte des 10 sons existants** dep: T02
  *Fait (commit `feat(T03)`)* : les 10 sons sont en 2 à 4 couches (bruit filtré, corps résonnants, partiels inharmoniques, réverb) ; banc d'écoute `app/sounds.html` (`npm run dev` puis `/sounds.html`). Mesuré hors ligne : aucun son silencieux ni invalide, niveaux dans la plage de l'ancien moteur.
  *À valider par l'humain* : écouter chaque son sur `sounds.html` (surtout `tok`, `key`, `crash`, `tada`, `blip`) et dire lesquels sonnent encore « générés » : on affine les paramètres de `sound.ts`.
  `tok` (marteau : transitoire bruit + corps boisé résonant), `key` (clic mécanique : bruit bandpass + « thock »
  grave, 3-4 variantes), `crash` (cymbale : bruit filtré + partiels métalliques inharmoniques, longue décroissance),
  `thump`, `tada` (timbre de cloche/marimba, pas un arpège carré), `blip` (voix : formants simples), `squish`,
  `boing`, `worried`, `yelp`. Un fichier de démo `app/sounds.html` (ou section de `showcase.html`) pour réécouter
  chaque son en un clic.
  *Accept.* : chaque son a ≥2 couches ; page de démo ; `[?]` validation à l'oreille par l'humain.

- [?] **T04 — Sons adaptatifs + mode « Discrétion absolue »** dep: T03, T01
  *Fait (commit `feat(T04)`)* : `toolPace` (écart entre outils → hauteur et cadence des frappes) et `soundAllowed` dans `audio-math.ts` (testés) ; réglage `soundMode` (`all` | `alerts`) dans les 3 endroits + menu « Quels sons » dans les réglages. Mesuré hors ligne sur le vrai moteur : mode alertes = `key` et `blip` muets, `tada` audible ; pitch 0,85 vs 1,2 = 33 vs 42 passages par zéro.
  *À valider par l'humain* : ouvrir les Réglages (le menu « Quels sons » est bien aligné, grisé quand les sons sont coupés) ; lancer plusieurs outils d'affilée et comparer à un outil isolé.
  Pitch/cadence du `key`/`tok` modulés par la vitesse des outils (délai entre `PreToolUse` successifs). Nouveau
  réglage `soundMode: "all" | "alerts"` (alertes = erreur + fin de tâche uniquement) dans les 3 endroits + UI réglages.
  *Accept.* : tests vitest du mapping vitesse→pitch et du filtre de mode ; réglage visible et appliqué à chaud.

### Phase 2 — Contrôleur périphérique

- [?] **T05 — Notification de fin de tâche + focus terminal** dep: T01
  *Fait (commit `feat(T05)`)* : hook `file` (Rust) ; `session.files` + `editSummary` (testés) ; commandes natives `frontmost_app` (NSWorkspace) et `focus_app` (`open -b`, bundle id validé, testé) ; terminal = app active au `UserPromptSubmit` ; à `Stop`, si l'app active a changé : saut (`.hop`) + `tada` (sauf si les confettis l'ont joué) ; bulle « … · N fichiers modifiés », cliquable pour refocaliser. Vérifié en vrai : les événements simulés répondent 200, binaire recompilé. **Non vérifié visuellement** : la capture d'écran ne montrait pas le pet (masqué ou hors écran ?), donc ni le saut, ni la bulle, ni le clic n'ont été vus.
  *À valider par l'humain* : lancer un tour dans iTerm, passer sur une autre app avant la fin → le pet saute, la bulle affiche « N fichiers modifiés », un clic sur la bulle revient à iTerm. Fonctionne par app, pas par onglet (limite assumée).
  Sur `Stop` : saut + son `tada`/alerte, micro-résumé dans la bulle (déjà : première phrase de
  `last_assistant_message`) enrichi de « N fichiers modifiés » (compter les `PreToolUse` Edit/Write de la session).
  Clic sur la bulle → focus de la fenêtre/onglet du terminal via le `cwd` de la session (commande Rust, `open`/
  AppleScript ; fallback : activer l'app terminal frontale). Seulement si l'app terminal n'est pas déjà au premier plan.
  *Accept.* : test vitest du compteur ; scénario manuel avec Terminal/iTerm ; `[?]` si le focus par onglet n'est pas fiable.

- [x] **T06 — Spike : validation des permissions en un clic** dep: T01 (commit `feat(T06)`)
  Verdict : **faisable**, prouvé avec un vrai Claude Code (allow, deny, hook bloquant). Détails, format et limites : `docs/spike-permissions.md`.
  Reste à vérifier à la main avant T06b : comportement du dialogue du terminal quand le pet ne répond pas (non testable avec `claude -p`).

- [x] **T06b — Socle Rust des permissions** dep: T06 (commit `feat(T06b)`)
  *Vérifié en vrai* sur le pet relancé : sans jeton 403 ; avec jeton la requête est retenue 20 s puis corps vide (200) ; un autre hook répond en 1 ms pendant l'attente. 32 tests Rust (format JSON exact, expiration, clic tardif refusé, `is_ours`). Le chemin « clic → `decide` » est testé en unitaire, de bout en bout en T06c.
  Route `PermissionRequest` qui retient la requête HTTP jusqu'à la décision ou 20 s (corps vide à l'expiration = pas de décision) ; commande `decide(id, allow)` ; jamais d'allow par défaut ; seuls `behavior`/`message` sont renvoyés ; `is_ours` (`setup.rs`) élargi à `curl -s -m `.
  **Ne pas encore installer le hook chez l'utilisateur** (le pet de dev migre ses `settings.json` au démarrage : sans bulle, chaque demande de permission attendrait 20 s pour rien) : l'installation du hook (`timeout: 30`, `curl -s -m 25`) se fait en T06c.
  *Accept.* : tests Rust (décision → JSON exact, expiration → corps vide, désinstallation retire bien le hook, hooks existants intacts, `EVENTS` + migration).

- [?] **T06c — Bulle « Autoriser / Refuser »** dep: T06b
  *Fait (commit `feat(T06c)`)* : hook `PermissionRequest` installé (`timeout: 30`, `curl -m 25`, hooks de l'utilisateur conservés, désinstallation sélective, testé) ; `permission.ts` (file, décompte, expiration, description tronquée ; testé) ; carte « Autoriser / Refuser » (clic, Entrée/Échap) qui remplace la bulle ; saut + `yelp` (ajouté aux alertes du mode discret) ; pet masqué = rendu immédiat au terminal. **Vérifié visuellement** dans Chrome headless sur la vraie page avec un faux Tauri (rendu, file « +1 en attente », clics → `decide` avec les bons ids). Le hook est installé dans tes `settings.json` par le pet de dev.
  *À valider par l'humain (fenêtre réelle)* : (1) provoquer une vraie permission dans Claude Code : la carte apparaît au-dessus du pet, les boutons répondent au clic sur le panneau non activant ; (2) ne rien faire pendant 20 s : le dialogue du terminal reprend la main ; (3) pet fermé : le dialogue du terminal s'affiche normalement ; (4) répondre dans le terminal pendant que la carte est affichée : noter ce qui se passe.
  Installer le hook `PermissionRequest` (`timeout: 30`, `curl -s -m 25`, migration incluse), puis bulle avec outil et commande tronquée (`textContent`), décompte, raccourcis (Entrée/Échap), file d'attente, retour au dialogue du terminal à l'expiration.
  *Accept.* : test vitest de la file et du décompte ; scénario réel avec un `rm` ou un `git push` simulé ; `[?]` pour la vérification en session interactive.

- [ ] **T07 — Raccourci clavier global (⌘⇧C) → mini-chat au centre de l'écran actif** dep: T00
  Plugin `tauri-plugin-global-shortcut` (nouvelle dépendance justifiée : pas de natif simple) + capability.
  Fait apparaître le chat même pet caché/autre écran ; réglage pour désactiver/changer le raccourci.
  *Accept.* : fonctionne pet caché, écran secondaire, plein écran d'une autre app ; pas de conflit détecté ; `Échap` ferme.

- [ ] **T08 — Glisser-déposer sur le pet (capture, log, URL)** dep: T00
  Activer le drag & drop de fichiers de la fenêtre (Tauri `drag-drop`), ouvrir le mini-chat avec la pièce jointe :
  chemin passé à `claude -p` (le fork a `Read` : fichiers/images OK), URL passée en texte. Refuser > N Mo et
  types inconnus ; nécessite la hit-region du pet pendant le drag (click-through, `native.rs`).
  *Accept.* : test vitest de classification (image/log/URL/refus) ; dépôt d'un PNG → réponse de Claude qui le décrit.

### Phase 3 — Mini-chat enrichi

- [ ] **T09 — Actions rapides contextuelles** dep: T01
  3 boutons au double-clic selon le dernier événement (fin de tâche → « Explique ce que tu viens de changer » /
  « Y a-t-il des effets de bord ? » ; erreur → « Résume l'erreur en 2 lignes »). Logique pure `quickActions(state)` testée.
  *Accept.* : boutons visibles, clic = envoi, accessibles au clavier.

- [ ] **T10 — Historique éphémère + bouton « Copier le code »** dep: T09
  Garder les 4 dernières réponses du chat en mémoire (pas de persistance disque), navigation ←/→, détection des
  blocs de code et bouton copier (`navigator.clipboard`). *Accept.* : test vitest de l'extraction des blocs ; copie vérifiée.

### Phase 4 — Multi-session

- [ ] **T11 — Indicateur d'attention + cycle entre sessions** dep: T01
  Le pet prend la couleur (`sessions.ts` `color`) de la session qui attend (`Notification`/erreur) ; clic droit ou
  molette cycle les sessions (la bulle suit `mostRecent` → session choisie). Garde la pastille `#bubble-tag`.
  *Accept.* : tests vitest (priorité attention > récent, cycle circulaire) ; démo 2-3 sessions via `scripts/demo.sh`.

### Phase 5 — Santé du dépôt

- [ ] **T12 — Nervosité : gros diff et échecs répétés** dep: T01
  Rust : commande `git_diff_size(cwd)` (`git diff --shortstat`, cache 30 s, jamais bloquant, ignorée hors dépôt).
  Front : > 500 lignes → état « transpire » (nouvelle variante visuelle) ; 3 `PostToolUseFailure` consécutifs sur la
  même commande → « nerveux ». Seuils en constantes. *Accept.* : tests du parsing shortstat et du compteur d'échecs ;
  rendu des deux animations validé visuellement.

- [ ] **T13 — Célébration : commit réussi, tests/build qui repassent au vert** dep: T12
  Détecter `git commit` dans `PreToolUse` Bash puis `PostToolUse` OK ; commande test/build qui échoue puis réussit.
  Animation + son dédiés (réutilise confetti/`tada`). *Accept.* : tests de la machine à états ; pas de faux positifs
  sur `git commit --amend --dry-run`, etc.

### Phase 6 — Ergonomie macOS

- [ ] **T14 — Mode furtif pendant visio / partage d'écran** dep: T00
  Détecter Zoom/Meet/Teams/Slack Huddle (`NSWorkspace` runningApplications côté `objc2`) ; le pet se réduit/se perche
  en haut ; réglage on/off. Meet = navigateur : limiter à la détection d'apps natives, documenter la limite.
  *Accept.* : test de la liste de bundle IDs ; bascule automatique au lancement/fermeture de Zoom.

- [ ] **T15 — Coût de la session en cours + % de contexte** dep: T01
  `local_usage.rs` : lire le `.jsonl` de la session courante (transcript de la session du hook) → coût session
  (`PRICES` existant) et taux de remplissage = tokens de contexte du dernier message / fenêtre du modèle (table des
  fenêtres, `ponytail:` si approximatif). Affichage au survol du pet + ligne dans le menu (`menu.rs`) ; alerte
  douce à 80 %. *Accept.* : tests Rust sur un `.jsonl` de fixture (coût, %, dédoublonnage).

### Phase 7 — Gamification

- [ ] **T16 — Succès locaux qui débloquent des accessoires** dep: T01, T12
  Compteurs persistés (fichier local `~/.claude/pet-stats.json` ou clé de réglages, jamais envoyés) :
  100 fichiers modifiés → casque de chantier ; 10 builds/tests réparés → lunettes de soleil ;
  session sans erreur d'outil → auréole/couronne (existants, à verrouiller). Nouveaux accessoires : casque,
  lunettes (`skins.ts`, `.acc-*`, `pet3d.ts`). UI réglages : accessoires verrouillés grisés + condition.
  *Accept.* : tests des règles de déblocage ; rendu des 2 nouveaux accessoires ; aucune donnée ne sort de la machine.

### Phase 8 — Clôture

- [ ] **T17 — Doc et notes de version** dep: toutes
  README (fonctionnalités, sécurité/vie privée : drag & drop, permissions, raccourci), `docs/releases/0.1.0-beta.7.md`
  (format existant), `BUG.md` à jour. Vérifier que les hooks/permissions documentés dans « Ce qui est modifié sur
  ta machine » sont exacts. *Accept.* : relecture croisée README ↔ code.

---

## Vérification globale (fin de roadmap)

1. `cd app && npx tsc --noEmit && npm test && npm run build`
2. `cd app/src-tauri && cargo test && cargo clippy -- -D warnings`
3. `npm run tauri build -- --bundles app`, lancement manuel : parcours complet (hooks simulés, chat, drag & drop,
   raccourci, sons, réglages, multi-session, hide/show).
4. `git log --oneline main..feat/roadmap` : un commit par tâche, aucun `Co-Authored-By`, rien de poussé.

## Points ouverts / risques à connaître

- **T06** peut être infaisable selon ce que les hooks Claude Code permettent (blocage + réponse) : d'où le spike.
- **Sons** : la qualité se juge à l'oreille ; la boucle ne peut que produire (`[?]`) — prévoir une écoute humaine
  après T03/T04.
- **Dépendances ajoutées** : `vitest` (T00), `tauri-plugin-global-shortcut` (T07) ; tout le reste = existant.
- **Duplication des réglages** (3 endroits) : à respecter, pas à refactorer dans ce chantier.
