import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Hook = { event: string; tool?: string; message?: string };

const pet = document.querySelector<HTMLElement>("#pet")!;
const bubble = document.querySelector<HTMLElement>("#bubble")!;
const bubbleText = document.querySelector<HTMLElement>("#bubble-text")!;
let stateTimer: number;
let bubbleTimer: number;
let typeTimer: number;

function setState(state: string, backToIdleAfterMs?: number) {
  pet.dataset.state = state;
  clearTimeout(stateTimer);
  if (backToIdleAfterMs) stateTimer = setTimeout(() => setState("idle"), backToIdleAfterMs);
}

// Le pet parle sur la 1re ligne de la réponse (cf. output style) : première phrase, sans markdown ; le CSS coupe à une ligne.
const firstSentence = (text: string) =>
  text.replace(/[*`#>_🟧]/gu, "").trim().split(/(?<=[.!?:])\s|\n/)[0];

// Texte tapé lettre par lettre ; le pet "parle" (petits sauts) tant qu'il tape.
function say(text: string) {
  const full = firstSentence(text);
  let i = 0;
  clearInterval(typeTimer);
  clearTimeout(bubbleTimer);
  bubbleText.textContent = "";
  bubble.hidden = false;
  setState("talking");
  typeTimer = setInterval(() => {
    bubbleText.textContent = full.slice(0, ++i);
    if (i < full.length) return;
    clearInterval(typeTimer);
    setState("idle");
    bubbleTimer = setTimeout(() => (bubble.hidden = true), 8000);
  }, 35);
}

listen<Hook>("hook", ({ payload }) => {
  if (payload.event === "PreToolUse") setState("working");
  if (payload.event === "Stop") {
    if (payload.message) say(payload.message);
    else setState("idle");
  }
});

// Appui = le pet s'écrase comme une balle, relâchement = il rebondit. Si on bouge, on déplace la fenêtre.
let pressedAt: { x: number; y: number } | null = null;

function release() {
  if (!pressedAt) return;
  pressedAt = null;
  pet.classList.remove("pressed");
  pet.classList.add("boing");
}

// Le drag natif n'envoie pas de pointerup : "tenu" = la fenêtre a bougé il y a moins de 200 ms.
let heldTimer: number;

function hold() {
  pet.classList.remove("drop");
  pet.classList.add("held");
  clearTimeout(heldTimer);
  heldTimer = setTimeout(drop, 200);
}

function drop() {
  pet.classList.remove("held");
  pet.classList.add("drop");
}

getCurrentWindow().onMoved(hold);

pet.addEventListener("pointerdown", (e) => {
  pressedAt = { x: e.clientX, y: e.clientY };
  pet.classList.remove("boing");
  pet.classList.add("pressed");
});
pet.addEventListener("pointermove", (e) => {
  if (pressedAt && Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > 4) {
    pressedAt = null; // le drag natif avale le pointerup
    pet.classList.remove("pressed");
    hold();
    getCurrentWindow().startDragging();
  }
});
pet.addEventListener("pointerup", release);
pet.addEventListener("pointercancel", release);
pet.addEventListener("animationend", (e) => {
  if (e.animationName === "boing") pet.classList.remove("boing");
  if (e.animationName === "drop") pet.classList.remove("drop");
});
