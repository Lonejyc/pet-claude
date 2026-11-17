import { afterEach, describe, expect, it } from "vitest";
import * as h from "./history";

afterEach(() => h.clear());

describe("extractCode / prose", () => {
  const raw = "Voici la commande.\n```bash\ngit status\ngit diff\n```\nEt un second :\n```\nnpm test\n```\nVoilà.";
  it("extrait tous les blocs fermés, sans la langue ni le retour final", () => {
    expect(h.extractCode(raw)).toEqual(["git status\ngit diff", "npm test"]);
  });
  it("garde le texte hors blocs", () => {
    expect(h.prose(raw)).toBe("Voici la commande.\n\nEt un second :\n\nVoilà.");
  });
  it("ignore un bloc encore ouvert pendant le streaming", () => {
    const partial = "Je propose :\n```ts\nconst a = 1;";
    expect(h.extractCode(partial)).toEqual([]);
    expect(h.prose(partial)).toBe("Je propose :");
  });
  it("sans bloc : rien à copier, texte intact", () => {
    expect(h.extractCode("Juste du texte.")).toEqual([]);
    expect(h.prose("Juste du texte.")).toBe("Juste du texte.");
  });
});

describe("historique", () => {
  it("ne garde que les 4 dernières réponses et pointe sur la plus récente", () => {
    for (let i = 1; i <= 6; i++) h.push({ question: `q${i}`, raw: `r${i}` });
    expect(h.list().map((e) => e.question)).toEqual(["q3", "q4", "q5", "q6"]);
    expect(h.cursor).toBe(3);
  });
  it("navigue de façon circulaire", () => {
    for (let i = 1; i <= 3; i++) h.push({ question: `q${i}`, raw: `r${i}` });
    expect(h.step(-1)).toBe(1);
    expect(h.step(-1)).toBe(0);
    expect(h.step(-1)).toBe(2);
    expect(h.step(1)).toBe(0);
  });
  it("vide : pas de curseur", () => expect(h.step(1)).toBe(-1));
});
