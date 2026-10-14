// Le pet en vrai volume : des pavés CSS 3D (6 faces chacun). Unités = px, origine en haut à gauche d'un cadre 150 x 112.
type Cube = { x: number; y: number; w: number; h: number; d: number; z?: number; cls?: string };

const SHADES = { front: "#e8793c", top: "#f2985f", right: "#c9622a", left: "#d46d31", back: "#b85a26", bottom: "#9a4a1f" };

// Visage = le SVG d'origine, rogné sur la face avant du corps (mêmes coordonnées, mêmes classes CSS).
const FACE = `<svg viewBox="22 12 76 54" width="100%" height="100%" shape-rendering="crispEdges">
  <g class="eyes-open" fill="#1a1a1a"><rect x="40" y="30" width="8" height="16" /><rect x="72" y="30" width="8" height="16" /></g>
  <g class="eyes-squint" fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="square">
    <polyline points="38,30 50,38 38,46" /><polyline points="82,30 70,38 82,46" />
  </g>
  <rect class="mouth" x="54" y="50" width="12" height="7" fill="#1a1a1a" />
</svg>`;

function face(parent: HTMLElement, w: number, h: number, left: number, top: number, transform: string, color: string) {
  const el = document.createElement("div");
  el.className = "face";
  Object.assign(el.style, { width: `${w}px`, height: `${h}px`, left: `${left}px`, top: `${top}px`, transform, background: color });
  parent.append(el);
  return el;
}

function cube(rig: HTMLElement, { x, y, w, h, d, z = 0, cls = "" }: Cube) {
  const el = document.createElement("div");
  el.className = `cube ${cls}`;
  // `translate` (et non transform) pour laisser transform libre aux animations CSS (balancement des jambes)
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, translate: `0 0 ${z}px` });
  face(el, w, h, 0, 0, `translateZ(${d / 2}px)`, SHADES.front);
  face(el, w, h, 0, 0, `rotateY(180deg) translateZ(${d / 2}px)`, SHADES.back);
  face(el, d, h, (w - d) / 2, 0, `rotateY(90deg) translateZ(${w / 2}px)`, SHADES.right);
  face(el, d, h, (w - d) / 2, 0, `rotateY(-90deg) translateZ(${w / 2}px)`, SHADES.left);
  face(el, w, d, 0, (h - d) / 2, `rotateX(90deg) translateZ(${h / 2}px)`, SHADES.top);
  face(el, w, d, 0, (h - d) / 2, `rotateX(-90deg) translateZ(${h / 2}px)`, SHADES.bottom);
  rig.append(el);
  return el;
}

export function buildPet(rig: HTMLElement) {
  const body = cube(rig, { x: 27.5, y: 15, w: 95, h: 67.5, d: 45 });
  body.firstElementChild!.innerHTML = FACE; // 1re face créée = face avant
  cube(rig, { x: 10, y: 42.5, w: 17.5, h: 17.5, d: 17.5 });
  cube(rig, { x: 122.5, y: 42.5, w: 17.5, h: 17.5, d: 17.5 });
  for (const x of [37.5, 55, 85, 102.5]) {
    for (const z of [12, -12]) cube(rig, { x, y: 82.5, w: 10, h: 20, d: 10, z, cls: "leg" });
  }
}
