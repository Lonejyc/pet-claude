import { describe, expect, it } from "vitest";
import { classifyDrop, defaultQuestion, MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from "./attachment";

describe("classifyDrop", () => {
  it("accepte une capture d'écran", () => {
    expect(classifyDrop(["/Users/a/Bureau/Capture d'écran.PNG"], 1000)).toEqual({ ok: true, attachment: { path: "/Users/a/Bureau/Capture d'écran.PNG", name: "Capture d'écran.PNG", kind: "image" } });
  });
  it("accepte un log ou un fichier texte", () => {
    const v = classifyDrop(["/tmp/build.log"], 5000);
    expect(v.ok && v.attachment.kind).toBe("text");
  });
  it("refuse plusieurs fichiers", () => {
    expect(classifyDrop(["/a.png", "/b.png"], 10).ok).toBe(false);
    expect(classifyDrop([], 10).ok).toBe(false);
  });
  it("refuse un dossier (taille inconnue)", () => {
    const v = classifyDrop(["/tmp/dossier"], null);
    expect(!v.ok && v.reason).toMatch(/dossiers/);
  });
  it("refuse un type inconnu ou sans extension", () => {
    expect(classifyDrop(["/tmp/a.exe"], 10).ok).toBe(false);
    const v = classifyDrop(["/tmp/Makefile"], 10);
    expect(!v.ok && v.reason).toMatch(/sans extension/);
  });
  it("refuse au-delà de la taille maximale, accepte pile à la limite", () => {
    expect(classifyDrop(["/a.png"], MAX_IMAGE_BYTES + 1).ok).toBe(false);
    expect(classifyDrop(["/a.png"], MAX_IMAGE_BYTES).ok).toBe(true);
    expect(classifyDrop(["/a.log"], MAX_TEXT_BYTES + 1).ok).toBe(false);
  });
  it("propose une question par défaut selon le type", () => {
    expect(defaultQuestion({ path: "/a.png", name: "a.png", kind: "image" })).toMatch(/image/);
    expect(defaultQuestion({ path: "/a.log", name: "a.log", kind: "text" })).toMatch(/fichier/);
  });
});
