import { listen } from "@tauri-apps/api/event";

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

// Résumé = première phrase, sans markdown ; le CSS coupe à une ligne.
const firstSentence = (text: string) =>
  text.replace(/[*`#>_]/g, "").trim().split(/(?<=[.!?:])\s|\n/)[0];

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
