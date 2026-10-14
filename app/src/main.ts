import { listen } from "@tauri-apps/api/event";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { sound } from "./sound";

type Hook = { event: string; tool?: string; message?: string };

const pet = document.querySelector<HTMLElement>("#pet")!;
const bubble = document.querySelector<HTMLElement>("#bubble")!;
const typed = document.querySelector<HTMLElement>("#typed")!;
let stateTimer: number;
let bubbleTimer: number;
let typeTimer: number;

// Budget de répétition : pas de bulle si le pet a parlé il y a moins de 20 s, sauf si un outil a échoué pendant le tour.
const COOLDOWN_MS = 20_000;
let lastSpokeAt = 0;
let failedThisTurn = false;

function setState(state: string, thenAfterMs?: number, then = "idle") {
  pet.dataset.state = state;
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
  if (payload.event === "PreToolUse") setState("working");
  // Claude continue en général après un échec : retour au travail, c'est Stop qui calmera le pet.
  if (payload.event === "PostToolUseFailure") {
    failedThisTurn = true;
    setState("worried", 2500, "working");
    sound.worried();
  }
  if (payload.event === "Stop") {
    if (payload.message && (failedThisTurn || Date.now() - lastSpokeAt > COOLDOWN_MS)) say(payload.message);
    else setState("idle");
    failedThisTurn = false;
  }
});

// Appui = le pet s'écrase comme une balle, relâchement = il rebondit.
// Si on bouge de plus de 4 px, on déplace la fenêtre à la main (le drag natif bloque les événements jusqu'au relâchement).
type Drag = { x: number; y: number; origin?: { x: number; y: number }; moved: boolean };
const win = getCurrentWindow();
let drag: Drag | null = null;

pet.addEventListener("pointerdown", (e) => {
  pet.setPointerCapture(e.pointerId);
  const d: Drag = { x: e.screenX, y: e.screenY, moved: false };
  drag = d;
  Promise.all([win.outerPosition(), win.scaleFactor()]).then(([p, scale]) => (d.origin = { x: p.x / scale, y: p.y / scale }));
  pet.classList.remove("boing", "drop");
  pet.classList.add("pressed");
  sound.squish();
});

pet.addEventListener("pointermove", (e) => {
  if (!drag?.origin) return;
  const dx = e.screenX - drag.x;
  const dy = e.screenY - drag.y;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) <= 4) return;
    drag.moved = true;
    pet.classList.remove("pressed");
    pet.classList.add("held");
    sound.yelp();
  }
  win.setPosition(new LogicalPosition(drag.origin.x + dx, drag.origin.y + dy));
});

function release() {
  if (!drag) return;
  const wasDragged = drag.moved;
  drag = null;
  pet.classList.remove("pressed", "held");
  if (wasDragged) {
    pet.classList.add("drop");
    sound.thump();
  } else {
    pet.classList.add("boing");
    sound.boing();
  }
}
pet.addEventListener("pointerup", release);
pet.addEventListener("pointercancel", release);
pet.addEventListener("animationend", (e) => {
  if (e.animationName === "boing") pet.classList.remove("boing");
  if (e.animationName === "drop") pet.classList.remove("drop");
});
