// Sélecteurs premium « produit » et « couleur » de la barre d'outils du BAT.
// Remplacent les <select> natifs : au-delà d'une poignée d'entrées (jusqu'à 35
// produits, jusqu'à 50 couleurs), une liste à plat devient illisible. Ici :
// un menu recherche + groupes Famille › Sous-famille pour le produit, une
// grille de pastilles pour la couleur.

import { el, createCombo } from './ui.js';
import { store, productRef } from './store.js';
import { esc, ICON_CHEVRON_DOWN, ICON_CHECK, ICON_SEARCH } from './util.js';
import { chercherProduits, ressembleAUneReference, squelette } from './recherche.js';

const FAMILY_ORDER = ['HOMME', 'FEMME', 'ENFANT', 'BEBE', 'POCHETTE'];
const FAMILY_LABEL = { HOMME: 'Homme', FEMME: 'Femme', ENFANT: 'Enfant', BEBE: 'Bébé', POCHETTE: 'Pochette', AUTRE: 'Autre' };

function familyLabel(cat) {
  const key = String(cat || '').toUpperCase().trim();
  if (FAMILY_LABEL[key]) return FAMILY_LABEL[key];
  return cat ? cat[0].toUpperCase() + cat.slice(1).toLowerCase() : 'Autre';
}
function familyRank(cat) {
  const i = FAMILY_ORDER.indexOf(String(cat || '').toUpperCase().trim());
  return i === -1 ? FAMILY_ORDER.length : i;
}

// Le popover générique (createCombo) et sa règle « un seul menu ouvert » ont
// déménagé dans `ui.js` : depuis que les listes ont un menu d'actions, deux
// écrans portent un menu — il n'a donc plus le droit de vivre ici (loi 10).

// Flèche haut/bas : déplace le focus parmi les lignes visibles d'un panneau.
function bindListKeyboard(panel, itemSelector) {
  const input = panel.querySelector('input');
  const visible = () => [...panel.querySelectorAll(itemSelector)].filter((n) => n.style.display !== 'none');
  panel.addEventListener('keydown', (e) => {
    const items = visible();
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[i < 0 ? 0 : Math.min(items.length - 1, i + 1)].focus(); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i <= 0) input?.focus(); else items[i - 1].focus();
    } else if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); items[0]?.click(); }
  });
}

// LA LISTE DES PRODUITS, TRIÉE PAR CE QU'ON A TAPÉ.
// Requête vide : le catalogue rangé par famille et par type — c'est la liste de
// départ, celle qu'on parcourt quand on ne sait pas encore ce qu'on veut.
// Requête non vide : le classement de `chercherProduits` fait foi et les
// familles disparaissent — le meilleur résultat doit être la PREMIÈRE ligne,
// pas la première ligne d'un groupe qu'il faut d'abord repérer.
//
// La liste se REFAIT à chaque frappe au lieu de masquer des lignes : masquer
// garde l'ordre du catalogue, et l'ordre du catalogue n'est pas celui de la
// pertinence.
function ligneProduit(p, selectedId, onPick) {
  const active = p.id === selectedId;
  const n = p.colors.length;
  const ref = productRef(p);
  // La désignation ne se répète pas quand elle EST la référence (le catalogue
  // OLDA nomme ses produits « H-001 NS300 »).
  const nom = squelette(p.name) === squelette(ref) ? '' : p.name;
  const row = el(`<button type="button" class="gp-row${active ? ' active' : ''}" role="option" aria-selected="${active}">
    <span class="gp-row-text">
      <span class="gp-row-name">${esc(ref)}</span>
      <span class="gp-row-meta">${nom ? esc(nom) + ' · ' : ''}${esc(familyLabel(p.category))} · ${esc(p.type)} · ${n} couleur${n > 1 ? 's' : ''}</span>
    </span>
    ${active ? `<span class="gp-row-check">${ICON_CHECK}</span>` : ''}
  </button>`);
  row.onclick = () => onPick(p.id);
  return row;
}

function remplirListeProduits(liste, products, requete, selectedId, onPick) {
  liste.replaceChildren();
  const trouves = chercherProduits(products, requete);
  if (squelette(requete)) {
    for (const p of trouves) liste.appendChild(ligneProduit(p, selectedId, onPick));
    return trouves;
  }
  const groups = new Map();   // famille → { rank, types: Map(type → produits[]) }
  for (const p of trouves) {
    const fam = familyLabel(p.category);
    if (!groups.has(fam)) groups.set(fam, { rank: familyRank(p.category), types: new Map() });
    const types = groups.get(fam).types;
    if (!types.has(p.type)) types.set(p.type, []);
    types.get(p.type).push(p);
  }
  const fams = [...groups.entries()].sort((a, b) => a[1].rank - b[1].rank || a[0].localeCompare(b[0], 'fr'));
  for (const [famName, { types }] of fams) {
    const famGroup = el(`<div class="gp-fam-group"><div class="gp-fam-head">${esc(famName)}</div></div>`);
    for (const [typeName, prods] of [...types.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))) {
      const subGroup = el(`<div class="gp-sub-group"><div class="gp-sub-head">${esc(typeName)}</div></div>`);
      for (const p of prods) subGroup.appendChild(ligneProduit(p, selectedId, onPick));
      famGroup.appendChild(subGroup);
    }
    liste.appendChild(famGroup);
  }
  return trouves;
}

function buildColorPanel(colors, selectedSlug, onPick) {
  const showSearch = colors.length > 12;
  const panel = el(`<div role="listbox" aria-label="Couleurs">
    ${showSearch ? `<div class="gp-search">${ICON_SEARCH}<input type="text" placeholder="Rechercher une couleur…" aria-label="Rechercher une couleur"></div>` : ''}
    <div class="gp-list"></div>
    <div class="gp-empty-msg" style="display:none">Aucune couleur ne correspond.</div>
  </div>`);
  const list = panel.querySelector('.gp-list');
  for (const c of colors) {
    const active = c.slug === selectedSlug;
    const row = el(`<button type="button" class="gp-row${active ? ' active' : ''}" role="option" aria-selected="${active}">
      <span class="gp-row-dot" style="background:${esc(c.hex || '#ccc')}"></span>
      <span class="gp-row-text"><span class="gp-row-name">${esc(c.label)}</span></span>
      ${active ? `<span class="gp-row-check">${ICON_CHECK}</span>` : ''}
    </button>`);
    row.dataset.search = c.label.toLowerCase();
    row.onclick = () => onPick(c.slug);
    list.appendChild(row);
  }
  if (showSearch) {
    panel.querySelector('input').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      let any = false;
      for (const row of list.children) {
        const match = !q || row.dataset.search.includes(q);
        row.style.display = match ? '' : 'none';
        if (match) any = true;
      }
      panel.querySelector('.gp-empty-msg').style.display = any ? 'none' : '';
    });
  }
  bindListKeyboard(panel, '.gp-row');
  return panel;
}

function renderColorTrigger(trigger, c) {
  if (!c) { trigger.innerHTML = `<span class="gp-trigger-empty">Couleur</span>${ICON_CHEVRON_DOWN}`; return; }
  trigger.innerHTML = `
    <span class="gp-trigger-dot" style="background:${esc(c.hex || '#ccc')}"></span>
    <span class="gp-trigger-text"><span class="gp-trigger-name">${esc(c.label)}</span></span>
    ${ICON_CHEVRON_DOWN}`;
  trigger.title = c.label;
}

// ---------------------------------------------------------------------------
// LE CHAMP « VÊTEMENT » EST LA RECHERCHE
// ---------------------------------------------------------------------------
// Il fallait cliquer un bouton, attendre le menu, viser une case de recherche,
// puis taper : quatre gestes pour une action qu'on fait à chaque article. Le
// champ EST la case de recherche — on tape dedans, la liste se classe sous les
// doigts, Entrée prend le premier résultat.
//
// Ce qu'on tape n'est pas ce qui est choisi : tant qu'on n'a rien validé, le
// champ garde la référence en cours. À la sortie sans choix, il la ré-affiche
// — un champ qui garderait « ns3 » mentirait sur l'article ouvert.
//
// ET SI LA RÉFÉRENCE N'EST PAS AU CATALOGUE, ON L'IMPORTE D'ICI. Taper
// « NS333 » quand TopTex la connaît mais pas nous ouvrait un aller-retour par
// l'écran Produits, une modale, deux champs à confirmer. La dernière ligne du
// menu propose l'import ; un clic, toutes les couleurs arrivent, le vêtement
// est posé sur l'article. Le type et le rayon se déduisent de la désignation
// (cf. toptexref.js) — c'étaient les deux seules questions de la modale, et le
// nom du produit y répond.
//
// `onImport(ref, { onProgress })` : fourni par l'écran, il fait le travail et
// renvoie le produit importé. Absent, la ligne d'import ne paraît pas.
export function mountProductPicker(host, { onSelect, onImport }) {
  const saisie = el('<input type="text" class="gp-trigger gp-saisie" autocomplete="off" spellcheck="false" aria-label="Vêtement — tapez une référence ou un modèle">');
  const combo = createCombo(host, { trigger: saisie });
  let state = { products: [], selectedId: null };
  let liste = null, vide = null, importe = null;
  // CE QUI EST ÉCRIT N'EST PAS TOUJOURS UNE RECHERCHE. Au repos, le champ
  // affiche la référence en cours — c'est une étiquette. S'en servir comme
  // requête ouvrait le menu déjà réduit au seul produit choisi : pour en
  // parcourir un autre, il fallait d'abord vider le champ. Le menu ne filtre
  // donc qu'à partir de la première frappe.
  let enSaisie = false;

  const produitChoisi = () => state.products.find((p) => p.id === state.selectedId);
  const requete = () => (enSaisie ? saisie.value : '');
  const afficherChoix = () => {
    enSaisie = false;
    saisie.value = produitChoisi() ? productRef(produitChoisi()) : '';
  };

  const choisir = (id) => { onSelect(id); combo.close(); saisie.blur(); };

  const rendre = () => {
    if (!liste) return;
    const q = requete();
    const trouves = remplirListeProduits(liste, state.products, q, state.selectedId, choisir);
    // L'IMPORT NE SE PROPOSE QUE QUAND LE CATALOGUE SÈCHE. Deux conditions, et
    // les deux sont nécessaires : ce qu'on a tapé RESSEMBLE à une référence
    // (« sweat » n'en est pas une), et la recherche ne ramène RIEN.
    // Tant qu'elle ramène quelque chose, c'est ce quelque chose qu'on cherche :
    // taper « n300 » sort NS300, et proposer d'importer une référence « N300 »
    // qui n'existe pas serait un piège tendu sous le doigt.
    const proposable = !!onImport && ressembleAUneReference(q) && !trouves.length;
    importe.style.display = proposable ? '' : 'none';
    if (proposable) importe.querySelector('.gp-import-ref').textContent = q.trim().toUpperCase();
    vide.style.display = (trouves.length || proposable) ? 'none' : '';
  };

  const lancerImport = async () => {
    const ref = saisie.value.trim();
    const etat = importe.querySelector('.gp-import-etat');
    importe.disabled = true;
    etat.textContent = 'Recherche chez TopTex…';
    try {
      const res = await onImport(ref, {
        onProgress: (faits, total) => { etat.textContent = total ? `${faits}/${total} images…` : 'Téléchargement…'; },
      });
      combo.close();
      saisie.blur();
      if (res?.product) onSelect(res.product.id);
    } catch (e) {
      etat.textContent = e.message;
      importe.disabled = false;
    }
  };

  combo.setPanelBuilder(() => {
    const panel = el(`<div role="listbox" aria-label="Produits">
      <div class="gp-list"></div>
      <div class="gp-empty-msg" style="display:none">Aucun produit ne correspond.</div>
      <button type="button" class="gp-row gp-import" style="display:none">
        <span class="gp-row-text">
          <span class="gp-row-name">Importer <b class="gp-import-ref"></b> depuis TopTex</span>
          <span class="gp-row-meta gp-import-etat">Toutes les couleurs, d'un coup</span>
        </span>
      </button>
    </div>`);
    liste = panel.querySelector('.gp-list');
    vide = panel.querySelector('.gp-empty-msg');
    importe = panel.querySelector('.gp-import');
    importe.onclick = lancerImport;
    rendre();
    return panel;
  });

  // Ouvrir sur un champ ne se bascule pas : cliquer dans un champ déjà ouvert
  // sert à placer le curseur, pas à refermer le menu qu'on regarde.
  saisie.onclick = () => combo.open();
  // Le texte est sélectionné à l'entrée : la première frappe remplace la
  // référence affichée au lieu de s'y coller.
  saisie.onfocus = () => { enSaisie = false; saisie.select(); combo.open(); rendre(); };
  saisie.addEventListener('input', () => { enSaisie = true; combo.open(); rendre(); });
  saisie.addEventListener('blur', () => setTimeout(afficherChoix, 0));
  saisie.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const premier = liste?.querySelector('.gp-row');
      if (premier) premier.click();
      else if (importe && importe.style.display !== 'none') lancerImport();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      liste?.querySelector('.gp-row')?.focus();
    } else if (e.key === 'Escape') {
      afficherChoix();
    }
  });

  return {
    update(products, selectedId) {
      state = { products, selectedId };
      const p = produitChoisi();
      saisie.title = p
        ? `${p.name} — ${familyLabel(p.category)} · ${p.type} · ${p.colors.length} couleur${p.colors.length > 1 ? 's' : ''}`
        : 'Choisir un vêtement';
      saisie.placeholder = p ? '' : 'Réf. ou modèle…';
      // On n'écrase pas ce que l'utilisateur est en train de taper.
      if (document.activeElement !== saisie) afficherChoix();
      rendre();
    },
    // Ouverture pilotée : « + Article » enchaîne sur le choix du vêtement.
    open: () => { saisie.focus(); combo.open(); },
  };
}

// ---------------------------------------------------------------------------
// LES FACES — UN SEUL CONTRÔLE, PAS QUATRE PASTILLES
// ---------------------------------------------------------------------------
// Quatre cases à cocher côte à côte prenaient 466 px du bandeau pour un réglage
// qui se lit en trois mots (« cœur + dos »). Elles deviennent UN champ, de la
// même forme que Vêtement et Couleur juste à côté : le bouton dit ce qui est
// coché, le menu propose tout ce que le produit permet.
//
// LE MENU NE SE FERME PAS AU CLIC. C'est ce qui le distingue des deux autres :
// on y coche plusieurs faces d'affilée, et refermer après chacune obligerait à
// rouvrir autant de fois. Il se ferme comme tous les autres — Échap, ou un clic
// dehors.
//
// Une face indisponible pour ce produit/coloris reste AFFICHÉE, désactivée :
// la retirer de la liste laisserait croire qu'elle n'existe pas, alors qu'elle
// manque seulement à ce vêtement-là.
function renderFaceTrigger(trigger, faces) {
  const prises = faces.filter((f) => f.included);
  // « Cœur + dos », pas « Cœur + Dos » : dans le menu chaque libellé commence
  // une ligne et prend sa majuscule ; enchaînés, ils forment UNE phrase, et
  // une phrase n'a qu'une majuscule.
  const texte = prises.length
    ? prises.map((f, i) => (i ? f.label.toLocaleLowerCase('fr') : f.label)).join(' + ')
    : 'Aucune face';
  const n = prises.reduce((s, f) => s + f.logos, 0);
  trigger.innerHTML = `
    <span class="gp-trigger-text">
      <span class="gp-trigger-name${prises.length ? '' : ' gp-trigger-vide'}">${esc(texte)}</span>
    </span>
    ${n ? `<span class="gp-trigger-count">${n}</span>` : ''}
    ${ICON_CHEVRON_DOWN}`;
  trigger.title = prises.length
    ? `Faces du BAT : ${prises.map((f) => f.label).join(', ')}`
    : 'Aucune face incluse — le BAT serait vide';
}

function buildFacePanel(faces, onToggle) {
  const panel = el(`<div class="gp-list" role="group" aria-label="Faces du bon à tirer"></div>`);
  for (const f of faces) {
    const row = el(`<label class="gp-row gp-row-coche${f.included ? ' active' : ''}${f.available ? '' : ' gp-row-off'}"
      title="${f.available ? '' : 'Face indisponible pour ce produit ou ce coloris'}">
      <input type="checkbox" ${f.included ? 'checked' : ''} ${f.available ? '' : 'disabled'}>
      <span class="gp-row-text"><span class="gp-row-name">${esc(f.label)}</span></span>
      ${f.logos ? `<span class="gp-row-meta">${f.logos} logo${f.logos > 1 ? 's' : ''}</span>` : ''}
    </label>`);
    row.querySelector('input').onchange = (e) => onToggle(f.key, e.target.checked);
    panel.appendChild(row);
  }
  return panel;
}

// `faces` : [{ key, label, included, available, logos }].
export function mountFacePicker(host, { onToggle }) {
  const combo = createCombo(host);
  let state = [];
  combo.setPanelBuilder(() => buildFacePanel(state, onToggle));
  return {
    update(faces) {
      state = faces;
      renderFaceTrigger(combo.trigger, faces);
      // Le menu peut être OUVERT pendant qu'on coche : ses lignes doivent
      // suivre le modèle sans être reconstruites, sinon le clic suivant tombe
      // sur un nœud qui n'existe plus.
      const rows = host.querySelectorAll('.gp-row-coche');
      rows.forEach((row, i) => {
        const f = faces[i];
        if (!f) return;
        row.classList.toggle('active', f.included);
        const box = row.querySelector('input');
        if (box.checked !== f.included) box.checked = f.included;
      });
    },
  };
}

export function mountColorPicker(host, { onSelect }) {
  const combo = createCombo(host);
  let state = { colors: [], selectedSlug: null };
  combo.setPanelBuilder((close) => buildColorPanel(state.colors, state.selectedSlug, (slug) => { onSelect(slug); close(); }));
  return {
    update(colors, selectedSlug) {
      state = { colors, selectedSlug };
      renderColorTrigger(combo.trigger, colors.find((c) => c.slug === selectedSlug));
    },
  };
}
