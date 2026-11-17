import type { Streak } from "./nervous";
// Les sessions Claude Code ouvertes, reconnues grâce au session_id et au cwd que chaque hook envoie.
export type Session = {
  id: string;
  cwd: string;
  order: number; // ordre d'apparition : sert aux couleurs et à numéroter les sessions d'un même projet
  lastSeen: number;
  busy: boolean; // un outil est en cours depuis son dernier Stop
  tools: number; // outils utilisés pendant le tour en cours
  failed: boolean; // un outil a échoué pendant le tour en cours
  files: Set<string>; // fichiers modifiés (Edit/Write…) pendant le tour en cours
  attention: boolean; // Claude attend l'utilisateur (Notification) ou a échoué : le pet prend la couleur de cette session
  said: string; // dernier message de Claude dans cette session, pour le relire en changeant de session
  streak: Streak | null; // échecs consécutifs d'une même commande
  diff: number | null; // lignes non commitées dans le dossier du projet (insertions + suppressions)
  diffAt: number; // heure de la dernière mesure
  last: "done" | "error" | null; // issue du dernier tour : sert aux actions rapides du mini-chat
  app: string | null; // app au premier plan quand l'utilisateur a envoyé son dernier prompt : le terminal de cette session
};

const sessions = new Map<string, Session>();
let counter = 0;

// Sessions lancées par le mini-chat lui-même (copies) : leurs hooks ne doivent pas apparaître comme de vraies sessions.
export const ignored = new Set<string>();

export function touch(id: string, cwd?: string | null): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { id, cwd: cwd ?? "", order: ++counter, lastSeen: 0, busy: false, tools: 0, failed: false, files: new Set(), attention: false, said: "", streak: null, diff: null, diffAt: 0, last: null, app: null };
    sessions.set(id, s);
  }
  if (cwd) s.cwd = cwd;
  s.lastSeen = Date.now();
  return s;
}

export const remove = (id: string) => sessions.delete(id);
export const all = () => [...sessions.values()].sort((a, b) => a.order - b.order);
export const count = () => sessions.size;
export const anyBusy = () => all().some((s) => s.busy);
export const mostRecent = () => all().sort((a, b) => b.lastSeen - a.lastSeen)[0];

// Teintes très écartées entre elles (angle d'or), quel que soit le nombre de sessions.
export const color = (s: Session) => `hsl(${(s.order * 137.5) % 360} 65% 42%)`;

const projectName = (s: Session) => s.cwd.split("/").filter(Boolean).pop() || "session";

// Nom du projet ; si plusieurs sessions sont dans le même dossier : "projet ·1", "projet ·2"
export function label(s: Session) {
  const name = projectName(s);
  const same = all().filter((o) => projectName(o) === name);
  return same.length > 1 ? `${name} ·${same.indexOf(s) + 1}` : name;
}

// Claude Code n'envoie pas Stop quand on l'interrompt (Échap) : une session « occupée » sans aucun hook depuis maxMs est considérée libre.
// ponytail: un outil de plus de 10 min sans aucun hook (gros build) sera lâché trop tôt ; la session redevient occupée au hook suivant.
export function releaseStale(maxMs: number) {
  let released = false;
  for (const s of all()) {
    if (s.busy && Date.now() - s.lastSeen > maxMs) {
      s.busy = false;
      released = true;
    }
  }
  return released;
}

// Une session qui n'a pas envoyé SessionEnd (terminal fermé brutalement) ne doit pas rester à vie.
export function prune(maxAgeMs: number) {
  for (const s of all()) if (!s.busy && Date.now() - s.lastSeen > maxAgeMs) sessions.delete(s.id);
}

// « 3 fichiers modifiés » pour la bulle de fin de tâche ; vide s'il n'y en a pas.
export const editSummary = (n: number) => (n === 0 ? "" : n === 1 ? "1 fichier modifié" : `${n} fichiers modifiés`);

// Actions rapides du mini-chat selon ce que Claude vient de faire dans la session visée (aucune sans session : question générale).
export function quickActions(s?: Pick<Session, "busy" | "last">): string[] {
  if (!s) return [];
  if (s.busy) return ["Où en es-tu ?", "Que reste-t-il à faire ?", "Qu'est-ce qui te bloque ?"];
  if (s.last === "error") return ["Résume l'erreur en 2 lignes", "Quelle est la cause probable ?", "Que proposes-tu pour la corriger ?"];
  if (s.last === "done") return ["Explique ce que tu viens de changer", "Y a-t-il des effets de bord ?", "Que dois-je vérifier avant de commiter ?"];
  return ["Résume ce qu'on a fait dans cette session", "Quelles sont les prochaines étapes ?"];
}

// Session qui a le plus récemment besoin de l'utilisateur : Notification, échec, ou demande de permission en attente (`waiting` = ids).
export const attentionTarget = (waiting: ReadonlySet<string> = new Set()) =>
  all()
    .filter((s) => s.attention || waiting.has(s.id))
    .sort((a, b) => b.lastSeen - a.lastSeen)[0];

// Session suivante (delta = 1) ou précédente (-1), circulaire, dans l'ordre d'apparition.
export function cycle(from: Session | undefined, delta: number) {
  const list = all();
  if (!list.length) return undefined;
  const i = from ? list.indexOf(from) : -1;
  if (i < 0) return list[delta > 0 ? 0 : list.length - 1];
  return list[(i + delta + list.length) % list.length];
}
