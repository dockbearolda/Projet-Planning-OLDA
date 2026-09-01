'use strict';

// ===========================================================================
// L'IMPORT DE PRIX — ON LIT TOUT, ON DIT TOUT, PUIS SEULEMENT ON ÉCRIT
// ===========================================================================
// Le catalogue vit en base (table `catalogue_produits`). Ce module est la porte
// par laquelle les prix du patron y entrent : un fichier CSV exporté d'Excel
// par « Enregistrer sous ».
//
// POURQUOI DU CSV ET PAS DU .XLSX. Le dépôt n'a que trois dépendances (express,
// pg, compression). Lire un .xlsx natif, c'est un ZIP + du XML + les chaînes
// partagées + la table des styles pour savoir si « 35 » est un prix ou une
// date : une dépendance de plus, et une de celles qui se mettent à jour. Le CSV
// se lit en soixante lignes, ici, sans rien ajouter.
//
// RIEN NE S'ÉCRIT SUR UN IMPORT À MOITIÉ LU. Le fichier est analysé EN ENTIER
// avant qu'une seule ligne ne parte en base : un guillemet non refermé, une
// colonne obligatoire absente, et c'est le FICHIER qui est refusé — pas ses
// quatre-vingts premières lignes acceptées et le reste perdu. C'est aussi
// pourquoi l'écriture réclame la SIGNATURE de l'aperçu : on n'écrit que ce
// qu'on a montré.
//
// CE QUI EST REFUSÉ EST NOMMÉ. Un import qui dit « 42 lignes ignorées » sans
// dire lesquelles ni pourquoi oblige à rouvrir le tableur et à deviner. Chaque
// refus porte son numéro de ligne et sa raison, en clair.

const crypto = require('node:crypto');

// Au-delà, ce n'est plus un tarif : c'est un fichier envoyé par erreur. La
// borne protège la mémoire du serveur ET dit quelque chose de juste au patron.
const MAX_LIGNES = 5000;

// --- Lecture du CSV ---------------------------------------------------------

// Le séparateur d'Excel dépend de la langue du poste : « ; » en français,
// « , » en anglais, et la tabulation quand on colle depuis une autre feuille.
// On ne le demande pas — on le DEVINE sur la première ligne, celle des
// intitulés, en prenant celui qui la découpe en le plus de colonnes.
function separateur(premiereLigne) {
  let meilleur = ';';
  let colonnes = 0;
  for (const sep of [';', ',', '\t', '|']) {
    const n = decouper(premiereLigne, sep).length;
    if (n > colonnes) { colonnes = n; meilleur = sep; }
  }
  return meilleur;
}

// Découpe UNE ligne déjà isolée (sert seulement à jauger le séparateur).
function decouper(ligne, sep) {
  const out = [];
  let champ = '';
  let dansGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (dansGuillemets) {
      if (c === '"' && ligne[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') dansGuillemets = false;
      else champ += c;
    } else if (c === '"') dansGuillemets = true;
    else if (c === sep) { out.push(champ); champ = ''; } else champ += c;
  }
  out.push(champ);
  return out;
}

// LE FICHIER ENTIER, d'un coup. Un champ entre guillemets peut contenir le
// séparateur ET des sauts de ligne (une désignation sur deux lignes) : découper
// d'abord par `\n` puis par `;` casserait ces champs-là en silence.
//
// Rend `{ erreur }` si le fichier est coupé — c'est le cas qui doit refuser
// l'import en entier, pas ligne par ligne.
function lireCsv(texte) {
  // Le BOM d'Excel : trois octets invisibles collés au premier intitulé, qui
  // font que « Category » ne s'appelle plus « Category ».
  let src = String(texte == null ? '' : texte).replace(/^﻿/, '');
  src = src.replace(/\r\n?/g, '\n');
  if (!src.trim()) return { erreur: 'Fichier vide.' };

  const finPremiere = src.indexOf('\n');
  const sep = separateur(finPremiere === -1 ? src : src.slice(0, finPremiere));

  const lignes = [];
  let cases = [];
  let champ = '';
  let dansGuillemets = false;
  let vide = true;         // la ligne en cours n'a encore rien reçu
  const finirChamp = () => { cases.push(champ); champ = ''; };
  const finirLigne = () => { finirChamp(); lignes.push(cases); cases = []; vide = true; };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (dansGuillemets) {
      if (c === '"' && src[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') dansGuillemets = false;
      else champ += c;
      continue;
    }
    if (c === '"' && vide && champ === '') { dansGuillemets = true; vide = false; continue; }
    if (c === '"') { dansGuillemets = true; continue; }
    if (c === sep) { finirChamp(); vide = false; continue; }
    if (c === '\n') { finirLigne(); continue; }
    champ += c;
    vide = false;
  }
  if (dansGuillemets) {
    return {
      erreur: 'Guillemet jamais refermé : le fichier est incomplet ou tronqué. '
        + 'Rien n’a été lu au-delà — et rien ne sera écrit.',
    };
  }
  if (!vide || champ !== '') finirLigne();

  // Une dernière ligne toute vide (le fichier finit par un saut de ligne) n'est
  // pas une ligne : elle serait comptée comme « refusée » sans rien vouloir dire.
  while (lignes.length && lignes[lignes.length - 1].every((v) => !v.trim())) lignes.pop();
  if (!lignes.length) return { erreur: 'Fichier vide.' };
  return { sep, lignes };
}

// --- Les colonnes -----------------------------------------------------------

// Un intitulé se reconnaît quelle que soit sa casse, ses accents et sa
// ponctuation : « Prix d'achat », « PRIX D ACHAT » et « prix dachat » sont le
// même mot. C'est le patron qui écrit ces intitulés, pas un format.
function reduire(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Les noms acceptés pour chaque colonne. Ceux de SUMUP (« Category », « Item
// name », « Price ») sont dedans : c'est le fichier que le patron exporte, il
// ne doit pas avoir à renommer trois colonnes avant chaque import.
const COLONNES = [
  ['famille', ['famille', 'familles', 'category', 'categorie', 'categories', 'rayon']],
  ['designation', ['designation', 'item name', 'item', 'produit', 'article', 'nom', 'libelle', 'name']],
  ['variante', ['variante', 'variantes', 'variation', 'variations', 'declinaison', 'option', 'options']],
  ['reference', ['reference', 'ref', 'sku', 'code', 'code article']],
  ['prixAchat', ['prix achat', 'prix d achat', 'achat', 'cout d achat', 'cout achat', 'purchase price', 'cost']],
  ['prixVenteTtc', ['prix vente ttc', 'prix de vente ttc', 'prix de vente', 'prix vente', 'prix ttc', 'prix', 'price', 'vente', 'tarif', 'pv ttc']],
  ['tempsMoMin', ['temps mo', 'temps mo min', 'temps main d oeuvre', 'main d oeuvre', 'mo', 'temps mo mn']],
  ['tempsMachineMin', ['temps machine', 'temps machine min', 'machine', 'temps machine mn']],
  ['actif', ['actif', 'active', 'en rayon', 'visible']],
];

// Les colonnes qui portent une VALEUR à importer. Un fichier qui n'en a aucune
// (juste famille + désignation) ne transporte aucun prix : le dire tout de
// suite vaut mieux que d'annoncer « 82 lignes inchangées ».
const COLONNES_VALEUR = ['reference', 'prixAchat', 'prixVenteTtc', 'tempsMoMin', 'tempsMachineMin', 'actif'];

function reconnaitreEntetes(brut) {
  const par = {};
  const inconnues = [];
  brut.forEach((titre, i) => {
    const cle = reduire(titre);
    if (!cle) return;
    const trouve = COLONNES.find(([, alias]) => alias.includes(cle));
    if (!trouve) { inconnues.push(String(titre).trim()); return; }
    // Deux colonnes du même sens : la PREMIÈRE gagne. La seconde serait une
    // deuxième vérité sur la même case, et rien ne dirait laquelle a servi.
    if (!(trouve[0] in par)) par[trouve[0]] = i;
    else inconnues.push(String(titre).trim());
  });
  return { par, inconnues };
}

// --- Les valeurs ------------------------------------------------------------

// Un nombre écrit à la main, en français, dans un tableur : « 1 234,56 »,
// « 12,50 € », « 12.50 », « 1,234.56 ». On accepte tout ça, et on REFUSE le
// reste — un prix qu'on n'a pas su lire ne doit surtout pas valoir zéro.
function nombre(brut) {
  const s = String(brut == null ? '' : brut).trim();
  if (!s) return { vide: true };
  let n = s.replace(/[\s  ]/g, '').replace(/[€$£]/g, '');
  const virgule = n.lastIndexOf(',');
  const point = n.lastIndexOf('.');
  if (virgule >= 0 && point >= 0) {
    // Le SÉPARATEUR DÉCIMAL est le dernier des deux ; l'autre groupe les
    // milliers. « 1.234,56 » et « 1,234.56 » veulent dire la même chose.
    if (virgule > point) n = n.replace(/\./g, '').replace(',', '.');
    else n = n.replace(/,/g, '');
  } else if (virgule >= 0) n = n.replace(',', '.');
  const v = Number(n);
  if (!Number.isFinite(v)) return { erreur: true };
  return { valeur: v };
}

const OUI = new Set(['1', 'oui', 'o', 'vrai', 'true', 'x', 'yes', 'actif']);
const NON = new Set(['0', 'non', 'n', 'faux', 'false', 'no', 'inactif']);

function booleen(brut) {
  const s = reduire(brut);
  if (!s) return { vide: true };
  if (OUI.has(s)) return { valeur: true };
  if (NON.has(s)) return { valeur: false };
  return { erreur: true };
}

// LA CLÉ D'UN PRODUIT : sa famille, sa désignation, sa variante — réduites.
// « Art de la Table » et « Art de la table » sont le même rayon ; le patron ne
// tape pas deux fois la même majuscule, et ce n'est pas à lui de le faire.
function cleProduit(famille, designation, variante) {
  return [reduire(famille), reduire(designation), reduire(variante)].join('');
}

// --- LES RÈGLES D'IMPORT ----------------------------------------------------
//
// L'export SumUp ne nomme JAMAIS les variantes — il répète la ligne du produit
// une fois par variante, la première sans prix — et ses rayons ne sont pas ceux
// du comptoir. Ces deux écarts se comblent par des DONNÉES
// (`catalogue-import-regles.json`), pas par du code : un rayon qui change ne
// doit pas demander un déploiement.
//
// UNE RÈGLE QUI AGIT EN SILENCE EST UNE RÈGLE QU'ON NE RELIT JAMAIS. Chaque
// ligne du rapport dit donc ce qu'on lui a fait : le rayon d'où elle vient
// (`rangeDepuis`) et le nom qu'on a posé sur sa variante (`varianteNommee`).
function preparerRegles(brut) {
  const r = brut && typeof brut === 'object' ? brut : {};
  // UN ÉCART PORTE SUR UN RAYON, OU SUR UN SEUL PRODUIT. Le second cas est
  // arrivé avec les tasses : la famille entière n'est pas à écarter, mais les
  // trois que la GRILLE DE CHIFFRAGE tarife déjà, si — leur prix de vente s'y
  // calcule, et l'importer une seconde fois ferait deux sources pour un même
  // nombre. C'est le second qu'on oublie de corriger.
  const ecartes = new Map();
  for (const e of Array.isArray(r.ecartes) ? r.ecartes : []) {
    if (!e || !e.famille) continue;
    const cle = e.designation
      ? `${reduire(e.famille)}\u0001${reduire(e.designation)}`
      : reduire(e.famille);
    ecartes.set(cle, String(e.pourquoi || 'rayon écarté'));
  }
  const familles = new Map();
  for (const f of Array.isArray(r.familles) ? r.familles : []) {
    if (f && f.de && f.vers) familles.set(reduire(f.de), String(f.vers));
  }
  // La clé porte le PRIX : c'est le seul repère que l'export laisse pour
  // distinguer deux lignes d'un même produit.
  const variantes = new Map();
  for (const v of Array.isArray(r.variantes) ? r.variantes : []) {
    if (!v || !v.famille || !v.designation || v.variante == null) continue;
    variantes.set(`${reduire(v.famille)}\u0001${reduire(v.designation)}\u0001${Number(v.prix)}`,
      String(v.variante));
  }
  return { ecartes, familles, variantes, actives: ecartes.size + familles.size + variantes.size };
}

// --- L'analyse --------------------------------------------------------------

const CHAMPS_NUM = [
  ['prixAchat', 'prix d’achat'],
  ['prixVenteTtc', 'prix de vente TTC'],
  ['tempsMoMin', 'temps de main-d’œuvre'],
  ['tempsMachineMin', 'temps machine'],
];

// Deux valeurs sont d'accord si l'une des deux ne dit rien. C'est ce qui rend
// le fichier SumUp importable tel quel : il répète la ligne du produit une fois
// par variante, la première sans prix, les suivantes avec le MÊME prix.
const dAccord = (a, b) => a == null || b == null || a === b;

// Ce qu'on retient d'une ligne du fichier, une fois lue.
function lireLigne(cases, par) {
  const brut = (champ) => (par[champ] === undefined ? '' : String(cases[par[champ]] == null ? '' : cases[par[champ]]).trim());
  const ligne = {
    famille: brut('famille'),
    designation: brut('designation'),
    variante: brut('variante'),
    reference: par.reference === undefined ? null : brut('reference'),
    refus: [],
  };
  for (const [champ, nom] of CHAMPS_NUM) {
    if (par[champ] === undefined) { ligne[champ] = null; continue; }
    const lu = nombre(brut(champ));
    if (lu.vide) { ligne[champ] = null; continue; }
    if (lu.erreur) { ligne[champ] = null; ligne.refus.push(`${nom} illisible : « ${brut(champ)} »`); continue; }
    if (lu.valeur < 0) { ligne[champ] = null; ligne.refus.push(`${nom} négatif : « ${brut(champ)} »`); continue; }
    ligne[champ] = champ.startsWith('temps')
      ? Math.round(lu.valeur * 10) / 10
      : Math.round(lu.valeur * 100) / 100;
  }
  if (par.actif === undefined) ligne.actif = null;
  else {
    const lu = booleen(brut('actif'));
    if (lu.vide) ligne.actif = null;
    else if (lu.erreur) { ligne.actif = null; ligne.refus.push(`« actif » incompréhensible : « ${brut('actif')} »`); } else ligne.actif = lu.valeur;
  }
  return ligne;
}

const CHAMPS_IMPORTES = ['reference', 'prixAchat', 'prixVenteTtc', 'tempsMoMin', 'tempsMachineMin', 'actif'];

// `existants` : les lignes déjà en base, forme
//   { id, famille, designation, variante, reference, prixAchat, prixVenteTtc,
//     tempsMoMin, tempsMachineMin, actif }
//
// Rend le RAPPORT complet — c'est lui que l'écran montre avant d'écrire, et
// c'est lui que l'écriture rejoue. Il ne touche à rien.
function analyserImport(texte, existants, reglesBrutes) {
  const regles = preparerRegles(reglesBrutes);
  const lu = lireCsv(texte);
  if (lu.erreur) return { erreur: lu.erreur };

  const [entetes, ...corps] = lu.lignes;
  const { par, inconnues } = reconnaitreEntetes(entetes);
  const manquantes = [];
  if (par.famille === undefined) manquantes.push('Famille (ou « Category »)');
  if (par.designation === undefined) manquantes.push('Désignation (ou « Item name »)');
  if (manquantes.length) {
    return {
      erreur: `Colonne${manquantes.length > 1 ? 's' : ''} obligatoire${manquantes.length > 1 ? 's' : ''} `
        + `absente${manquantes.length > 1 ? 's' : ''} : ${manquantes.join(', ')}. `
        + `La première ligne du fichier doit porter les intitulés. Lue : « ${entetes.join(' | ')} ».`,
    };
  }
  if (!COLONNES_VALEUR.some((c) => par[c] !== undefined)) {
    return {
      erreur: 'Aucune colonne de prix, de temps, de référence ni d’état : ce fichier '
        + 'ne transporte rien à importer. Attendu au moins « Prix » (ou « Price »).',
    };
  }
  if (corps.length > MAX_LIGNES) {
    return { erreur: `${corps.length} lignes : au-delà de ${MAX_LIGNES}, ce n’est plus un tarif. Rien n’a été lu.` };
  }

  // 1er passage : lire chaque ligne, la ranger sous sa clé.
  const paquets = new Map();
  const lignes = [];
  corps.forEach((cases, i) => {
    const numero = i + 2;                       // 1 = les intitulés, à l'œil du patron
    const l = lireLigne(cases, par);
    l.numero = numero;
    if (!l.famille) l.refus.push('famille vide');
    if (!l.designation) l.refus.push('désignation vide');
    lignes.push(l);
    if (l.refus.length) return;

    // LES RÈGLES, DANS CET ORDRE — et elles se lisent toutes sur le rayon
    // D'ORIGINE, celui que le patron a sous les yeux dans son tableur.
    //
    // 1. LE RAYON ÉCARTÉ. Ce n'est pas un refus : c'est une décision, et elle
    //    se compte à part. Confondre les deux ferait lire « 55 refusées » là où
    //    il y a des erreurs ET des exclusions voulues.
    const cleFamille = reduire(l.famille);
    // Le PRODUIT d'abord, le rayon ensuite : une règle plus précise l'emporte.
    const ecart = regles.ecartes.get(`${cleFamille}\u0001${reduire(l.designation)}`)
      || regles.ecartes.get(cleFamille);
    if (ecart) { l.ecarte = ecart; return; }

    // 2. LE NOM DE LA VARIANTE, retrouvé par son prix — le seul repère que
    //    l'export laisse. Une variante déjà nommée dans le fichier gagne
    //    toujours : la colonne du patron passe avant la règle.
    if (!l.variante && l.prixVenteTtc != null) {
      const nom = regles.variantes.get(
        `${cleFamille}\u0001${reduire(l.designation)}\u0001${l.prixVenteTtc}`,
      );
      if (nom) { l.variante = nom; l.varianteNommee = true; }
    }

    // 3. LE RAYON DU COMPTOIR. En dernier : les deux règles au-dessus se
    //    lisent sur le rayon d'origine.
    const versFamille = regles.familles.get(cleFamille);
    if (versFamille && versFamille !== l.famille) {
      l.rangeDepuis = l.famille;
      l.famille = versFamille;
    }

    l.produit = `${reduire(l.famille)}\u0001${reduire(l.designation)}`;
  });

  // 1er passage bis : NOMMER UNE VARIANTE COUPE LE PRODUIT EN DEUX.
  //
  // Tant qu'aucune ligne n'était nommée, les lignes d'un même produit se
  // fondaient toutes ensemble — y compris la ligne « parente » de SumUp, celle
  // qui ouvre le produit SANS prix. Dès qu'une règle nomme les lignes tarifées,
  // la parente reste seule de son côté : elle fabriquait un PRODUIT FANTÔME,
  // sans variante et sans prix, posé au menu à côté de ses propres variantes.
  //
  // Deux corrections, et chacune se DIT dans le rapport :
  //   · la parente sans aucune valeur est ABSORBÉE par son produit ;
  //   · une ligne qui porte un PRIX mais qu'aucune règle n'a su nommer, alors
  //     que ses sœurs l'ont été, est REFUSÉE — elle entrerait au menu comme un
  //     « Porte-clés » nu à côté d'un « Porte-clés — Classique », et personne ne
  //     saurait lequel prendre.
  const nommes = new Set();
  const parProduit = new Map();
  for (const l of lignes) {
    if (!l.produit || l.refus.length || l.ecarte) continue;
    if (l.varianteNommee) nommes.add(l.produit);
    parProduit.set(l.produit, (parProduit.get(l.produit) || 0) + 1);
  }
  for (const l of lignes) {
    if (!l.produit || l.refus.length || l.ecarte) continue;
    const muette = !l.variante && CHAMPS_IMPORTES.every((c) => l[c] == null || l[c] === '');
    if (muette && parProduit.get(l.produit) > 1) {
      l.absorbee = 'ligne d’ouverture du produit (aucune valeur) : fondue dans ses variantes';
      continue;
    }
    if (!l.variante && nommes.has(l.produit) && l.prixVenteTtc != null) {
      l.refus.push(`variante inconnue pour ${l.prixVenteTtc} € — les autres lignes de `
        + `« ${l.designation} » ont été nommées, pas celle-ci. Ajoute sa règle dans `
        + 'catalogue-import-regles.json, ou une colonne « Variante » au fichier.');
      continue;
    }
    l.cle = cleProduit(l.famille, l.designation, l.variante);
    if (!paquets.has(l.cle)) paquets.set(l.cle, []);
    paquets.get(l.cle).push(l);
  }

  // 2e passage : les lignes qui parlent du MÊME produit.
  //
  // Elles se fondent en une seule tant qu'elles sont D'ACCORD — le fichier
  // SumUp répète le produit une fois par variante, la première sans prix. Dès
  // qu'elles se contredisent, AUCUNE n'est retenue : le fichier ne dit pas
  // laquelle a raison, et le deviner poserait un prix faux en rayon.
  const fusions = new Map();
  for (const [cle, groupe] of paquets) {
    const fusion = { cle, numeros: groupe.map((l) => l.numero) };
    for (const champ of ['famille', 'designation', 'variante']) fusion[champ] = groupe[0][champ];
    let conflit = null;
    for (const champ of CHAMPS_IMPORTES) {
      let valeur = null;
      for (const l of groupe) {
        if (l[champ] == null || l[champ] === '') continue;
        if (!dAccord(valeur, l[champ])) { conflit = { champ, a: valeur, b: l[champ] }; break; }
        valeur = l[champ];
      }
      if (conflit) break;
      fusion[champ] = valeur;
    }
    // DEUX VARIANTES AU MÊME PRIX SONT INDISTINGUABLES. Le Magnet a QUATRE
    // lignes tarifées pour TROIS prix : les deux à 7 € se fondent forcément en
    // une. Aucune règle ne peut inventer ce que le fichier ne porte pas — mais
    // se taire ferait disparaître une variante sans que personne ne le voie.
    if (!conflit && groupe.length > 1) fusion.fondues = groupe.length;
    if (conflit) {
      const nom = (CHAMPS_NUM.find(([c]) => c === conflit.champ) || [null, conflit.champ])[1];
      const raison = `« ${groupe[0].famille} / ${groupe[0].designation}${groupe[0].variante ? ` / ${groupe[0].variante}` : ''} » `
        + `apparaît ${groupe.length} fois avec des ${nom} différents (${conflit.a} et ${conflit.b}). `
        + 'Ajoute une colonne « Variante » pour les distinguer — aucune de ces lignes n’est importée.';
      for (const l of groupe) l.refus.push(raison);
      continue;
    }
    fusions.set(cle, fusion);
  }

  // 3e passage : comparer à la base.
  const enBase = new Map();
  for (const p of Array.isArray(existants) ? existants : []) {
    enBase.set(cleProduit(p.famille, p.designation, p.variante), p);
  }

  const creations = [];
  const majs = [];
  const inchangees = [];
  for (const fusion of fusions.values()) {
    const deja = enBase.get(fusion.cle);
    if (!deja) {
      creations.push(fusion);
      for (const l of lignes) if (l.cle === fusion.cle && !l.refus.length) l.action = 'creation';
      continue;
    }
    const changements = [];
    for (const champ of CHAMPS_IMPORTES) {
      const neuf = fusion[champ];
      if (neuf == null || neuf === '') continue;      // le fichier ne dit rien : on ne touche pas
      const ancien = deja[champ] == null ? null : deja[champ];
      if (ancien === neuf) continue;
      changements.push({ champ, avant: ancien, apres: neuf });
    }
    if (!changements.length) {
      inchangees.push(fusion);
      for (const l of lignes) if (l.cle === fusion.cle && !l.refus.length) l.action = 'inchangee';
      continue;
    }
    majs.push({ ...fusion, id: deja.id, changements });
    for (const l of lignes) if (l.cle === fusion.cle && !l.refus.length) l.action = 'maj';
  }

  const refusees = lignes.filter((l) => l.refus.length);
  for (const l of refusees) l.action = 'refus';
  const ecartees = lignes.filter((l) => l.ecarte || l.absorbee);
  for (const l of ecartees) l.action = 'ecartee';

  const plan = {
    creations: creations.map((f) => extraire(f)),
    majs: majs.map((f) => ({ id: f.id, ...extraire(f), changements: f.changements })),
  };

  return {
    resume: {
      lues: corps.length,
      creees: creations.length,
      majs: majs.length,
      inchangees: inchangees.length,
      refusees: refusees.length,
      ecartees: ecartees.length,
    },
    regles: regles.actives,
    colonnes: Object.keys(par),
    inconnues,
    separateur: lu.sep === '\t' ? 'tabulation' : lu.sep,
    lignes: lignes.map((l) => ({
      numero: l.numero,
      action: l.action || 'refus',
      famille: l.famille,
      designation: l.designation,
      variante: l.variante,
      prixVenteTtc: l.prixVenteTtc,
      prixAchat: l.prixAchat,
      refus: l.refus,
      // CE QU'UNE RÈGLE A FAIT À CETTE LIGNE. Une règle qui agit en silence est
      // une règle qu'on ne relit jamais — et celle-ci déplace un produit de
      // rayon ou lui pose un nom de variante.
      ecarte: l.ecarte || l.absorbee || null,
      rangeDepuis: l.rangeDepuis || null,
      varianteNommee: !!l.varianteNommee,
      // Combien de lignes du fichier ce produit a-t-il avalées (leur prix étant
      // le même, ou muet). C'est ce chiffre qui dit qu'une variante a disparu.
      fondues: (fusions.get(l.cle) || {}).fondues || 0,
      changements: (majs.find((m) => m.cle === l.cle) || {}).changements || [],
    })),
    plan,
    signature: signer(plan),
  };
}

function extraire(f) {
  const out = { famille: f.famille, designation: f.designation, variante: f.variante };
  for (const champ of CHAMPS_IMPORTES) out[champ] = f[champ] == null ? null : f[champ];
  return out;
}

// LA SIGNATURE DE L'APERÇU. L'écriture la renvoie ; si elle ne correspond plus,
// c'est que le fichier ou la base ont bougé entre l'aperçu et le clic — et on
// n'écrit pas ce que le patron n'a pas vu.
function signer(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 16);
}

module.exports = { analyserImport, lireCsv, cleProduit, reduire, nombre, signer, preparerRegles, MAX_LIGNES };
