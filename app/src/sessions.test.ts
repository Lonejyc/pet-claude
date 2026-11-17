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
});
