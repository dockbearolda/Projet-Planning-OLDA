// L'EN-TETE D'ECRAN — le meme objet pour tous les ecrans du CRM.
//
// Il y en avait six, ecrits dans cinq fichiers : `.mt-head__titre` et
// `.pil-titre` (32 px, deux regles identiques au caractere pres),
// `.work-title h1` (17), `.cl-brand__title` (17), `.reg-head__title` (17 plus
// une icone), et le Point du jour qui n'en avait aucun. Mesure au rendu le
// 30/08 : trois tailles, quatre abscisses, cinq ordonnees.
//
// La forme vit dans `charte.css` (`.ecran-tete`), le MARKUP vit ici. Les deux
// ensemble : sinon chaque ecran reecrit sa rangee et on retrouve six variantes
// au bout d'un mois, comme la regle du 27/08 le dit — deux ecritures
// redeviennent deux hauteurs le jour ou l'une bouge.
//
// Pas d'icone : la rangee d'onglets, juste au-dessus, dit deja sur quel ecran
// on est. Voir la note de `charte.css`.

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// `titre`  le nom de l'ecran — le seul champ obligatoire.
// `compte` ce qu'il contient (« 3 commandes ») — a cote du titre, JAMAIS dessous :
//          une deuxieme ligne dans la rangee remonte le titre de 10 px, et l'ecran
//          qui en portait une (Reglages) etait le seul dont le titre ne tombait
//          pas a la hauteur des huit autres.
// `niveau` 'h1' par defaut ; 'h2' quand l'ecran est pose DANS un autre.
// `gauche` / `droite` : les commandes propres a l'ecran.
export function ecranTete({
  titre, compte, niveau = 'h1', gauche = [], droite = [],
} = {}) {
  const tete = el('header', 'ecran-tete');

  const g = el('div', 'ecran-tete__gauche');
  const titres = el('div', 'ecran-tete__titres');
  const h = el(niveau, 'ecran-tete__titre', titre || '');
  titres.append(h);
  g.append(titres);

  const c = el('span', 'ecran-tete__compte');
  if (compte) c.textContent = compte; else c.hidden = true;
  g.append(c);
  g.append(...gauche.filter(Boolean));
  tete.append(g);

  const d = el('div', 'ecran-tete__droite');
  d.append(...droite.filter(Boolean));
  tete.append(d);

  // Rendus pour que l'ecran puisse remettre a jour son titre et son compteur
  // sans reconstruire la rangee — une rangee reconstruite tue les transitions
  // et reprend le champ sous les doigts.
  tete.majTitre = (t) => { h.textContent = t; };
  tete.majCompte = (t) => { c.textContent = t || ''; c.hidden = !t; };
  return tete;
}
