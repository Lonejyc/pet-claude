import { afterEach, describe, expect, it } from "vitest";
import * as perm from "./permission";

afterEach(() => perm.clear());
const req = (id: number, timeoutMs = 20_000) => ({ id, tool: "Bash", input: { command: "rm -rf x" }, timeoutMs });

describe("file des permissions", () => {
  it("traite les demandes dans l'ordre d'arrivée", () => {
    perm.push(req(1), 0);
    perm.push(req(2), 0);
    expect(perm.current().id).toBe(1);
    expect(perm.pending()).toBe(2);
    perm.resolve(1);
    expect(perm.current().id).toBe(2);
    perm.resolve(99); // inconnue : sans effet
    expect(perm.pending()).toBe(1);
  });

  it("décompte les secondes avec une marge avant l'échéance de Rust", () => {
    perm.push(req(1, 20_000), 0);
    expect(perm.secondsLeft(perm.current(), 0)).toBe(19); // 20 s - 1,5 s de marge, arrondi au-dessus
    expect(perm.secondsLeft(perm.current(), 30_000)).toBe(0);
  });

  it("retire les demandes expirées et dit si la file a changé", () => {
    perm.push(req(1, 20_000), 0);
    perm.push(req(2, 40_000), 0);
    expect(perm.expire(10_000)).toBe(false);
    expect(perm.expire(25_000)).toBe(true);
    expect(perm.current().id).toBe(2);
  });
});

describe("describeInput", () => {
  it("affiche la commande, le fichier ou l'adresse", () => {
    expect(perm.describeInput({ command: "git push --force" })).toBe("git push --force");
    expect(perm.describeInput({ file_path: "/a/b.ts", content: "…" })).toBe("/a/b.ts");
    expect(perm.describeInput({ url: "https://example.com" })).toBe("https://example.com");
  });
  it("aplatit les retours à la ligne et tronque", () => {
    expect(perm.describeInput({ command: "a\n  b" })).toBe("a b");
    const long = perm.describeInput({ command: "x".repeat(500) });
    expect(long.length).toBe(perm.MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });
  it("retombe sur le JSON de l'entrée, ou {} si elle manque", () => {
    expect(perm.describeInput({ a: 1 })).toBe('{"a":1}');
    expect(perm.describeInput(null)).toBe("{}");
  });
});

describe("pendingSessions", () => {
  it("liste les sessions qui attendent, sans doublon ni demande sans session", () => {
    perm.push({ id: 1, session: "a", timeoutMs: 20_000 }, 0);
    perm.push({ id: 2, session: "a", timeoutMs: 20_000 }, 0);
    perm.push({ id: 3, timeoutMs: 20_000 }, 0);
    expect([...perm.pendingSessions()]).toEqual(["a"]);
    perm.resolve(1);
    perm.resolve(2);
    expect(perm.pendingSessions().size).toBe(0);
  });
});
