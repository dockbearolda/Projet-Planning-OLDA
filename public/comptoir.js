// Comptoir — briques communes aux DEUX flux de « Nouveau Projet »
// ===========================================================================
// « Vente directe » (projet.js) et « Demande de devis » (devis.js) sont deux
// écrans différents, mais ils partagent tout ce qui ne dépend pas du flux :
// les helpers de construction du DOM, les messages d'erreur sous les champs,
// l'appel HTTP, et surtout LE SÉLECTEUR DE CLIENT.
//
// Le sélecteur de client vit ici et nulle part ailleurs : recherche dans la
// VRAIE base (/api/clients), création qui écrit dedans (POST /api/clients),
// avertissement de doublon, format des numéros. Deux copies auraient dérivé au
// premier correctif — et un comptoir qui crée des doublons dans un flux mais
// pas dans l'autre est exactement le genre d'incohérence qu'on paie longtemps.
//
// Les deux flux vivent en même temps dans le DOM : chaque instance du sélecteur
// porte donc son propre préfixe d'identifiants (`vd-`, `dv-`), sinon deux
// éléments partageraient un id et les <label for> désigneraient le mauvais champ.

import {
  wireVilleDefaults, applyCasse, formatPhoneAsTyped,
  loadSecteurs, SECTEURS, VILLES,
} from './clients.js';
import { groupDigits, whatsappNumber } from './whatsapp.js';

// --- DOM ---------------------------------------------------------------------
export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export function input(id, type, placeholder, attrs = {}) {
  const n = el('input');
  n.id = id;
  n.type = type;
  if (placeholder) n.placeholder = placeholder;
  Object.assign(n, attrs);
  return n;
}

export function select(id, options, values) {
  const n = el('select');
  n.id = id;
  options.forEach((label, i) => n.append(new Option(label, values ? values[i] : label)));
  return n;
}

export function textarea(id, placeholder, rows) {
  const n = el('textarea');
  n.id = id;
  if (placeholder) n.placeholder = placeholder;
  if (rows) n.rows = rows;
  return n;
}

export function champ(label, control, opts = {}) {
  const wrap = el('div', 'vd-field');
  const lab = el('label', null, label);
  lab.htmlFor = control.id;
  wrap.append(lab, control);
  if (opts.aide) {
    const aide = el('div', 'vd-help');
    aide.id = opts.aide;
    wrap.append(aide);
  }
  return wrap;
}

export function carte(...enfants) {
  const c = el('section', 'vd-card');
  c.append(...enfants);
  return c;
}

export function bouton(id, label, cls = 'vd-btn') {
  const b = el('button', cls, label);
  if (id) b.id = id;
  b.type = 'button';
  return b;
}

export function titreEtape(titre, refId) {
  const tete = el('div', 'vd-stage-title');
  const ref = el('div', 'vd-order-ref', '—');
  ref.id = refId;
  tete.append(el('h2', null, titre), ref);
  return tete;
}

// --- Messages d'erreur : le champ passe en rouge, le message se pose dessous --
export function effacerErreurs(root) {
  for (const n of root.querySelectorAll('.vd-invalid')) n.classList.remove('vd-invalid');
  for (const n of root.querySelectorAll('.vd-error-msg')) n.remove();
}

export function erreurChamp(root, id, message) {
  const champElement = root.querySelector(`#${id}`);
  if (!champElement) return false;
  champElement.classList.add('vd-invalid');
  champElement.insertAdjacentElement('afterend', el('div', 'vd-error-msg', message));
  champElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  champElement.focus();
  return false;
}

// Un champ qu'on corrige efface son erreur : le rouge ne survit pas à la frappe
// qui le répare.
export function effacerErreurALaFrappe(root) {
  root.addEventListener('input', (e) => {
    if (!e.target.classList || !e.target.classList.contains('vd-invalid')) return;
    e.target.classList.remove('vd-invalid');
    const suivant = e.target.nextElementSibling;
    if (suivant && suivant.classList.contains('vd-error-msg')) suivant.remove();
  });
}

// --- Chiffres, dates, HTTP ---------------------------------------------------
export const fold = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
// Arrondi identique à celui du serveur (readPrixLigne) : c'est ce qui garantit
// que le total affiché est au centime près celui enregistré au planning.
export const cents = (v) => Math.round((Number(v) || 0) * 100) / 100;
export const money = (v) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
  .format(Number(v) || 0);
export const todayISO = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
export const formatDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
};
export const heureTexte = (hhmm) => String(hhmm || '').replace(':', 'h');
// aaaa-mm-jj dans N jours, calculé sur l'heure du POSTE (le conteneur tourne en
// UTC : il basculerait au lendemain dès 20 h à Saint-Martin).
export function dansNJours(n) {
  const d = new Date();
  d.setDate(d.getDate() + Number(n));
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

// --- Identité d'un client ----------------------------------------------------
// Comment s'appelle ce client : « Prénom NOM » pour un particulier — le nom seul
// ne suffit pas à le reconnaître, et c'est ce texte qui remplit la colonne
// Client du planning —, la société pour un pro. Les deux champs séparés de la
// fiche font foi ; une fiche ancienne n'en a pas, `entreprise` vaut alors déjà
// « Prénom Nom ». On ne réordonne jamais ses mots : le dédoublonnage compare
// cette chaîne.
export function nomClient(row) {
  if (!row) return '—';
  if ((row.client_type || 'pro') === 'perso') {
    return [row.prenom, row.nom].filter(Boolean).join(' ') || row.entreprise || '—';
  }
  return row.entreprise || '—';
}

export function clientVue(row) {
  const perso = (row.client_type || 'pro') === 'perso';
  return {
    id: row.id,
    clientType: row.client_type || 'pro',
    perso,
    nom: nomClient(row),
    contact: perso ? null : (row.referent_prenom || null),
    telephone: row.telephone || '',
    email: row.email || '',
    prenom: row.prenom || '',
    nomFamille: row.nom || '',
  };
}

export function metaClient(c) {
  return [
    c.contact ? `Contact : ${c.contact}` : null,
    c.telephone ? `WhatsApp : ${c.telephone}` : null,
    c.email || null,
  ].filter(Boolean).join(' • ');
}

// Ce que le serveur attend comme `client` dans POST /api/projets.
export function payloadClient(c) {
  if (c.perso) {
    // Particulier : le prénom ET le nom partent séparément — c'est leur
    // concaténation qui remplit la colonne Client du planning. Les DEUX ou
    // AUCUN : envoyer un nom sans prénom afficherait « DUPONT » tout court.
    // Sans les deux, `societe` (déjà « Prénom NOM ») fait foi côté serveur.
    const prenom = (c.prenom || '').trim();
    const nomFamille = (c.nomFamille || '').trim();
    const identite = prenom && nomFamille ? { prenom, nom: nomFamille } : {};
    return { type: 'perso', ...identite, societe: c.nom, whatsapp: c.telephone, email: c.email };
  }
  return {
    type: c.clientType, facturation: c.nom, contact: c.contact,
    whatsapp: c.telephone, email: c.email,
  };
}

// --- Numéros de téléphone ----------------------------------------------------
// TOUS les numéros passent : 0690 des Antilles, 06/07 de métropole, fixe, +1 de
// Sint Maarten, indicatif inconnu. Le champ reste obligatoire, mais le seul refus
// est « ce n'est pas un numéro du tout » — une règle de format plus fine a déjà
// bloqué le comptoir devant un client bien réel.
export const telValide = (v) => /\d/.test(String(v == null ? '' : v));
export const estInternational = (v) => /^(\+|00)/.test(String(v == null ? '' : v).trim());
export function formaterTel(value) {
  const brut = String(value == null ? '' : value).trim();
  if (estInternational(brut)) return brut;   // l'indicatif pays ne se coupe pas
  const chiffres = brut.replace(/\D/g, '');
  if (/^590\d{9}$/.test(chiffres)) return groupDigits(`0${chiffres.slice(3)}`);
  return groupDigits(brut);
}
export const emailValide = (v) => !String(v).trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
export const telNormalise = (v) => whatsappNumber(v) || String(v == null ? '' : v).replace(/\D/g, '');

// ===========================================================================
// SÉLECTEUR DE CLIENT
// ===========================================================================
// Rendu dans un élément que l'appelant insère où il veut. `onChange(client)` est
// appelé à chaque fois que le client retenu change (null = plus de client) :
// c'est à l'écran hôte de décider ce qu'il en fait (montrer son bouton suivant,
// repeindre son résumé…).
//
// `prefix` distingue les instances : « vd » pour la vente directe, « dv » pour
// la demande de devis.
export function creerSelecteurClient({ prefix, labelAjouter, labelCreer, onChange }) {
  const id = (suffixe) => `${prefix}-${suffixe}`;
  const racine = el('div');
  const $ = (suffixe) => racine.querySelector(`#${id(suffixe)}`);

  let referentiel = [];
  let retenu = null;
  let doublonConfirme = null;
  let nature = 'perso';

  // --- Construction ---------------------------------------------------------
  const recherche = champ(
    'Rechercher un client existant',
    input(id('client-search'), 'text', 'Nom, société, WhatsApp ou partie du numéro', { autocomplete: 'off' }),
  );
  recherche.id = id('client-search-wrap');
  const resultats = el('div', 'vd-client-results');
  resultats.id = id('client-results');
  recherche.append(resultats);

  const carteRetenu = el('div', 'vd-item vd-selected vd-hidden');
  carteRetenu.id = id('selected-card');
  const teteRetenu = el('div', 'vd-client-head');
  const gaucheRetenu = el('div');
  const nomRetenu = el('h3', null, '');
  nomRetenu.id = id('selected-name');
  const metaRetenu = el('div', 'vd-help');
  metaRetenu.id = id('selected-meta');
  gaucheRetenu.append(el('span', 'vd-badge vd-badge--on', '✓ Client retenu'), nomRetenu, metaRetenu);
  teteRetenu.append(gaucheRetenu, bouton(id('change-client'), 'Changer'));
  carteRetenu.append(teteRetenu);

  const absent = el('div', 'vd-notice');
  absent.id = id('notfound');
  absent.append(
    el('b', null, 'Le client n’existe pas encore ?'),
    el('div', 'vd-help', 'Crée sa fiche : elle entre dans la base clients et se rattache à cette fiche.'),
    bouton(id('show-create'), '+ Créer un nouveau client', 'vd-btn vd-btn--primary'),
  );

  const creation = el('div', 'vd-hidden');
  creation.id = id('create-box');
  creation.append(el('h3', null, 'Créer un nouveau client'));
  const choix = el('div', 'vd-choice-grid');
  const boutonPerso = bouton(id('choose-perso'), '', 'vd-choice is-active');
  boutonPerso.append(el('b', null, 'Particulier'), el('div', 'vd-help', 'Nom, WhatsApp et e-mail.'));
  const boutonPro = bouton(id('choose-pro'), '', 'vd-choice');
  boutonPro.append(el('b', null, 'Professionnel'), el('div', 'vd-help', 'Société, secteur, contact et coordonnées.'));
  choix.append(boutonPerso, boutonPro);
  creation.append(choix);

  const formPerso = el('div');
  formPerso.id = id('form-perso');
  formPerso.style.marginTop = '16px';
  const duoPerso = el('div', 'vd-grid');
  duoPerso.append(
    champ('Prénom et nom *', input(id('perso-nom'), 'text', 'Ex. Jean Dupont', { autocomplete: 'off' })),
    champ('WhatsApp *', input(id('perso-tel'), 'tel', 'Ex. 06 90 47 97 88', { inputMode: 'tel', autocomplete: 'off' })),
  );
  formPerso.append(duoPerso, champ('E-mail', input(id('perso-email'), 'email', 'client@email.com', { autocomplete: 'off' })));

  // La liste des secteurs vit en base (le patron l'ajuste depuis Base clients) :
  // les deux formulaires proposent donc exactement la même chose, et « Autre »
  // évite que le comptoir se retrouve bloqué devant un métier absent.
  const formPro = el('div', 'vd-hidden');
  formPro.id = id('form-pro');
  formPro.style.marginTop = '16px';
  const duoPro = el('div', 'vd-grid');
  duoPro.append(
    champ('Raison sociale *', input(id('pro-societe'), 'text', 'Ex. Hôtel Exemple', { autocomplete: 'off' })),
    champ('Secteur d’activité *', select(id('pro-secteur'), ['Choisir un secteur'], [''])),
  );
  const trioPro = el('div', 'vd-grid-3');
  trioPro.append(
    champ('Contact *', input(id('pro-contact'), 'text', 'Ex. Marie', { autocomplete: 'off' })),
    champ('WhatsApp *', input(id('pro-tel'), 'tel', 'Ex. 06 90 47 97 88', { inputMode: 'tel', autocomplete: 'off' })),
    champ('E-mail', input(id('pro-email'), 'email', 'contact@entreprise.com', { autocomplete: 'off' })),
  );
  const trioAdresse = el('div', 'vd-grid-3');
  const ville = input(id('pro-ville'), 'text', 'Saint-Martin', { autocomplete: 'off' });
  ville.dataset.key = 'ville';
  const cp = input(id('pro-cp'), 'text', '97150', { autocomplete: 'off' });
  cp.dataset.key = 'code_postal';
  trioAdresse.append(
    champ('Adresse', input(id('pro-adresse'), 'text', null, { autocomplete: 'off' })),
    champ('Ville', ville),
    champ('Code postal', cp),
  );
  formPro.append(duoPro, trioPro, trioAdresse);

  // Classe à part, PAS `vd-error-msg` : `effacerErreurs()` retire du DOM tous les
  // messages d'erreur (ils sont créés à la volée sous les champs). L'avertissement
  // de doublon, lui, est un élément permanent qu'on montre et cache.
  const avert = el('div', 'vd-warning vd-hidden');
  avert.id = id('create-warning');
  const actionsCreation = el('div', 'vd-actions');
  actionsCreation.append(
    bouton(id('create-btn'), labelCreer || 'Créer et rattacher', 'vd-btn vd-btn--primary'),
    bouton(id('cancel-create'), 'Annuler'),
  );
  creation.append(formPerso, formPro, avert, actionsCreation);

  racine.append(recherche, carteRetenu, absent, creation);

  // --- Comportement ---------------------------------------------------------
  function chercher() {
    const q = fold($('client-search').value).trim();
    const box = $('client-results');
    box.replaceChildren();
    if (!q) return;
    const chiffres = q.replace(/\D/g, '');
    const trouves = referentiel.filter((row) => {
      const foin = fold([row.entreprise, row.nom, row.prenom, row.referent_prenom, row.telephone, row.email]
        .filter(Boolean).join(' '));
      const tel = String(row.telephone || '').replace(/\D/g, '');
      return foin.includes(q) || (chiffres && tel.includes(chiffres));
    }).slice(0, 8);

    if (!trouves.length) {
      box.append(el('div', 'vd-notice', 'Aucun client trouvé. Tu peux en créer un nouveau.'));
      return;
    }
    for (const row of trouves) {
      const c = clientVue(row);
      const resultat = el('div', 'vd-client-result');
      const tete = el('div', 'vd-client-head');
      const gauche = el('div');
      gauche.append(el('b', null, c.nom), el('div', 'vd-help', metaClient(c)));
      const ajouter = el('button', 'vd-btn vd-btn--primary', labelAjouter || 'Retenir ce client');
      ajouter.type = 'button';
      ajouter.addEventListener('click', () => retenir(c));
      tete.append(gauche, ajouter);
      resultat.append(tete);
      box.append(resultat);
    }
  }

  function retenir(c) {
    retenu = c;
    $('selected-name').textContent = c.nom;
    $('selected-meta').textContent = metaClient(c);
    $('selected-card').classList.remove('vd-hidden');
    $('client-search-wrap').classList.add('vd-hidden');
    $('notfound').classList.add('vd-hidden');
    $('create-box').classList.add('vd-hidden');
    if (onChange) onChange(retenu);
    $('selected-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function oublier() {
    retenu = null;
    $('selected-card').classList.add('vd-hidden');
    $('client-search-wrap').classList.remove('vd-hidden');
    $('notfound').classList.remove('vd-hidden');
    $('client-search').value = '';
    $('client-results').replaceChildren();
    if (onChange) onChange(null);
  }

  // Un client déjà en base porte-t-il le même numéro, le même e-mail ou le même
  // nom ? On prévient AVANT de créer un doublon ; un second clic sur le même
  // bouton confirme — parfois c'est bien un nouveau client, et le comptoir ne
  // doit jamais rester bloqué.
  function chercherDoublon({ telephone, email, entreprise }) {
    return referentiel.find((c) => {
      const memeTel = telephone && telNormalise(c.telephone) === telephone;
      const memeMail = email && c.email && c.email.toLowerCase() === email.toLowerCase();
      const memeNom = entreprise && c.entreprise && c.entreprise.toLowerCase() === entreprise.toLowerCase();
      return memeTel || memeMail || memeNom;
    });
  }

  function basculerNature(suivante) {
    nature = suivante;
    $('choose-perso').classList.toggle('is-active', nature === 'perso');
    $('choose-pro').classList.toggle('is-active', nature === 'pro');
    $('form-perso').classList.toggle('vd-hidden', nature !== 'perso');
    $('form-pro').classList.toggle('vd-hidden', nature !== 'pro');
    effacerErreurs(racine);
    $('create-warning').classList.add('vd-hidden');
    doublonConfirme = null;
  }

  function peindreSecteurs() {
    const liste = $('pro-secteur');
    const garde = liste.value;
    liste.replaceChildren(new Option('Choisir un secteur', ''));
    for (const s of SECTEURS) liste.append(new Option(s, s, false, s === garde));
  }

  async function creer() {
    effacerErreurs(racine);
    $('create-warning').classList.add('vd-hidden');
    const perso = nature === 'perso';
    const lu = (suffixe) => $(suffixe).value.trim();
    const echec = (suffixe, message) => erreurChamp(racine, id(suffixe), message);

    const telSuffixe = perso ? 'perso-tel' : 'pro-tel';
    const emailSuffixe = perso ? 'perso-email' : 'pro-email';
    const telephone = lu(telSuffixe);
    const email = lu(emailSuffixe);

    let draft;
    if (perso) {
      if (!lu('perso-nom')) return echec('perso-nom', 'Renseigne le prénom et le nom.');
      if (!telValide(telephone)) return echec(telSuffixe, 'Renseigne un numéro WhatsApp.');
      if (!emailValide(email)) return echec(emailSuffixe, 'Adresse e-mail invalide.');
      // Le comptoir tape « Prénom Nom » ; la base garde les deux séparés (et leur
      // casse : Jean / DUPONT). Un seul mot = un nom.
      const mots = lu('perso-nom').split(/\s+/);
      const prenom = mots.length > 1 ? applyCasse('initiales', mots[0]) : '';
      const nom = applyCasse('majuscules', (mots.length > 1 ? mots.slice(1) : mots).join(' '));
      draft = {
        client_type: 'perso', prenom, nom,
        // `entreprise` est la colonne obligatoire côté serveur et porte la
        // recherche : pour un particulier elle vaut « Prénom NOM ».
        entreprise: `${prenom} ${nom}`.trim(),
        telephone: formaterTel(telephone), email,
      };
    } else {
      if (!lu('pro-societe')) return echec('pro-societe', 'Renseigne la raison sociale.');
      if (!lu('pro-secteur')) return echec('pro-secteur', 'Choisis le secteur d’activité.');
      if (!lu('pro-contact')) return echec('pro-contact', 'Renseigne le contact.');
      if (!telValide(telephone)) return echec(telSuffixe, 'Renseigne un numéro WhatsApp.');
      if (!emailValide(email)) return echec(emailSuffixe, 'Adresse e-mail invalide.');
      draft = {
        client_type: 'pro',
        // Un seul nom de société est demandé : il remplit les deux colonnes
        // (`entreprise` porte la recherche et l'affichage, `raison_sociale` la
        // facturation).
        entreprise: lu('pro-societe'),
        raison_sociale: lu('pro-societe'),
        secteur: lu('pro-secteur'),
        referent_prenom: lu('pro-contact'),
        telephone: formaterTel(telephone), email,
        adresse: lu('pro-adresse'), ville: lu('pro-ville'), code_postal: lu('pro-cp'),
      };
      // Le pays ne se demande pas (il se déduit de la ville) mais il s'enregistre :
      // sans ça la colonne se viderait en silence pour tous les clients créés ici.
      const connue = VILLES.find((v) => fold(v.label) === fold(draft.ville));
      if (connue) draft.pays = connue.pays;
    }

    const signature = `${draft.client_type}|${draft.entreprise}|${telephone}|${email}`;
    if (doublonConfirme !== signature) {
      const jumeau = chercherDoublon({ telephone: telNormalise(telephone), email, entreprise: draft.entreprise });
      if (jumeau) {
        $('create-warning').textContent = `Attention : un client similaire existe déjà (${nomClient(jumeau)}). Vérifie avant de créer un doublon — clique à nouveau pour créer quand même.`;
        $('create-warning').classList.remove('vd-hidden');
        $('create-warning').scrollIntoView({ behavior: 'smooth', block: 'center' });
        doublonConfirme = signature;
        return false;
      }
    }

    const btn = $('create-btn');
    btn.disabled = true;
    try {
      const cree = await api('POST', '/api/clients', draft);
      referentiel.push(cree);
      doublonConfirme = null;
      retenir(clientVue(cree));
    } catch (err) {
      window.alert(err.message || 'Création impossible');
    } finally {
      btn.disabled = false;
    }
    return true;
  }

  $('client-search').addEventListener('input', chercher);
  $('change-client').addEventListener('click', oublier);
  $('show-create').addEventListener('click', () => {
    $('create-box').classList.remove('vd-hidden');
    $('notfound').classList.add('vd-hidden');
    $(nature === 'perso' ? 'perso-nom' : 'pro-societe').focus();
  });
  $('cancel-create').addEventListener('click', () => {
    $('create-box').classList.add('vd-hidden');
    $('notfound').classList.remove('vd-hidden');
    effacerErreurs(racine);
  });
  $('choose-perso').addEventListener('click', () => basculerNature('perso'));
  $('choose-pro').addEventListener('click', () => basculerNature('pro'));
  $('create-btn').addEventListener('click', creer);

  // Regroupement des chiffres à la frappe (règle partagée avec Base clients) ;
  // un numéro international se tape tel quel, sans être regroupé.
  for (const suffixe of ['perso-tel', 'pro-tel']) {
    const champTel = $(suffixe);
    champTel.addEventListener('input', () => {
      if (!estInternational(champTel.value)) formatPhoneAsTyped(champTel);
    });
    champTel.addEventListener('blur', () => { champTel.value = formaterTel(champTel.value); });
  }
  // Une ville connue remplit le code postal, sans jamais écraser une saisie.
  wireVilleDefaults(formPro, null, 'input');

  return {
    element: racine,
    // Le champ de recherche : c'est lui que l'écran hôte met en rouge quand on
    // essaie d'avancer sans client.
    champRechercheId: id('client-search'),
    get client() { return retenu; },
    focus() { $('client-search').focus(); },
    // La base clients relue (un autre poste a pu créer une fiche entre-temps).
    async charger() {
      referentiel = await api('GET', '/api/clients');
      await loadSecteurs();
      peindreSecteurs();
    },
    reset() {
      for (const suffixe of ['perso-nom', 'perso-tel', 'perso-email', 'pro-societe', 'pro-contact',
        'pro-tel', 'pro-email', 'pro-adresse', 'pro-ville', 'pro-cp']) {
        $(suffixe).value = '';
      }
      $('pro-secteur').value = '';
      $('create-box').classList.add('vd-hidden');
      $('create-warning').classList.add('vd-hidden');
      doublonConfirme = null;
      basculerNature('perso');
      oublier();
    },
  };
}
