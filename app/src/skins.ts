// Apparence du pet : couleur du corps et accessoire décoratif (réglages > Apparence).
export type Shades = { front: string; top: string; right: string; left: string; back: string; bottom: string };

const FACES = ["front", "top", "right", "left", "back", "bottom"] as const;
// Les pavés du corps lisent leurs couleurs dans des variables CSS de #pet : changer de skin ne reconstruit rien.
export const SKIN = Object.fromEntries(FACES.map((f) => [f, `var(--skin-${f})`])) as Shades;

// Les 6 faces d'une teinte : l'éclairage du pavé orange d'origine (luminosité et saturation relatives à la face avant).
const tone = (h: number, s: number, l: number): Shades => {
  const c = (ds: number, dl: number) => `hsl(${h} ${Math.max(0, s + ds)}% ${l + dl}%)`;
  return { front: c(0, 0), top: c(6, 10), right: c(-14, -9), left: c(-14, -4), back: c(-13, -13), bottom: c(-12, -20) };
};

export const COLORS: Record<string, { label: string; shades: Shades }> = {
  orange: { label: "Orange", shades: { front: "#e8793c", top: "#f2985f", right: "#c9622a", left: "#d46d31", back: "#b85a26", bottom: "#9a4a1f" } },
  blue: { label: "Bleu", shades: tone(215, 75, 58) },
  green: { label: "Vert", shades: tone(145, 45, 48) },
  pink: { label: "Rose", shades: tone(335, 75, 64) },
  violet: { label: "Violet", shades: tone(265, 55, 60) },
};

export const ACCESSORIES: Record<string, string> = {
  none: "Aucun",
  ears: "Oreilles",
  antenna: "Antenne",
  hat: "Chapeau",
  crown: "Couronne",
  horns: "Cornes",
  mohawk: "Crête",
  halo: "Auréole",
  propeller: "Casquette à hélice",
};

export function setSkin(pet: HTMLElement, color: string, accessory: string) {
  const shades = (COLORS[color] ?? COLORS.orange).shades;
  for (const f of FACES) pet.style.setProperty(`--skin-${f}`, shades[f]);
  for (const box of pet.querySelectorAll<HTMLElement>(".acc")) box.hidden = !box.classList.contains(`acc-${accessory}`);
}
