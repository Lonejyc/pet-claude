import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { buildPet } from "./pet3d";
import { all, anyBusy, color, count, ignored, label, attentionTarget, cycle, editSummary, mostRecent, quickActions, prune, releaseStale, remove, touch, type Session } from "./sessions";
import { ACCESSORIES, setSkin } from "./skins";
import { toolPace } from "./audio-math";
import { EMPTY, newlyUnlocked, sessionWasClean, type Counters } from "./achievements";
import { checkKind, isCommit } from "./celebrate";
import { formatStats, warnState, type Stats } from "./stats";
import * as history from "./history";
import { fail, isHeavy, isNervous, streakKey, succeed } from "./nervous";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { classifyDrop, defaultQuestion, type Attachment } from "./attachment";
import * as perm from "./permission";
import { setSoundConfig, setToolPitch, sound } from "./sound";

type Hook = { event: string; session?: string | null; cwd?: string | null; tool?: string; file?: string; command?: string | null; message?: string };

const pet = document.querySelector<HTMLElement>("#pet")!;
const bubble = document.querySelector<HTMLElement>("#bubble")!;
buildPet(document.querySelector<HTMLElement>("#rig")!);
setSkin(pet, "orange", "none"); // avant l'arrivée des réglages
// Un "tok" à chaque coup de marteau (impacts à 5 %, 21 % et 38 % du cycle de 2 s défini dans styles.css).
const hammer = document.querySelector<HTMLElement>(".hammer")!;
const tokOnImpacts = () => [100, 420, 760].forEach((ms) => setTimeout(sound.tok, ms));
hammer.addEventListener("animationstart", tokOnImpacts);
hammer.addEventListener("animationiteration", tokOnImpacts);

const typed = document.querySelector<HTMLElement>("#typed")!;
const bubbleTag = document.querySelector<HTMLElement>("#bubble-tag")!;
// Économie d'énergie : Rust ralentit sa surveillance et n'envoie plus de positions quand le pet dort.
let wasSleeping = false;
let stateTimer: number;
let bubbleTimer: number;
let typeTimer: number;

// Budget de répétition : pas de bulle si le pet a parlé il y a moins de 12 s, sauf si un outil a échoué pendant le tour.
let COOLDOWN_MS = 12_000; // réglable (fenêtre de réglages)
let lastSpokeAt = 0;

// Outil en cours -> accessoire du pet (cf. [data-tool] dans styles.css)
const TOOL_KINDS: Record<string, string> = {
  Read: "read", Grep: "read", Glob: "read",
  Bash: "bash",
  Edit: "edit", Write: "edit", MultiEdit: "edit", NotebookEdit: "edit",
  WebSearch: "web", WebFetch: "web",
};

// Confettis seulement après un tour chargé (>= 3 outils) et sans échec : sinon ils perdent leur sens.
const CONFETTI_MIN_TOOLS = 3;

function confetti() {
  if (stealthActive()) return;
  for (let i = 0; i < 24; i++) {
    const c = document.createElement("div");
    c.className = "confetti";
    c.style.background = `hsl(${Math.random() * 360} 90% 60%)`;
    c.style.setProperty("--dx", `${(Math.random() - 0.5) * 220}px`);
    c.style.setProperty("--dy", `${-60 - Math.random() * 90}px`);
    c.style.setProperty("--rot", `${Math.random() * 720}deg`);
    c.addEventListener("animationend", () => c.remove());
    pet.append(c);
  }
  sound.tada();
}

// Bruit de frappe : un clic toutes les 140 ms, un par coup de bras (les bras alternent, cf. @keyframes tap).
let typingTimer: number;

function setState(state: string, thenAfterMs?: number, then = "idle") {
  pet.dataset.state = state;
  const sleeping = state === "sleeping";
  if (sleeping !== wasSleeping) {
    wasSleeping = sleeping;
    invoke("set_sleeping", { sleeping });
  }
  if (state !== "sleeping" && state !== "emote") lastActivity = Date.now();
  delete pet.dataset.tool;
  delete pet.dataset.emote;
  pet.removeAttribute("data-nervous"); // la nervosité ne survit pas à un changement d'état
  clearInterval(typingTimer);
  clearTimeout(stateTimer);
  if (thenAfterMs) stateTimer = setTimeout(() => setState(then), thenAfterMs);
}

// Le pet parle sur la 1re ligne de la réponse (cf. output style) : première phrase, sans markdown, coupée à MAX_CHARS.
const MAX_CHARS = 110;
const firstSentence = (text: string) => {
  const sentence = text.replace(/[*`#>_]/gu, "").trim().split(/(?<=[.!?:])\s|\n/)[0];
  return sentence.length > MAX_CHARS ? sentence.slice(0, MAX_CHARS - 1) + "…" : sentence;
};

// Texte tapé lettre par lettre ; le pet "parle" (petits sauts) tant qu'il tape.
function say(text: string, session?: Session, extra = "") {
  if (stealthActive()) return settle(); // pendant un appel : pas de bulle
  const full = firstSentence(text) + (extra ? ` · ${extra}` : "");
  // pastille du projet seulement s'il y a plusieurs sessions : sinon c'est du bruit
  bubbleTag.hidden = !session || count() < 2;
  if (session) {
    bubbleTag.textContent = label(session);
    bubble.style.setProperty("--tag", color(session));
  }
  bubbleTools.hidden = true;
  // cliquer la bulle ramène le terminal de la session au premier plan
  if (session?.app) bubble.dataset.app = session.app;
  else delete bubble.dataset.app;
  let i = 0;
  lastSpokeAt = Date.now();
  clearInterval(typeTimer);
  clearTimeout(bubbleTimer);
  typed.textContent = "";
  bubble.hidden = false;
  setState("talking");
  typeTimer = setInterval(() => {
    typed.textContent = full.slice(0, ++i);
    if (i % 2 && full[i - 1] !== " ") sound.blip();
    if (i < full.length) return;
    clearInterval(typeTimer);
    settle();
    bubbleTimer = setTimeout(() => (bubble.hidden = true), 8000);
  }, 35);
}

// Petit saut de joie (cf. .hop dans styles.css).
function hop() {
  pet.classList.remove("hop");
  void pet.offsetWidth; // relance l'animation si elle tourne déjà
  pet.classList.add("hop");
  setTimeout(() => pet.classList.remove("hop"), 700);
}

// Cliquer la bulle d'une fin de tâche ramène le terminal de la session au premier plan.
bubble.addEventListener("click", () => {
  if (!bubble.dataset.app) return;
  invoke("focus_app", { bundleId: bubble.dataset.app });
  clearTimeout(bubbleTimer);
  bubble.hidden = true;
});

// Demandes de permission : la bulle « Autoriser / Refuser » remplace la bulle de parole tant qu'une demande attend.
// Sans clic, Rust rend la main au terminal à l'expiration (jamais d'« oui » par défaut).
const permBox = document.querySelector<HTMLElement>("#perm")!;
const permTag = document.querySelector<HTMLElement>("#perm-tag")!;
const permTitle = document.querySelector<HTMLElement>("#perm-title")!;
const permCmd = document.querySelector<HTMLElement>("#perm-cmd")!;
const permTimer = document.querySelector<HTMLElement>("#perm-timer")!;

function renderPerm() {
  const r = perm.current();
  permBox.hidden = !r;
  if (!r) return;
  const s = all().find((x) => x.id === r.session);
  permTag.hidden = !s || count() < 2;
  if (s) {
    permTag.textContent = label(s);
    permBox.style.setProperty("--tag", color(s));
  }
  permTitle.textContent = `Claude veut utiliser ${r.tool ?? "un outil"}${perm.pending() > 1 ? ` (+${perm.pending() - 1} en attente)` : ""}`;
  permCmd.textContent = perm.describeInput(r.input);
  permTimer.textContent = `Sinon le terminal prend le relais dans ${perm.secondsLeft(r)} s`;
}

function decidePerm(allow: boolean) {
  const r = perm.current();
  if (!r) return;
  invoke("decide", { id: r.id, allow });
  perm.resolve(r.id);
  renderPerm();
  renderAttention();
}

listen<{ id: number; session?: string | null; cwd?: string | null; tool?: string; input?: Record<string, unknown> | null; timeoutMs: number }>("permission", ({ payload }) => {
  perm.push(payload);
  clearTimeout(bubbleTimer);
  bubble.hidden = true;
  closeChat();
  wake();
  hop();
  sound.yelp();
  renderPerm();
  renderAttention();
});
document.querySelector("#perm-allow")!.addEventListener("click", () => decidePerm(true));
document.querySelector("#perm-deny")!.addEventListener("click", () => decidePerm(false));
// Entrée / Échap seulement quand la fenêtre du pet a le focus (après un clic) : jamais de focus volé au terminal.
document.addEventListener("keydown", (e) => {
  if (permBox.hidden || (e.key !== "Enter" && e.key !== "Escape")) return;
  e.preventDefault();
  decidePerm(e.key === "Enter");
});
setInterval(() => {
  const changed = perm.expire();
  if (changed) renderAttention();
  if (changed || perm.current()) renderPerm(); // y compris pour masquer la carte d'une demande expirée
}, 1000);

// Raccourci clavier global (cf. shortcut.rs) : Rust a déjà placé le pet au centre de l'écran actif.
listen("open-chat", () => {
  wake();
  openChat();
});

// Le pet reste "au travail" tant qu'une autre session a un outil en cours.
const settle = () => setState(anyBusy() ? "working" : "idle");

// Indicateur d'attention : avec plusieurs sessions, le pet s'entoure de la couleur de celle qui a besoin de toi.
// Molette ou clic droit sur le pet : on feuillette les sessions, la bulle redit leur dernier message.
// Gros diff non commité (> 500 lignes) : une goutte de sueur. Mesuré par Rust (cache 30 s) après chaque modification et en fin de tour.
function renderSweat() {
  pet.classList.toggle("sweat", isHeavy(mostRecent()?.diff));
}
function refreshDiff(session: Session) {
  if (!session.cwd || Date.now() - session.diffAt < 15_000) return;
  session.diffAt = Date.now();
  invoke<number | null>("git_diff_size", { cwd: session.cwd }).then((n) => {
    session.diff = n;
    renderSweat();
  });
}

// Moments à fêter : commit réussi (confettis), test ou build qui repasse au vert (saut + ta-da).
// Succès : compteurs locaux (fichiers modifiés, tests réparés, sessions sans erreur) qui débloquent des accessoires dans les réglages.
let counters: Counters = { ...EMPTY };
invoke<Counters>("get_achievements").then((c) => (counters = { ...EMPTY, ...c }));
function bump(key: keyof Counters, n: number) {
  if (n <= 0) return;
  const before = { ...counters };
  counters[key] += n;
  invoke("save_achievements", { counters });
  const unlocked = newlyUnlocked(before, counters);
  if (!unlocked.length) return;
  // un peu plus tard : on laisse d'abord lire le message de fin de tour
  setTimeout(() => {
    say(`Nouvel accessoire : ${unlocked.map((a) => ACCESSORIES[a].toLowerCase()).join(" et ")} ! Dans Réglages > Apparence.`);
    hop();
  }, 6000);
}

let lastCelebrationAt = 0;
function celebrateNow(big: boolean) {
  lastCelebrationAt = Date.now();
  wake();
  hop();
  if (big && CONFETTI) confetti();
  else sound.tada();
}

// Coût de la session et remplissage du contexte : au survol du pet, dans le menu de la barre de menus, et une alerte à 80 %.
const statsChip = document.querySelector<HTMLElement>("#stats")!;
function refreshStats(session: Session, force = false) {
  if (!force && Date.now() - session.statsAt < 20_000) return;
  session.statsAt = Date.now();
  invoke<Stats | null>("session_stats", { id: session.id }).then((s) => {
    session.stats = s;
    if (!s) return;
    const w = warnState(session.warned, s.pct);
    session.warned = w.warned;
    if (w.notify) say(`Le contexte de ${label(session)} est rempli à ${s.pct} %, la compaction approche.`, session);
    if (!statsChip.hidden) showStats();
  });
}
function showStats() {
  const s = mostRecent();
  statsChip.hidden = !s?.stats;
  if (s?.stats) statsChip.textContent = formatStats(label(s), s.stats);
}
pet.addEventListener("pointerenter", () => {
  const s = mostRecent();
  if (!s || drag || stealthActive()) return;
  showStats();
  refreshStats(s, true);
});
pet.addEventListener("pointerleave", () => (statsChip.hidden = true));

let viewed: Session | undefined;
function renderAttention() {
  const s = count() >= 2 ? attentionTarget(perm.pendingSessions()) : undefined;
  if (s) {
    pet.style.setProperty("--attn", color(s));
    pet.dataset.attn = "1";
  } else delete pet.dataset.attn;
}
function cycleView(delta: number) {
  if (count() < 2) return;
  viewed = cycle(viewed && all().includes(viewed) ? viewed : mostRecent(), delta);
  if (viewed) say(viewed.said || "Rien à te dire pour l'instant.", viewed);
}
let lastWheel = 0;
pet.addEventListener("wheel", (e) => {
  if (count() < 2) return;
  e.preventDefault();
  if (Date.now() - lastWheel < 350) return; // une molette envoie des dizaines d'événements : un cran = une session
  lastWheel = Date.now();
  cycleView(e.deltaY > 0 ? 1 : -1);
}, { passive: false });
pet.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  cycleView(1);
});

let lastToolAt = 0; // pour l'allure des outils : écart entre deux PreToolUse, toutes sessions confondues
listen<Hook>("hook", ({ payload }) => {
  const id = payload.session ?? "default";
  if (ignored.has(id)) return;
  if (payload.event === "SessionEnd") {
    const ended = all().find((s) => s.id === id);
    if (ended && sessionWasClean({ tools: ended.toolsAll, errors: ended.errors })) bump("cleanSessions", 1);
    remove(id);
    if (pet.dataset.state === "working") settle();
    renderAttention();
    return;
  }
  const session = touch(id, payload.cwd);
  // Nouveau prompt = nouveau tour : repart de zéro même si le précédent a été interrompu (Échap) sans Stop.
  if (payload.event === "UserPromptSubmit") {
    session.busy = true;
    session.tools = 0;
    session.failed = false;
    session.attention = false;
    session.files.clear();
    // l'app active à cet instant est le terminal où l'utilisateur vient de taper son prompt
    invoke<string | null>("frontmost_app").then((app) => app && (session.app = app));
    setState("working");
  }
  // Fin d'un outil : le clavier se tait, même si Claude continue à rédiger.
  if (payload.event === "PostToolUse") {
    clearInterval(typingTimer);
    session.streak = succeed(session.streak, streakKey(payload.tool, payload.command));
    if (payload.tool && TOOL_KINDS[payload.tool] === "edit") refreshDiff(session);
    if (payload.tool === "Bash" && payload.command) {
      if (isCommit(payload.command)) {
        session.diffAt = 0; // le diff vient de changer : remesure au prochain outil
        refreshDiff(session);
        celebrateNow(true);
      } else {
        const kind = checkKind(payload.command);
        if (kind && session.red === kind) {
          session.red = null;
          bump("fixes", 1);
          celebrateNow(false); // test ou build repassé au vert
        }
      }
    }
  }
  if (payload.event === "PreToolUse") {
    const gap = lastToolAt ? Date.now() - lastToolAt : undefined;
    lastToolAt = Date.now();
    const { pitch, intervalMs: interval } = toolPace(gap);
    setToolPitch(pitch);
    session.busy = true;
    session.tools++;
    session.toolsAll++;
    setState("working");
    const kind = payload.tool && TOOL_KINDS[payload.tool];
    if (kind) pet.dataset.tool = kind;
    if (kind === "edit" && payload.file) session.files.add(payload.file);
    if (kind === "bash") {
      sound.key();
      typingTimer = setInterval(sound.key, interval);
    }
  }
  // Claude continue en général après un échec : retour au travail, c'est Stop qui calmera le pet.
  if (payload.event === "PostToolUseFailure") {
    session.failed = true;
    session.errors++;
    session.attention = true;
    session.last = "error";
    session.streak = fail(session.streak, streakKey(payload.tool, payload.command));
    if (payload.tool === "Bash" && payload.command) session.red = checkKind(payload.command) ?? session.red;
    // même commande qui échoue en boucle : le pet n'en peut plus (tremble plus longtemps et plus vite)
    const nervous = isNervous(session.streak);
    setState("worried", nervous ? 6000 : 2500, "working");
    pet.toggleAttribute("data-nervous", nervous);
    sound.worried();
  }
  // Claude attend l'utilisateur (permission, question…) : cette session réclame de l'attention jusqu'au prochain prompt.
  if (payload.event === "Notification") session.attention = true;
  if (payload.event === "Stop") {
    session.busy = false;
    session.attention = session.failed; // un tour en erreur garde l'attention
    viewed = undefined; // un nouveau message prend la main sur la session relue à la molette
    if (payload.message) session.said = payload.message;
    if (payload.message && (session.failed || Date.now() - lastSpokeAt > COOLDOWN_MS)) say(payload.message, session, editSummary(session.files.size));
    else settle();
    session.last = session.failed ? "error" : "done";
    const celebrate = CONFETTI && session.tools >= CONFETTI_MIN_TOOLS && !session.failed && Date.now() - lastCelebrationAt > 5000;
    if (celebrate) confetti();
    // l'utilisateur est ailleurs (Slack, navigateur…) : le pet saute, avec le ta-da si les confettis ne l'ont pas déjà joué
    invoke<string | null>("frontmost_app").then((front) => {
      if (!session.app || front === session.app) return;
      hop();
      if (!celebrate) sound.tada();
    });
    bump("files", session.files.size);
    session.failed = false;
    session.tools = 0;
    session.files.clear();
    refreshDiff(session);
    refreshStats(session, true);
  }
  if (payload.event === "PostToolUse") refreshStats(session);
  const recent = mostRecent();
  if (recent && payload.event === "Stop") emit("focus-session", { id: recent.id, label: label(recent) });
  renderAttention();
});


// Appui = le pet s'écrase comme une balle, relâchement = il rebondit.
// Si on bouge de plus de 4 px, on déplace la fenêtre à la main (le drag natif bloque les événements jusqu'au relâchement).
// Relâché en mouvement, il est lancé : il vole, rebondit sur les bords de l'écran et retombe.
type Sample = { t: number; x: number; y: number };
type Drag = { origin?: { x: number; y: number }; mouse0?: { x: number; y: number }; moved: boolean; samples: Sample[]; pos?: { x: number; y: number } };
let drag: Drag | null = null;
let flying = false;

// Écrans en coordonnées logiques (points). La fenêtre est toujours ramenée ENTIÈREMENT sur l'écran où se trouve le pointeur :
// à cheval sur deux écrans, macOS la dessine des deux côtés et le pet apparaît en double.
type Rect = { x: number; y: number; w: number; h: number };
type Screen = Rect & { work: Rect };
let screens: Screen[] = [];
async function refreshScreens() {
  const list = await invoke<{ frame: Rect; work: Rect }[]>("screens");
  screens = list.map((sc) => ({ ...sc.frame, work: sc.work }));
}
refreshScreens();
const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const within = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const screenAt = (x: number, y: number) => screens.find((r) => inside(r, x, y)) ?? screens[0];

// Un seul setPosition en vol à la fois (la dernière position gagne), sinon les appels s'empilent et la fenêtre traîne derrière le pet.
let latest: { x: number; y: number } | null = null;
let pumping = false;
async function setPos(x: number, y: number) {
  latest = { x, y };
  if (pumping) return;
  pumping = true;
  while (latest) {
    const { x: px, y: py } = latest;
    latest = null;
    await invoke("set_window_origin", { x: px, y: py });
  }
  pumping = false;
}

pet.addEventListener("pointerdown", (e) => {
  flying = false;
  wake();
  pet.setPointerCapture(e.pointerId);
  refreshScreens(); // un écran a pu être branché ou déplacé
  const d: Drag = { moved: false, samples: [] };
  drag = d;
  // position de la fenêtre et du pointeur dans le repère natif : tout le reste du drag en dérive par différence
  Promise.all([invoke<[number, number]>("window_origin"), invoke<[number, number]>("mouse")]).then(([o, m]) => {
    d.origin = { x: o[0], y: o[1] };
    d.mouse0 = { x: m[0], y: m[1] };
  });
  pet.classList.remove("boing", "drop", "held");
  pet.classList.add("pressed");
  sound.squish();
});

// Tout le drag se calcule avec la souris NATIVE (`mouse`), jamais avec e.screenX/Y : WebKit les exprime par rapport à l'écran
// de la fenêtre, donc ils changent quand elle passe d'un écran à l'autre, ce qui faisait osciller le pet entre deux positions.
let moveSeq = 0;
pet.addEventListener("pointermove", async () => {
  const d = drag;
  if (!d?.origin || !d.mouse0) return;
  const seq = ++moveSeq;
  const [mx, my] = await invoke<[number, number]>("mouse");
  if (seq !== moveSeq || drag !== d) return; // réponse périmée, ou drag terminé entre-temps
  const dx = mx - d.mouse0.x;
  const dy = my - d.mouse0.y;
  if (!d.moved) {
    if (Math.hypot(dx, dy) <= 4) return;
    d.moved = true;
    pet.classList.remove("pressed");
    pet.classList.add("held");
    sound.yelp();
  }
  const s = screenAt(mx, my);
  const x = d.origin.x + dx;
  const y = d.origin.y + dy;
  const padX = (WIN.w - PET.w) / 2;
  // fenêtre bornée à l'écran du pointeur (le pet peut toucher les bords, y compris le haut de l'écran)
  d.pos = s
    ? { x: within(x, s.x - padX, s.x + s.w - WIN.w + padX), y: within(y, s.y - (WIN.h - PET.bottomMargin - PET.h), s.y + s.h - WIN.h + PET.bottomMargin) }
    : { x, y };
  setPos(d.pos.x, d.pos.y);
  d.samples = [...d.samples, { t: performance.now(), x: mx, y: my }].slice(-6);
});

// Atterrissage final (depuis la position "tenu") ou rebond en plein vol ; k = force de l'impact, entre 0 et 1.
function squash(cls: "drop" | "bounce", k = 1) {
  pet.style.setProperty("--k", String(k));
  pet.classList.remove(cls);
  void pet.offsetWidth; // relance l'animation même si elle vient de jouer
  pet.classList.add(cls);
  sound.thump();
}

// Zone de vol : l'écran entier pour le plafond (le pet peut passer sur la barre de menu), la zone de travail ailleurs (le pet se pose sur le Dock).
const WIN = { w: 280, h: 296 };
const PET = { w: 150, h: 112, bottomMargin: 36 }; // doit rester cohérent avec tauri.conf.json et styles.css
function flightBounds(from: { x: number; y: number }) {
  // l'écran qui contient le centre du pet
  const s = screenAt(from.x + WIN.w / 2, from.y + WIN.h - PET.bottomMargin - PET.h / 2);
  if (!s) return null;
  const padX = (WIN.w - PET.w) / 2;
  return {
    minX: s.work.x - padX,
    maxX: s.work.x + s.work.w - WIN.w + padX,
    minY: s.y - (WIN.h - PET.bottomMargin - PET.h),
    maxY: s.work.y + s.work.h - WIN.h + PET.bottomMargin,
  };
}

// Physique : pas fixe de 4 ms (même résultat à 60 ou 120 Hz), unités px et ms.
const STEP = 4;
const GRAVITY = 0.003;
const FLOOR_E = 0.3; // rebond sol / murs / plafond : part de la vitesse conservée
const WALL_E = 0.35;
const CEIL_E = 0.25;
const FLOOR_FRICTION = 0.008; // /ms : le pet glisse puis s'arrête
const REST_SPEED = 0.05; // sous cette vitesse verticale au sol, il est posé
const MIN_IMPACT = 0.2; // en dessous : pas de squash ni de son
const MAX_IMPACT = 1.2; // impact "maximal" pour l'échelle du squash

function fly(from: { x: number; y: number }, v: { x: number; y: number }) {
  const b = flightBounds(from);
  if (!b) {
    pet.classList.remove("held");
    return squash("drop");
  }
  let { x, y } = from;
  let { x: vx, y: vy } = v;
  let last = performance.now();
  let acc = 0;
  flying = true;

  const frame = (now: number) => {
    if (!flying) return;
    acc += Math.min(now - last, 50);
    last = now;
    let impact = 0;
    let landed = false;
    while (acc >= STEP && !landed) {
      acc -= STEP;
      vy += GRAVITY * STEP;
      vx *= 1 - AIR_DRAG * STEP;
      vy *= 1 - AIR_DRAG * STEP;
      x += vx * STEP;
      y += vy * STEP;
      if (x < b.minX || x > b.maxX) {
        x = Math.max(b.minX, Math.min(b.maxX, x));
        impact = Math.max(impact, Math.abs(vx));
        vx *= -WALL_E;
      }
      if (y < b.minY) {
        y = b.minY;
        impact = Math.max(impact, Math.abs(vy));
        vy *= -CEIL_E;
      }
      if (y >= b.maxY) {
        y = b.maxY;
        if (vy > 0) {
          impact = Math.max(impact, vy);
          vy = vy * FLOOR_E < REST_SPEED ? 0 : -vy * FLOOR_E;
        }
        vx *= Math.exp(-FLOOR_FRICTION * STEP);
        landed = vy === 0 && Math.abs(vx) < 0.01;
      }
    }
    setPos(x, y);
    if (landed) {
      flying = false;
      pet.classList.remove("held");
      squash("drop", Math.min(1, impact / MAX_IMPACT) || 0.3);
      return;
    }
    if (impact > MIN_IMPACT) squash("bounce", Math.min(1, impact / MAX_IMPACT));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const THROW_MIN_SPEED = 0.5; // px/ms
const THROW_MAX_SPEED = 1.6;
const THROW_GAIN = 0.6; // le pet est plus lourd que la souris : il part avec 60 % de sa vitesse
const AIR_DRAG = 0.0008; // /ms
const SPEED_WINDOW_MS = 100;
function release() {
  if (!drag) return;
  const d = drag;
  drag = null;
  pet.classList.remove("pressed");
  if (!d.moved) {
    pet.classList.add("boing");
    sound.boing();
    return;
  }
  // vitesse du pointeur sur les dernières SPEED_WINDOW_MS ; un pointeur resté immobile avant le relâchement ne lance rien
  const now = performance.now();
  const recent = d.samples.filter((p) => now - p.t <= SPEED_WINDOW_MS);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = first && last ? last.t - first.t : 0;
  let v = dt > 0 ? { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt } : { x: 0, y: 0 };
  const speed = Math.hypot(v.x, v.y);
  if (d.pos && speed > THROW_MIN_SPEED) {
    if (speed > THROW_MAX_SPEED) v = { x: (v.x / speed) * THROW_MAX_SPEED, y: (v.y / speed) * THROW_MAX_SPEED };
    fly(d.pos, { x: v.x * THROW_GAIN, y: v.y * THROW_GAIN }); // il reste "tenu" (panique) pendant le vol
  } else {
    pet.classList.remove("held");
    squash("drop");
  }
}
pet.addEventListener("pointerup", release);
pet.addEventListener("pointercancel", release);
pet.addEventListener("animationend", (e) => {
  if (e.animationName === "boing") pet.classList.remove("boing");
  if (e.animationName === "drop") pet.classList.remove("drop");
  if (e.animationName === "bounce") pet.classList.remove("bounce");
});

// Vie autonome : il cligne des yeux, et s'endort après SLEEP_AFTER_MS sans rien faire (n'importe quel hook ou clic le réveille).
let SLEEP_AFTER_MS = 60_000; // réglable (fenêtre de réglages)
let CONFETTI = true; // réglable (fenêtre de réglages)
let lastActivity = Date.now();

function wake() {
  lastActivity = Date.now();
  if (pet.dataset.state === "sleeping") setState("idle");
}

// Le menu de la barre de menus (côté Rust) affiche le nombre de sessions : on le lui envoie quand il change.
let sentSessions = -1;
const BUSY_MAX_MS = 10 * 60_000; // sans aucun hook depuis ce délai, une session « occupée » est considérée libre (interruption par Échap)
setInterval(() => {
  if (releaseStale(BUSY_MAX_MS) && pet.dataset.state === "working") settle();
  prune(6 * 3600_000);
  if (count() !== sentSessions) emit("sessions", (sentSessions = count()));
  if (pet.dataset.state === "idle" && Date.now() - lastActivity > SLEEP_AFTER_MS) {
    if (!EMOTES) setState("sleeping");
    else if (Date.now() - lastEmoteAt > EMOTE_EVERY_MS) emote();
  }
}, 5000);

// Emotes : au lieu de s'endormir, le pet en joue une toutes les EMOTE_EVERY_MS (réglable). `/emote [nom]` dans le chat en joue une tout de suite.
const EMOTE_LIST = ["six-seven", "cymbals"];
const EMOTE_MS = 4000;
let EMOTES = false;
let EMOTE_EVERY_MS = 30_000;
let lastEmoteAt = 0;
let lastEmote = "";
function emote(name?: string) {
  const choices = EMOTE_LIST.filter((n) => n !== lastEmote);
  const pick = name && EMOTE_LIST.includes(name) ? name : choices[Math.floor(Math.random() * choices.length)];
  lastEmote = pick;
  lastEmoteAt = Date.now();
  setState("emote");
  pet.dataset.emote = pick;
  if (pick === "cymbals") {
    sound.crash();
    typingTimer = setInterval(sound.crash, 500); // le claquement tombe sur le début de chaque cycle CSS de 0,5 s
  }
  stateTimer = setTimeout(() => {
    const keep = lastActivity; // la fin d'une emote ne compte pas comme une activité : la suivante reste à l'heure
    setState("idle");
    lastActivity = keep;
  }, EMOTE_MS);
}

// Le pet prévient quand la session de 5 h passe 80 % puis 90 % (vérifié toutes les 15 min ; pas au lancement).
let usageLevel: number | null = null;
async function checkUsage() {
  const plan = await invoke<{ usage: { five_hour?: { utilization: number } | null } } | null>("plan_usage");
  const pct = plan?.usage.five_hour?.utilization;
  if (pct === undefined) return;
  const level = pct >= 90 ? 90 : pct >= 80 ? 80 : 0;
  if (usageLevel !== null && level > usageLevel) say(`Déjà ${Math.round(pct)} % de ta session de 5 h consommée.`);
  usageLevel = level;
}
checkUsage();
setInterval(checkUsage, 15 * 60_000);

function blinkLater() {
  setTimeout(() => {
    pet.classList.add("blink");
    setTimeout(() => pet.classList.remove("blink"), 130);
    blinkLater();
  }, 3000 + Math.random() * 4000);
}
blinkLater();

// Le pet se tourne vers le curseur et le suit des yeux (position relative au pet, envoyée par Rust).
const clamp = (v: number) => Math.max(-1, Math.min(1, v / 250));
listen<[number, number]>("cursor", ({ payload: [dx, dy] }) => {
  if (pet.dataset.state === "sleeping") return;
  pet.style.setProperty("--ry", String(clamp(dx) * 22));
  pet.style.setProperty("--rx", String(-clamp(dy) * 12));
  pet.style.setProperty("--lx", String(clamp(dx) * 3));
  pet.style.setProperty("--ly", String(clamp(dy) * 2));
});

// Mini-chat : double-clic sur le pet -> champ de saisie ; Entrée envoie, Échap ou clic ailleurs ferme, Tab change de session.
// La question part dans une COPIE de la session visée (lecture seule, cf. chat.rs) : la session du terminal n'est pas touchée.
const chat = document.querySelector<HTMLElement>("#chat")!;
const chatInput = document.querySelector<HTMLInputElement>("#chat-input")!;
const chips = document.querySelector<HTMLElement>("#chat-chips")!;
let chatOpen = false;
let target: Session | undefined; // session visée : par défaut la plus récemment active

function renderChips() {
  chips.replaceChildren(
    ...all().map((s) => {
      const chip = document.createElement("span");
      chip.textContent = label(s);
      chip.style.setProperty("--tag", color(s));
      chip.classList.toggle("selected", s === target);
      chip.addEventListener("click", () => {
        target = s;
        renderChips();
        chatInput.focus();
      });
      return chip;
    }),
  );
  // les sessions déjà ouvertes n'apparaissent qu'à leur prochain hook ; sans session, le chat ne lit aucun fichier (cf. chat.rs)
  renderQuick();
  if (!count() && !attachment) chips.innerHTML = `<span class="none">Aucune session vue : question générale, ou ouvre Claude Code dans ton dossier.</span>`;
}

// Actions rapides : trois questions toutes prêtes selon ce que Claude vient de faire (Alt+1/2/3 au clavier).
const quick = document.querySelector<HTMLElement>("#chat-quick")!;
let quickList: string[] = [];
function renderQuick() {
  quickList = attachment ? [] : quickActions(target);
  quick.replaceChildren(
    ...quickList.map((q, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = q;
      b.append(Object.assign(document.createElement("kbd"), { textContent: `⌥${i + 1}` }));
      b.addEventListener("click", () => sendQuick(i));
      return b;
    }),
  );
}
function sendQuick(i: number) {
  const q = quickList[i];
  if (!q || asking) return;
  closeChat();
  ask(q);
}
quick.addEventListener("mousedown", (e) => e.preventDefault()); // ne pas perdre le focus, sinon le chat se ferme

// Pièce jointe déposée sur le pet : une puce « 📎 nom ✕ » au-dessus du champ ; un clic la retire.
let attachment: Attachment | null = null;
const attachChip = document.querySelector<HTMLElement>("#chat-attach")!;
function renderAttach() {
  attachChip.hidden = !attachment;
  if (attachment) attachChip.textContent = `📎 ${attachment.name}  ✕`;
  renderQuick();
  chatInput.placeholder = attachment ? "Ta question sur ce fichier ?" : "Pose-moi une question…";
}
attachChip.addEventListener("mousedown", (e) => e.preventDefault()); // ne pas perdre le focus, sinon le chat se ferme
attachChip.addEventListener("click", () => {
  attachment = null;
  renderAttach();
});

// Fichier déposé sur le pet (cf. native.rs : la fenêtre redevient réceptive quand un glisser arrive sur le pet).
getCurrentWebview().onDragDropEvent(async ({ payload }) => {
  if (payload.type === "enter" || payload.type === "over") return pet.classList.add("dropping");
  pet.classList.remove("dropping");
  if (payload.type !== "drop") return;
  const size = payload.paths.length === 1 ? await invoke<number | null>("file_size", { path: payload.paths[0] }) : null;
  const verdict = classifyDrop(payload.paths, size);
  if (!verdict.ok) {
    say(verdict.reason);
    setState("worried", 2500);
    return;
  }
  wake();
  attachment = verdict.attachment;
  await openChat();
  renderAttach();
});

async function openChat() {
  if (chatOpen) return;
  chatOpen = true;
  clearTimeout(bubbleTimer);
  bubble.hidden = true;
  chatInput.value = "";
  target = viewed && all().includes(viewed) ? viewed : (attentionTarget(perm.pendingSessions()) ?? mostRecent());
  renderChips();
  chat.hidden = false;
  renderAttach();
  await invoke("set_chat_open", { open: true });
  chatInput.focus();
}

function closeChat() {
  if (!chatOpen) return;
  chatOpen = false;
  attachment = null;
  chat.hidden = true;
  invoke("set_chat_open", { open: false });
}

// --- réponse en streaming
const ANSWER_MAX_CHARS = 140; // la bulle ne doit pas sortir par le haut de la fenêtre
type Asking = { id: string; session?: Session; raw: string; question: string };
let asking: Asking | null = null;

const shorten = (text: string) => {
  const t = text.replace(/[*`#>_]/gu, "").replace(/\s+/g, " ").trim();
  return t.length > ANSWER_MAX_CHARS ? t.slice(0, ANSWER_MAX_CHARS - 1) + "…" : t;
};

// Historique : ‹ 2/3 › pour relire les dernières réponses sans reposer la question, et « Copier le code » si la réponse en contient.
const bubbleTools = document.querySelector<HTMLElement>("#bubble-tools")!;
const histPos = document.querySelector<HTMLElement>("#hist-pos")!;
const histCopy = document.querySelector<HTMLButtonElement>("#hist-copy")!;
function showEntry() {
  const e = history.list()[history.cursor];
  if (!e) return;
  showAnswer(shorten(history.prose(e.raw)));
  delete bubble.dataset.app;
  bubbleTools.hidden = false;
  histPos.textContent = history.list().length > 1 ? `${history.cursor + 1}/${history.list().length}` : "";
  document.querySelector<HTMLElement>("#hist-prev")!.hidden = document.querySelector<HTMLElement>("#hist-next")!.hidden = history.list().length < 2;
  histCopy.hidden = !history.extractCode(e.raw).length;
  histCopy.textContent = "Copier le code";
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => (bubble.hidden = true), 15_000);
}
function stepHistory(delta: number) {
  history.step(delta);
  showEntry();
}
// Les boutons sont dans la bulle : leurs clics ne doivent pas déclencher le focus du terminal (cf. clic sur la bulle).
bubbleTools.addEventListener("click", (e) => e.stopPropagation());
document.querySelector("#hist-prev")!.addEventListener("click", () => stepHistory(-1));
document.querySelector("#hist-next")!.addEventListener("click", () => stepHistory(1));
histCopy.addEventListener("click", async () => {
  const e = history.list()[history.cursor];
  const ok = e && (await invoke<boolean>("copy_text", { text: history.extractCode(e.raw).join("\n\n") }));
  histCopy.textContent = ok ? "Copié ✓" : "Échec de la copie";
});
// ← / → relisent les réponses quand la fenêtre du pet a le focus (après un clic sur la bulle)
document.addEventListener("keydown", (e) => {
  if (bubbleTools.hidden || bubble.hidden || chatOpen || history.list().length < 2) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") stepHistory(e.key === "ArrowLeft" ? -1 : 1);
});

function showAnswer(text: string) {
  typed.textContent = text;
  bubble.hidden = false;
}

function ask(question: string, att: Attachment | null = null) {
  const fork = crypto.randomUUID();
  ignored.add(fork); // les hooks de la copie ne sont pas de vraies sessions
  const session = target;
  asking = { id: crypto.randomUUID(), session, raw: "", question };
  bubbleTools.hidden = true;
  clearInterval(typeTimer);
  clearTimeout(bubbleTimer);
  delete bubble.dataset.app;
  bubbleTag.hidden = !session || count() < 2;
  if (session) {
    bubbleTag.textContent = label(session);
    bubble.style.setProperty("--tag", color(session));
  }
  showAnswer("…");
  setState("working");
  lastSpokeAt = Date.now();
  invoke("ask", { id: asking.id, question, resume: session?.id ?? null, cwd: session?.cwd || null, fork, attach: att?.path ?? null });
}

listen<{ id: string; kind: "delta" | "done" | "error"; text: string }>("chat", ({ payload }) => {
  if (!asking || payload.id !== asking.id) return;
  if (payload.kind === "delta") {
    asking.raw += payload.text;
    showAnswer(shorten(history.prose(asking.raw)));
    setState("talking");
    sound.blip();
    return;
  }
  const failed = payload.kind === "error" || !asking.raw;
  if (failed) {
    showAnswer("Aïe, je n'ai pas réussi à te répondre.");
    setState("worried", 2500);
    sound.worried();
  } else {
    settle();
    history.push({ question: asking.question, raw: asking.raw });
    showEntry();
  }
  asking = null;
  bubbleTimer = setTimeout(() => (bubble.hidden = true), 10_000);
});

pet.addEventListener("dblclick", openChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeChat();
  if (e.altKey && /^Digit[1-3]$/.test(e.code)) {
    e.preventDefault();
    sendQuick(Number(e.code.slice(5)) - 1);
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const list = all();
    if (list.length) target = list[(list.indexOf(target as Session) + 1) % list.length];
    renderChips();
  }
  if (e.key === "Enter" && !e.isComposing && (chatInput.value.trim() || attachment) && !asking) {
    const att = attachment;
    const question = chatInput.value.trim() || (att ? defaultQuestion(att) : "");
    closeChat();
    if (question === "/quit") invoke("quit");
    else if (question === "/settings") invoke("open_settings_cmd");
    else if (question.startsWith("/emote")) emote(question.split(/\s+/)[1]);
    else ask(question, att);
  }
});
// clic sur une pastille : ne pas perdre le focus, sinon le chat se ferme
chips.addEventListener("mousedown", (e) => e.preventDefault());
chatInput.addEventListener("blur", () => setTimeout(closeChat, 150));

// Réglages (fenêtre de réglages) : lus au démarrage, puis appliqués en direct à chaque changement.
type Settings = { cooldownSec: number; sleepAfterSec: number; confetti: boolean; sound: boolean; soundMode: "all" | "alerts"; chatShortcut: string; stealth: boolean; petScale: number; volume: number; emotes: boolean; emoteEverySec: number; skinColor: string; skinAccessory: string };
// Mode furtif : pendant un appel (micro utilisé, cf. mic.rs) le pet rétrécit, se tait et ne fait plus de bulles ni de confettis.
// Les demandes de permission restent visibles : elles bloquent Claude.
let STEALTH = true;
let inCall = false;
let soundSettings = { enabled: true, volume: 1, mode: "all" as "all" | "alerts" };
const stealthActive = () => STEALTH && inCall;
function renderStealth() {
  document.body.classList.toggle("stealth", stealthActive());
  setSoundConfig({ ...soundSettings, enabled: soundSettings.enabled && !stealthActive() });
}
listen<boolean>("mic", ({ payload }) => {
  inCall = payload;
  renderStealth();
});

function applySettings(s: Settings) {
  COOLDOWN_MS = s.cooldownSec * 1000;
  SLEEP_AFTER_MS = s.sleepAfterSec * 1000;
  EMOTES = s.emotes;
  EMOTE_EVERY_MS = s.emoteEverySec * 1000;
  CONFETTI = s.confetti;
  STEALTH = s.stealth;
  const k = Math.min(1.5, Math.max(0.7, s.petScale ?? 1));
  document.body.style.setProperty("--size", String(k));
  PET.w = 150 * k; // la fenêtre ne change pas : le pet grandit depuis ses pieds, les bornes d'écran suivent
  PET.h = 112 * k;
  soundSettings = { enabled: s.sound, volume: s.volume, mode: s.soundMode };
  renderStealth();
  setSkin(pet, s.skinColor, s.skinAccessory);
}
invoke<Settings>("get_settings").then(applySettings);
listen<Settings>("settings", ({ payload }) => applySettings(payload));

// Zones cliquables envoyées à Rust : la fenêtre est transparente sur l'essentiel de sa surface et ne doit pas
// intercepter les clics destinés aux autres apps. Seuls le pet, la bulle et le champ de chat les reçoivent.
let lastRegions = "";
function pushRegions() {
  const regions: number[][] = [];
  const add = (el: HTMLElement, padX: number, padTop: number, padBottom: number) => {
    if (el.hidden) return;
    const r = el.getBoundingClientRect();
    regions.push([r.left - padX, r.top - padTop, r.width + 2 * padX, r.height + padTop + padBottom].map(Math.round));
  };
  add(pet, 24, 24, 6); // marge : accessoires (marteau, enclume, clavier, chapeau du skin) un peu en dehors du cadre du pet
  add(bubble, 6, 14, 6); // 14 en haut : la pastille de projet dépasse du bord
  add(chat, 6, 6, 6);
  add(permBox, 6, 14, 6);
  const key = JSON.stringify(regions);
  if (key !== lastRegions) {
    lastRegions = key;
    invoke("set_hit_regions", { regions });
  }
}
pushRegions();
setInterval(pushRegions, 100);
