// Fonctions pures du moteur audio (sound.ts) : sorties déterministes quand on leur donne le générateur aléatoire, donc testables.

// Valeur base ± pct (0.1 = ±10 %) : deux sons identiques ne doivent jamais être strictement identiques.
export const jitter = (base: number, pct: number, rnd = Math.random) => base * (1 + (rnd() * 2 - 1) * pct);

// Indice entre 0 et n-1, différent du précédent : on ne joue jamais deux fois de suite la même variante.
export const pickNot = (n: number, last: number, rnd = Math.random) => {
  if (n < 2) return 0;
  const i = Math.floor(rnd() * (n - 1));
  return i >= last ? i + 1 : i;
};

// Bruit rose (filtre de Paul Kellet) : plus chaud et plus naturel que le bruit blanc, sert de matière aux frappes, claquements et cymbales.
export function pinkNoise(length: number, rnd = Math.random) {
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return out;
}

// Réponse impulsionnelle d'une petite pièce : du bruit dont l'amplitude s'éteint exponentiellement (decay = chute en dB sur la durée).
export function reverbImpulse(sampleRate: number, seconds: number, decayDb = 60, rnd = Math.random) {
  const length = Math.floor(sampleRate * seconds);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (rnd() * 2 - 1) * 10 ** ((-decayDb * (i / length)) / 20);
  return out;
}

export type SoundMode = "all" | "alerts";

// Mode « discrétion absolue » : seules les alertes (erreur, fin de tâche) restent audibles.
export const ALERT_SOUNDS = ["tada", "worried"];
export const soundAllowed = (mode: SoundMode, name: string) => mode === "all" || ALERT_SOUNDS.includes(name);

// Allure des outils : plus ils s'enchaînent vite (écart court entre deux PreToolUse), plus les frappes sont aiguës et rapprochées.
// Écart inconnu (premier outil) = allure moyenne, qui redonne la cadence d'origine de 140 ms.
export function toolPace(gapMs?: number) {
  const t = gapMs === undefined ? 0.5 : Math.min(1, Math.max(0, Math.log(gapMs / 500) / Math.log(20_000 / 500)));
  return { pitch: 1.2 - 0.35 * t, intervalMs: Math.round(100 + 80 * t) };
}
