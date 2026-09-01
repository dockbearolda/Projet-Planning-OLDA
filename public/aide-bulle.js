// ===========================================================================
// L'AIDE SE DEMANDE — elle ne s'écrit plus sous le titre (01/09/2026)
// ===========================================================================
// Consigne de Charlie, mot pour mot : « supprime les phrases de ce genre, et
// mettre à côté du titre un petit i dans une bulle qui nous affiche les infos
// quand on clique dessus. »
//
// Six cartes des Réglages et du Devis portaient, sous leur titre, un
// paragraphe de deux à quatre lignes qui expliquait ce qu'elles faisaient :
// trente lignes de prose à franchir avant d'atteindre le premier champ, et
// relues zéro fois après la première ouverture. Le texte ne disparaît pas — il
// se demande. « À égalité, celle qui montre MOINS gagne. »
//
// UNE SEULE ÉCRITURE POUR LES DEUX ÉCRANS. Réglages et Devis sont à un clic
// l'un de l'autre et portent la MÊME carte : deux fabriques qui se ressemblent
// redeviendraient deux bulles le jour où l'une bouge. La forme vit dans
// `charte.css` (`.aide-b` / `.aide-bulle`), le comportement ici — exactement
// la coupe de `ecran-tete.js` et de `modale.js`.
//
// LA BULLE NE POUSSE PERSONNE (loi 8). Elle sort du flux et se pose sur la
// largeur de son HÔTE, pas sur celle du « i » : voir la note de `charte.css`.

// Une seule bulle ouverte à la fois. Deux aides dépliées sur la même carte se
// recouvriraient — elles se posent toutes les deux sous la même rangée.
let ouverte = null;
let branche = false;
let compteur = 0;

function fermer() {
  if (!ouverte) return;
  ouverte.bulle.hidden = true;
  ouverte.bouton.setAttribute('aria-expanded', 'false');
  ouverte = null;
}

// UN ÉCRAN REBÂTI EMPORTE SA BULLE. `batir()` remplace tout le contenu de
// l'écran : la référence gardée ici pointerait alors sur un nœud qui n'est plus
// dans la page, et le prochain clic ailleurs essaierait de le refermer.
function vivante() {
  if (ouverte && !document.contains(ouverte.bouton)) ouverte = null;
  return ouverte;
}

function brancher() {
  if (branche) return;
  branche = true;
  // `pointerdown` et pas `click` : un clic qui part sur la bulle et finit
  // ailleurs (une sélection de texte qu'on relâche hors du cadre) ne doit pas
  // compter comme un clic dehors, et `pointerdown` ferme avant que le champ
  // visé ne prenne le focus.
  document.addEventListener('pointerdown', (e) => {
    const o = vivante();
    if (!o) return;
    if (o.bouton.contains(e.target) || o.bulle.contains(e.target)) return;
    fermer();
  });
  // Échap referme et REND LE FOCUS au « i » : sans ça, la tabulation repart du
  // début de la page.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const o = vivante();
    if (!o) return;
    const b = o.bouton;
    fermer();
    b.focus();
  });
}

// `hote`  le bloc qui sert d'ancre à la bulle — elle en prendra la largeur.
// `ligne` la rangée où le « i » se pose, à côté du titre.
// `texte` ce qu'on ne voit pas en regardant la carte. Vide : rien n'est posé,
//         et c'est voulu — une carte qui n'a rien à expliquer ne porte pas un
//         bouton qui n'ouvre rien.
export function poserAide(hote, ligne, texte) {
  const t = String(texte == null ? '' : texte).trim();
  if (!hote || !ligne || !t) return null;
  brancher();
  compteur += 1;
  const id = `aide-bulle-${compteur}`;

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'aide-b';
  bouton.textContent = 'i';
  bouton.setAttribute('aria-label', 'Ce que fait cette carte');
  bouton.setAttribute('aria-expanded', 'false');
  bouton.setAttribute('aria-controls', id);

  const bulle = document.createElement('p');
  bulle.className = 'aide-bulle';
  bulle.id = id;
  bulle.textContent = t;
  bulle.hidden = true;

  bouton.addEventListener('click', () => {
    const rouvre = vivante() && ouverte.bouton === bouton;
    fermer();
    if (rouvre) return;
    bulle.hidden = false;
    bouton.setAttribute('aria-expanded', 'true');
    ouverte = { bouton, bulle };
  });

  ligne.append(bouton);
  hote.append(bulle);
  return bouton;
}
