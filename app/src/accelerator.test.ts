import { describe, expect, it } from "vitest";
import { accelFromEvent, DEFAULT_SHORTCUT, formatAccel } from "./accelerator";

const ev = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe("accelFromEvent", () => {
  it("compose les modificateurs dans un ordre stable", () => {
    expect(accelFromEvent(ev("Space", { altKey: true, ctrlKey: true }))).toBe("Control+Alt+Space");
    expect(accelFromEvent(ev("KeyC", { metaKey: true, shiftKey: true }))).toBe("Shift+Super+C");
    expect(accelFromEvent(ev("Digit7", { ctrlKey: true, altKey: true, metaKey: true, shiftKey: true }))).toBe("Control+Alt+Shift+Super+7");
  });
  it("accepte touches de fonction et flèches", () => {
    expect(accelFromEvent(ev("F12", { altKey: true }))).toBe("Alt+F12");
    expect(accelFromEvent(ev("F24", { altKey: true }))).toBe("Alt+F24");
    expect(accelFromEvent(ev("ArrowUp", { metaKey: true }))).toBe("Super+ArrowUp");
  });
  it("refuse une touche seule ou avec Maj seul (elle volerait la frappe)", () => {
    expect(accelFromEvent(ev("KeyA"))).toBeNull();
    expect(accelFromEvent(ev("Space", { shiftKey: true }))).toBeNull();
  });
  it("attend une vraie touche : un modificateur seul ou une touche inconnue ne valide rien", () => {
    expect(accelFromEvent(ev("ControlLeft", { ctrlKey: true }))).toBeNull();
    expect(accelFromEvent(ev("MediaPlayPause", { ctrlKey: true }))).toBeNull();
    expect(accelFromEvent(ev("F25", { ctrlKey: true }))).toBeNull();
  });
});

describe("formatAccel", () => {
  it("affiche des symboles macOS", () => {
    expect(formatAccel(DEFAULT_SHORTCUT)).toBe("⌃⌥ Espace");
    expect(formatAccel("Shift+Super+C")).toBe("⇧⌘ C");
    expect(formatAccel("Alt+F12")).toBe("⌥ F12");
  });
  it("vide = désactivé", () => expect(formatAccel("")).toBe("Désactivé"));
});
