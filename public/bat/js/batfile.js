// Le PDF exporté EMBARQUE le projet qui l'a produit : le fichier remis au
// client est aussi le fichier de travail. Rouvrir ce PDF dans BAT Studio
// restaure le projet complet (articles, faces, logos posés, grille de
// commande) et permet de le modifier puis de le réexporter.
//
// Pourquoi une pièce jointe PDF plutôt qu'un fichier « .bat » à côté : un BAT
// circule par mail, est archivé par le client, revient six mois plus tard pour
// une réédition. Un fichier compagnon se perd ; une pièce jointe voyage avec
// le document. Les lecteurs PDF ignorent la pièce jointe (le BAT s'imprime et
// se signe comme avant) — seul BAT Studio la lit.
//
// Format : une pièce jointe JSON nommée ATTACHMENT_NAME, contenant le projet
// et les OCTETS des logos (base64) — sans eux, un BAT rouvert sur un autre
// poste n'aurait plus que des cadres vides, les logos étant stockés hors
// projet (data/logos/<hash>.<type>, cf. store.saveLogoFile). pdf-lib
// compresse lui-même le flux (flateStream) : inutile de pré-compresser.

import { PDFLib } from './vendor.js';
import { store, FACE_ORDER, migrateProject } from './store.js';
import { uid, todayISO } from './util.js';

const {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream,
} = PDFLib;

export const ATTACHMENT_NAME = 'BAT-Studio-projet.json';
const PAYLOAD_APP = 'BAT Studio';
const PAYLOAD_KIND = 'projet';
const PAYLOAD_VERSION = 1;

// base64 par tranches : `String.fromCharCode(...u8)` sur un logo de plusieurs
// Mo dépasse la taille maximale d'arguments et lève « Maximum call stack ».
function toBase64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode(...u8.subarray(i, i + CH));
  return btoa(s);
}
function fromBase64(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

// Tous les logos référencés par le projet, dédupliqués (un même logo posé sur
// cinq articles n'est embarqué qu'une fois — il l'est déjà par son hash côté
// stockage).
export async function collectLogoFiles(project) {
  const out = [];
  const seen = new Set();
  for (const a of project.articles || []) {
    for (const key of FACE_ORDER) {
      for (const l of a.faces?.[key]?.logos || []) {
        const type = l.logoType || 'pdf';
        const k = l.logoFile + '.' + type;
        if (!l.logoFile || seen.has(k)) continue;
        seen.add(k);
        // Un logo introuvable (fichier purgé) ne doit pas faire échouer
        // l'export : le BAT sort, le projet rouvert aura ce cadre vide — soit
        // exactement ce que l'écran affiche déjà dans ce cas (cf. logoCanvas).
        let buf = null;
        try { buf = await store.readLogoFile(l.logoFile, type); } catch { buf = null; }
        if (!buf) continue;
        out.push({ hash: l.logoFile, type, data: toBase64(new Uint8Array(buf)) });
      }
    }
  }
  return out;
}

export async function buildProjectPayload(project) {
  return {
    app: PAYLOAD_APP,
    kind: PAYLOAD_KIND,
    v: PAYLOAD_VERSION,
    savedAt: new Date().toISOString(),
    project,
    logos: await collectLogoFiles(project),
  };
}

// Octets de la pièce jointe. Ils ne dépendent PAS de la qualité de rendu : la
// génération les calcule une seule fois et les réutilise à chaque palier
// (relire et encoder les logos cinq fois coûterait plus cher que la
// composition elle-même sur un logo vectoriel d'un mégaoctet).
export async function buildProjectAttachment(project) {
  return new TextEncoder().encode(JSON.stringify(await buildProjectPayload(project)));
}

export async function attachProjectBytes(doc, bytes) {
  await doc.attach(bytes, ATTACHMENT_NAME, {
    mimeType: 'application/json',
    description: 'Projet BAT Studio — rouvrez ce PDF dans BAT Studio pour le modifier.',
    creationDate: new Date(),
    modificationDate: new Date(),
    afRelationship: 'Source',
  });
}

export async function attachProject(doc, project) {
  const bytes = await buildProjectAttachment(project);
  await attachProjectBytes(doc, bytes);
  return bytes.length;
}

// --------------------------------------------------------------- relecture
// L'arbre des noms /EmbeddedFiles peut être une simple feuille (/Names) ou un
// arbre à étages (/Kids) — pdf-lib produit une feuille, un PDF re-enregistré
// par un autre outil peut produire l'autre. On gère les deux.
function* embeddedFileSpecs(node, depth = 0) {
  if (!node || depth > 8) return;
  const kids = node.lookupMaybe?.(PDFName.of('Kids'), PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) yield* embeddedFileSpecs(kids.lookup(i, PDFDict), depth + 1);
    return;
  }
  const arr = node.lookupMaybe?.(PDFName.of('Names'), PDFArray);
  if (!arr) return;
  for (let i = 0; i + 1 < arr.size(); i += 2) {
    const spec = arr.lookup(i + 1, PDFDict);
    if (spec) yield spec;
  }
}

const specName = (spec) => {
  for (const k of ['UF', 'F']) {
    const v = spec.lookup(PDFName.of(k));
    if (v?.decodeText) return v.decodeText();
    if (v?.asString) return v.asString();
  }
  return '';
};

function specBytes(spec) {
  const ef = spec.lookupMaybe?.(PDFName.of('EF'), PDFDict);
  const stream = ef?.lookupMaybe?.(PDFName.of('F'), PDFRawStream);
  if (!stream) return null;
  return decodePDFRawStream(stream).decode();
}

const isOurPayload = (o) => o && typeof o === 'object' && o.app === PAYLOAD_APP && o.kind === PAYLOAD_KIND && o.project;

function payloadFromDoc(doc) {
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const ef = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  if (!ef) return null;

  const specs = [...embeddedFileSpecs(ef)];
  // Notre pièce jointe d'abord (nom exact), puis les autres en repli : un PDF
  // passé par un outil tiers peut avoir renommé le fichier embarqué, mais son
  // contenu reste identifiable (app + kind).
  specs.sort((a, b) => (specName(b) === ATTACHMENT_NAME) - (specName(a) === ATTACHMENT_NAME));
  for (const spec of specs) {
    let obj = null;
    try { obj = JSON.parse(new TextDecoder().decode(specBytes(spec))); } catch { continue; }
    if (isOurPayload(obj)) return obj;
  }
  return null;
}

// Identité d'un BAT **antérieur** au projet embarqué. Ces PDF ne portent aucune
// donnée d'édition, mais ils portent leurs métadonnées, écrites par
// `generateBAT` depuis toujours : producteur « BAT Studio » et titre
// « BAT {client} — {projet} — v{n} ». C'est assez pour RETROUVER le projet qui
// les a produits — lequel, lui, est intact dans les données de l'app.
const TITLE_RE = /^BAT\s+(.*?)\s+—\s+(.*?)\s+—\s+v(\d+)\s*$/;

function identityFromDoc(doc) {
  const title = doc.getTitle() || '';
  const signature = `${doc.getProducer() || ''} ${doc.getCreator() || ''}`;
  const m = title.match(TITLE_RE);
  return {
    // Un BAT des débuts n'a que ces marqueurs pour dire d'où il vient ; sans
    // eux on refuse, plutôt que de proposer d'ouvrir un projet au hasard.
    isOurs: /BAT Studio/i.test(signature) || !!m,
    client: m ? m[1].trim() : '',
    name: m ? m[2].trim() : '',
    version: m ? Number(m[3]) : null,
    title,
    pageCount: doc.getPageCount(),
  };
}

// Une seule lecture du document pour les deux questions : « porte-t-il son
// projet ? » et, sinon, « d'où vient-il ? ». Charger deux fois un PDF de
// plusieurs mégaoctets pour ça serait payer deux fois le même analyseur.
export async function inspectBatPdf(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  return { payload: payloadFromDoc(doc), identity: identityFromDoc(doc) };
}

// Renvoie le projet embarqué dans un PDF, ou null si ce PDF n'en porte pas.
// Ne lève que sur un fichier illisible (PDF corrompu / pas un PDF).
export async function readProjectPayload(pdfBytes) {
  return (await inspectBatPdf(pdfBytes)).payload;
}

// Projets locaux susceptibles d'avoir produit ce BAT. Comparaison souple sur
// client + nom (casse, accents et espaces multiples ignorés — ces champs sont
// saisis à la main : « ACME  Sarl » et « acme sarl » sont le même client).
//
// Un BAT sans client NI nom ne cherche rien : beaucoup de projets sont des
// brouillons sans titre, ils correspondraient tous. Mieux vaut ne rien
// proposer que proposer d'en ouvrir un au hasard.
const softKey = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

export function findSourceProjects({ client, name }) {
  if (!softKey(client) && !softKey(name)) return [];
  const ck = softKey(client), nk = softKey(name);
  return (store.projectsIndex || [])
    .filter(e => softKey(e.client) === ck && softKey(e.name) === nk)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

// Réécrit les logos du projet dans le stockage local. Content-addressed par
// hash : réécrire un logo déjà présent est sans effet de bord.
export async function restoreLogoFiles(payload) {
  let n = 0;
  for (const l of payload.logos || []) {
    if (!l?.hash || !l?.data) continue;
    const u8 = fromBase64(l.data);
    await store.saveLogoFile(l.hash, u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), l.type || 'pdf');
    n++;
  }
  return n;
}

// Importe le projet d'un PDF dans le stockage local et le renvoie prêt à
// ouvrir. `mode` :
//   'new'     — ce poste ne connaît pas ce projet : il entre tel quel, avec son
//               identité et sa version. L'historique du PDF est vidé : il liste
//               des exports archivés sur le poste d'origine, absents d'ici.
//   'replace' — le projet existe déjà : le PDF fait foi (BAT revenu du client),
//               mais l'historique LOCAL des exports est conservé — c'est le
//               seul dont les fichiers sont réellement sur ce poste.
//   'copy'    — le projet existe déjà et le travail local doit survivre :
//               nouveau projet, version suivante, mêmes règles de nommage que
//               le bouton « Dupliquer » pour que deux cartes ne se confondent
//               pas dans la liste.
export async function importProjectFromPayload(payload, { mode = 'new' } = {}) {
  await restoreLogoFiles(payload);
  const project = migrateProject(JSON.parse(JSON.stringify(payload.project)));
  if (!project?.id) throw new Error('Projet illisible dans ce PDF.');

  if (mode === 'replace') {
    const current = await store.loadProject(project.id);
    project.history = current?.history || [];
  } else if (mode === 'copy') {
    project.id = uid();
    const nextVer = (project.fiche?.version ?? 1) + 1;
    const base = String(project.name || '').replace(/\s*\(v\d+\)\s*$/i, '');
    project.name = base ? `${base} (v${nextVer})` : base;
    project.fiche ??= {};
    project.fiche.version = nextVer;
    project.fiche.date = todayISO();
    project.createdAt = new Date().toISOString();
    project.history = [];
  } else {
    project.history = [];
  }
  await store.saveProject(project);
  return project;
}

// Articles dont le vêtement n'existe pas dans le catalogue de CE poste : le
// projet s'ouvre quand même (on peut rechoisir un vêtement), mais le dire tout
// de suite évite un BAT réexporté avec un produit substitué en silence.
export function missingProducts(project) {
  const out = [];
  for (const a of project.articles || []) {
    if (!store.product(a.productId)) out.push(a.productId);
  }
  return [...new Set(out)];
}
