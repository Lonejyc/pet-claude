// Succès locaux : des compteurs tirés de l'usage réel de Claude Code débloquent des accessoires. Rien ne quitte la machine (cf. setup.rs).
export type Counters = { files: number; fixes: number; cleanSessions: number };
export const EMPTY: Counters = { files: 0, fixes: 0, cleanSessions: 0 };

// Une session « sans erreur » : au moins ce nombre d'outils utilisés et aucun échec d'outil.
export const CLEAN_SESSION_MIN_TOOLS = 5;

type Rule = { counter: keyof Counters; at: number; text: string };
export const UNLOCKS: Record<string, Rule> = {
  hardhat: { counter: "files", at: 100, text: "100 fichiers modifiés" },
  sunglasses: { counter: "fixes", at: 10, text: "10 tests ou builds réparés" },
  halo: { counter: "cleanSessions", at: 1, text: "1 session sans erreur d'outil" },
  crown: { counter: "cleanSessions", at: 3, text: "3 sessions sans erreur d'outil" },
};

// Les accessoires sans règle (oreilles, antenne…) sont libres.
export const isUnlocked = (accessory: string, c: Counters) => {
  const r = UNLOCKS[accessory];
  return !r || c[r.counter] >= r.at;
};

// Accessoires dont le seuil vient d'être franchi entre deux états des compteurs.
export const newlyUnlocked = (before: Counters, after: Counters) => Object.keys(UNLOCKS).filter((a) => !isUnlocked(a, before) && isUnlocked(a, after));

// « 42 / 100 fichiers modifiés » pour la fenêtre des réglages.
export const progress = (accessory: string, c: Counters) => {
  const r = UNLOCKS[accessory];
  return r ? `${Math.min(c[r.counter], r.at)} / ${r.at} · ${r.text}` : "";
};

export const sessionWasClean = (s: { tools: number; errors: number }) => s.tools >= CLEAN_SESSION_MIN_TOOLS && s.errors === 0;
