// ===========================================================================
// Dashboard « Point du jour » — projection temps réel du planning.
// ===========================================================================
// Lu chaque matin au point d'équipe (PC) et affiché sur la Galaxy Tab en
// paysage dans l'atelier. AUCUNE donnée propre : tout vient de /api/requests +
// /api/category-owners ; toute action (envoi de catégorie, marquer traité,
// étoiles) écrit via la même API que le Planning — une commande = une seule
// source de vérité, le SSE resynchronise les deux vues.
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

export function createDashboard(deps) {
  const {
    root, api, EMPLOYEES, FAMILIES, SUB_STAGES, STAGE_LABEL, SUB_LABEL,
    daysLeft, prioBand, showToast, attachTip, fold, openMenu,
    jumpToPlanning, isLive,
  } = deps;

  // --- Constantes métier ---------------------------------------------------
  // Familles « actives » du point du jour (Terminé / Archivé / Fiverr exclus).
  const ACTIVE_FAMILIES = ['demande', 'chiffrage', 'attente_client', 'preparation', 'production', 'facturation'];
  const ACTIVE_SET = new Set(ACTIVE_FAMILIES);

  // Couleur d'avatar par employé (charte du point du jour).
  const AVATAR = { 'Loïc': '#2563EB', 'Charlie': '#7C3AED', 'Mélina': '#0D9488', 'Julien': '#EA580C' };

  // Une commande « Sans date » vieillit : au bout de 7 jours elle devient
  // « À planifier » (badge orange, remonte dans le tri). Jamais comptée en retard.
  const PLAN_AGE_DAYS = 7;
  // « Échéance proche » = aujourd'hui, demain ou après-demain.
  const SOON_DAYS = 2;

  // Prochaine action dérivée de la sous-catégorie (sinon de la famille) : la
  // ligne « quoi faire maintenant » des grandes cartes et du panneau détail.
  const NEXT_ACTION = {
    demande: 'Qualifier la demande et classer l’intérêt commercial',
    chiffrage: 'Chiffrer la demande',
    a_chiffrer: 'Calculer le prix et préparer le devis',
    chiffrage_en_cours: 'Finaliser le chiffrage en cours',
    devis_a_envoyer: 'Envoyer le devis au client',
    attente_client: 'Relancer le client',
    preparation: 'Préparer le dossier pour la production',
    prepa_fichiers: 'Préparer les fichiers et les produits',
    a_commander: 'Passer la commande fournisseur',
    attente_marchandise: 'Suivre la réception de la marchandise',
    pret_a_produire: 'Lancer la production',
    production: 'Préciser le poste de production',
    prod_dtf: 'Imprimer le DTF',
    prod_pressage: 'Presser les textiles',
    prod_trotec: 'Lancer la découpe / gravure Trotec',
    prod_uv: 'Imprimer en UV',
    montage_finition: 'Faire le montage et les finitions',
    controle_emballage: 'Contrôler et emballer la commande',
    facturation: 'Facturer et organiser le retrait',
    facturation_a_faire: 'Éditer et envoyer la facture',
    pret_retrait: 'Prévenir le client pour le retrait',
  };

  // --- État ----------------------------------------------------------------
  let rows = [];                // toutes les commandes (cache, resynchro SSE)
  let owners = {};              // { slugCatégorie: employé } (pilote par défaut)
  let catRefs = {};             // { slugCatégorie: [employés] } (référents par défaut)
  let loaded = false;

  // 'team' | 'me' | prénom. « JE SUIS » = vue perso de l'identité locale.
  let activeTab = 'team';
  let identity = null;
  try { identity = localStorage.getItem('olda_identity'); } catch (_) {}
  if (identity && !EMPLOYEES.includes(identity)) identity = null;

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
  const urgCache = new WeakMap();
  function urgency(r) {
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
  function dayList(who) {
    const seen = new Set();
    const out = [];
    for (const r of [...piloting(who), ...refereeing(who)]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return sortCards(out);
  }

  function roleOf(r, who) {
    const pil = effectivePilot(r) === who;
    const ref = effectiveReferents(r).includes(who);
    return pil && ref ? 'both' : pil ? 'pilote' : ref ? 'referent' : null;
  }

  // Alerte posée sur une commande depuis le Planning (colonne « État ») :
  // BLOQUÉE = elle n'avance plus et on sait pourquoi, À VOIR = quelqu'un doit
  // y jeter un œil. C'est ce qu'on regarde en premier au point du matin.
  const FLAG_LABEL = { bloque: 'BLOQUÉE', a_voir: 'À VOIR' };
  const isBlocked = (r) => r.flag === 'bloque';

  function kpis() {
    const act = rows.filter(isActive);
    return {
      late: act.filter((r) => urgency(r).band === 0).length,
      blocked: act.filter(isBlocked).length,
      soon: act.filter((r) => urgency(r).band === 1).length,
      waiting: act.filter((r) => r.stage === 'attente_client').length,
      active: act.length,
    };
  }

  // --- Filtres (KPI + recherche) : estompe les cartes non concernées -------
  const KPI_PRED = {
    late: (r) => urgency(r).band === 0,
    blocked: isBlocked,
    soon: (r) => urgency(r).band === 1,
    waiting: (r) => r.stage === 'attente_client',
    active: () => true,
  };
  const KPI_LABEL = { late: 'En retard', blocked: 'Bloquées', soon: 'Échéance proche', waiting: 'Attente client', active: 'Commandes actives' };

  const DASH_SEARCH_FIELDS = ['billing_company', 'contact_referent', 'product', 'description', 'flag_reason'];
  function matchesSearch(r) {
    if (!searchQuery) return true;
    const tokens = fold(searchQuery).split(/\s+/).filter(Boolean);
    const hay = DASH_SEARCH_FIELDS.map((f) => fold(r[f])).join(' ')
      + ' ' + fold(effectivePilot(r)) + ' ' + fold(effectiveReferents(r).join(' '));
    return tokens.every((t) => hay.includes(t));
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
    a.style.setProperty('--av', AVATAR[name] || '#94A3B8');
    if (name) attachTip(a, name);
    return a;
  }
  // Étoiles en AFFICHAGE (les cartes sont des <button> : pas d'interactif
  // imbriqué). Le réglage se fait dans le panneau détail ou le Planning.
  function starsEl(r, cls) {
    const w = el('span', 'pj-stars' + (cls ? ' ' + cls : ''));
    const n = prioBand(r);
    w.setAttribute('aria-label', `Priorité ${n} sur 3`);
    for (let i = 1; i <= 3; i++) w.appendChild(el('span', 'pj-star' + (i <= n ? ' on' : ''), i <= n ? '★' : '☆'));
    return w;
  }
  function badgeEl(r) {
    const u = urgency(r);
    return el('span', `pj-badge u-${u.cls}`, u.label);
  }
  // Pastille d'alerte (BLOQUÉE / À VOIR) + son motif, ou null si rien à signaler.
  function flagEl(r, withReason) {
    if (!FLAG_LABEL[r.flag]) return null;
    const w = el('span', `pj-flag f-${r.flag === 'bloque' ? 'bloque' : 'a-voir'}`);
    w.appendChild(el('span', 'pj-flag-tag', FLAG_LABEL[r.flag]));
    if (withReason && r.flag_reason) w.appendChild(el('span', 'pj-flag-why', r.flag_reason));
    return w;
  }

  function catChips(r) {
    const w = el('span', 'pj-chips');
    w.appendChild(el('span', 'pj-chip', STAGE_LABEL[r.stage] || r.stage));
    if (r.sub_stage && SUB_LABEL[r.sub_stage]) w.appendChild(el('span', 'pj-chip sub', SUB_LABEL[r.sub_stage]));
    return w;
  }
  function roleTag(role) {
    const label = role === 'both' ? 'PILOTE · RÉF.' : role === 'pilote' ? 'PILOTE' : 'RÉFÉRENT';
    return el('span', `pj-role role-${role}`, label);
  }
  function nextActionOf(r) {
    return NEXT_ACTION[r.sub_stage] || NEXT_ACTION[r.stage] || 'Faire avancer le dossier';
  }
  // Le logo OLDA du header est réutilisé tel quel (clone du SVG de la topbar).
  function logoEl(cls) {
    const src = document.querySelector('.brand-logo-svg');
    const w = el('span', cls);
    if (src) w.appendChild(src.cloneNode(true));
    w.setAttribute('aria-hidden', 'true');
    return w;
  }
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // --- Cartes --------------------------------------------------------------
  // variant : 'board' (colonne équipe) | 'day' (Ma journée) | 'mini' (une ligne).
  function buildCard(r, role, variant) {
    const u = urgency(r);
    const b = el('button', `pj-card pj-card--${variant} u-${u.cls}`);
    b.type = 'button';
    if (isDimmed(r)) b.classList.add('is-dim');
    if (FLAG_LABEL[r.flag]) b.classList.add(r.flag === 'bloque' ? 'is-bloque' : 'is-a-voir');

    if (variant === 'mini') {
      b.append(starsEl(r, 'mini'), el('span', 'pj-card-client', clientName(r)),
        el('span', 'pj-card-article', articleOf(r)));
      const f = flagEl(r, false);
      if (f) b.appendChild(f);
      b.appendChild(badgeEl(r));
    } else {
      const top = el('div', 'pj-card-top');
      top.append(starsEl(r), el('span', 'pj-card-client', clientName(r)), badgeEl(r));
      b.appendChild(top);
      // L'alerte passe AVANT l'article : « pourquoi ça n'avance pas » prime sur
      // « ce que c'est » quand on balaie le tableau le matin.
      const f = flagEl(r, true);
      if (f) b.appendChild(f);
      b.appendChild(el('p', 'pj-card-article', articleOf(r)));
      const meta = el('div', 'pj-card-meta');
      meta.appendChild(catChips(r));
      if (role) meta.appendChild(roleTag(role));
      b.appendChild(meta);
      if (variant === 'day') {
        const na = el('div', 'pj-card-next');
        na.append(icon('bolt'), el('span', 'pj-card-next-label', 'Prochaine action'),
          el('span', 'pj-card-next-text', nextActionOf(r)));
        b.appendChild(na);
      }
    }
    b.addEventListener('click', () => openDetail(r.id));
    return b;
  }

  // --- Header (construit une fois, mis à jour par refs) --------------------
  let $head, $sub, $liveDot, $searchInput, $searchClear, $actBadge, $kpiEls = {}, $chip, $chipLabel, $tabs;

  function buildHead() {
    $head = el('header', 'pj-head');

    const row = el('div', 'pj-head-row');

    row.appendChild(logoEl('pj-logo'));
    const titles = el('div', 'pj-titles');
    titles.appendChild(el('h1', 'pj-title', 'Point du jour'));
    $sub = el('p', 'pj-subtitle');
    $liveDot = el('span', 'pj-live');
    $sub.appendChild($liveDot);
    $sub.appendChild(document.createTextNode(''));
    titles.appendChild($sub);
    row.appendChild(titles);

    // Recherche : filtre en direct toutes les vues (estompe les non-concernées).
    const search = el('div', 'pj-search');
    search.appendChild(icon('search'));
    $searchInput = el('input', 'pj-search-input');
    $searchInput.type = 'text';
    $searchInput.placeholder = 'Filtrer le point du jour';
    $searchInput.setAttribute('aria-label', 'Filtrer les commandes affichées');
    $searchInput.autocomplete = 'off';
    $searchInput.addEventListener('input', () => {
      searchQuery = $searchInput.value.trim();
      $searchClear.hidden = !searchQuery;
      renderBody();
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

    // Écran mural (mode atelier plein écran).
    const wallBtn = el('button', 'pj-tool');
    wallBtn.type = 'button';
    wallBtn.append(icon('tv'), el('span', 'pj-tool-label', 'Écran mural'));
    attachTip(wallBtn, 'Afficher sur l’écran de l’atelier');
    wallBtn.addEventListener('click', openWall);
    row.appendChild(wallBtn);

    // Attribution des catégories (config du patron).
    const gear = el('button', 'pj-tool pj-tool--icon');
    gear.type = 'button';
    gear.appendChild(icon('tune'));
    attachTip(gear, 'Attribution des catégories');
    gear.addEventListener('click', openConfig);
    row.appendChild(gear);

    $head.appendChild(row);

    // 4 KPI cliquables : un clic filtre toutes les vues, re-clic annule.
    const kpisEl = el('div', 'pj-kpis');
    for (const k of ['late', 'blocked', 'soon', 'waiting', 'active']) {
      const b = el('button', `pj-kpi k-${k}`);
      b.type = 'button';
      const n = el('span', 'pj-kpi-n', '0');
      b.append(n, el('span', 'pj-kpi-l', KPI_LABEL[k]));
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => setKpiFilter(kpiFilter === k ? null : k));
      $kpiEls[k] = { btn: b, n };
      kpisEl.appendChild(b);
    }
    // Chip « Filtre : … ✕ » (annule le filtre KPI actif).
    $chip = el('button', 'pj-filterchip');
    $chip.type = 'button';
    $chip.hidden = true;
    $chipLabel = el('span', null, '');
    $chip.append($chipLabel, el('span', 'pj-filterchip-x', '✕'));
    $chip.addEventListener('click', () => setKpiFilter(null));
    kpisEl.appendChild($chip);
    $head.appendChild(kpisEl);

    // Onglets : JE SUIS · employés · Équipe.
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

  function renderHead() {
    const now = new Date();
    const dow = now.toLocaleDateString('fr-FR', { weekday: 'long' });
    const dm = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    $sub.lastChild.textContent = ` ${dow.charAt(0).toUpperCase() + dow.slice(1)} ${dm} · synchronisé au planning`;
    $liveDot.classList.toggle('off', !(isLive && isLive()));

    const k = kpis();
    for (const key of Object.keys($kpiEls)) {
      $kpiEls[key].n.textContent = k[key === 'active' ? 'active' : key];
      $kpiEls[key].btn.classList.toggle('active', kpiFilter === key);
      $kpiEls[key].btn.setAttribute('aria-pressed', String(kpiFilter === key));
    }
    $chip.hidden = !kpiFilter;
    if (kpiFilter) $chipLabel.textContent = `Filtre : ${KPI_LABEL[kpiFilter]}`;

    $actBadge.hidden = unseen === 0;
    $actBadge.textContent = unseen > 9 ? '9+' : String(unseen);

    // Onglets (reconstruits : point rouge + actif dépendent des données).
    $tabs.replaceChildren();
    const mkTab = (key, label, withDot) => {
      const b = el('button', 'pj-tab');
      b.type = 'button';
      const on = activeTab === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      b.appendChild(el('span', null, label));
      if (withDot) b.appendChild(el('span', 'pj-tab-dot'));
      $tabs.appendChild(b);
      return b;
    };
    const hasLate = (who) => who && dayList(who).some((r) => urgency(r).band === 0);
    const meLabel = identity ? `Je suis · ${identity}` : 'Je suis';
    const me = mkTab('me', meLabel, hasLate(identity));
    me.classList.add('pj-tab--me');
    attachTip(me, identity ? 'Ma vue perso — recliquer pour changer qui je suis' : 'Choisir qui je suis');
    me.addEventListener('click', () => {
      // Pas d'identité, ou re-clic sur l'onglet déjà actif → choisir qui je suis.
      if (!identity || activeTab === 'me') {
        openMenu(me, EMPLOYEES.map((n) => ({ value: n, label: n })), identity, (val) => {
          identity = val;
          try { localStorage.setItem('olda_identity', val); } catch (_) {}
          activeTab = 'me';
          renderHead(); renderBody();
        });
        return;
      }
      activeTab = 'me';
      renderHead(); renderBody();
    });
    for (const who of EMPLOYEES) {
      const t = mkTab(who, who, hasLate(who));
      t.addEventListener('click', () => { activeTab = who; renderHead(); renderBody(); });
    }
    const team = mkTab('team', 'Équipe', false);
    team.addEventListener('click', () => { activeTab = 'team'; renderHead(); renderBody(); });
  }

  // --- Vue Équipe : 4 colonnes égales --------------------------------------
  function buildTeamView() {
    const board = el('div', 'pj-board');
    for (const who of EMPLOYEES) {
      const col = el('section', 'pj-col');
      const day = dayList(who);
      const late = day.filter((r) => urgency(r).band === 0).length;

      const head = el('button', 'pj-col-head');
      head.type = 'button';
      attachTip(head, `Ouvrir la vue de ${who}`);
      head.appendChild(avatarEl(who));
      head.appendChild(el('span', 'pj-col-name', who));
      if (late) head.appendChild(el('span', 'pj-col-late', `${late} retard${late > 1 ? 's' : ''}`));
      head.appendChild(el('span', 'pj-col-count', String(day.length)));
      head.addEventListener('click', () => { activeTab = who; renderHead(); renderBody(); });
      col.appendChild(head);

      const list = el('div', 'pj-col-cards');
      if (!day.length) {
        list.appendChild(el('div', 'pj-free', 'Disponible — peut prendre une urgence au dispatch'));
      } else {
        for (const r of day) list.appendChild(buildCard(r, roleOf(r, who), 'board'));
      }
      col.appendChild(list);
      board.appendChild(col);
    }
    return board;
  }

  // --- Vue personne : Ma journée + pilotage / référent ---------------------
  function buildPersonView(who) {
    const wrap = el('div', 'pj-person');

    // Ma journée : le plus pressant (retards, échéances proches, à planifier,
    // « À commander »), 4 cartes max, avec la prochaine action.
    const day = dayList(who).filter((r) => {
      const b = urgency(r).band;
      return b === 0 || b === 1 || b === 3 || r.sub_stage === 'a_commander';
    }).slice(0, 4);

    const main = el('section', 'pj-person-main');
    const mh = el('header', 'pj-section-head');
    mh.append(icon('wb_sunny'), el('h2', 'pj-section-title', 'Ma journée'), el('span', 'pj-section-count', String(day.length)));
    main.appendChild(mh);
    if (!day.length) {
      main.appendChild(el('p', 'pj-empty', 'Rien d’urgent pour le moment.'));
    } else {
      const list = el('div', 'pj-day-cards');
      for (const r of day) list.appendChild(buildCard(r, roleOf(r, who), 'day'));
      main.appendChild(list);
    }
    wrap.appendChild(main);

    const side = el('div', 'pj-person-side');
    const mkList = (title, ic, list, role) => {
      const sec = el('section', 'pj-section');
      const h = el('header', 'pj-section-head');
      h.append(icon(ic), el('h2', 'pj-section-title', title), el('span', 'pj-section-count', String(list.length)));
      sec.appendChild(h);
      if (!list.length) {
        sec.appendChild(el('p', 'pj-empty', 'Rien pour le moment.'));
      } else {
        const l = el('div', 'pj-mini-list');
        for (const r of list) l.appendChild(buildCard(r, role, 'mini'));
        sec.appendChild(l);
      }
      return sec;
    };
    side.appendChild(mkList('Mes projets en pilotage', 'flight_takeoff', sortCards(piloting(who)), 'pilote'));
    side.appendChild(mkList('Mes projets où je suis référent', 'diversity_3', sortCards(refereeing(who)), 'referent'));
    wrap.appendChild(side);
    return wrap;
  }

  // --- Corps ---------------------------------------------------------------
  let $body;
  function renderBody() {
    if (!$body) return;
    $body.replaceChildren();
    if (!loaded) { $body.appendChild(el('p', 'pj-empty', 'Chargement du planning…')); return; }
    if (activeTab === 'team') {
      $body.appendChild(buildTeamView());
    } else {
      const who = activeTab === 'me' ? identity : activeTab;
      if (!who) { $body.appendChild(el('p', 'pj-empty', 'Choisis qui tu es avec l’onglet « Je suis ».')); return; }
      $body.appendChild(buildPersonView(who));
    }
  }

  function renderAll() {
    if (!$head) return;
    renderHead();
    renderBody();
    renderDetailIfOpen();
    if (wallEl) renderWallContent();
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

  function openDetail(id) {
    ensureDetail();
    detailId = String(id);
    renderDetail();
    detailScrim.classList.add('open');
    detailEl.classList.add('open');
  }

  function closeDetail() {
    if (!detailEl) return;
    detailId = null;
    detailScrim.classList.remove('open');
    detailEl.classList.remove('open');
  }

  function renderDetailIfOpen() {
    if (!detailId) return;
    const r = rows.find((x) => String(x.id) === detailId);
    // La commande a été traitée / supprimée entre-temps : on referme.
    if (!r || !isActive(r)) { closeDetail(); return; }
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
    const badges = el('div', 'dd-badges');
    badges.appendChild(badgeEl(r));
    badges.appendChild(catChips(r));
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

    // Prochaine action (encart ambre).
    const na = el('section', 'dd-next');
    na.append(icon('bolt'), el('div', null));
    const naBody = na.lastChild;
    naBody.appendChild(el('span', 'dd-next-label', 'Prochaine action'));
    naBody.appendChild(el('p', 'dd-next-text', nextActionOf(r)));
    scroll.appendChild(na);

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
      dot.style.setProperty('--av', AVATAR[owner] || '#94A3B8');
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
    logActivity(msg, AVATAR[after] || 'var(--pj-accent)');
    renderAll();
    showToast(msg);
    api('PATCH', `/api/requests/${r.id}`, { stage, sub_stage: sub }).catch(() => {
      Object.assign(r, prev);
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
    logActivity(`${clientName(r)} — alerte levée ✓`, '#16A34A');
    renderAll();
    showToast(`${clientName(r)} — alerte levée ✓`);
    api('PATCH', `/api/requests/${r.id}`, { flag: null }).catch(() => {
      Object.assign(r, prev);
      renderAll();
      showToast('Échec — l’alerte est toujours là');
      refresh();
    });
  }

  // Marquer traité : clôt la commande (famille Terminé) → elle sort de toutes
  // les vues actives et « Commandes actives » décrémente.
  function markDone(r) {
    const prev = { stage: r.stage, sub_stage: r.sub_stage };
    r.stage = 'termine';
    r.sub_stage = null;
    logActivity(`${clientName(r)} — marquée traitée ✓`, '#16A34A');
    closeDetail();
    renderAll();
    showToast(`${clientName(r)} — marquée traitée ✓`);
    api('PATCH', `/api/requests/${r.id}`, { stage: 'termine', sub_stage: null }).catch(() => {
      Object.assign(r, prev);
      renderAll();
      showToast('Échec — la commande n’a pas été clôturée');
      refresh();
    });
  }

  // --- Fil d'activité « Ce qui a bougé » -----------------------------------
  let activityEl = null, activityScrim = null, activityOpen = false, $activityList = null;

  function logActivity(text, color) {
    activity.unshift({ ts: Date.now(), text, color: color || 'var(--pj-accent)' });
    if (activity.length > 80) activity.length = 80;
    if (activityOpen) renderActivityList();
    else { unseen++; if ($head) renderHead(); }
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
      if (r.stage === 'termine' && o.stage !== 'termine' && wasActive) {
        logActivity(`${clientName(r)} — marquée traitée ✓`, '#16A34A');
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

  function openActivity() {
    ensureActivity();
    unseen = 0;
    renderHead();
    renderActivityList();
    activityOpen = true;
    activityScrim.classList.add('open');
    activityEl.classList.add('open');
  }

  function closeActivity() {
    if (!activityEl) return;
    activityOpen = false;
    activityScrim.classList.remove('open');
    activityEl.classList.remove('open');
  }

  // --- Écran mural (mode atelier) ------------------------------------------
  // Plein écran sombre sans chrome, rotation A/B toutes les 20 s :
  //   A = 4 colonnes équipe condensées · B = « Retards & à planifier ».
  // Données rafraîchies en continu (renderWallContent rejoué à chaque refresh).
  const WALL_ROTATE_MS = 20000;
  let wallEl = null, wallScreen = 0, wallRotateTimer = 0, wallClockTimer = 0;
  let $wallClock = null, $wallScreens = [], $wallDots = [];

  function openWall() {
    if (wallEl) return;
    wallEl = el('div', 'wall');

    const head = el('header', 'wall-head');
    head.appendChild(logoEl('wall-logo'));
    head.appendChild(el('span', 'wall-title', 'Écran atelier'));
    $wallClock = el('span', 'wall-clock');
    head.appendChild($wallClock);
    const dots = el('div', 'wall-dots');
    $wallDots = [0, 1].map((i) => {
      const d = el('button', 'wall-dot');
      d.type = 'button';
      d.setAttribute('aria-label', i === 0 ? 'Écran équipe' : 'Écran retards');
      d.addEventListener('click', () => setWallScreen(i, true));
      dots.appendChild(d);
      return d;
    });
    head.appendChild(dots);
    const quit = el('button', 'wall-quit', 'Quitter');
    quit.type = 'button';
    quit.addEventListener('click', closeWall);
    head.appendChild(quit);
    wallEl.appendChild(head);

    const screens = el('div', 'wall-screens');
    $wallScreens = [el('div', 'wall-screen wall-a'), el('div', 'wall-screen wall-b')];
    screens.append($wallScreens[0], $wallScreens[1]);
    wallEl.appendChild(screens);

    document.body.appendChild(wallEl);
    document.body.classList.add('wall-open');
    renderWallContent();
    updateWallClock();
    setWallScreen(0, false);

    wallClockTimer = setInterval(updateWallClock, 1000);
    wallRotateTimer = setInterval(() => setWallScreen(1 - wallScreen, false), WALL_ROTATE_MS);
    document.addEventListener('keydown', onWallKey);
    document.addEventListener('fullscreenchange', onWallFullscreenChange);
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  }

  function closeWall() {
    if (!wallEl) return;
    clearInterval(wallClockTimer);
    clearInterval(wallRotateTimer);
    wallClockTimer = wallRotateTimer = 0;
    document.removeEventListener('keydown', onWallKey);
    document.removeEventListener('fullscreenchange', onWallFullscreenChange);
    wallEl.remove();
    wallEl = null;
    document.body.classList.remove('wall-open');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  function onWallKey(e) { if (e.key === 'Escape') closeWall(); }
  // Sortie du plein écran navigateur (geste système) → on quitte le mode mural.
  function onWallFullscreenChange() { if (!document.fullscreenElement && wallEl) closeWall(); }

  // Choix d'écran ; un choix MANUEL (tap sur un dot) repart pour 20 s pleines.
  function setWallScreen(i, manual) {
    wallScreen = i;
    $wallScreens.forEach((s, k) => s.classList.toggle('active', k === i));
    $wallDots.forEach((d, k) => d.classList.toggle('active', k === i));
    if (manual) {
      clearInterval(wallRotateTimer);
      wallRotateTimer = setInterval(() => setWallScreen(1 - wallScreen, false), WALL_ROTATE_MS);
    }
  }

  function updateWallClock() {
    if ($wallClock) $wallClock.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function wallCard(r) {
    const u = urgency(r);
    const c = el('div', `wall-card u-${u.cls}`);
    const top = el('div', 'wall-card-top');
    top.append(el('span', 'wall-card-client', clientName(r)), el('span', `pj-badge u-${u.cls}`, u.label));
    c.appendChild(top);
    c.appendChild(el('p', 'wall-card-article', articleOf(r)));
    return c;
  }

  function renderWallContent() {
    if (!wallEl) return;
    // Écran A : l'équipe en 4 colonnes condensées (max 4 cartes par personne).
    const a = $wallScreens[0];
    a.replaceChildren();
    const board = el('div', 'wall-board');
    for (const who of EMPLOYEES) {
      const col = el('div', 'wall-col');
      const day = dayList(who);
      const head = el('div', 'wall-col-head');
      head.append(avatarEl(who, 'wall-av'), el('span', 'wall-col-name', who), el('span', 'wall-col-count', String(day.length)));
      col.appendChild(head);
      if (!day.length) {
        col.appendChild(el('div', 'wall-free', 'Disponible'));
      } else {
        for (const r of day.slice(0, 4)) col.appendChild(wallCard(r));
        if (day.length > 4) col.appendChild(el('div', 'wall-more', `+ ${day.length - 4} autres`));
      }
      board.appendChild(col);
    }
    a.appendChild(board);

    // Écran B : retards & à planifier, en grandes lignes lisibles à 3 m.
    const b = $wallScreens[1];
    b.replaceChildren();
    b.appendChild(el('h2', 'wall-b-title', 'Retards & à planifier'));
    const urgent = sortCards(rows.filter((r) => isActive(r) && (urgency(r).band === 0 || urgency(r).band === 3)));
    if (!urgent.length) {
      b.appendChild(el('p', 'wall-b-empty', 'Aucun retard — tout roule.'));
    } else {
      const list = el('div', 'wall-b-list');
      for (const r of urgent.slice(0, 8)) {
        const u = urgency(r);
        const line = el('div', `wall-row u-${u.cls}`);
        line.appendChild(starsEl(r));
        const main = el('div', 'wall-row-main');
        main.append(el('span', 'wall-row-client', clientName(r)), el('span', 'wall-row-article', articleOf(r)));
        line.appendChild(main);
        line.appendChild(el('span', `pj-badge u-${u.cls}`, u.label));
        const pilot = effectivePilot(r);
        const who = el('span', 'wall-row-who');
        who.append(avatarEl(pilot), el('span', 'wall-row-name', pilot || 'À attribuer'));
        line.appendChild(who);
        list.appendChild(line);
      }
      if (urgent.length > 8) list.appendChild(el('div', 'wall-more', `+ ${urgent.length - 8} autres`));
      b.appendChild(list);
    }
  }

  // --- Attribution des catégories (config du patron, conservée) ------------
  let configOpen = false;

  function openConfig() {
    const overlay = el('div', 'cat-overlay');
    const card = el('div', 'cat-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    const close = () => {
      configOpen = false;
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
        av.style.setProperty('--av', AVATAR[who] || '#94A3B8');
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
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape' && configOpen) { close(); document.removeEventListener('keydown', esc); }
    });
  }

  // --- Données -------------------------------------------------------------
  let refreshing = false, refreshQueued = false;

  async function refresh() {
    if (refreshing) { refreshQueued = true; return; }
    refreshing = true;
    try {
      const [reqs, own, refs] = await Promise.all([
        api('GET', '/api/requests'),
        api('GET', '/api/category-owners'),
        api('GET', '/api/category-referents'),
      ]);
      const fresh = Array.isArray(reqs) ? reqs : [];
      // Diff pour le fil d'activité (seulement après le premier chargement).
      if (loaded) {
        const oldById = new Map(rows.map((r) => [String(r.id), r]));
        diffIntoActivity(oldById, fresh);
      }
      rows = fresh;
      owners = own && typeof own === 'object' ? own : {};
      catRefs = refs && typeof refs === 'object' ? refs : {};
      loaded = true;
      renderAll();
    } catch (_) {
      // Serveur injoignable : on garde l'affichage courant, le prochain
      // évènement SSE / retour de visibilité retentera.
    } finally {
      refreshing = false;
      if (refreshQueued) { refreshQueued = false; refresh(); }
    }
  }

  // --- API publique --------------------------------------------------------
  function start() {
    root.replaceChildren();
    root.appendChild(buildHead());
    $body = el('div', 'pj-body');
    root.appendChild($body);
    renderHead();
    renderBody();
    refresh();
  }

  function show() {
    refresh();
  }

  function hide() {
    closeDetail();
    closeActivity();
    closeWall(); // quitter l'onglet nettoie les timers du mode mural
  }

  // Appelé par app.js à chaque évènement temps réel (SSE ou filet de polling).
  function notifyChange() {
    refresh();
  }

  return { start, show, hide, notifyChange };
}
