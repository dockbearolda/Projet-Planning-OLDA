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

  const menu = (cls, options, valeur, label) => {
    const s = el('select', `fa-in${cls ? ` ${cls}` : ''}`);
    for (const o of options) {
      const opt = el('option', null, o.label != null ? o.label : o);
      opt.value = o.value != null ? o.value : (o.label != null ? o.label : o);
      s.append(opt);
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
  const outils = el('div', 'fa-outils');
  outils.append(etatSauve);
  tete.append(ident, outils);

  // =========================================================================
  // ZONE 2 — le bandeau prioritaire : étape, priorité, valeur
  // =========================================================================
  const bandeau = el('div', 'fa-bandeau');

  const blocEtape = el('div', 'fa-bloc fa-bloc--large');
  const selEtape = menu('fa-etape', ctx.etapes, ctx.etapeCourante, 'Étape actuelle');
  brancher(selEtape, {
    label: 'Étape',
    envoyer: (v) => ctx.changerEtape(v),
  });
  const suivante = bouton('fa-btn fa-btn--plein', 'Étape suivante ›', () => {
    const i = ctx.etapes.findIndex((e) => (e.value != null ? e.value : e) === selEtape.value);
    const prochaine = ctx.etapes[i + 1];
    if (!prochaine) { dire('Dernière étape du parcours', false); return; }
    const ancien = selEtape.value;
    selEtape.value = prochaine.value != null ? prochaine.value : prochaine;
    ctx.changerEtape(selEtape.value);
    empiler(() => { selEtape.value = ancien; ctx.changerEtape(ancien); });
    coche(selEtape); pulser(); dire('Enregistré — étape');
  });
  // PAS DE LIBELLÉ SUR L'ÉTAPE : le menu dit déjà « Demande & chiffrage ›
  // Tarif / Devis envoyé – Attente client ». Le mot « Étape actuelle » posé
  // au-dessus coûtait une ligne au bandeau et ne s'apprenait à personne.
  blocEtape.append(selEtape, suivante);

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

  const blocValeur = el('div', 'fa-bloc');
  const valMarge = el('span', 'fa-marge-v', '—');
  const chTtc = champ('fa-ttc', r.project_value == null ? '' : normaliserMontant(r.project_value), {
    label: 'Valeur TTC', placeholder: '0,00 €',
  });
  const nombreDe = (v) => {
    const n = parseFloat(String(v).replace(/[^\d,.-]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const majMarge = () => { valMarge.textContent = texteMarge(nombreDe(chTtc.value), nombreDe(chCout.value)); };
  brancher(chTtc, {
    label: 'Valeur TTC', normaliser: normaliserMontant,
    envoyer: (v) => ctx.patchLigne('project_value', nombreDe(v)),
    apres: majMarge,
  });
  const marge = el('div', 'fa-marge');
  marge.append(el('span', 'fa-marge-k', 'marge'), valMarge);
  // « TTC » et non « Valeur TTC » : le champ porte deja un montant, le libelle
  // n'a qu'a lever le doute HT/TTC. Les 55 px rendus vont au menu d'etape, le
  // texte le plus long de l'ecran.
  blocValeur.append(el('span', 'fa-lab', 'TTC'), chTtc, marge);

  // UNE SEULE RANGÉE. Les trois blocs empilaient chacun leur libellé au-dessus
  // de leur commande : 96 px de bandeau, et sous 1180 px les trois se
  // remettaient l'un sous l'autre — près de 200 px pour trois contrôles.
  bandeau.append(blocEtape, el('div', 'fa-sep'), blocPrio, el('div', 'fa-sep'), blocValeur);

  // =========================================================================
  // ZONE 3 — colonne gauche : dates, client & suivi
  // =========================================================================
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

  const chHeure = champ('fa-mini', fiche.heureSouhaitee || '', { label: 'Heure de remise', placeholder: 'heure' });
  brancher(chHeure, {
    label: 'Heure de remise', normaliser: normaliserHeure,
    envoyer: (v) => {
      heureRemise = v ? v.replace('h', ':') : null;
      ctx.patchFiche({ heureSouhaitee: heureRemise });
    },
    apres: majRappel,
  });
  const remise = ligneDate('Remise au client', r.deadline, { court: 'Remise', requis: true, suite: [chHeure, rappel], apres: majRappel },
    (iso) => { isoRemise = iso; ctx.patchLigne('deadline', iso); });

  const prevu = ligneDate('Prévu à l’atelier', r.date_prevue, { court: 'Atelier' },
    (iso) => ctx.patchLigne('date_prevue', iso));

  const chCreneau = champ('fa-creneau', r.retrait_creneau || '', { label: 'Créneau de retrait', placeholder: 'heure' });
  brancher(chCreneau, {
    label: 'Créneau de retrait', normaliser: normaliserHeure,
    envoyer: (v) => ctx.patchLigne('retrait_creneau', v ? v.replace('h', ':') : null),
  });
  majRappel();

  const blocDates = el('section', 'fa-groupe');
  blocDates.append(
    titreSection('Dates'),
    remise.rangee,
    prevu.rangee,
    rangee('Retrait', chCreneau),
  );

  const chClient = champ('fa-fort', r.billing_company || '', { label: 'Client', placeholder: 'Nom du client', requis: true });
  brancher(chClient, { label: 'Client', envoyer: (v) => ctx.patchLigne('billing_company', v || null) });
  const chTel = champ(null, normaliserTelephone(r.contact_phone || ''), { label: 'Contact', placeholder: 'téléphone' });
  brancher(chTel, { label: 'Contact', normaliser: normaliserTelephone, envoyer: (v) => ctx.patchLigne('contact_phone', v || null) });
  const chPersonne = champ(null, r.contact_referent || '', { label: 'Personne à contacter', placeholder: 'personne' });
  brancher(chPersonne, { label: 'Personne à contacter', envoyer: (v) => ctx.patchLigne('contact_referent', v || null) });
  const selQui = menu(null, ctx.employes, r.responsable || '', 'Qui suit');
  brancher(selQui, { label: 'Qui suit', envoyer: (v) => ctx.patchLigne('responsable', v || null) });

  const blocClient = el('section', 'fa-groupe');
  const grilleClient = el('div', 'fa-grille-client');
  grilleClient.append(
    el('label', 'fa-lab', 'Client'), chClient,
    el('label', 'fa-lab', 'Contact'), chTel, chPersonne,
    el('label', 'fa-lab', 'Qui suit'), selQui,
  );
  chClient.classList.add('fa-span2');
  selQui.classList.add('fa-span2');
  blocClient.append(titreSection('Client & suivi'), grilleClient);

  // LES NOTES REMPLISSENT LA HAUTEUR QUI RESTE — quand il y en a. Sur le 14
  // pouces de l'atelier (630 px) il n'y a rien a distribuer : le champ reste
  // dans le panneau Details. Au-dela, il monte ici et occupe le vide, qui se
  // trouvait pile sous « Qui suit ». C'est le MEME champ qu'on deplace, jamais
  // un second : deux champs sur `description` s'ecraseraient l'un l'autre.
  const nicheNotes = el('div', 'fa-niche');
  gauche.append(blocDates, el('div', 'fa-filet'), blocClient, nicheNotes);

  // =========================================================================
  // ZONE 4 — colonne droite : ce qu'il y a à produire
  // =========================================================================
  const droite = el('div', 'fa-col fa-col--d');
  droite.append(titreSection('Ce qu’il y a à produire'));

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
        ctx.patchProd({ tailles: liste });
        if (tracer) {
          empiler(() => {
            tailles[i].n = ancien;
            c.value = ancien ? String(ancien) : '';
            majTotal();
            ctx.patchProd({ tailles: listeTailles() });
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
    if (tailles.length) droite.append(rangee('Tailles', grilleT, compte));

    // --- LES FACES --------------------------------------------------------
    const faces = Array.isArray(prod.logos) ? prod.logos : [];
    const bandeF = el('div', 'fa-faces');
    faces.forEach((z, i) => {
      const carte = el('div', 'fa-face');
      const cMm = champ('fa-mm', z.mm || '', { label: `${z.face} — cote`, placeholder: '0' });
      brancher(cMm, { label: `${z.face} — cote`, envoyer: (v) => ctx.patchProd({ logos: faces.map((_, j) => (j === i ? { mm: v } : {})) }) });
      const cQuoi = champ('fa-quoi', z.quoi || '', { label: `${z.face} — marquage`, placeholder: 'ce qu’on y marque' });
      brancher(cQuoi, { label: `${z.face} — marquage`, envoyer: (v) => ctx.patchProd({ logos: faces.map((_, j) => (j === i ? { quoi: v } : {})) }) });
      carte.append(el('span', 'fa-face__k', z.face), cMm, el('span', 'fa-unite', 'mm'), cQuoi);
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
    droite.append(rangee('Faces', bandeF, ajoutF));
  }

  const chConsigne = champ(null, fiche.atelier || '', {
    label: 'Consigne atelier', multi: true, rows: 2,
    placeholder: 'Ce qu’il faut savoir avant de couper',
  });
  brancher(chConsigne, { label: 'Consigne atelier', envoyer: (v) => ctx.patchFiche({ atelier: v }) });
  droite.append(rangee('Consigne', chConsigne, undefined, 'fa-row--haut'));

  const travail = el('div', 'fa-travail');
  travail.append(gauche, droite);

  // =========================================================================
  // ZONE 5 — la barre « Détails » et son calque
  // =========================================================================
  // LE PANNEAU EST UN CALQUE, jamais dans le flux : posé entre les colonnes et
  // la barre basse, il les comprimerait et elles se mettraient à défiler — la
  // seule chose que cet écran ne doit pas faire.
  //
  // ET IL RESTE MONTÉ, masqué par `display`. Démonté au repliage, il emporte
  // les valeurs qu'on venait d'y saisir et fausse les calculs qui les lisent.
  const panneau = el('div', 'fa-details');
  panneau.hidden = true;

  const chInfos = champ(null, r.description || '', {
    label: 'Informations', multi: true, rows: 3, placeholder: 'note interne',
  });
  brancher(chInfos, { label: 'Informations', envoyer: (v) => ctx.patchLigne('description', v || null) });
  const colInfos = el('div', 'fa-bloc fa-bloc--notes');
  colInfos.append(el('label', 'fa-lab', 'Informations'), chInfos);

  const colReste = el('div', 'fa-details__col');
  const bascules = [
    ['acompte_demande', 'Acompte demandé'],
    ['acompte_verse', 'Acompte versé'],
    ['paye', 'Soldé'],
  ].map(([cle, mot]) => {
    const b = bouton('fa-seg__b', mot);
    b.setAttribute('aria-pressed', String(r[cle] === true));
    b.addEventListener('click', () => {
      const ancien = r[cle] === true;
      r[cle] = !ancien;
      b.setAttribute('aria-pressed', String(r[cle]));
      ctx.patchLigne(cle, r[cle]);
      empiler(() => { r[cle] = ancien; b.setAttribute('aria-pressed', String(ancien)); ctx.patchLigne(cle, ancien); });
      coche(b); pulser(); dire(`Enregistré — ${mot}`);
    });
    return b;
  });
  const segPaiement = el('div', 'fa-seg');
  segPaiement.append(...bascules);

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
  const selType = menu(null, ctx.types, r.client_type || '', 'Type de client');
  brancher(selType, { label: 'Type de client', envoyer: (v) => ctx.patchLigne('client_type', v || null) });
  const selProvenance = menu(null, ctx.provenances, r.provenance || '', 'Provenance');
  brancher(selProvenance, { label: 'Provenance', envoyer: (v) => ctx.patchLigne('provenance', v || null) });
  const chProduction = champ(null, fiche.production || '', { label: 'Production', placeholder: 'À définir' });
  brancher(chProduction, { label: 'Production', envoyer: (v) => ctx.patchFiche({ production: v }) });

  const docs = el('div', 'fa-docs');
  docs.append(
    bouton('fa-btn fa-btn--mini', 'Récap complet', () => ctx.telecharger && ctx.telecharger(r)),
    bouton('fa-btn fa-btn--mini', 'Email au client', () => ctx.email && ctx.email(r)),
  );

  const reglementLigne = el('div', 'fa-duo');
  reglementLigne.append(selReglement, el('label', 'fa-lab', 'Coût'), chCout);
  colReste.append(
    rangee('Paiement', segPaiement),
    rangee('Règlement', reglementLigne),
    rangee('Type de client', selType),
    rangee('Provenance', selProvenance),
    rangee('Production', chProduction),
    rangee('Documents', docs),
    el('div', 'fa-rappel-bloc', ctx.rappelDossier || ''),
  );
  panneau.append(colInfos, colReste);

  // Le champ des notes suit la place : dans la colonne gauche des qu'il y a de
  // quoi l'etirer, dans le panneau sinon. `matchMedia` et non un test unique :
  // une fenetre se redimensionne, et le champ doit suivre sans se recreer.
  const assezHaut = window.matchMedia('(min-height: 700px)');
  const listeDetails = el('span', 'fa-details__liste');
  const placerNotes = () => {
    const haut = assezHaut.matches;
    // La classe et la liste d'abord : au tout premier appel le champ est deja
    // dans le panneau, et la garde de reinsertion sortirait avant de les ecrire
    // — la barre « Details » restait alors sans un mot.
    panneau.classList.toggle('fa-details--sans-notes', haut);
    listeDetails.textContent = haut
      ? 'Paiement · Documents · Provenance · Récapitulatif'
      : 'Paiement · Informations · Documents · Provenance · Récapitulatif';
    const cible = haut ? nicheNotes : panneau;
    // ON NE REINSERE PAS UN CHAMP DEJA EN PLACE : le deplacer pendant qu'on
    // ecrit dedans lui ferait perdre le curseur.
    if (colInfos.parentElement === cible) return;
    if (haut) cible.append(colInfos); else cible.prepend(colInfos);
  };
  placerNotes();
  // ON OBSERVE LA RACINE, pas la fenetre. Ni `change` de `matchMedia` ni
  // `resize` ne partent dans tous les cadres : la fenetre passait de 630 a 900
  // px, le champ restait dans le panneau et le vide sous « Qui suit » revenait
  // — 307 px. Un `ResizeObserver` voit le changement quelle qu'en soit la
  // cause, et il se debranche avec l'ecran qu'il observe.
  const veille = new ResizeObserver(() => {
    if (!racine.isConnected) { veille.disconnect(); return; }
    placerNotes();
  });
  veille.observe(racine);

  const chevron = el('span', null, '▸');
  const barreDetails = bouton('fa-details__b', null, () => {
    panneau.hidden = !panneau.hidden;
    chevron.textContent = panneau.hidden ? '▸' : '▾';
  });
  barreDetails.append(
    chevron,
    el('span', null, 'Détails'),
    listeDetails,
  );

  // =========================================================================
  // ZONE 6 — la barre d'actions basse
  // =========================================================================
  const bas = el('footer', 'fa-bas');
  const chNote = champ('fa-note', '', {
    label: 'Note',
    placeholder: 'Ajouter une note de production, une information client ou un point de contrôle…',
  });
  const selReferent = menu('fa-referent', ctx.referents, r.referent || '', 'Référent de la note');
  brancher(selReferent, { label: 'Référent', envoyer: (v) => ctx.patchLigne('referent', v || null) });
  bas.append(
    chNote,
    selReferent,
    bouton('fa-btn', 'Ajouter la note', () => {
      const texte = chNote.value.trim();
      if (!texte) { dire('Rien à ajouter — la note est vide', false); return; }
      ctx.ajouterNote(texte);
      chNote.value = '';
      pulser();
      dire('Note ajoutée', false);
    }),
    el('div', 'fa-sep'),
    bouton('fa-btn', 'Envoyer au client', () => ctx.email && ctx.email(r)),
    bouton('fa-btn', 'Marquer payé', () => {
      if (r.paye === true) { dire('Déjà soldé', false); return; }
      r.paye = true;
      bascules[2].setAttribute('aria-pressed', 'true');
      ctx.patchLigne('paye', true);
      empiler(() => { r.paye = false; bascules[2].setAttribute('aria-pressed', 'false'); ctx.patchLigne('paye', false); });
      pulser(); dire('Marqué payé');
    }),
  );

  majMarge();
  // LA BANDE « DETAILS » EST LA DERNIERE LIGNE (28/08) : c'est un depliant
  // secondaire, il se pose SOUS la barre des actions courantes. Le panneau,
  // lui, reste un calque cale au-dessus des deux — il n'en couvre aucune.
  // LA SCENE porte les deux colonnes ET le panneau : c'est elle qui donne au
  // calque son point d'ancrage. Cale sur une hauteur ECRITE — `bottom: 105px`
  // pour 46 + 69 de barres — il recouvrait la barre des actions des que l'une
  // des deux bougeait d'un pixel. Il se cale maintenant sur `bottom: 0` de la
  // scene, qui s'arrete pile ou les barres commencent.
  const scene = el('div', 'fa-scene');
  scene.append(travail, panneau);
  racine.append(tete, bandeau, scene, bas, barreDetails, calque, zoneToast);
  return racine;
}
