// Pièce jointe déposée sur le pet (capture d'écran, log…) : on décide si on l'accepte avant de la donner à Claude.
export type Kind = "image" | "text";
export type Attachment = { path: string; name: string; kind: Kind };
export type Verdict = { ok: true; attachment: Attachment } | { ok: false; reason: string };

const IMAGES = ["png", "jpg", "jpeg", "gif", "webp"];
const TEXTS = ["log", "txt", "md", "json", "csv", "ts", "tsx", "js", "jsx", "css", "html", "rs", "py", "yml", "yaml", "toml", "sh", "diff", "patch"];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const mb = (n: number) => `${n / 1024 / 1024} Mo`;

// `size` : taille en octets, ou null si le chemin n'est pas un fichier ordinaire (dossier, introuvable).
export function classifyDrop(paths: string[], size: number | null): Verdict {
  if (paths.length !== 1) return { ok: false, reason: "Un seul fichier à la fois, s'il te plaît." };
  const path = paths[0];
  const name = path.split("/").pop() || path;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const kind: Kind | null = IMAGES.includes(ext) ? "image" : TEXTS.includes(ext) ? "text" : null;
  if (size === null) return { ok: false, reason: "Je ne sais lire que des fichiers, pas des dossiers." };
  if (!kind) return { ok: false, reason: `Je ne sais pas lire les fichiers .${ext || "sans extension"}.` };
  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
  if (size > max) return { ok: false, reason: `Ce fichier est trop gros (${mb(max)} maximum).` };
  return { ok: true, attachment: { path, name, kind } };
}

// Question envoyée si l'utilisateur valide sans rien taper.
export const defaultQuestion = (a: Attachment) =>
  a.kind === "image" ? "Décris cette image et signale ce qui cloche s'il y a un bug visible." : "Résume ce fichier et repère l'erreur ou le point important.";
