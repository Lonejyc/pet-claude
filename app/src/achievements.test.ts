import { describe, expect, it } from "vitest";
import { EMPTY, isUnlocked, newlyUnlocked, progress, sessionWasClean } from "./achievements";

const c = (over: Partial<typeof EMPTY> = {}) => ({ ...EMPTY, ...over });

describe("déblocage", () => {
  it("les accessoires sans règle sont libres", () => {
    expect(isUnlocked("ears", EMPTY)).toBe(true);
    expect(isUnlocked("none", EMPTY)).toBe(true);
  });
  it("verrouille à zéro et débloque pile au seuil", () => {
    expect(isUnlocked("hardhat", c({ files: 99 }))).toBe(false);
    expect(isUnlocked("hardhat", c({ files: 100 }))).toBe(true);
    expect(isUnlocked("sunglasses", c({ fixes: 10 }))).toBe(true);
    expect(isUnlocked("halo", c({ cleanSessions: 1 }))).toBe(true);
    expect(isUnlocked("crown", c({ cleanSessions: 2 }))).toBe(false);
    expect(isUnlocked("crown", c({ cleanSessions: 3 }))).toBe(true);
  });
  it("signale seulement les accessoires qui viennent d'être franchis", () => {
    expect(newlyUnlocked(c({ files: 95 }), c({ files: 103 }))).toEqual(["hardhat"]);
    expect(newlyUnlocked(c({ files: 100 }), c({ files: 120 }))).toEqual([]);
    expect(newlyUnlocked(c({ cleanSessions: 2 }), c({ cleanSessions: 3 }))).toEqual(["crown"]);
    expect(newlyUnlocked(EMPTY, c({ cleanSessions: 3 })).sort()).toEqual(["crown", "halo"]);
  });
  it("décrit la progression, plafonnée au seuil", () => {
    expect(progress("hardhat", c({ files: 42 }))).toBe("42 / 100 · 100 fichiers modifiés");
    expect(progress("hardhat", c({ files: 500 }))).toBe("100 / 100 · 100 fichiers modifiés");
    expect(progress("ears", EMPTY)).toBe("");
  });
});

describe("sessionWasClean", () => {
  it("demande assez d'outils et aucune erreur", () => {
    expect(sessionWasClean({ tools: 5, errors: 0 })).toBe(true);
    expect(sessionWasClean({ tools: 4, errors: 0 })).toBe(false);
    expect(sessionWasClean({ tools: 20, errors: 1 })).toBe(false);
  });
});
