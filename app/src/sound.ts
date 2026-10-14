// Sons synthétisés (WebAudio, aucun fichier). Le contexte démarre suspendu tant que l'utilisateur n'a pas cliqué dans la fenêtre.
const ctx = new AudioContext();

function tone(from: number, to: number, ms: number, type: OscillatorType = "square", vol = 0.04, delayMs = 0) {
  if (ctx.state === "suspended") ctx.resume();
  const t = ctx.currentTime + delayMs / 1000;
  const end = t + ms / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, end);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(end);
}

export const sound = {
  // une syllabe de "voix" : hauteur aléatoire, façon Animal Crossing
  blip: () => {
    const f = 380 + Math.random() * 180;
    tone(f, f * 1.05, 55);
  },
  squish: () => tone(220, 140, 80, "sine", 0.08),
  boing: () => {
    tone(180, 520, 130, "sine", 0.08);
    tone(520, 240, 160, "sine", 0.06, 120);
  },
  worried: () => {
    tone(330, 300, 130, "triangle", 0.07);
    tone(262, 220, 200, "triangle", 0.07, 140);
  },
  yelp: () => tone(700, 1100, 110, "square", 0.05),
  thump: () => tone(130, 60, 110, "sine", 0.12),
};
