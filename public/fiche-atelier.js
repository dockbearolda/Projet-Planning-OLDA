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

// LE PICTOGRAMME, MEME FABRIQUE QUE PARTOUT AILLEURS (`ic`, comme clients.js,
// reglages.js et tailles-logos.js) : c'est cette forme-la que le garde-fou de la
// police sait lire, et il n'y a que 91 ligatures dans olda-icones.woff2 — un nom
// absent s'affiche EN TEXTE, coupe a 1 em, sans lever la moindre erreur.
const ic = (name, cls) => {
  const n = el('span', `material-symbols-outlined${cls ? ` ${cls}` : ''}`, name);
  n.setAttribute('aria-hidden', 'true');
  return n;
};

// LE CALENDRIER EST CELUI DU COMPTOIR (30/08). Charlie, en designant le champ
// « Retrait » : « ici je veux un calendrier, le meme que l'autre ». Le meme,
// litteralement : le composant a ete sorti de `comptoir/pont.js` vers
// `calendrier.js`, que les trois ecrans lisent. Cf. l'entete de ce module-la.
import { calendrierOuvrir } from './calendrier.js';

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

// ELLE SERT A LA SAISIE LIBRE DU MENU (30/08). L'heure se CHOISIT dans une
// liste de creneaux — elle etait donc partie le matin — mais Charlie a demande
// de pouvoir « ajouter sa propre heure » depuis ce menu : la case qui s'ouvre
// alors accepte « 1430 » et doit rendre « 14h30 ».
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
//   ctx.ouvrirClient()             → la fiche du client, dans son onglet
export function dessinerFicheAtelier(r, ctx) {
  const fiche = r.fiche && typeof r.fiche === 'object' ? r.fiche : {};
  // LA COLONNE DE PRODUCTION EXISTE MEME SANS `fiche.prod` (29/08). Elle etait
  // conditionnee a sa presence — et `fiche.prod` n'existe sur AUCUN des 187
  // dossiers de la production, mesure ce jour-la : la structure est posterieure
  // au comptoir qui les a crees. Sur un dossier reel, la colonne se resumait
  // donc a la date « Prevu a l'atelier », et le jour ou celle-ci est retiree
  // (meme date, demande de Charlie) il ne restait plus qu'un titre et un filet.
  // La reference, la couleur, la technique, le marquage et les FACES se
  // remplissent maintenant sur n'importe quel dossier — c'est « je clique sur la
  // ligne et je peux TOUT modifier », qui n'avait jamais valu pour ces 187-la.
  // Cote serveur, `corrigerProd` accepte desormais une fiche sans `prod`.
  const prod = fiche.prod && typeof fiche.prod === 'object' ? fiche.prod : {};

  const racine = el('div', 'fa');
  // --- Ce qui dit que ca s'enregistre --------------------------------------
  // LA PASTILLE DE CONFIRMATION EST RETIREE (30/08). Charlie, en designant le
  // menu du reglement : « une fois selectionne, sur la validation c'est moche,
  // je n'aime pas du tout, il faut quelque chose de ultra rapide ».
  //
  // ELLE ETAIT CASSEE, et pas seulement de trop : elle vivait dans un calque
  // pose sur la RACINE, alors que l'echelle de la fiche etait declaree sur la
  // CARTE. Ses `var(--fa-coche)` ne resolvaient donc rien — ni largeur, ni
  // hauteur, ni interligne — et le rond de 16 px sortait en losange de
  // 14,3 x 23,4 px, le crochet decale dedans. (Les jetons sont remontes sur la
  // racine par la meme occasion : le message du bas les lisait de travers lui
  // aussi, son bouton « Annuler » sortait en 17 px au lieu de 14.)
  //
  // ET LE MESSAGE DU BAS NE DIT PLUS LES REUSSITES (30/08, deuxieme passe).
  // Charlie : « y'a une grande barre noire qui s'affiche une fois que j'ai
  // selectionne, il faut supprimer ca ». Elle etait grande PAR DEFAUT : un
  // accolade orpheline, laissee la veille en retirant l'animation de la
  // pastille, avalait la regle qui posait la zone du message — sans elle, plus
  // de `position: absolute`, plus de `left: 20px`, et la pastille noire du
  // coin s'etalait sur les 1440 px de l'ecran, haute de 53.
  // L'accolade est reparee, ET le message se tait sur les reussites : trois
  // confirmations pour une frappe, il n'en reste qu'UNE, le point de l'entete.
  //
  // CE QUE CA COUTE, et c'est le prix decide : « Annuler » etait la SEULE porte
  // de la pile d'annulation. Elle part avec le message, la pile aussi. Sur cette
  // fiche chaque champ se corrige la ou il se lit — defaire, c'est retaper.
  //
  // LE MESSAGE RESTE POUR LES REFUS : « le vert se tait, l'echec parle ». Il ne
  // s'affiche donc plus que quand on demande quelque chose d'impossible.
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
  const dire = (message) => {
    zoneToast.replaceChildren();
    const t = el('div', 'fa-toast');
    t.append(el('span', null, message));
    zoneToast.append(t);
    clearTimeout(minuteurToast);
    minuteurToast = setTimeout(() => zoneToast.replaceChildren(), 6000);
  };

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
      pulser();
      opts.apres && opts.apres();
    };
    // UN MENU REND LA MAIN DES QU'ON A CHOISI (30/08). Charlie : « une fois
    // selectionne, le contour rond de l'input disparait directement, avant
    // qu'on reclique dessus ». Un `<select>` garde le focus apres un choix —
    // donc son lisere d'accent restait allume sur un champ qu'on ne remplit
    // plus, jusqu'au clic suivant N'IMPORTE OU. On le rend, tout de suite.
    // Le retrait est HORS de `commettre` : le lisere doit tomber meme quand on
    // rechoisit la meme valeur, cas ou `commettre` s'arrete avant d'agir.
    if (champ.tagName === 'SELECT') {
      champ.addEventListener('change', () => { commettre(); champ.blur(); });
    } else {
      champ.addEventListener('blur', commettre);
    }
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

  // UN MENU HABILLE, ECRIT UNE FOIS (30/08). L'ecran en porte maintenant DEUX —
  // les faces a marquer et l'heure du retrait — et ils font le meme travail :
  // ouvrir un panneau sous leur bouton, le refermer sur un clic dehors ou sur
  // Echap, rendre le focus. Ecrits chacun de leur cote, ils divergeraient au
  // premier correctif ; c'est la regle de la maison, deux choses de la meme
  // famille tiennent dans UNE ecriture.
  //
  // ⚠ LE PANNEAU VIT DANS LA RANGEE, en absolu : pose sur le document, il
  // resterait accroche a l'ecran pendant que la fiche defile sous lui.
  // ⚠ ECHAP EST PRIS EN CAPTURE, ET ON S'ARRETE LA : l'ecouteur d'app.js ferme
  // la FICHE sur Echap — sans ca, refermer le menu refermait le dossier derriere.
  const menuHabille = (declencheur, ancre, remplir) => {
    let pan = null;
    function dehors(ev) {
      if (!pan || pan.contains(ev.target) || declencheur.contains(ev.target)) return;
      fermer();
    }
    function clavier(ev) {
      if (ev.key !== 'Escape' || !pan) return;
      ev.preventDefault();
      ev.stopPropagation();
      fermer();
      declencheur.focus();
    }
    function fermer() {
      if (!pan) return;
      document.removeEventListener('pointerdown', dehors, true);
      document.removeEventListener('keydown', clavier, true);
      pan.remove();
      pan = null;
      declencheur.setAttribute('aria-expanded', 'false');
    }
    const ouvrir = () => {
      pan = el('div', 'fa-menu');
      pan.setAttribute('role', 'menu');
      remplir(pan);
      ancre.append(pan);
      declencheur.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', dehors, true);
      document.addEventListener('keydown', clavier, true);
      const premier = pan.querySelector('button');
      if (premier) premier.focus();
    };
    declencheur.setAttribute('aria-haspopup', 'menu');
    declencheur.setAttribute('aria-expanded', 'false');
    return { ouvrir, fermer, bascule: () => (pan ? fermer() : ouvrir()) };
  };

  // LA RANGEE D'UN PANNEAU EST CELLE DU TIROIR « COLONNES » (`.colbar-item`,
  // dans styles.css) : meme boite, meme hauteur, meme icone. Deux listes de la
  // meme application ne s'ecrivent pas deux fois.
  // ⚠ ELLE RECOIT L'ICONE DEJA FAITE, pas son nom : la police n'a que 91
  // ligatures et `test/police-icones.test.js` verifie chaque nom pose — il les
  // lit dans les appels a `ic(…)`. Un nom qui transiterait par ici ne serait
  // verifie par personne, et une ligature absente s'ecrit en toutes lettres
  // dans la boite sans qu'aucune erreur ne le dise.
  const ligneMenu = (icone, texte, faire, cls) => {
    const b = bouton(`colbar-item${cls ? ` ${cls}` : ''}`, null, faire);
    b.append(icone, el('span', 'colbar-item__label', texte));
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
    // L'APPARTENANCE AU LOT EST UNE IDENTITÉ, pas un rappel de pied de page.
    // « Article 2 sur 3 du ticket … » vivait dans le bloc gris du bas, retiré le
    // 29/08 — dont l'autre ligne redisait mot pour mot le nom du produit affiché
    // trois centimètres plus haut. Ce fait-là ne se redit nulle part : il prend
    // sa place ici, dans la même étiquette en capitales que la référence.
    // Vide sur un dossier ordinaire : `:empty` le retire de la rangée.
    el('span', 'fa-ref', ctx.lotDossier || ''),
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
      pulser();
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
    // LA DATE ISO VIT DANS UN CHAMP QU'ON NE VOIT PAS. Le calendrier n'ecrit
    // que dans un `input[type=date]` ; le champ qu'on lit, lui, porte
    // « sam. 05/09 » et accepte encore « demain », « +3 », « lundi ». Deux
    // roles, deux champs — c'est le meme montage que sur l'ecran de devis, ou
    // la date se choisit dans une liste.
    const fantome = el('input', 'date-fantome');
    fantome.type = 'date';
    fantome.tabIndex = -1;
    fantome.setAttribute('aria-hidden', 'true');
    fantome.value = String(valeurIso || '').slice(0, 10);
    brancher(c, {
      label,
      normaliser: (v) => normaliserDate(v, ctx.aujourdhui && ctx.aujourdhui()),
      // LE FANTOME SUIT, Y COMPRIS QUAND ON ANNULE : sinon le calendrier
      // rouvrirait sur le jour qu'on vient de defaire, et le cerclerait.
      envoyer: (n) => { fantome.value = n.iso || ''; envoyer(n.iso); },
      apres: opts.apres,
    });
    // LE CLIC OUVRE LE CALENDRIER, LE CLAVIER GARDE LA SAISIE. On prend le
    // `pointerdown` — donc le champ ne prend pas le curseur a la souris — mais
    // la tabulation l'atteint toujours, et ce qu'on y tape passe par le meme
    // `blur` qu'avant. Charlie : « qui se deroule quand je clique dessus ».
    c.setAttribute('aria-haspopup', 'dialog');
    c.setAttribute('aria-expanded', 'false');
    c.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      calendrierOuvrir(fantome, c);
    });
    // CE QUE LE CALENDRIER POSE PASSE PAR LE MEME CHEMIN QUE LA FRAPPE : on
    // ecrit l'ISO dans le champ visible et on lui rend son `blur`. Il
    // normalise (« sam. 05/09 »), envoie, empile l'annulation et dit
    // « Enregistre » — une deuxieme ecriture ici aurait perdu ces trois-la.
    fantome.addEventListener('change', () => {
      c.value = fantome.value;
      c.dispatchEvent(new Event('blur'));
    });
    return { champ: c, fantome };
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
  // L'HEURE SE CHOISIT DANS LE MEME MENU QUE LES FACES (30/08). Charlie, en deux
  // fois : « les heures ici doivent etre un menu deroulant de 9h30 a 11h30 et
  // 14h a 17h avec toutes les demi-heures », puis « on doit pouvoir ajouter sa
  // propre heure avec "ajouter" dans l'input ».
  //
  // C'EST LE MENU HABILLE DE LA FICHE, pas une liste du navigateur. Deux
  // raisons : la liste native se deroule ou Chrome veut — parfois vers le haut,
  // ce que Charlie a refuse le meme jour — et surtout elle n'a pas de panneau,
  // donc pas d'endroit ou poser « Autre heure… » autrement qu'en option
  // deguisee en valeur. Le menu des faces, a deux rangees de la, sait deja
  // faire les deux : c'est le meme composant.
  //
  // LA LISTE EST L'AMPLITUDE OU L'ATELIER RECOIT. La frappe libre laissait
  // poser « 06h00 » ou « 23h30 », des heures ou personne n'est la, et le rappel
  // de delai comptait dessus. Elle reste possible — « Autre heure… » — mais
  // c'est un geste de plus, pas le geste par defaut.
  // ⚠ UNE HEURE HORS LISTE NE SE PERD PAS. Les dossiers du comptoir en portent
  // (« 06:00 » sur celui de demonstration) : un menu qui ne la propose pas la
  // rendrait VIDE a l'affichage, et la premiere ecriture l'effacerait sans que
  // rien ne le dise. Elle entre donc dans la liste, a sa place.
  const CRENEAUX = ['09:30', '10:00', '10:30', '11:00', '11:30',
    '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00'];
  const heureLisible = (h) => `${Number(String(h).slice(0, 2))}h${String(h).slice(3, 5)}`;
  let heureChoisie = fiche.heureSouhaitee ? String(fiche.heureSouhaitee).slice(0, 5) : '';
  const creneaux = () => (!heureChoisie || CRENEAUX.includes(heureChoisie)
    ? CRENEAUX
    : [...CRENEAUX, heureChoisie].sort());

  const chHeure = bouton('fa-choix fa-mini');
  chHeure.setAttribute('aria-label', 'Heure de retrait');
  const direHeure = () => {
    chHeure.replaceChildren(
      document.createTextNode(heureChoisie ? heureLisible(heureChoisie) : 'heure'),
      ic('expand_more'));
    chHeure.classList.toggle('fa-choix--vide', !heureChoisie);
  };
  direHeure();
  const poserHeure = (h) => {
    const propre = h || '';
    if (propre === heureChoisie) return;
    heureChoisie = propre;
    heureRemise = propre || null;
    direHeure();
    ctx.patchFiche({ heureSouhaitee: heureRemise });
    pulser();
    majRappel();
  };

  // PAS DE `prompt()`, ici non plus : la case prend la place du bouton, sur la
  // meme rangee — rien ne se deplace, et Echap rend la main. Meme geste que
  // « Autre face… ».
  const saisirHeure = () => {
    const saisie = champ('fa-quoi fa-mini', '', { label: 'Heure de retrait', placeholder: '1430' });
    const finir = (garder) => {
      const lu = garder ? normaliserHeure(saisie.value) : '';
      saisie.replaceWith(chHeure);
      if (lu) poserHeure(lu.replace('h', ':'));
    };
    saisie.addEventListener('blur', () => finir(true));
    saisie.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); saisie.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); finir(false); }
    });
    chHeure.replaceWith(saisie);
    saisie.focus();
  };

  const remise = ligneDate('Retrait par le client', r.deadline,
    { requis: true, apres: majRappel },
    (iso) => { isoRemise = iso; ctx.patchLigne('deadline', iso); });

  const quand = el('div', 'fa-quand fa-row--ancre');
  quand.append(remise.champ, chHeure);
  const menuHeure = menuHabille(chHeure, quand, (pan) => {
    for (const h of creneaux()) {
      const on = h === heureChoisie;
      // PAS DE PETIT CARRE A COTE DES HEURES (30/08, Charlie). Une case a cocher
      // annonce qu'on peut en prendre PLUSIEURS — c'est vrai des faces, faux
      // d'une heure. Celle qui est choisie porte une coche, les autres ne
      // portent rien : la BOITE de l'icone reste, vide, sinon leurs intitules
      // partiraient d'un rail different de celui de la coche.
      const b = ligneMenu(on ? ic('check', 'colbar-item__ic') : el('span', 'colbar-item__ic'),
        heureLisible(h), () => { menuHeure.fermer(); poserHeure(h); }, on ? 'is-on' : 'is-off');
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(on));
      pan.append(b);
    }
    // CE QUI N'EST PAS UN CRENEAU VIT SOUS LE FILET, avec sa propre icone :
    // pose comme une ligne parmi les autres, « Autre heure… » se choisit par
    // erreur — et ce qu'elle ouvre n'est pas une heure, c'est un champ.
    pan.append(el('div', 'fa-filet'));
    pan.append(ligneMenu(ic('add', 'colbar-item__ic'), 'Autre heure…',
      () => { menuHeure.fermer(); saisirHeure(); }));
    if (heureChoisie) {
      pan.append(ligneMenu(ic('close', 'colbar-item__ic'), 'Sans heure',
        () => { menuHeure.fermer(); poserHeure(''); }));
    }
  });
  chHeure.addEventListener('click', () => menuHeure.bascule());

  majRappel();

  // « PRÉVU À L'ATELIER » EST RETIRÉE (29/08, Charlie). C'était la seule date de
  // la colonne de production, et une deuxieme date a tenir a jour a cote de
  // celle qu'on a promise au client. La colonne `date_prevue` reste en base —
  // elle porte l'historique — elle n'est simplement plus editee ici.
  //
  // LE FILET PASSE SOUS LE TITRE, DES DEUX COTES. Il separait la DATE du detail :
  // a droite il n'y a plus de date, et laisser la regle telle quelle aurait fait
  // partir la colonne de droite 71 px au-dessus de sa voisine. Sous le titre, il
  // souligne la zone — meme geste a gauche et a droite, et les quatre premieres
  // rangees des deux colonnes retombent sur la meme ligne.
  // TROIS ZONES, TROIS MOTS : Client, Production, Paiement — ceux de Charlie.

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

  // LA RANGEE « DOCUMENTS » EST RETIREE (30/08). Charlie a designe les trois
  // morceaux — l'intitule et les deux boutons : « tout ca tu supprimes ».
  // Elle sortait un recapitulatif en .txt et ouvrait un brouillon d'e-mail dans
  // le client mail du poste : deux sorties de secours sur la seule colonne qui
  // parle du client, la ou on vient corriger un nom et un telephone.
  // `telechargerRecap` et `envoyerParEmail` sont partis avec elle dans app.js :
  // plus rien ne les appelait. Le recapitulatif en TEXTE, lui, reste — c'est
  // `ticketTexte`, que la boite du ticket copie toujours dans le presse-papier.

  // DEUX PAIRES PAR LIGNE (29/08). Charlie : « ça doit tenir sur 2 lignes ».
  // Six champs sur six lignes, chacune avec 400 px de vide a droite : la
  // colonne descendait pour rien. La grille passe a quatre pistes — intitule,
  // valeur, intitule, valeur — et les six tiennent sur trois lignes, dont les
  // deux premieres portent tout ce qu'il demandait. Le telephone et la personne
  // a joindre restent ensemble : c'est UN fait, « qui on appelle ».
  const blocClient = el('section', 'fa-groupe');
  const grilleClient = el('div', 'fa-grille-client');
  grilleClient.append(
    // LE RETRAIT ENTRE DANS LA GRILLE (30/08). Charlie : « realigne
    // verticalement et horizontalement tout ce que tu peux ». Il vivait dans
    // une rangee a lui, en `flex` : sa date s'etirait sur ce qui restait et
    // l'heure demarrait a 347,2 px, la ou les trois rangees du dessous posent
    // leur deuxieme intitule a 364,5. Un rail de plus, sur la seule ligne qui
    // n'etait pas dans la grille — et l'heure n'avait meme pas d'intitule, elle
    // se devinait a son texte d'invite.
    el('label', 'fa-lab', 'Retrait'), quand,
    el('label', 'fa-lab', 'Délai'), rappel,
    el('label', 'fa-lab', 'Client'), chClient,
    el('label', 'fa-lab', 'Qui suit'), selQui,
    el('label', 'fa-lab', 'Contact'), chTel,
    el('label', 'fa-lab', 'Personne'), chPersonne,
    // VENUS DU PANNEAU DU BAS (29/08) : ils disent QUI est en face, pas
    // comment il paie. Ils etaient coinces entre le mode de reglement et le
    // champ de production.
    el('label', 'fa-lab', 'Type'), selType,
  );
  // TROIS CELLULES PAR RANGEE, TOUJOURS. La grille en a trois par ligne : un
  // menu pose seul apres son intitule n'en remplit que deux, et l'intitule
  // suivant part dans la troisieme colonne — c'est ce qui a jete « Provenance »
  // sur sa propre ligne, sous sa valeur.

  // LE FANTOME DE LA DATE VIT HORS DU FLUX (voir `ligneDate`) : pose dans la
  // grille il n'y prendrait pas de case — il est absolu — mais son voisinage
  // n'a plus a s'en soucier ici.
  blocClient.append(grilleClient, remise.fantome);

  // LES NOTES REMPLISSENT LA HAUTEUR QUI RESTE — quand il y en a. Sur le 14
  // pouces de l'atelier (630 px) il n'y a rien a distribuer : le champ reste
  // dans le panneau Details. Au-dela, il monte ici et occupe le vide, qui se
  // trouvait pile sous « Qui suit ». C'est le MEME champ qu'on deplace, jamais
  // un second : deux champs sur `description` s'ecraseraient l'un l'autre.
  gauche.append(titreSection('Client'), el('div', 'fa-filet'), blocClient);

  // =========================================================================
  // ZONE 4 — colonne droite : ce qu'il y a à produire
  // =========================================================================
  const droite = el('div', 'fa-col fa-col--d');
  // MEME FORME QUE LA COLONNE DE GAUCHE : un titre, un filet, puis le detail.
  // Le filet manquait ici — et comme il vaut 1 px plus un ecart, TOUTES les
  // lignes de droite tombaient 11 px au-dessus de leurs voisines de gauche.
  droite.append(titreSection('Production'), el('div', 'fa-filet'));

  {
    const idt = el('div', 'fa-grille-prod');
    // « TECHNIQUE » ET « PROVENANCE » SONT RETIREES (30/08, Charlie : « tout ca
    // supprime »). La technique du marquage (`prod.marquage`, « DTF ») continue
    // de s'imprimer sur le ticket de l'atelier — elle ne se corrige simplement
    // plus d'ici, et rien d'autre dans l'application ne l'ecrit.
    for (const [cle, label] of [['ref', 'Référence'], ['couleur', 'Couleur'],
      ['encre', 'Marquage']]) {
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
    const total = el('span', 'fa-taille__n', '0');
    const listeTailles = () => tailles.map((t) => ({ t: String(t.t), n: Number(t.n) || 0 }));
    const majTotal = () => { total.textContent = String(tailles.reduce((s, t) => s + (Number(t.n) || 0), 0)); };

    const grilleT = el('div', 'fa-tailles');
    tailles.forEach((taille, i) => {
      const case_ = el('div', 'fa-taille');
      const c = champ('fa-nb', taille.n, { label: `Taille ${taille.t}`, placeholder: '0', inputMode: 'numeric' });
      const poser = (n) => {
        const borne = Math.max(0, Math.round(Number(n) || 0));
        const ancien = Number(tailles[i].n) || 0;
        if (borne === ancien) return;
        tailles[i].n = borne;
        c.value = borne ? String(borne) : '';
        majTotal();
        const liste = listeTailles();
        Promise.resolve(ctx.patchProd({ tailles: liste })).then(reposerPrix);
      };
      c.addEventListener('blur', () => {
        const avant = Number(tailles[i].n) || 0;
        const vise = Math.max(0, Math.round(Number(c.value.replace(/\D/g, '')) || 0));
        if (vise === avant) { c.value = avant ? String(avant) : ''; return; }
        poser(vise);
        pulser();
      });
      // L'INTITULE EST DEHORS, LA BULLE N'ENTOURE QUE LE CHAMP (30/08).
      case_.append(el('span', 'fa-lab fa-taille__k', String(taille.t)), c);
      grilleT.append(case_);
    });
    // LE TOTAL EST UNE CASE DE LA RANGÉE (30/08). Charlie : « le total doit
    // être refait aussi ». Il vivait à part — « Total 45 pièces » poussé en bout
    // de rangée par une marge automatique, donc renvoyé à la ligne du dessous dès
    // que la grille prenait sa largeur : une deuxième ligne pour un nombre, et
    // un modèle de plus dans une rangée qui n'en portait qu'un.
    // Il prend maintenant la place d'une case, sur le même rail que les
    // quantités et avec son intitulé au-dessus comme elles. Il n'a PAS de
    // bulle : la bulle dit « on tape ici », et un total ne se tape pas.
    // Le mot « pièces » tombe avec elle : la rangée s'appelle « Tailles », et
    // ce qu'on y compte n'a jamais été autre chose.
    const caseTotal = el('div', 'fa-taille');
    caseTotal.append(el('span', 'fa-lab fa-taille__k', 'Total'), total);
    grilleT.append(caseTotal);
    majTotal();

    // LES TAILLES SONT UNE RANGÉE COMME LES AUTRES. Elles avaient leur propre
    // en-tête — un libellé posé au-dessus alors que toutes les lignes voisines
    // portent le leur à gauche : une ligne de plus, et deux modèles de rangée
    // dans la même colonne.
    //
    // ELLE PASSE EN DERNIER, SOUS LES FACES (30/08). Charlie : « mets cette
    // ligne au-dessus des tailles et réaligne verticalement tout ce que tu
    // peux ». Les deux vont ensemble : depuis que l'intitulé de la taille est
    // sorti de la bulle, cette rangée fait DEUX lignes — 76,3 px au lieu de 50.
    // Posée au milieu de la colonne, elle décalait de 26,3 px tout ce qui la
    // suivait, et « Faces » ne tombait plus en face de sa voisine de gauche.
    // En dernier, son surplus pend sous une colonne qui n'a plus rien en face :
    // les quatre rangées de droite retombent sur les quatre rails de gauche.
    // Et l'ordre y gagne : la référence, la couleur, la technique, le marquage
    // et les faces disent l'ARTICLE ; les tailles disent COMBIEN.
    const ligneTailles = tailles.length ? rangee('Tailles', grilleT, 'fa-row--empile') : null;

    // --- LES FACES --------------------------------------------------------
    // LA RANGÉE N'EST PLUS QU'UN MENU (29/08). Charlie : « cette ligne est à
    // revoir, je ne veux qu'un menu pour sélectionner les faces, et pouvoir
    // modifier le choix ». Elle portait une CARTE par face — le nom, une cote,
    // une consigne — plus un bouton : trois choses pour dire ce qu'on marque.
    //
    // LES DEUX CHAMPS SONT RETIRÉS, tranché le même jour : « ça disparaît, les
    // tailles sont affichées sur le BAT ». La cote d'un textile vient déjà du
    // tableau des tailles de logo, et le BAT la montre ; la consigne, quand il
    // en faut une, s'écrit dans la note en bas de fiche. Les valeurs déjà
    // saisies restent en base et continuent de s'imprimer — on retire le champ,
    // pas la donnée.
    const faces = Array.isArray(prod.logos) ? prod.logos : [];
    // ON COCHE CE QUE LE CLIENT VEUT, ON NE LE TAPE PAS (29/08)
    // ---------------------------------------------------------------------
    // Charlie, en designant cette rangee : « pour les textiles ici les faces
    // doivent etre selectionnables via un menu, et cocher ce que le client
    // souhaite : avant, coeur, dos etc. »
    //
    // Le bouton demandait un NOM LIBRE. Or sur un textile les six emplacements
    // sont connus : ils sont declares par la famille dans Reglages > Tailles de
    // logo, et c'est deja par ce nom que la largeur du logo se retrouve. Les
    // taper a la main, c'est ecrire « coeur » la ou le tableau dit « Coeur » —
    // la mesure ne suit plus, et rien ne le signale.
    //
    // LA LISTE : ce que la famille declare (`ctx.facesProposees`, meme cascade
    // qu'au comptoir — la REFERENCE d'abord, l'article ensuite, la famille
    // « Par defaut » en dernier), PLUS les faces deja posees sur le dossier.
    // Sans ce second morceau, une face ajoutee a la main — ou heritee d'une
    // famille qui a change depuis — ne pourrait plus se decocher.
    const cleF = (v) => String(v == null ? '' : v).trim().toLowerCase();
    const marq = ctx.marquage && typeof ctx.marquage === 'object' ? ctx.marquage : null;
    const tarifable = !!(marq && marq.tarifable);
    // Les emplacements que le MOTEUR sait chiffrer. Une face de la famille qu'il
    // ne connaît pas — « Étiquette col » — reste une face du dossier : elle
    // s'imprime, elle ne se facture pas, et le menu ne lui met pas de prix.
    const chiffrables = new Set((marq && Array.isArray(marq.connus) ? marq.connus : []).map(cleF));
    const chiffrable = (nom) => tarifable && chiffrables.has(cleF(nom));

    const choixF = Array.isArray(ctx.facesProposees) ? [...ctx.facesProposees] : [];
    for (const z of faces) {
      if (z.face && !choixF.some((n) => cleF(n) === cleF(z.face))) choixF.push(z.face);
    }

    // CE QUI EST COCHÉ : LE PRIX FAIT FOI POUR CE QU'IL FACTURE.
    // `prod.logos` vient des zones du besoin (ce que la vendeuse a décrit) et
    // `chiffrage.printType` de la liste du comptoir (ce qui est facturé) : les
    // deux vivaient chacune de leur côté, et une face pouvait donc être écrite
    // sur le ticket de l'atelier sans être au devis. Pour les emplacements que
    // le moteur chiffre, c'est le MARQUAGE qui dit la vérité ; pour les autres,
    // `logos`. Ouvrir la fiche montre donc ce qui est réellement vendu, et la
    // première coche remet les deux d'accord.
    const actuels = new Set((marq && Array.isArray(marq.actuels) ? marq.actuels : []).map(cleF));
    const coche = (nom) => (chiffrable(nom)
      ? actuels.has(cleF(nom))
      : faces.some((z) => cleF(z.face) === cleF(nom)));
    const cochees = () => choixF.filter(coche);

    // L'ÉCART QU'ON ÉCRIT EN FACE. Signé : « + 492,96 € » dit ce que cocher
    // ajoute, « − 99,84 € » ce que décocher retire. C'est exactement ce que le
    // devis fera — le serveur l'a calculé en rejouant le moteur avec et sans.
    const ecartDe = (nom) => {
      if (!chiffrable(nom) || !marq.ecarts) return null;
      const cle = (marq.connus || []).find((p) => cleF(p) === cleF(nom));
      const v = cle == null ? null : marq.ecarts[cle];
      return typeof v === 'number' && v !== 0 ? v : null;
    };

    // LE PATCH DES FACES EST POSITIONNEL cote serveur : chaque entree corrige la
    // face de meme rang, une entree de plus l'ajoute, et un NOM VIDE la retire
    // (« une face sans nom n'est pas une face »). On envoie donc la liste voulue,
    // suivie d'autant de noms vides qu'il reste de places occupees — sans eux,
    // retirer la face du milieu laisserait la derniere en double.
    // ET IL ÉCRIT LES DEUX : `logos` pour le papier de l'atelier, `emplacements`
    // pour le PRIX. Une seule écriture, donc les deux ne peuvent plus diverger —
    // c'est le défaut qu'on ferme. Le serveur repose ensuite le chiffrage sur
    // ces emplacements, et le devis suit (voir `retarifer`).
    // ⚠ `emplacements` n'est envoyé que si le dossier est tarifable : sur les
    // 184 d'avant, `logos` peut ne porter qu'une face quand le marquage facturé
    // en compte deux, et les relire ferait BAISSER un prix déjà annoncé.
    const poserFaces = (voulues) => Promise.resolve(ctx.patchProd({
      logos: [
        ...voulues.map((z) => ({ face: z.face, mm: z.mm || '', quoi: z.quoi || '' })),
        ...faces.slice(voulues.length).map(() => ({ face: '' })),
      ],
      ...(tarifable
        ? { emplacements: voulues.map((z) => z.face).filter(chiffrable) }
        : {}),
    })).then(() => {
      // Une face de plus ou de moins change la STRUCTURE de l'ecran, pas une
      // valeur : sans redessin le clic parait perdu, et on recommence.
      if (ctx.rafraichir) ctx.rafraichir();
    });

    // La zone déjà posée, quand elle existe : décocher puis recocher ne doit pas
    // effacer une cote ou une consigne héritée du comptoir.
    const zoneDe = (nom) => faces.find((z) => cleF(z.face) === cleF(nom)) || { face: nom };

    const basculerFace = async (nom) => {
      const dedans = coche(nom);
      // LE MENU SE FERME AVANT LA QUESTION, jamais apres. Laisse ouvert, il se
      // refermait de toute facon au premier clic dans la boite (l'ecouteur
      // « dehors » voit ce clic) : annuler ne rendait donc pas l'ecran d'avant.
      fermerMenuF();
      const suite = dedans
        ? cochees().filter((n) => cleF(n) !== cleF(nom))
        : [...cochees(), nom];
      if (!dedans) {
        const e = ecartDe(nom);
        await poserFaces(suite.map(zoneDe));
        return;
      }
      // DECOCHER UNE FACE QUI PORTE QUELQUE CHOSE, C'EST LE PERDRE : la consigne
      // part avec elle, et le redessin qui suit vide la pile d'annulation. On
      // demande — jamais pour une face vide, ou decocher deviendrait un clic sur
      // deux. (Le PRIX, lui, se refait tout seul : il n'y a rien a perdre.)
      const z = zoneDe(nom);
      if (z.quoi && ctx.confirmer) {
        const ok = await ctx.confirmer('Retirer cette face ?',
          `« ${nom} » porte « ${z.quoi} ». Ce sera perdu.`, 'Retirer');
        if (!ok) return;
      }
      const e = ecartDe(nom);
      await poserFaces(suite.map(zoneDe));
    };

    // PAS DE `prompt()`. Il bloque la page entiere, il est refuse dans certains
    // cadres (il jetait « prompt() is not supported » ici meme), et il emmene le
    // focus hors de l'ecran. Le nom se tape dans une case qui prend la place du
    // bouton, sur la meme rangee : rien ne se deplace, et Echap rend la main.
    const saisirFace = () => {
      const saisie = champ('fa-quoi', '', { label: 'Nom de la face', placeholder: 'nom de la face' });
      const finir = async (garder) => {
        const nom = garder ? saisie.value.trim() : '';
        saisie.replaceWith(ajoutF);
        if (!nom) return;
        // CRÉER UNE FACE, C'EST L'AJOUTER A LA FAMILLE. Tapee ici, elle ne
        // vivait que sur CE dossier : le t-shirt suivant ne la proposait pas et
        // il fallait la retaper — autrement, ce qui est exactement ce que le
        // menu existe pour empecher. Elle rejoint la liste de sa famille, d'ou
        // elle se renomme et se retire comme les autres.
        // ⚠ ET L'ORDRE COMPTE : la famille D'ABORD, le dossier ENSUITE. Poser la
        // face sur le dossier redessine la fiche (la structure change) et emporte
        // cette fonction avec elle — l'ecriture suivante n'arriverait jamais.
        // LA FAMILLE D'ABORD, LE DOSSIER ENSUITE — voir le commentaire du bloc.
        // Ce que la famille a repondu ne se dit plus : la fiche ne raconte plus
        // ses reussites (30/08). Dans les deux cas la face entre sur le dossier.
        if (ctx.creerFace) await ctx.creerFace(nom);
        await poserFaces([...faces, { face: nom }]);
      };
      saisie.addEventListener('blur', () => finir(true));
      saisie.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); saisie.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); finir(false); }
      });
      ajoutF.replaceWith(saisie);
      saisie.focus();
    };

    // LE BOUTON DIT CE QUI EST CHOISI, ET QU'IL OUVRE. La rangée ne porte plus
    // que lui : « je ne veux qu'un menu pour sélectionner les faces, et pouvoir
    // modifier le choix » (Charlie, 29/08). Les cartes qui l'accompagnaient
    // disaient la même chose une seconde fois, en trois fois plus de place.
    // Le chevron dit qu'il ouvre, et il se retourne à l'ouverture.
    const nomsCoches = cochees();
    const ajoutF = bouton('fa-choix', nomsCoches.join(' · ') || 'Aucune face');
    ajoutF.append(ic('expand_more'));
    ajoutF.setAttribute('aria-label', 'Faces à marquer');
    if (!nomsCoches.length) ajoutF.classList.add('fa-choix--vide');
    const ligneFaces = rangee('Faces', ajoutF, 'fa-row--ancre');

    // LA CASE A COCHER EST CELLE DU TIROIR « COLONNES », comme la rangée.
    const caseAcocher = (on) => (on
      ? ic('check_box', 'colbar-item__ic')
      : ic('check_box_outline_blank', 'colbar-item__ic'));

    const menuFaces = menuHabille(ajoutF, ligneFaces, (pan) => {
      for (const nom of choixF) {
        const on = coche(nom);
        const b = ligneMenu(caseAcocher(on), nom, () => basculerFace(nom), on ? 'is-on' : 'is-off');
        b.setAttribute('role', 'menuitemcheckbox');
        b.setAttribute('aria-checked', String(on));
        // LE PRIX EST ÉCRIT EN FACE (29/08, Charlie) : ce que cocher AJOUTERAIT,
        // ce que décocher RETIRERAIT. Rien pour une face que le moteur ne
        // chiffre pas — un « 0,00 € » se lirait « c'est gratuit », et c'est
        // faux : elle n'est simplement pas au devis.
        const e = ecartDe(nom);
        if (e) b.append(el('span', `fa-menu__prix${e > 0 ? '' : ' fa-menu__prix--moins'}`,
          `${e > 0 ? '+' : '−'} ${euros(Math.abs(e))}`));
        pan.append(b);
      }
      // LA CREATION N'EST PAS UN CHOIX DE LA LISTE. Posee comme une ligne parmi
      // les autres, elle se coche par erreur — et ce qu'elle ouvre n'est pas une
      // face, c'est un champ. Elle vit sous le filet de la fiche, avec sa propre
      // icone.
      pan.append(el('div', 'fa-filet'));
      pan.append(ligneMenu(ic('add', 'colbar-item__ic'), 'Autre face…',
        () => { fermerMenuF(); saisirFace(); }));
    });
    const fermerMenuF = () => menuFaces.fermer();
    // Rien de declare nulle part : on retombe sur la saisie libre, exactement
    // l'ecran d'avant. Un menu vide ne dit rien a personne.
    ajoutF.addEventListener('click', () => {
      if (!choixF.length) { saisirFace(); return; }
      menuFaces.bascule();
    });

    droite.append(ligneFaces);
    if (ligneTailles) droite.append(ligneTailles);
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
  // Le panneau ne se replie plus : la barre qui le pliait est partie le 30/08.

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
  // LE MONTANT SE CENTRE DANS SA BOITE (30/08, Charlie : « centre les 0,00 »).
  // Il n'est sur AUCUN rail — il est pose au milieu d'un groupe, entre « 50 % »
  // et le bord de la case — donc rien ne l'appelle a gauche. Meme traitement que
  // la boite de l'heure et les bulles de taille : une boite courte centre ce
  // qu'elle porte, exemple ET valeur. Le cout et le prix TTC, eux, ne bougent
  // pas : ils partent du rail de leur intitule.
  const chAcompte = champ('fa-mont', r.acompte_montant == null ? '' : normaliserMontant(r.acompte_montant), {
    label: 'Acompte versé', placeholder: '0,00 €',
  });
  // « LE… » EST RETIRE (30/08). Charlie : « supprime le "le..." a l'interieur ».
  // La case s'appelle deja « Acompte verse le » : le champ le redisait, a
  // 20 px de son propre intitule. La carte ne dit pas deux fois la meme chose.
  // ⚠ LE TEXTE D'EXEMPLE PART, PAS LA BULLE : c'est `:placeholder-shown` qui
  // donne son fond a un champ vide — « ce qui manque au dossier se voit sans
  // qu'on le survole ». Un placeholder RETIRE emporterait la bulle avec lui, et
  // la case vide deviendrait invisible. Il reste donc, vide de texte : une
  // espace insecable, que rien ne dessine et que le fond continue de suivre.
  const chAcompteDate = champ('fa-date', r.acompte_date
    ? jourCourt(new Date(`${String(r.acompte_date).slice(0, 10)}T12:00:00`)) : '', {
    label: 'Date de l’acompte', placeholder: '\u00a0',
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
    // ET « SOLDÉ » AVEC EUX (30/08). Charlie a fait retirer la bascule qui le
    // cochait — elle était le SEUL endroit de l'application qui écrivait `paye`,
    // et sans elle un dossier entièrement réglé serait resté « à encaisser » sur
    // le bon de commande, et se serait plaint au feu du planning.
    // Le troisième drapeau rejoint donc les deux autres : il se déduit du
    // montant, comme le dit déjà cette fonction. Un versement qui couvre le TTC
    // solde le dossier ; le ramener en dessous le rouvre.
    // ⚠ AU CENTIME : `n >= ttc` refuserait 648,96 contre 648,96 dès qu'un
    // arrondi de centième traîne dans l'un des deux.
    const ttc = nombreDe(chTtc.value);
    const solde = verse && ttc != null && ttc > 0 && n >= ttc - 0.005;
    if ((r.paye === true) !== solde) { r.paye = solde; ctx.patchLigne('paye', solde); }
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
    if (ttc == null || ttc <= 0) { dire('Pas de prix TTC — l’acompte ne peut pas s’en déduire'); return; }
    const avant = nombreDe(chAcompte.value);
    const n = Math.round(ttc * part * 100) / 100;
    if (n === avant) return;
    const poser = (v) => {
      chAcompte.value = v == null ? '' : normaliserMontant(v);
      envoyerAcompte(v);
      majReste();
    };
    poser(n);
    pulser();
  });

  // LA BASCULE « SOLDÉ » EST RETIRÉE (30/08, Charlie : « supprime ça »). Elle
  // posait à la main un drapeau que le montant dit déjà — voir `envoyerAcompte`,
  // qui le déduit maintenant comme les deux autres. Elle pouvait même le
  // contredire : « Soldé » allumé sur un acompte de 30 % affichait « Reste à
  // payer : 0,00 € » sur un dossier à moitié réglé.

  const selReglement = menu(null, ctx.reglements, r.paiement_mode || '', 'Mode de règlement');
  brancher(selReglement, { label: 'Mode de règlement', envoyer: (v) => ctx.patchLigne('paiement_mode', v || null) });
  const chCout = champ(null, r.cout_revient == null ? '' : normaliserMontant(r.cout_revient), {
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
  // TOUT L'ARGENT SUR UNE SEULE LIGNE (29/08). Charlie : « je veux que tu fasses
  // rentrer ca proprement sur une seule ligne ». Les deux blocs empiles
  // demandaient 202 px de haut pour six valeurs qui tiennent sur une bande.
  //
  // CHAQUE VALEUR EST UNE CASE : son intitule au-dessus, sa valeur dessous. Cote
  // a cote les intitules ne prennent plus de largeur — c'est ce qui permet de
  // tout tenir sur une ligne sans rien couper.
  //
  // LA SOUSTRACTION SE LIT ENCORE, mais a l'horizontale : « Prix TTC − Acompte
  // = Reste ». Empilee, elle se lisait par un filet ; ici ce sont les deux
  // signes qui la disent. C'est ce qui evite que la barre devienne une rangee de
  // chiffres sans rapport entre eux.
  // LA BANDE TOMBE SUR LES COLONNES DE LA FICHE (29/08). Charlie, en designant
  // les six intitules et les quatre rails du formulaire : « je veux que tout ca
  // soit parfaitement aligne avec ces colonnes ». Elle flottait a DROITE, callee
  // par une marge automatique, chaque case a la largeur de son contenu : le
  // premier intitule commencait a 320 px, c'est-a-dire sur rien. Six valeurs
  // posees sous un formulaire, et pas une qui partait d'un trait existant.
  //
  // Elle reprend donc EXACTEMENT la grille des deux colonnes : deux moities, et
  // dans chacune les quatre memes pistes — intitule, valeur, intitule, valeur.
  // Chaque case part d'un rail que l'oeil connait deja, et le trait qui separe
  // l'atelier du client tombe pile sur celui qui separe les deux colonnes.
  //
  // LES DEUX SIGNES « − » ET « = » SONT PARTIS AVEC LE FLOTTEMENT. Ils disaient
  // la soustraction quand la bande n'etait qu'une suite de chiffres sans rapport
  // entre eux ; sur des rails, sous leurs intitules, « Prix TTC », « Acompte
  // verse le » et « Reste a payer » se lisent dans cet ordre sans qu'on ait a
  // ponctuer. Et un signe n'a pas de rail : garde, il aurait decale les trois
  // cases qui le suivent.
  const caseArgent = (cle, cls, ...contenu) => {
    const c = el('div', `fa-case${cls ? ` ${cls}` : ''}`);
    c.append(el('div', 'fa-case__k', cle));
    const v = el('div', 'fa-case__v');
    v.append(...contenu.filter(Boolean));
    c.append(v);
    return c;
  };

  // A GAUCHE, ce qui ne regarde que l'atelier — sur les rails de la colonne
  // Client. « Reglement » prend les deux dernieres pistes : c'est un menu, et le
  // plus long de ses libelles demande 183 px quand une piste d'intitule en fait
  // 106. Une colonne n'est jamais plus etroite que ce qu'elle porte.
  const moitieG = el('div', 'fa-details__moitie fa-details__moitie--g');
  moitieG.append(
    caseArgent('Coût', null, chCout),
    caseArgent('Marge', null, valMarge),
    caseArgent('Règlement', 'fa-case--large', selReglement),
  );
  // A DROITE, le compte du client — sur les rails de la colonne Production. La
  // bande finit sur le nombre qu'on vient chercher, cale au bord droit : le meme
  // que celui ou finissent tous les champs de la colonne au-dessus.
  const moitieD = el('div', 'fa-details__moitie fa-details__moitie--d');
  moitieD.append(
    caseArgent('Prix TTC', null, chTtc),
    caseArgent('Acompte versé le', 'fa-case--large',
      chAcompteDate, pastilleAcompte(0.3), pastilleAcompte(0.5), chAcompte),
    caseArgent('Reste à payer', 'fa-case--fin', reste),
  );
  panneau.append(moitieG, moitieD);

  // LE CHAMP DES NOTES VIT DANS LA COLONNE GAUCHE, POINT. Il y avait ici un
  // seuil de hauteur (420 px) qui le renvoyait dans le panneau sur un ecran
  // minuscule, avec le `ResizeObserver` qui allait avec — trois etats a tenir,
  // pour un cas qu'aucun PC ne produit. Le projet est PC uniquement depuis le
  // 21/08 ; c'etait un reste de la tablette.
  // LA BARRE « ▾ PAIEMENT · PRIX TTC · COUT · MARGE · REGLEMENT » EST RETIREE
  // (30/08, Charlie : « supprime ca »). Elle repliait un panneau qui s'ouvre
  // toujours — et pour l'annoncer, elle recopiait sous lui les intitules de
  // quatre de ses six cases, en plus petit. Une ligne entiere pour redire ce
  // qu'on lisait juste au-dessus, plus un pli que personne ne fait.

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
  // LE BLOC DE PIED EST RETIRÉ (29/08, Charlie). Il portait deux lignes : le nom
  // du produit — déjà écrit dans l'entête, à trois centimètres, et c'est
  // exactement le doublon que la règle du 26/08 interdit — et l'horodatage de
  // création, que personne ne vient chercher sur une fiche d'atelier. Ce qu'il
  // disait d'utile, l'appartenance au lot, a rejoint l'entête (voir plus haut).
  carte.append(tete, bandeau, scene);
  racine.append(carte, zoneToast);
  return racine;
}
