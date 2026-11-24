// Nervosité du pet : mêmes échecs en boucle, ou énorme diff non commité.
export type Streak = { key: string; n: number };

export const NERVOUS_AT = 3; // échecs consécutifs d'une même commande
export const HEAVY_DIFF_LINES = 500; // lignes non commitées (insertions + suppressions)

export const streakKey = (tool?: string, command?: string | null) => `${tool ?? ""}:${command ?? ""}`;

// Un échec de plus : la série continue si c'est la même commande, sinon elle repart de 1.
export const fail = (prev: Streak | null, key: string): Streak => (prev?.key === key ? { key, n: prev.n + 1 } : { key, n: 1 });

// Un succès de la même commande met fin à la série ; un succès d'une autre commande la laisse intacte (Claude lit un fichier entre deux essais).
export const succeed = (prev: Streak | null, key: string): Streak | null => (prev?.key === key ? null : prev);

export const isNervous = (s: Streak | null) => !!s && s.n >= NERVOUS_AT;
export const isHeavy = (lines: number | null | undefined) => (lines ?? 0) > HEAVY_DIFF_LINES;
