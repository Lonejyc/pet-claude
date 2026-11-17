import { jitter, pickNot, pinkNoise, reverbImpulse } from "./audio-math";

// Sons synthétisés (WebAudio, aucun fichier). Le contexte démarre suspendu tant que l'utilisateur n'a pas cliqué dans la fenêtre.
let ctx = new AudioContext();

// Après une veille du Mac, WebKit laisse le contexte muet (état "interrupted", ou "running" sans sortie) : on en recrée un.
// La veille se repère à un trou dans les ticks, les timers ne tournant pas pendant qu'elle dure.
let lastTick = Date.now();
setInterval(() => {
  if (Date.now() - lastTick > 30_000) {
    ctx.close();
    ctx = new AudioContext();
  }
  lastTick = Date.now();
}, 5_000);

let enabled = true;
let volume = 1;
export const setSoundConfig = (cfg: { enabled: boolean; volume: number }) => {
  enabled = cfg.enabled;
  volume = cfg.volume;
  if (bus) bus.master.gain.value = volume;
};

// Chaîne commune à tous les sons, recréée avec le contexte : voix sèches + envoi de réverb -> volume -> sortie.
// ponytail: pas de compresseur, le DynamicsCompressor de WebKit/Chrome écrase les sons faibles d'environ 4x (mesuré hors ligne) ; les pics restent < 0,3,
// à revoir si on superpose beaucoup plus de couches (limiteur via WaveShaper).
type Bus = { ctx: AudioContext; master: GainNode; send: AudioNode; noise: AudioBuffer };
let bus: Bus | null = null;

function getBus(): Bus {
  if (bus?.ctx === ctx) return bus;
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  // petite pièce : réverb courte, générée une seule fois
  const room = ctx.createConvolver();
  const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 0.35), ctx.sampleRate);
  for (let c = 0; c < 2; c++) ir.copyToChannel(reverbImpulse(ctx.sampleRate, 0.35, 50), c);
  room.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  room.connect(wet).connect(master);

  // 2 s de bruit rose, lu en boucle à un point de départ aléatoire par les frappes et les cymbales
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  noise.copyToChannel(pinkNoise(noise.length), 0);

  return (bus = { ctx, master, send: room, noise });
}

function start() {
  if (!enabled || volume === 0) return null;
  if (ctx.state !== "running") ctx.resume();
  return getBus();
}

// Enveloppe commune : attaque courte (pas de clic), puis décroissance exponentielle. `wet` = part envoyée à la réverb.
function envelope(b: Bus, t: number, end: number, vol: number, attack: number, wet: number) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(b.master);
  if (wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    gain.connect(send).connect(b.send);
  }
  return gain;
}

type Voice = {
  from: number; to?: number; ms: number; type?: OscillatorType; vol?: number; delay?: number;
  attack?: number; wet?: number; cents?: number; lowpass?: number;
};

// Un oscillateur humanisé : léger désaccord et volume aléatoires (±cents, ±10 %), filtre passe-bas optionnel.
function voice(v: Voice) {
  const b = start();
  if (!b) return;
  const t = ctx.currentTime + (v.delay ?? 0) / 1000;
  const end = t + v.ms / 1000;
  const osc = ctx.createOscillator();
  osc.type = v.type ?? "square";
  osc.frequency.setValueAtTime(v.from, t);
  osc.frequency.exponentialRampToValueAtTime(v.to ?? v.from, end);
  osc.detune.value = (Math.random() * 2 - 1) * (v.cents ?? 10);
  const gain = envelope(b, t, end, jitter(v.vol ?? 0.04, 0.1), v.attack ?? 0.004, v.wet ?? 0);
  if (v.lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = v.lowpass;
    osc.connect(lp).connect(gain);
  } else osc.connect(gain);
  osc.start(t);
  osc.stop(end);
}

type Hit = { ms: number; vol?: number; delay?: number; attack?: number; wet?: number; filter: BiquadFilterType; freq: number; to?: number; q?: number };

// Une bouffée de bruit filtré : base des claquements, frappes et cymbales.
function noiseHit(h: Hit) {
  const b = start();
  if (!b) return;
  const t = ctx.currentTime + (h.delay ?? 0) / 1000;
  const end = t + h.ms / 1000;
  const src = ctx.createBufferSource();
  src.buffer = b.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = h.filter;
  f.Q.value = h.q ?? 1;
  f.frequency.setValueAtTime(h.freq, t);
  if (h.to) f.frequency.exponentialRampToValueAtTime(h.to, end);
  src.connect(f).connect(envelope(b, t, end, jitter(h.vol ?? 0.1, 0.1), h.attack ?? 0.002, h.wet ?? 0));
  src.start(t, Math.random() * 1.5);
  src.stop(end);
}

const tone = (from: number, to: number, ms: number, type: OscillatorType = "square", vol = 0.04, delay = 0) =>
  voice({ from, to, ms, type, vol, delay });

// trois hauteurs de touche : jamais la même deux fois de suite
const KEY_PITCHES = [1500, 1800, 2100];
let lastKey = 0;

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
  tada: () => [523, 659, 784, 1047].forEach((f, i) => voice({ from: f, ms: 120, type: "triangle", vol: 0.06, delay: i * 90, wet: 0.4 })),
  tok: () => {
    tone(900, 300, 40, "square", 0.08);
    tone(140, 70, 90, "sine", 0.1);
  },
  key: () => {
    lastKey = pickNot(KEY_PITCHES.length, lastKey);
    tone(jitter(KEY_PITCHES[lastKey], 0.08), 700, 18, "square", 0.03);
    noiseHit({ ms: 14, vol: 0.05, filter: "bandpass", freq: 3200, q: 1.2 }); // le clac de la touche
  },
  crash: () => [4200, 5900, 7600].forEach((f) => tone(f, f * 0.9, 220, "sawtooth", 0.02)), // cymbales
  thump: () => tone(130, 60, 110, "sine", 0.12),
};
