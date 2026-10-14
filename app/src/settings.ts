import { invoke } from "@tauri-apps/api/core";

type Settings = { cooldownSec: number; sleepAfterSec: number; confetti: boolean; sound: boolean; volume: number };
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
  volume: $<HTMLInputElement>("volume"),
};
const fmtSeconds = (s: number) => (s >= 120 ? `${Math.round(s / 60)} min` : `${s} s`);

function readForm(): Settings {
  return {
    cooldownSec: Number(fields.cooldownSec.value),
    sleepAfterSec: Number(fields.sleepAfterSec.value),
    confetti: fields.confetti.checked,
    sound: fields.sound.checked,
    volume: Number(fields.volume.value),
  };
}

function showOutputs() {
  const s = readForm();
  $("cooldown-out").textContent = s.cooldownSec === 0 ? "toujours" : fmtSeconds(s.cooldownSec);
  $("sleep-out").textContent = fmtSeconds(s.sleepAfterSec);
  $("volume-out").textContent = `${Math.round(s.volume * 100)} %`;
  fields.volume.disabled = !s.sound;
}

for (const input of Object.values(fields)) {
  input.addEventListener("input", () => {
    showOutputs();
    invoke("save_settings", { settings: readForm() }).catch(fail);
  });
}

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
  $("hooks-state").textContent = st.hooks ? "Installés : le pet voit toutes tes sessions Claude" : "Non installés : le pet ne voit aucune session";
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
  fields.volume.value = String(s.volume);
  showOutputs();
  await refreshStatus();
})();
