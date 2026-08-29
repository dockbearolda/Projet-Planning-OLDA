// « 1 250,50 € ». La fiche n'importe rien d'app.js — c'est ce qui lui permet
// d'etre chargee, relue et testee seule (voir test/fiche-atelier.test.js).
const euros = (n) => `${Number(n).toLocaleString('fr-FR',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

// ===========================================================================
// LA FICHE ATELIER — 14 pouces, sans défilement (28/08/2026)
// ===========================================================================
// Livrée comme spécification de design (`design_handoff_fiche_commande`), et
// recréée ici avec les composants et l'état de l'application. Le prototype est
// une référence d'apparence : rien de son code n'est repris.
//
// LA CONTRAINTE CENTRALE, celle qui décide de toute la structure : AUCUN
// DÉFILEMENT à 1366 × 630 px, panneau Détails ouvert ou fermé. C'est un
// portable 14 pouces posé à l'atelier, et ce qu'on ne voit pas n'existe pas.
// Budget : chrome fixe ≈ 246 px, il reste 384 px pour les deux colonnes.
//
// TROIS GESTES EN UN CLIC, sans rien faire défiler : changer d'étape, déplacer
// une date, corriger une quantité. Tout le reste s'organise autour.
//
// CE QUI VIENT DE L'APPLICATION, jamais réécrit ici : l'enregistrement par
// champ (`ctx.patchLigne` / `ctx.patchFiche`), le recalcul du prix côté serveur
// (corriger une taille refait le montant, voir chiffrage.js), la liste des
// étapes, celle des employés. Ce module dessine et normalise — il ne décide
// d'aucune règle métier.
//
// AUCUN RACCOURCI CLAVIER. Demande explicite : on navigue à la souris, on
// écrit au clavier. Ce qui se NAVIGUE — une étape, une priorité, l'annulation —
// se clique. Ce qui se SAISIT — une date, une quantité, un montant — se tape :
// les boutons de date et les steppers de taille ont été retirés le 28/08 parce
// qu'ils dupliquaient la frappe au lieu de la remplacer.
//
// ⚠ RE-DEMANDÉ LE 29/08 PAR UN HANDOFF, ET RE-REFUSÉ PAR CHARLIE. Le bundle
// `design_handoff_fiche_commande 2` propose quatre choses que cet écran a déjà
// écartées, et il faut les nommer ici parce qu'elles reviendront :
//   · opt. 05 — steppers « − / + » et molette sur les tailles. RETIRÉS le
//     28/08 : soixante-dix clics pour passer de 30 à 100, et les deux tiers de
//     la case. La quantité se tape, et depuis le 29/08 la série entière se
//     dicte en une ligne (voir `lireTailles`).
//   · opt. 08 — « Tab / Entrée enchaîne / ⌘↵ étape suivante ». C'est
//     exactement le parcours clavier que la consigne du 26/08 interdit :
//     « pas de chaînage à l'Entrée, pas d'ordre de tabulation travaillé ».
//   · opt. 09 et 10 — palette ⌘K, ⌥↑/⌥↓ entre dossiers. Même refus, même raison.
//   · opt. 03 — chips « demain / +3 / lundi » sous les champs de date. Les
//     quatre boutons rapides disaient déjà ce que le champ COMPREND (voir
//     `normaliserDate`) : ils doublaient la saisie. Retirés le 28/08.
// Poser un raccourci sur un champ, c'est en casser un qu'elle connaît déjà.

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const JOURS_SAISIS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const JOUR_MS = 86400000;

const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

const deuxChiffres = (n) => String(n).padStart(2, '0');
const jourCourt = (d) => `${JOURS[d.getDay()]} ${deuxChiffres(d.getDate())}/${deuxChiffres(d.getMonth() + 1)}`;
const isoDuJour = (d) => `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`;

// --- NORMALISATION AU BLUR --------------------------------------------------
// Ce qu'on tape vite à l'atelier et ce qu'on veut lire ensuite ne sont pas la
// même chose : « 1430 » devient « 14h30 », « 3/9 » devient « jeu. 03/09 ».
// UNE SAISIE NON RECONNUE EST LAISSÉE TELLE QUELLE, sans message : refuser une
// valeur au comptoir, c'est perdre l'information que quelqu'un venait d'écrire.
export function normaliserMontant(v) {
  const brut = String(v == null ? '' : v).trim();
  if (!brut) return '';
  const n = parseFloat(brut.replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(n)
    ? `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    : brut;
}

export function normaliserTelephone(v) {
  const brut = String(v == null ? '' : v).trim();
  const chiffres = brut.replace(/\D/g, '');
  // Sous huit chiffres ce n'est pas un numéro : un poste, une extension, un
  // début de saisie. On n'y touche pas.
  return chiffres.length >= 8 ? chiffres.replace(/(\d{2})(?=\d)/g, '$1 ').trim() : brut;
}

// « 70 » se relit « 70 mm », comme « 1250,5 » se relit « 1 250,50 € ». L'unite
// entre DANS le champ : ecrite a cote, elle prenait 34 px par face, et quatre
// faces ne tenaient plus dans la colonne — les bulles se chevauchaient.
export function normaliserCote(v) {
  const brut = String(v == null ? '' : v).trim();
  const n = brut.replace(/\D/g, '');
  return n ? `${Number(n)} mm` : '';
}

export function normaliserHeure(v) {
  const brut = String(v == null ? '' : v).trim();
  const d = brut.replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 2) return `${d.padStart(2, '0')}h00`;
  if (d.length === 3) return `0${d[0]}h${d.slice(1)}`;
  return `${d.slice(0, 2)}h${d.slice(2, 4)}`;
}

// Rend { texte, iso } : le texte pour l'œil, l'ISO pour la base. Un nom de jour
// renvoie la PROCHAINE occurrence, jamais aujourd'hui — « jeudi » dit par un
// client un jeudi veut dire la semaine suivante.
export function normaliserDate(v, aujourdhui) {
  const brut = String(v == null ? '' : v).trim();
  if (!brut) return { texte: '', iso: null };
  const s = brut.toLowerCase();
  const now = aujourdhui || new Date();
  let d = null;
  if (s === 'auj' || s === "aujourd'hui" || s === 'aujourdhui') d = new Date(now);
  else if (s === 'demain') d = new Date(now.getTime() + JOUR_MS);
  // « +3 » = dans trois jours. C'est ce que disaient les boutons rapides retirés
  // le 28/08 : le raccourci reste, il se tape au lieu de se cliquer.
  else if (/^\+\s*\d{1,3}$/.test(s)) d = new Date(now.getTime() + Number(s.slice(1).trim()) * JOUR_MS);
  else if (JOURS_SAISIS.indexOf(s) > -1) {
    let delta = (JOURS_SAISIS.indexOf(s) - now.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    d = new Date(now.getTime() + delta * JOUR_MS);
  } else {
    const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
    if (m) {
      const annee = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
      d = new Date(annee, Number(m[2]) - 1, Number(m[1]));
    } else if (/^\d{4}-\d{2}-\d{2}/.test(brut)) {
      d = new Date(`${brut.slice(0, 10)}T12:00:00`);
    }
  }
  if (!d || Number.isNaN(d.getTime())) return { texte: brut, iso: null };
  return { texte: jourCourt(d), iso: isoDuJour(d) };
}

// --- LA MARGE, CALCULÉE, JAMAIS STOCKÉE -------------------------------------
// « 330,79 € · 51 % ». Un TTC vide ou nul rend un tiret : une marge sur rien
// n'est pas zéro pour cent, c'est une marge qu'on ne connaît pas.
export function texteMarge(ttc, cout) {
  const v = Number(ttc);
  // UN COÛT INCONNU N'EST PAS UN COÛT DE ZÉRO. `Number(null)` vaut 0 et
  // `Number.isFinite(0)` vaut vrai : sans cette garde, tout dossier qu'on n'a
  // pas encore chiffré affichait « 100 % » de marge. C'est écrit noir sur blanc
  // dans le schéma (`cout_revient` : « null = coût inconnu, ce qui n'est PAS
  // zéro »), et c'est le genre de chiffre faux sur lequel on décide un prix.
  if (cout == null || cout === '') return '—';
  const c = Number(cout);
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(c)) return '—';
  const marge = v - c;
  const pct = Math.round((marge / v) * 100);
  return `${marge.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € · ${pct} %`;
}

// ===========================================================================
// L'ÉCRAN
// ===========================================================================
// `ctx` porte ce que l'application sait faire. Rien n'est importé depuis
// app.js : un cycle entre deux modules s'initialise dans un ordre qui dépend de
// qui charge qui, et le jour où il casse, il casse à l'ouverture.
//
//   ctx.patchLigne(champ, valeur)  → une colonne de la commande
//   ctx.patchFiche(corps)          → une clé du JSON de la fiche
//   ctx.patchProd(patch)           → ce qu'il y a à produire (le prix suit)
//   ctx.etapes / ctx.employes / ctx.provenances / ctx.reglements / ctx.types
//   ctx.fermer()                   → retour au planning
//   ctx.ouvrirClient() / ctx.telecharger() / ctx.email()
export function dessinerFicheAtelier(r, ctx) {
  const fiche = r.fiche && typeof r.fiche === 'object' ? r.fiche : {};
  const prod = fiche.prod && typeof fiche.prod === 'object' ? fiche.prod : null;

  const racine = el('div', 'fa');
  // LA PILE D'ANNULATION EST ILLIMITÉE et sans limite de temps. Une correction
  // faite à midi peut se défaire à 17 h : c'est la même journée de travail, et
  // rien ne justifie qu'elle expire.
  const annulations = [];

  // --- La confirmation, l'indicateur, le message ----------------------------
  const calque = el('div', 'fa-flags');
  const empiler = (defaire) => { annulations.push(defaire); };

  // LA PASTILLE SE POSE SUR LE CHAMP MODIFIÉ, dans un calque : posée DANS le
  // champ, elle en aurait changé la hauteur, et toute la colonne avec.
  const coche = (cible) => {
    if (!cible || !calque.isConnected) return;
    const rc = cible.getBoundingClientRect();
    const rl = calque.getBoundingClientRect();
    const dot = el('div', 'fa-flag', '✓');
    dot.style.left = `${Math.round(rc.right - rl.left - 17)}px`;
    dot.style.top = `${Math.round(rc.top - rl.top + rc.height / 2 - 8)}px`;
    calque.append(dot);
    setTimeout(() => dot.remove(), 1200);
  };

  // L'INDICATEUR NE PARLE QUE QUAND IL SE PASSE QUELQUE CHOSE. Il affichait
  // « Enregistrement automatique » en permanence : une phrase qui ne dit rien
  // d'actionnable, dans l'entête, alors que chaque modification donne déjà son
  // message avec « Annuler ». Il reste un point, éteint au repos.
  const etatSauve = el('span', 'fa-autosave');
  etatSauve.setAttribute('aria-label', 'Enregistrement automatique');
  let minuteurSauve = 0;
  const pulser = () => {
    etatSauve.classList.add('is-on');
    clearTimeout(minuteurSauve);
    minuteurSauve = setTimeout(() => etatSauve.classList.remove('is-on'), 1800);
  };

  const zoneToast = el('div', 'fa-toast-zone');
  let minuteurToast = 0;
  const dire = (message, avecAnnuler) => {
    zoneToast.replaceChildren();
    const t = el('div', 'fa-toast');
    t.append(el('span', null, message));
    if (avecAnnuler !== false) {
      const b = el('button', 'fa-toast__undo', 'Annuler');
      b.type = 'button';
      b.addEventListener('click', defaire);
      t.append(b);
    }
    zoneToast.append(t);
    clearTimeout(minuteurToast);
    minuteurToast = setTimeout(() => zoneToast.replaceChildren(), 6000);
  };

  function defaire() {
    const geste = annulations.pop();
    if (!geste) { dire('Rien à annuler', false); return; }
    geste();
    pulser();
    dire('Modification annulée', false);
  }

  // --- LE CYCLE D'UN CHAMP --------------------------------------------------
  // `focus` retient la valeur, `blur` normalise, compare, et n'envoie QUE si ça
  // a changé. Pas de bouton, pas de mode édition : on vient rectifier une chose.
  const brancher = (champ, opts) => {
    let avant = champ.value;
    champ.addEventListener('focus', () => { avant = champ.value; });
    const commettre = () => {
      const normalise = opts.normaliser ? opts.normaliser(champ.value) : champ.value.trim();
      const texte = typeof normalise === 'string' ? normalise : normalise.texte;
      if (texte !== champ.value) champ.value = texte;
      if (champ.value === avant) return;
      const ancien = avant;
      avant = champ.value;
      opts.envoyer(normalise);
      empiler(() => {
        champ.value = ancien;
        avant = ancien;
        opts.envoyer(opts.normaliser ? opts.normaliser(ancien) : ancien);
        opts.apres && opts.apres();
      });
      coche(champ);
      pulser();
      dire(`Enregistré — ${opts.label}`);
      opts.apres && opts.apres();
    };
    champ.addEventListener(champ.tagName === 'SELECT' ? 'change' : 'blur', commettre);
    return champ;
  };

  const champ = (cls, valeur, opts = {}) => {
    const c = el(opts.multi ? 'textarea' : 'input', `fa-in${cls ? ` ${cls}` : ''}`);
    if (opts.multi) c.rows = opts.rows || 2;
    if (opts.placeholder) c.placeholder = opts.placeholder;
    if (opts.inputMode) c.inputMode = opts.inputMode;
    if (opts.requis) c.required = true;
    c.value = valeur == null ? '' : String(valeur);
    c.setAttribute('aria-label', opts.label || '');
    return c;
  };

  // UNE OPTION PEUT DECLARER SON GROUPE, et le menu le rend en `<optgroup>` —
  // le titre que le navigateur dessine lui-meme, en tete de section. Sans lui,
  // le menu d'etape etait trente lignes a plat qui repetaient leur famille en
  // tete : « Preparation du projet › » neuf fois de suite, et il fallait lire la
  // moitie de chaque ligne avant d'arriver a ce qui les distingue.
  //
  // LE GROUPE EST UNE DONNEE DE L'OPTION, pas une decoupe faite ici sur le
  // libelle : couper sur un « › » marcherait jusqu'au jour ou une sous-etape en
  // contient un. Les options sans groupe restent a plat, comme avant — c'est ce
  // que font « Qui suit » et « Reglement », qui n'ont pas de familles.
  const menu = (cls, options, valeur, label) => {
    const s = el('select', `fa-in${cls ? ` ${cls}` : ''}`);
    const groupes = new Map();
    for (const o of options) {
      const opt = el('option', null, o.label != null ? o.label : o);
      opt.value = o.value != null ? o.value : (o.label != null ? o.label : o);
      const g = o && o.groupe;
      if (!g) { s.append(opt); continue; }
      if (!groupes.has(g)) {
        const bloc = el('optgroup');
        bloc.label = g;
        groupes.set(g, bloc);
        s.append(bloc);
      }
      groupes.get(g).append(opt);
    }
    s.value = valeur == null ? '' : String(valeur);
    s.setAttribute('aria-label', label || '');
    return s;
  };

  const bouton = (cls, texte, faire) => {
    const b = el('button', cls, texte);
    b.type = 'button';
    if (faire) b.addEventListener('click', faire);
    return b;
  };

  const titreSection = (t) => el('div', 'fa-sec', t);
  const rangee = (label, ...contenu) => {
    // Le dernier argument peut etre une classe en plus (`fa-row--haut` pour la
    // rangee qui s'etire) : elle est reconnue au prefixe, jamais a la position.
    const sup = typeof contenu[contenu.length - 1] === 'string' ? contenu.pop() : null;
    const l = el('div', `fa-row${sup ? ` ${sup}` : ''}`);
    l.append(el('label', 'fa-lab', label), ...contenu.filter(Boolean));
    return l;
  };

  // =========================================================================
  // ZONE 1 — la barre d'entête
  // =========================================================================
  // L'ENTETE NE PORTE PLUS DE BOUTON (28/08). « ‹ Retour au planning » et
  // « ↺ Annuler » sont retires : on sort par Echap ou par un clic dehors, et
  // l'annulation vit dans le message qui suit chaque modification. Il ne reste
  // que ce qui identifie le dossier, et le point qui dit qu'on enregistre.
  const tete = el('header', 'fa-head');
  const ident = el('div', 'fa-ident');
  ident.append(
    el('span', 'fa-ref', fiche.ref || ''),
    // LE NOM DU CLIENT MÈNE À SA FICHE : c'est la question qui suit
    // immédiatement « qui est-ce ? » — on a déjà fait quoi pour eux.
    bouton('fa-client', r.billing_company || 'Sans nom', () => ctx.ouvrirClient && ctx.ouvrirClient(r)),
    el('span', 'fa-projet', r.product || ''),
  );
  // LA CROIX REVIENT, et pour une raison qui a change. Elle avait ete retiree
  // parce qu'elle doublait « Retour au planning » ; puis ce bouton est parti a
  // son tour, et le clic a cote de la carte a pris le relais. Depuis que
  // l'ecran DEFILE, la carte occupe toute la largeur et toute la hauteur : il
  // n'y a plus de « a cote » ou cliquer. Sans elle, la seule sortie serait
  // Echap — un cul-de-sac a la souris.
  const outils = el('div', 'fa-outils');
  outils.append(etatSauve, bouton('fa-btn fa-btn--carre', '×', () => ctx.fermer()));
  tete.append(ident, outils);

  // =========================================================================
  // ZONE 2 — le bandeau : OU EN EST LE DOSSIER, et rien d'autre
  // =========================================================================
  // L'ARGENT N'EST PLUS ICI (29/08). Charlie : « le prix doit etre en bas, il
  // est important de bien separer client, production et paiement ». Le bandeau
  // portait le TTC et la marge a cote de l'etape : trois sujets sur une rangee,
  // et le seul chiffre d'argent de l'ecran perdu au milieu du reste. Il tient
  // maintenant sa propre zone, en bas, avec le cout et le reglement.
  const bandeau = el('div', 'fa-bandeau');

  const blocEtape = el('div', 'fa-bloc fa-bloc--large');
  const selEtape = menu('fa-etape', ctx.etapes, ctx.etapeCourante, 'Étape actuelle');
  brancher(selEtape, {
    label: 'Étape',
    envoyer: (v) => ctx.changerEtape(v),
  });
  // PAS DE LIBELLÉ SUR L'ÉTAPE : le menu dit déjà « Demande & chiffrage ›
  // Tarif / Devis envoyé – Attente client ». Le mot « Étape actuelle » posé
  // au-dessus coûtait une ligne au bandeau et ne s'apprenait à personne.
  //
  // ET PLUS DE BOUTON « ÉTAPE SUIVANTE » (29/08) : il doublait le menu d'à
  // côté, qui fait la même chose et permet en plus de SAUTER une étape — un
  // dossier ne passe pas toujours par toutes. Il coûtait 175 px au menu, qui
  // est le texte le plus long de l'écran et finissait tronqué.
  blocEtape.append(selEtape);

  const blocPrio = el('div', 'fa-bloc');
  const prios = el('div', 'fa-seg');
  const PRIOS = [[1, 'Basse'], [2, 'Moyenne'], [3, 'Haute']];
  const boutonsPrio = PRIOS.map(([n, mot]) => {
    const b = bouton('fa-seg__b', mot);
    b.setAttribute('aria-pressed', String(Number(r.priority) === n));
    b.addEventListener('click', () => {
      const ancien = Number(r.priority);
      if (ancien === n) return;
      poserPriorite(n);
      ctx.patchLigne('priority', n);
      empiler(() => { poserPriorite(ancien); ctx.patchLigne('priority', ancien); });
      coche(b); pulser(); dire('Enregistré — priorité');
    });
    return b;
  });
  function poserPriorite(n) {
    r.priority = n;
    boutonsPrio.forEach((b, i) => b.setAttribute('aria-pressed', String(PRIOS[i][0] === n)));
  }
  prios.append(...boutonsPrio);
  // PAS DE LIBELLÉ NON PLUS : « Basse / Moyenne / Haute » ne peut rien dire
  // d'autre qu'une priorité, et le mot coûtait 70 px au menu d'étape — qui,
  // lui, en manquait pour finir « Attente client ».
  prios.setAttribute('aria-label', 'Priorité');
  blocPrio.append(prios);

  // LE PRIX ET LA MARGE : construits ici parce que `majMarge` sert aussi au coût
  // de revient, mais POSÉS dans la zone Paiement, en bas (voir ZONE 5).
  const valMarge = el('span', 'fa-marge-v', '—');
  const chTtc = champ('fa-ttc', r.project_value == null ? '' : normaliserMontant(r.project_value), {
    label: 'Valeur TTC', placeholder: '0,00 €',
  });
  const nombreDe = (v) => {
    const n = parseFloat(String(v).replace(/[^\d,.-]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const majMarge = () => { valMarge.textContent = texteMarge(nombreDe(chTtc.value), nombreDe(chCout.value)); };
  // LE PRIX SE REPOSE QUAND LES TAILLES BOUGENT. Le serveur retarife à chaque
  // changement de quantité ; sans ça l'écran gardait l'ancien montant, et la
  // marge comme le reste à payer se calculaient dessus. Ça ne se voyait pas
  // tant qu'on corrigeait une case ; la série dictée déplace tout d'un coup.
  // LE COUT DE REVIENT SUIT LA MEME ROUTE. Il se recalcule lui aussi a la
  // quantite : ne reposer que le prix donnait une marge fausse dans l'AUTRE
  // sens — un TTC a 60 pieces contre un cout reste a 30, soit 75 % de marge
  // annoncee la ou il y en a 51.
  const reposerPrix = (maj) => {
    if (!maj) return;
    if (maj.project_value !== undefined) {
      chTtc.value = maj.project_value == null ? '' : normaliserMontant(maj.project_value);
    }
    if (maj.cout_revient !== undefined) {
      chCout.value = maj.cout_revient == null ? '' : normaliserMontant(maj.cout_revient);
    }
    majMarge();
    majReste();
  };
  // LE RESTE A PAYER SE DEDUIT DU PRIX, donc il se recalcule quand le prix
  // bouge. Il est ecrit plus bas (zone Paiement, avec l'acompte) : on reserve
  // sa place ici, sinon vider le prix laissait le reste sur l'ancien montant —
  // le seul chiffre de l'ecran qui doive etre juste sans qu'on y pense.
  let majReste = () => {};
  brancher(chTtc, {
    label: 'Valeur TTC', normaliser: normaliserMontant,
    envoyer: (v) => ctx.patchLigne('project_value', nombreDe(v)),
    apres: () => { majMarge(); majReste(); },
  });
  // UNE SEULE RANGÉE. Les trois blocs empilaient chacun leur libellé au-dessus
  // de leur commande : 96 px de bandeau, et sous 1180 px les trois se
  // remettaient l'un sous l'autre — près de 200 px pour trois contrôles.
  bandeau.append(blocEtape, el('div', 'fa-sep'), blocPrio);

  // =========================================================================
  // ZONE 3 — CLIENT : qui c'est, quand il l'a, et ce qu'on lui envoie
  // =========================================================================
  // TROIS ZONES, ET ELLES NE SE MELANGENT PLUS (29/08). Charlie : « il est
  // important de bien separer client, production et paiement ». Le type de
  // client et sa provenance vivaient dans le panneau du bas, entre le mode de
  // reglement et le champ de production ; « Prevu a l'atelier » vivait avec les
  // dates client. Chaque fait rejoint la zone dont il parle.
  const gauche = el('div', 'fa-col fa-col--g');

  // LA DATE SE TAPE, elle ne se clique pas (28/08). Les quatre boutons rapides
  // disaient exactement ce que le champ comprend deja — « auj », « demain »,
  // « +3 », un jour de la semaine : ils doublaient la saisie et prenaient la
  // moitie de la ligne.
  const ligneDate = (label, valeurIso, opts, envoyer) => {
    const c = champ(null, valeurIso ? jourCourt(new Date(`${String(valeurIso).slice(0, 10)}T12:00:00`)) : '', {
      label, placeholder: 'jj/mm, demain, +3, lundi', requis: !!opts.requis,
    });
    brancher(c, {
      label,
      normaliser: (v) => normaliserDate(v, ctx.aujourdhui && ctx.aujourdhui()),
      envoyer: (n) => envoyer(n.iso),
      apres: opts.apres,
    });
    return { rangee: rangee(opts.court || label, c, ...(opts.suite || [])), champ: c };
  };

  // LE RAPPEL DE DÉLAI SE RECALCULE. Écrit une fois à l'ouverture, il continuait
  // d'annoncer l'ancienne échéance juste sous le champ qu'on venait de corriger.
  const rappel = el('span', 'fa-rappel');
  let isoRemise = r.deadline || null;
  let heureRemise = fiche.heureSouhaitee || null;
  const majRappel = () => {
    rappel.textContent = ctx.rappelDelai ? ctx.rappelDelai(isoRemise, heureRemise) : '';
  };

  // UNE SEULE DATE ET UNE SEULE HEURE (29/08). Charlie : « ça c'est des
  // doublons, seule la date et l'heure à laquelle le client veut venir chercher
  // sa commande est importante ». Il y avait DEUX heures cote a cote — l'heure
  // de remise (dans `fiche.heureSouhaitee`) et le creneau de retrait (colonne
  // `retrait_creneau`) — pour le meme fait : quand le client passe.
  // On garde `heureSouhaitee`, celle que le comptoir remplit ; `retrait_creneau`
  // n'est plus lue par la fiche (la colonne reste, elle porte l'historique).
  const chHeure = champ('fa-mini', fiche.heureSouhaitee || '', { label: 'Heure de retrait', placeholder: 'heure' });
  brancher(chHeure, {
    label: 'Heure de retrait', normaliser: normaliserHeure,
    envoyer: (v) => {
      heureRemise = v ? v.replace('h', ':') : null;
      ctx.patchFiche({ heureSouhaitee: heureRemise });
    },
    apres: majRappel,
  });
  const remise = ligneDate('Retrait par le client', r.deadline,
    { court: 'Retrait', requis: true, suite: [chHeure, rappel], apres: majRappel },
    (iso) => { isoRemise = iso; ctx.patchLigne('deadline', iso); });

  const prevu = ligneDate('Prévu à l’atelier', r.date_prevue, { court: 'Atelier' },
    (iso) => ctx.patchLigne('date_prevue', iso));

  majRappel();

  // « PREVU A L'ATELIER » A CHANGE DE COLONNE : c'est une date de PRODUCTION,
  // pas un engagement pris devant le client. Elle rejoint la zone qui la porte.
  // TROIS ZONES, TROIS MOTS : Client, Production, Paiement — ceux de Charlie.
  // La colonne en portait deux (« Dates », « Client & suivi ») : deux titres
  // pour une seule zone, et aucun des deux ne disait de quelle zone il s'agit.
  const blocDates = el('section', 'fa-groupe');
  blocDates.append(
    titreSection('Client'),
    remise.rangee,
  );

  const chClient = champ('fa-fort', r.billing_company || '', { label: 'Client', placeholder: 'Nom du client', requis: true });
  brancher(chClient, { label: 'Client', envoyer: (v) => ctx.patchLigne('billing_company', v || null) });
  const chTel = champ(null, normaliserTelephone(r.contact_phone || ''), { label: 'Contact', placeholder: 'téléphone' });
  brancher(chTel, { label: 'Contact', normaliser: normaliserTelephone, envoyer: (v) => ctx.patchLigne('contact_phone', v || null) });
  const chPersonne = champ(null, r.contact_referent || '', { label: 'Personne à contacter', placeholder: 'personne' });
  brancher(chPersonne, { label: 'Personne à contacter', envoyer: (v) => ctx.patchLigne('contact_referent', v || null) });
  const selQui = menu(null, ctx.employes, r.responsable || '', 'Qui suit');
  brancher(selQui, { label: 'Qui suit', envoyer: (v) => ctx.patchLigne('responsable', v || null) });
  const selType = menu(null, ctx.types, r.client_type || '', 'Type de client');
  brancher(selType, { label: 'Type de client', envoyer: (v) => ctx.patchLigne('client_type', v || null) });
  const selProvenance = menu(null, ctx.provenances, r.provenance || '', 'Provenance');
  brancher(selProvenance, { label: 'Provenance', envoyer: (v) => ctx.patchLigne('provenance', v || null) });

  // CE QU'ON ENVOIE AU CLIENT part avec le client. Ces deux boutons vivaient
  // dans le panneau du bas, devenu la zone Paiement : un recapitulatif et un
  // e-mail ne sont pas de l'argent.
  const docs = el('div', 'fa-docs');
  docs.append(
    bouton('fa-btn fa-btn--mini', 'Récap complet', () => ctx.telecharger && ctx.telecharger(r)),
    bouton('fa-btn fa-btn--mini', 'Email au client', () => ctx.email && ctx.email(r)),
  );

  // DEUX PAIRES PAR LIGNE (29/08). Charlie : « ça doit tenir sur 2 lignes ».
  // Six champs sur six lignes, chacune avec 400 px de vide a droite : la
  // colonne descendait pour rien. La grille passe a quatre pistes — intitule,
  // valeur, intitule, valeur — et les six tiennent sur trois lignes, dont les
  // deux premieres portent tout ce qu'il demandait. Le telephone et la personne
  // a joindre restent ensemble : c'est UN fait, « qui on appelle ».
  const blocClient = el('section', 'fa-groupe');
  const grilleClient = el('div', 'fa-grille-client');
  grilleClient.append(
    el('label', 'fa-lab', 'Client'), chClient,
    el('label', 'fa-lab', 'Qui suit'), selQui,
    el('label', 'fa-lab', 'Contact'), chTel,
    el('label', 'fa-lab', 'Personne'), chPersonne,
    // VENUS DU PANNEAU DU BAS (29/08) : ils disent QUI est en face, pas
    // comment il paie. Ils etaient coinces entre le mode de reglement et le
    // champ de production.
    el('label', 'fa-lab', 'Type'), selType,
    el('label', 'fa-lab', 'Provenance'), selProvenance,
  );
  // TROIS CELLULES PAR RANGEE, TOUJOURS. La grille en a trois par ligne : un
  // menu pose seul apres son intitule n'en remplit que deux, et l'intitule
  // suivant part dans la troisieme colonne — c'est ce qui a jete « Provenance »
  // sur sa propre ligne, sous sa valeur.

  blocClient.append(grilleClient);

  // LES NOTES REMPLISSENT LA HAUTEUR QUI RESTE — quand il y en a. Sur le 14
  // pouces de l'atelier (630 px) il n'y a rien a distribuer : le champ reste
  // dans le panneau Details. Au-dela, il monte ici et occupe le vide, qui se
  // trouvait pile sous « Qui suit ». C'est le MEME champ qu'on deplace, jamais
  // un second : deux champs sur `description` s'ecraseraient l'un l'autre.
  gauche.append(blocDates, el('div', 'fa-filet'), blocClient,
    rangee('Documents', docs));

  // =========================================================================
  // ZONE 4 — colonne droite : ce qu'il y a à produire
  // =========================================================================
  const droite = el('div', 'fa-col fa-col--d');
  // MEME FORME QUE LA COLONNE DE GAUCHE : un titre, la DATE, un filet, puis le
  // detail. Le filet manquait ici — et comme il vaut 1 px plus un ecart, TOUTES
  // les lignes de droite tombaient 11 px au-dessus de leurs voisines de gauche.
  // Il separe la meme chose des deux cotes : la date d'un cote du trait, ce
  // qu'on decrit de l'autre.
  droite.append(titreSection('Production'), prevu.rangee, el('div', 'fa-filet'));

  if (prod) {
    const idt = el('div', 'fa-grille-prod');
    for (const [cle, label] of [['ref', 'Référence'], ['couleur', 'Couleur'],
      ['marquage', 'Technique'], ['encre', 'Marquage']]) {
      const c = champ(null, prod[cle] || '', { label, placeholder: label.toLowerCase() });
      brancher(c, { label, envoyer: (v) => ctx.patchProd({ [cle]: v }) });
      idt.append(el('label', 'fa-lab', label), c);
    }
    droite.append(idt);

    // --- LES TAILLES ------------------------------------------------------
    // LE NOMBRE S'ÉCRIT (28/08). Les « + / − » ajoutaient une pièce par clic :
    // pour passer de 30 à 100 il fallait soixante-dix clics, et ils prenaient
    // les deux tiers de la case. La quantité est connue, elle se tape.
    const tailles = Array.isArray(prod.tailles) ? prod.tailles : [];
    const total = el('span', 'fa-total', '0');
    const listeTailles = () => tailles.map((t) => ({ t: String(t.t), n: Number(t.n) || 0 }));
    const majTotal = () => { total.textContent = String(tailles.reduce((s, t) => s + (Number(t.n) || 0), 0)); };

    const grilleT = el('div', 'fa-tailles');
    tailles.forEach((taille, i) => {
      const case_ = el('div', 'fa-taille');
      const c = champ('fa-nb', taille.n, { label: `Taille ${taille.t}`, placeholder: '0', inputMode: 'numeric' });
      const poser = (n, tracer) => {
        const borne = Math.max(0, Math.round(Number(n) || 0));
        const ancien = Number(tailles[i].n) || 0;
        if (borne === ancien) return;
        tailles[i].n = borne;
        c.value = borne ? String(borne) : '';
        majTotal();
        const liste = listeTailles();
        Promise.resolve(ctx.patchProd({ tailles: liste })).then(reposerPrix);
        if (tracer) {
          empiler(() => {
            tailles[i].n = ancien;
            c.value = ancien ? String(ancien) : '';
            majTotal();
            Promise.resolve(ctx.patchProd({ tailles: listeTailles() })).then(reposerPrix);
          });
        }
      };
      c.addEventListener('blur', () => {
        const avant = Number(tailles[i].n) || 0;
        const vise = Math.max(0, Math.round(Number(c.value.replace(/\D/g, '')) || 0));
        if (vise === avant) { c.value = avant ? String(avant) : ''; return; }
        poser(vise, true);
        coche(c); pulser(); dire(`Enregistré — taille ${taille.t}`);
      });
      case_.append(el('span', 'fa-taille__k', String(taille.t)), c);
      grilleT.append(case_);
    });
    majTotal();

    // LES TAILLES SONT UNE RANGÉE COMME LES AUTRES. Elles avaient leur propre
    // en-tête — un libellé posé au-dessus alors que toutes les lignes voisines
    // portent le leur à gauche : une ligne de plus, et deux modèles de rangée
    // dans la même colonne.
    const compte = el('span', 'fa-compte');
    compte.append(document.createTextNode('Total '), total, document.createTextNode(' pièces'));
    if (tailles.length) droite.append(rangee('Tailles', grilleT, compte, 'fa-row--empile'));

    // --- LES FACES --------------------------------------------------------
    const faces = Array.isArray(prod.logos) ? prod.logos : [];
    const bandeF = el('div', 'fa-faces');
    faces.forEach((z, i) => {
      const carte = el('div', 'fa-face');
      const cMm = champ('fa-mm', normaliserCote(z.mm), { label: `${z.face} — cote`, placeholder: 'mm' });
      brancher(cMm, {
        label: `${z.face} — cote`,
        normaliser: normaliserCote,
        // On RENVOIE le nombre seul, pas « 70 mm » : c'est une cote en base, et
        // le papier de l'atelier la relit telle quelle.
        envoyer: (v) => ctx.patchProd({ logos: faces.map((_, j) => (j === i ? { mm: String(v).replace(/\D/g, '') } : {})) }),
      });
      const cQuoi = champ('fa-quoi', z.quoi || '', { label: `${z.face} — marquage`, placeholder: 'ce qu’on y marque' });
      brancher(cQuoi, { label: `${z.face} — marquage`, envoyer: (v) => ctx.patchProd({ logos: faces.map((_, j) => (j === i ? { quoi: v } : {})) }) });
      carte.append(el('span', 'fa-face__k', z.face), cMm, cQuoi);
      bandeF.append(carte);
    });
    // LE BOUTON N'EST PAS UNE FACE : il sort de la grille et se pose au bout de
    // la rangée, comme le total se pose au bout des tailles. Dedans, il passait
    // pour un troisième emplacement et poussait tout sur deux lignes.
    // PAS DE `prompt()`. Il bloque la page entiere, il est refuse dans certains
    // cadres (il jetait « prompt() is not supported » ici meme), et il emmene le
    // focus hors de l'ecran. Le nom se tape dans une case qui prend la place du
    // bouton, sur la meme rangee : rien ne se deplace, et Echap rend la main.
    const ajoutF = bouton('fa-ajout', '+ Face', () => {
      const saisie = champ('fa-quoi', '', { label: 'Nom de la face', placeholder: 'nom de la face' });
      const finir = (garder) => {
        const nom = garder ? saisie.value.trim() : '';
        saisie.replaceWith(ajoutF);
        if (!nom) return;
        ctx.patchProd({ logos: [...faces.map(() => ({})), { face: nom }] });
        dire('Face ajoutee', false);
        // Une face de plus change la STRUCTURE de l'ecran, pas une valeur : il
        // faut le redessiner, sinon la face part en base et ne s'affiche pas.
        if (ctx.rafraichir) setTimeout(() => ctx.rafraichir(), 350);
      };
      saisie.addEventListener('blur', () => finir(true));
      saisie.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); saisie.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); finir(false); }
      });
      ajoutF.replaceWith(saisie);
      saisie.focus();
    });
    droite.append(rangee('Faces', bandeF, ajoutF, 'fa-row--empile'));
  }

  // TROIS CHAMPS DE TEXTE LIBRE, UN SEUL RESTE (29/08). Charlie, en designant
  // « Production », « Consigne » et « Informations » : « tout ca doit etre
  // supprime et il doit y avoir UNE SEULE note a la fin ».
  //
  // Ils demandaient la meme chose trois fois — ecris ce qu'il faut savoir — et
  // la vendeuse devait choisir lequel. Trois cases a moitie remplies disent
  // moins qu'une pleine : on ne savait plus dans laquelle chercher.
  //
  // CE QUI RESTE, c'est `description` : la colonne, remplie sur 65 % des
  // dossiers reels, celle que la LIGNE du planning affiche deja, et la seule
  // des trois qui existe ailleurs que dans la fiche.
  //
  // CE QUI PART :
  //   · `fiche.production` — le poste de fabrication. Il n'est pas orphelin :
  //     le ticket de l'atelier le porte et le rend modifiable (`ticket.js`,
  //     `{ ou: 'fiche', cle: 'production' }`), et les deux papiers l'impriment.
  //     Zero dossier sur 187 le portait en production.
  //   · `fiche.atelier` — la consigne. Aucun papier ne l'imprime ; UN dossier
  //     sur 187 en porte une. Elle reste sur le fil (`FICHE_LISTE`) et dans le
  //     journal, mais plus rien ne l'ecrit ici.

  const travail = el('div', 'fa-travail');
  travail.append(gauche, droite);

  // =========================================================================
  // ZONE 5 — PAIEMENT : le seul endroit de l'écran où il est question d'argent
  // =========================================================================
  // LE PANNEAU EST UN CALQUE, jamais dans le flux : posé entre les colonnes et
  // la barre basse, il les comprimerait et elles se mettraient à défiler — la
  // seule chose que cet écran ne doit pas faire.
  //
  // ET IL RESTE MONTÉ, masqué par `display`. Démonté au repliage, il emporte
  // les valeurs qu'on venait d'y saisir et fausse les calculs qui les lisent.
  const panneau = el('div', 'fa-details');
  // OUVERT PARTOUT, y compris sur le 14 pouces. Il a fallu deux detours avant
  // d'y arriver — un calque qui recouvrait les colonnes, puis un seuil de
  // hauteur qui le fermait en dessous de 1000 px. Depuis que c'est L'ECRAN qui
  // defile et non les colonnes, il n'y a plus de place a economiser.
  panneau.hidden = false;

  // LA NOTE, UNE SEULE, EN FIN DE FICHE. Elle ferme les deux colonnes : on a
  // fini de lire le dossier, on ecrit ce qui ne rentrait dans aucune case.
  const chNote = champ(null, r.description || '', {
    label: 'Note', multi: true, rows: 3,
    placeholder: 'Ce qu’il faut savoir sur ce dossier',
  });
  brancher(chNote, { label: 'Note', envoyer: (v) => ctx.patchLigne('description', v || null) });
  // ELLE EST UNE RANGEE COMME LES AUTRES : intitule a GAUCHE, sur le meme rail
  // que « Client », « Reference » ou « Faces ». Pose au-dessus de son champ —
  // ce que faisait l'ancien bloc « Informations » — il etait le seul intitule de
  // la fiche a ne pas tomber sur ce rail. `fa-row--haut` cale l'intitule en haut
  // du champ, comme pour toute rangee qui s'etire.
  const blocNote = rangee('Note', chNote, 'fa-row--haut');
  blocNote.classList.add('fa-note');

  // LES RANGEES ENTRENT DIRECTEMENT DANS LA GRILLE DU PANNEAU (29/08). Elles
  // vivaient dans une colonne qui prenait les deux pistes : six rangees les
  // unes sous les autres sur 1 126 px de large, dont trois qui etiraient un
  // menu de trois lettres sur 1 010 px. Le panneau declarait « deux colonnes »
  // et n'en rendait qu'une.
  // LES RANGEES ENTRENT DIRECTEMENT DANS LA GRILLE DU PANNEAU (29/08). Elles
  // vivaient dans une colonne qui prenait les deux pistes : six rangees les
  // unes sous les autres sur 1 126 px de large, dont trois qui etiraient un
  // menu de trois lettres sur 1 010 px. Le panneau declarait « deux colonnes »
  // et n'en rendait qu'une.
  const rangeesPanneau = [];

  // =========================================================================
  // CE QUI EST PAYE, ET CE QU'IL RESTE — d'un coup d'oeil (29/08)
  // =========================================================================
  // Charlie : « tu conserves reference et paye et tu ajoutes acompte paye avec
  // le prix de l'acompte verse a la date, et que ca se deduise automatiquement ;
  // en un coup d'oeil on doit voir ce qui est paye et combien il reste a payer ».
  //
  // Il y avait TROIS BASCULES — acompte demande, acompte verse, solde — et
  // aucun montant. Trois oui/non pour une question qui appelle un chiffre : on
  // savait qu'un acompte etait tombe, jamais combien, ni quand, ni ce qui
  // restait. Le reste a payer se faisait de tete, a chaque appel.
  //
  // UN SEUL FAIT SE SAISIT : le montant de l'acompte et sa date. Les deux
  // drapeaux s'en deduisent — un acompte VERSE a forcement ete DEMANDE — et
  // c'est ce qui garde le feu du planning juste sans qu'on ait a cocher.
  const chAcompte = champ('fa-cout', r.acompte_montant == null ? '' : normaliserMontant(r.acompte_montant), {
    label: 'Acompte versé', placeholder: '0,00 €',
  });
  const chAcompteDate = champ('fa-date', r.acompte_date
    ? jourCourt(new Date(`${String(r.acompte_date).slice(0, 10)}T12:00:00`)) : '', {
    label: 'Date de l’acompte', placeholder: 'le…',
  });
  const resteV = el('span', 'fa-reste__v', '—');
  const reste = el('div', 'fa-reste');
  reste.append(resteV);

  // LE RESTE SE CALCULE, IL NE SE SAISIT PAS. Solde => zero, quoi qu'il y ait
  // dans les champs : c'est la seule facon que « solde » veuille dire quelque
  // chose. Sans prix, on ne peut rien deduire — on le dit au lieu d'afficher
  // un montant faux.
  majReste = () => {
    const ttc = nombreDe(chTtc.value);
    const av = nombreDe(chAcompte.value) || 0;
    if (r.paye === true) { resteV.textContent = euros(0); reste.dataset.etat = 'solde'; return; }
    if (ttc == null) { resteV.textContent = '—'; reste.dataset.etat = 'inconnu'; return; }
    const du = Math.round((ttc - av) * 100) / 100;
    resteV.textContent = euros(du);
    reste.dataset.etat = du <= 0 ? 'solde' : (av > 0 ? 'entame' : 'entier');
  };

  // LE MONTANT ET SES DEUX DRAPEAUX, ECRITS UNE SEULE FOIS. Deux portes mènent
  // au même fait — la frappe dans le champ, et les pastilles « 30 % / 50 % » —
  // et le jour où l'une des deux oublie un drapeau, le feu du planning se tait
  // sur ces dossiers-là sans que rien ne le dise. C'est le défaut du 26/08 au
  // soir : `acompte_demande` était NULL sur les 184 dossiers.
  const envoyerAcompte = (n) => {
    ctx.patchLigne('acompte_montant', n);
    // UN ACOMPTE VERSÉ A FORCÉMENT ÉTÉ DEMANDÉ : les deux drapeaux se déduisent
    // du montant, ils ne se cochent jamais à la main.
    const verse = n != null && n > 0;
    if ((r.acompte_verse === true) !== verse) { r.acompte_verse = verse; ctx.patchLigne('acompte_verse', verse); }
    if ((r.acompte_demande === true) !== verse) { r.acompte_demande = verse; ctx.patchLigne('acompte_demande', verse); }
  };
  brancher(chAcompte, {
    label: 'Acompte versé', normaliser: normaliserMontant,
    envoyer: (v) => envoyerAcompte(nombreDe(v)),
    apres: majReste,
  });
  brancher(chAcompteDate, {
    label: 'Date de l’acompte',
    normaliser: (v) => normaliserDate(v, ctx.aujourdhui && ctx.aujourdhui()),
    envoyer: (n) => ctx.patchLigne('acompte_date', n.iso),
  });

  // --- L'ACOMPTE EN UN CLIC ---------------------------------------------
  // Optimisation 14. Un acompte se demande presque toujours au tiers ou a la
  // moitie : le chiffre existe, il se DEDUIT du prix, et le taper a la main
  // c'est refaire un calcul que l'ecran sait faire.
  //
  // ELLES PRENNENT LA BOITE DE « Soldé » (`fa-seg__b`), pas une a elles : trois
  // boutons sur la meme rangee doivent avoir la meme hauteur, le meme
  // rembourrage et la meme graisse, et les prendre dans UNE regle.
  //
  // SANS PRIX, ON NE CALCULE RIEN. Un pourcentage de rien vaut zero, et un
  // acompte a 0,00 € pose sur un dossier non chiffre allumerait les deux
  // drapeaux du feu pour un versement qui n'a pas eu lieu.
  const pastilleAcompte = (part) => bouton('fa-seg__b', `${Math.round(part * 100)} %`, () => {
    const ttc = nombreDe(chTtc.value);
    if (ttc == null || ttc <= 0) { dire('Pas de prix TTC — l’acompte ne peut pas s’en déduire', false); return; }
    const avant = nombreDe(chAcompte.value);
    const n = Math.round(ttc * part * 100) / 100;
    if (n === avant) return;
    const poser = (v) => {
      chAcompte.value = v == null ? '' : normaliserMontant(v);
      envoyerAcompte(v);
      majReste();
    };
    poser(n);
    empiler(() => poser(avant));
    coche(chAcompte); pulser(); dire(`Enregistré — acompte de ${Math.round(part * 100)} %`);
  });

  const bSolde = bouton('fa-seg__b fa-solde', 'Soldé');
  bSolde.setAttribute('aria-pressed', String(r.paye === true));
  bSolde.addEventListener('click', () => {
    const ancien = r.paye === true;
    r.paye = !ancien;
    bSolde.setAttribute('aria-pressed', String(r.paye));
    ctx.patchLigne('paye', r.paye);
    empiler(() => { r.paye = ancien; bSolde.setAttribute('aria-pressed', String(ancien)); ctx.patchLigne('paye', ancien); majReste(); });
    coche(bSolde); pulser(); dire(r.paye ? 'Enregistré — soldé' : 'Enregistré — non soldé');
    majReste();
  });

  const selReglement = menu(null, ctx.reglements, r.paiement_mode || '', 'Mode de règlement');
  brancher(selReglement, { label: 'Mode de règlement', envoyer: (v) => ctx.patchLigne('paiement_mode', v || null) });
  const chCout = champ('fa-cout', r.cout_revient == null ? '' : normaliserMontant(r.cout_revient), {
    label: 'Coût de revient', placeholder: '0,00 €',
  });
  brancher(chCout, {
    label: 'Coût de revient', normaliser: normaliserMontant,
    envoyer: (v) => ctx.patchLigne('cout_revient', nombreDe(v)),
    apres: majMarge,
  });
  // LE PRIX EST ICI, EN BAS, et plus dans le bandeau. La marge le suit : elle
  // se lit du TTC et du coût, les trois se relisent d'un coup.
  // =========================================================================
  // LE COMPTE EST EN BAS A DROITE — c'est la norme (29/08)
  // =========================================================================
  // Charlie : « le prix visuellement doit etre en bas a droite, c'est la norme,
  // mets ca a jour ». C'est celle de tout devis et de toute facture : le total
  // ferme le document, en bas, cale a droite, avec ses lignes empilees.
  // Le panneau les posait en deux colonnes de rangees ordinaires — le prix en
  // haut a gauche, le reste tout en bas a gauche, et rien qui ne dise que les
  // trois montants se soustraient.
  //
  // A GAUCHE, ce qui ne regarde que l'atelier : le cout de revient, la marge
  // qui s'en deduit, et le mode de reglement. A DROITE, le compte du client.
  // L'ECHELLE DES MONTANTS : libelle a gauche, montant a droite, tous sur le
  // meme rail — c'est ce qui rend la soustraction lisible sans l'ecrire.
  // LA COLONNE DES MONTANTS EST LA DERNIERE, ET RIEN NE PASSE A SA DROITE.
  // Premier essai : la date de l'acompte et le bouton « Solde » etaient poses
  // APRES le montant dans leur rangee — les trois chiffres finissaient a 1 330,
  // 1 181 et 1 268 px, donc sur trois rails. Une echelle de montants qui ne
  // s'aligne pas ne se lit pas : c'est tout ce qu'on lui demande.
  // Ce qui accompagne un montant va donc dans la case du LIBELLE, a sa gauche.
  // UNE SEULE FAMILLE POUR TOUT LE BAS DE LA FICHE (29/08). Charlie, en
  // designant les deux moities du panneau : « tout ca doit etre la meme
  // famille ». Elles etaient deux composants differents cote a cote — a gauche
  // l'intitule pose au rail de GAUCHE et la valeur qui le suit, a droite
  // l'intitule cale CONTRE la colonne des montants. Meme paire, deux
  // geometries : c'est exactement ce qui se voit sans qu'on sache le nommer.
  //
  // C'est la forme du COMPTE qui gagne, pour deux raisons : c'est la norme d'un
  // devis (l'intitule contre son montant, les montants sur un rail), et c'est
  // celle que Charlie a demandee le 29/08 pour le total. Le bas de la fiche
  // parle d'argent d'un bout a l'autre : il se lit donc comme un compte, et
  // plus comme la suite des colonnes du haut.
  const grilleCompte = () => el('div', 'fa-argent');
  const ligneDe = (hote) => (cle, montant) => {
    const k = el('div', 'fa-argent__k');
    k.append(...(Array.isArray(cle) ? cle : [document.createTextNode(cle)]));
    const v = el('div', 'fa-argent__v');
    v.append(montant);
    hote.append(k, v);
    return { k, v };
  };
  const argent = grilleCompte();
  const ligneArgent = ligneDe(argent);
  const ttcCase = chTtc;
  const acompteCase = chAcompte;
  const resteCase = reste;

  // CHAQUE ACTION SE POSE CONTRE LE NOMBRE QU'ELLE CHANGE, dans la case du
  // LIBELLE — la seule place ou quelque chose peut accompagner un montant sans
  // sortir du rail des chiffres (regle du 29/08 : rien ne passe A DROITE du
  // montant). Les deux pastilles calculent l'ACOMPTE, elles vivent donc sur sa
  // ligne ; « Solde » met le RESTE a zero, il vit sur la sienne. C'est aussi ce
  // qui retire la quatrieme rangee du compte : elle ne portait qu'eux, et
  // coutait 56 px de haut pour rien.
  ligneArgent('Prix TTC', ttcCase);
  ligneArgent([
    el('span', 'fa-moins', '−'),
    document.createTextNode('Acompte versé le '),
    chAcompteDate,
    pastilleAcompte(0.3),
    pastilleAcompte(0.5),
  ], acompteCase);
  argent.append(el('div', 'fa-argent__filet'));
  ligneArgent([bSolde, document.createTextNode('Reste à payer')], resteCase);

  // LE PANNEAU EST UN SEUL BLOC, PAS DEUX MORCEAUX ET UN VIDE (29/08). Les deux
  // rangees de l'atelier tenaient la premiere ligne sur TOUTE la largeur, et le
  // compte descendait SOUS elles, cale a droite : il restait un rectangle vide
  // de 910 x 225 px en bas a gauche, et le panneau faisait 318 px de haut.
  // Elles se rangent maintenant DANS la moitie gauche, en colonne, face au
  // compte : rien ne flotte seul, et la hauteur du panneau est celle du compte
  // au lieu d'etre celle du compte PLUS une rangee.
  const atelier = grilleCompte();
  atelier.classList.add('fa-argent--atelier');
  const ligneAtelier = ligneDe(atelier);
  // MEME FORME QUE LE COMPTE, ligne pour ligne : deux faits qu'on SAISIT, un
  // filet, puis le nombre qui en TOMBE. A droite c'est prix moins acompte egale
  // reste ; a gauche c'est cout et reglement, puis la marge — qui se calcule
  // elle aussi et ne se tape jamais. Le filet dit la meme chose des deux cotes,
  // et c'est lui qui fait tomber les six lignes aux memes hauteurs.
  ligneAtelier('Coût', chCout);
  ligneAtelier('Règlement', selReglement);
  atelier.append(el('div', 'fa-argent__filet'));
  ligneAtelier('Marge', valMarge);
  rangeesPanneau.push(atelier, argent);
  panneau.append(...rangeesPanneau);

  // LE CHAMP DES NOTES VIT DANS LA COLONNE GAUCHE, POINT. Il y avait ici un
  // seuil de hauteur (420 px) qui le renvoyait dans le panneau sur un ecran
  // minuscule, avec le `ResizeObserver` qui allait avec — trois etats a tenir,
  // pour un cas qu'aucun PC ne produit. Le projet est PC uniquement depuis le
  // 21/08 ; c'etait un reste de la tablette.
  const listeDetails = el('span', 'fa-details__liste',
    'Prix TTC · Coût · Marge · Règlement');

  const chevron = el('span', null, '▾');
  const barreDetails = bouton('fa-details__b', null, () => {
    panneau.hidden = !panneau.hidden;
    chevron.textContent = panneau.hidden ? '▸' : '▾';
  });
  barreDetails.append(
    chevron,
    el('span', null, 'Paiement'),
    listeDetails,
  );

  // =========================================================================
  // ZONE 6 — LA BARRE D'ACTIONS BASSE A ETE RETIREE (29/08)
  // =========================================================================
  // Charlie, en designant le champ de note, le referent, « Ajouter la note » et
  // « Envoyer au client » : « tout ca prend de la place pour rien, tu conserves
  // reference et paye ». Cinq elements sur une rangee pleine largeur, dont un
  // champ de saisie de 700 px, pour des gestes qui vivent deja ailleurs :
  //   · la note s'ecrit dans « Informations », dans la zone Client ;
  //   · l'e-mail au client est dans « Documents », meme zone ;
  //   · « Marquer paye » doublait la bascule « Solde » de la zone Paiement.
  // Ce qui reste : la reference du dossier, en pied de carte, et le paiement,
  // dans sa zone.
  //
  // LA NOTE HORODATEE NE REVIENT PAS (29/08, tranche par Charlie). Elle n'etait
  // d'ailleurs pas ce que son nom disait : `ajouterNote` collait « heure — texte »
  // a la fin de `description`, et le menu « Referent » pose a cote ecrivait la
  // colonne `referent` de la ligne — le prenom n'entrait JAMAIS dans le texte.
  // Ce qui disparait, c'est donc l'horodatage automatique et le geste « ajouter
  // sans ecraser », pas une signature.
  // La plomberie est partie avec : `ctx.ajouterNote` n'existe plus dans app.js.
  // Le champ « Informations » garde le texte libre, dans la zone Client.
  // Si un vrai journal de note revient un jour, il lui faut sa TABLE : la
  // mediane de `description` est deja a 336 caracteres sur les dossiers reels,
  // empiler des lignes horodatees dedans le ferait deborder de la fiche.

  majMarge();
  majReste();
  // LA BANDE « DETAILS » EST LA DERNIERE LIGNE (28/08) : c'est un depliant
  // secondaire, il se pose SOUS la barre des actions courantes. Le panneau,
  // lui, reste un calque cale au-dessus des deux — il n'en couvre aucune.
  // LA SCENE porte les deux colonnes ET le panneau : c'est elle qui donne au
  // calque son point d'ancrage. Cale sur une hauteur ECRITE — `bottom: 105px`
  // pour 46 + 69 de barres — il recouvrait la barre des actions des que l'une
  // des deux bougeait d'un pixel. Il se cale maintenant sur `bottom: 0` de la
  // scene, qui s'arrete pile ou les barres commencent.
  // LE PANNEAU VIT DANS LA SCENE. Sur un ecran haut il y est STATIQUE : la
  // scene s'allonge, la fiche avec, et tout se lit d'un coup. Sur le 14 pouces
  // il redevient un CALQUE (media query) : la fiche remplit deja l'ecran, et
  // dans le flux il y ecrasait les deux colonnes de 349 px — on ne voyait plus
  // le dossier. Deux comportements, un seul element, aucune duplication.
  // LA RACINE EST LE VOILE, ET C'EST ELLE QUI DEFILE. La CARTE porte le
  // contenu et prend sa hauteur naturelle : plus une seule barre de defilement
  // dans les colonnes, une seule pour tout l'ecran. Un clic sur la racine —
  // donc a cote de la carte — ferme la fiche.
  const scene = el('div', 'fa-scene');
  // LA NOTE FERME LA SCENE, entre les deux colonnes et le compte : on a fini de
  // lire le dossier, on ecrit ce qui ne rentrait dans aucune case, puis on
  // regarde l'argent. Elle prend toute la largeur — c'est du texte libre, il n'a
  // pas de raison de tenir dans une demi-colonne.
  scene.append(travail, blocNote, panneau);
  const carte = el('div', 'fa-carte');
  // LA PROVENANCE DU DOSSIER — « Créée le … depuis Demande de devis » — n'est
  // ni du client, ni de la production, ni du paiement : c'est l'identité de la
  // ligne. Elle vivait au bout du panneau du bas ; elle se pose en pied de
  // carte, là où on la lit sans la chercher.
  const rappelDossier = el('div', 'fa-rappel-bloc', ctx.rappelDossier || '');
  carte.append(tete, bandeau, scene, rappelDossier, barreDetails);
  racine.append(carte, calque, zoneToast);
  return racine;
}
