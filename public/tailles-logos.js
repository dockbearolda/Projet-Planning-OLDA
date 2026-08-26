// TAILLES DES LOGOS — la largeur du logo à imprimer, en millimètres.
//
// Par famille, par référence, par FACE et par taille de vêtement. Ce n'est pas
// une constante par référence : sur NS300 le dos va de 240 mm en XS à 320 mm en
// XL, et c'est précisément ce qu'on ne retient pas de tête.
//
// UNE FAMILLE PORTE SES PROPRES FACES. Un tote bag en a deux, une casquette une
// seule (l'avant), un t-shirt six. Une liste unique donnait à la casquette une
// colonne « Manche GA » — et une colonne qui n'a aucun sens finit par être
// remplie. Les familles se créent, se renomment, se retirent depuis ici : un
// objet nouveau arrive à l'atelier, il lui faut sa catégorie le jour même.
//
// LES FACES SONT DES NOMS LIBRES, et c'est le nom qui fait le lien avec le
// comptoir : la vendeuse choisit un emplacement de marquage (« Coeur + Dos »)
// et la largeur se prend sur la face qui porte ce nom. Les familles connues du
// chiffrage arrivent donc avec les noms du chiffrage — le champ les propose.
//
// Chargé À LA DEMANDE par app.js au premier passage sur l'onglet.

import { fetchBorne } from './reseau.js';

let ROOT = null;
const $ = (sel) => ROOT.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const ic = (name, cls) => {
  const n = el('span', `material-symbols-outlined${cls ? ` ${cls}` : ''}`, name);
  n.setAttribute('aria-hidden', 'true');
  return n;
};

async function api(method, chemin, corps) {
  const res = await fetchBorne(chemin, {
    method,
    headers: corps !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });
  const texte = await res.text();
  // Le statut AVANT le corps : une page d'erreur du proxy (HTML) ferait échouer
  // l'analyse JSON d'abord, et l'écran afficherait « Unexpected token < » au
  // lieu de « Erreur 502 ».
  let data = null;
  try { data = texte ? JSON.parse(texte) : null; } catch (_) { data = null; }
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

let table = { familles: [] };
let familleNom = '';
let faceNom = '';
let etat = '';                 // ce que la dernière écriture a donné, dit DANS l'écran
let colonnes = 1;              // largeur de la grille affichée, pour se déplacer dedans

const familleCourante = () => table.familles.find((f) => f.nom === familleNom) || table.familles[0] || null;

// LE CATALOGUE TEXTILE, chargé à la demande. Les lignes du tableau sont les
// références du catalogue : les taper à la main laisserait passer une faute de
// frappe qui rendrait la mesure introuvable au comptoir, sans rien signaler.
// C'est un script classique (il se pose sur `window`), pas un module : on
// l'injecte plutôt que de l'importer.
let cataloguePret = null;
function chargerCatalogue() {
  if (cataloguePret) return cataloguePret;
  cataloguePret = new Promise((resolve) => {
    if (window.TextileEngine) return resolve(window.TextileEngine);
    const sc = document.createElement('script');
    sc.src = '/comptoir/textile-catalog.js';
    sc.onload = () => resolve(window.TextileEngine || null);
    sc.onerror = () => resolve(null);
    document.head.appendChild(sc);
  });
  return cataloguePret;
}

// Les références d'une famille : celles du catalogue qui portent son nom comme
// genre, PLUS celles déjà mesurées ici. Sans les secondes, une mesure devenue
// orpheline disparaîtrait de l'écran sans disparaître de la base — invisible et
// indéboulonnable. Une famille créée à la main n'a pas de genre au catalogue :
// elle n'affiche donc que ses propres références, et c'est normal.
function lignesDeLaFamille(f) {
  const TE = window.TextileEngine;
  const lignes = [];
  const vues = new Set();
  if (TE) {
    for (const r of TE.DB.refs) {
      if (TE.genreSaisie(r.genre) !== f.nom) continue;
      lignes.push({ ref: r.ref, nom: r.designation || '' });
      vues.add(r.ref);
    }
  }
  // LES RÉFÉRENCES DÉCLARÉES À LA MAIN, pour une famille que le catalogue ne
  // couvre pas : sans elles, « Sac à dos » s'ouvrirait vide et il n'y aurait
  // rien à remplir.
  for (const ref of [...(f.references || []), ...Object.keys(f.refs || {})]) {
    if (vues.has(ref)) continue;
    vues.add(ref);
    // LA DÉSIGNATION SE CHERCHE DANS TOUT LE CATALOGUE, pas dans la famille : le
    // body K831 est rangé « Enfant » au catalogue et mesuré « Bébé » à
    // l'atelier. Il est bien au catalogue — dire « hors catalogue » serait faux.
    const au = TE && (TE.getRef(ref) || TE.DB.refs.find((r) => r.toptex === ref));
    lignes.push({ ref, nom: au ? (au.designation || '') : 'hors catalogue' });
  }
  return lignes;
}

// Tous les emplacements de marquage que le chiffrage connaît : ils sont
// PROPOSÉS quand on nomme une face, parce qu'un nom qui tombe juste fait que le
// comptoir se remplit tout seul.
function emplacementsDuChiffrage() {
  const TE = window.TextileEngine;
  return TE ? TE.PLACEMENTS.slice() : [];
}

function compter() {
  let refs = 0;
  let mesures = 0;
  for (const f of table.familles) {
    for (const parFace of Object.values(f.refs || {})) {
      refs += 1;
      for (const t of Object.values(parFace)) mesures += Object.keys(t).length;
    }
  }
  return { refs, mesures };
}

// --- Rendu -------------------------------------------------------------------

function render() {
  if (!ROOT) return;
  const f = familleCourante();
  if (f) familleNom = f.nom;
  if (f && !f.faces.includes(faceNom)) [faceNom] = f.faces;

  const page = el('div', 'reg-page tl-page');
  const tete = el('header', 'reg-head');
  tete.append(ic('draw', 'reg-head__ic'), (() => {
    const t = el('div', 'reg-head__titles');
    t.append(el('h2', 'reg-head__title', 'Tailles des logos'));
    return t;
  })());
  page.appendChild(tete);

  const carte = el('section', 'reg-card tl-carte');
  carte.append(colonneFamilles(), f ? panneau(f) : el('p', 'tl-vide', 'Aucune famille — créez-en une à gauche.'));
  page.appendChild(carte);
  ROOT.replaceChildren(page);
  pied();
}

// LES FAMILLES EN COLONNE, pas en rangée de pilules. Elles sont sept, elles
// vont être plus nombreuses, et leurs noms n'ont pas la même longueur : en
// rangée elles poussaient les faces sur une deuxième ligne et on lisait deux
// rangées de boutons sans savoir laquelle commandait l'autre. En colonne, la
// hiérarchie se voit : la famille à gauche, ce qu'elle contient à droite.
function colonneFamilles() {
  const col = el('nav', 'tl-familles');
  col.setAttribute('aria-label', 'Familles');
  col.append(el('span', 'tl-familles__t', 'Familles'));
  for (const f of table.familles) {
    const b = el('button', `tl-famille${f.nom === familleNom ? ' est-on' : ''}`);
    b.type = 'button';
    b.dataset.famille = f.nom;
    b.setAttribute('aria-current', f.nom === familleNom ? 'true' : 'false');
    const { mesures } = (() => {
      let m = 0;
      for (const parFace of Object.values(f.refs || {})) {
        for (const t of Object.values(parFace)) m += Object.keys(t).length;
      }
      return { mesures: m };
    })();
    b.append(el('span', 'tl-famille__nom', f.nom));
    // Le compte dit où il reste à travailler : c'est la seule chose qui
    // hiérarchise une liste de familles toutes pareilles.
    b.append(el('span', 'tl-famille__n', mesures ? String(mesures) : '—'));
    col.append(b);
  }
  const plus = el('button', 'tl-ajout', '+ Nouvelle famille');
  plus.type = 'button';
  plus.dataset.action = 'famille-creer';
  col.append(plus);
  return col;
}

function panneau(f) {
  const box = el('div', 'tl-panneau');

  // Le nom de la famille et ce qu'on peut en faire, à sa place : au-dessus de
  // ce qu'il commande.
  const tete = el('div', 'tl-tete-famille');
  tete.append(el('h3', 'tl-nom-famille', f.nom));
  const outils = el('div', 'tl-outils');
  for (const [action, mot] of [['famille-renommer', 'Renommer'], ['famille-retirer', 'Retirer']]) {
    const b = el('button', 'tl-lien', mot);
    b.type = 'button';
    b.dataset.action = action;
    outils.append(b);
  }
  tete.append(outils);
  box.append(tete);

  // LES FACES DE CETTE FAMILLE. Un tote bag en a deux, une casquette une seule.
  const barre = el('div', 'tl-faces');
  barre.setAttribute('role', 'group');
  barre.setAttribute('aria-label', 'Faces de la famille');
  for (const nom of f.faces) {
    const b = el('button', `tl-face${nom === faceNom ? ' est-on' : ''}`, nom);
    b.type = 'button';
    b.dataset.face = nom;
    b.setAttribute('aria-pressed', nom === faceNom ? 'true' : 'false');
    barre.append(b);
  }
  const plus = el('button', 'tl-face tl-face--ajout', '+');
  plus.type = 'button';
  plus.dataset.action = 'face-creer';
  plus.title = 'Ajouter une face à cette famille';
  barre.append(plus);
  box.append(barre);

  const outilsFace = el('div', 'tl-outils tl-outils--face');
  for (const [action, mot] of [['face-renommer', 'Renommer la face'], ['face-retirer', 'Retirer la face'],
    ['ref-ajouter', '+ Référence']]) {
    const b = el('button', 'tl-lien', mot);
    b.type = 'button';
    b.dataset.action = action;
    outilsFace.append(b);
  }
  box.append(outilsFace);

  const lignes = lignesDeLaFamille(f);
  if (!lignes.length) {
    box.append(el('p', 'tl-vide', window.TextileEngine
      ? 'Aucune référence. Les lignes viennent du catalogue textile — une référence y apparaît '
        + 'dès que son genre porte ce nom — ou s’ajoutent ici, une à une, avec « + Référence ».'
      : 'Catalogue textile indisponible — impossible de lister les références.'));
    box.append(el('p', 'tl-pied', ''));
    return box;
  }

  // La grille défile dans SA boîte : la page, elle, ne part jamais de côté et ne
  // s'allonge pas de deux mille pixels parce qu'une famille compte vingt-six
  // références.
  const cadre = el('div', 'tl-cadre');
  const grille = el('div', 'tl-grille');
  colonnes = f.tailles.length;
  grille.style.setProperty('--tl-cols', String(colonnes));
  grille.append(el('span', 'tl-coin', 'Référence'));
  for (const t of f.tailles) grille.append(el('span', 'tl-tete', t));
  for (const ligne of lignes) {
    const nom = el('span', 'tl-ref');
    nom.append(el('b', null, ligne.ref));
    if (ligne.nom) nom.append(el('span', 'tl-nom', ligne.nom));
    grille.append(nom);
    for (const t of f.tailles) {
      const input = el('input', 'tl-champ');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      const v = (((f.refs || {})[ligne.ref] || {})[faceNom] || {})[t];
      input.value = v == null ? '' : String(v);
      input.dataset.ref = ligne.ref;
      input.dataset.taille = t;
      input.setAttribute('aria-label', `${ligne.ref}, ${faceNom}, ${t}, en millimètres`);
      grille.append(input);
    }
  }
  cadre.append(grille);
  box.append(cadre);
  box.append(el('p', 'tl-pied', ''));
  return box;
}

// Ce que le tableau porte à l'instant. Se relit après CHAQUE case écrite : sans
// ça, le compte reste celui de l'ouverture de l'écran et rien ne dit que la
// saisie est partie.
function pied() {
  const p = $('.tl-pied');
  if (!p) return;
  if (etat) { p.textContent = etat; return; }
  const { refs, mesures } = compter();
  p.textContent = `${refs} référence${refs > 1 ? 's' : ''} renseignée${refs > 1 ? 's' : ''}, `
    + `${mesures} largeur${mesures > 1 ? 's' : ''} au total. `
    + 'Une case vide veut dire « pas encore mesuré ». '
    + 'Entrée et les flèches haut/bas descendent la colonne, la tabulation va de côté, '
    + 'et un bloc copié depuis un tableur se colle d’un coup.';
}

// --- Écriture ----------------------------------------------------------------

// UNE CASE À LA FOIS, À LA PERTE DU FOCUS. Enregistrer à la frappe ferait un
// appel par chiffre tapé — et « 260 » commencerait par écrire 2, puis 26.
async function enregistrer(input) {
  const avant = input.value;
  try {
    const recu = await api('PATCH', '/api/tailles-logo', {
      famille: familleNom,
      reference: input.dataset.ref,
      face: faceNom,
      taille: input.dataset.taille,
      largeur: input.value,
    });
    if (recu && recu.familles) table = { familles: recu.familles };
    etat = '';
    input.classList.remove('est-ko');
  } catch (err) {
    // LA CASE GARDE CE QUI EST À L'ÉCRAN et le dit : la remettre à sa valeur
    // d'avant ferait disparaître la saisie sous les doigts, et on croirait
    // avoir mal tapé.
    etat = `${err.message} — la largeur ${avant || '(vide)'} n’est pas enregistrée.`;
    input.classList.add('est-ko');
  }
  // LE PIED SEUL EST RÉÉCRIT : refaire la grille reprendrait le champ sous les
  // doigts au moment où l'on passe au suivant par la touche de tabulation.
  pied();
}

// --- Saisie au clavier et collage --------------------------------------------
// La saisie se fait à la main et c'est le métier : personne d'autre que
// l'atelier ne connaît ces largeurs. Le tableau en compte des centaines, alors
// l'écran doit se comporter comme un tableur.
//
// LES FLÈCHES HAUT/BAS DÉPLACENT, ELLES N'INCRÉMENTENT PLUS. Sur un champ
// numérique, une flèche change la valeur : de quoi corriger une mesure sans
// s'en apercevoir, en croyant simplement descendre d'une ligne. Gauche et
// droite restent au curseur — c'est ce qu'on veut en corrigeant un chiffre — et
// la tabulation suffit pour aller de côté.
function cases() {
  return [...ROOT.querySelectorAll('.tl-champ')];
}
function deplacer(champ, dLigne, dCol) {
  const tous = cases();
  const n = tous.indexOf(champ);
  if (n < 0 || !colonnes) return;
  const col = (n % colonnes) + dCol;
  if (col < 0 || col >= colonnes) return;      // on ne repasse pas sur la ligne d'à côté
  const cible = tous[(Math.floor(n / colonnes) + dLigne) * colonnes + col];
  if (!cible) return;
  cible.focus();
  cible.select();
}

// COLLER UN BLOC DEPUIS UN TABLEUR. C'est le geste qui transforme une soirée de
// saisie en une sélection : les mesures existent souvent déjà quelque part.
// Une case VIDE dans le bloc ne touche à rien : dans une feuille, un blanc veut
// dire « pas mesuré », pas « efface ce que tu as ». Effacer reste un geste
// délibéré, case par case.
async function collerBloc(depuis, texte) {
  const lignes = texte.replace(/\r/g, '').split('\n');
  while (lignes.length > 1 && lignes[lignes.length - 1] === '') lignes.pop();
  const bloc = lignes.map((l) => l.split('\t'));
  const tous = cases();
  const n = tous.indexOf(depuis);
  if (n < 0 || !colonnes) return;
  const ligne0 = Math.floor(n / colonnes);
  const col0 = n % colonnes;

  const aEcrire = [];
  bloc.forEach((valeurs, dl) => valeurs.forEach((v, dc) => {
    const val = String(v).trim().replace(',', '.');
    if (!val) return;
    const col = col0 + dc;
    if (col >= colonnes) return;               // le bloc est plus large que la grille
    const cible = tous[(ligne0 + dl) * colonnes + col];
    if (cible && cible.value !== val) aEcrire.push([cible, val]);
  }));
  if (!aEcrire.length) return;

  // EN SÉQUENCE, et on dit où on en est : cent cases, c'est cent allers-retours,
  // et un écran muet pendant cinq secondes passe pour un écran cassé.
  let faites = 0;
  for (const [cible, val] of aEcrire) {
    cible.value = val;
    // eslint-disable-next-line no-await-in-loop
    await enregistrer(cible);
    // `enregistrer` vide `etat` quand ça passe et y met le refus sinon : un
    // texte ici veut dire que la case n'est pas enregistrée. On s'arrête, elle
    // se lit, et les suivantes ne partent pas dans le vide.
    if (etat) return;
    faites += 1;
    etat = `${faites} / ${aEcrire.length} largeurs enregistrées…`;
    pied();
  }
  etat = '';
  pied();
}

// --- Familles et faces --------------------------------------------------------
// `prompt` et `confirm` sont les boîtes du navigateur : elles arrêtent l'écran
// et sortent de la charte. Elles restent ici parce que ces trois gestes sont
// RARES (créer une famille, la renommer, la retirer) et qu'un formulaire posé à
// demeure sur un écran de saisie coûterait de la place tous les jours pour un
// geste par trimestre. Le jour où ils deviennent fréquents, ils prendront leur
// panneau — voir `public/modale.js`.
async function agir(action) {
  const f = familleCourante();
  try {
    if (action === 'famille-creer') {
      const nom = window.prompt('Nom de la nouvelle famille (Sac à dos, Mug, Casquette enfant…)');
      if (!nom || !nom.trim()) return;
      table = await api('POST', '/api/tailles-logo/familles', { nom: nom.trim() });
      familleNom = nom.trim();
      faceNom = '';
    } else if (action === 'famille-renommer' && f) {
      const nom = window.prompt('Nouveau nom de la famille', f.nom);
      if (!nom || !nom.trim() || nom.trim() === f.nom) return;
      table = await api('PATCH', `/api/tailles-logo/familles/${encodeURIComponent(f.nom)}`, { nom: nom.trim() });
      familleNom = nom.trim();
    } else if (action === 'famille-retirer' && f) {
      // CE QU'ON PERD SE DIT EN CHIFFRES. « Êtes-vous sûr ? » ne dit rien : le
      // nombre de mesures, si.
      let m = 0;
      for (const parFace of Object.values(f.refs || {})) {
        for (const t of Object.values(parFace)) m += Object.keys(t).length;
      }
      const quoi = m ? `${f.nom} et ses ${m} largeur${m > 1 ? 's' : ''} mesurée${m > 1 ? 's' : ''}` : f.nom;
      if (!window.confirm(`Retirer ${quoi} ? C’est définitif.`)) return;
      table = await api('DELETE', `/api/tailles-logo/familles/${encodeURIComponent(f.nom)}`);
      familleNom = '';
      faceNom = '';
    } else if (action === 'face-creer' && f) {
      const nom = await demanderFace('Nom de la nouvelle face');
      if (!nom) return;
      table = await api('PATCH', `/api/tailles-logo/familles/${encodeURIComponent(f.nom)}`,
        { faces: [...f.faces, nom] });
      faceNom = nom;
    } else if (action === 'face-renommer' && f) {
      const nom = await demanderFace('Nouveau nom de la face', faceNom);
      if (!nom || nom === faceNom) return;
      // RENOMMER UNE FACE EMPORTE SES MESURES : sans ça, les largeurs
      // resteraient sur l'ancien nom, invisibles et indéboulonnables.
      const refs = {};
      for (const [ref, parFace] of Object.entries(f.refs || {})) {
        refs[ref] = {};
        for (const [face, parTaille] of Object.entries(parFace)) {
          refs[ref][face === faceNom ? nom : face] = parTaille;
        }
      }
      f.refs = refs;
      table = await api('PATCH', `/api/tailles-logo/familles/${encodeURIComponent(f.nom)}`,
        { faces: f.faces.map((x) => (x === faceNom ? nom : x)), refs });
      faceNom = nom;
    } else if (action === 'ref-ajouter' && f) {
      const ref = window.prompt('Référence à ajouter à « ' + f.nom + ' »');
      if (!ref || !ref.trim()) return;
      table = await api('PATCH', `/api/tailles-logo/familles/${encodeURIComponent(f.nom)}`,
        { references: [...(f.references || []), ref.trim()] });
    } else if (action === 'face-retirer' && f) {
      if (f.faces.length < 2) { etat = 'Une famille garde au moins une face.'; pied(); return; }
      let m = 0;
      for (const parFace of Object.values(f.refs || {})) m += Object.keys(parFace[faceNom] || {}).length;
      const quoi = m ? `« ${faceNom} » et ses ${m} largeur${m > 1 ? 's' : ''}` : `« ${faceNom} »`;
      if (!window.confirm(`Retirer ${quoi} ? C’est définitif.`)) return;
      table = await api('PATCH', `/api/tailles-logo/familles/${encodeURIComponent(f.nom)}`,
        { faces: f.faces.filter((x) => x !== faceNom) });
      faceNom = '';
    } else {
      return;
    }
    etat = '';
  } catch (err) {
    etat = err.message;
  }
  render();
}

// LE NOM D'UNE FACE FAIT LE LIEN AVEC LE COMPTOIR : la vendeuse choisit un
// emplacement de marquage, et la largeur se prend sur la face qui porte ce nom.
// On rappelle donc les emplacements que le chiffrage connaît — un nom qui tombe
// juste, c'est une case qui se remplit toute seule là-bas.
function demanderFace(question, valeur) {
  const connus = emplacementsDuChiffrage();
  const rappel = connus.length
    ? `\n\nPour que le comptoir la remplisse tout seul, reprenez le nom d’un emplacement de marquage :\n${connus.join(' · ')}`
    : '';
  const nom = window.prompt(question + rappel, valeur || '');
  return Promise.resolve(nom && nom.trim() ? nom.trim() : '');
}

// --- Câblage ------------------------------------------------------------------

function wire() {
  // UN SEUL ÉCOUTEUR de chaque sorte : les champs sont refaits à chaque
  // changement de famille ou de face.
  ROOT.addEventListener('change', (e) => {
    const champ = e.target.closest('.tl-champ');
    if (champ) enregistrer(champ);
  });
  ROOT.addEventListener('keydown', (e) => {
    const champ = e.target.closest('.tl-champ');
    if (!champ) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); deplacer(champ, -1, 0); }
    else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); deplacer(champ, 1, 0); }
  });
  ROOT.addEventListener('paste', (e) => {
    const champ = e.target.closest('.tl-champ');
    if (!champ) return;
    const texte = (e.clipboardData || window.clipboardData).getData('text');
    // Une valeur seule : le collage normal du navigateur fait déjà l'affaire.
    if (!/[\t\n]/.test(texte)) return;
    e.preventDefault();
    collerBloc(champ, texte);
  });
  ROOT.addEventListener('click', (e) => {
    const fam = e.target.closest('[data-famille]');
    if (fam) { familleNom = fam.dataset.famille; faceNom = ''; etat = ''; return render(); }
    const face = e.target.closest('[data-face]');
    if (face) { faceNom = face.dataset.face; etat = ''; return render(); }
    const act = e.target.closest('[data-action]');
    if (act) return agir(act.dataset.action);
    return undefined;
  });
}

export async function refreshTaillesLogos() {
  if (!ROOT) return;
  const [recu] = await Promise.all([
    api('GET', '/api/tailles-logo').catch(() => null),
    chargerCatalogue(),
  ]);
  if (recu && Array.isArray(recu.familles)) table = recu;
  etat = '';
  render();
}

let monte = false;
export async function initTaillesLogos(root) {
  if (monte) return;
  ROOT = root;
  monte = true;
  wire();
  await refreshTaillesLogos();
}
