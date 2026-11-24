import { jitter, pickNot, pinkNoise, reverbImpulse, soundAllowed, type SoundMode } from "./audio-math";

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
let mode: SoundMode = "all";
let pitch = 1; // allure des outils (cf. toolPace) : hauteur des frappes
export const setToolPitch = (p: number) => (pitch = p);
export const setSoundConfig = (cfg: { enabled: boolean; volume: number; mode?: SoundMode }) => {
  enabled = cfg.enabled;
  volume = cfg.volume;
  mode = cfg.mode ?? "all";
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

// Une note de cloche/marimba : le fondamental dure, les partiels inharmoniques s'éteignent vite (c'est ce qui donne le « métal » ou le « bois »).
const bell = (f: number, delay: number, ms: number) => {
  voice({ from: f, ms, type: "sine", vol: 0.05, delay, wet: 0.35, attack: 0.002, cents: 4 });
  voice({ from: f * 2.76, ms: ms * 0.4, type: "sine", vol: 0.02, delay, wet: 0.3, attack: 0.001, cents: 4 });
  voice({ from: f * 4, ms: ms * 0.2, type: "sine", vol: 0.012, delay, attack: 0.001, cents: 4 });
};

// Voix : gamme pentatonique, jamais deux fois la même note de suite.
const VOICE_NOTES = [392, 440, 523, 587, 659];
let lastVoice = 0;

// Touches : trois claquements différents (fréquence du clic), jamais le même deux fois de suite.
const KEYS = [2000, 2400, 2900];
let lastKey = 0;

const raw = {
  // une syllabe de « voix » (façon Animal Crossing) : timbre doux de triangle + octave, petit souffle de consonne
  blip: () => {
    lastVoice = pickNot(VOICE_NOTES.length, lastVoice);
    const f = jitter(VOICE_NOTES[lastVoice], 0.03);
    voice({ from: f, to: f * 1.04, ms: 60, type: "triangle", vol: 0.035, lowpass: 1800 });
    voice({ from: f * 2, to: f * 2.08, ms: 40, type: "sine", vol: 0.012 });
    noiseHit({ ms: 12, vol: 0.02, filter: "bandpass", freq: 2600, q: 2 });
  },
  // l'écrasement : un « ploc » mou, avec le souffle d'air qui s'échappe
  squish: () => {
    voice({ from: 220, to: 140, ms: 90, type: "sine", vol: 0.07, cents: 20 });
    noiseHit({ ms: 100, vol: 0.06, filter: "lowpass", freq: 1100, to: 300, q: 0.7 });
  },
  // ressort : deux glissandos de sinus avec leur harmonique qui vibre
  boing: () => {
    voice({ from: 180, to: 520, ms: 130, type: "sine", vol: 0.08, wet: 0.15 });
    voice({ from: 520, to: 240, ms: 160, type: "sine", vol: 0.06, delay: 120, wet: 0.15 });
    voice({ from: 360, to: 1040, ms: 90, type: "triangle", vol: 0.015, cents: 30 });
    voice({ from: 1040, to: 480, ms: 110, type: "triangle", vol: 0.012, delay: 120, cents: 30 });
  },
  // l'inquiétude : deux notes qui descendent, désaccordées l'une contre l'autre pour trembler
  worried: () => {
    for (const [from, to, ms, delay] of [[330, 300, 130, 0], [262, 220, 200, 140]]) {
      voice({ from, to, ms, type: "triangle", vol: 0.05, delay, lowpass: 1500, cents: -14, wet: 0.15 });
      voice({ from, to, ms, type: "triangle", vol: 0.035, delay, lowpass: 1500, cents: 14, wet: 0.15 });
      voice({ from: from / 2, to: to / 2, ms, type: "sine", vol: 0.03, delay });
    }
  },
  // petit cri aigu : dent de scie adoucie qui monte puis retombe, avec un souffle
  yelp: () => {
    voice({ from: 700, to: 1200, ms: 70, type: "sawtooth", vol: 0.05, lowpass: 2600 });
    voice({ from: 1200, to: 900, ms: 60, type: "sawtooth", vol: 0.04, delay: 65, lowpass: 2600 });
    voice({ from: 1400, to: 2200, ms: 90, type: "sine", vol: 0.015 });
    noiseHit({ ms: 100, vol: 0.02, filter: "bandpass", freq: 3000, q: 1.5 });
  },
  // fanfare de marimba/cloche : do-mi-sol-do, la dernière note résonne
  tada: () => [523, 659, 784, 1047].forEach((f, i, a) => bell(f, i * 90, i === a.length - 1 ? 900 : 450)),
  // fin de tâche en saison de Noël : grelots (bruit aigu + cloches hautes) qui sonnent le motif de Jingle Bells (mi-mi-mi), la dernière note résonne
  sleighBells: () => {
    [[659, 0, 180], [659, 190, 180], [659, 380, 520]].forEach(([f, delay, ms]) => {
      noiseHit({ ms: 160, vol: 0.05, filter: "highpass", freq: 7000, q: 0.6, delay, wet: 0.25 });
      bell(f * 2, delay, ms);
    });
  },
  // endormissement en saison de Noël : les premières notes de Douce nuit (sol-la-sol-mi), timbre de boîte à musique
  musicBox: () => {
    [[392, 0, 500], [440, 420, 250], [392, 640, 500], [330, 1060, 900]].forEach(([f, delay, ms]) => {
      voice({ from: f * 2, ms, type: "triangle", vol: 0.04, delay, wet: 0.5, attack: 0.003, cents: 3 });
      voice({ from: f * 4, ms: ms * 0.3, type: "sine", vol: 0.01, delay, attack: 0.001, cents: 3 });
    });
  },
  // coup de marteau : claquement de bois (bruit) + corps qui résonne
  tok: () => {
    noiseHit({ ms: 25, vol: 0.15, filter: "bandpass", freq: 1800 * pitch, q: 2 });
    voice({ from: 230 * pitch, to: 140 * pitch, ms: 80, type: "sine", vol: 0.13, attack: 0.001, wet: 0.1 });
    voice({ from: 460, to: 360, ms: 40, type: "sine", vol: 0.03, attack: 0.001 });
  },
  // frappe de clavier (calée sur un enregistrement) : clic sec de ~4 ms (1,5-4 kHz), puis « clac » plus faible ~9 ms après (touche en butée), aucun grave
  key: () => {
    lastKey = pickNot(KEYS.length, lastKey);
    const f = jitter(KEYS[lastKey] * pitch, 0.05);
    noiseHit({ ms: 5, vol: 0.09, filter: "bandpass", freq: f, q: 0.8, attack: 0.0005 });
    noiseHit({ ms: 7, vol: 0.05, filter: "bandpass", freq: f * 0.85, q: 0.8, attack: 0.0005, delay: jitter(9, 0.2) });
  },
  // cymbales : souffle aigu qui s'éteint lentement + partiels métalliques inharmoniques
  crash: () => {
    noiseHit({ ms: 480, vol: 0.14, filter: "highpass", freq: 6000, q: 0.5, wet: 0.3 });
    noiseHit({ ms: 260, vol: 0.05, filter: "bandpass", freq: 9000, q: 0.8 });
    for (const f of [3500, 5100, 6800]) voice({ from: f, ms: 360, type: "sine", vol: 0.008, cents: 40, attack: 0.001 });
  },
  // impact sourd : grosse caisse + souffle grave
  thump: () => {
    voice({ from: 130, to: 55, ms: 130, type: "sine", vol: 0.12, attack: 0.002, wet: 0.12 });
    noiseHit({ ms: 60, vol: 0.08, filter: "lowpass", freq: 260, q: 0.7, attack: 0.002 });
  },
};

// Chaque son passe par le filtre du mode « alertes seulement ».
export const sound = Object.fromEntries(Object.entries(raw).map(([name, play]) => [name, () => soundAllowed(mode, name) && play()])) as unknown as typeof raw;
