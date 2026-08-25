// ===========================================================================
// Dashboard « Point du jour » — projection temps réel du planning.
// ===========================================================================
// L'écran répond à UNE question, pour quatre personnes : « qu'est-ce que je
// fais maintenant ? ». Tout ce qui ne sert pas cette question descend ou
// disparaît. Trois partis pris, posés le 25/08 après une refonte complète :
//
//   1. L'ÉCRAN S'OUVRE SUR MOI. Le poste sait qui est là (`olda.qui`) : la vue
//      par défaut est la file de cette personne, pas les quarante dossiers de
//      tout l'atelier.
//   2. UNE COLONNE = UNE INFORMATION. La version précédente écrivait l'échéance
//      deux fois par ligne (colonne « Pourquoi maintenant » : « En retard de
//      3 j », colonne « Échéance » : « Retard 3 j ») et la priorité trois fois
//      (colonne « Prio », « Priorité haute (3★) » dans le pourquoi, et le rang
//      de la file qui en découle). Le « pourquoi » ne garde donc QUE les motifs
//      qu'aucune autre colonne ne porte : machine goulot, stagnation.
//   3. UN ZÉRO NE S'AFFICHE PAS. Un compteur éteint mais présent occupe quand
//      même l'œil ; celui qui n'a rien à dire quitte la barre. Quand rien ne
//      brûle, la barre entière est remplacée par une phrase calme.
//
// AUCUNE donnée propre : tout vient de /api/requests + /api/category-owners ;
// toute action (envoi de catégorie, marquer traité, étoiles) écrit via la même
// API que le Planning — une commande = une seule source de vérité, le SSE
// resynchronise les deux vues.
//
// Routage catégorie → pilote (cœur de la refonte) : le PILOTE EFFECTIF d'une
// commande est son `responsable` s'il a été posé à la main ; sinon le
// propriétaire de sa catégorie (config « Attribution des catégories »,
// sous-étape prioritaire sur la famille) ; sinon « À attribuer ». Envoyer une
// commande vers une autre catégorie ne PATCH que stage/sub_stage : le pilote
// suit tout seul l'attribution — sauf pilote manuel, jamais écrasé.
//
// Sous le pilote, une catégorie porte aussi 0..N RÉFÉRENTS par défaut
// (/api/category-referents) : les référents effectifs d'une commande sont son
// `referent` s'il a été saisi à la main, sinon ceux de sa catégorie.

import { rankRequests, WAITING_SUBS, WAITING_REASON } from './priority.js';
// Le focus suit la fenêtre qui s'ouvre, et revient d'où il venait à la
// fermeture. Les quatre fenêtres du Point du jour se déclaraient modales en
// laissant le clavier derrière elles, sous un voile opaque.
import { armerModale } from './modale.js';
// Qui est au poste : c'est cette personne qui décide de la vue par défaut.
import { lirePoste } from './poste.js';

export function createDashboard(deps) {
  const {
    root, api, EMPLOYEES, FAMILIES, SUB_STAGES, STAGE_LABEL, SUB_LABEL,
    daysLeft, prioBand, showToast, attachTip, fold,
    jumpToPlanning,
  } = deps;

  // --- Constantes métier ---------------------------------------------------
  // Familles « actives » du point du jour (Paiement & clôture / Fiverr exclus).
  const ACTIVE_FAMILIES = ['a_trier', 'demande_chiffrage', 'preparation', 'production', 'facturation'];
  const ACTIVE_SET = new Set(ACTIVE_FAMILIES);

  // Couleur d'avatar : l'accent de la charte pour tout le monde. On passe par
  // le jeton CSS, pas par une valeur figée — sinon l'avatar reste sombre en
  // thème sombre, où l'accent s'éclaircit.
  // Le fond de la pastille « ? » (dossier sans pilote). --text-3 rendait un
  // blanc sur #9ca3af, soit 2,54:1 : la seule initiale illisible de l'écran
  // était justement celle qui signale un dossier que personne ne porte.
  const AVATAR_DEFAULT = 'var(--text-2)';
  const AVATAR = { 'Loïc': 'var(--primary)', 'Charlie': 'var(--primary)', 'Mélina': 'var(--primary)', 'Julien': 'var(--primary)' };

  // Une commande « Sans date » vieillit : au bout de 7 jours elle devient
  // « À planifier » (badge orange, remonte dans le tri). Jamais comptée en retard.
  const PLAN_AGE_DAYS = 7;
  // « Échéance proche » = aujourd'hui, demain ou après-demain.
  const SOON_DAYS = 2;

  // Prochaine action dérivée de la sous-catégorie (sinon de la famille) : la
  // ligne « quoi faire maintenant » des grandes cartes et du panneau détail.
  const NEXT_ACTION = {
    demande_chiffrage: 'Qualifier la demande et la chiffrer',
    demande_recue: 'Prendre connaissance de la demande et la classer',
    demande_a_qualifier: 'Qualifier la demande et classer l’intérêt commercial',
    a_chiffrer: 'Calculer le prix et préparer le devis',
    chiffrage_en_cours: 'Finaliser le chiffrage en cours',
    devis_envoye: 'Relancer le client sur le devis envoyé',
    devis_valide: 'Lancer la préparation du projet',
    preparation: 'Préparer le dossier pour la production',
    prepa_produits: 'Préparer les produits et les fichiers',
    prepa_bat: 'Réaliser le BAT',
    bat_envoye: 'Relancer le client sur le BAT',
    bat_valide: 'Enchaîner sur les conditions de paiement',
    validation_acompte: 'Valider l’acompte et les conditions de paiement',
    a_commander: 'Passer la commande fournisseur',
    attente_marchandise: 'Suivre la réception de la marchandise',
    pret_a_produire: 'Lancer la production',
    production: 'Préciser le poste de production',
    prod_dtf: 'Imprimer le DTF',
    decoupe_dtf: 'Découper et contrôler le DTF',
    prod_pressage: 'Presser les textiles',
    prod_trotec: 'Lancer la découpe / gravure Trotec',
    prod_uv: 'Imprimer en UV',
    montage_finition: 'Faire le montage et les finitions',
    controle_emballage: 'Contrôler et emballer la commande',
    facturation: 'Facturer et organiser le retrait',
    facturation_a_faire: 'Éditer et envoyer la facture',
    client_a_prevenir: 'Prévenir le client que c’est prêt',
    client_prevenu: 'Relancer le client pour qu’il vienne la récupérer',
    commande_recuperee: 'Contrôler le paiement',
  };

  // --- État ----------------------------------------------------------------
  let rows = [];                // toutes les commandes (cache, resynchro SSE)
  let owners = {};              // { slugCatégorie: employé } (pilote par défaut)
  let catRefs = {};             // { slugCatégorie: [employés] } (référents par défaut)
  let machines = [];            // [{ slug, name, importance, minutesPerUnit }] (réglages patron)
  let loaded = false;
  // Vrai quand le TOUT premier chargement a échoué : l'écran le dit, et une
  // nouvelle tentative est programmée (rien d'autre ne la déclencherait —
  // le temps réel peut rester silencieux des heures).
  let premierChargementKo = false;
  let repriseTimer = null;
  let repriseEssais = 0;
  // Le Point du jour est-il SOUS LES YEUX ? Il garde son cache à jour même
  // masqué (fil d'activité, badges, écran mural), mais pas au même rythme :
  // affiché, il suit le temps réel au plus près ; en fond, il se contente d'un
  // rafraîchissement de temps en temps. Chaque passage coûte quatre requêtes
  // dont le PLANNING ENTIER — sur le poste qui range une étape, c'était payé à
  // chaque évènement pour un écran que personne ne regardait.
  let visible = false;
  let dernierRefresh = 0;
  let veilleTimer = null;
  const REFRESH_FOND_MS = 30000;

  // 'todo' (toute la file) | 'team' | prénom.
  // La personne au poste, relue à chaque rendu : elle change en cours de
  // journée (bouton « Se nommer »), et c'est elle qui décide de la vue par
  // défaut. `null` tant que personne ne s'est nommé.
  const moi = () => {
    const nom = lirePoste();
    return EMPLOYEES.includes(nom) ? nom : null;
  };
  let activeTab = moi() || 'todo';
  // Vrai tant que l'utilisateur n'a pas choisi d'onglet lui-même : si le poste
  // se nomme APRÈS l'ouverture de l'écran (le cas normal au premier
  // démarrage), la vue bascule sur cette personne. Dès qu'il a cliqué un
  // onglet, on ne lui reprend plus la main.
  let ongletAuto = true;

  let kpiFilter = null;         // null | 'late' | 'soon' | 'waiting' | 'active'
  let searchQuery = '';

  // Fil d'activité (local à la session : diff des snapshots + actions locales).
  const activity = [];          // { ts, text, color }
  let unseen = 0;

  // --- Dérivations métier --------------------------------------------------
  const isActive = (r) => ACTIVE_SET.has(r.stage);
  const clientName = (r) => r.billing_company || r.contact_referent || 'Sans nom';
  const articleOf = (r) => r.product || r.description || '—';

  // Pilote par défaut d'une catégorie (config d'attribution ; sous-étape > famille).
  const ownerOf = (family, sub) => (sub && owners[sub]) || owners[family] || null;

  // Pilote effectif : manuel prioritaire, sinon attribution de la catégorie.
  function effectivePilot(r) {
    if (r.responsable && EMPLOYEES.includes(r.responsable)) return r.responsable;
    return ownerOf(r.stage, r.sub_stage);
  }
  const isManualPilot = (r) => !!(r.responsable && EMPLOYEES.includes(r.responsable));

  // Référents par défaut d'une catégorie (sous-étape > famille, comme le pilote :
  // une liste posée sur la sous-étape REMPLACE celle de la famille).
  function referentsOf(family, sub) {
    const subList = sub && catRefs[sub];
    if (Array.isArray(subList) && subList.length) return subList;
    const famList = catRefs[family];
    return Array.isArray(famList) ? famList : [];
  }

  // Référents effectifs : celui saisi à la main prime, sinon ceux de la catégorie.
  function effectiveReferents(r) {
    if (r.referent && EMPLOYEES.includes(r.referent)) return [r.referent];
    return referentsOf(r.stage, r.sub_stage);
  }
  const isManualReferent = (r) => !!(r.referent && EMPLOYEES.includes(r.referent));

  function ageDays(r) {
    const t = Date.parse(r.created_at);
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }

  // Urgence dérivée d'une commande. band ordonne le tri (0 = le plus urgent) :
  // retard → échéance proche → daté lointain → à planifier → sans date récent.
  // `sort` affine à l'intérieur d'une bande. Mémoïsé par objet ligne (WeakMap
  // auto-invalidée à chaque refresh : la deadline ne bouge pas en optimiste).
  let urgCache = new WeakMap();
  // Le jour civil auquel le cache a été calculé. Une tablette laissée allumée
  // toute la nuit sans activité affichait encore « Demain » au matin sur une
  // commande devenue « Aujourd'hui » : rien ne recalculait au passage de minuit.
  let urgJour = jourCivil();
  function jourCivil() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }
  function urgency(r) {
    if (urgJour !== jourCivil()) { urgCache = new WeakMap(); urgJour = jourCivil(); }
    let u = urgCache.get(r);
    if (u) return u;
    const d = daysLeft(r.deadline);
    if (d === null) {
      const age = ageDays(r);
      u = age >= PLAN_AGE_DAYS
        ? { band: 3, cls: 'plan', label: `À planifier · ${age} j`, sort: -age }
        : { band: 4, cls: 'none', label: 'Sans date', sort: 0 };
    } else if (d < 0) {
      u = { band: 0, cls: 'late', label: `Retard ${-d} j`, sort: d };
    } else if (d <= SOON_DAYS) {
      u = { band: 1, cls: 'soon', label: d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : `Dans ${d} j`, sort: d };
    } else {
      u = { band: 2, cls: 'ok', label: `Dans ${d} j`, sort: d };
    }
    urgCache.set(r, u);
    return u;
  }

  // Tri du point du jour : urgence, puis priorité décroissante, puis le détail
  // de la bande (jours restants / ancienneté), puis date de création.
  function sortCards(list) {
    return list.slice().sort((a, b) => {
      const ua = urgency(a), ub = urgency(b);
      if (ua.band !== ub.band) return ua.band - ub.band;
      const p = prioBand(b) - prioBand(a);
      if (p !== 0) return p;
      if (ua.sort !== ub.sort) return ua.sort - ub.sort;
      return String(a.created_at).localeCompare(String(b.created_at));
    });
  }

  const piloting = (who) => rows.filter((r) => isActive(r) && effectivePilot(r) === who);
  const refereeing = (who) => rows.filter((r) => isActive(r) && effectiveReferents(r).includes(who));

  // Cartes d'une personne (pilote OU référent, dédupliquées), triées.
  // MÉMOÏSÉ le temps d'un repeint (vidé par renderAll) : l'entête, la vue
  // Équipe et le fil la redemandent pour les mêmes données.
  const listesParPersonne = new Map(); // who -> liste triée
  const classementsParPersonne = new Map(); // who -> { queue, blocked, waiting }
  function invaliderListes() { listesParPersonne.clear(); classementsParPersonne.clear(); }
  function dayList(who) {
    const memo = listesParPersonne.get(who);
    if (memo) return memo;
    const seen = new Set();
    const out = [];
    for (const r of [...piloting(who), ...refereeing(who)]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    const triee = sortCards(out);
    listesParPersonne.set(who, triee);
    return triee;
  }

  function roleOf(r, who) {
    const pil = effectivePilot(r) === who;
    const ref = effectiveReferents(r).includes(who);
    return pil && ref ? 'both' : pil ? 'pilote' : ref ? 'referent' : null;
  }

  // Alerte posée sur une commande depuis le Planning (colonne « État ») :
  // BLOQUÉE = elle n'avance plus et on sait pourquoi, À VOIR = quelqu'un doit
  // y jeter un œil. C'est ce qu'on regarde en premier au point du matin.
  const FLAG_LABEL = { bloque: 'Bloquée', a_voir: 'À voir' };
  // « Attente client » n'est plus une famille : c'est la position du dossier —
  // devis parti, BAT parti, ou commande finie qui attend son retrait — tant que
  // le client n'a pas bougé. UNE seule définition, partagée avec le moteur de
  // priorité : le KPI et le bac « à relancer » doivent parler des mêmes lignes.
  const isWaitingClient = (r) => WAITING_SUBS.has(r.sub_stage);

  const isBlocked = (r) => r.flag === 'bloque';

  // « En retard » = L'ATELIER est en retard. Une commande dont la balle est chez
  // le client (devis/BAT partis, ou finie et pas encore récupérée) a beau avoir
  // dépassé sa date, ce n'est plus notre retard : elle est comptée en « Attente
  // client », pas ici — sinon le compteur du matin gonfle avec du travail fait.
  const isLate = (r) => urgency(r).band === 0 && !isWaitingClient(r);

  function kpis() {
    const act = rows.filter(isActive);
    return {
      late: act.filter(isLate).length,
      blocked: act.filter(isBlocked).length,
      soon: act.filter((r) => urgency(r).band === 1).length,
      waiting: act.filter(isWaitingClient).length,
      active: act.length,
    };
  }

  // --- Filtres (KPI + recherche) : estompe les cartes non concernées -------
  const KPI_PRED = {
    late: isLate,
    blocked: isBlocked,
    soon: (r) => urgency(r).band === 1,
    waiting: isWaitingClient,
    active: () => true,
  };
  const KPI_LABEL = { late: 'En retard', blocked: 'Bloquées', soon: 'Échéance proche', waiting: 'Attente client', active: 'Commandes actives' };

  // Mêmes champs que la recherche du planning (SEARCH_FIELDS dans app.js) :
  // chercher un numéro de téléphone trouvait la commande sur le planning et
  // rien sur le point du jour — même requête, deux verdicts opposés.
  const DASH_SEARCH_FIELDS = [
    'billing_company', 'contact_referent', 'product', 'color', 'description',
    'contact_phone', 'contact_email', 'responsable', 'referent', 'flag_reason',
  ];
  // Les jetons de la requête se découpent UNE fois par requête, pas une fois
  // par ligne : `fold` (minuscules + accents) est la brique la plus appelée du
  // rendu, et la vue Équipe la payait 12 fois par ligne et par frappe.
  let jetonsPour = null;
  let jetonsRecherche = [];
  function matchesSearch(r) {
    if (!searchQuery) return true;
    if (searchQuery !== jetonsPour) {
      jetonsPour = searchQuery;
      jetonsRecherche = fold(searchQuery).split(/\s+/).filter(Boolean);
    }
    const hay = DASH_SEARCH_FIELDS.map((f) => fold(r[f])).join(' ')
      + ' ' + fold(effectivePilot(r)) + ' ' + fold(effectiveReferents(r).join(' '));
    return jetonsRecherche.every((t) => hay.includes(t));
  }
  const isDimmed = (r) => (kpiFilter && !KPI_PRED[kpiFilter](r)) || !matchesSearch(r);

  // --- Petites briques DOM -------------------------------------------------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(name) {
    const s = el('span', 'material-symbols-outlined', name);
    s.setAttribute('aria-hidden', 'true');
    return s;
  }
  function avatarEl(name, cls) {
    const a = el('span', 'pj-avatar' + (cls ? ' ' + cls : ''), name ? name.charAt(0).toUpperCase() : '?');
    a.style.setProperty('--av', AVATAR[name] || AVATAR_DEFAULT);
    if (name) attachTip(a, name);
    return a;
  }
  // Priorité en AFFICHAGE — un MOT, et seulement quand elle est haute.
  //
  // Les trois étoiles ★★☆ disaient la même chose trois fois : la file est déjà
  // classée (le rang le dit), le « pourquoi » écrivait « Priorité haute (3★) »
  // deux colonnes plus loin, et l'étoile pleine se rendait à 1,18:1 sur le
  // blanc — c'est-à-dire invisible. Le planning a fait ce chemin avant nous
  // (badge texte Basse / Moyenne / Haute) : le point du jour parle enfin la
  // même langue. Une priorité basse ou moyenne ne mérite aucune marque ; seule
  // « Haute » en porte une, à l'accent, comme sur le planning.
  //
  // La cellule existe toujours quand la priorité n'est pas haute : c'est une
  // piste de grille de largeur fixe, elle ne doit jamais disparaître (sinon la
  // ligne suivante décale — cf. la carte du planning).
  function prioEl(r) {
    const n = prioBand(r);
    const w = el('span', 'pj-prio');
    if (n < 3) return w;
    w.classList.add('is-haute');
    w.textContent = 'Haute';
    w.setAttribute('aria-label', 'Priorité haute');
    return w;
  }
  function badgeEl(r) {
    const u = urgency(r);
    return el('span', `pj-badge u-${u.cls}`, u.label);
  }
  // Bandeau d'alerte (Bloquée / À voir) + son motif, ou null si rien à signaler.
  function flagEl(r, withReason) {
    if (!FLAG_LABEL[r.flag]) return null;
    const w = el('span', `pj-flag f-${r.flag === 'bloque' ? 'bloque' : 'a-voir'}`);
    w.appendChild(el('span', 'pj-flag-tag', FLAG_LABEL[r.flag]));
    if (withReason) {
      const why = r.flag_reason || 'Sans motif précisé';
      w.appendChild(el('span', 'pj-flag-why', why));
      attachTip(w, `${FLAG_LABEL[r.flag]} — ${why}`);
    }
    return w;
  }

  // Position dans la chaîne, en DEUX étages : l'étape précise en tête, la
  // famille en rappel dessous. Les deux puces côte à côte de l'ancienne version
  // ne tenaient pas dans une colonne d'équipe — on lisait « Facturation & re… »
  // et « À comma… », c'est-à-dire rien.
  function posEl(r) {
    const w = el('span', 'pj-pos');
    const sub = r.sub_stage && SUB_LABEL[r.sub_stage];
    const fam = STAGE_LABEL[r.stage] || r.stage;
    w.appendChild(el('span', 'pj-pos-main', sub || fam));
    if (sub) w.appendChild(el('span', 'pj-pos-sub', fam));
    return w;
  }

  // La DERNIÈRE colonne d'une ligne dit toujours quelque chose d'utile :
  //   · file commune / vue Équipe → QUI porte le dossier (pastille + nom) ;
  //   · vue d'une personne        → à quel TITRE il est chez elle.
  // Dans la vue de Charlie, la colonne « Pilote » affichait « C Charlie » sur
  // les dix lignes : une colonne entière de constante. Le rôle, lui, distingue
  // ce qu'on pilote de ce qu'on épaule — c'est ce qu'on cherche à savoir quand
  // on regarde SA propre file.
  function porteurEl(r, who) {
    if (!who) {
      const pil = effectivePilot(r);
      const w = el('span', 'pj-porteur' + (pil ? '' : ' is-none'));
      w.append(avatarEl(pil), el('span', 'pj-porteur-n', pil || 'À attribuer'));
      return w;
    }
    const role = roleOf(r, who);
    const w = el('span', 'pj-porteur');
    // « Pilote » d'abord : quand on est les deux, c'est le titre qui engage.
    w.appendChild(el('span', 'pj-role role-' + (role === 'referent' ? 'referent' : 'pilote'),
      role === 'referent' ? 'J’épaule' : 'Je pilote'));
    return w;
  }

  // Les motifs de classement, DÉDOUBLONNÉS de ce que la ligne écrit déjà.
  //
  // `reasonsFor` (priority.js) sort au plus deux motifs, et les deux premiers
  // de sa liste — l'échéance et la priorité haute — sont précisément les deux
  // colonnes voisines. En pratique, toute ligne en retard portait « En retard
  // de 3 j · Priorité haute (3★) » à côté d'un badge « Retard 3 j » et d'une
  // colonne de priorité. La colonne ne servait donc à rien sur la majorité des
  // lignes, tout en occupant 224 px au milieu de la file.
  //
  // On ne touche PAS au moteur : il garde ses motifs complets (le panneau
  // détail et test/priority.test.js s'appuient dessus). C'est l'affichage qui
  // ne répète pas.
  const MOTIF_DEJA_DIT = /^(En retard de|Échéance |Priorité haute)/;
  const motifsUtiles = (reasons) => (reasons || []).filter((t) => !MOTIF_DEJA_DIT.test(t));
  function nextActionOf(r) {
    return NEXT_ACTION[r.sub_stage] || NEXT_ACTION[r.stage] || 'Faire avancer le dossier';
  }
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // --- Carte de la vue Équipe ----------------------------------------------
  // DEUX lignes, pas six. La version précédente empilait client, badge,
  // article, bandeau d'alerte, étape sur deux étages et une étiquette de rôle :
  // six rangs par dossier, donc quatre dossiers visibles dans une colonne de
  // 950 px de haut, pour des files de onze à seize. On ne voyait pas le tiers
  // de la charge de qui que ce soit — c'est pourtant LA question du dispatch.
  //
  // Ici : « client — échéance » puis « article · étape ». Le motif du blocage
  // reste en clair (c'est l'information qui débloque la journée) mais sur la
  // ligne de l'article, pas sur un bandeau à lui.
  function buildCard(r, role) {
    const u = urgency(r);
    const b = el('button', `pj-card pj-card--board u-${u.cls}`);
    b.type = 'button';
    if (isDimmed(r)) b.classList.add('is-dim');
    if (FLAG_LABEL[r.flag]) b.classList.add(r.flag === 'bloque' ? 'is-bloque' : 'is-a-voir');

    const top = el('div', 'pj-card-top');
    top.append(el('span', 'pj-card-client', clientName(r)), badgeEl(r));
    b.appendChild(top);

    const bas = el('div', 'pj-card-bas');
    bas.appendChild(el('span', 'pj-card-article', articleOf(r)));
    const sub = r.sub_stage && SUB_LABEL[r.sub_stage];
    bas.appendChild(el('span', 'pj-card-etape', sub || STAGE_LABEL[r.stage] || r.stage));
    b.appendChild(bas);

    const f = flagEl(r, true);
    if (f) b.appendChild(f);
    if (role === 'referent') b.appendChild(el('span', 'pj-role role-referent', 'J’épaule'));

    b.addEventListener('click', () => openDetail(r.id));
    return b;
  }

  // --- Header (construit une fois, mis à jour par refs) --------------------
  let $head, $searchInput, $searchClear, $actBadge, $kpiEls = {}, $chip, $chipLabel, $tabs;
  let $date, $alarme, $alarmeCalme;

  // Les QUATRE compteurs d'alarme. « Commandes actives » n'en est pas un : son
  // filtre ne retire rien (tout le point du jour EST actif) et son chiffre est
  // déjà porté par la vue Équipe.
  //
  // ILS NE S'AFFICHENT QUE S'ILS ONT QUELQUE CHOSE À DIRE. Les éteindre en gris
  // (première refonte) ne suffisait pas : quatre boîtes de 26 px occupent la
  // même surface, qu'elles portent un chiffre ou un zéro, et l'œil doit les
  // lire pour découvrir qu'elles ne disent rien. Un compteur à zéro quitte donc
  // la barre. Quand les quatre sont à zéro, la barre entière devient une phrase
  // — c'est-à-dire l'information « rien ne brûle », enfin lisible d'un coup.
  const STAT_KEYS = ['late', 'blocked', 'soon', 'waiting'];
  const STAT_LABEL = { late: 'en retard', blocked: 'bloquées', soon: 'sous 48 h', waiting: 'en attente client' };
  const STAT_HINT = {
    late: 'Échéance dépassée et la balle est dans notre camp',
    blocked: 'Signalées bloquées depuis le planning',
    soon: 'À rendre aujourd’hui, demain ou après-demain',
    waiting: 'Devis / BAT partis, ou commande prête à retirer',
  };

  // Date du jour en clair. L'horloge du POSTE fait foi : les postes sont
  // physiquement à Saint-Martin, c'est bien leur jour civil qu'on affiche
  // (la règle `America/Marigot` vise les dates calculées côté serveur, en UTC).
  function libelleDuJour() {
    const s = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function buildHead() {
    $head = el('header', 'pj-head');

    const row = el('div', 'pj-head-row');

    // Titre + date : un écran lu chaque matin doit dire de quel matin il parle.
    const title = el('div', 'pj-title');
    title.appendChild(el('h1', 'pj-title-h', 'Point du jour'));
    $date = el('p', 'pj-title-d', libelleDuJour());
    title.appendChild($date);
    row.appendChild(title);

    // Recherche : filtre en direct toutes les vues (estompe les non-concernées).
    const search = el('div', 'pj-search');
    search.appendChild(icon('search'));
    $searchInput = el('input', 'pj-search-input');
    $searchInput.type = 'text';
    $searchInput.placeholder = 'Filtrer le point du jour';
    $searchInput.setAttribute('aria-label', 'Filtrer les commandes affichées');
    $searchInput.autocomplete = 'off';
    // Rendu différé de quelques dizaines de millisecondes : `renderBody()`
    // reconstruit tout le point du jour, et le faire à chaque caractère
    // hachait la frappe sur la tablette.
    let rechercheTimer = null;
    $searchInput.addEventListener('input', () => {
      searchQuery = $searchInput.value.trim();
      $searchClear.hidden = !searchQuery;
      clearTimeout(rechercheTimer);
      rechercheTimer = setTimeout(renderBody, 120);
    });
    $searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchQuery) { e.stopPropagation(); $searchInput.value = ''; searchQuery = ''; $searchClear.hidden = true; renderBody(); }
    });
    $searchClear = el('button', 'pj-search-clear', '×');
    $searchClear.type = 'button';
    $searchClear.hidden = true;
    $searchClear.setAttribute('aria-label', 'Effacer le filtre');
    $searchClear.addEventListener('click', () => {
      $searchInput.value = ''; searchQuery = ''; $searchClear.hidden = true; renderBody(); $searchInput.focus();
    });
    search.appendChild($searchInput);
    search.appendChild($searchClear);
    row.appendChild(search);

    // Activité (badge rouge = nouveautés non lues).
    const act = el('button', 'pj-tool');
    act.type = 'button';
    act.append(icon('overview'), el('span', 'pj-tool-label', 'Activité'));
    $actBadge = el('span', 'pj-tool-badge');
    $actBadge.hidden = true;
    act.appendChild($actBadge);
    attachTip(act, 'Ce qui a bougé');
    act.addEventListener('click', openActivity);
    row.appendChild(act);

    // Machines (réglages du patron : importance + durée de fabrication).
    const mach = el('button', 'pj-tool pj-tool--icon');
    mach.type = 'button';
    mach.appendChild(icon('precision_manufacturing'));
    attachTip(mach, 'Machines — priorité & durée');
    mach.addEventListener('click', openMachines);
    row.appendChild(mach);

    // Attribution des catégories (config du patron).
    const gear = el('button', 'pj-tool pj-tool--icon');
    gear.type = 'button';
    gear.appendChild(icon('tune'));
    attachTip(gear, 'Attribution des catégories');
    gear.addEventListener('click', openConfig);
    row.appendChild(gear);

    $head.appendChild(row);

    // La barre d'alarme : UNE ligne, et seulement ce qui n'est pas à zéro.
    // Chaque compteur reste un filtre (clic = n'afficher que celles-là).
    $alarme = el('div', 'pj-alarme');
    for (const k of STAT_KEYS) {
      const b = el('button', `pj-al k-${k}`);
      b.type = 'button';
      const n = el('span', 'pj-al-n', '0');
      b.append(n, el('span', 'pj-al-l', STAT_LABEL[k]));
      b.setAttribute('aria-pressed', 'false');
      attachTip(b, STAT_HINT[k]);
      b.addEventListener('click', () => setKpiFilter(kpiFilter === k ? null : k));
      $kpiEls[k] = { btn: b, n };
      $alarme.appendChild(b);
    }
    // Ce qui s'affiche quand les quatre compteurs sont à zéro. C'est un état à
    // part entière, pas une absence : sans lui, la barre disparaîtrait et
    // l'écran laisserait croire qu'il n'a pas fini de charger.
    $alarmeCalme = el('p', 'pj-alarme-calme');
    $alarme.appendChild($alarmeCalme);

    // Chip « Filtre : … ✕ » (annule le filtre KPI actif).
    $chip = el('button', 'pj-filterchip');
    $chip.type = 'button';
    $chip.hidden = true;
    $chipLabel = el('span', null, '');
    $chip.append($chipLabel, el('span', 'pj-filterchip-x', '✕'));
    $alarme.appendChild($chip);

    $head.appendChild($alarme);

    // Onglets : moi · tout l'atelier · les autres · Équipe.
    $tabs = el('nav', 'pj-tabs');
    $tabs.setAttribute('aria-label', 'Vue du point du jour');
    $head.appendChild($tabs);

    return $head;
  }

  function setKpiFilter(k) {
    kpiFilter = k;
    renderHead();
    renderBody();
  }

  // Bascule d'onglet. `auto` distingue un choix de l'utilisateur (on ne lui
  // reprend plus la main) d'un recalage automatique après nomination du poste.
  function allerA(key, auto) {
    activeTab = key;
    if (!auto) ongletAuto = false;
    renderHead();
    renderBody();
  }

  function renderHead() {
    const k = kpis();
    const total = STAT_KEYS.reduce((s, key) => s + k[key], 0);
    for (const key of STAT_KEYS) {
      const n = k[key];
      $kpiEls[key].n.textContent = n;
      // Un compteur à zéro QUITTE la barre. L'éteindre en gris ne suffisait
      // pas : il occupait la même surface et l'œil devait le lire pour
      // découvrir qu'il n'avait rien à dire.
      $kpiEls[key].btn.hidden = !n;
      $kpiEls[key].btn.classList.toggle('active', kpiFilter === key);
      $kpiEls[key].btn.setAttribute('aria-pressed', String(kpiFilter === key));
    }
    // Rien ne brûle : une phrase à la place de quatre zéros.
    const actives = rows.filter(isActive).length;
    $alarmeCalme.hidden = total > 0;
    $alarmeCalme.textContent = actives
      ? `Rien ne brûle — ${actives} commande${actives > 1 ? 's' : ''} en cours.`
      : 'Rien en cours.';
    $alarme.classList.toggle('is-calme', total === 0);

    $chip.hidden = !kpiFilter;
    if (kpiFilter) $chipLabel.textContent = `Filtre : ${KPI_LABEL[kpiFilter]}`;

    $date.textContent = libelleDuJour();

    $actBadge.hidden = unseen === 0;
    $actBadge.textContent = unseen > 9 ? '9+' : String(unseen);

    // La personne au poste a pu se nommer après l'ouverture de l'écran : tant
    // qu'on n'a pas choisi d'onglet soi-même, la vue le suit.
    const qui = moi();
    if (ongletAuto && qui && activeTab !== qui) activeTab = qui;

    // Onglets (reconstruits : compte + point rouge + actif dépendent des données).
    $tabs.replaceChildren();
    const mkTab = (key, label, count, withDot, cls) => {
      const b = el('button', 'pj-tab' + (cls ? ' ' + cls : ''));
      b.type = 'button';
      const on = activeTab === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      b.appendChild(el('span', 'pj-tab-l', label));
      // Le compte est DANS l'onglet : savoir qui porte combien avant d'ouvrir
      // sa vue, c'est la moitié du dispatch du matin.
      if (count != null) b.appendChild(el('span', 'pj-tab-n', String(count)));
      if (withDot) {
        const d = el('span', 'pj-tab-dot');
        d.setAttribute('aria-label', 'en retard');
        b.appendChild(d);
      }
      b.addEventListener('click', () => allerA(key, false));
      $tabs.appendChild(b);
      return b;
    };

    // MOI D'ABORD, nommé. C'est la réponse à « qu'est-ce que j'ai à faire ? »,
    // et elle ne doit pas se chercher au milieu de cinq onglets identiques.
    if (qui) {
      const day = dayList(qui);
      mkTab(qui, `À toi, ${qui}`, day.length, day.some(isLate), 'pj-tab--moi');
    }
    // La file commune : ce que l'atelier doit sortir, tous pilotes confondus.
    const { queue } = rankFor(null);
    const todoLate = rows.some((r) => isActive(r) && r.flag !== 'bloque' && isLate(r));
    mkTab('todo', 'Tout l’atelier', queue.length, todoLate);

    // Les collègues — sans se répéter soi-même, qui a déjà son onglet en tête.
    for (const who of EMPLOYEES) {
      if (who === qui) continue;
      const day = dayList(who);
      mkTab(who, who, day.length, day.some(isLate));
    }
    mkTab('team', 'Équipe', null, false);
  }

  // Jauge de charge : une barre empilée, un segment par famille active, dans
  // l'ordre du pipeline, chaque segment nommé et chiffré sous la barre.
  //
  // ELLE A QUITTÉ L'EN-TÊTE. « Où le travail s'est empilé dans la chaîne » est
  // une question de dispatch, pas une question de poste : elle n'apporte rien à
  // qui vient lire sa propre file, et elle coûtait un bloc de six chiffres au-
  // dessus de chaque vue. Elle vit donc là où on se la pose — en tête de la vue
  // Équipe, avec les quatre charges individuelles.
  function buildCharge() {
    const act = rows.filter(isActive);
    const parFamille = ACTIVE_FAMILIES.map((slug) => ({
      slug,
      label: (FAMILIES.find((f) => f.slug === slug) || {}).label || slug,
      n: act.filter((r) => r.stage === slug).length,
    }));
    const total = act.length;

    const charge = el('section', 'pj-charge');
    const ch = el('header', 'pj-charge-head');
    ch.appendChild(el('h2', 'pj-charge-t', 'Charge par étape'));
    ch.appendChild(el('span', 'pj-charge-n', total
      ? `${total} commande${total > 1 ? 's' : ''} en cours`
      : 'Aucune commande en cours'));
    charge.appendChild(ch);

    const bar = el('div', 'pj-charge-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label',
      `Charge par étape : ${parFamille.map((f) => `${f.label} ${f.n}`).join(', ')}`);
    const leg = el('div', 'pj-charge-leg');

    if (!total) {
      bar.appendChild(el('span', 'pj-charge-vide'));
    } else {
      parFamille.forEach((f, i) => {
        if (!f.n) return;                        // un segment vide ne se dessine pas
        // Le barreau ne porte AUCUN chiffre : il montre une proportion. Les
        // valeurs exactes sont sur la légende juste dessous, à l'encre pleine —
        // un chiffre posé dans un gris moyen passe sous le seuil de contraste,
        // et un nombre sur chaque segment répète la légende pour rien.
        const seg = el('span', 'pj-charge-seg');
        seg.style.setProperty('--pal', String(i + 1));
        seg.style.flexGrow = String(f.n);
        attachTip(seg, `${f.label} — ${f.n} commande${f.n > 1 ? 's' : ''}`);
        bar.appendChild(seg);

        const lg = el('span', 'pj-charge-lg');
        lg.style.setProperty('--pal', String(i + 1));
        lg.append(el('span', 'pj-charge-lg-dot'), el('span', 'pj-charge-lg-t', f.label),
          el('span', 'pj-charge-lg-n', String(f.n)));
        leg.appendChild(lg);
      });
    }
    charge.append(bar, leg);
    return charge;
  }

  // En-tête de section : un titre, son compte, et un filet qui court jusqu'au
  // bord. Assez présent pour découper l'écran, assez sobre pour ne pas
  // rivaliser avec les lignes qu'il annonce.
  function sectionHead(title, count, hint) {
    const h = el('header', 'pj-section-head');
    h.appendChild(el('h2', 'pj-section-title', title));
    if (count != null) h.appendChild(el('span', 'pj-section-count', String(count)));
    h.appendChild(el('span', 'pj-section-rule'));
    if (hint) h.appendChild(el('span', 'pj-section-hint', hint));
    return h;
  }

  // --- Vue Équipe : 4 colonnes égales --------------------------------------
  function buildTeamView() {
    const wrap = el('div', 'pj-team');
    // La charge par étape ouvre la vue : c'est l'autre moitié du dispatch —
    // qui est chargé, et où le travail s'est empilé dans la chaîne.
    wrap.appendChild(buildCharge());

    const board = el('div', 'pj-board');
    // Charge de référence : la file la plus chargée donne l'échelle des jauges.
    // Sans repère commun, quatre colonnes de hauteurs différentes ne disent pas
    // qui est surchargé — c'est pourtant LA question du dispatch du matin.
    const charges = EMPLOYEES.map((w) => dayList(w).length);
    const pic = Math.max(1, ...charges);

    for (const who of EMPLOYEES) {
      const col = el('section', 'pj-col');
      const day = dayList(who);
      const late = day.filter(isLate).length;

      const head = el('button', 'pj-col-head');
      head.type = 'button';
      attachTip(head, `Ouvrir la file de ${who}`);

      const line = el('span', 'pj-col-line');
      line.append(avatarEl(who), el('span', 'pj-col-name', who),
        el('span', 'pj-col-count', String(day.length)));
      head.appendChild(line);

      // Jauge : la part de la charge du plus chargé. La fraction en retard s'y
      // détache en rouge — la seule couleur admise, et elle dit bien un état.
      const jauge = el('span', 'pj-col-load');
      const plein = el('span', 'pj-col-load-fill');
      plein.style.width = `${Math.round((day.length / pic) * 100)}%`;
      if (late) {
        const part = el('span', 'pj-col-load-late');
        part.style.width = `${Math.round((late / pic) * 100)}%`;
        jauge.appendChild(part);
      }
      jauge.appendChild(plein);
      head.appendChild(jauge);

      head.appendChild(el('span', 'pj-col-sub' + (late ? ' is-late' : ''),
        late ? `${late} en retard` : day.length ? 'À l’heure' : 'Disponible'));

      head.addEventListener('click', () => allerA(who, false));
      col.appendChild(head);

      const list = el('div', 'pj-col-cards');
      if (!day.length) {
        list.appendChild(el('div', 'pj-free', 'Peut prendre une urgence au dispatch'));
      } else {
        for (const r of day) list.appendChild(buildCard(r, roleOf(r, who)));
      }
      col.appendChild(list);
      board.appendChild(col);
    }
    wrap.appendChild(board);
    return wrap;
  }

  // --- Corps ---------------------------------------------------------------
  let $body;
  function renderBody() {
    if (!$body) return;
    $body.replaceChildren();
    if (!loaded) {
      // Tant que rien n'est chargé, on distingue « ça arrive » de « ça n'arrive
      // pas » : sinon un premier chargement en échec laissait « Chargement… »
      // à l'écran pour toujours, sans message ni nouvelle tentative.
      $body.appendChild(el('p', 'pj-empty', premierChargementKo
        ? 'Chargement impossible — nouvelle tentative dans quelques secondes.'
        : 'Chargement du planning…'));
      return;
    }
    if (activeTab === 'team') {
      $body.appendChild(buildTeamView());
    } else {
      // La file commune et la file d'une personne sont LE MÊME écran, à un
      // filtre près. Elles avaient deux mises en page différentes — la vue
      // personne posait en plus, à droite, « Je pilote » et « J'épaule », qui
      // relistaient dossier pour dossier ce que la file de gauche montrait
      // déjà. On lisait donc « Restaurant La Samanna » deux fois, à 40 cm
      // d'écart, sur le même écran.
      $body.appendChild(buildTodoView(activeTab === 'todo' ? null : activeTab));
    }
  }

  // --- Vue « À faire maintenant » : la file classée par le moteur -----------
  // Rang · étoiles · client · article · POURQUOI · pilote. Un clic ouvre le
  // détail (mêmes actions : envoyer vers, marquer traité). `who` filtre à une
  // personne (vue perso) ; sinon toute l'équipe.
  // On classe UNIQUEMENT les familles actives — la même liste que les KPI, les
  // colonnes et les vues perso. Le moteur a bien sa propre garde, mais elle
  // nomme ce qu'il faut EXCLURE : une position inconnue de lui (slug hérité
  // d'une bascule de pipeline, famille ajoutée demain) passerait au travers et
  // se retrouverait à réclamer du travail ici, invisible partout ailleurs.
  // MÉMOÏSÉ le temps d'un repeint (vidé par renderAll), comme les listes par
  // personne : l'entête a besoin du compte de la file commune et le corps de
  // la file elle-même — sans ce cache, tout le planning se reclassait deux
  // fois par rafraîchissement, à chaque évènement temps réel.
  function rankFor(who) {
    const cle = who || '*';
    const memo = classementsParPersonne.get(cle);
    if (memo) return memo;
    const base = rows.filter((r) => isActive(r)
      && (!who || effectivePilot(r) === who || effectiveReferents(r).includes(who)));
    const out = rankRequests(base, machines, { now: Date.now() });
    classementsParPersonne.set(cle, out);
    return out;
  }

  // Nombre de cartes réellement MONTÉES dans la file d'équipe. Le classement,
  // lui, porte toujours sur toute la file : c'est l'affichage qu'on borne, pas
  // le calcul — le compteur de l'entête continue d'annoncer le total.
  const TODO_MAX = 50;

  // ---------------------------------------------------------------------------
  // LA LIGNE — six cellules, et pas deux qui disent la même chose
  // ---------------------------------------------------------------------------
  // Avant : rang · priorité · client+article · étape · POURQUOI · échéance ·
  // pilote. Sur une ligne en retard, cela donnait, de gauche à droite :
  //
  //     2   ▮▮▮   Restaurant La Samanna   À chiffrer   « En retard de 2 j ·
  //         (haute)  Uniformes 45 pièces    Demande…      Priorité haute (3★) »
  //         → Retard 2 j → C Charlie
  //
  // c'est-à-dire l'échéance écrite DEUX fois, la priorité TROIS fois, et — dans
  // sa propre vue — une colonne « pilote » constante sur les dix lignes.
  //
  // Maintenant : rang · client+article · étape · motif RESTANT · échéance ·
  // priorité (si haute) · porteur (pilote ailleurs, rôle chez soi). Les
  // colonnes tombent au même endroit d'une ligne à l'autre : aucune piste
  // `auto`, un élément absent ne décale pas la file (cf. la carte du planning).
  function buildTodoCard(item, index, who) {
    const { r, reasons } = item;
    const u = urgency(r);
    const b = el('button', `pj-card pj-row u-${u.cls}`);
    b.type = 'button';
    if (isDimmed(r)) b.classList.add('is-dim');
    if (FLAG_LABEL[r.flag]) b.classList.add(r.flag === 'bloque' ? 'is-bloque' : 'is-a-voir');

    b.appendChild(el('span', 'pj-row-rank', String(index + 1)));

    const qui = el('span', 'pj-row-who');
    qui.append(el('span', 'pj-card-client', clientName(r)),
      el('span', 'pj-card-article', articleOf(r)));
    b.appendChild(qui);

    b.appendChild(posEl(r));
    b.appendChild(badgeEl(r));
    b.appendChild(prioEl(r));
    // La colonne « pilote » n'existe QUE là où le pilote change d'une ligne à
    // l'autre. Dans sa propre file, elle affichait son propre nom dix fois.
    if (!who) b.appendChild(porteurEl(r, null));

    // Deuxième rang : ce qui n'arrive qu'exceptionnellement. Une colonne dédiée
    // à l'exception reste vide la plupart du temps — 176 px de rien au milieu
    // de la file — alors qu'une ligne qui n'apparaît que si elle a quelque
    // chose à dire ne coûte rien aux autres.
    const plus = el('div', 'pj-row-plus');
    if (who && roleOf(r, who) === 'referent') {
      plus.appendChild(el('span', 'pj-role role-referent', 'J’épaule'));
    }
    // Le « pourquoi » est du TEXTE — une explication, pas un état — et il ne
    // garde que ce que les autres cellules ne portent pas déjà.
    const motifs = motifsUtiles(reasons);
    if (motifs.length) plus.appendChild(el('span', 'pj-row-why', motifs.join(' · ')));
    // Alerte : elle prend toute la largeur sous le reste. Un dossier bloqué se
    // voit d'une rangée entière, pas d'un liseré de 3 px.
    const f = flagEl(r, true);
    if (f) plus.appendChild(f);
    if (plus.children.length) b.appendChild(plus);

    b.addEventListener('click', () => openDetail(r.id));
    return b;
  }

  // Ligne du bac « à débloquer / relancer » (hors file : on attend quelqu'un).
  // Même grille que la file, le rang et la priorité en moins : ces dossiers
  // n'attendent pas de nous qu'on les fasse avancer mais qu'on aille chercher
  // la réponse — les classer entre eux n'aurait aucun sens.
  function buildHoldCard(r, kind, who) {
    const b = el('button', 'pj-card pj-row pj-row--hold ' + (kind === 'bloque' ? 'is-bloque' : 'is-attente'));
    b.type = 'button';
    if (isDimmed(r)) b.classList.add('is-dim');

    b.appendChild(el('span', 'pj-hold-tag ' + (kind === 'bloque' ? 't-bloque' : 't-attente'),
      kind === 'bloque' ? 'Bloquée' : 'À relancer'));

    const qui = el('span', 'pj-row-who');
    qui.append(el('span', 'pj-card-client', clientName(r)),
      el('span', 'pj-card-article', articleOf(r)));
    b.appendChild(qui);

    b.appendChild(posEl(r));

    const why = kind === 'bloque'
      ? (r.flag_reason || 'Sans motif précisé')
      : (WAITING_REASON[r.sub_stage] || 'En attente d’une réponse du client');
    const w = el('span', 'pj-row-why', why);
    attachTip(w, why);
    b.appendChild(w);

    b.appendChild(badgeEl(r));
    if (!who) b.appendChild(porteurEl(r, null));

    b.addEventListener('click', () => openDetail(r.id));
    return b;
  }

  // Rangée d'en-têtes de la grille : elle nomme les colonnes une fois pour
  // toutes. C'est ce qui fait basculer une pile de cartes en TABLEAU — sans
  // elle, chaque ligne doit être relue pour savoir ce que porte chaque zone.
  function buildRowHead(cols) {
    const h = el('div', 'pj-row-head');
    for (const c of cols) h.appendChild(el('span', 'pj-row-head-c c-' + c.k, c.t));
    return h;
  }
  // Les colonnes : la dernière n'existe que dans une vue d'ATELIER, où le
  // pilote change d'une ligne à l'autre. Dans la file d'une personne, elle
  // répéterait son nom à chaque rang.
  const colsFile = (who) => [
    { k: 'rank', t: '#' }, { k: 'who', t: 'Client & projet' },
    { k: 'pos', t: 'Étape' }, { k: 'due', t: 'Échéance' }, { k: 'prio', t: 'Prio' },
    ...(who ? [] : [{ k: 'pilot', t: 'Pilote' }]),
  ];
  // Le bac garde SA colonne « pourquoi » : ici, ce qu'on attend est le sujet
  // même de la ligne, pas une exception.
  const colsHold = (who) => [
    { k: 'tag', t: 'État' }, { k: 'who', t: 'Client & projet' }, { k: 'pos', t: 'Étape' },
    { k: 'why', t: 'On attend quoi' }, { k: 'due', t: 'Échéance' },
    ...(who ? [] : [{ k: 'pilot', t: 'Pilote' }]),
  ];

  function buildTodoView(who) {
    const wrap = el('div', 'pj-todo');
    const { queue, blocked, waiting } = rankFor(who);

    const main = el('section', 'pj-todo-sec');
    main.appendChild(sectionHead(who ? `À faire — ${who}` : 'À faire maintenant',
      queue.length, 'la plus urgente en tête'));
    if (!queue.length) {
      main.appendChild(el('p', 'pj-empty', 'Rien à lancer — tout est à jour.'));
    } else {
      // `is-atelier` = la colonne « pilote » existe. C'est la LISTE qui la
      // porte, pas la ligne : les pistes de la grille doivent être identiques
      // pour l'entête de colonnes et pour toutes ses lignes.
      const list = el('div', 'pj-todo-list' + (who ? '' : ' is-atelier'));
      list.appendChild(buildRowHead(colsFile(who)));
      // La file est CLASSÉE : au-delà des premières, on ne lit plus, on fait
      // défiler. Elle montait pourtant une carte par commande active du
      // planning — des centaines, reconstruites à chaque évènement temps réel.
      // La grille du planning plafonne à 400 depuis longtemps ; celle-ci
      // n'avait aucun plafond.
      const montrees = queue.slice(0, TODO_MAX);
      montrees.forEach((item, i) => list.appendChild(buildTodoCard(item, i, who)));
      main.appendChild(list);
      // Un plafond muet se lit « il n'y a que ça » : on dit ce qu'on ne montre pas.
      if (queue.length > TODO_MAX) {
        main.appendChild(el('p', 'pj-empty',
          `${TODO_MAX} premières commandes de la file — ${queue.length - TODO_MAX} autres suivent, `
          + 'moins urgentes.'));
      }
    }
    wrap.appendChild(main);

    // Bac « à débloquer / relancer » : ce qui attend quelqu'un d'autre, à part.
    if (blocked.length || waiting.length) {
      const sec = el('section', 'pj-todo-sec');
      sec.appendChild(sectionHead('À débloquer / relancer', blocked.length + waiting.length,
        'la balle n’est pas dans notre camp'));
      const list = el('div', 'pj-hold-list' + (who ? '' : ' is-atelier'));
      list.appendChild(buildRowHead(colsHold(who)));
      for (const r of blocked) list.appendChild(buildHoldCard(r, 'bloque', who));
      for (const r of waiting) list.appendChild(buildHoldCard(r, 'attente', who));
      sec.appendChild(list);
      wrap.appendChild(sec);
    }
    return wrap;
  }

  function renderAll() {
    if (!$head) return;
    // Les listes par personne se recalculent une fois par repeint : l'entête
    // (points rouges), la vue Équipe et la vue personne relisaient chacune la
    // même file — jusqu'à deux balayages + un tri complet du planning PAR
    // EMPLOYÉ et PAR APPEL, plusieurs fois par rafraîchissement.
    invaliderListes();
    renderHead();
    renderBody();
    renderDetailIfOpen();
  }

  // --- Panneau détail (slide-over droit 420px) -----------------------------
  let detailEl = null, detailScrim = null, detailId = null;

  function ensureDetail() {
    if (detailEl) return;
    detailScrim = el('div', 'dd-scrim');
    detailScrim.addEventListener('click', closeDetail);
    detailEl = el('aside', 'dd-panel');
    detailEl.setAttribute('role', 'dialog');
    detailEl.setAttribute('aria-modal', 'true');
    detailEl.setAttribute('aria-label', 'Détail de la commande');
    document.body.append(detailScrim, detailEl);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && detailId) closeDetail();
    });
  }

  let desarmerDetail = null;

  function openDetail(id) {
    ensureDetail();
    detailId = String(id);
    renderDetail();
    detailScrim.classList.add('open');
    detailEl.classList.add('open');
    if (!desarmerDetail) {
      desarmerDetail = armerModale(detailEl, { premier: () => detailEl.querySelector('.dd-close') });
    }
  }

  function closeDetail() {
    if (!detailEl) return;
    detailId = null;
    if (desarmerDetail) { desarmerDetail(); desarmerDetail = null; }
    detailScrim.classList.remove('open');
    detailEl.classList.remove('open');
  }

  // Repeint différé tant que la souris est SUR le panneau : le reconstruire
  // (replaceChildren) sous le pointeur démonte la pastille en plein clic, tue
  // la transition en cours et laisse l'infobulle orpheline. Poste souris
  // uniquement : au doigt, `:hover` colle après le tap et différerait pour rien.
  const POINTEUR_SOURIS = matchMedia('(hover: hover)');
  let detailDiffere = false;
  function renderDetailIfOpen() {
    if (!detailId) return;
    const r = rows.find((x) => String(x.id) === detailId);
    // La commande a été traitée / supprimée entre-temps : on referme.
    if (!r || !isActive(r)) { closeDetail(); return; }
    if (POINTEUR_SOURIS.matches && detailEl && detailEl.matches(':hover')) {
      if (!detailDiffere) {
        detailDiffere = true;
        detailEl.addEventListener('pointerleave', () => {
          detailDiffere = false;
          if (detailId) renderDetailIfOpen();
        }, { once: true });
      }
      return;
    }
    renderDetail();
  }

  function renderDetail() {
    const r = rows.find((x) => String(x.id) === detailId);
    if (!r) { closeDetail(); return; }
    detailEl.replaceChildren();

    const close = el('button', 'dd-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer le détail');
    close.appendChild(icon('close'));
    close.addEventListener('click', closeDetail);
    detailEl.appendChild(close);

    // En-tête : étoiles (réglables ici), client, article.
    const head = el('header', 'dd-head');
    const stars = el('div', 'dd-stars');
    const cur = prioBand(r);
    for (let i = 1; i <= 3; i++) {
      const s = el('button', 'dd-star' + (i <= cur ? ' on' : ''), i <= cur ? '★' : '☆');
      s.type = 'button';
      s.setAttribute('aria-label', `Priorité ${i} sur 3`);
      s.addEventListener('click', () => {
        if (prioBand(r) === i) return;
        const prev = r.priority;
        r.priority = i;
        renderAll();
        api('PATCH', `/api/requests/${r.id}`, { priority: i }).catch(() => {
          r.priority = prev; renderAll(); showToast('Échec — priorité non enregistrée');
        });
      });
      stars.appendChild(s);
    }
    head.appendChild(stars);
    head.appendChild(el('h2', 'dd-client', clientName(r)));
    head.appendChild(el('p', 'dd-article', articleOf(r)));
    // L'échéance seule : la position part dans sa propre section « Position
    // actuelle », plus lisible que deux puces tronquées collées au badge.
    const badges = el('div', 'dd-badges');
    badges.appendChild(badgeEl(r));
    head.appendChild(badges);
    detailEl.appendChild(head);

    const scroll = el('div', 'dd-scroll');

    // Alerte en cours : on la voit et on la LÈVE d'ici (au point du matin, on
    // débloque en direct). La poser avec un motif se fait dans le Planning.
    if (FLAG_LABEL[r.flag]) {
      const sec = el('section', `dd-flag f-${r.flag === 'bloque' ? 'bloque' : 'a-voir'}`);
      const body = el('div', 'dd-flag-body');
      body.appendChild(el('span', 'dd-flag-tag', FLAG_LABEL[r.flag]));
      body.appendChild(el('p', 'dd-flag-why', r.flag_reason || 'Aucun motif précisé'));
      const clear = el('button', 'dd-flag-clear');
      clear.type = 'button';
      clear.append(icon('check'), el('span', null, 'Lever'));
      clear.addEventListener('click', () => clearFlag(r));
      sec.append(icon(r.flag === 'bloque' ? 'block' : 'visibility'), body, clear);
      scroll.appendChild(sec);
    }

    // Prochaine action AVANT le mur de pastilles : c'est la consigne, les
    // pastilles ne sont que le moyen de l'exécuter. Enterrée sous vingt
    // boutons identiques, personne ne la lisait.
    const na = el('section', 'dd-next');
    na.appendChild(el('span', 'dd-next-label', 'Prochaine action'));
    na.appendChild(el('p', 'dd-next-text', nextActionOf(r)));
    scroll.appendChild(na);

    // Position actuelle : d'où l'on part, nommée en clair avant de dire où
    // l'envoyer. La pastille « en cours » perdue au milieu de la liste ne
    // suffisait pas à répondre à « c'en est où ? ».
    const pos = el('section', 'dd-pos');
    pos.appendChild(el('span', 'dd-sec-title', 'Position actuelle'));
    const posLine = el('p', 'dd-pos-line');
    posLine.appendChild(el('span', 'dd-pos-fam', STAGE_LABEL[r.stage] || r.stage));
    if (r.sub_stage && SUB_LABEL[r.sub_stage]) {
      posLine.appendChild(el('span', 'dd-pos-sep', '›'));
      posLine.appendChild(el('span', 'dd-pos-sub', SUB_LABEL[r.sub_stage]));
    }
    pos.appendChild(posLine);
    scroll.appendChild(pos);

    // « Envoyer vers » — un tap change la catégorie ; le pilote suit
    // automatiquement l'attribution (sauf pilote posé à la main).
    const send = el('section', 'dd-send');
    send.appendChild(el('h3', 'dd-sec-title', 'Envoyer vers'));
    for (const fam of FAMILIES) {
      if (!ACTIVE_SET.has(fam.slug)) continue;
      const subs = SUB_STAGES[fam.slug];
      const group = el('div', 'dd-group');
      if (subs && subs.length) {
        group.appendChild(el('h4', 'dd-group-title', fam.label));
        const pills = el('div', 'dd-pills');
        for (const sub of subs) pills.appendChild(sendPill(r, fam, sub));
        group.appendChild(pills);
      } else {
        const pills = el('div', 'dd-pills');
        pills.appendChild(sendPill(r, fam, null));
        group.appendChild(pills);
      }
      send.appendChild(group);
    }
    scroll.appendChild(send);

    // Équipe : pilote effectif + référents effectifs (manuel, sinon catégorie).
    const team = el('section', 'dd-team');
    team.appendChild(el('h3', 'dd-sec-title', 'Équipe'));
    const pilot = effectivePilot(r);
    const line = el('div', 'dd-team-line');
    const p1 = el('span', 'dd-team-who');
    p1.appendChild(avatarEl(pilot));
    p1.appendChild(el('span', 'dd-team-name', pilot || 'À attribuer'));
    p1.appendChild(el('span', 'dd-team-tag', isManualPilot(r) ? 'Pilote' : 'Pilote · auto'));
    line.appendChild(p1);
    const refs = effectiveReferents(r);
    if (!refs.length) {
      const p2 = el('span', 'dd-team-who');
      p2.appendChild(el('span', 'dd-team-none', 'Pas de référent'));
      line.appendChild(p2);
    } else {
      const tag = isManualReferent(r) ? 'Référent' : 'Référent · auto';
      for (const who of refs) {
        const p2 = el('span', 'dd-team-who');
        p2.appendChild(avatarEl(who));
        p2.appendChild(el('span', 'dd-team-name', who));
        p2.appendChild(el('span', 'dd-team-tag', tag));
        line.appendChild(p2);
      }
    }
    team.appendChild(line);
    scroll.appendChild(team);

    detailEl.appendChild(scroll);

    // Footer : marquer traité + ouvrir dans le planning.
    const foot = el('footer', 'dd-foot');
    const done = el('button', 'dd-done');
    done.type = 'button';
    done.append(icon('check'), el('span', null, 'Marquer traité'));
    done.addEventListener('click', () => markDone(r));
    const open = el('button', 'dd-open');
    open.type = 'button';
    open.append(icon('open_in_new'), el('span', null, 'Ouvrir dans le planning'));
    open.addEventListener('click', () => { closeDetail(); jumpToPlanning(r); });
    foot.append(done, open);
    detailEl.appendChild(foot);
  }

  function sendPill(r, fam, sub) {
    const slug = sub ? sub.slug : fam.slug;
    const label = sub ? sub.label : fam.label;
    const current = sub ? r.sub_stage === sub.slug : (r.stage === fam.slug && !r.sub_stage);
    const b = el('button', 'dd-pill' + (current ? ' current' : ''));
    b.type = 'button';
    const owner = ownerOf(fam.slug, sub ? sub.slug : null);
    if (owner) {
      const dot = el('span', 'dd-pill-av', owner.charAt(0).toUpperCase());
      dot.style.setProperty('--av', AVATAR[owner] || AVATAR_DEFAULT);
      b.appendChild(dot);
    }
    b.appendChild(el('span', null, label));
    if (current) {
      b.setAttribute('aria-current', 'true');
    } else {
      const refs = referentsOf(fam.slug, sub ? sub.slug : null);
      let tip = `Envoyer vers ${label}`;
      if (owner) tip += ` — pilote par défaut : ${owner}`;
      if (refs.length) tip += `${owner ? ' · ' : ' — '}référents : ${refs.join(', ')}`;
      attachTip(b, tip);
      b.addEventListener('click', () => sendTo(r, fam.slug, sub ? sub.slug : null));
    }
    return b;
  }

  // Envoi de catégorie (optimiste + rollback). Ne PATCH que stage/sub_stage :
  // le pilote effectif se recalcule tout seul via l'attribution — un pilote
  // posé manuellement (r.responsable) n'est jamais touché.
  function sendTo(r, stage, sub) {
    const before = effectivePilot(r);
    const prev = { stage: r.stage, sub_stage: r.sub_stage };
    r.stage = stage;
    r.sub_stage = sub;
    const after = effectivePilot(r);
    const target = sub ? SUB_LABEL[sub] : STAGE_LABEL[stage];
    let msg = `${clientName(r)} → ${target}`;
    if (before !== after) msg += ` · pilote ${before || 'À attribuer'} → ${after || 'À attribuer'}`;
    const trace = logActivity(msg, AVATAR[after] || 'var(--pj-accent)');
    renderAll();
    showToast(msg);
    api('PATCH', `/api/requests/${r.id}`, { stage, sub_stage: sub }).catch(() => {
      Object.assign(r, prev);
      retirerActivite(trace);
      renderAll();
      showToast(`Échec de l’envoi — ${clientName(r)} reste en ${STAGE_LABEL[prev.stage]}`);
      refresh();
    });
  }

  // Lever l'alerte (optimiste + rollback). Le motif part avec elle : le serveur
  // efface flag_reason dès que flag repasse à null.
  function clearFlag(r) {
    const prev = { flag: r.flag, flag_reason: r.flag_reason };
    r.flag = null;
    r.flag_reason = null;
    const trace = logActivity(`${clientName(r)} — alerte levée ✓`, 'var(--success)');
    renderAll();
    showToast(`${clientName(r)} — alerte levée ✓`);
    api('PATCH', `/api/requests/${r.id}`, { flag: null }).catch(() => {
      Object.assign(r, prev);
      retirerActivite(trace);
      renderAll();
      showToast('Échec — l’alerte est toujours là');
      refresh();
    });
  }

  // Marquer traité : clôt la commande (famille « Paiement & clôture », sur
  // « Paiement à contrôler ») → elle sort de toutes les vues actives et
  // « Commandes actives » décrémente.
  function markDone(r) {
    const prev = { stage: r.stage, sub_stage: r.sub_stage };
    r.stage = 'paiement';
    r.sub_stage = 'paiement_a_controler';
    const trace = logActivity(`${clientName(r)} — marquée traitée ✓`, 'var(--success)');
    closeDetail();
    renderAll();
    showToast(`${clientName(r)} — marquée traitée ✓`);
    api('PATCH', `/api/requests/${r.id}`, { stage: 'paiement', sub_stage: 'paiement_a_controler' }).catch(() => {
      Object.assign(r, prev);
      retirerActivite(trace);
      renderAll();
      showToast('Échec — la commande n’a pas été clôturée');
      refresh();
    });
  }

  // --- Fil d'activité « Ce qui a bougé » -----------------------------------
  let activityEl = null, activityScrim = null, activityOpen = false, $activityList = null;

  // L'entête (badge « non lus », onglets) se repeint UNE fois par rafale : un
  // rafraîchissement qui diffe vingt lignes appelait vingt fois renderHead —
  // vingt reconstructions de la barre d'onglets pour un badge qui ne fait
  // qu'incrémenter. La micro-tâche part après la rafale entière.
  let entetePrevue = false;
  function planifierEntete() {
    if (entetePrevue) return;
    entetePrevue = true;
    queueMicrotask(() => { entetePrevue = false; if ($head) renderHead(); });
  }
  function logActivity(text, color) {
    const ligne = { ts: Date.now(), text, color: color || 'var(--pj-accent)' };
    activity.unshift(ligne);
    if (activity.length > 80) activity.length = 80;
    if (activityOpen) renderActivityList();
    else { unseen++; planifierEntete(); }
    return ligne;
  }

  // L'ENTRÉE SE RETIRE QUAND L'ÉCRITURE EST RETOMBÉE. Les trois gestes du
  // Point du jour (envoyer, lever l'alerte, marquer traitée) écrivent au fil
  // AVANT la réponse du serveur — c'est ce qui les rend vifs. Mais quand le
  // PATCH échouait, on remettait la commande en place, on le disait dans un
  // message… et la ligne « Untel → Production » restait au fil. Or « Ce qui a
  // bougé » est ce que le patron lit pour savoir ce qui s'est passé : il y
  // trouvait un évènement qui n'a jamais eu lieu, longtemps après la
  // disparition du message d'échec.
  function retirerActivite(ligne) {
    if (!ligne) return;
    const i = activity.indexOf(ligne);
    if (i < 0) return;                       // déjà sortie par le plafond de 80
    activity.splice(i, 1);
    if (activityOpen) renderActivityList();
    else { unseen = Math.max(0, unseen - 1); planifierEntete(); }
  }

  // Diff entre l'ancien cache et le nouveau : alimente le fil avec ce qui a
  // bougé AILLEURS (Planning, autres postes). Nos propres actions optimistes
  // sont déjà loguées et déjà dans le cache → le diff ne les recompte pas.
  function diffIntoActivity(oldById, fresh) {
    for (const r of fresh) {
      const o = oldById.get(String(r.id));
      if (!o) {
        if (isActive(r)) {
          logActivity(`Nouvelle commande — ${clientName(r)} (${STAGE_LABEL[r.stage] || r.stage})`, 'var(--pj-accent)');
        }
        continue;
      }
      const wasActive = ACTIVE_SET.has(o.stage);
      if (r.stage === 'paiement' && o.stage !== 'paiement' && wasActive) {
        logActivity(`${clientName(r)} — marquée traitée ✓`, 'var(--success)');
        continue;
      }
      if (!isActive(r) && !wasActive) continue;
      if (o.stage !== r.stage || (o.sub_stage ?? null) !== (r.sub_stage ?? null)) {
        const target = (r.sub_stage && SUB_LABEL[r.sub_stage]) || STAGE_LABEL[r.stage] || r.stage;
        logActivity(`${clientName(r)} → ${target}`, AVATAR[effectivePilot(r)] || 'var(--pj-accent)');
      }
      if ((o.responsable ?? null) !== (r.responsable ?? null)) {
        const who = r.responsable || 'À attribuer';
        logActivity(`${clientName(r)} · pilote → ${who}`, AVATAR[r.responsable] || 'var(--pj-accent)');
      }
    }
  }

  function ensureActivity() {
    if (activityEl) return;
    activityScrim = el('div', 'dd-scrim');
    activityScrim.addEventListener('click', closeActivity);
    activityEl = el('aside', 'pj-feed');
    activityEl.setAttribute('role', 'dialog');
    activityEl.setAttribute('aria-modal', 'true');
    activityEl.setAttribute('aria-label', 'Fil d’activité');
    const close = el('button', 'dd-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer le fil d’activité');
    close.appendChild(icon('close'));
    close.addEventListener('click', closeActivity);
    activityEl.appendChild(close);
    activityEl.appendChild(el('h2', 'pj-feed-title', 'Ce qui a bougé'));
    $activityList = el('div', 'pj-feed-list');
    activityEl.appendChild($activityList);
    document.body.append(activityScrim, activityEl);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activityOpen) closeActivity();
    });
  }

  function renderActivityList() {
    $activityList.replaceChildren();
    if (!activity.length) {
      $activityList.appendChild(el('p', 'pj-empty', 'Rien n’a bougé pour le moment.'));
      return;
    }
    for (const a of activity) {
      const line = el('div', 'pj-feed-item');
      const dot = el('span', 'pj-feed-dot');
      dot.style.setProperty('--dot', a.color);
      line.append(dot, el('span', 'pj-feed-text', a.text), el('time', 'pj-feed-time', fmtTime(a.ts)));
      $activityList.appendChild(line);
    }
  }

  let desarmerActivity = null;

  function openActivity() {
    ensureActivity();
    unseen = 0;
    renderHead();
    renderActivityList();
    activityOpen = true;
    activityScrim.classList.add('open');
    activityEl.classList.add('open');
    if (!desarmerActivity) {
      desarmerActivity = armerModale(activityEl, { premier: () => activityEl.querySelector('.dd-close') });
    }
  }

  function closeActivity() {
    if (!activityEl) return;
    activityOpen = false;
    if (desarmerActivity) { desarmerActivity(); desarmerActivity = null; }
    activityScrim.classList.remove('open');
    activityEl.classList.remove('open');
  }

  // --- Attribution des catégories (config du patron, conservée) ------------
  let configOpen = false;

  function openConfig() {
    // Garde de réentrance : deux taps rapides sur l'engrenage empilaient deux
    // fenêtres — Échap fermait la première (invisible), posait configOpen à
    // faux, et l'Échap de la seconde ne répondait plus jamais.
    if (configOpen) return;
    const overlay = el('div', 'cat-overlay');
    const card = el('div', 'cat-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    // L'écouteur Échap se retire dans TOUS les cas de fermeture. Posé sur
    // `document` et retiré seulement par lui-même, il restait accroché à
    // chaque fermeture par la croix ou par le fond — une journée de réglages
    // en accumulait des dizaines. Chaque fenêtre ne ferme QU'ELLE-MÊME.
    const surEchap = (e) => { if (e.key === 'Escape') close(); };
    let desarmer = null;
    const close = () => {
      configOpen = false;
      document.removeEventListener('keydown', surEchap);
      if (desarmer) { desarmer(); desarmer = null; }
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
    };

    const closeBtn = el('button', 'cat-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.appendChild(icon('close'));
    closeBtn.addEventListener('click', close);

    const title = el('h2', 'cat-title', 'Attribution des catégories');
    const desc = el('p', 'cat-desc', 'Qui pilote chaque catégorie par défaut, et qui l’épaule ? Une ligne sans pilote ni référent saisi « tombe » automatiquement sur l’équipe choisie ici. Le pilote et le référent posés sur une ligne précise restent prioritaires.');
    card.append(closeBtn, title, desc);

    const list = el('div', 'cat-list');
    const mkRow = (slug, label, indented) => {
      const row = el('div', 'cat-row' + (indented ? ' indented' : ''));
      row.appendChild(el('span', 'cat-row-label', label));

      const fields = el('div', 'cat-row-fields');

      // Pilote : un seul employé (ou aucun).
      const pilotField = el('label', 'cat-field');
      pilotField.appendChild(el('span', 'cat-field-label', 'Pilote'));
      const select = document.createElement('select');
      select.className = 'cat-row-select';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '— (aucun)';
      select.appendChild(none);
      for (const who of EMPLOYEES) {
        const opt = document.createElement('option');
        opt.value = who;
        opt.textContent = who;
        select.appendChild(opt);
      }
      select.value = owners[slug] || '';
      select.addEventListener('change', () => {
        if (select.value) owners[slug] = select.value;
        else delete owners[slug];
        api('PUT', '/api/category-owners', owners)
          .then((saved) => { owners = saved && typeof saved === 'object' ? saved : {}; renderAll(); })
          .catch(() => { showToast('Échec de l’enregistrement de l’attribution'); refresh(); });
      });
      pilotField.appendChild(select);
      fields.appendChild(pilotField);

      // Référents : 0..N employés, une puce par employé (tap pour ajouter/retirer).
      const refField = el('div', 'cat-field');
      refField.appendChild(el('span', 'cat-field-label', 'Référents'));
      const chips = el('div', 'cat-refs');
      for (const who of EMPLOYEES) {
        const on = (catRefs[slug] || []).includes(who);
        const chip = el('button', 'cat-ref-chip' + (on ? ' on' : ''));
        chip.type = 'button';
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        const av = el('span', 'cat-ref-av', who.charAt(0).toUpperCase());
        av.style.setProperty('--av', AVATAR[who] || AVATAR_DEFAULT);
        chip.append(av, el('span', null, who));
        chip.addEventListener('click', () => {
          const cur = new Set(catRefs[slug] || []);
          if (cur.has(who)) cur.delete(who); else cur.add(who);
          const next = EMPLOYEES.filter((e) => cur.has(e));
          if (next.length) catRefs[slug] = next; else delete catRefs[slug];
          const nowOn = cur.has(who);
          chip.classList.toggle('on', nowOn);
          chip.setAttribute('aria-pressed', nowOn ? 'true' : 'false');
          api('PUT', '/api/category-referents', catRefs)
            .then((saved) => { catRefs = saved && typeof saved === 'object' ? saved : {}; renderAll(); })
            .catch(() => { showToast('Échec de l’enregistrement des référents'); refresh(); });
        });
        chips.appendChild(chip);
      }
      refField.appendChild(chips);
      fields.appendChild(refField);

      row.appendChild(fields);
      return row;
    };
    for (const slug of ACTIVE_FAMILIES) {
      const fam = FAMILIES.find((f) => f.slug === slug);
      if (!fam) continue;
      list.appendChild(mkRow(fam.slug, fam.label, false));
      const subs = SUB_STAGES[fam.slug];
      if (subs) for (const sub of subs) list.appendChild(mkRow(sub.slug, sub.label, true));
    }
    card.appendChild(list);
    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    configOpen = true;
    requestAnimationFrame(() => overlay.classList.add('open'));
    document.addEventListener('keydown', surEchap);
    desarmer = armerModale(card, { premier: () => closeBtn });
  }

  // --- Réglages « Machines » (config du patron) ----------------------------
  // Deux leviers par poste : IMPORTANCE (curseur 1..5 → remonte les commandes
  // dans « À faire maintenant ») et DURÉE de fabrication (min/pièce, facultative).
  // On édite une copie de travail et on enregistre l'ensemble à chaque change ;
  // le SSE resynchronise les autres postes.
  let machinesOpen = false;
  function openMachines() {
    // Même garde de réentrance que l'attribution : un tap répété n'empile pas
    // deux fenêtres (et deux écouteurs Échap) l'une sur l'autre.
    if (machinesOpen) return;
    machinesOpen = true;
    const overlay = el('div', 'cat-overlay');
    const card = el('div', 'cat-card mac-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    // Même précaution que pour l'attribution : l'écouteur Échap part avec la
    // fenêtre, quelle que soit la façon dont on l'a fermée.
    const surEchap = (e) => { if (e.key === 'Escape') close(); };
    let desarmer = null;
    const close = () => {
      machinesOpen = false;
      document.removeEventListener('keydown', surEchap);
      if (desarmer) { desarmer(); desarmer = null; }
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
    };

    const closeBtn = el('button', 'cat-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.appendChild(icon('close'));
    closeBtn.addEventListener('click', close);

    const title = el('h2', 'cat-title', 'Machines');
    const desc = el('p', 'cat-desc', 'Par poste : une IMPORTANCE (plus elle est haute, plus ses commandes remontent dans « À faire maintenant ») et une DURÉE de fabrication indicative, facultative. Ces réglages pèsent partout, en temps réel.');
    card.append(closeBtn, title, desc);

    // Copie de travail : on édite `work`, on enregistre l'ensemble à chaque change.
    const work = machines.map((m) => ({ ...m }));
    const list = el('div', 'mac-list');

    const save = () => {
      api('PUT', '/api/machines', work)
        .then((saved) => {
          machines = Array.isArray(saved) ? saved : [];
          // La copie de travail se recale sur ce que le serveur a VRAIMENT
          // retenu : il déduplique les machines de même nom, et la seconde
          // restait sinon affichée dans la fenêtre alors qu'elle n'existait
          // plus — on la réenvoyait à chaque enregistrement suivant.
          if (machines.length !== work.length) {
            work.length = 0;
            machines.forEach((m) => work.push({ ...m }));
            renderRows();
          }
          renderAll();
        })
        .catch(() => { showToast('Échec de l’enregistrement des machines'); refresh(); });
    };

    function mkMachineRow(m, i) {
      const rowEl = el('div', 'mac-row');

      const nameField = el('label', 'mac-field mac-field--name');
      nameField.appendChild(el('span', 'cat-field-label', 'Machine'));
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'mac-name';
      name.value = m.name || '';
      name.placeholder = 'Nom du poste';
      name.addEventListener('change', () => { m.name = name.value.trim(); save(); });
      nameField.appendChild(name);
      rowEl.appendChild(nameField);

      const impField = el('label', 'mac-field mac-field--imp');
      const impLabel = el('span', 'cat-field-label', `Importance ${m.importance}`);
      impField.appendChild(impLabel);
      const imp = document.createElement('input');
      imp.type = 'range';
      imp.className = 'mac-imp';
      imp.min = '1'; imp.max = '5'; imp.step = '1';
      imp.value = String(m.importance || 3);
      imp.addEventListener('input', () => { impLabel.textContent = `Importance ${imp.value}`; });
      imp.addEventListener('change', () => { m.importance = parseInt(imp.value, 10); save(); });
      impField.appendChild(imp);
      rowEl.appendChild(impField);

      const durField = el('label', 'mac-field mac-field--dur');
      durField.appendChild(el('span', 'cat-field-label', 'Durée (min/pièce)'));
      const dur = document.createElement('input');
      dur.type = 'number';
      dur.className = 'mac-dur';
      dur.min = '0'; dur.step = '0.5';
      dur.value = m.minutesPerUnit == null ? '' : String(m.minutesPerUnit);
      dur.placeholder = '—';
      dur.addEventListener('change', () => {
        const v = dur.value.trim();
        const n = Number(v);
        m.minutesPerUnit = (v === '' || !Number.isFinite(n) || n <= 0) ? null : n;
        save();
      });
      durField.appendChild(dur);
      rowEl.appendChild(durField);

      const rm = el('button', 'mac-remove');
      rm.type = 'button';
      rm.setAttribute('aria-label', `Retirer ${m.name || 'la machine'}`);
      rm.appendChild(icon('delete'));
      rm.addEventListener('click', () => { work.splice(i, 1); renderRows(); save(); });
      rowEl.appendChild(rm);

      return rowEl;
    }

    function renderRows() {
      list.replaceChildren();
      if (!work.length) {
        list.appendChild(el('p', 'pj-empty', 'Aucune machine — ajoutez-en une.'));
        return;
      }
      work.forEach((m, i) => list.appendChild(mkMachineRow(m, i)));
    }

    renderRows();
    card.appendChild(list);

    const add = el('button', 'mac-add');
    add.type = 'button';
    add.append(icon('add'), el('span', null, 'Ajouter une machine'));
    add.addEventListener('click', () => {
      work.push({ slug: '', name: '', importance: 3, minutesPerUnit: null });
      renderRows();
    });
    card.appendChild(add);

    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    document.addEventListener('keydown', surEchap);
    desarmer = armerModale(card, { premier: () => closeBtn });
  }

  // --- Données -------------------------------------------------------------
  let refreshing = false, refreshQueued = false;
  // Horodatage rendu par le SERVEUR au dernier passage : on lui redemande « ce
  // qui a bougé depuis ». Jamais l'horloge du poste — deux montres qui divergent
  // d'une seconde suffiraient à faire sauter une modification.
  let derniereSynchro = null;
  // La config (attributions, machines) ne bouge que quand le patron y touche :
  // elle ne se recharge donc plus à chaque commande déplacée, mais seulement à
  // l'évènement qui la concerne. C'étaient trois requêtes sur quatre.
  let configARecharger = true;

  async function chargerConfig() {
    const [own, refs, macs] = await Promise.all([
      api('GET', '/api/category-owners'),
      api('GET', '/api/category-referents'),
      api('GET', '/api/machines'),
    ]);
    owners = own && typeof own === 'object' ? own : {};
    catRefs = refs && typeof refs === 'object' ? refs : {};
    machines = Array.isArray(macs) ? macs : [];
    configARecharger = false;
  }

  // L'empreinte de la COMPOSITION rendue au dernier passage. On la renvoie au
  // serveur : tant qu'elle correspond, il n'a pas à réexpédier la liste des
  // identifiants — 60 Ko rigoureusement identiques sur 1 500 commandes, à
  // chaque évènement, sur chaque poste, et qui ne font que grossir.
  let empreinteIds = null;
  // L'ordre et la composition tels qu'on les connaît. Sans `ids` dans la
  // réponse, c'est LUI qui fait foi.
  let ordreIds = [];

  // Reconstruit le planning à partir de ce que le serveur vient d'envoyer :
  // `ids` donne la composition et l'ordre exacts (donc les suppressions), les
  // lignes reçues remplacent celles qu'on avait, le reste est déjà en mémoire.
  // `ids` ABSENT ne veut pas dire « plus aucune commande » : il veut dire « rien
  // n'a bougé de ce côté-là ». On garde alors l'ordre du dernier passage.
  function fusionner(synthese) {
    const connues = new Map(rows.map((r) => [String(r.id), r]));
    for (const l of synthese.lignes || []) connues.set(String(l.id), l);
    if (Array.isArray(synthese.ids)) ordreIds = synthese.ids.map(String);
    return ordreIds.map((id) => connues.get(id)).filter(Boolean);
  }

  async function refresh() {
    if (refreshing) { refreshQueued = true; return; }
    refreshing = true;
    try {
      // On ne redemande QUE ce qui a changé. Avant, chaque évènement temps réel
      // — le glisser-déposer d'une collègue, une pastille posée à l'autre bout
      // de l'atelier — faisait retélécharger le planning entier à chaque poste.
      const parametres = new URLSearchParams();
      if (derniereSynchro) parametres.set('depuis', derniereSynchro);
      if (empreinteIds) parametres.set('empreinte', empreinteIds);
      const q = parametres.toString();
      // Synthèse et configuration sont indépendantes : en série, chaque
      // rafraîchissement qui devait relire un réglage payait deux temps
      // d'attente réseau au lieu d'un.
      const enVol = configARecharger ? chargerConfig() : null;
      const synthese = await api('GET', `/api/requests/synthese${q ? `?${q}` : ''}`);
      if (enVol) await enVol;

      const fresh = fusionner(synthese);
      // Diff pour le fil d'activité (seulement après le premier chargement).
      if (loaded) {
        const oldById = new Map(rows.map((r) => [String(r.id), r]));
        // LES COMMANDES QUI VIENNENT DE QUITTER LE BORD. La synthèse ne porte
        // que les familles vivantes : une commande passée en « Paiement &
        // clôture » n'est plus dans `fresh` et s'évaporerait du fil, alors que
        // c'est justement l'évènement à annoncer (« marquée traitée ✓ »). Le
        // serveur nous l'envoie quand même dans `lignes` ; on la donne au diff,
        // sans la remettre dans le tableau.
        const auBord = new Set(fresh.map((r) => String(r.id)));
        const parties = (synthese.lignes || []).filter((l) => !auBord.has(String(l.id)));
        diffIntoActivity(oldById, [...fresh, ...parties]);
      }
      rows = fresh;
      // Posés APRÈS coup : si quoi que ce soit au-dessus avait échoué, on
      // redemanderait à partir du même point plutôt que de sauter un intervalle.
      derniereSynchro = synthese.jusqua || derniereSynchro;
      // L'empreinte ne se retient QUE si l'on a effectivement rangé la
      // composition qu'elle décrit : la garder après un échec ferait croire au
      // serveur qu'on connaît une liste qu'on n'a jamais reçue, et une
      // suppression resterait à l'écran pour toujours.
      empreinteIds = synthese.empreinte || null;
      loaded = true;
      premierChargementKo = false;
      repriseEssais = 0;
      renderAll();
    } catch (_) {
      // Serveur injoignable : on garde l'affichage courant, le prochain
      // évènement SSE / retour de visibilité retentera. Mais si RIEN n'a
      // jamais été chargé, il n'y a rien à garder et personne ne retentera :
      // on le dit à l'écran et on reprogramme nous-mêmes un essai.
      if (!loaded) {
        premierChargementKo = true;
        renderBody();
        // En ESPAÇANT les tentatives : le premier chargement rend le planning
        // entier, et le redemander toutes les 5 secondes à un serveur déjà à
        // terre — indéfiniment, même une fois l'onglet quitté (voir hide) —
        // c'était l'inverse d'un filet.
        if (!repriseTimer) {
          repriseEssais = Math.min(repriseEssais + 1, 5);
          const attente = Math.min(5000 * (2 ** (repriseEssais - 1)), 60000);
          repriseTimer = setTimeout(() => { repriseTimer = null; refresh(); }, attente);
        }
      }
    } finally {
      refreshing = false;
      dernierRefresh = Date.now();
      if (refreshQueued) { refreshQueued = false; refresh(); }
    }
  }

  // --- API publique --------------------------------------------------------
  // Monte l'écran, SANS aller chercher la moindre donnée.
  // La synthèse est incrémentale ENSUITE, mais la PREMIÈRE rend le planning
  // entier — toutes les étapes, archives comprises. Et elle partait à
  // l'ouverture de CHAQUE poste, y compris ceux qui n'allaient jamais sur le
  // Point du jour : sur 400 lignes de test, 334 Ko, soit plus de 80 % de tout
  // ce que l'application téléchargeait pour s'ouvrir. Payé cash sur l'ouverture
  // d'une tablette en 4G depuis Saint-Martin, pour un écran que personne ne
  // regardait. Le premier chargement attend donc le premier affichage (voir
  // `show`) ; d'ici là l'écran annonce « Chargement… », ce qui est exactement
  // ce qui se passera au tap sur l'onglet.
  function start() {
    root.replaceChildren();
    root.appendChild(buildHead());
    $body = el('div', 'pj-body');
    root.appendChild($body);
    // Qui est au poste décide de l'onglet par défaut ET du libellé du premier
    // onglet : quand quelqu'un se nomme (ou change de personne en cours de
    // journée), l'écran suit. `poste.js` prévient par un évènement de document
    // — `storage` ne se déclenche pas dans l'onglet qui écrit.
    // Quelqu'un d'autre vient de s'asseoir : on lui rend la vue par défaut,
    // même si la personne d'avant avait choisi un autre onglet.
    document.addEventListener('olda:poste', () => {
      ongletAuto = true;
      renderHead();
      renderBody();
    });
    renderHead();
    renderBody();
  }

  function show() {
    visible = true;
    clearTimeout(veilleTimer);
    veilleTimer = null;
    // Le cache vient d'être rafraîchi (rattrapage de fond, ou aller-retour
    // d'onglet en quelques secondes) : on repeint avec ce qu'on a au lieu de
    // redemander la synthèse à chaque bascule Planning ↔ Dashboard.
    if (loaded && Date.now() - dernierRefresh < 15000) { renderAll(); return; }
    refresh();
  }

  function hide() {
    visible = false;
    closeDetail();
    closeActivity();
    // La reprise du premier chargement s'arrête avec l'onglet : on ne
    // redemande pas le planning entier en boucle pour un écran quitté.
    // Le prochain passage sur l'onglet relance (show → refresh).
    clearTimeout(repriseTimer);
    repriseTimer = null;
  }

  // Appelé par app.js à chaque évènement temps réel (SSE ou filet de polling).
  // AFFICHÉ, on suit le temps réel au plus près : c'est la promesse de l'écran.
  // MASQUÉ, on ne rejoue pas quatre requêtes — dont le planning entier — à
  // chaque évènement d'un collègue : on programme un seul rattrapage. Le cache
  // reste frais à la demi-minute près, ce qui suffit largement au fil
  // d'activité et aux badges.
  // `kinds` = la nature des évènements temps réel de la rafale (un seul nom ou
  // une liste). Seuls ceux qui touchent la configuration du patron obligent à
  // la relire ; le planning, lui, se rattrape tout seul par sa synthèse
  // incrémentale.
  const KINDS_CONFIG = new Set(['category-owners', 'category-referents', 'machines']);

  function notifyChange(kinds) {
    // La config à relire se NOTE avant toute sortie : si l’on ne rafraîchit pas
    // tout de suite (écran masqué, onglet en veille), le prochain passage la
    // reprendra — sinon un réglage du patron serait perdu pour ce poste.
    const liste = Array.isArray(kinds) ? kinds : [kinds];
    if (liste.some((k) => KINDS_CONFIG.has(k))) configARecharger = true;
    // Jamais ouvert, et pas à l’écran : il n’y a pas de cache à tenir à jour, et
    // personne ne regarde. La toute première synthèse rend le planning ENTIER —
    // on ne la paie pas à l’ouverture de chaque poste, le premier `show()` s’en
    // charge.
    if (!loaded && !visible) return;
    // Onglet du navigateur en arrière-plan, ou tablette écran éteint : c’est
    // l’état d’une tablette d’atelier la moitié de la journée. Le retour de
    // visibilité déclenche déjà un rafraîchissement (voir startRealtime).
    if (document.hidden) return;
    if (visible) { refresh(); return; }
    if (veilleTimer) return;                       // rattrapage déjà programmé
    const attente = Math.max(0, REFRESH_FOND_MS - (Date.now() - dernierRefresh));
    veilleTimer = setTimeout(() => { veilleTimer = null; refresh(); }, attente);
  }

  return { start, show, hide, notifyChange };
}
