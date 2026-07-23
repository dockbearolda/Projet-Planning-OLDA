// Prise de commande — Atelier OLDA
// Le PREMIER PAS du client : la fiche qu'on remplit au comptoir, EN FACE DE LUI.
// Contrainte de conception : 30 à 45 secondes, montre en main. Tout en découle —
// des blocs numérotés dans l'ordre où ça se dit, des puces à taper plutôt que
// des menus à dérouler, des valeurs par défaut déjà justes, et rien à l'écran
// tant qu'on n'en a pas besoin (les familles de produits restent fermées).
//
// La NATURE (demande / commande) vient de l'entrée de menu cliquée, poussée par
// app.js via setNature() — il n'y a pas de réglage de nature dans la fiche.
//   - Demande  → planning, colonne « Demande » (à chiffrer).
//   - Commande → planning, colonne « Commande » (validée par le client).
//
// Chargé À LA DEMANDE par app.js au premier passage sur la vue ; ensuite la
// bascule entre vues n'est qu'un changement de classe, sans saisie perdue.

// Recherches DOM CONFINÉES à la vue : le document porte aussi les autres écrans.
let ROOT = null;
const $ = (sel) => ROOT.querySelector(sel);
const $$ = (sel) => ROOT.querySelectorAll(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const ic = (name) => {
  const n = el('span', 'material-symbols-outlined', name);
  n.setAttribute('aria-hidden', 'true');
  return n;
};

// Date civile LOCALE : `toISOString()` bascule en UTC et ferait reculer
// l'échéance d'un jour à l'ouest de Greenwich (l'atelier est aux Antilles).
const todayPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let CAT = null;
let CLIENTS = [];
let uid = 0;

// Les trois familles, dans l'ordre de lecture de l'atelier.
const FAMILLES = ['tasse', 'textile', 'objet'];

const state = {
  kind: 'demande',
  client: { type: 'pro', facturation: '', contact: '', whatsapp: '', email: '', prenom: '', nom: '' },
  objet: '',            // objet / note libre : le titre du dossier au planning
  delai: '',            // id du délai tapé ; vide = date choisie à la main
  deadline: '',
  ouvertes: [],         // familles dépliées (dans l'ordre où on les a tapées)
  lignes: { tasse: [], textile: [], objet: [] },
  paiement: { statut: 'non_paye', mode: '' },
  enBoite: false,
  sending: false,
};

// Une ligne restée vierge se ramasse toute seule au bout de ce délai : on ne
// laisse pas des lignes fantômes polluer la fiche entre deux clients.
const LIGNE_TTL = 5 * 60 * 1000;

const zoneById = (id) => CAT.zones.find((z) => z.id === id);
const typeById = (id) => CAT.types.find((t) => t.id === id);
const delaiById = (id) => CAT.delais.find((d) => d.id === id);
const familleById = (id) => CAT.familles.find((f) => f.id === id);

// Une ligne neuve, par famille. Les champs sont TOUS présents dès la création :
// le rendu n'a jamais à se demander si une propriété existe.
function newLigne(famille) {
  uid += 1;
  // `ts` : dernier moment où on a touché la ligne — sert au ramassage des
  // lignes vides restées à l'abandon (voir sweepVides).
  const base = { uid, famille, quantite: 1, ref: '', ts: Date.now() };
  if (famille === 'tasse') {
    return { ...base, couleur: '', face1: '', face2: '', options: [], infos: '', typo: '', remarque: '' };
  }
  if (famille === 'textile') {
    // `tailles` : une quantité par taille (XS…2XL), saisie dans la grille.
    // `note` : la description libre de la ligne, sous la référence.
    // `choix` : la rangée de puces d'emplacements est ouverte. `plus` : elle
    // montre aussi les emplacements rares.
    return { ...base, vetement: '', couleur: '', note: '', tailles: {}, zones: [], choix: false, plus: false };
  }
  return { ...base, technique: '', infos: '' };
}

// Une taille de la grille porte-t-elle au moins une pièce ?
const tailleRemplie = (l) => Object.values(l.tailles).some((v) => Number.parseInt(v, 10) > 0);

const listOf = (famille) => state.lignes[famille];
const byUid = (u) => FAMILLES
  .map((f) => state.lignes[f].find((l) => String(l.uid) === String(u)))
  .find(Boolean);

// Une ligne à laquelle on n'a rien dit : ajoutée d'un tap de trop, elle part en
// silence à l'enregistrement plutôt que de réclamer sa référence.
function ligneVide(l) {
  if (l.famille === 'tasse') {
    return !l.ref.trim() && !l.couleur.trim() && !l.face1.trim() && !l.face2.trim()
      && !l.options.length && !l.infos.trim() && !l.typo.trim() && !l.remarque.trim();
  }
  if (l.famille === 'textile') {
    return !l.vetement.trim() && !l.ref.trim() && !l.couleur.trim()
      && !l.note.trim() && !tailleRemplie(l) && !l.zones.length;
  }
  return !l.ref.trim() && !l.technique && !l.infos.trim();
}

const lignesRemplies = (famille) => listOf(famille).filter((l) => !ligneVide(l));
const toutesLignes = () => FAMILLES.flatMap(lignesRemplies);

// ---------------------------------------------------------------------------
// Ce qui manque pour enregistrer. null = la saisie est complète.
// ---------------------------------------------------------------------------
function nomClient() {
  const c = state.client;
  return c.type === 'perso'
    ? [c.prenom.trim(), c.nom.trim()].filter(Boolean).join(' ')
    : c.facturation.trim();
}

function missing() {
  if (!nomClient()) return state.client.type === 'perso' ? 'le prénom du client' : 'le nom de facturation';
  const lignes = toutesLignes();
  if (!state.objet.trim() && !lignes.length) return 'un objet (ou un produit)';
  for (const l of lignes) {
    if (l.famille === 'tasse' && !l.ref.trim()) return 'la référence d\'une tasse';
    if (l.famille === 'textile' && !l.vetement.trim()) return 'le vêtement d\'une ligne textile';
    if (l.famille === 'objet' && !l.ref.trim()) return 'la référence d\'un objet';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Base clients — auto-complétion sur les clients connus (/api/clients).
// Taper « Igua » propose « Iguana (Discover) » avec son contact et son numéro.
// Un client absent de la base y est créé automatiquement à l'enregistrement.
// Forme d'un client : { entreprise, nom (contact), telephone, email, commandes }.
// ---------------------------------------------------------------------------
const fold = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

let autoIndex = -1;
let autoMatches = [];

// Le champ qui porte la recherche dépend du mode : le nom de facturation pour
// un pro, le prénom pour un particulier.
const autoChamp = () => $(state.client.type === 'perso' ? '#cmd-prenom' : '#cmd-facturation');
const autoListe = () => $(state.client.type === 'perso' ? '#cmd-auto-perso' : '#cmd-auto-pro');

function closeAuto() {
  autoIndex = -1;
  autoMatches = [];
  for (const list of $$('.cmd-auto__list')) {
    list.hidden = true;
    list.replaceChildren();
  }
  for (const champ of [$('#cmd-facturation'), $('#cmd-prenom')]) {
    champ.setAttribute('aria-expanded', 'false');
    champ.removeAttribute('aria-activedescendant');
  }
}

function renderAuto() {
  const list = autoListe();
  const champ = autoChamp();
  list.replaceChildren();
  for (let i = 0; i < autoMatches.length; i += 1) {
    const c = autoMatches[i];
    const li = el('li', `cmd-auto__item${i === autoIndex ? ' is-on' : ''}`);
    li.id = `cmd-auto-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === autoIndex));
    li.dataset.i = i;
    li.append(el('span', 'cmd-auto__name', c.entreprise));
    const meta = [c.nom, c.telephone].filter(Boolean).join(' · ');
    if (meta) li.append(el('span', 'cmd-auto__meta', meta));
    // Compteur de commandes seulement s'il y en a : un client de la base pas
    // encore commandé ne doit pas afficher « 1 commande » à tort.
    if (c.commandes > 0) {
      li.append(el('span', 'cmd-auto__n', c.commandes > 1 ? `${c.commandes} commandes` : '1 commande'));
    }
    list.append(li);
  }
  list.hidden = autoMatches.length === 0;
  champ.setAttribute('aria-expanded', String(autoMatches.length > 0));
  if (autoIndex >= 0) champ.setAttribute('aria-activedescendant', `cmd-auto-${autoIndex}`);
  else champ.removeAttribute('aria-activedescendant');
}

function openAuto(query) {
  const q = fold(query).trim();
  if (!q) return closeAuto();
  // On propose sur le nom de société ET le contact : « Jérôme » retrouve Iguana.
  // Un particulier ne se voit proposer que des particuliers, et l'inverse : au
  // comptoir on ne mélange pas l'annuaire des hôtels et celui des voisins.
  const perso = state.client.type === 'perso';
  autoMatches = CLIENTS
    .filter((c) => (c.client_type === 'perso') === perso)
    .filter((c) => fold(c.entreprise).includes(q) || (c.nom && fold(c.nom).includes(q)))
    .slice(0, 6);
  autoIndex = -1;
  renderAuto();
}

// Reprend une fiche connue : on ne remplit QUE les champs restés vides, pour ne
// jamais écraser ce que la personne vient de taper. Le `type` de la base est une
// catégorie métier (Boutique, Hôtel…) qu'on ne recopie pas.
function pickClient(c) {
  const cl = state.client;
  if (cl.type === 'perso') {
    // La base ne connaît qu'un nom complet : le premier mot fait le prénom.
    const mots = String(c.entreprise).trim().split(/\s+/);
    cl.prenom = mots.shift() || '';
    if (!cl.nom.trim()) cl.nom = mots.join(' ');
    $('#cmd-prenom').value = cl.prenom;
    $('#cmd-nom').value = cl.nom;
    if (!cl.whatsapp.trim() && c.telephone) cl.whatsapp = c.telephone;
    $('#cmd-whatsapp-perso').value = cl.whatsapp;
  } else {
    cl.facturation = c.entreprise;
    if (!cl.contact.trim() && c.nom) cl.contact = c.nom;
    if (!cl.whatsapp.trim() && c.telephone) cl.whatsapp = c.telephone;
    if (!cl.email.trim() && c.email) cl.email = c.email;
    $('#cmd-facturation').value = cl.facturation;
    $('#cmd-contact').value = cl.contact;
    $('#cmd-whatsapp').value = cl.whatsapp;
    $('#cmd-email').value = cl.email;
  }
  closeAuto();
  render();
  // Le client est identifié : la suite, c'est ce qu'il vient chercher.
  $('#cmd-objet').focus();
}

// ---------------------------------------------------------------------------
// Puces — la brique de toute la fiche : un tap, un état visible, 44 px de haut.
// ---------------------------------------------------------------------------
function chip(label, opts) {
  const o = opts || {};
  const b = el('button', `cmd-chip${o.on ? ' is-on' : ''}${o.cls ? ` ${o.cls}` : ''}`);
  b.type = 'button';
  if (o.role) b.dataset.role = o.role;
  if (o.value != null) b.dataset.value = o.value;
  if (o.radio) {
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(!!o.on));
  } else {
    b.setAttribute('aria-pressed', String(!!o.on));
  }
  if (o.icone) b.append(ic(o.icone));
  b.append(el('span', null, label));
  if (o.note) b.append(el('span', 'cmd-chip__note', o.note));
  return b;
}

// ---------------------------------------------------------------------------
// Lignes de produits — reconstruites à chaque changement de STRUCTURE (ajout,
// retrait, zone cochée), jamais pendant la frappe (sinon le curseur saute).
// ---------------------------------------------------------------------------
// Une cellule de tableau. Toujours un `text` : un `number` sort ses flèches au
// survol et refuse la frappe libre — au comptoir on clique et on écrit, comme
// dans un tableur. Le contrôle se fait à la saisie (voir wire()).
function cell(role, l, value, placeholder, label, opts) {
  const n = el('input', `cmd-input cmd-cell cmd-cell--${role}`);
  n.type = 'text';
  n.value = value == null ? '' : value;
  n.placeholder = placeholder || '';
  n.autocomplete = 'off';
  n.dataset.role = role;
  n.dataset.uid = l.uid;
  n.dataset.fam = l.famille;
  n.setAttribute('aria-label', label);
  if (opts && opts.list) n.setAttribute('list', opts.list);
  if (opts && opts.inputmode) n.inputMode = opts.inputmode;
  return n;
}

// En-têtes de colonnes, une fois pour toute la famille : c'est ce qui permet
// aux lignes de n'avoir AUCUN libellé et de tenir sur 44 px de haut. Sous la
// tablette portrait la CSS masque cette rangée — les placeholders prennent le
// relais, d'où leur formulation (« anse à droite : logo… ») qui redit la
// convention plutôt qu'un simple exemple.
const THEADS = {
  tasse: ['Qté', 'Référence tasse', 'Coloris', 'Face 1 (anse à droite)', 'Face 2 (anse à gauche)', ''],
  textile: ['Vêtement', 'Réf. OLDA / fournisseur', 'Coloris', ''],
  objet: ['Qté', 'Référence objet', 'Personnalisation', ''],
};

function outils(l, index) {
  const tools = el('div', 'cmd-art__tools');
  const dup = el('button', 'cmd-icon');
  dup.type = 'button';
  dup.dataset.role = 'dup';
  dup.title = 'Dupliquer';
  dup.setAttribute('aria-label', `Dupliquer la ligne ${index + 1}`);
  dup.append(ic('content_copy'));
  tools.append(dup);
  // La dernière ligne ne se supprime pas : elle se vide, et disparaît à l'envoi.
  if (listOf(l.famille).length > 1) {
    const del = el('button', 'cmd-icon cmd-icon--danger');
    del.type = 'button';
    del.dataset.role = 'del';
    del.title = 'Retirer';
    del.setAttribute('aria-label', `Retirer la ligne ${index + 1}`);
    del.append(ic('close'));
    tools.append(del);
  }
  return tools;
}

// --------------------------------------------------------------------- tasse
// Deux rangées : ce qu'on dit toujours (combien, quoi, les deux faces), puis
// ce qu'on précise parfois (options, typo, infos, remarques). La convention
// d'anse vit dans l'en-tête ET dans le placeholder : c'est elle qui évite
// d'imprimer le visuel du mauvais côté.
function buildTasse(l, index) {
  const art = el('div', 'cmd-art');
  art.dataset.uid = l.uid;

  const row = el('div', 'cmd-art__row cmd-art__row--tasse');
  row.append(
    cell('quantite', l, l.quantite, '1', `Quantité, tasse ${index + 1}`, { inputmode: 'numeric' }),
    cell('ref', l, l.ref, 'Tasse blanche 33 cl', `Référence, tasse ${index + 1}`, { list: 'cmd-dl-tasses' }),
    cell('couleur', l, l.couleur, 'Blanc', `Coloris, tasse ${index + 1}`),
    cell('face1', l, l.face1, 'anse à droite : logo…', `Face 1, anse à droite, tasse ${index + 1}`),
    cell('face2', l, l.face2, 'anse à gauche : texte…', `Face 2, anse à gauche, tasse ${index + 1}`),
    outils(l, index),
  );
  art.append(row);

  const bas = el('div', 'cmd-art__bas');
  const opts = el('div', 'cmd-chips cmd-chips--opt');
  for (const o of CAT.tasseOptions) {
    opts.append(chip(o.label, { on: l.options.includes(o.id), role: 'tasse-opt', value: o.id }));
  }
  bas.append(
    opts,
    cell('typo', l, l.typo, 'Typo (Bebas Neue…)', `Typo, tasse ${index + 1}`, { list: 'cmd-dl-typos' }),
    cell('infos', l, l.infos, 'Infos perso (centré, 8 cm…)', `Informations de personnalisation, tasse ${index + 1}`),
    cell('remarque', l, l.remarque, 'Remarques', `Remarques, tasse ${index + 1}`),
  );
  art.append(bas);
  return art;
}

// ------------------------------------------------------------------- textile
// Le vêtement, puis DEUX choses sous sa référence : une description libre, et
// une GRILLE DE TAILLES (XS…2XL) où l'on inscrit la quantité par taille. La
// quantité de la ligne se déduit de la grille — on ne redemande pas un « Qté ».
function buildTextile(l, index) {
  const art = el('div', 'cmd-art');
  art.dataset.uid = l.uid;

  const row = el('div', 'cmd-art__row cmd-art__row--textile');
  row.append(
    cell('vetement', l, l.vetement, 'T-shirt sans manches', `Vêtement, ligne ${index + 1}`, { list: 'cmd-dl-vetements' }),
    cell('ref', l, l.ref, 'K3022', `Référence, ligne ${index + 1}`),
    cell('couleur', l, l.couleur, 'Light Sand', `Coloris, ligne ${index + 1}`),
    outils(l, index),
  );
  art.append(row);

  // Description de la ligne, juste sous la référence.
  const desc = el('div', 'cmd-art__desc');
  desc.append(cell('note', l, l.note, 'Description : col rond, coupe large, remarques…', `Description, ligne ${index + 1}`));
  art.append(desc);

  // Grille des tailles : une petite case chiffrable par taille.
  const grille = el('div', 'cmd-sizes');
  grille.setAttribute('role', 'group');
  grille.setAttribute('aria-label', `Tailles, ligne ${index + 1}`);
  for (const t of CAT.taillesGrille) {
    const box = el('label', 'cmd-size');
    box.append(el('span', 'cmd-size__lab', t));
    const inp = el('input', 'cmd-input cmd-size__in');
    inp.type = 'text';
    inp.inputMode = 'numeric';
    inp.autocomplete = 'off';
    inp.placeholder = '0';
    inp.value = l.tailles[t] || '';
    inp.dataset.role = 'taille-qty';
    inp.dataset.uid = l.uid;
    inp.dataset.fam = 'textile';
    inp.dataset.size = t;
    inp.setAttribute('aria-label', `Quantité taille ${t}, ligne ${index + 1}`);
    box.append(inp);
    grille.append(box);
  }
  art.append(grille);

  // Placements. Un emplacement CHOISI n'a plus besoin de sa puce : il prend sa
  // ligne, avec sa consigne. Les puces ne s'affichent donc que pendant le
  // choix — sinon elles mangeraient deux rangées par article, pour rien.
  const mark = el('div', 'cmd-art__mark');

  let derniere = null;
  for (const z of l.zones) {
    const zone = zoneById(z.zone);
    if (!zone) continue;                 // emplacement retiré entre-temps
    const line = el('div', 'cmd-zline');
    derniere = line;
    const tag = el('button', 'cmd-ztag');
    tag.type = 'button';
    tag.dataset.role = 'zone-off';
    tag.dataset.value = z.zone;
    tag.title = `Retirer ${zone.label}`;
    tag.setAttribute('aria-label', `Retirer l'emplacement ${zone.label}`);
    tag.append(el('span', null, zone.label), ic('close'));
    line.append(tag);
    const cons = el('input', 'cmd-input cmd-zline__cons');
    cons.type = 'text';
    cons.dataset.role = 'consigne';
    cons.dataset.uid = l.uid;
    cons.dataset.fam = 'textile';
    cons.dataset.zone = z.zone;
    cons.maxLength = CAT.consigneMax;
    cons.autocomplete = 'off';
    cons.setAttribute('aria-label', `Consigne pour ${zone.label}, ligne ${index + 1}`);
    cons.placeholder = zone.id === 'coeur' ? 'Les Doudous à SXM' : 'visuel, texte, taille…';
    cons.value = z.consigne;
    line.append(cons);
    mark.append(line);
  }

  const pose = (z) => l.zones.some((x) => x.zone === z.id);
  const secondaires = CAT.zones.filter((z) => !z.principal);
  if (!l.zones.length || l.choix) {
    const chips = el('div', 'cmd-chips');
    const deplie = l.plus || secondaires.some(pose);
    const visibles = deplie ? CAT.zones : CAT.zones.filter((z) => z.principal);
    for (const z of visibles) {
      if (pose(z)) continue;             // déjà posé : il a sa ligne au-dessus
      // Libellé COURT sur la puce (« Manche Dr ») pour que les six emplacements
      // courants tiennent sur une rangée ; la fiche garde le nom entier.
      const b = chip(z.court || z.label, { role: 'zone', value: z.id });
      // Un emplacement ajouté au comptoir se retire (faute de frappe) ; ceux du
      // catalogue, jamais. Les commandes enregistrées gardent leur marquage.
      if (z.custom) {
        const x = el('span', 'cmd-chip__x material-symbols-outlined', 'close');
        x.dataset.zone = z.id;
        x.title = `Retirer l'emplacement « ${z.label} »`;
        x.setAttribute('aria-hidden', 'true');
        b.append(x);
      }
      chips.append(b);
    }
    if (!deplie && secondaires.length) {
      const plus = chip(String(secondaires.length), { role: 'zone-plus', cls: 'cmd-chip--ghost cmd-chip--plus', icone: 'add' });
      plus.title = `${secondaires.length} autres emplacements`;
      plus.setAttribute('aria-label', `Afficher les ${secondaires.length} autres emplacements`);
      chips.append(plus);
    } else {
      // Le catalogue ne peut pas tout prévoir : on crée l'emplacement manquant
      // sur place, il rejoint la liste de tous les postes.
      const add = chip('Emplacement', { role: 'zone-add', cls: 'cmd-chip--add', icone: 'add' });
      add.setAttribute('aria-label', `Ajouter un emplacement, ligne ${index + 1}`);
      chips.append(add);
    }
    mark.append(chips);
  } else if (derniere) {
    // Le « + » se loge EN BOUT de la dernière consigne : un deuxième placement
    // ne coûte pas une rangée de plus tant qu'on ne l'a pas demandé.
    const rouvrir = el('button', 'cmd-icon cmd-icon--sm cmd-zline__add');
    rouvrir.type = 'button';
    rouvrir.dataset.role = 'zone-choix';
    rouvrir.title = 'Ajouter un placement';
    rouvrir.setAttribute('aria-label', `Ajouter un placement, ligne ${index + 1}`);
    rouvrir.append(ic('add'));
    derniere.append(rouvrir);
  }

  art.append(mark);
  return art;
}

// --------------------------------------------------------------------- objet
// Une seule rangée : ce qui compte à l'atelier, c'est par quelle MACHINE ça
// passe. Les trois puces vivent dans la ligne, à côté de la consigne.
function buildObjet(l, index) {
  const art = el('div', 'cmd-art');
  art.dataset.uid = l.uid;

  const perso = el('div', 'cmd-objperso');
  const techs = el('div', 'cmd-chips');
  techs.setAttribute('role', 'radiogroup');
  techs.setAttribute('aria-label', `Type de personnalisation, objet ${index + 1}`);
  for (const t of CAT.objetTechniques) {
    techs.append(chip(t.label, { on: l.technique === t.id, role: 'obj-tech', value: t.id, radio: true }));
  }
  perso.append(
    techs,
    cell('infos', l, l.infos, 'gravure logo 5 cm, prénom…', `Info sur la personnalisation, objet ${index + 1}`),
  );

  const row = el('div', 'cmd-art__row cmd-art__row--objet');
  row.append(
    cell('quantite', l, l.quantite, '1', `Quantité, objet ${index + 1}`, { inputmode: 'numeric' }),
    cell('ref', l, l.ref, 'Gourde inox', `Référence, objet ${index + 1}`, { list: 'cmd-dl-objets' }),
    perso,
    outils(l, index),
  );
  art.append(row);
  return art;
}

const BUILDERS = { tasse: buildTasse, textile: buildTextile, objet: buildObjet };

// ---------------------------------------------------------------------------
// Les familles ouvertes : chacune son bloc, ses lignes, son bouton d'ajout.
// ---------------------------------------------------------------------------
// Un bloc de famille = UNE carte. Le titre vit DANS la carte, sur la rangée des
// noms de colonnes : deux objets flottants côte à côte se lisaient comme du
// désordre, un seul se lit comme un tableau.
function buildFamille(id) {
  const f = familleById(id);
  const box = el('section', 'cmd-fam');
  box.dataset.fam = id;

  // Bandeau de la famille : son nom, son bouton d'ajout, sa fermeture. En le
  // mettant EN HAUT plutôt qu'un « + Ajouter » pleine largeur en bas, on
  // économise une rangée par famille et on supprime un trait de plus.
  const head = el('div', 'cmd-fam__head');
  head.append(ic(f.icone), el('h4', 'cmd-fam__title', f.label));

  const add = el('button', 'cmd-fam__add');
  add.type = 'button';
  add.dataset.role = 'add-ligne';
  add.dataset.fam = id;
  add.append(ic('add'), el('span', null, id === 'objet' ? 'Objet' : id === 'tasse' ? 'Tasse' : 'Ligne'));
  add.title = `Ajouter ${id === 'objet' ? 'un objet' : id === 'tasse' ? 'une tasse' : 'une ligne'}`;
  head.append(add);

  const close = el('button', 'cmd-icon cmd-icon--sm');
  close.type = 'button';
  close.dataset.role = 'fam-close';
  close.dataset.fam = id;
  close.title = `Retirer le bloc ${f.label}`;
  close.setAttribute('aria-label', `Retirer le bloc ${f.label}`);
  close.append(ic('close'));
  head.append(close);
  box.append(head);

  const thead = el('div', `cmd-thead cmd-thead--${id}`);
  thead.setAttribute('aria-hidden', 'true');
  thead.append(...THEADS[id].map((t) => el('span', null, t)));
  box.append(thead);

  const lignes = el('div', 'cmd-arts');
  lignes.append(...listOf(id).map((l, i) => BUILDERS[id](l, i)));
  box.append(lignes);
  return box;
}

// Panneau vide : plutôt qu'un trou, on dit ce qui se passe si on ne touche à
// rien — la fiche part quand même, avec son seul objet.
function buildVide() {
  const box = el('div', 'cmd-vide');
  box.append(
    ic('inventory_2'),
    el('p', 'cmd-vide__t', 'Aucun produit détaillé'),
    el('p', 'cmd-vide__s', 'Tapez une famille ci-dessus pour détailler. Sinon l\'objet / note en haut suffit : la fiche part telle quelle.'),
  );
  return box;
}

function renderFams() {
  const box = $('#cmd-fams');
  box.classList.toggle('is-vide', state.ouvertes.length === 0);
  if (!state.ouvertes.length) return box.replaceChildren(buildVide());
  box.replaceChildren(...state.ouvertes.map(buildFamille));
}

// Pose le curseur sur la première cellule d'une ligne : on enchaîne la frappe
// sans repasser par la souris.
function focusLigne(l) {
  const c = ROOT.querySelector(`.cmd-art[data-uid="${l.uid}"] .cmd-cell--${l.famille === 'textile' ? 'vetement' : 'ref'}`);
  if (c) { c.focus(); c.select(); }
}

// ---------------------------------------------------------------------------
// Emplacements d'impression — le catalogue de base, plus ceux ajoutés ici.
// Tout est OPTIMISTE : la zone s'affiche et se coche tout de suite, le serveur
// suit. S'il refuse, on la retire et on le dit.
// ---------------------------------------------------------------------------
// Même règle d'identifiant que le serveur (db.js) : « Avant gauche » → avant_gauche.
const zoneSlug = (s) => fold(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Ordre du catalogue : Cœur avant Dos, quel que soit l'ordre des clics.
const sortZones = (l) => l.zones.sort(
  (x, y) => CAT.zones.findIndex((z) => z.id === x.zone) - CAT.zones.findIndex((z) => z.id === y.zone),
);

function toggleZone(l, id) {
  const i = l.zones.findIndex((z) => z.zone === id);
  if (i >= 0) l.zones.splice(i, 1);
  else l.zones.push({ zone: id, consigne: '' });
  sortZones(l);
}

// Pose le curseur sur la consigne de la zone qu'on vient de cocher : on tape
// le visuel dans la foulée, sans repasser par la souris.
function focusConsigne(l, id) {
  const line = ROOT.querySelector(`.cmd-art[data-uid="${l.uid}"] .cmd-zline__cons[data-zone="${id}"]`);
  if (line) line.focus();
}

// Remplace un identifiant de zone par un autre dans TOUTES les lignes : sert à
// se raccrocher à l'identifiant que le serveur a tranché.
function remapZone(from, to) {
  for (const l of state.lignes.textile) {
    for (const z of l.zones) if (z.zone === from) z.zone = to;
    // Un doublon peut apparaître si la zone visée était déjà posée.
    l.zones = l.zones.filter((z, i) => l.zones.findIndex((y) => y.zone === z.zone) === i);
    sortZones(l);
  }
}

async function addZone(label, l) {
  const clean = String(label || '').trim().slice(0, 40);
  const id = zoneSlug(clean);
  if (!clean || !id) return;

  // Zone déjà là ? On la rapproche par identifiant ET par libellé, comme le
  // serveur : retaper « Avant gauche » coche la zone du catalogue.
  const known = CAT.zones.find((z) => z.id === id || zoneSlug(z.label) === id);
  if (known) {
    if (!l.zones.some((z) => z.zone === known.id)) toggleZone(l, known.id);
    l.choix = false;
    renderFams();
    return focusConsigne(l, known.id);
  }

  CAT.zones = [...CAT.zones, { id, label: clean, custom: true }];
  toggleZone(l, id);
  l.choix = false;
  renderFams();
  focusConsigne(l, id);

  try {
    const res = await fetch('/api/commande/zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: clean }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.zone) throw new Error(data.error || `Erreur ${res.status}`);
    CAT.zones = data.zones;              // la base fait foi
    if (data.zone.id !== id) {
      remapZone(id, data.zone.id);
      renderFams();
      focusConsigne(l, data.zone.id);
    }
  } catch (err) {
    CAT.zones = CAT.zones.filter((z) => z.id !== id);
    for (const art of state.lignes.textile) {
      const i = art.zones.findIndex((z) => z.zone === id);
      if (i >= 0) art.zones.splice(i, 1);
    }
    renderFams();
    toast(`« ${clean} » non enregistré — réessayez.`);
  }
}

async function removeZone(id) {
  const before = CAT.zones;
  const beforeLignes = state.lignes.textile.map((l) => l.zones.map((z) => ({ ...z })));
  CAT.zones = CAT.zones.filter((z) => z.id !== id);
  for (const l of state.lignes.textile) {
    const i = l.zones.findIndex((z) => z.zone === id);
    if (i >= 0) l.zones.splice(i, 1);
  }
  renderFams();

  try {
    const res = await fetch(`/api/commande/zones/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    CAT.zones = data.zones;
  } catch (err) {
    CAT.zones = before;
    state.lignes.textile.forEach((l, i) => { l.zones = beforeLignes[i]; });
    renderFams();
    toast('Emplacement non retiré — réessayez.');
  }
}

// Saisie du nom : la puce « + Emplacement » devient un champ, sur place.
// Entrée valide, Échap (ou la perte du focus) annule.
function openZoneInput(btn, l) {
  const input = el('input', 'cmd-input cmd-chip cmd-chip--new');
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = 'Nom de l\'emplacement';
  input.setAttribute('aria-label', 'Nom du nouvel emplacement');
  input.autocomplete = 'off';
  btn.replaceWith(input);
  input.focus();

  const close = () => { if (input.isConnected) input.replaceWith(btn); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addZone(input.value, l); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

// ---------------------------------------------------------------------------
// Rendu (hors lignes : ne touche à aucun champ en cours de frappe)
// ---------------------------------------------------------------------------
function render() {
  const t = typeById(state.kind);
  $('#cmd-title').textContent = t.label;
  $('#cmd-sub').textContent = t.hint;

  // Contact : pro ou perso, jamais les deux.
  const perso = state.client.type === 'perso';
  for (const b of $$('#cmd-nature .cmd-seg__btn')) {
    const on = b.dataset.nature === state.client.type;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }
  $('#cmd-pro').hidden = perso;
  $('#cmd-perso').hidden = !perso;

  // Délais : la puce tapée, ou aucune si la date a été choisie à la main.
  for (const b of $$('#cmd-delais .cmd-chip')) {
    const on = b.dataset.value === state.delai;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }

  // Familles : la puce est allumée quand son bloc est ouvert.
  for (const b of $$('#cmd-familles .cmd-chip')) {
    const on = state.ouvertes.includes(b.dataset.value);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  }

  // Paiement : le mode n'a de sens qu'une fois quelque chose encaissé.
  for (const b of $$('#cmd-pay-statut .cmd-chip')) {
    const on = b.dataset.value === state.paiement.statut;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }
  const encaisse = state.paiement.statut !== 'non_paye';
  $('#cmd-pay-mode').hidden = !encaisse;
  for (const b of $$('#cmd-pay-mode .cmd-chip')) {
    const on = encaisse && b.dataset.value === state.paiement.mode;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }

  $('#cmd-boite').setAttribute('aria-checked', String(state.enBoite));
  $('#cmd-boite').classList.toggle('is-on', state.enBoite);

  const nom = nomClient();
  const known = nom && CLIENTS.find((c) => fold(c.entreprise) === fold(nom));
  const badge = $('#cmd-client-known');
  const n = known ? (known.commandes || 0) : 0;
  badge.textContent = known
    ? (n > 0 ? `Client connu — ${n} commande${n > 1 ? 's' : ''} au planning` : 'Client connu — déjà dans la base')
    : '';
  badge.hidden = !known;

  const need = missing();
  const save = $('#cmd-save');
  save.disabled = state.sending;
  save.textContent = state.sending ? 'Enregistrement…' : `Enregistrer la ${t.label.toLowerCase()}`;
  save.title = need ? `Il manque ${need}` : 'Enregistrer et envoyer au planning';
}

let toastTimer;
function toast(msg) {
  const t = $('#cmd-toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3400);
}

// ---------------------------------------------------------------------------
// Construction statique
// ---------------------------------------------------------------------------
function buildStatic() {
  $('#cmd-dl-vetements').replaceChildren(...CAT.vetements.map((v) => new Option(v)));
  $('#cmd-dl-tailles').replaceChildren(...CAT.tailles.map((t) => new Option(t)));
  $('#cmd-dl-tasses').replaceChildren(...CAT.tasses.map((t) => new Option(t)));
  $('#cmd-dl-objets').replaceChildren(...CAT.objets.map((o) => new Option(o)));
  $('#cmd-dl-typos').replaceChildren(...CAT.typos.map((t) => new Option(t)));

  $('#cmd-delais').replaceChildren(...CAT.delais.map((d) => chip(d.label, {
    role: 'delai', value: d.id, radio: true, note: d.note,
  })));
  $('#cmd-familles').replaceChildren(...CAT.familles.map((f) => chip(f.label, {
    role: 'famille', value: f.id, icone: f.icone, cls: 'cmd-chip--fam',
  })));
  $('#cmd-pay-statut').replaceChildren(...CAT.paiementStatuts.map((p) => chip(p.label, {
    role: 'pay-statut', value: p.id, radio: true,
  })));
  $('#cmd-pay-mode').replaceChildren(...CAT.paiementModes.map((p) => chip(p.label, {
    role: 'pay-mode', value: p.id, radio: true,
  })));

  setDelai(CAT.delaiDefaut);
}

// Le délai tapé pose l'échéance ; la date reste modifiable pour un jour précis.
function setDelai(id) {
  const d = delaiById(id);
  if (!d) return;
  state.delai = d.id;
  state.deadline = todayPlus(d.jours);
  $('#cmd-deadline').value = state.deadline;
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
function wire() {
  ROOT.addEventListener('click', (e) => {
    const auto = e.target.closest('.cmd-auto__item');
    if (auto) return pickClient(autoMatches[Number(auto.dataset.i)]);

    // La croix d'un emplacement ajouté : elle vit DANS la puce, on la traite
    // avant le clic de la puce (qui, lui, coche / décoche).
    const x = e.target.closest('.cmd-chip__x');
    if (x) return removeZone(x.dataset.zone);

    const t = e.target.closest('button');
    if (!t) return closeAuto();
    const role = t.dataset.role;

    if (t.dataset.nature) return setNatureClient(t.dataset.nature);
    if (role === 'delai') { setDelai(t.dataset.value); return render(); }
    if (role === 'famille') return toggleFamille(t.dataset.value);
    if (role === 'fam-close') return removeFamille(t.dataset.fam);
    if (role === 'pay-statut') {
      state.paiement.statut = t.dataset.value;
      if (state.paiement.statut === 'non_paye') state.paiement.mode = '';
      return render();
    }
    if (role === 'pay-mode') {
      state.paiement.mode = state.paiement.mode === t.dataset.value ? '' : t.dataset.value;
      return render();
    }
    if (t.id === 'cmd-boite') { state.enBoite = !state.enBoite; return render(); }
    if (role === 'add-ligne') {
      const l = newLigne(t.dataset.fam);
      listOf(t.dataset.fam).push(l);
      renderFams();
      render();
      return focusLigne(l);
    }
    if (t.id === 'cmd-save') return submit();
    if (t.id === 'cmd-done-new') return reset();

    const host = t.closest('.cmd-art');
    if (!host) return;
    const l = byUid(host.dataset.uid);
    if (!l) return;

    if (role === 'del') {
      state.lignes[l.famille] = listOf(l.famille).filter((x) => x.uid !== l.uid);
      renderFams();
      return render();
    }
    if (role === 'dup') {
      // Le cas courant du comptoir : même marquage, autres tailles / couleur.
      // Les tableaux et objets sont recopiés, sinon les deux lignes les partagent.
      uid += 1;
      const copy = { ...l, uid, ts: Date.now() };
      if (l.zones) copy.zones = l.zones.map((z) => ({ ...z }));
      if (l.options) copy.options = [...l.options];
      if (l.tailles) copy.tailles = { ...l.tailles };
      const list = listOf(l.famille);
      list.splice(list.indexOf(l) + 1, 0, copy);
      renderFams();
      render();
      return focusLigne(copy);
    }
    if (role === 'tasse-opt') {
      const i = l.options.indexOf(t.dataset.value);
      if (i >= 0) l.options.splice(i, 1); else l.options.push(t.dataset.value);
      t.classList.toggle('is-on', i < 0);
      t.setAttribute('aria-pressed', String(i < 0));
      return render();
    }
    if (role === 'obj-tech') {
      l.technique = l.technique === t.dataset.value ? '' : t.dataset.value;
      renderFams();
      return render();
    }
    if (role === 'zone-plus') { l.plus = true; return renderFams(); }
    if (role === 'zone-choix') { l.choix = true; return renderFams(); }
    if (role === 'zone-add') return openZoneInput(t, l);
    if (role === 'zone-off') {
      toggleZone(l, t.dataset.value);
      renderFams();
      return render();
    }
    if (role === 'zone') {
      const id = t.dataset.value;
      toggleZone(l, id);
      // Choisi = rangé : les puces se referment et on enchaîne sur la consigne.
      // Un second placement se rouvre d'un tap sur « + Placement ».
      l.choix = false;
      renderFams();
      focusConsigne(l, id);
      return render();
    }
  });

  ROOT.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'cmd-facturation') {
      state.client.facturation = t.value;
      openAuto(t.value);
      return render();
    }
    if (t.id === 'cmd-prenom') {
      state.client.prenom = t.value;
      openAuto(t.value);
      return render();
    }
    if (t.id === 'cmd-nom') { state.client.nom = t.value; return render(); }
    if (t.id === 'cmd-contact') { state.client.contact = t.value; return; }
    if (t.id === 'cmd-whatsapp' || t.id === 'cmd-whatsapp-perso') { state.client.whatsapp = t.value; return; }
    if (t.id === 'cmd-email') { state.client.email = t.value; return; }
    if (t.id === 'cmd-objet') { state.objet = t.value; return render(); }
    // Une date posée à la main l'emporte : plus aucune puce de délai allumée.
    if (t.id === 'cmd-deadline') { state.deadline = t.value; state.delai = ''; return render(); }

    const l = t.dataset.uid ? byUid(t.dataset.uid) : null;
    if (!l) return;
    l.ts = Date.now();                    // la ligne vient d'être touchée : elle ne sera pas ramassée
    if (t.dataset.role === 'quantite') {
      // Champ texte : on filtre les chiffres à la frappe (pas de flèches, pas
      // de « e » ni de moins). On ne réécrit la valeur QUE si elle change,
      // sinon le curseur saute en fin de champ à chaque touche.
      const digits = t.value.replace(/\D+/g, '').replace(/^0+(?=\d)/, '').slice(0, 4);
      if (digits !== t.value) t.value = digits;
      const n = Number.parseInt(digits, 10);
      l.quantite = Number.isInteger(n) && n > 0 ? n : 1;
      return;
    }
    if (t.dataset.role === 'taille-qty') {
      // Quantité d'une taille de la grille : on filtre les chiffres. Vide = 0
      // (la taille ne part pas). Pas de re-rendu à la frappe (le curseur saute).
      const digits = t.value.replace(/\D+/g, '').replace(/^0+(?=\d)/, '').slice(0, 4);
      if (digits !== t.value) t.value = digits;
      if (digits) l.tailles[t.dataset.size] = digits;
      else delete l.tailles[t.dataset.size];
      return;
    }
    if (t.dataset.role === 'consigne') {
      const z = l.zones.find((x) => x.zone === t.dataset.zone);
      if (z) z.consigne = t.value;
      return;
    }
    const champs = ['vetement', 'ref', 'couleur', 'note', 'face1', 'face2', 'infos', 'typo', 'remarque'];
    if (champs.includes(t.dataset.role)) {
      l[t.dataset.role] = t.value;
      // Ces champs (dé)verrouillent « Enregistrer » : ils portent l'identité
      // de la ligne, ou la font passer de « vide » à « à compléter ».
      if (['vetement', 'ref'].includes(t.dataset.role)) render();
    }
  });

  // Auto-complétion au clavier : la liste se parcourt sans lâcher le champ.
  for (const champ of [$('#cmd-facturation'), $('#cmd-prenom')]) {
    champ.addEventListener('keydown', (e) => {
      if (!autoMatches.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        autoIndex += e.key === 'ArrowDown' ? 1 : -1;
        if (autoIndex >= autoMatches.length) autoIndex = 0;
        if (autoIndex < 0) autoIndex = autoMatches.length - 1;
        return renderAuto();
      }
      if (e.key === 'Enter' && autoIndex >= 0) { e.preventDefault(); return pickClient(autoMatches[autoIndex]); }
      if (e.key === 'Escape') return closeAuto();
    });
    champ.addEventListener('blur', () => setTimeout(closeAuto, 120));
  }
  // Le `blur` part au mousedown, le `click` de sélection au mouseup : on empêche
  // le champ de perdre le focus sur la liste plutôt que de courir après un délai.
  for (const list of $$('.cmd-auto__list')) {
    list.addEventListener('mousedown', (e) => e.preventDefault());
  }

  // Échap ferme la confirmation en repartant sur une saisie vierge.
  ROOT.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#cmd-done').hidden) reset();
  });

  wireCells();
}

// Bascule pro / perso : les deux jeux de champs partagent le WhatsApp (au
// comptoir on tape le numéro avant de savoir si on facture une société).
function setNatureClient(nature) {
  if (state.client.type === nature) return;
  state.client.type = nature;
  closeAuto();
  $('#cmd-whatsapp').value = state.client.whatsapp;
  $('#cmd-whatsapp-perso').value = state.client.whatsapp;
  render();
  const champ = autoChamp();
  champ.focus();
}

// Une famille se déplie d'un tap, avec sa première ligne déjà prête.
// RE-CLIC : on ne détruit JAMAIS ce qui est déjà saisi. Une famille encore
// vierge se referme (elle ne servait à rien) ; une famille qui contient quelque
// chose reste ouverte — pour la retirer volontairement, la croix du bloc.
function toggleFamille(id) {
  if (state.ouvertes.includes(id)) {
    if (lignesRemplies(id).length) return;   // des lignes remplies : re-clic sans effet
    state.ouvertes = state.ouvertes.filter((f) => f !== id);
    state.lignes[id] = [];
    renderFams();
    return render();
  }
  state.ouvertes = FAMILLES.filter((f) => f === id || state.ouvertes.includes(f));
  if (!listOf(id).length) state.lignes[id] = [newLigne(id)];
  renderFams();
  render();
  focusLigne(listOf(id)[0]);
}

// Retrait VOLONTAIRE d'un bloc (la croix de son bandeau). Si des lignes sont
// remplies, on confirme : c'est le seul chemin qui jette des données, et il ne
// doit jamais partir d'un tap malheureux.
function removeFamille(id) {
  if (lignesRemplies(id).length
      && !window.confirm(`Retirer le bloc ${familleById(id).label} et ses lignes ?`)) {
    return;
  }
  state.ouvertes = state.ouvertes.filter((f) => f !== id);
  state.lignes[id] = [];
  renderFams();
  render();
}

// Ramasse les lignes restées vierges trop longtemps (voir LIGNE_TTL) : on évite
// qu'un tap de trop ou une hésitation laissent traîner des lignes fantômes. On
// ne balaie pas pendant une frappe (on ne vole pas le focus), et une famille
// ouverte garde toujours au moins une ligne pour rester utilisable.
function sweepVides() {
  const a = document.activeElement;
  if (a && ROOT.contains(a) && a.tagName === 'INPUT') return;
  const now = Date.now();
  let changed = false;
  for (const fam of FAMILLES) {
    if (!state.ouvertes.includes(fam)) continue;
    const list = state.lignes[fam];
    const kept = list.filter((l) => !(ligneVide(l) && now - (l.ts || now) > LIGNE_TTL));
    if (kept.length === list.length) continue;
    if (!kept.length) {
      // Tout était vide : on garde une seule ligne neuve, prête à servir.
      kept.push(newLigne(fam));
    }
    state.lignes[fam] = kept;
    changed = true;
  }
  if (changed) { renderFams(); render(); }
}

// ---------------------------------------------------------------------------
// Les tableaux se tiennent au clavier comme un tableur : on clique, la cellule
// est sélectionnée, on écrit par-dessus. ↑ / ↓ passent d'une ligne à l'autre
// PARMI CELLES QUI EXISTENT — jamais de création automatique. ENTRÉE ne fait que
// valider la saisie (elle sort du champ) : pour une ligne de plus, « + Ligne ».
// Tab reste le déplacement natif d'une colonne à l'autre.
// ---------------------------------------------------------------------------
function cellAt(ligne, role) {
  return ROOT.querySelector(`.cmd-art[data-uid="${ligne.uid}"] .cmd-cell--${role}`);
}

function moveCell(from, step) {
  const role = from.dataset.role;
  const list = listOf(from.dataset.fam);
  if (!list) return;
  const i = list.findIndex((l) => String(l.uid) === String(from.dataset.uid));
  if (i < 0) return;
  const j = i + step;
  if (j < 0 || j >= list.length) return;   // on ne déborde pas, on ne crée rien
  const next = cellAt(list[j], role);
  if (next) { next.focus(); next.select(); }
}

function wireCells() {
  // Le focus sélectionne la cellule entière ; encore faut-il que le clic ne la
  // désélectionne pas juste après. On annule donc le `mouseup` — SAUF si la
  // cellule était déjà active (deuxième clic : on vise un endroit précis) ou si
  // le pointeur a glissé (l'utilisateur sélectionne un morceau à la main).
  let reclick = false;
  let downAt = null;
  ROOT.addEventListener('pointerdown', (e) => {
    const c = e.target.closest && e.target.closest('.cmd-cell');
    reclick = !!c && document.activeElement === c;
    downAt = c ? { x: e.clientX, y: e.clientY } : null;
  });
  ROOT.addEventListener('mouseup', (e) => {
    const c = e.target.closest && e.target.closest('.cmd-cell');
    if (!c || reclick || !downAt) return;
    const glisse = Math.abs(e.clientX - downAt.x) > 4 || Math.abs(e.clientY - downAt.y) > 4;
    if (!glisse) e.preventDefault();
  });
  ROOT.addEventListener('focusin', (e) => {
    if (e.target.classList && e.target.classList.contains('cmd-cell')) e.target.select();
  });
  // Quantité vidée puis quittée : on réaffiche celle qui fait foi (jamais de
  // case vide dans une commande).
  ROOT.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!t.dataset || t.dataset.role !== 'quantite' || t.value !== '') return;
    const l = byUid(t.dataset.uid);
    if (l) t.value = l.quantite;
  });

  ROOT.addEventListener('keydown', (e) => {
    const c = e.target.closest && e.target.closest('.cmd-cell');
    if (!c) return;
    // Entrée = « je valide ce que je viens de taper » : on sort du champ, sans
    // créer de ligne. Les flèches naviguent entre lignes existantes.
    if (e.key === 'Enter') { e.preventDefault(); c.blur(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveCell(c, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveCell(c, -1); }
    else if (e.key === 'Escape') c.blur();
  });
}

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------
// Ce que le serveur attend, à partir de l'état de la fiche. Les lignes restées
// vides ne partent pas : un tap de trop sur « Ajouter » ne doit rien réclamer.
function payload() {
  const c = state.client;
  const client = c.type === 'perso'
    ? { type: 'perso', prenom: c.prenom, nom: c.nom, whatsapp: c.whatsapp }
    : { type: 'pro', facturation: c.facturation, contact: c.contact, whatsapp: c.whatsapp, email: c.email };

  const net = (l) => {
    if (l.famille === 'tasse') {
      return {
        ref: l.ref, couleur: l.couleur, quantite: l.quantite,
        face1: l.face1, face2: l.face2, options: l.options,
        infos: l.infos, typo: l.typo, remarque: l.remarque,
      };
    }
    if (l.famille === 'textile') {
      // La grille : une entrée par taille effectivement chiffrée (> 0).
      const tailles = CAT.taillesGrille
        .map((t) => ({ taille: t, quantite: Number.parseInt(l.tailles[t], 10) || 0 }))
        .filter((t) => t.quantite > 0);
      return {
        vetement: l.vetement, ref: l.ref, couleur: l.couleur, note: l.note,
        tailles,
        zones: l.zones.map((z) => ({ zone: z.zone, consigne: z.consigne })),
      };
    }
    return { ref: l.ref, quantite: l.quantite, technique: l.technique, infos: l.infos };
  };

  return {
    kind: state.kind,
    client,
    objet: state.objet,
    delai: state.delai,
    deadline: state.deadline,
    tasses: lignesRemplies('tasse').map(net),
    textiles: lignesRemplies('textile').map(net),
    objets: lignesRemplies('objet').map(net),
    paiement: { statut: state.paiement.statut, mode: state.paiement.mode },
    enBoite: state.enBoite,
  };
}

async function submit() {
  const need = missing();
  if (need) return toast(`Il manque ${need}.`);

  state.sending = true;
  render();
  try {
    const res = await fetch('/api/commande', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    showDone(data.commande);
    // Le client vient peut-être d'entrer dans l'annuaire : on le rafraîchit.
    loadClients();
  } catch (err) {
    toast(err.message || 'Enregistrement impossible — réessayez.');
  } finally {
    state.sending = false;
    render();
  }
}

function showDone(c) {
  const lignes = [...c.tasses, ...c.textiles, ...c.objets];
  const detail = lignes.length
    ? `${lignes.length} ligne${lignes.length > 1 ? 's' : ''} (${c.quantite} pièce${c.quantite > 1 ? 's' : ''})`
    : c.objet;
  $('#cmd-done-title').textContent = `${c.type.label} enregistrée`;
  $('#cmd-done-sub').textContent = `${c.client.societe} · ${detail} · au planning`;
  $('#cmd-done').hidden = false;
  $('#cmd-done-new').focus();
}

// Remet la fiche à zéro sans recharger la page. La nature reste celle de
// l'entrée de menu : on enchaîne souvent plusieurs saisies du même type.
function reset() {
  state.client = { type: 'pro', facturation: '', contact: '', whatsapp: '', email: '', prenom: '', nom: '' };
  state.objet = '';
  state.ouvertes = [];
  state.lignes = { tasse: [], textile: [], objet: [] };
  state.paiement = { statut: 'non_paye', mode: '' };
  state.enBoite = false;
  state.sending = false;

  for (const id of ['cmd-facturation', 'cmd-contact', 'cmd-whatsapp', 'cmd-email',
    'cmd-prenom', 'cmd-nom', 'cmd-whatsapp-perso', 'cmd-objet']) {
    $(`#${id}`).value = '';
  }
  setDelai(CAT.delaiDefaut);
  $('#cmd-done').hidden = true;
  closeAuto();
  renderFams();
  render();
  $('#cmd-facturation').focus();
}

async function loadClients() {
  try {
    CLIENTS = await (await fetch('/api/clients')).json();
  } catch (_) {
    CLIENTS = [];   // l'annuaire n'est qu'une aide : son absence ne bloque rien
  }
}

// Nature poussée par app.js selon l'entrée de menu (#demande / #commande).
export function setNature(kind) {
  if (kind !== 'demande' && kind !== 'commande') return;
  state.kind = kind;
  if (ROOT) render();
}

// Montage unique, déclenché par app.js au premier affichage de la vue.
let mounted = false;
export async function initCommande(root) {
  if (mounted) return;
  ROOT = root;
  // Le drapeau n'est posé qu'APRÈS le catalogue : si le réseau lâche, l'erreur
  // remonte à app.js qui rouvrira la vue au prochain passage.
  CAT = await (await fetch('/api/commande/catalog')).json();
  mounted = true;
  buildStatic();
  renderFams();
  wire();
  render();
  loadClients().then(render);
  // Ramassage périodique des lignes restées vierges (voir sweepVides).
  setInterval(sweepVides, 60 * 1000);
}
