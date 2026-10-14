import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { buildPet } from "./pet3d";
import { sound } from "./sound";

type Hook = { event: string; tool?: string; message?: string };

const pet = document.querySelector<HTMLElement>("#pet")!;
const bubble = document.querySelector<HTMLElement>("#bubble")!;
buildPet(document.querySelector<HTMLElement>("#rig")!);
// Un "tok" à chaque coup de marteau (impacts à 5 %, 21 % et 38 % du cycle de 2 s défini dans styles.css).
const hammer = document.querySelector<HTMLElement>(".hammer")!;
const tokOnImpacts = () => [100, 420, 760].forEach((ms) => setTimeout(sound.tok, ms));
hammer.addEventListener("animationstart", tokOnImpacts);
hammer.addEventListener("animationiteration", tokOnImpacts);

const typed = document.querySelector<HTMLElement>("#typed")!;
let stateTimer: number;
let bubbleTimer: number;
let typeTimer: number;

// Budget de répétition : pas de bulle si le pet a parlé il y a moins de 20 s, sauf si un outil a échoué pendant le tour.
const COOLDOWN_MS = 20_000;
let lastSpokeAt = 0;
let failedThisTurn = false;

// Outil en cours -> accessoire du pet (cf. [data-tool] dans styles.css)
const TOOL_KINDS: Record<string, string> = {
  Read: "read", Grep: "read", Glob: "read",
  Bash: "bash",
  Edit: "edit", Write: "edit", MultiEdit: "edit", NotebookEdit: "edit",
  WebSearch: "web", WebFetch: "web",
};

// Confettis seulement après un tour chargé (>= 3 outils) et sans échec : sinon ils perdent leur sens.
const CONFETTI_MIN_TOOLS = 3;
let toolsThisTurn = 0;

function confetti() {
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
  if (state !== "sleeping") lastActivity = Date.now();
  delete pet.dataset.tool;
  clearInterval(typingTimer);
  clearTimeout(stateTimer);
  if (thenAfterMs) stateTimer = setTimeout(() => setState(then), thenAfterMs);
}

// Le pet parle sur la 1re ligne de la réponse (cf. output style) : première phrase, sans markdown, coupée à MAX_CHARS.
const MAX_CHARS = 110;
const firstSentence = (text: string) => {
  const sentence = text.replace(/[*`#>_🟧]/gu, "").trim().split(/(?<=[.!?:])\s|\n/)[0];
  return sentence.length > MAX_CHARS ? sentence.slice(0, MAX_CHARS - 1) + "…" : sentence;
};

// Texte tapé lettre par lettre ; le pet "parle" (petits sauts) tant qu'il tape.
function say(text: string) {
  const full = firstSentence(text);
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
    setState("idle");
    bubbleTimer = setTimeout(() => (bubble.hidden = true), 8000);
  }, 35);
}

listen<Hook>("hook", ({ payload }) => {
  if (payload.event === "PreToolUse") {
    setState("working");
    toolsThisTurn++;
    const kind = payload.tool && TOOL_KINDS[payload.tool];
    if (kind) pet.dataset.tool = kind;
    if (kind === "bash") {
      sound.key();
      typingTimer = setInterval(sound.key, 140);
    }
  }
  // Claude continue en général après un échec : retour au travail, c'est Stop qui calmera le pet.
  if (payload.event === "PostToolUseFailure") {
    failedThisTurn = true;
    setState("worried", 2500, "working");
    sound.worried();
  }
  if (payload.event === "Stop") {
    if (payload.message && (failedThisTurn || Date.now() - lastSpokeAt > COOLDOWN_MS)) say(payload.message);
    else setState("idle");
    if (toolsThisTurn >= CONFETTI_MIN_TOOLS && !failedThisTurn) confetti();
    failedThisTurn = false;
    toolsThisTurn = 0;
  }
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
const SLEEP_AFTER_MS = 60_000;
let lastActivity = Date.now();

function wake() {
  lastActivity = Date.now();
  if (pet.dataset.state === "sleeping") setState("idle");
}

setInterval(() => {
  if (pet.dataset.state === "idle" && Date.now() - lastActivity > SLEEP_AFTER_MS) setState("sleeping");
}, 5000);

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
