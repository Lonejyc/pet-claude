<p align="center"><img src="docs/images/icone.png?v=2" alt="Le pet : un bloc orange en 3D" width="180"></p>

<h1 align="center">pet-claude</h1>

<p align="center">Un petit compagnon 3D qui vit sur ton bureau macOS et réagit à ce que fait <b>Claude Code</b> :<br>
il lit avec des lunettes, tape sur son clavier, martèle quand Claude modifie un fichier,<br>
s'inquiète quand une commande échoue, et te répond dans une bulle.</p>

<p align="center"><img src="docs/images/etats.png?v=2" alt="Les états du pet : au repos, lit, tape, modifie, cherche, s'inquiète, dort, sue, et un skin violet avec couronne" width="100%"></p>

> **Beta** : testé sur macOS (Apple Silicon) avec Claude Code. Voir « Limites connues ».
> Téléchargement : [page des releases](https://github.com/Lonejyc/pet-claude/releases).

## Ce qu'il fait
- **Réagit en direct** à toutes tes sessions Claude Code (quel que soit le dossier) via leurs hooks.
- **Reconnaît tes sessions** : une pastille (nom du projet + couleur) étiquette chaque bulle quand plusieurs sessions sont ouvertes. Quand l'une d'elles a besoin de toi
  (permission, question, erreur), le pet s'entoure d'un halo à sa couleur ; molette ou clic droit sur le pet pour feuilleter les sessions et relire leur dernier message.
- **Mini-chat** : double-clic sur le pet, tape une question. Elle part dans une *copie* de la session choisie
  (`claude -p --resume --fork-session`, lecture seule) : ta session du terminal n'est pas modifiée. `Tab` change de session.
  Sans session ouverte, il répond aux questions générales mais ne lit aucun fichier : pour une question sur un dossier,
  il te demande d'ouvrir Claude Code dans un terminal, dans ce dossier.
- **Te prévient** quand une tâche est finie pendant que tu es dans une autre app : il saute, la bulle indique le nombre de fichiers modifiés,
  et un clic sur la bulle ramène au premier plan l'app où tu as tapé ton dernier prompt (ton terminal). Pour ça, il lit le nom de l'app
  active (macOS) à chaque prompt et à chaque fin de tâche ; rien n'est enregistré ni envoyé.
- **Valide tes permissions en un clic** : quand Claude Code demande l'autorisation d'utiliser un outil, une bulle affiche l'outil et la commande
  (tronquée) avec « Autoriser / Refuser ». Sans clic sous 20 s, la boîte de dialogue habituelle de ton terminal reprend la main : le pet ne dit
  jamais « oui » à ta place. Seul un clic dans la fenêtre du pet peut approuver (aucune route du serveur local ne le permet). Détails : `docs/spike-permissions.md`.
- **Raccourci global** (⌃⌥ Espace par défaut ; dans les Réglages, clique le champ puis tape ta propre combinaison, avec au moins ⌃, ⌥ ou ⌘ ; ↺ revient au défaut, ✕ désactive) : ouvre le mini-chat au centre de l'écran où se trouve ta souris,
  même si le pet est masqué ou sur un autre écran ; il se recache à la fermeture du chat. Le raccourci n'enregistre aucune frappe : seule cette combinaison est écoutée.
- **Glisser-déposer** : dépose une capture d'écran (png, jpg, gif, webp ≤ 8 Mo) ou un log / fichier texte ou de code (≤ 2 Mo) sur le pet ; le mini-chat s'ouvre avec le fichier joint
  (puce 📎, un clic la retire). Valider sans rien taper envoie une question par défaut. **Le fichier est lu par Claude**, donc envoyé à Anthropic comme tout ce que lit Claude Code :
  seul ce fichier (et son dossier, en lecture) est rendu accessible. Un seul fichier à la fois ; les liens (URL) ne sont pas pris en charge.
- **Actions rapides** : à l'ouverture du chat, trois questions toutes prêtes selon ce que Claude vient de faire (« Explique ce que tu viens de changer »,
  « Résume l'erreur en 2 lignes », « Où en es-tu ? »…), au clic ou avec ⌥1 / ⌥2 / ⌥3.
- **Historique du chat** : les 4 dernières réponses restent relisibles (‹ 2/3 ›, ← / →), en mémoire seulement, jamais écrites sur disque. Si une réponse contient
  du code, un bouton « Copier le code » le met dans le presse-papiers.
- **Sent l'état du projet** : une goutte de sueur quand plus de 500 lignes ne sont pas commitées (mesuré avec `git diff --shortstat`, rien n'est modifié ni envoyé),
  et il tremble plus fort quand la même commande échoue 3 fois de suite.
- **Fête les bons moments** : confettis après un `git commit` réussi ; petit saut et ta-da quand un test ou un build repasse au vert après un échec.
  Il reconnaît ces commandes dans ce que Claude exécute (Bash) ; rien n'est envoyé ni enregistré.
- **Mode furtif** : pendant un appel (ton micro est utilisé par Zoom, Meet, Teams, Slack Huddle, FaceTime…), le pet devient tout petit et translucide, se tait et ne parle plus ;
  les demandes de permission restent visibles. Il lit seulement le drapeau CoreAudio « le micro est utilisé » : aucun son n'est capté. Désactivable dans les Réglages.
- **Coût et contexte de la session** : au survol du pet (« boutique · 1,84 $ · contexte 68 % ») et dans le menu de la barre de menus. Calculés en local depuis le transcript de la session
  (`~/.claude/projects/…`) ; une alerte douce apparaît quand le contexte atteint 80 % (la compaction automatique approche). Le coût est une estimation à partir d'une grille de tarifs
  embarquée ; la taille de la fenêtre n'étant pas dans le transcript, elle est supposée à 200 000 tokens (1 000 000 dès que le contexte dépasse 200 000).
- **Taille réglable** : de 70 % à 150 % (Réglages > Comportement), le pet grandit depuis ses pieds.
- **Noël** : bonnet de Noël et bois de renne dans les accessoires, grelots à la fin d'une tâche et boîte à musique à l'endormissement. Une case dans Réglages > Fêtes ; tant qu'on n'y touche pas, c'est actif en décembre seulement.
- **Succès locaux** : l'usage réel débloque des accessoires, à choisir dans Réglages > Apparence : casque de chantier (100 fichiers modifiés), lunettes de soleil
  (10 tests ou builds réparés), auréole (1 session sans erreur d'outil), couronne (3 sessions sans erreur). Les compteurs sont stockés dans un fichier local
  (`achievements.json`, dossier de l'app), jamais envoyés ; un accessoire déjà choisi reste affiché même s'il est à débloquer.
- **Vit** : il cligne des yeux, s'endort, se laisse prendre (il panique), se lance et rebondit sur les bords de l'écran.
- Visible **au-dessus des apps en plein écran**, sur tous les espaces, multi-écrans.

## Direction artistique

Le pet est un **bloc orange pixelisé en volume**, inspiré de petites figurines imprimées en 3D : un corps parallélépipédique,
deux bras carrés, huit pieds courts, des yeux rectangulaires. Il doit être attachant avant d'être utile, et lisible à 150 px.

**Formes et couleurs**
- 11 pavés CSS 3D (corps 95 × 67,5 × 45, pieds courts), arêtes nettes, aucune texture : le relief vient uniquement des faces.
- Orange `#e8793c` en face avant, plus clair sur le dessus (`#f2985f`), plus sombre sur les côtés (`#c9622a`, `#d46d31`) et au dos ; yeux `#1a1a1a`.
- Vue de trois quarts légèrement de dessus au repos : le volume se lit même immobile. Il se tourne vers le curseur et le suit des yeux.
- Icône : le vrai pet 3D sur un carré arrondi violet (`#6a5fd0` → `#221d52`), pour faire ressortir l'orange.
- Barre de menus : silhouette **2D noir et blanc**, de face, yeux découpés (image « template » macOS : le système la teinte en blanc en mode sombre).

**Expression : peu d'éléments, très lisibles**
- Yeux rectangulaires au repos, qui clignent. Yeux plissés `>  <` réservés à l'inquiétude et à la panique, jamais à la réflexion.
- Une bouche rectangulaire apparaît quand il parle (elle s'ouvre et se ferme), plate quand il s'inquiète, grande ouverte quand on le prend.
- Le pet **reflète le travail réel** : un accessoire par famille d'outils (lunettes, clavier, marteau et enclume, jumelles) plutôt qu'un état générique « occupé ».

**Mouvement : écraser, étirer, laisser respirer**
- Squash & stretch : il s'écrase quand on appuie (1,1 × 0,8), rebondit au lâcher, et s'écrase proportionnellement à la force d'un impact.
- Rythmes espacés plutôt que continus : gigotement de réflexion = un aller-retour puis 1,6 s de pause ; marteau = 3 coups puis 1 s de pause ; respiration du sommeil sur 3 s.
- Panique en main : tremblement de ±5°, décollé du sol, pieds qui se balancent ; puis chute, et lancer avec une vraie physique (gravité, rebonds amortis, frottement).
- Rare et juste : le pet ne reparle pas avant un délai réglable (12 s), et les confettis ne tombent qu'après un tour chargé sans échec.

**Voix et sons**
- Bulle de BD : fond blanc, contour de 3 px `#222`, ombre portée dure (3 px, sans flou), coins arrondis, queue vers le pet ; typographie manuscrite système (*Chalkboard SE*, *Comic Sans MS* en secours). Le texte s'écrit lettre par lettre.
- Ton : malicieux, taquin mais bienveillant, tutoiement, une seule phrase de 60 caractères maximum, jamais au détriment de la réponse technique.
- Sons 100 % synthétisés (WebAudio, aucun fichier), en plusieurs couches : bruit filtré, corps résonnants, partiels de cloche, petite réverb de pièce. Les frappes de clavier et de marteau s'aiguisent et s'accélèrent quand les outils s'enchaînent vite. Réglage « Alertes seulement » : seuls l'erreur, la fin de tâche et la demande de permission restent audibles.
- Plusieurs sessions : chaque projet reçoit une teinte distincte (angle d'or) sur une pastille posée au bord de la bulle.

**Réglages** : une fenêtre sobre aux tons chauds (fond crème, ou brun foncé en mode sombre), cartes blanches, interrupteurs arrondis et l'orange du pet comme unique accent.

## Installer
1. Télécharge `pet-claude-<version>.dmg` depuis la [page des releases](https://github.com/Lonejyc/pet-claude/releases) et ouvre-le.
2. Glisse `pet-claude.app` sur le raccourci **Applications**, puis lance-la depuis Applications. Elle n'est pas signée par un compte développeur Apple : **clic droit sur l'app, Ouvrir** la première fois (sinon macOS refuse).
3. À la toute première ouverture, l'app active seule ce que l'installateur .pkg cochait par défaut : hooks Claude Code (cinq hooks dans `~/.claude/settings.json`, sauvegarde faite avant) et lancement au démarrage de session. Rien n'est refait ensuite : tout se change dans les Réglages. Si l'app tourne depuis le .dmg lui-même, ou si une configuration existe déjà (mise à jour), elle ne touche à rien.
4. Relance tes sessions Claude Code déjà ouvertes pour que le pet les voie.

Prérequis : macOS sur Apple Silicon, [Claude Code](https://claude.com/claude-code) installé.

## Utiliser
| Geste | Effet |
|---|---|
| Clic | il s'écrase comme une balle |
| Glisser / lâcher en mouvement | le déplacer / le lancer |
| Double-clic | poser une question (Entrée envoie, Échap ferme, Tab change de session, ⌥1 / ⌥2 / ⌥3 pour une action rapide) |
| Fichier (image, log…) déposé sur le pet | l'ajoute à une question du mini-chat |
| Raccourci global (⌃⌥ Espace par défaut) | ouvre le mini-chat au centre de l'écran, même pet masqué |
| Survol | coût de la session et remplissage du contexte |
| Molette ou clic droit | feuillette les sessions et relit leur dernier message |
| Clic sur la bulle d'une fin de tâche | ramène ton terminal au premier plan |
| Bulle « Autoriser / Refuser » | répond à une demande de permission de Claude Code (Entrée / Échap si la fenêtre a le focus) |
| ‹ › dans une réponse du chat | relit les 4 dernières réponses ; « Copier le code » copie les blocs de code |
| Icône du pet dans la barre de menus | un menu natif macOS (limites du forfait, coût estimé, sessions) avec **Masquer le pet**, **Réglages…** et **Quitter** |
| `/settings` ou `/quit` dans le champ | idem, au clavier (l'icône Dock n'apparaît que pendant les réglages) |
| `/emote` (ou `/emote six-seven`, `/emote cymbals`) dans le champ | joue une emote tout de suite |

Dans **Réglages** : taille, couleur et accessoire du pet (Apparence, avec les accessoires à débloquer), sons (volume, « alertes seulement »), raccourci du mini-chat,
mode furtif, et un mode « emotes au lieu de dormir » (six seven, singe à cymbales).

## Ce qui est modifié sur ta machine
- `/Applications/pet-claude.app`
- Lecture seule : l'item « Claude Code-credentials » du Keychain (via `/usr/bin/security`, token envoyé uniquement à `api.anthropic.com`
  pour les limites du forfait), `~/.claude.json` (cache d'usage) et les transcripts `~/.claude/projects/**/*.jsonl` (coût estimé).
- `~/.claude/settings.json` : neuf hooks (`curl` vers `localhost:4242`) **ajoutés à côté des tiens**, sauvegarde dans
  `settings.json.bak-pet-claude`. L'un d'eux, `PermissionRequest`, laisse le pet afficher « Autoriser / Refuser » : il attend ton clic jusqu'à 20 s, puis rend la main
  à la boîte de dialogue de ton terminal (jamais d'« oui » par défaut). « Retirer » dans les Réglages (ou `uninstall.sh`) les enlève tous.
- `~/Library/LaunchAgents/io.github.lonejyc.pet-claude.plist` (lancement au démarrage, optionnel)
- `~/Library/Application Support/io.github.lonejyc.pet-claude/` : tes réglages (`settings.json`), tes compteurs de succès (`achievements.json`) et le secret du pet (`token`, lisible par toi seul)

Ce que le pet lit ou lance, en local : le nom de l'app au premier plan (macOS, pour te ramener à ton terminal), le drapeau « micro utilisé » de CoreAudio (mode furtif, aucun son capté),
`git diff --shortstat` dans le dossier du projet (lecture seule), `pbcopy` (bouton « Copier le code »), `open -b` (retour au terminal) et le transcript de la session (coût, contexte).

Aucune donnée ne quitte ta machine, sauf ce que Claude lit lui-même : chaque question du mini-chat est un appel normal à Claude (donc comptée comme tel),
et un fichier déposé sur le pet est lu par Claude.

## Sécurité et vie privée
- Le pet n'écoute que sur `127.0.0.1:4242` (jamais sur le réseau).
- Il **n'accepte que les requêtes qui portent son secret** (en-tête `X-Pet-Token`, généré au premier lancement, stocké en lecture
  seule pour toi). Il vérifie aussi l'en-tête `Host` (contre le rebinding DNS) et refuse les corps de plus de 4 Mo.
  Résultat : une page web ouverte dans ton navigateur ne peut pas faire parler le pet.
- Ce secret n'empêche pas un programme qui tourne déjà sous ton compte de lire `~/.claude/settings.json` et de le copier : c'est
  le même niveau de confiance que tes autres réglages.
- Le mini-chat ne dispose que de `Read`, `Grep` et `Glob` : il peut lire ton code, mais ne modifie rien et ne lance aucune commande.
  Sans session ouverte, il n'a aucun outil, sauf `Read` sur le seul fichier que tu viens de déposer (dont le dossier est rendu lisible pour cette question).
- Une décision de permission ne peut venir que d'un clic dans la fenêtre du pet : aucune route du serveur local ne permet d'approuver.
- Les modifications de `~/.claude/settings.json` sont atomiques (fichier temporaire puis renommage), conservent les permissions,
  sont précédées d'une sauvegarde, et sont **refusées sans rien écrire** si ce fichier n'est pas du JSON valide.
- Mise à jour depuis les betas 1 et 2 : l'app migre toute seule l'ancien identifiant (`fr.perso.petclaude`) et met à jour
  les hooks pour qu'ils portent le secret.

## Désinstaller
`./scripts/uninstall.sh` retire les hooks, le lancement au démarrage et l'app.

## Limites connues (beta)
- Apple Silicon uniquement, app non signée / non notarisée.
- L'installateur n'a pas pu être exécuté en conditions réelles avant publication (scripts de post-installation en root) :
  en cas de souci, voir `/tmp/pet-claude-install.log`.
- Le mini-chat retrouve `claude` via ton shell de connexion ; non vérifié depuis tous les types d'installation de Claude Code.
- Le pet ne connaît que les sessions qui lui ont envoyé un hook depuis son lancement. Après un (re)lancement du pet, une session
  déjà ouverte n'apparaît qu'à sa prochaine activité (outil utilisé ou fin de réponse) : d'ici là, le mini-chat ne peut pas la
  viser et répond comme si aucune session n'était ouverte.
- Les limites du forfait viennent d'un endpoint Anthropic **non documenté** (celui de Claude Code) : il peut changer ou refuser
  les requêtes ; la carte se replie alors sur le cache `~/.claude.json` et signale qu'il est périmé. Le coût affiché est une
  estimation (grille de tarifs copiée à la main, modèles inconnus comptés sans coût), pas ta facture.
- Un seul pet à la fois : si deux instances tournent (par ex. version de développement + installée), seule la première reçoit les hooks.
- Les accessoires du pet (clavier, marteau, enclume, jumelles) sont positionnés « à l'œil » et peuvent légèrement traverser le corps.
- Le raccourci global peut être déjà pris par une autre app ou par macOS (les Réglages affichent alors une erreur) : choisis-en un autre. Le glisser-déposer ne prend pas en charge les liens (URL).
- Le focus au clic sur la bulle se fait par app (pas par onglet de terminal). Le mode furtif repose sur l'usage du micro : une dictée vocale compte aussi, un partage d'écran sans micro non.
- La taille de la fenêtre de contexte n'est pas dans les transcripts : elle est supposée à 200 000 tokens (1 000 000 au-delà).

## Licence et mentions légales
- Code publié sous **licence MIT** (voir [`LICENSE`](LICENSE)). Les licences des dépendances sont listées dans
  [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) (aucune licence copyleft forte ; 5 crates sous MPL-2.0, utilisées sans modification).
- **pet-claude est un projet indépendant, non affilié à Anthropic, ni approuvé ou sponsorisé par elle.** « Claude » et
  « Claude Code » sont des marques d'Anthropic ; elles ne servent ici qu'à désigner le logiciel avec lequel le pet fonctionne.
- Le logiciel est fourni « tel quel », sans garantie (voir la licence). Il modifie `~/.claude/settings.json` : une sauvegarde est faite, mais
  lis la section « Ce qui est modifié sur ta machine » avant d'installer.

## Développer
```sh
cd app && npm install && npm run tauri dev      # pet en développement (Rust requis)
cd app && npm test && npm run build && cd src-tauri && cargo test && cargo clippy -- -D warnings   # tests et lint (la CI lance la même chose)
./scripts/demo.sh                               # rejoue toutes les animations sans Claude
./scripts/make-icon.sh                          # régénère l'icône depuis le pet 3D (serveur de dev lancé)
./scripts/make-readme-images.sh                 # régénère les images du README depuis le pet 3D
./installer/build-dmg.sh                        # construit l'image disque .dmg (méthode d'installation recommandée)
./installer/build-pkg.sh                        # construit l'installateur .pkg (assistant avec cases à cocher)
```
Stack : Tauri 2, TypeScript, CSS 3D, `tauri-nspanel`, `tauri-plugin-global-shortcut`. Fenêtre en `NSPanel` non activant ; positions et souris en
coordonnées natives macOS (les conversions de Tauri se mélangent entre écrans d'échelles différentes).
