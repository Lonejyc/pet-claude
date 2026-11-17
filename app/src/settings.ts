import { invoke } from "@tauri-apps/api/core";
import { accelFromEvent, DEFAULT_SHORTCUT, formatAccel } from "./accelerator";
import { EMPTY, isUnlocked, progress, type Counters } from "./achievements";
import { ACCESSORIES, COLORS } from "./skins";

type Settings = { cooldownSec: number; sleepAfterSec: number; confetti: boolean; sound: boolean; soundMode: "all" | "alerts"; chatShortcut: string; stealth: boolean; petScale: number; volume: number; emotes: boolean; emoteEverySec: number; skinColor: string; skinAccessory: string };
type Status = { hooks: boolean; style: boolean; login: boolean; installed: boolean };

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const error = $("error");

function fail(e: unknown) {
  error.textContent = String(e);
  error.hidden = false;
}

// ---- réglages du pet : enregistrés à chaque changement, appliqués en direct par la fenêtre du pet
const fields = {
  cooldownSec: $<HTMLInputElement>("cooldownSec"),
  sleepAfterSec: $<HTMLInputElement>("sleepAfterSec"),
  confetti: $<HTMLInputElement>("confetti"),
  sound: $<HTMLInputElement>("sound"),
  soundMode: $<HTMLSelectElement>("soundMode"),
  volume: $<HTMLInputElement>("volume"),
  stealth: $<HTMLInputElement>("stealth"),
  petScale: $<HTMLInputElement>("petScale"),
  emotes: $<HTMLInputElement>("emotes"),
  skinAccessory: $<HTMLSelectElement>("skinAccessory"),
  emoteEverySec: $<HTMLInputElement>("emoteEverySec"),
};
const swatches = $("skin-colors");
for (const [name, { label, shades }] of Object.entries(COLORS)) {
  const radio = Object.assign(document.createElement("input"), { type: "radio", name: "skinColor", value: name, title: label });
  radio.style.setProperty("--c", shades.front);
  swatches.append(radio);
}
// Accessoires : ceux à débloquer sont rangés à la fin de la liste, grisés, avec leur progression.
// (une liste native n'accepte que du texte : pas d'icône dans ses options)
let accessory = "none";
const select = fields.skinAccessory;
let counters: Counters = EMPTY;
function renderAccessories() {
  const all = Object.keys(ACCESSORIES);
  const unlocked = all.filter((a) => isUnlocked(a, counters) || a === accessory);
  select.replaceChildren(
    ...all.filter((a) => unlocked.includes(a)).map((a) => new Option(ACCESSORIES[a], a)),
    ...all.filter((a) => !unlocked.includes(a)).map((a) => Object.assign(new Option(`${ACCESSORIES[a]} · verrouillé (${progress(a, counters)})`, a), { disabled: true })),
  );
  select.value = accessory;
}
const skinColor = () => document.querySelector<HTMLInputElement>("input[name=skinColor]:checked")?.value ?? "orange";
const fmtSeconds = (s: number) => (s >= 120 ? `${Math.round(s / 60)} min` : `${s} s`);

function readForm(): Settings {
  return {
    cooldownSec: Number(fields.cooldownSec.value),
    sleepAfterSec: Number(fields.sleepAfterSec.value),
    confetti: fields.confetti.checked,
    sound: fields.sound.checked,
    soundMode: fields.soundMode.value as Settings["soundMode"],
    volume: Number(fields.volume.value),
    chatShortcut,
    stealth: fields.stealth.checked,
    petScale: Number(fields.petScale.value),
    emotes: fields.emotes.checked,
    emoteEverySec: Number(fields.emoteEverySec.value),
    skinColor: skinColor(),
    skinAccessory: select.value,
  };
}

function showOutputs() {
  const s = readForm();
  $("cooldown-out").textContent = s.cooldownSec === 0 ? "toujours" : fmtSeconds(s.cooldownSec);
  $("sleep-out").textContent = fmtSeconds(s.sleepAfterSec);
  $("petScale-out").textContent = `${Math.round(s.petScale * 100)} %`;
  $("volume-out").textContent = `${Math.round(s.volume * 100)} %`;
  fields.volume.disabled = !s.sound;
  fields.soundMode.disabled = !s.sound;
  $("emote-out").textContent = fmtSeconds(s.emoteEverySec);
  fields.emoteEverySec.disabled = !s.emotes;
}

function save() {
  showOutputs();
  invoke("save_settings", { settings: readForm() }).then(() => (error.hidden = true), fail);
}
for (const input of [...Object.values(fields), swatches]) input.addEventListener("input", save);

// Raccourci du mini-chat : on clique, puis on tape sa combinaison (au moins ⌃, ⌥ ou ⌘). Défaut : ⌃⌥ Espace.
let chatShortcut = DEFAULT_SHORTCUT;
let recording = false;
const shortcutBtn = $<HTMLButtonElement>("chatShortcutBtn");
function renderShortcut() {
  recording = false;
  shortcutBtn.textContent = formatAccel(chatShortcut);
  shortcutBtn.classList.remove("recording");
  $("chatShortcutReset").hidden = chatShortcut === DEFAULT_SHORTCUT;
  $("chatShortcutOff").hidden = chatShortcut === "";
}
function setShortcut(accel: string) {
  chatShortcut = accel;
  renderShortcut();
  save();
}
shortcutBtn.addEventListener("click", () => {
  recording = true;
  shortcutBtn.textContent = "Tape ta combinaison…";
  shortcutBtn.classList.add("recording");
});
$("chatShortcutReset").addEventListener("click", () => setShortcut(DEFAULT_SHORTCUT));
$("chatShortcutOff").addEventListener("click", () => setShortcut(""));
shortcutBtn.addEventListener("blur", () => recording && renderShortcut());
window.addEventListener(
  "keydown",
  (e) => {
    if (!recording) return;
    e.preventDefault();
    if (e.key === "Escape") return renderShortcut();
    const accel = accelFromEvent(e);
    if (accel) setShortcut(accel);
  },
  true,
);

// ---- système : lancement au démarrage, personnalité globale, hooks
const login = $<HTMLInputElement>("login");
const style = $<HTMLInputElement>("style");
const hooksBtn = $<HTMLButtonElement>("hooks-btn");

async function refreshStatus() {
  const st = await invoke<Status>("setup_status");
  login.checked = st.login;
  login.disabled = !st.installed && !st.login;
  $("login-hint").textContent = st.installed ? "À la prochaine ouverture de session" : "Disponible une fois l'app installée dans Applications";
  style.checked = st.style;
  $("hooks-state").textContent = st.hooks ? "Installés : le pet voit toutes tes sessions Claude" : "Non installés ou à mettre à jour : le pet ne voit pas tes sessions";
  hooksBtn.textContent = st.hooks ? "Retirer" : "Installer";
  hooksBtn.dataset.on = String(!st.hooks);
}

async function change(command: string, on: boolean) {
  error.hidden = true;
  try {
    await invoke(command, { on });
  } catch (e) {
    fail(e);
  }
  await refreshStatus();
}

login.addEventListener("change", () => change("login_enable", login.checked));
style.addEventListener("change", () => change("style_enable", style.checked));
hooksBtn.addEventListener("click", () => change("hooks_enable", hooksBtn.dataset.on === "true"));
$("quit").addEventListener("click", () => invoke("quit"));

(async () => {
  const s = await invoke<Settings>("get_settings");
  fields.cooldownSec.value = String(s.cooldownSec);
  fields.sleepAfterSec.value = String(s.sleepAfterSec);
  fields.confetti.checked = s.confetti;
  fields.sound.checked = s.sound;
  fields.soundMode.value = s.soundMode;
  fields.volume.value = String(s.volume);
  chatShortcut = s.chatShortcut ?? DEFAULT_SHORTCUT;
  renderShortcut();
  fields.stealth.checked = s.stealth;
  fields.petScale.value = String(s.petScale ?? 1);
  fields.emotes.checked = s.emotes;
  fields.emoteEverySec.value = String(s.emoteEverySec);
  accessory = s.skinAccessory;
  counters = { ...EMPTY, ...(await invoke<Counters>("get_achievements")) };
  renderAccessories();
  for (const r of swatches.querySelectorAll<HTMLInputElement>("input")) r.checked = r.value === s.skinColor;
  showOutputs();
  await refreshStatus();
})();
