<p align="center"><img src="docs/images/icone.png?v=2" alt="Le pet : un bloc orange en 3D avec un bonnet de Noël" width="180"></p>

<h1 align="center">pet-claude</h1>

<p align="center">Un petit compagnon 3D qui vit sur ton bureau macOS et réagit à ce que fait <b>Claude Code</b> :<br>
il lit avec des lunettes, tape sur son clavier, martèle quand Claude modifie un fichier,<br>
s'inquiète quand une commande échoue, et te répond dans une bulle.</p>

<p align="center"><img src="docs/images/etats.png?v=2" alt="Les états du pet : au repos, lit, tape, modifie, cherche, s'inquiète, dort, sue, et un skin violet avec couronne" width="100%"></p>

---

# Pour les utilisateurs

## Installer
1. Télécharge `pet-claude-<version>.dmg` depuis la [page des releases](https://github.com/Lonejyc/pet-claude/releases) et ouvre-le.
2. Glisse `pet-claude.app` sur **Applications**, puis lance-la. Elle n'est pas signée par un compte développeur Apple : **clic droit sur l'app, Ouvrir** la première fois.
3. À la toute première ouverture, l'app active seule les hooks Claude Code et le lancement au démarrage. Rien n'est refait ensuite : tout se change dans les Réglages.
4. Relance tes sessions Claude Code déjà ouvertes pour que le pet les voie.

Prérequis : macOS sur Apple Silicon, [Claude Code](https://claude.com/claude-code). Pour désinstaller : `./scripts/uninstall.sh` (retire les hooks, le lancement au démarrage et l'app).

## Ce qu'il fait
- **Réagit en direct** à toutes tes sessions Claude Code via leurs hooks, avec une pastille de couleur par projet et un halo quand une session a besoin de toi.
- **Mini-chat** (double-clic, ou ⌃⌥ Espace) : une question part dans une *copie* en lecture seule de la session choisie ; ta session du terminal n'est pas modifiée. Dépose une capture ou un log sur le pet pour le joindre.
- **Te prévient** d'une fin de tâche quand tu es dans une autre app ; un clic sur la bulle ramène ton terminal.
- **Valide tes permissions en un clic** (« Autoriser / Refuser ») ; sans clic sous 20 s, la boîte de dialogue de ton terminal reprend la main. Le pet ne dit jamais « oui » à ta place.
- **Suit ton travail** : sueur au-delà de 500 lignes non commitées, confettis après un commit, saut quand un test ou un build repasse au vert, coût et contexte de la session au survol.
- **Reste discret** : mode furtif pendant tes appels (micro utilisé), visible au-dessus des apps en plein écran, sons synthétisés réglables.
- **Se personnalise** : taille, couleur, accessoires (dont certains à débloquer avec l'usage), et un thème de Noël (bonnet, bois de renne, grelots), actif en décembre sauf choix contraire.

| Geste | Effet |
|---|---|
| Clic / glisser / lâcher | il s'écrase / se déplace / rebondit |
| Double-clic ou ⌃⌥ Espace | mini-chat (Tab change de session, ⌥1 ⌥2 ⌥3 actions rapides) |
| Molette ou clic droit | feuillette les sessions |
| Icône de la barre de menus | usage, masquer le pet, Réglages, Quitter |
| `/settings`, `/quit`, `/emote` dans le champ | idem au clavier, ou joue une emote |

## Vie privée et ce qui est modifié
- Fichiers touchés : `/Applications/pet-claude.app`, `~/.claude/settings.json` (neuf hooks ajoutés à côté des tiens, sauvegarde dans `settings.json.bak-pet-claude`), `~/Library/LaunchAgents/io.github.lonejyc.pet-claude.plist` (optionnel) et `~/Library/Application Support/io.github.lonejyc.pet-claude/` (réglages, compteurs de succès, secret).
- Lecture seule : transcripts `~/.claude/projects/**` (coût estimé), `~/.claude.json` et le token du Keychain (limites du forfait, envoyé uniquement à `api.anthropic.com`).
- Aucune donnée ne quitte ta machine, sauf ce que Claude lit lui-même : une question du mini-chat ou un fichier déposé est un appel normal à Claude.
- Le serveur local écoute sur `127.0.0.1:4242` seulement, n'accepte que les requêtes portant son secret, et aucune route ne peut approuver une permission : seul un clic dans la fenêtre du pet le peut. Le mini-chat n'a que `Read`, `Grep` et `Glob`.

## Limites connues
- Apple Silicon uniquement, app non notarisée.
- Un seul pet à la fois (version de développement et version installée ne se partagent pas les hooks).
- Le pet ne connaît que les sessions qui lui ont envoyé un hook depuis son lancement.
- Les limites du forfait viennent d'un endpoint Anthropic non documenté ; le coût affiché est une estimation, pas ta facture.
- Le focus au clic sur la bulle se fait par app, pas par onglet de terminal.

---

# Pour les développeurs

## Démarrer
```sh
cd app && npm install && npm run tauri dev      # pet en développement (Rust requis)
cd app && npm test && npm run build && cd src-tauri && cargo test && cargo clippy -- -D warnings   # tests et lint (la CI fait pareil)
./scripts/demo.sh                               # rejoue toutes les animations sans Claude
./scripts/make-icon.sh                          # régénère l'icône (serveur de dev lancé)
./scripts/make-readme-images.sh                 # régénère les images du README
./installer/build-dmg.sh                        # image disque .dmg (méthode recommandée)
./installer/build-pkg.sh                        # installateur .pkg avec cases à cocher
```
Stack : Tauri 2, TypeScript (Vite, Vitest), CSS 3D, `tauri-nspanel`, `tauri-plugin-global-shortcut`, objc2 pour AppKit.

## Architecture
```
Claude Code ──hooks (curl + X-Pet-Token)──> server.rs (127.0.0.1:4242) ──événements──> fenêtre du pet (src/main.ts)
                                                                         ^
setup.rs (hooks, login, réglages, 1re ouverture) ── Réglages (settings.html/ts)
chat.rs (mini-chat : claude -p --resume --fork-session)   permission.rs (Autoriser/Refuser)
native.rs (NSPanel, souris, écrans)   menu.rs (barre de menus)   mic.rs (mode furtif)   local_usage.rs (coût, contexte)
```
- `app/src-tauri/src/` : le côté natif. Fenêtre en `NSPanel` non activant, positions et souris en coordonnées natives macOS (les conversions de Tauri se mélangent entre écrans d'échelles différentes). Toutes les fonctions de `setup.rs` ont une variante `*_in(home)` testable sur un faux dossier personnel.
- `app/src/` : le pet (`pet3d.ts` construit les pavés CSS 3D, `skins.ts` couleurs et accessoires), la logique pure et testée (`sessions.ts`, `celebrate.ts`, `nervous.ts`, `achievements.ts`, `audio-math.ts`, `christmas.ts`…), les sons WebAudio (`sound.ts`, aucun fichier audio) et les Réglages.
- `installer/` (`build-dmg.sh`, `build-pkg.sh`), `scripts/` (outils), `docs/releases/` (notes de chaque version), `docs/spike-permissions.md` (comment fonctionne la validation de permissions).
- À la première ouverture depuis `/Applications`, l'app active hooks et lancement au démarrage une seule fois (marqueur `configured`, cf. `first_run_in`). Le `.pkg` écrit ce marqueur lui-même (`--mark-configured`).
- Options en ligne de commande (utilisées par le `.pkg`) : `--install-hooks`, `--remove-hooks`, `--enable-login`, `--disable-login`, `--status`.

## Direction artistique
- Un **bloc orange pixelisé en volume** (11 pavés CSS 3D, arêtes nettes, aucune texture) : orange `#e8793c` en face avant, plus clair dessus, plus sombre sur les côtés ; yeux rectangulaires `#1a1a1a`. Il doit être attachant avant d'être utile, et lisible à 150 px.
- Icône : le pet sur un carré arrondi graphite (`#4a4a52` → `#1c1c21`), barre de menus : silhouette 2D noir et blanc (image « template »).
- Un accessoire par famille d'outils (lunettes, clavier, marteau et enclume, jumelles) plutôt qu'un état « occupé » générique ; yeux plissés `> <` réservés à l'inquiétude.
- Mouvement : squash & stretch, rythmes espacés plutôt que continus, physique de lancer avec gravité et rebonds. Le pet parle peu (délai réglable, 12 s par défaut).
- Voix : bulle de BD (fond blanc, contour de 3 px `#222`, ombre dure), une phrase de 60 caractères maximum, malicieuse mais bienveillante.

## Contribuer
Les modifications de `~/.claude/settings.json` doivent rester atomiques, sauvegardées, et refusées sans rien écrire si le fichier n'est pas du JSON valide. Une décision de permission ne doit jamais pouvoir venir d'une route du serveur local. Lance les tests et le lint avant d'ouvrir une PR.

## Licence
Code sous **licence MIT** ([`LICENSE`](LICENSE)) ; licences des dépendances dans [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md). pet-claude est un projet indépendant, non affilié à Anthropic ; « Claude » et « Claude Code » sont des marques d'Anthropic. Logiciel fourni « tel quel », sans garantie.
