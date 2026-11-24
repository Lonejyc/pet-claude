import { describe, expect, it } from "vitest";
import { formatStats, usd, warnState, type Stats } from "./stats";

const s = (over: Partial<Stats> = {}): Stats => ({ cost: 1.839, partial: false, context: 136_000, window: 200_000, pct: 68, model: "claude-sonnet-4-5", ...over });

describe("formatStats", () => {
  it("affiche coût et contexte", () => expect(formatStats("boutique", s())).toBe("boutique · 1,84 $ · contexte 68 %"));
  it("marque un coût sous-estimé", () => expect(formatStats("blog", s({ partial: true }))).toBe("blog · ~1,84 $ · contexte 68 %"));
  it("gère les très petits montants", () => {
    expect(usd(0)).toBe("0,00 $");
    expect(usd(0.004)).toBe("< 0,01 $");
    expect(usd(12)).toBe("12,00 $");
  });
});

describe("warnState", () => {
  it("prévient une seule fois en franchissant 80 %", () => {
    let st = warnState(false, 79);
    expect(st.notify).toBe(false);
    st = warnState(st.warned, 80);
    expect(st).toEqual({ warned: true, notify: true });
    st = warnState(st.warned, 92);
    expect(st.notify).toBe(false);
  });
  it("se réarme quand le contexte retombe sous 50 % (compaction)", () => {
    expect(warnState(true, 60)).toEqual({ warned: true, notify: false });
    expect(warnState(true, 20)).toEqual({ warned: false, notify: false });
    expect(warnState(false, 85).notify).toBe(true);
  });
});
