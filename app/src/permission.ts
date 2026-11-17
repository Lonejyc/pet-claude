// File d'attente des demandes de permission de Claude Code (cf. src-tauri/src/permission.rs et docs/spike-permissions.md).
export type Request = {
  id: number;
  session?: string | null;
  cwd?: string | null;
  tool?: string;
  input?: Record<string, unknown> | null;
  deadline: number; // heure limite côté interface : un peu avant celle de Rust, pour ne jamais cliquer sur une demande déjà expirée
};

export const MAX_CHARS = 160;
const DEADLINE_MARGIN_MS = 1500;

const queue: Request[] = [];

export const current = () => queue[0];
export const pending = () => queue.length;

export function push(r: Omit<Request, "deadline"> & { timeoutMs: number }, now = Date.now()) {
  queue.push({ ...r, deadline: now + r.timeoutMs - DEADLINE_MARGIN_MS });
}

// Retire la demande décidée (ou une demande inconnue : sans effet).
export const resolve = (id: number) => {
  const i = queue.findIndex((r) => r.id === id);
  if (i >= 0) queue.splice(i, 1);
};

// Retire les demandes expirées (Rust a déjà rendu la main au terminal) ; renvoie vrai si la file a changé.
export function expire(now = Date.now()) {
  const before = queue.length;
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].deadline <= now) queue.splice(i, 1);
  return queue.length !== before;
}

export const secondsLeft = (r: Request, now = Date.now()) => Math.max(0, Math.ceil((r.deadline - now) / 1000));

export const clear = () => (queue.length = 0);

// Ce que l'outil s'apprête à faire, en texte brut tronqué : la commande, le fichier ou l'adresse, sinon le JSON de l'entrée.
export function describeInput(input: Record<string, unknown> | null | undefined) {
  const field = input && (input.command ?? input.file_path ?? input.notebook_path ?? input.url ?? input.pattern);
  const text = typeof field === "string" ? field : JSON.stringify(input ?? {});
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_CHARS ? flat.slice(0, MAX_CHARS - 1) + "…" : flat;
}

// Sessions qui ont une demande de permission en attente (le pet prend leur couleur).
export const pendingSessions = () => new Set(queue.flatMap((r) => (r.session ? [r.session] : [])));
