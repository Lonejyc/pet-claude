// Détection des moments à fêter dans les commandes Bash de Claude : un commit réussi, ou un test / build qui repasse au vert après un échec.
export type Check = "test" | "build";

// `git commit` en début de commande ou après ; ; && || | (donc `git add . && git commit -m x`, `git -C dir commit`), pas `--dry-run`, pas un simple texte cité.
const COMMIT = /(?:^|[;&|]\s*)git\s+(?:-\S+\s+(?:\S+\s+)?)*commit(?![\w-])/;
export const isCommit = (cmd: string) => COMMIT.test(cmd.trim()) && !/--dry-run/.test(cmd);

const TEST = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|vitest|jest|pytest|cargo\s+test|go\s+test|rspec|phpunit)\b/;
const BUILD = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build|cargo\s+(?:build|check)|tsc|make|go\s+build|next\s+build|vite\s+build)\b/;

export function checkKind(cmd: string): Check | null {
  if (TEST.test(cmd)) return "test";
  if (BUILD.test(cmd)) return "build";
  return null;
}
