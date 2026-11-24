// Raccourci clavier global choisi par l'utilisateur : une chaîne « Control+Alt+Space » (format accepté par Rust, cf. shortcut.rs).
export const DEFAULT_SHORTCUT = "Control+Alt+Space";

const NAMED: Record<string, string> = { Space: "Space", Enter: "Enter", Tab: "Tab", Backquote: "Backquote", Minus: "Minus", Equal: "Equal", Comma: "Comma", Period: "Period", Slash: "Slash", Semicolon: "Semicolon", Quote: "Quote", BracketLeft: "BracketLeft", BracketRight: "BracketRight", Backslash: "Backslash" };

// Nom de la touche (sans modificateur) à partir de `KeyboardEvent.code`, ou null si elle n'est pas utilisable.
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  if (/^Arrow(Up|Down|Left|Right)$/.test(code)) return code;
  return NAMED[code] ?? null;
}

type Ev = Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

// Combinaison tapée -> raccourci, ou null tant qu'elle est incomplète : une touche seule (ou avec Maj seul) volerait la frappe à toutes les apps.
export function accelFromEvent(e: Ev): string | null {
  const key = keyName(e.code);
  if (!key || !(e.ctrlKey || e.altKey || e.metaKey)) return null;
  return [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super", key].filter(Boolean).join("+");
}

const SYMBOLS: Record<string, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘", Space: "Espace", Enter: "↩", Tab: "⇥", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Backquote: "`", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\" };

// « Control+Alt+Space » -> « ⌃⌥ Espace ». Vide = désactivé.
export function formatAccel(accel: string) {
  if (!accel) return "Désactivé";
  const parts = accel.split("+").map((p) => SYMBOLS[p] ?? p);
  const mods = parts.slice(0, -1).join("");
  return `${mods} ${parts[parts.length - 1]}`.trim();
}
