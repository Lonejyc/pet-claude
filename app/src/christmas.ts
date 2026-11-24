// Saison de Noël : neige, sons de fêtes. Réglage explicite = il prime toute l'année ; absent = activé en décembre seulement.
export const christmasOn = (setting: boolean | undefined, date: Date) => setting ?? date.getMonth() === 11;
