// Coût et remplissage du contexte d'une session (calculés par Rust depuis son transcript : cf. local_usage.rs `session_stats`).
export type Stats = { cost: number; partial: boolean; context: number; window: number; pct: number; model: string };

export const WARN_PCT = 80; // la compaction automatique approche
const REARM_PCT = 50; // après une compaction le contexte retombe : on pourra prévenir à nouveau

export const usd = (n: number) => (n > 0 && n < 0.01 ? "< 0,01 $" : `${n.toFixed(2).replace(".", ",")} $`);

// « boutique · 1,84 $ · contexte 68 % » ; « ~ » devant le prix s'il est sous-estimé (modèle sans tarif connu).
export const formatStats = (label: string, s: Stats) => `${label} · ${s.partial ? "~" : ""}${usd(s.cost)} · contexte ${s.pct} %`;

// Faut-il prévenir ? Une fois en franchissant 80 %, puis plus tant que le contexte n'est pas redescendu sous 50 %.
export function warnState(warned: boolean, pct: number) {
  if (!warned && pct >= WARN_PCT) return { warned: true, notify: true };
  if (warned && pct < REARM_PCT) return { warned: false, notify: false };
  return { warned, notify: false };
}
