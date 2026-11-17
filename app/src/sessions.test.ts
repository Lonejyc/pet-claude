import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sessions from "./sessions";

// Le module garde un état global : on vide les sessions entre deux tests.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  for (const s of sessions.all()) sessions.remove(s.id);
});

describe("sessions", () => {
  it("touch crée une session une seule fois et met à jour le cwd", () => {
    const a = sessions.touch("a", "/p/front");
    expect(sessions.touch("a", "/p/api")).toBe(a);
    expect(a.cwd).toBe("/p/api");
    expect(sessions.count()).toBe(1);
  });

  it("label numérote les sessions d'un même dossier", () => {
    const a = sessions.touch("a", "/p/front");
    expect(sessions.label(a)).toBe("front");
    const b = sessions.touch("b", "/x/front");
    expect(sessions.label(a)).toBe("front ·1");
    expect(sessions.label(b)).toBe("front ·2");
  });

  it("color donne une teinte différente à chaque session", () => {
    const a = sessions.touch("a");
    const b = sessions.touch("b");
    expect(sessions.color(a)).not.toBe(sessions.color(b));
  });

  it("prune supprime les sessions inactives mais épargne les occupées", () => {
    const idle = sessions.touch("idle");
    const busy = sessions.touch("busy");
    busy.busy = true;
    vi.advanceTimersByTime(60_000);
    sessions.prune(30_000);
    expect(sessions.all().map((s) => s.id)).toEqual(["busy"]);
    expect(idle.busy).toBe(false);
  });

  it("releaseStale libère une session occupée silencieuse (interruption Échap)", () => {
    const s = sessions.touch("a");
    s.busy = true;
    vi.advanceTimersByTime(9 * 60_000);
    expect(sessions.releaseStale(10 * 60_000)).toBe(false);
    expect(s.busy).toBe(true);
    vi.advanceTimersByTime(2 * 60_000);
    expect(sessions.releaseStale(10 * 60_000)).toBe(true);
    expect(s.busy).toBe(false);
    expect(sessions.anyBusy()).toBe(false);
    expect(sessions.releaseStale(10 * 60_000)).toBe(false);
  });
});

describe("editSummary", () => {
  it("décrit le nombre de fichiers modifiés", () => {
    expect(sessions.editSummary(0)).toBe("");
    expect(sessions.editSummary(1)).toBe("1 fichier modifié");
    expect(sessions.editSummary(4)).toBe("4 fichiers modifiés");
  });

  it("un Set dédoublonne le même fichier modifié plusieurs fois", () => {
    const s = sessions.touch("a");
    for (const f of ["/a.ts", "/b.ts", "/a.ts"]) s.files.add(f);
    expect(sessions.editSummary(s.files.size)).toBe("2 fichiers modifiés");
  });
});

describe("quickActions", () => {
  it("ne propose rien sans session", () => expect(sessions.quickActions(undefined)).toEqual([]));
  it("après un tour réussi : expliquer le changement et chercher les effets de bord", () => {
    const a = sessions.quickActions({ busy: false, last: "done" });
    expect(a[0]).toMatch(/Explique ce que tu viens de changer/);
    expect(a[1]).toMatch(/effets de bord/);
  });
  it("après une erreur : résumer l'erreur", () => expect(sessions.quickActions({ busy: false, last: "error" })[0]).toMatch(/Résume l'erreur/));
  it("pendant que Claude travaille : l'avancement, quel que soit le dernier tour", () => {
    expect(sessions.quickActions({ busy: true, last: "error" })[0]).toBe("Où en es-tu ?");
  });
  it("propose au plus 3 actions dans tous les cas", () => {
    for (const last of ["done", "error", null] as const) for (const busy of [true, false]) expect(sessions.quickActions({ busy, last }).length).toBeLessThanOrEqual(3);
  });
});
