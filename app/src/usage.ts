import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

type Limit = { utilization: number; resets_at: string } | null | undefined;
type Money = { amount_minor: number; exponent: number };
type Plan = { usage: Record<string, Limit | unknown> & { spend?: { enabled: boolean; used: Money; limit?: Money | null } | null }; cachedAt: number | null } | null;
type Total = { tokens: number; cost: number };
type Row = Total & { name: string };
type Local = { day: Total; week: Total; models: Row[]; projects: Row[]; partial: boolean } | null;

const H = 3600e3;
// Limites affichées : celles de Sonnet et d'Opus n'apparaissent que si le forfait les renseigne.
const LIMITS: [key: string, label: string, windowMs: number, always: boolean][] = [
  ["five_hour", "Session · 5 h", 5 * H, true],
  ["seven_day", "Semaine", 7 * 24 * H, true],
  ["seven_day_sonnet", "Sonnet · semaine", 7 * 24 * H, false],
  ["seven_day_opus", "Opus · semaine", 7 * 24 * H, false],
];

const main = document.querySelector<HTMLElement>("main")!;
const footer = main.querySelector<HTMLElement>("footer")!;
let plan: Plan = null;
let local: Local = null;
let sessions = 0;

const el = (tag: string, cls: string, text = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};
const usd = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD" }).format(n);
const tok = (n: number) => new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const money = (m: Money) => usd(m.amount_minor / 10 ** m.exponent);

function resetText(at: Date) {
  const min = Math.max(0, Math.round((at.getTime() - Date.now()) / 60000));
  const left = min >= 1440 ? `${Math.floor(min / 1440)} j ${Math.floor((min % 1440) / 60)} h` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
  const today = at.toDateString() === new Date().toDateString();
  const when = at.toLocaleString("fr-FR", { weekday: today ? undefined : "short", hour: "2-digit", minute: "2-digit" });
  return `Reset dans ${left} · ${when}`;
}

function ago(ms: number) {
  const min = Math.round((Date.now() - ms) / 60000);
  return min < 60 ? `${min} min` : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} j`;
}

function section(label: string, value: string, high = false) {
  const s = el("section", "");
  const head = el("div", "head");
  const v = el("span", "pct", value);
  v.classList.toggle("high", high);
  head.append(el("span", "", label), v);
  s.append(head);
  return s;
}

function limitBlock(label: string, windowMs: number, limit: Limit) {
  const high = !!limit && limit.utilization >= 90;
  const s = section(label, limit ? `${Math.round(limit.utilization)} %` : "—", high);
  const bar = el("div", "bar");
  const fill = el("i", "");
  fill.classList.toggle("high", high);
  bar.append(fill);
  if (limit) {
    const at = new Date(limit.resets_at);
    const elapsed = 1 - (at.getTime() - Date.now()) / windowMs; // repère : où l'on en serait à rythme constant
    const tick = el("u", "");
    tick.style.left = `${Math.min(100, Math.max(0, elapsed * 100))}%`;
    fill.style.width = `${Math.min(100, limit.utilization)}%`;
    bar.append(tick);
    s.append(bar, el("p", "reset", resetText(at)));
  } else {
    s.append(bar, el("p", "reset", "Indisponible"));
  }
  return s;
}

const costRow = (name: string, t: Total) => {
  const r = el("div", "row");
  r.append(el("span", "", name), el("span", "", `≈ ${usd(t.cost)} · ${tok(t.tokens)}`));
  return r;
};

function costBlock(l: NonNullable<Local>) {
  const s = section("Coût estimé", "");
  s.append(costRow("24 h", l.day), costRow("7 jours", l.week));
  const details = el("details", "");
  details.append(el("summary", "", "Détails · 7 jours"));
  for (const r of [...l.models, ...l.projects]) details.append(costRow(r.name.replace(/^claude-/, ""), r));
  s.append(details);
  if (l.partial) s.append(el("p", "reset", "Certains modèles n'ont pas de tarif connu : coût sous-estimé."));
  return s;
}

function render() {
  const blocks: HTMLElement[] = [];
  const u = plan?.usage;
  for (const [key, label, windowMs, always] of LIMITS) {
    const limit = u?.[key] as Limit;
    if (limit || always) blocks.push(limitBlock(label, windowMs, limit));
  }
  if (plan?.cachedAt && Date.now() - plan.cachedAt > 15 * 60000) {
    blocks[blocks.length - 1].append(el("p", "reset", `Chiffres du cache de Claude Code, il y a ${ago(plan.cachedAt)}`));
  }
  if (u?.spend?.enabled) {
    const { used, limit } = u.spend;
    blocks.push(section("Crédits", limit ? `${money(used)} / ${money(limit)}` : money(used)));
  }
  if (local) blocks.push(costBlock(local));
  if (sessions > 0) blocks[blocks.length - 1].append(el("p", "reset", `${sessions} session${sessions > 1 ? "s" : ""} Claude en cours`));
  main.replaceChildren(...blocks, footer);
}

const toggle = footer.querySelector<HTMLButtonElement>("#toggle")!;
const showToggleLabel = async () => (toggle.textContent = (await invoke<boolean>("pet_hidden")) ? "Afficher le pet" : "Masquer le pet");
toggle.onclick = async () => {
  await invoke("toggle_pet");
  showToggleLabel();
};
footer.querySelector<HTMLButtonElement>("#settings")!.onclick = () => invoke("open_settings_cmd");
footer.querySelector<HTMLButtonElement>("#quit")!.onclick = () => invoke("quit");

function refresh() {
  showToggleLabel();
  invoke<Plan>("plan_usage").then((p) => ((plan = p), render()));
  invoke<Local>("local_usage").then((l) => ((local = l), render()));
}

// La fenêtre épouse son contenu (limites optionnelles, détails dépliés).
const win = getCurrentWindow();
new ResizeObserver(() => win.setSize(new LogicalSize(240, main.offsetHeight + 12))).observe(main);

listen<number>("sessions", ({ payload }) => ((sessions = payload), render()));
refresh();
window.addEventListener("focus", refresh);
