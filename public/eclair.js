// ===========================================================================
// SAISIE ÉCLAIR — une vente ou un devis en un écran
// ===========================================================================
// LE PROBLÈME, MESURÉ. Les deux parcours du comptoir recueillent tout ce qu'un
// dossier peut porter : sept étapes, une soixantaine de champs. Relevé sur les
// 184 dossiers réels de la production (27/08/2026), voici ce qui est
// VRAIMENT rempli :
//
//   toujours ....... Client · Type de client · Type de dossier · WhatsApp
//                    Désignation · Quantité · Total TTC · Récupération
//                    Description de production · Paiement
//   une fois sur 2 . E-mail (51 %) · Personne à contacter (47 %)
//                    Adresse (40 %) · Secteur (38 %)
//   presque jamais . Points à contrôler (1/20) · Second contact (1/20)
//                    Transmission prévue par (3/20) · Informations attendues (3/20)
//                    Note interne (5/33) · Décisions & contraintes (4/20)
//                    Article proposé (4/23) · Fonction du contact (13/53)
//
// Douze champs en dessous d'une fois sur deux, six en dessous d'une fois sur
// cinq — et ils sont sur le chemin, entre le client et le prix. C'est ça qui
// prend du temps : pas la quantité d'information, la quantité de cases VIDES
// qu'il faut traverser.
//
// CET ÉCRAN NE SUPPRIME RIEN. Il RANGE : ce qui est toujours rempli est sur le
// chemin, le reste est derrière un volet qui s'ouvre d'un clic. Un dossier
// saisi ici a exactement la même forme qu'un dossier saisi au long — même
// route (`POST /api/comptoir/projet`), même fiche, même ticket d'atelier.
// C'est une voie rapide, pas un second modèle de données : deux modèles, c'est
// un champ ajouté d'un côté et introuvable de l'autre.
//
// CE QU'ELLE NE FAIT PAS, et pourquoi la voie longue reste :
//   · le CHIFFRAGE TEXTILE (le moteur conforme au fichier V9) et la
//     négociation — le prix s'y calcule, il ne se tape pas ;
//   · le BRIEF complet d'une demande de devis (logo, vectorisation, maquette,
//     éléments reçus) — c'est le dossier de celui qui chiffrera.
// Une porte les rejoint, en clair, en bas de l'écran.
//
// LA SOURIS NAVIGUE, LE CLAVIER ÉCRIT (Charlie, 26/08). Aucun parcours au
// clavier n'est inventé ici : rien à apprendre, aucun raccourci à retenir. Mais
// ce que TOUT LE MONDE fait déjà marche — Tab, Entrée pour valider, Échap pour
// refermer une liste, Ctrl+A, copier/coller, la sélection, l'annulation. Une
// vendeuse qui tape le nom d'un produit et fait Entrée a ajouté sa ligne ; une
// vendeuse qui préfère cliquer clique.

const EURO = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euro = (n) => EURO.format(Number(n) || 0);

// La date civile de l'ATELIER (Saint-Martin, UTC−4), jamais celle du serveur.
// À 20 h au comptoir, `toISOString()` daterait du lendemain.
const JOUR_ATELIER = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'America/Marigot', year: 'numeric', month: '2-digit', day: '2-digit',
});
const aujourdhui = () => JOUR_ATELIER.format(new Date());

// `2026-08-27` + N jours, en restant une DATE : passer par un objet Date pour
// ajouter des jours rouvre la porte au décalage de fuseau qu'on vient de fermer.
function dansNJours(n) {
  const [a, m, j] = aujourdhui().split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return d.toISOString().slice(0, 10);
}

const dateLisible = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

// Le mode de paiement tel que le planning le connaît (catalog.json).
// « Au retrait » n'est PAS un mode : c'est l'absence d'encaissement.
const MODES = [
  { id: 'cb', label: 'Carte bancaire' },
  { id: 'especes', label: 'Espèces' },
  { id: 'virement', label: 'Virement' },
  { id: 'mixte', label: 'Mixte' },
];

const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

// Le nom réduit : c'est sur lui que porte la recherche. Sans accent ni casse,
// « ceramique » trouve « céramique » — la vendeuse tape vite, pas juste.
const reduire = (s) => String(s == null ? '' : s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

export { euro, aujourdhui, dansNJours, dateLisible, reduire, MODES };

// ---------------------------------------------------------------------------
// LA LISTE QUI SE FILTRE — le seul composant neuf de cet écran
// ---------------------------------------------------------------------------
// Un champ, et sous lui ce qui correspond à ce qu'on tape. C'est ce qui rend la
// saisie « éclair » : la vendeuse tape « tc 06 » et le produit est là, au lieu
// de dérouler quatre-vingt-dix lignes à la souris.
//
// LA LISTE SORT DU FLUX (`position: absolute`). Un panneau qui pousse le reste
// de l'écran fait bouger le champ suivant sous les doigts au moment précis où
// on va le viser — même règle que le message flottant, pour la même raison.
//
// AUCUN RACCOURCI INVENTÉ : flèches, Entrée, Échap. Ce sont ceux d'un menu
// déroulant natif, tout le monde les a déjà.
function listeFiltrante(hote, opts) {
  const boite = el('div', 'ec-combo');
  const champ = el('input', 'ec-combo__champ');
  champ.type = 'text';
  champ.placeholder = opts.invite || '';
  champ.autocomplete = 'off';
  champ.spellcheck = false;
  const panneau = el('div', 'ec-combo__panneau');
  panneau.hidden = true;
  panneau.setAttribute('role', 'listbox');
  boite.append(champ, panneau);
  hote.append(boite);

  let choix = [];
  let vise = -1;

  const fermer = () => { panneau.hidden = true; vise = -1; };

  const peindre = () => {
    [...panneau.children].forEach((n, i) => n.classList.toggle('is-vise', i === vise));
    const n = panneau.children[vise];
    if (n) n.scrollIntoView({ block: 'nearest' });
  };

  const prendre = (i) => {
    const c = choix[i];
    if (!c) return;
    fermer();
    opts.choisir(c, champ);
  };

  const ouvrir = () => {
    const q = champ.value.trim();
    choix = opts.chercher(q) || [];
    if (!choix.length) { fermer(); return; }
    panneau.replaceChildren(...choix.map((c, i) => {
      const ligne = el('button', 'ec-combo__ligne');
      ligne.type = 'button';
      ligne.setAttribute('role', 'option');
      ligne.append(el('span', 'ec-combo__nom', c.titre));
      if (c.note) ligne.append(el('span', 'ec-combo__note', c.note));
      // `mousedown` et non `click` : le `blur` du champ referme le panneau
      // avant qu'un `click` n'ait le temps de partir, et le clic tombait dans
      // le vide une fois sur deux.
      ligne.addEventListener('mousedown', (e) => { e.preventDefault(); prendre(i); });
      return ligne;
    }));
    vise = 0;
    panneau.hidden = false;
    peindre();
  };

  champ.addEventListener('input', ouvrir);
  champ.addEventListener('focus', ouvrir);
  champ.addEventListener('blur', () => setTimeout(fermer, 0));
  champ.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (panneau.hidden) { ouvrir(); return; }
      e.preventDefault();
      vise = Math.max(0, Math.min(choix.length - 1, vise + (e.key === 'ArrowDown' ? 1 : -1)));
      peindre();
    } else if (e.key === 'Enter') {
      // Entrée sur une liste ouverte prend le choix visé ; sur une liste
      // fermée, elle laisse passer — c'est la validation de la rangée.
      if (!panneau.hidden && choix[vise]) { e.preventDefault(); prendre(vise); }
      else if (opts.entree) { e.preventDefault(); opts.entree(champ.value.trim(), champ); }
    } else if (e.key === 'Escape') {
      if (!panneau.hidden) { e.stopPropagation(); fermer(); }
    }
  });

  return {
    champ,
    vider() { champ.value = ''; fermer(); },
    poser(v) { champ.value = v == null ? '' : String(v); fermer(); },
  };
}

// ---------------------------------------------------------------------------
// L'ÉTAT DE L'ÉCRAN
// ---------------------------------------------------------------------------
// Un objet, pas dix variables éparpillées : c'est lui qu'on relit pour savoir
// ce qui partira, et c'est lui qu'on remet à neuf entre deux clients.
function etatNeuf() {
  return {
    nature: 'vente',       // 'vente' = payée au comptoir · 'devis' = à chiffrer
    client: null,          // la fiche choisie, ou { nouveau: true, nom, tel }
    articles: [],          // [{ famille, label, color, qte, prixTtc, zones }]
    retrait: dansNJours(0),
    heure: '14:00',
    paiement: '',          // id du mode, ou '' = pas encore encaissé
    // Ce que la mesure a mis derrière le volet : rarement rempli, jamais sur
    // le chemin, mais toujours accessible.
    contact: '', email: '', note: '', canal: '',
  };
}

// LE TOTAL. Une vente porte un prix, une demande n'en porte pas — et « pas
// encore chiffré » n'est PAS « gratuit » : sur un devis, `amount` reste absent
// plutôt que d'entrer à zéro.
const totalTtc = (etat) => etat.articles.reduce((s, a) => s + (Number(a.prixTtc) || 0), 0);
const totalPieces = (etat) => etat.articles.reduce((s, a) => s + (Number(a.qte) || 0), 0);

// Le nom qui fait foi partout ailleurs : colonne « Client » du planning, base
// clients, ticket. Une fiche pro porte son entreprise, un particulier son nom.
function nomDuClient(c) {
  if (!c) return '';
  if (c.nouveau) return c.nom;
  return c.entreprise || c.nom || c.societe || '';
}

// ---------------------------------------------------------------------------
// CE QUI PART AU PLANNING
// ---------------------------------------------------------------------------
// EXACTEMENT la forme que les deux parcours envoient déjà. Cet écran est une
// voie rapide vers la même route, pas un second modèle : le serveur, la fiche,
// le tiroir du planning et le ticket de l'atelier n'ont RIEN à apprendre.
//
// LA SÉPARATION QUI COMPTE, et c'est ici qu'elle se joue :
//   · ce qui fait PRODUIRE va dans `articles[].prod` — référence, couleur,
//     technique, tailles, zones de marquage. C'est ce que lit le ticket de
//     l'atelier, et lui seul.
//   · ce qui parle d'ARGENT va dans `amount`, `paiement`, et les lignes du
//     récapitulatif. Le ticket de l'atelier n'en voit jamais rien — il n'a pas
//     à annoncer sur un plan de travail ce que le client a payé.
// Le même article porte les deux ; ce sont deux champs, pas deux dossiers.
function payloadDe(etat) {
  const demande = etat.nature === 'devis';
  const nom = nomDuClient(etat.client);
  const ttc = totalTtc(etat);

  const articles = etat.articles.map((a) => ({
    // LA COULEUR NE S'ÉCRIT PAS DEUX FOIS. Elle part dans `prod.couleur`, que
    // le ticket rend sur sa propre ligne : la coller aussi dans l'intitulé
    // donnait « … — Noir / Blanc — 24 pièces » suivi de « Noir / Blanc ».
    label: a.label,
    qty: Number(a.qte) || 0,
    detail: a.note || '',
    // Le prix de CETTE ligne. Sur un devis il n'y en a pas : le serveur laisse
    // alors la ligne à « À chiffrer » plutôt que d'écrire zéro.
    ...(demande ? {} : { amount: Number(a.prixTtc) || 0 }),
    due: etat.retrait,
    heure: etat.heure,
    // CE QU'IL Y A À PRODUIRE, découpé fait par fait — jamais en phrase.
    prod: {
      ref: a.ref || '',
      couleur: a.color || '',
      marquage: a.technique || '',
      encre: '',
      tailles: [],
      logos: (a.zones || []).map((z) => ({ face: z.face, mm: '', quoi: z.quoi })),
    },
  }));

  // Le RÉCAPITULATIF, libellé par libellé : c'est lui que le tiroir du planning
  // rouvre et que la Vue Bureau relira. Un champ vide ne s'y écrit pas — une
  // ligne « Adresse : — » n'apprend rien à personne.
  const lignes = [];
  const poser = (k, v) => { if (v != null && String(v).trim() !== '') lignes.push([k, String(v)]); };
  poser('Type de dossier', demande ? 'Demande de devis' : 'Vente directe');
  poser('Client', nom);
  poser('Personne à contacter', etat.contact);
  poser('E-mail', etat.email);
  poser('Nombre d’articles', String(etat.articles.length));
  poser('Quantité totale', String(totalPieces(etat)));
  etat.articles.forEach((a, i) => {
    const p = `Article ${i + 1} — `;
    poser(p + 'Désignation', a.label + (a.color ? ` — ${a.color}` : ''));
    poser(p + 'Quantité', String(a.qte));
    poser(p + 'Catégorie', a.famille);
    if (!demande) poser(p + 'Total TTC', euro(a.prixTtc));
    for (const z of a.zones || []) poser(`${p}Zone ${z.face}`, z.quoi);
    poser(p + 'Description de production', a.note);
  });
  if (!demande) {
    poser('Total TTC', euro(ttc));
    poser('Paiement', (MODES.find((m) => m.id === etat.paiement) || {}).label || 'Au retrait');
  }
  poser('Récupération prévue', `${dateLisible(etat.retrait)} à ${etat.heure}`);
  poser('Canal d’entrée', etat.canal);
  poser('Note interne OLDA', etat.note);

  const fiche = etat.client && !etat.client.nouveau ? etat.client : null;
  return {
    source: demande ? 'Demande de devis' : 'Vente directe',
    // La référence est réservée par le serveur : cet écran n'en invente pas.
    client: nom,
    name: etat.articles.map((a) => `${a.qte} x ${a.label}`).join(' • ') || nom,
    responsible: 'À attribuer',
    stage: demande ? 'demande' : 'preparation',
    status: demande ? 'Demande reçue' : 'Préparation des produits',
    due: etat.retrait,
    dueTime: etat.heure,
    production: [...new Set(etat.articles.map((a) => a.technique).filter(Boolean))].join(' + ') || 'À définir',
    comment: etat.note || '',
    quantity: totalPieces(etat),
    ...(demande ? {} : { amount: ttc }),
    clientId: fiche ? fiche.id : '',
    clientObj: fiche || {
      type: 'Particulier', name: nom, phone: (etat.client && etat.client.tel) || '', email: etat.email,
    },
    client_info: [
      ['Client', nom],
      ...(etat.contact ? [['Personne à contacter', etat.contact]] : []),
      ...(etat.email ? [['E-mail', etat.email]] : []),
    ],
    details: lignes,
    articles,
    ...(demande ? {} : {
      paiement: {
        modeLabel: (MODES.find((m) => m.id === etat.paiement) || {}).label || 'Paiement au retrait',
        mode: etat.paiement || null,
        paye: Boolean(etat.paiement),
        retraitImmediat: false,
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// L'ÉCRAN
// ---------------------------------------------------------------------------
let CLIENTS = [];        // la base, chargée une fois à l'ouverture
let PRODUITS = [];       // le catalogue à plat (comptoir/catalogue.js)
let FAMILLES = [];       // les faces déclarées, par famille (tailles de logo)

// Les faces que la famille de l'article déclare. C'est la MÊME déclaration que
// le comptoir : « un tote bag a deux faces, une casquette une seule ». Une
// famille qui n'en déclare pas n'affiche rien — pas de zone inventée.
function facesDe(famille) {
  const cle = reduire(famille).trim().replace(/s$/, '');
  const f = FAMILLES.find((x) => reduire(x.nom).trim().replace(/s$/, '') === cle);
  return f && Array.isArray(f.faces) ? f.faces : [];
}

async function charger() {
  const [clients, table] = await Promise.all([
    fetch('/api/clients').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch('/api/tailles-logo').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  CLIENTS = Array.isArray(clients) ? clients.map((c) => ({
    ...c, cherche: reduire([c.entreprise, c.contact, c.telephone, c.email].filter(Boolean).join(' ')),
  })) : [];
  FAMILLES = (table && Array.isArray(table.familles)) ? table.familles : [];
  PRODUITS = typeof window.catalogueAPlat === 'function' ? window.catalogueAPlat() : [];
}

// Un intitulé qui coiffe un GROUPE et non une case se relie par
// `aria-labelledby` : le `for=` n'aurait rien à viser.
function bloc(titre) {
  const b = el('section', 'ec-bloc');
  b.append(el('h3', 'ec-bloc__titre', titre));
  return b;
}

export function monterEclair(hote, api) {
  let etat = etatNeuf();
  const ecran = el('div', 'ec');
  let peindreTotal = () => {};
  let peindreArticles = () => {};

  // --- Le message : il SORT DU FLUX, il ne pousse personne ------------------
  const message = el('p', 'ec-msg msg-flottant');
  message.setAttribute('role', 'status');
  message.hidden = true;
  const dire = (txt, echec) => {
    message.textContent = txt;
    message.classList.toggle('ec-msg--echec', Boolean(echec));
    message.hidden = !txt;
  };

  // --- 1. LA NATURE, en premier : c'est la question qu'on pose au client ----
  // « Payez-vous maintenant ? » sépare les deux flux, et elle décide de tout le
  // reste — un devis n'a ni prix ni encaissement.
  const barre = el('div', 'ec-nature');
  const boutons = {};
  for (const [id, label] of [['vente', 'Vente directe'], ['devis', 'Demande de devis']]) {
    const b = el('button', 'ec-nature__b', label);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (etat.nature === id) return;
      etat.nature = id;
      for (const [k, n] of Object.entries(boutons)) {
        n.classList.toggle('is-on', k === id);
        n.setAttribute('aria-pressed', String(k === id));
      }
      ecran.classList.toggle('ec--devis', id === 'devis');
      peindreArticles();
      peindreTotal();
    });
    boutons[id] = b;
    barre.append(b);
  }
  boutons.vente.classList.add('is-on');
  boutons.vente.setAttribute('aria-pressed', 'true');
  boutons.devis.setAttribute('aria-pressed', 'false');

  // --- 2. LE CLIENT : un champ, et la fiche arrive avec ---------------------
  // Choisir une fiche apporte le téléphone, l'e-mail et l'adresse : ils
  // s'AFFICHENT, ils ne se retapent pas. C'est la moitié des champs mesurés
  // « une fois sur deux » qui disparaît du chemin sans rien perdre.
  const bClient = bloc('Client');
  const hoteClient = el('div', 'ec-client');
  const carte = el('div', 'ec-client__carte');
  carte.hidden = true;
  bClient.append(hoteClient, carte);

  const poserClient = (c) => {
    etat.client = c;
    carte.replaceChildren();
    if (!c) { carte.hidden = true; hoteClient.hidden = false; return; }
    const nom = el('strong', 'ec-client__nom', nomDuClient(c));
    const dessous = el('span', 'ec-client__sous',
      c.nouveau
        ? 'Nouvelle fiche — elle sera créée avec le dossier'
        : [c.telephone, c.email, c.ville].filter(Boolean).join(' · ') || 'Fiche sans coordonnées');
    const changer = el('button', 'ec-lien', 'Changer');
    changer.type = 'button';
    changer.addEventListener('click', () => {
      poserClient(null);
      combo.vider();
      combo.champ.focus();
    });
    carte.append(el('div', 'ec-client__id', null), changer);
    carte.firstChild.append(nom, dessous);
    carte.hidden = false;
    hoteClient.hidden = true;
  };

  const combo = listeFiltrante(hoteClient, {
    invite: 'Nom du client, téléphone…',
    chercher: (q) => {
      const r = reduire(q);
      if (r.length < 2) return [];
      const trouves = CLIENTS.filter((c) => c.cherche.includes(r)).slice(0, 8)
        .map((c) => ({
          titre: nomDuClient(c),
          note: [c.contact, c.telephone].filter(Boolean).join(' · '),
          fiche: c,
        }));
      // AUCUNE FICHE NE CORRESPOND : on ne renvoie pas la vendeuse dans un
      // autre écran. Le nom tapé devient la fiche, et le reste se remplira
      // plus tard — mesuré : e-mail 51 %, adresse 40 %, secteur 38 %. Exiger
      // ce que la moitié des dossiers n'a pas, c'est bloquer devant le client.
      trouves.push({ titre: `Nouveau client : « ${q.trim()} »`, note: 'créée avec le dossier', neuf: q.trim() });
      return trouves;
    },
    choisir: (c) => poserClient(c.neuf ? { nouveau: true, nom: c.neuf, tel: '' } : c.fiche),
  });

  // --- 3. LES ARTICLES : une rangée, et on recommence ----------------------
  // C'EST LA BOUCLE QUI FAIT LA VITESSE. Produit, quantité, prix, Entrée — la
  // ligne est posée et le curseur revient au produit. Trois articles se
  // saisissent sans jamais lâcher le clavier ni jamais y être obligé : chaque
  // case se clique aussi bien.
  const bArt = bloc('Articles');
  const rangee = el('div', 'ec-rangee');
  const hoteProduit = el('div', 'ec-rangee__produit');
  const qte = el('input', 'ec-rangee__qte');
  qte.type = 'number'; qte.min = '1'; qte.step = '1'; qte.placeholder = '1';
  qte.setAttribute('aria-label', 'Quantité');
  const prix = el('input', 'ec-rangee__prix');
  prix.type = 'number'; prix.min = '0'; prix.step = '0.01'; prix.placeholder = 'Prix TTC';
  prix.setAttribute('aria-label', 'Prix TTC de la ligne');
  const ajouter = el('button', 'ec-rangee__ok', 'Ajouter');
  ajouter.type = 'button';
  rangee.append(hoteProduit, qte, prix, ajouter);

  const liste = el('div', 'ec-articles');
  bArt.append(rangee, liste);

  // Ce que la rangée tient en ce moment. Le produit choisi apporte sa famille
  // et sa couleur : la vendeuse n'a jamais à les retaper.
  let enCours = null;

  const produit = listeFiltrante(hoteProduit, {
    invite: 'Produit — « tc 06 », « porte-clés »…',
    chercher: (q) => {
      const r = reduire(q);
      if (!r) return [];
      const mots = r.split(/\s+/).filter(Boolean);
      return PRODUITS.filter((p) => mots.every((m) => p.cherche.includes(m)))
        .slice(0, 9)
        .map((p) => ({ titre: p.texte, note: p.famille, p }));
    },
    choisir: (c) => {
      enCours = c.p;
      produit.poser(c.p.texte);
      qte.focus();
      qte.select();
    },
    // Entrée sur un produit hors catalogue : la ligne se pose quand même, sous
    // le nom tapé. Un produit qu'on ne vend pas encore ne doit pas arrêter la
    // vente — c'est exactement ce qui bloquait devant le client.
    entree: (v) => {
      if (!v) return;
      enCours = { famille: 'Hors catalogue', label: v, color: '', texte: v };
      qte.focus();
    },
  });

  function poserArticle() {
    if (!enCours) { dire('Choisis un produit — ou tape son nom et fais Entrée.', true); produit.champ.focus(); return; }
    const n = Math.max(1, Math.round(Number(qte.value) || 1));
    const p = etat.nature === 'devis' ? 0 : Number(prix.value) || 0;
    if (etat.nature === 'vente' && p <= 0) {
      dire('Indique le prix TTC de la ligne — une vente sans prix ne s’encaisse pas.', true);
      prix.focus();
      return;
    }
    etat.articles.push({
      famille: enCours.famille, label: enCours.label, color: enCours.color || '',
      ref: '', technique: '', qte: n, prixTtc: p, note: '', zones: [],
    });
    enCours = null;
    produit.vider();
    qte.value = '';
    prix.value = '';
    dire('');
    peindreArticles();
    peindreTotal();
    produit.champ.focus();
  }

  ajouter.addEventListener('click', poserArticle);
  for (const champ of [qte, prix]) {
    champ.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (champ === qte && etat.nature === 'vente') { prix.focus(); prix.select(); return; }
      poserArticle();
    });
  }

  // Une ligne posée se relit et se corrige SUR PLACE : la quantité et le prix
  // restent des champs. Rouvrir un formulaire pour changer un chiffre, c'est
  // le geste qu'on vient de supprimer.
  peindreArticles = () => {
    const demande = etat.nature === 'devis';
    prix.hidden = demande;
    liste.replaceChildren(...etat.articles.map((a, i) => {
      const carteA = el('div', 'ec-art');
      const tete = el('div', 'ec-art__tete');
      tete.append(el('strong', 'ec-art__nom', a.label + (a.color ? ` — ${a.color}` : '')));

      const nQte = el('input', 'ec-art__qte');
      nQte.type = 'number'; nQte.min = '1'; nQte.step = '1'; nQte.value = String(a.qte);
      nQte.setAttribute('aria-label', `Quantité de ${a.label}`);
      nQte.addEventListener('input', () => {
        a.qte = Math.max(1, Math.round(Number(nQte.value) || 1));
        peindreTotal();
      });

      const nPrix = el('input', 'ec-art__prix');
      nPrix.type = 'number'; nPrix.min = '0'; nPrix.step = '0.01'; nPrix.value = a.prixTtc ? String(a.prixTtc) : '';
      nPrix.setAttribute('aria-label', `Prix TTC de ${a.label}`);
      nPrix.hidden = demande;
      nPrix.addEventListener('input', () => { a.prixTtc = Number(nPrix.value) || 0; peindreTotal(); });

      const oter = el('button', 'ec-art__oter', '✕');
      oter.type = 'button';
      oter.title = 'Retirer cet article';
      oter.setAttribute('aria-label', `Retirer ${a.label}`);
      oter.addEventListener('click', () => {
        etat.articles.splice(i, 1);
        peindreArticles();
        peindreTotal();
      });

      // LA CARTE NE DIT PAS DEUX FOIS LA MÊME CHOSE. L'intitulé du catalogue
      // porte déjà la famille (« Tasse céramique 350 ml TC 06 ») : la répéter
      // à côté ne dit rien de plus et vole la place au nom.
      if (!reduire(a.label).startsWith(reduire(a.famille))) {
        tete.append(el('span', 'ec-art__fam', a.famille));
      }
      tete.append(nQte, nPrix, oter);
      carteA.append(tete);

      // LES FACES DE L'ARTICLE, si sa famille en déclare. Une tasse en a trois,
      // une casquette une seule, un textile six — et une famille qui n'en
      // déclare pas n'affiche rien. Ce qu'on écrit ici est une CONSIGNE (« logo
      // client », une phrase à graver), jamais une mesure : la largeur se prend
      // à l'établi, et le ticket sort déjà un trait pour l'écrire.
      const faces = facesDe(a.famille);
      if (faces.length) {
        const zone = el('div', 'ec-art__faces');
        for (const face of faces) {
          const cel = el('label', 'ec-face');
          cel.append(el('span', 'ec-face__nom', face));
          const ch = el('input', 'ec-face__quoi');
          ch.type = 'text';
          ch.placeholder = 'Ce qu’on marque ici';
          const dejaLa = (a.zones || []).find((z) => z.face === face);
          ch.value = dejaLa ? dejaLa.quoi : '';
          ch.addEventListener('input', () => {
            const v = ch.value.trim();
            a.zones = (a.zones || []).filter((z) => z.face !== face);
            // Une face vide n'est pas une zone : une carte vide sur le papier
            // finit par être remplie de n'importe quoi.
            if (v) a.zones.push({ face, quoi: v });
          });
          cel.append(ch);
          zone.append(cel);
        }
        carteA.append(zone);
      }
      return carteA;
    }));
    if (!etat.articles.length) {
      liste.append(el('p', 'ec-vide', 'Aucun article. Tape un nom de produit ci-dessus.'));
    }
  };

  // --- 4. CONCLURE : la date, l'argent, et le bouton -----------------------
  const bFin = bloc('Conclure');
  const grille = el('div', 'ec-fin');

  const cel = (intitule, champ, id) => {
    const c = el('div', 'ec-cel');
    const l = el('label', 'ec-cel__lab', intitule);
    l.setAttribute('for', id);
    champ.id = id;
    c.append(l, champ);
    return c;
  };

  const dRetrait = el('input');
  dRetrait.type = 'date';
  dRetrait.value = etat.retrait;
  dRetrait.addEventListener('change', () => { etat.retrait = dRetrait.value || dansNJours(0); });

  const hRetrait = el('select');
  for (const h of ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00']) {
    const o = el('option', null, h);
    o.value = h;
    if (h === etat.heure) o.selected = true;
    hRetrait.append(o);
  }
  hRetrait.addEventListener('change', () => { etat.heure = hRetrait.value; });

  const mPaiement = el('select');
  mPaiement.append(Object.assign(el('option', null, 'Au retrait'), { value: '' }));
  for (const m of MODES) mPaiement.append(Object.assign(el('option', null, m.label), { value: m.id }));
  mPaiement.addEventListener('change', () => { etat.paiement = mPaiement.value; });

  const celPaiement = cel('Paiement', mPaiement, 'ec-paiement');
  grille.append(cel('Récupération', dRetrait, 'ec-retrait'), cel('Heure', hRetrait, 'ec-heure'), celPaiement);

  // LE VOLET DE CE QUI EST RAREMENT REMPLI. Mesuré sur les 184 dossiers réels :
  // ces champs-là sont vides trois fois sur quatre. Les laisser sur le chemin,
  // c'est faire traverser quatre cases vides à chaque client. Ils ne sont pas
  // supprimés pour autant — le jour où le client donne son e-mail, il a un
  // endroit où aller.
  const volet = el('details', 'ec-plus');
  volet.append(el('summary', null, 'Compléter le dossier'));
  const dedans = el('div', 'ec-plus__corps');
  const contact = el('input'); contact.type = 'text'; contact.placeholder = 'Prénom Nom';
  contact.addEventListener('input', () => { etat.contact = contact.value.trim(); });
  const email = el('input'); email.type = 'email'; email.placeholder = 'nom@exemple.fr';
  email.addEventListener('input', () => { etat.email = email.value.trim(); });
  const canal = el('select');
  canal.append(Object.assign(el('option', null, 'Non précisé'), { value: '' }));
  for (const c of ['Boutique', 'WhatsApp', 'Téléphone', 'E-mail', 'Instagram', 'Facebook', 'Recommandation']) {
    canal.append(Object.assign(el('option', null, c), { value: c }));
  }
  canal.addEventListener('change', () => { etat.canal = canal.value; });
  const note = el('textarea'); note.rows = 3; note.placeholder = 'Ce qu’il ne faut pas oublier';
  note.addEventListener('input', () => { etat.note = note.value.trim(); });
  dedans.append(
    cel('Personne à contacter', contact, 'ec-contact'),
    cel('E-mail', email, 'ec-email'),
    cel('Canal d’entrée', canal, 'ec-canal'),
    cel('Note interne', note, 'ec-note'),
  );
  volet.append(dedans);

  // LE PIED : le total et l'action, ensemble. L'action qui engage est le
  // DERNIER élément à droite.
  const pied = el('div', 'ec-pied');
  const total = el('div', 'ec-total');
  const envoyer = el('button', 'ec-envoyer');
  envoyer.type = 'button';

  peindreTotal = () => {
    const demande = etat.nature === 'devis';
    celPaiement.hidden = demande;
    const n = etat.articles.length;
    const pieces = totalPieces(etat);
    total.replaceChildren(
      el('span', 'ec-total__k', demande ? 'À chiffrer' : 'Total TTC'),
      el('span', 'ec-total__v', demande
        ? `${n} article${n > 1 ? 's' : ''} · ${pieces} pièce${pieces > 1 ? 's' : ''}`
        : euro(totalTtc(etat))),
    );
    envoyer.textContent = demande ? 'Enregistrer la demande' : 'Enregistrer la vente';
  };

  envoyer.addEventListener('click', async () => {
    if (!etat.client) { dire('Choisis un client — ou tape son nom pour créer sa fiche.', true); combo.champ.focus(); return; }
    if (!etat.articles.length) { dire('Ajoute au moins un article.', true); produit.champ.focus(); return; }
    if (etat.nature === 'vente' && totalTtc(etat) <= 0) { dire('Une vente porte un prix.', true); return; }
    envoyer.disabled = true;
    dire('Enregistrement au planning…');
    try {
      await api.enregistrer(payloadDe(etat));
      // Le dossier est parti : on repart NET pour le client suivant. C'est le
      // comptoir — on ne cherche jamais un brouillon entre deux personnes.
      etat = etatNeuf();
      enCours = null;
      poserClient(null);
      combo.vider();
      produit.vider();
      qte.value = ''; prix.value = '';
      contact.value = ''; email.value = ''; note.value = ''; canal.value = '';
      dRetrait.value = etat.retrait;
      hRetrait.value = etat.heure;
      mPaiement.value = '';
      volet.open = false;
      peindreArticles();
      peindreTotal();
      dire('');
    } catch (err) {
      // Un dossier qui ne part pas ne disparaît JAMAIS en silence : la vendeuse
      // a le client devant elle, et tout ce qu'elle a tapé est encore là.
      dire(`Enregistrement impossible : ${err.message}. Le dossier est intact — réessaie.`, true);
    } finally {
      envoyer.disabled = false;
    }
  });

  pied.append(total, envoyer);

  // LA PORTE VERS LA VOIE LONGUE, écrite en clair. Le chiffrage textile (moteur
  // V9) et le brief complet d'une demande vivent là-bas : une voie rapide qui
  // ferait semblant de tout savoir faire enverrait des prix inventés en
  // production.
  const sortie = el('p', 'ec-sortie');
  const versLong = el('button', 'ec-lien', 'Ouvrir la saisie complète');
  versLong.type = 'button';
  versLong.addEventListener('click', () => api.ouvrirParcours(etat.nature));
  sortie.append(el('span', null, 'Chiffrage textile, négociation, brief détaillé : '), versLong);

  ecran.append(barre, message, bClient, bArt, bFin, volet, pied, sortie);
  bFin.append(grille);
  hote.replaceChildren(ecran);

  poserClient(null);
  peindreArticles();
  peindreTotal();
  charger().then(() => { peindreArticles(); });

  return {
    // Repartir de zéro : appelé quand on revient sur l'onglet Nouveau Projet.
    reinitialiser() {
      etat = etatNeuf();
      enCours = null;
      poserClient(null);
      combo.vider(); produit.vider();
      qte.value = ''; prix.value = '';
      contact.value = ''; email.value = ''; note.value = ''; canal.value = '';
      dRetrait.value = etat.retrait; hRetrait.value = etat.heure; mPaiement.value = '';
      volet.open = false;
      boutons.vente.click();
      dire('');
      peindreArticles();
      peindreTotal();
    },
    // Y a-t-il quelque chose de tapé et pas encore parti ? Le planning s'en
    // sert avant de recharger l'écran pour une mise à jour.
    enSaisie() {
      return Boolean(etat.client || etat.articles.length);
    },
  };
}
