// Le pet en vrai volume : des pavés CSS 3D (6 faces chacun). Unités = px, origine en haut à gauche d'un cadre 150 x 112.
type Shades = typeof ORANGE;
type Cube = { x: number; y: number; w: number; h: number; d: number; z?: number; cls?: string; shades?: Shades };

const ORANGE = { front: "#e8793c", top: "#f2985f", right: "#c9622a", left: "#d46d31", back: "#b85a26", bottom: "#9a4a1f" };
const GREY = { front: "#6b6f7a", top: "#c9ccd6", right: "#4b4e57", left: "#5a5d67", back: "#3f424a", bottom: "#2e3036" };
const KEY = { front: "#d8dbe3", top: "#f2f3f7", right: "#a9adb8", left: "#b7bbc6", back: "#9a9ea9", bottom: "#7d818c" };
const STEEL = { front: "#4a4d57", top: "#8c909c", right: "#34363d", left: "#3d4048", back: "#2b2d33", bottom: "#1f2024" };
const WOOD = { front: "#a0703a", top: "#b98450", right: "#7d5527", left: "#8a5f2e", back: "#6f4a22", bottom: "#5a3c1a" };

// Visage = le SVG d'origine, rogné sur la face avant du corps (mêmes coordonnées, mêmes classes CSS).
const FACE = `<svg viewBox="22 12 76 54" width="100%" height="100%" shape-rendering="crispEdges">
  <g class="eyes-open" fill="#1a1a1a"><rect x="40" y="30" width="8" height="16" /><rect x="72" y="30" width="8" height="16" /></g>
  <g class="eyes-squint" fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="square">
    <polyline points="38,30 50,38 38,46" /><polyline points="82,30 70,38 82,46" />
  </g>
  <rect class="mouth" x="54" y="50" width="12" height="7" fill="#1a1a1a" />
  <g class="glasses" fill="rgba(255,255,255,0.3)" stroke="#2b2b3a" stroke-width="2">
    <rect x="35" y="26" width="18" height="24" /><rect x="67" y="26" width="18" height="24" />
    <line x1="53" y1="34" x2="67" y2="34" />
  </g>
  <g class="binoculars">
    <rect x="34" y="24" width="20" height="28" fill="#2b2b3a" /><rect x="66" y="24" width="20" height="28" fill="#2b2b3a" />
    <rect x="52" y="32" width="16" height="10" fill="#2b2b3a" />
    <rect x="38" y="28" width="12" height="20" fill="#8bd3ff" /><rect x="70" y="28" width="12" height="20" fill="#8bd3ff" />
  </g>
</svg>`;

function face(parent: HTMLElement, w: number, h: number, left: number, top: number, transform: string, color: string) {
  const el = document.createElement("div");
  el.className = "face";
  Object.assign(el.style, { width: `${w}px`, height: `${h}px`, left: `${left}px`, top: `${top}px`, transform, background: color });
  parent.append(el);
  return el;
}

function cube(parent: HTMLElement, { x, y, w, h, d, z = 0, cls = "", shades = ORANGE }: Cube) {
  const el = document.createElement("div");
  el.className = `cube ${cls}`;
  // `translate` (et non transform) pour laisser transform libre aux animations CSS (balancement des jambes)
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, translate: `0 0 ${z}px` });
  face(el, w, h, 0, 0, `translateZ(${d / 2}px)`, shades.front);
  face(el, w, h, 0, 0, `rotateY(180deg) translateZ(${d / 2}px)`, shades.back);
  face(el, d, h, (w - d) / 2, 0, `rotateY(90deg) translateZ(${w / 2}px)`, shades.right);
  face(el, d, h, (w - d) / 2, 0, `rotateY(-90deg) translateZ(${w / 2}px)`, shades.left);
  face(el, w, d, 0, (h - d) / 2, `rotateX(90deg) translateZ(${h / 2}px)`, shades.top);
  face(el, w, d, 0, (h - d) / 2, `rotateX(-90deg) translateZ(${h / 2}px)`, shades.bottom);
  parent.append(el);
  return el;
}

export function buildPet(rig: HTMLElement) {
  const body = cube(rig, { x: 27.5, y: 15, w: 95, h: 67.5, d: 45 });
  body.firstElementChild!.innerHTML = FACE; // 1re face créée = face avant
  cube(rig, { x: 10, y: 42.5, w: 17.5, h: 17.5, d: 17.5, cls: "arm arm-l" });
  cube(rig, { x: 122.5, y: 42.5, w: 17.5, h: 17.5, d: 17.5, cls: "arm arm-r" });
  for (const x of [37.5, 55, 85, 102.5]) {
    for (const z of [12, -12]) cube(rig, { x, y: 82.5, w: 10, h: 20, d: 10, z, cls: "leg" });
  }
  // accessoires : cachés par défaut, affichés selon l'outil en cours (cf. styles.css)
  // clavier : socle de 90 px + 2 rangées de 10 touches. Chaque bras couvre 2 colonnes (1-2 à gauche, 7-8 à droite) ; la variante a/b/c/d règle l'instant où la touche s'enfonce.
  const keyboard = document.createElement("div");
  keyboard.className = "keyboard";
  cube(keyboard, { x: 0, y: 0, w: 90, h: 5, d: 26, shades: GREY });
  const press: Record<number, [string, string]> = { 1: ["k-a", "k-b"], 2: ["k-b", "k-a"], 7: ["k-c", "k-d"], 8: ["k-d", "k-c"] };
  for (let col = 0; col < 10; col++) {
    [-6, 6].forEach((z, row) => cube(keyboard, { x: 0.75 + col * 9, y: -2, w: 7.5, h: 2, d: 7, z, cls: `key ${press[col]?.[row] ?? ""}`, shades: KEY }));
  }
  rig.append(keyboard);
  const hammer = document.createElement("div");
  hammer.className = "hammer";
  cube(hammer, { x: 0, y: 10, w: 5, h: 30, d: 5, shades: WOOD });
  cube(hammer, { x: -6, y: 0, w: 17, h: 12, d: 10, shades: GREY });
  rig.append(hammer);
  // cible du marteau : une enclume devant lui, et un flash d'étincelles à l'impact
  // enclume : pied, taille étroite, plateau large et bigorne (coordonnées relatives au conteneur 22 x 22,5)
  const anvil = document.createElement("div");
  anvil.className = "anvil";
  cube(anvil, { x: 2, y: 16.5, w: 18, h: 6, d: 16, shades: STEEL });
  cube(anvil, { x: 6, y: 9.5, w: 10, h: 7, d: 9, shades: STEEL });
  cube(anvil, { x: -1, y: 3.5, w: 24, h: 6, d: 13, shades: STEEL });
  cube(anvil, { x: 23, y: 4.5, w: 8, h: 4.5, d: 7, shades: STEEL });
  rig.append(anvil);
  const flash = document.createElement("div");
  flash.className = "flash";
  rig.append(flash);
}
