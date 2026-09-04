// Écran « Projets » : liste, création, duplication, suppression.

import { store, importOldaCatalogue, availableFaces } from './store.js';
import { catalogueImageUrl } from './mockup.js';
import { toast, confirmModal, openModal, el, menuActions } from './ui.js';
import { loadTailles } from './tailles.js';
import { esc, frDate, groupByClient, isProjectBlank, nettoyerId, batDeLaFiche, ICON_SEARCH, ICON_GARMENT } from './util.js';
import { app } from './app.js';

export async function renderProjects(host) {
  host.innerHTML = '';
  const wrap = el(`<div class="projects-wrap"></div>`);
  host.appendChild(wrap);

  if (!store.settings.cataloguePath || !store.catalogue.products.length) {
    // Web : le catalogue est intégré et chargé automatiquement au démarrage ;
    // cet écran n'apparaît qu'en cas de problème ou en version bureau.
    wrap.appendChild(el(`
      <div class="welcome">
        <h2>Bienvenue dans BAT Studio</h2>
        <p>Le catalogue produit intégré n'a pas pu être chargé. Réessayez, ou créez
           des produits personnalisés dans l'Administration.</p>
        <button class="btn primaire" id="btn-import-cat">Recharger le catalogue</button>
      </div>`));
    wrap.querySelector('#btn-import-cat').onclick = () => importCatalogueFlow(() => renderProjects(host));
    return;
  }

  const head = el(`
    <div class="projects-head">
      <h1>Projets</h1>
      <div class="projects-actions">
        <button class="btn secondaire" id="btn-open-pdf" title="Rouvrir un BAT exporté par BAT Studio pour le modifier (glissez-déposez aussi le PDF sur cette page)">Ouvrir un BAT (PDF)…</button>
        <button class="btn primaire" id="btn-new">+ Nouveau projet</button>
      </div>
    </div>`);
  wrap.appendChild(head);
  head.querySelector('#btn-new').onclick = () => createProject();
  head.querySelector('#btn-open-pdf').onclick = () => openBatPdfFlow();

  // Glisser-déposer : le geste évident pour « je reprends ce BAT ». Le PDF
  // lâché n'importe où sur l'écran Projets est traité comme le bouton.
  wrap.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    wrap.classList.add('drop-target');
  });
  wrap.addEventListener('dragleave', (e) => {
    if (e.target === wrap) wrap.classList.remove('drop-target');
  });
  wrap.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    wrap.classList.remove('drop-target');
    if (!/\.pdf$/i.test(file.name)) { toast('Déposez un BAT au format PDF.', { error: true }); return; }
    await openBatPdf(new Uint8Array(await file.arrayBuffer()), file.name);
  });

  const grid = el(`<div class="projects-liste"></div>`);

  if (!store.projectsIndex.length) {
    wrap.appendChild(grid);
    grid.appendChild(el(`<div class="welcome">
      <h2>Aucun projet</h2><p>Créez votre premier BAT : la feuille s'ouvre entièrement, vous renseignez client, projet, produit et couleur directement en haut, puis déposez les logos.</p>
      <button class="btn primaire" id="btn-new2">+ Nouveau projet</button></div>`));
    grid.querySelector('#btn-new2').onclick = () => createProject();
    return;
  }

  // LA RECHERCHE. Quinze projets ne tiennent pas dans une hauteur d'écran, et
  // rien ne permettait d'en montrer moins : la seule stratégie était de
  // parcourir. Le champ filtre sur ce qu'on a en tête au moment où on cherche —
  // le client, le nom, le vêtement, sa référence, sa couleur.
  // Le compteur est là pour une raison précise : sans lui, une recherche qui ne
  // rapporte rien se lit comme une liste qui s'est vidée.
  const outils = el(`<div class="liste-outils">
    <label class="champ-recherche">
      ${ICON_SEARCH}
      <input type="search" id="pj-q" autocomplete="off" spellcheck="false"
             placeholder="Rechercher un client, un projet…"
             aria-label="Rechercher un projet">
    </label>
    <span class="lo-compte" id="pj-compte" role="status" aria-live="polite"></span>
  </div>`);
  wrap.append(outils, grid);
  const champ = outils.querySelector('#pj-q');
  const compte = outils.querySelector('#pj-compte');
  champ.addEventListener('input', () => peupler(champ.value));

  // Ce sur quoi la recherche mord. Construit une fois par ligne, à plat et en
  // minuscules : le filtre se rejoue à chaque frappe.
  const clefRecherche = (entry) => {
    const bouts = [entry.client, entry.name];
    for (const a of entry.articles || []) {
      const prod = store.product(a.productId);
      bouts.push(prod?.name, prod?.refSupplier, prod?.refInternal, prod?.type);
      bouts.push(prod?.colors.find(c => c.slug === a.colorSlug)?.label, a.colorSlug);
    }
    return bouts.filter(Boolean).join(' ').toLowerCase();
  };

  // TROIS LIGNES QUI DISENT « 28/08/2026 » NE SE DISTINGUENT PLUS. Quand un même
  // jour porte plusieurs projets, la date rend l'heure — c'est le seul repère
  // qui reste entre deux brouillons du même après-midi. Les jours uniques, eux,
  // gardent la date nue : l'heure y serait du bruit.
  const parJour = new Map();
  for (const e of store.projectsIndex) {
    const j = String(e.updatedAt || '').slice(0, 10);
    parJour.set(j, (parJour.get(j) || 0) + 1);
  }
  const quand = (iso) => {
    const jour = String(iso || '').slice(0, 10);
    if (!jour) return '';
    if ((parJour.get(jour) || 0) < 2) return frDate(jour);
    const h = String(iso).slice(11, 16);
    return h ? `${frDate(jour)} ${h}` : frDate(jour);
  };

  const peupler = (requete) => {
    const q = requete.trim().toLowerCase();
    grid.replaceChildren();
    let vus = 0;
    for (const groupe of groupByClient(store.projectsIndex)) {
      const projets = q ? groupe.projets.filter(e => clefRecherche(e).includes(q)) : groupe.projets;
      if (!projets.length) continue;
      grid.appendChild(el(`<div class="client-head${groupe.client ? '' : ' sans-client'}">
        <h2>${groupe.client ? esc(groupe.client) : 'Sans client'}</h2>
        <span class="pastille">${projets.length}</span>
      </div>`));
      for (const entry of projets) { grid.appendChild(ligneProjet(entry, quand, host)); vus++; }
    }
    const total = store.projectsIndex.length;
    compte.textContent = q
      ? `${vus} sur ${total}`
      : `${total} projet${total > 1 ? 's' : ''}`;
    if (!vus) grid.appendChild(el(`<div class="liste-vide">Aucun projet ne correspond à « ${esc(requete.trim())} ».</div>`));
  };
  peupler('');
}

// ---------------------------------------------------------------------------
// UNE LIGNE DE PROJET
// ---------------------------------------------------------------------------
// Un projet = une commande, donc un ou plusieurs articles. La ligne montre le
// premier en clair et résume les suivants (« + 2 articles ») : c'est ce qui
// distingue une commande simple d'une commande multi-produits d'un coup d'œil,
// sans ouvrir le projet.
function ligneProjet(entry, quand, host) {
  const arts = entry.articles || [];
  const first = arts[0] || {};
  const prod = store.product(first.productId);
  const color = prod?.colors.find(c => c.slug === first.colorSlug);
  const more = arts.length - 1;
  // Sans nom saisi, un projet ne se reconnaît qu'à son vêtement et à sa date :
  // la vignette, la pastille de couleur et l'horodatage portent donc
  // l'identification, pas le titre.
  const unnamed = !(entry.name || '').trim();

  const card = el(`
    <div class="ligne-projet${unnamed ? ' unnamed' : ''}" tabindex="0" role="button"
         title="Ouvrir « ${esc(entry.name || 'Projet sans nom')} »${arts.length > 1 ? ` — ${arts.length} articles` : ''}">
      <span class="pc-thumb" aria-hidden="true">${ICON_GARMENT}</span>
      <span class="lp-nom">
        <span class="lp-titre">${esc(entry.name || 'Projet sans nom')}</span>
        <span class="pastille">v${entry.version || 1}</span>
        ${more > 0 ? `<span class="pastille">+ ${more} article${more > 1 ? 's' : ''}</span>` : ''}
      </span>
      <span class="lp-vetement" title="${esc(prod?.name || '?')}${color?.label ? ` · ${esc(color.label)}` : ''}">
        <span class="pc-dot" style="background:${esc(color?.hex || '#dadce0')}"></span>
        <span class="pc-gname">${esc(prod?.name || '?')}</span>
        <span class="pc-gcol">${esc(color?.label || first.colorSlug || '')}</span>
      </span>
      <span class="lp-date">${esc(quand(entry.updatedAt))}</span>
      <span class="pc-actions"></span>
    </div>`);

  // LA LIGNE OUVRE, LE MENU RANGE LE RESTE. « Ouvrir » ne faisait que redire ce
  // que la ligne fait déjà au clic, et « Supprimer » y portait exactement le
  // même poids que lui — quinze fois de suite. Ce qui est secondaire se range.
  card.querySelector('.pc-actions').appendChild(menuActions([
    {
      label: 'Dupliquer',
      onClick: async () => {
        const copy = await store.duplicateProject(entry.id);
        if (copy) { toast('Projet dupliqué en v' + copy.fiche.version + '.'); renderProjects(host); }
      },
    },
    {
      label: 'Supprimer',
      danger: true,
      onClick: async () => {
        if (!await confirmModal('Supprimer le projet', `Supprimer définitivement « ${entry.name || 'Projet sans nom'} » ?`, { danger: true, okLabel: 'Supprimer' })) return;
        await store.deleteProject(entry.id);
        renderProjects(host);
        toast('Projet supprimé.');
      },
    },
  ], { label: `Autres actions — ${entry.name || 'Projet sans nom'}` }));

  // Vignette du vêtement dans sa couleur : chargée après coup (la liste
  // s'affiche immédiatement, sans attendre les images). La silhouette posée en
  // attendant n'est pas un trou : elle dit « vêtement », et reste si aucune
  // image n'arrive.
  const thumbRel = color?.views?.front?.thumb || color?.views?.front?.medium;
  if (thumbRel) {
    catalogueImageUrl(thumbRel)
      .then((url) => {
        if (!url) return;
        const box = card.querySelector('.pc-thumb');
        box.replaceChildren();
        box.style.backgroundImage = `url("${url}")`;
      })
      .catch(() => { /* vignette absente : la ligne reste lisible sans image */ });
  }

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
  });
  card.addEventListener('click', async (e) => {
    // Le menu vit DANS la ligne : sans cette garde, ouvrir le menu ouvrirait
    // aussi le projet. (`stopPropagation` côté menu le fait déjà — la garde
    // dit la règle à l'endroit où elle se lit, sur le geste de la ligne.)
    if (e.target.closest('.menu-actions')) return;
    const p = await store.loadProject(entry.id);
    if (!p) { toast('Projet illisible.', { error: true }); return; }
    app.closeProject();
    await app.openProject(p);
  });
  // Précharge le module éditeur au survol de la ligne → ouverture ~instantanée.
  card.addEventListener('mouseenter', () => app.preloadEditor?.(), { once: true });
  return card;
}

// ---------------------------------------------------------------------------
// OUVRIR SUR UN BAT NEUF
// ---------------------------------------------------------------------------
// L'application s'ouvre sur la feuille, prête à travailler — c'est le geste de
// tous les jours. Mais créer un projet à chaque démarrage laisserait un
// « Projet sans nom » derrière chaque ouverture, et l'écran Projets deviendrait
// le cimetière de ces brouillons.
//
// On REPREND donc le BAT vierge s'il en existe un, au lieu d'en empiler un de
// plus. Il ne peut ainsi jamais y en avoir plus d'un.

// Combien de candidats on accepte de charger avant de renoncer. L'index est
// rangé du plus récemment touché au plus ancien : un BAT vierge laissé par la
// dernière ouverture est en tête, on le trouve au premier essai. La borne
// existe pour le cas dégradé — un fonds de tiroir de vieux brouillons NOMMÉS
// « sans client » qu'il ne faut pas relire un par un au démarrage. Au pire on
// crée un vierge de plus, que l'ouverture suivante reprendra.
const CANDIDATS_MAX = 5;

export async function startNewProject() {
  // L'INDEX SAIT DÉJÀ LEQUEL EST VIERGE (drapeau `vierge`, posé à
  // l'enregistrement — cf. store.indexEntry). On ouvre donc LE bon fichier, et
  // un seul. Avant, il fallait charger les candidats un par un pour les
  // reconnaître : jusqu'à cinq allers-retours réseau EN SÉRIE avant le premier
  // affichage, sur le chemin de démarrage.
  // Le drapeau est une indication, pas une preuve : on revérifie sur le projet
  // chargé (un index écrit par une version antérieure, un fichier modifié
  // ailleurs). S'il ment, on retombe sur le balayage borné d'avant.
  const marques = store.projectsIndex.filter(e => e.vierge === true);
  for (const e of marques.slice(0, CANDIDATS_MAX)) {
    const p = await store.loadProject(e.id).catch(() => null);
    if (!isProjectBlank(p)) continue;
    app.closeProject();
    await app.openProject(p);
    return;
  }

  // Index hérité : aucune entrée ne porte le drapeau. On reprend le balayage,
  // borné comme avant — au pire on crée un vierge de plus, que l'ouverture
  // suivante reprendra (et qui, lui, sera marqué).
  if (!marques.length) {
    let essais = 0;
    for (const e of store.projectsIndex) {
      if (e.vierge !== undefined) continue;
      if (String(e.client || '').trim() || String(e.name || '').trim()) continue;
      if (++essais > CANDIDATS_MAX) break;
      const p = await store.loadProject(e.id).catch(() => null);
      if (!isProjectBlank(p)) continue;
      app.closeProject();
      await app.openProject(p);
      return;
    }
  }
  await createProject();
}

// ------------------------------------------ ouvrir LE BAT d'une fiche du CRM
// Monté dans le CRM, on n'ouvre pas « un BAT neuf » : on ouvre CELUI de la
// fiche sur laquelle le CRM nous a ouverts.
//
// Sans ça, chaque passage sur la fiche en empile un de plus : le premier a été
// rempli, donc il n'est plus vierge, donc `startNewProject` en crée un autre.
// Au bout d'une semaine la fiche en porte cinq et personne ne sait lequel fait
// foi. UNE fiche, UN BAT, et c'est celui-là qu'on rouvre.
export async function ouvrirPourFiche(requestId) {
  if (!nettoyerId(requestId)) { await startNewProject(); return; }

  // Le choix se fait sur l'index SEUL (cf. batDeLaFiche) : déjà en mémoire,
  // zéro requête, et on charge LE bon fichier du premier coup.
  const { id, aOuvrir } = batDeLaFiche(store.projectsIndex, requestId, CANDIDATS_MAX);
  const ouvrir = async (pid) => {
    const p = await store.loadProject(pid).catch(() => null);
    if (!p) return false;
    app.closeProject();
    await app.openProject(p);
    return true;
  };

  if (id && await ouvrir(id)) return;

  // Index hérité : les entrées qui ne portaient pas encore la fiche sont les
  // seules à pouvoir cacher notre BAT. On les ouvre pour vérifier, bornées.
  const cible = nettoyerId(requestId);
  for (const pid of aOuvrir) {
    const p = await store.loadProject(pid).catch(() => null);
    if (!p || p.crmRequestId !== cible) continue;
    app.closeProject();
    await app.openProject(p);
    return;
  }

  // Cette fiche n'a pas encore de BAT : on reprend le vierge s'il y en a un,
  // et `attacherContexte` (dans app.openProject) y colle la fiche.
  await startNewProject();
}

// --------------------------------------------------------- rouvrir un BAT
// Un BAT exporté embarque son projet (cf. batfile.js) : le PDF archivé chez le
// client ou dans un mail est un fichier de travail. On le rouvre, on modifie,
// on réexporte.
function openBatPdfFlow() {
  (async () => {
    const files = await window.batApi.dialogOpen({
      title: 'Ouvrir un BAT',
      filters: [{ name: 'BAT (PDF)', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (!files?.length) return;
    const buf = await window.batApi.fsRead(files[0]);
    if (!buf) { toast('Fichier illisible.', { error: true }); return; }
    await openBatPdf(new Uint8Array(buf), files[0].split(/[\\/]/).pop());
  })();
}

async function openBatPdf(bytes, fileName = '') {
  // pdf-lib n'est chargé qu'ici : l'écran d'accueil n'a pas à le télécharger
  // pour afficher une liste de projets (cf. imports différés dans app.js).
  const busy = toast('Lecture du BAT…', { ms: 0 });
  let mod, payload, identity;
  try {
    mod = await import('./batfile.js');
    ({ payload, identity } = await mod.inspectBatPdf(bytes));
  } catch (err) {
    console.error(err);
    toast('PDF illisible : ' + err.message, { error: true, ms: 7000 });
    return;
  } finally { busy.dismiss(); }

  // BAT d'avant le projet embarqué : il ne porte aucune donnée modifiable,
  // mais il porte son identité — et le projet qui l'a produit, lui, est
  // intact dans l'app. On ouvre celui-là plutôt que de refuser sèchement.
  if (!payload) { await openLegacyBatPdf(mod, identity, fileName); return; }

  const known = store.projectsIndex.find(x => x.id === payload.project?.id) || null;
  const mode = known ? await askImportMode(known, payload) : 'new';
  if (!mode) return;

  const { importProjectFromPayload, missingProducts } = await import('./batfile.js');
  const project = await importProjectFromPayload(payload, { mode });
  const missing = missingProducts(project);
  if (missing.length) {
    toast(`${missing.length} vêtement(s) de ce BAT sont absents du catalogue de ce poste — rechoisissez-les dans l'éditeur.`,
      { error: true, ms: 8000 });
  }
  app.closeProject();
  await app.openProject(project);
  toast(mode === 'replace' ? 'BAT rouvert — le projet a été mis à jour.' : 'BAT rouvert.');
}

// BAT exporté AVANT que les PDF n'embarquent leur projet. Rien à restaurer du
// fichier lui-même — mais son titre PDF dit de quel projet il vient
// (« BAT {client} — {projet} — v{n} », écrit par generateBAT depuis toujours)
// et ce projet est en général toujours dans l'app. On le retrouve et on
// l'ouvre : le BAT redevient modifiable, sans rien deviner ni reconstruire.
async function openLegacyBatPdf(mod, identity, fileName) {
  const quoi = fileName ? `« ${fileName} »` : 'Ce PDF';
  if (!identity.isOurs) {
    toast(`${quoi} n'a pas été produit par BAT Studio — seuls les BAT de cette application peuvent être rouverts.`,
      { error: true, ms: 8000 });
    return;
  }

  const candidats = mod.findSourceProjects(identity);
  if (!candidats.length) {
    // Cas réel : projet supprimé, ou BAT venu d'un autre poste. Le dire, et
    // dire quoi faire — un refus sans suite est ce qui fait « ça ne marche pas ».
    const qui = [identity.client, identity.name].filter(Boolean).join(' · ');
    toast(`${quoi} est un BAT d'avant les PDF modifiables${qui ? ` (${qui})` : ''}, et son projet n'existe plus sur ce poste. Il n'y a rien à rouvrir : recréez le projet, puis exportez — le nouveau PDF, lui, sera rouvrable.`,
      { error: true, ms: 11000 });
    return;
  }

  const choix = await askLegacyProject(identity, candidats, fileName);
  if (!choix) return;
  const p = await store.loadProject(choix.id);
  if (!p) { toast('Projet illisible.', { error: true }); return; }
  app.closeProject();
  await app.openProject(p);
  toast('Projet ouvert — modifiez, puis réexportez : le nouveau PDF embarquera son projet.', { ms: 6000 });
}

function askLegacyProject(identity, candidats, fileName) {
  return new Promise((resolve) => {
    const qui = [identity.client, identity.name].filter(Boolean).map(esc).join(' · ');
    const body = el(`<div style="max-width:560px">
      <p>${fileName ? `« ${esc(fileName)} »` : 'Ce BAT'} a été exporté <b>avant</b> que les PDF n'embarquent leur projet :
         le fichier ne contient rien de modifiable.</p>
      <p>Mais il indique d'où il vient — <b>${qui || 'sans client ni nom'}</b>${identity.version ? `, v${identity.version}` : ''} —
         et ${candidats.length > 1 ? 'ces projets correspondent' : 'ce projet est toujours là'}. Ouvrez-le pour modifier ce BAT&nbsp;:</p>
      <div class="legacy-list"></div>
      <p class="hint">Le PDF que vous réexporterez, lui, sera rouvrable directement.</p>
    </div>`);
    const list = body.querySelector('.legacy-list');
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const cancel = el(`<button class="btn secondaire">Annuler</button>`);
    const m = openModal({
      title: 'Ce BAT vient d’un projet existant',
      content: body,
      footButtons: [cancel],
      width: '620px',
      onClose: () => finish(null),
    });
    cancel.onclick = () => m.close();
    for (const c of candidats) {
      const b = el(`<button class="legacy-item">
        <span class="li-name">${esc(c.name || 'Projet sans nom')}</span>
        <span class="li-meta">${esc(c.client || 'Client non renseigné')} · v${c.version || 1} · modifié le ${esc(frDate((c.updatedAt || '').slice(0, 10)))}</span>
      </button>`);
      b.onclick = () => { finish(c); m.close(); };
      list.appendChild(b);
    }
    list.firstElementChild?.focus();
  });
}

// Le PDF porte un projet DÉJÀ connu de ce poste : écraser la version locale
// (le PDF fait foi, cas du BAT revenu du client) ou repartir d'une copie (le
// travail local en cours ne doit pas disparaître) ? Question posée, jamais
// devinée : les deux réponses sont légitimes et l'une détruit du travail.
function askImportMode(known, payload) {
  return new Promise((resolve) => {
    const body = el(`<div style="max-width:520px">
      <p>Ce PDF contient le projet <b>« ${esc(known.name || 'Sans nom')} »</b>, déjà présent sur ce poste
         (version locale v${known.version || 1}, dernière modification le ${esc(frDate((known.updatedAt || '').slice(0, 10)))}).</p>
      <p class="hint">Le BAT embarque la version v${esc(String(payload.project?.fiche?.version ?? 1))} du
         ${esc(frDate((payload.savedAt || '').slice(0, 10)))}.</p>
    </div>`);
    const cancel = el(`<button class="btn secondaire">Annuler</button>`);
    const copy = el(`<button class="btn secondaire">Créer un nouveau projet</button>`);
    const replace = el(`<button class="btn primaire">Mettre à jour le projet local</button>`);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = openModal({
      title: 'Ce BAT existe déjà',
      content: body,
      footButtons: [cancel, copy, replace],
      width: '580px',
      onClose: () => finish(null),
    });
    cancel.onclick = () => m.close();
    copy.onclick = () => { finish('copy'); m.close(); };
    replace.onclick = () => { finish('replace'); m.close(); };
  });
}

export function importCatalogueFlow(after) {
  (async () => {
    const dirs = await window.batApi.dialogOpen({
      title: 'Choisir le dossier du catalogue',
      properties: ['openDirectory'],
    });
    if (!dirs?.length) return;
    try {
      const n = await importOldaCatalogue(dirs[0]);
      toast(`Catalogue importé : ${n} produits.`);
      after?.();
    } catch (err) {
      toast('Import impossible : ' + err.message, { error: true, ms: 6000 });
    }
  })();
}

// Création directe : pas de modale. On ouvre la feuille PDF entièrement avec un
// produit/couleur par défaut ; client, projet, produit et couleur se saisissent
// ensuite directement en haut de l'écran (barre d'outils + entête de la feuille).
async function createProject() {
  const products = store.catalogue.products;
  if (!products.length) { toast('Le catalogue produit est vide.', { error: true }); return; }
  const product = products[0];
  const colorSlug = product.colors[0]?.slug || '';

  // Les tailles du premier article viennent de la grille produit : on s'assure
  // qu'elle est là (préchargée au démarrage, donc déjà résolue en pratique)
  // avant de créer l'article, sinon il naîtrait avec les tailles par défaut.
  await loadTailles();

  // Un projet démarre avec UN article ; les suivants s'ajoutent depuis la barre
  // d'onglets de l'éditeur (« + Article »).
  const project = store.newProject({ client: '', name: '', productId: product.id, colorSlug });
  // COULEUR / RÉF. PRODUIT ne sont PAS initialisés : laissés absents, ils suivent
  // le vêtement choisi (cf. articleCouleur/articleRef). Les forcer à '' les figeait
  // sur un override vide — le bandeau affichait « — » et le PDF sortait une case
  // vide alors que le vêtement était bien sélectionné.
  // n'inclure par défaut que les faces réellement disponibles
  const av = availableFaces(product, colorSlug);
  const faces = project.articles[0].faces;
  for (const k of Object.keys(faces)) faces[k].included = k === 'front' && av.includes('front');
  await store.saveProject(project);

  app.closeProject();
  await app.openProject(project);
}
