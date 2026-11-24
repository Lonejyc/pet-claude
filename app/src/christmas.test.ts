import { describe, expect, it } from "vitest";
import { christmasOn } from "./christmas";

describe("christmasOn", () => {
  it("sans réglage : décembre seulement", () => {
    expect(christmasOn(undefined, new Date(2026, 10, 30))).toBe(false);
    expect(christmasOn(undefined, new Date(2026, 11, 1))).toBe(true);
    expect(christmasOn(undefined, new Date(2026, 11, 31))).toBe(true);
    expect(christmasOn(undefined, new Date(2027, 0, 1))).toBe(false);
  });
  it("un choix explicite prime hors saison comme en décembre", () => {
    expect(christmasOn(true, new Date(2026, 5, 15))).toBe(true);
    expect(christmasOn(false, new Date(2026, 11, 25))).toBe(false);
  });
});
