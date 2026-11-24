import { describe, expect, it } from "vitest";
import { fail, isHeavy, isNervous, streakKey, succeed } from "./nervous";

describe("série d'échecs", () => {
  const k = streakKey("Bash", "npm test");
  it("devient nerveux au 3e échec consécutif de la même commande", () => {
    let s = fail(null, k);
    expect(isNervous(s)).toBe(false);
    s = fail(s, k);
    expect(isNervous(s)).toBe(false);
    s = fail(s, k);
    expect(s.n).toBe(3);
    expect(isNervous(s)).toBe(true);
  });
  it("repart de 1 quand la commande change", () => {
    const s = fail(fail(null, k), streakKey("Bash", "npm run build"));
    expect(s).toEqual({ key: "Bash:npm run build", n: 1 });
  });
  it("un succès de la même commande éteint la série, pas celui d'une autre", () => {
    const s = fail(fail(null, k), k);
    expect(succeed(s, streakKey("Read", null))).toBe(s);
    expect(succeed(s, k)).toBeNull();
  });
  it("sans série, rien à éteindre ni à craindre", () => {
    expect(succeed(null, k)).toBeNull();
    expect(isNervous(null)).toBe(false);
  });
});

describe("gros diff", () => {
  it("dépasse strictement 500 lignes", () => {
    expect(isHeavy(500)).toBe(false);
    expect(isHeavy(501)).toBe(true);
    expect(isHeavy(null)).toBe(false);
    expect(isHeavy(undefined)).toBe(false);
  });
});
