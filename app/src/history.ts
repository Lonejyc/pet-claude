// Historique éphémère du mini-chat (en mémoire, jamais écrit sur disque) et extraction des blocs de code des réponses.
export type Entry = { question: string; raw: string };
export const MAX_ENTRIES = 4;

const entries: Entry[] = [];
export let cursor = -1; // entrée affichée dans la bulle

export const list = () => entries;

export function push(e: Entry) {
  entries.push(e);
  if (entries.length > MAX_ENTRIES) entries.shift();
  cursor = entries.length - 1;
}

// Navigation circulaire ; delta = -1 (plus ancienne) ou +1 (plus récente).
export const step = (delta: number) => (cursor = entries.length ? (cursor + delta + entries.length) % entries.length : -1);

export const clear = () => {
  entries.length = 0;
  cursor = -1;
};

const FENCE = /```[^\n`]*\n([\s\S]*?)```/g;

// Contenu des blocs ``` fermés. Un bloc encore ouvert (réponse en cours de streaming) n'est pas compté.
export const extractCode = (raw: string) => [...raw.matchAll(FENCE)].map((m) => m[1].replace(/\n$/, "")).filter(Boolean);

// Le texte sans les blocs de code : fermés, ou encore ouverts à la fin du flux.
export const prose = (raw: string) => raw.replace(FENCE, "").replace(/```[\s\S]*$/, "").trim();
