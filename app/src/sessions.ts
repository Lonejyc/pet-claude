// Les sessions Claude Code ouvertes, reconnues grâce au session_id et au cwd que chaque hook envoie.
export type Session = {
  id: string;
  cwd: string;
  order: number; // ordre d'apparition : sert aux couleurs et à numéroter les sessions d'un même projet
  lastSeen: number;
  busy: boolean; // un outil est en cours depuis son dernier Stop
  tools: number; // outils utilisés pendant le tour en cours
  failed: boolean; // un outil a échoué pendant le tour en cours
};

const sessions = new Map<string, Session>();
let counter = 0;

// Sessions lancées par le mini-chat lui-même (copies) : leurs hooks ne doivent pas apparaître comme de vraies sessions.
export const ignored = new Set<string>();

export function touch(id: string, cwd?: string | null): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { id, cwd: cwd ?? "", order: ++counter, lastSeen: 0, busy: false, tools: 0, failed: false };
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

// Une session qui n'a pas envoyé SessionEnd (terminal fermé brutalement) ne doit pas rester à vie.
export function prune(maxAgeMs: number) {
  for (const s of all()) if (!s.busy && Date.now() - s.lastSeen > maxAgeMs) sessions.delete(s.id);
}
