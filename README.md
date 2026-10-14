# pet-claude

Un petit compagnon 3D qui vit sur ton bureau macOS et réagit à ce que fait **Claude Code** : il lit avec des lunettes,
tape sur son clavier, martèle quand Claude modifie un fichier, s'inquiète quand une commande échoue, et te répond dans une bulle.

> **Beta** : testé sur macOS (Apple Silicon) avec Claude Code. Voir « Limites connues ».

## Ce qu'il fait
- **Réagit en direct** à toutes tes sessions Claude Code (quel que soit le dossier) via leurs hooks.
- **Reconnaît tes sessions** : une pastille (nom du projet + couleur) étiquette chaque bulle quand plusieurs sessions sont ouvertes.
- **Mini-chat** : double-clic sur le pet, tape une question. Elle part dans une *copie* de la session choisie
  (`claude -p --resume --fork-session`, lecture seule) : ta session du terminal n'est pas modifiée. `Tab` change de session.
- **Vit** : il cligne des yeux, s'endort, se laisse prendre (il panique), se lance et rebondit sur les bords de l'écran.
- Visible **au-dessus des apps en plein écran**, sur tous les espaces, multi-écrans.

## Installer
1. Télécharge `pet-claude-<version>.pkg`.
2. Il n'est pas signé par un compte développeur Apple : **clic droit sur le fichier, Ouvrir** (sinon macOS refuse).
3. Suis l'installateur : choisis ce qui est configuré (hooks Claude Code, lancement au démarrage, personnalité « Pet »).
4. Relance tes sessions Claude Code déjà ouvertes pour que le pet les voie.

Prérequis : macOS sur Apple Silicon, [Claude Code](https://claude.com/claude-code) installé.

## Utiliser
| Geste | Effet |
|---|---|
| Clic | il s'écrase comme une balle |
| Glisser / lâcher en mouvement | le déplacer / le lancer |
| Double-clic | poser une question (Entrée envoie, Échap ferme, Tab change de session) |
| `/settings` dans le champ | fenêtre de réglages (l'icône Dock n'apparaît que pendant les réglages) |
| `/quit` dans le champ | fermer le pet |

## Ce qui est modifié sur ta machine
- `/Applications/pet-claude.app`
- `~/.claude/settings.json` : cinq hooks (`curl` vers `localhost:4242`) **ajoutés à côté des tiens**, sauvegarde dans
  `settings.json.bak-pet-claude`. Si tu coches la personnalité : `outputStyle: "Pet"` et `~/.claude/output-styles/pet.md`.
- `~/Library/LaunchAgents/fr.perso.petclaude.plist` (lancement au démarrage, optionnel)
- `~/Library/Application Support/fr.perso.petclaude/settings.json` (réglages du pet)

Aucune donnée ne quitte ta machine : le pet n'écoute que `127.0.0.1:4242`. Chaque question du mini-chat est un appel
normal à Claude (donc comptée comme tel).

## Désinstaller
`./scripts/uninstall.sh` retire les hooks, la personnalité, le lancement au démarrage et l'app.

## Limites connues (beta)
- Apple Silicon uniquement, app non signée / non notarisée.
- L'installateur n'a pas pu être exécuté en conditions réelles avant publication (scripts de post-installation en root) :
  en cas de souci, voir `/tmp/pet-claude-install.log`.
- Le mini-chat retrouve `claude` via ton shell de connexion ; non vérifié depuis tous les types d'installation de Claude Code.
- Un seul pet à la fois : si deux instances tournent (par ex. version de développement + installée), seule la première reçoit les hooks.
- Les accessoires du pet (clavier, marteau, enclume, jumelles) sont positionnés « à l'œil » et peuvent légèrement traverser le corps.

## Développer
```sh
cd app && npm install && npm run tauri dev      # pet en développement (Rust requis)
./scripts/demo.sh                               # rejoue toutes les animations sans Claude
./scripts/make-icon.sh                          # régénère l'icône depuis le pet 3D (serveur de dev lancé)
./installer/build-pkg.sh                        # construit l'installateur .pkg
```
Stack : Tauri 2, TypeScript, CSS 3D, `tauri-nspanel`. Fenêtre en `NSPanel` non activant ; positions et souris en
coordonnées natives macOS (les conversions de Tauri se mélangent entre écrans d'échelles différentes).
