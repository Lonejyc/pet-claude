import { describe, expect, it } from "vitest";
import { jitter, pickNot, pinkNoise, reverbImpulse, soundAllowed, toolPace } from "./audio-math";

// Générateur pseudo-aléatoire déterministe (LCG) pour des tests reproductibles.
const seeded = (seed = 1) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

describe("jitter", () => {
  it("reste dans base ± pct", () => {
    const rnd = seeded();
    for (let i = 0; i < 200; i++) {
      const v = jitter(100, 0.1, rnd);
      expect(v).toBeGreaterThanOrEqual(90);
      expect(v).toBeLessThanOrEqual(110);
    }
  });
  it("renvoie base pour un aléa neutre (0,5)", () => expect(jitter(100, 0.2, () => 0.5)).toBe(100));
});

describe("pickNot", () => {
  it("ne rejoue jamais le même indice et reste dans [0, n[", () => {
    const rnd = seeded(7);
    let last = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const next = pickNot(4, last, rnd);
      expect(next).not.toBe(last);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(4);
      seen.add((last = next));
    }
    expect(seen.size).toBe(4);
  });
  it("tombe à 0 s'il n'y a qu'une variante", () => expect(pickNot(1, 0)).toBe(0));
});

describe("pinkNoise", () => {
  it("a la longueur demandée, reste borné et n'est pas silencieux", () => {
    const n = pinkNoise(4096, seeded(3));
    expect(n.length).toBe(4096);
    expect(Math.max(...n.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(n.some((x) => Math.abs(x) > 0.01)).toBe(true);
  });
});

describe("reverbImpulse", () => {
  it("s'éteint : la fin est bien plus faible que le début", () => {
    const ir = reverbImpulse(8000, 0.5, 60, seeded(5));
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    expect(ir.length).toBe(4000);
    expect(rms(ir.slice(-400))).toBeLessThan(rms(ir.slice(0, 400)) / 20);
  });
});

describe("soundAllowed", () => {
  it("mode all : tout passe", () => expect(["blip", "key", "tada"].every((n) => soundAllowed("all", n))).toBe(true));
  it("mode alerts : seuls l'erreur, la fin de tâche et la permission passent", () => {
    expect(soundAllowed("alerts", "tada")).toBe(true);
    expect(soundAllowed("alerts", "sleighBells")).toBe(true);
    expect(soundAllowed("alerts", "worried")).toBe(true);
    expect(soundAllowed("alerts", "yelp")).toBe(true);
    for (const n of ["blip", "key", "tok", "crash", "thump", "squish", "boing", "musicBox"]) expect(soundAllowed("alerts", n)).toBe(false);
  });
});

describe("toolPace", () => {
  it("outils rapides : aigu et cadence serrée", () => expect(toolPace(300)).toEqual({ pitch: 1.2, intervalMs: 100 }));
  it("outils lents : grave et cadence lente", () => expect(toolPace(60_000)).toEqual({ pitch: 1.2 - 0.35, intervalMs: 180 }));
  it("écart inconnu : cadence d'origine de 140 ms", () => expect(toolPace().intervalMs).toBe(140));
  it("est monotone", () => {
    const gaps = [400, 1000, 3000, 8000, 20_000];
    const pitches = gaps.map((g) => toolPace(g).pitch);
    expect([...pitches].sort((a, b) => b - a)).toEqual(pitches);
  });
});
