import { describe, expect, it } from "vitest";
import { checkKind, isCommit } from "./celebrate";

describe("isCommit", () => {
  it("reconnaît un commit, seul ou dans une chaîne", () => {
    expect(isCommit('git commit -m "feat: x"')).toBe(true);
    expect(isCommit('git add -A && git commit -m "x"')).toBe(true);
    expect(isCommit("git -C app commit --amend --no-edit")).toBe(true);
    expect(isCommit("npm test; git commit -am wip")).toBe(true);
  });
  it("ignore --dry-run et ce qui n'est pas un commit", () => {
    expect(isCommit("git commit --amend --dry-run")).toBe(false);
    expect(isCommit("git status")).toBe(false);
    expect(isCommit("git log --grep='git commit'")).toBe(false);
    expect(isCommit('echo "git commit"')).toBe(false);
    expect(isCommit("git commit-tree HEAD^{tree}")).toBe(false);
  });
});

describe("checkKind", () => {
  it("reconnaît les tests", () => {
    for (const c of ["npm test", "pnpm run test", "npx vitest run", "cargo test --lib", "pytest -q", "go test ./..."]) expect(checkKind(c), c).toBe("test");
  });
  it("reconnaît les builds", () => {
    for (const c of ["npm run build", "cargo build --release", "npx tsc --noEmit", "make all", "vite build"]) expect(checkKind(c), c).toBe("build");
  });
  it("ignore le reste", () => {
    for (const c of ["ls -la", "git push", "cat package.json", "npm install"]) expect(checkKind(c), c).toBeNull();
  });
});
