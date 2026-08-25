// ===========================================================================
// LE BRIEFING DU MATIN — ce que l'écran a compris avant qu'on le lise
// ===========================================================================
// `priority.js` répond à « sur quoi passer en premier ? ». Ce module-ci répond
// à la question d'avant, celle qu'on se pose à 8 h devant le planning : « qu'est-ce
// qui ne va pas se passer tout seul aujourd'hui ? »
//
// La différence tient en un mot : un CLASSEMENT ordonne ce qu'on lui donne, un
// BRIEFING dit ce qu'on n'aurait pas vu. Une commande en retard se voit dans
// une file triée ; une commande qui n'est PAS encore en retard mais qui ne
// passera pas — parce qu'elle est due demain et encore au chiffrage — ne se
// voit nulle part. C'est exactement le genre de chose qu'on découvre à midi.
//
// FONCTION PURE : ni DOM, ni horloge implicite (`now` est injecté), ni réseau.
// Tout est calculé sur le poste, hors ligne compris — aucune dépendance à un
// service tiers, c'est la règle du dépôt. Chaque phrase produite est
// EXPLICABLE : elle nomme les dossiers qui la fondent, et un clic les affiche.

import { WAITING_SUBS, machineOf, daysUntil, ageDays } from './priority.js';

// --- Ce qu'il faut de jours pour sortir une commande depuis une position ----
// Estimation d'atelier, volontairement grossière et LISIBLE : c'est le seul
// endroit à corriger si le patron trouve le signal trop bavard ou trop timide.
// Une sous-étape non listée retombe sur sa famille.
export const JOURS_POUR_SORTIR = {
  a_trier: 6,
  demande_chiffrage: 5,
  preparation: 3,
  production: 1,
  facturation: 0,
  // Les positions qui s'écartent nettement de leur famille.
  devis_valide: 4,
  a_commander: 4,
  attente_marchandise: 4,      // on attend une livraison : ça ne s'accélère pas
  prepa_produits: 3,
  prepa_bat: 3,
  bat_valide: 2,
  validation_acompte: 2,
  pret_a_produire: 1,
  montage_finition: 1,
  controle_emballage: 0,
  facturation_a_faire: 0,
  client_a_prevenir: 0,
};

// Au-delà de ce délai sans mouvement, une balle laissée au client se relance.
// Un devis dort plus longtemps qu'un BAT : le client n'a pas encore engagé.
export const DELAI_RELANCE = { devis_envoye: 7, bat_envoye: 3, client_prevenu: 5 };

// Écart de charge à partir duquel on propose un transfert. En dessous, deux
// files inégales ne sont qu'un hasard de la semaine, pas un déséquilibre.
export const ECART_CHARGE = 4;

const pluriel = (n, mot, pl) => `${n} ${n > 1 ? (pl || mot + 's') : mot}`;

// Combien de jours il faut à CETTE commande pour sortir, depuis là où elle est.
export function joursPourSortir(r) {
  const parSub = r && r.sub_stage && JOURS_POUR_SORTIR[r.sub_stage];
  if (Number.isFinite(parSub)) return parSub;
  const parFam = r && JOURS_POUR_SORTIR[r.stage];
  return Number.isFinite(parFam) ? parFam : 0;
}

// Deux motifs de blocage disent-ils la même chose ? On compare des mots, pas
// des chaînes : « PVC blanc en rupture » et « rupture de PVC blanc chez le
// fournisseur » sont le même appel à passer.
const motsDe = (t) => new Set(String(t || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .split(/[^a-z0-9]+/)
  .filter((m) => m.length > 3));
export function memeMotif(a, b) {
  const A = motsDe(a);
  const B = motsDe(b);
  if (!A.size || !B.size) return false;
  let communs = 0;
  for (const m of A) if (B.has(m)) communs++;
  return communs >= 2 && communs >= Math.min(A.size, B.size) * 0.5;
}

// ===========================================================================
// LE BRIEFING
// ===========================================================================
// `ctx` porte ce que le dashboard sait déjà faire, plutôt que de le refaire :
//   now, machines, employees, pilotDe(r), referentsDe(r), nomClient(r),
//   articleDe(r), labelEtape(r), estActif(r), qui (la personne au poste, ou null)
//
// Rend une liste ORDONNÉE d'observations :
//   { cle, ton: 'urgent'|'attention'|'calme', titre, detail, ids }
// `ids` fonde la phrase : un clic n'affiche que ces dossiers-là. Une
// observation sans `ids` ne se clique pas.
export function briefing(rows, ctx) {
  const o = ctx || {};
  const now = o.now;
  const actifs = (rows || []).filter((r) => r && (!o.estActif || o.estActif(r)));
  const nom = o.nomClient || ((r) => r.billing_company || 'Sans nom');
  const etape = o.labelEtape || ((r) => r.sub_stage || r.stage);
  const jours = (r) => daysUntil(r.deadline, now);

  const bloque = (r) => r.flag === 'bloque';
  const attenteClient = (r) => WAITING_SUBS.has(r.sub_stage);
  // « À nous » : la balle est dans notre camp. Un devis parti n'est pas notre
  // retard, et un dossier bloqué a son propre paragraphe.
  const aNous = (r) => !bloque(r) && !attenteClient(r);

  const out = [];

  // -- 1. Ce qui doit sortir aujourd'hui --------------------------------------
  const brulent = actifs.filter((r) => {
    if (!aNous(r)) return false;
    const d = jours(r);
    return d !== null && d <= 0;
  }).sort((a, b) => (jours(a) ?? 0) - (jours(b) ?? 0));
  if (brulent.length) {
    const pire = brulent[0];
    const retard = -(jours(pire) ?? 0);
    out.push({
      cle: 'brulent',
      ton: 'urgent',
      titre: `${pluriel(brulent.length, 'commande')} à sortir aujourd’hui ou déjà en retard`,
      detail: retard > 0
        ? `La plus ancienne : ${nom(pire)}, ${pluriel(retard, 'jour')} de retard, à « ${etape(pire)} ».`
        : `Dont ${nom(pire)}, due aujourd’hui, à « ${etape(pire)} ».`,
      ids: brulent.map((r) => r.id),
    });
  }

  // -- 2. Ce qui NE PASSERA PAS ----------------------------------------------
  // Le signal qu'aucune file triée ne donne : la commande n'est pas encore en
  // retard, elle le sera. Elle est due dans N jours et il en faut M pour la
  // sortir depuis là où elle est. On ne compte QUE les dossiers pas encore en
  // retard — les autres sont déjà dans le paragraphe du dessus.
  const glissent = actifs.filter((r) => {
    if (!aNous(r)) return false;
    const d = jours(r);
    return d !== null && d > 0 && d < joursPourSortir(r);
  }).sort((a, b) => (jours(a) ?? 0) - (jours(b) ?? 0));
  if (glissent.length) {
    const p = glissent[0];
    const d = jours(p);
    out.push({
      cle: 'glissent',
      ton: 'urgent',
      titre: `${pluriel(glissent.length, 'commande')} `
        + `ne ${glissent.length > 1 ? 'passeront' : 'passera'} pas dans les temps`,
      detail: `${nom(p)} est due ${d === 1 ? 'demain' : `dans ${pluriel(d, 'jour')}`} et se trouve `
        + `encore à « ${etape(p)} » — il faut compter ${pluriel(joursPourSortir(p), 'jour')} depuis là.`,
      ids: glissent.map((r) => r.id),
    });
  }

  // -- 3. Les blocages, et ce qu'un seul appel débloque -----------------------
  const bloques = actifs.filter(bloque)
    .sort((a, b) => ageDays(b.updated_at, now) - ageDays(a.updated_at, now));
  if (bloques.length) {
    const tete = bloques[0];
    // Combien partagent le motif du plus ancien ? Un appel les lève tous.
    const memeCause = bloques.filter((r) => r === tete || memeMotif(r.flag_reason, tete.flag_reason));
    const age = ageDays(tete.updated_at, now);
    out.push({
      cle: 'bloques',
      ton: 'urgent',
      titre: `${pluriel(bloques.length, 'commande bloquée', 'commandes bloquées')}`,
      detail: memeCause.length > 1
        ? `${memeCause.length} tiennent au même motif — « ${tete.flag_reason || 'sans motif précisé'} ». `
          + 'Un seul appel les débloque toutes.'
        : `${nom(tete)}, ${age > 0 ? `figée depuis ${pluriel(age, 'jour')}` : 'bloquée aujourd’hui'} : `
          + `« ${tete.flag_reason || 'sans motif précisé'} ».`,
      ids: bloques.map((r) => r.id),
    });
  }

  // -- 4. Les relances à passer ----------------------------------------------
  const aRelancer = actifs.filter((r) => {
    if (!attenteClient(r)) return false;
    const seuil = DELAI_RELANCE[r.sub_stage];
    return Number.isFinite(seuil) && ageDays(r.updated_at, now) >= seuil;
  }).sort((a, b) => ageDays(b.updated_at, now) - ageDays(a.updated_at, now));
  if (aRelancer.length) {
    const parType = {};
    for (const r of aRelancer) parType[r.sub_stage] = (parType[r.sub_stage] || 0) + 1;
    const morceaux = [];
    if (parType.devis_envoye) morceaux.push(`${pluriel(parType.devis_envoye, 'devis', 'devis')} sans réponse`);
    if (parType.bat_envoye) morceaux.push(`${pluriel(parType.bat_envoye, 'BAT', 'BAT')} à valider`);
    if (parType.client_prevenu) morceaux.push(`${pluriel(parType.client_prevenu, 'commande prête', 'commandes prêtes')} à retirer`);
    const tete = aRelancer[0];
    out.push({
      cle: 'relances',
      ton: 'attention',
      titre: `${pluriel(aRelancer.length, 'relance')} à passer`,
      detail: `${morceaux.join(', ')}. La plus ancienne : ${nom(tete)}, `
        + `sans mouvement depuis ${pluriel(ageDays(tete.updated_at, now), 'jour')}.`,
      ids: aRelancer.map((r) => r.id),
    });
  }

  // -- 5. Le déséquilibre de charge, et un transfert possible ----------------
  const employes = o.employees || [];
  const pilotDe = o.pilotDe || ((r) => r.responsable || null);
  const referentsDe = o.referentsDe || ((r) => (r.referent ? [r.referent] : []));
  if (employes.length > 1) {
    const files = new Map(employes.map((w) => [w, []]));
    for (const r of actifs) {
      const vus = new Set();
      for (const w of [pilotDe(r), ...referentsDe(r)]) {
        if (w && files.has(w) && !vus.has(w)) { vus.add(w); files.get(w).push(r); }
      }
    }
    const charges = employes.map((w) => ({ w, n: files.get(w).length }))
      .sort((a, b) => b.n - a.n);
    const plus = charges[0];
    const moins = charges[charges.length - 1];
    if (plus.n - moins.n >= ECART_CHARGE) {
      // Un transfert CRÉDIBLE : un dossier du plus chargé que le moins chargé
      // suit déjà en référent — il connaît le dossier, il ne le découvre pas.
      const candidat = files.get(plus.w)
        .filter((r) => aNous(r) && referentsDe(r).includes(moins.w))
        .sort((a, b) => (jours(a) ?? 99) - (jours(b) ?? 99))[0];
      out.push({
        cle: 'charge',
        ton: 'attention',
        titre: `${plus.w} porte ${plus.n} dossiers, ${moins.w} en porte ${moins.n}`,
        detail: candidat
          ? `${nom(candidat)} (« ${etape(candidat)} ») pourrait passer à ${moins.w}, `
            + 'qui la suit déjà en référent.'
          : `Aucun dossier de ${plus.w} n’est déjà suivi par ${moins.w} : un transfert `
            + 'se ferait à l’aveugle, mieux vaut en parler au point du matin.',
        ids: files.get(plus.w).map((r) => r.id),
      });
    }
  }

  // -- 6. Les dossiers que personne ne porte ---------------------------------
  const orphelins = actifs.filter((r) => !pilotDe(r));
  if (orphelins.length) {
    out.push({
      cle: 'orphelins',
      ton: 'attention',
      titre: `${pluriel(orphelins.length, 'commande')} sans pilote`,
      detail: 'Personne ne les fera avancer tant qu’elles n’ont pas de nom : '
        + orphelins.slice(0, 3).map(nom).join(', ')
        + (orphelins.length > 3 ? '…' : '.'),
      ids: orphelins.map((r) => r.id),
    });
  }

  // -- 7. Le poste à lancer en premier ---------------------------------------
  // Quelle machine porte le plus de travail à sortir sous 48 h. Le réglage
  // d'importance du patron départage deux postes à égalité : un goulot annoncé
  // passe devant.
  const machines = new Map((o.machines || []).map((m) => [m.slug, m]));
  const parMachine = new Map();
  for (const r of actifs) {
    if (!aNous(r)) continue;
    const d = jours(r);
    if (d === null || d > 2) continue;
    const slug = machineOf(r);
    if (!slug) continue;
    if (!parMachine.has(slug)) parMachine.set(slug, []);
    parMachine.get(slug).push(r);
  }
  if (parMachine.size) {
    const classe = [...parMachine.entries()]
      .map(([slug, list]) => ({
        slug, list,
        nom: (machines.get(slug) || {}).name || slug,
        importance: Number((machines.get(slug) || {}).importance) || 3,
      }))
      .sort((a, b) => (b.list.length - a.list.length) || (b.importance - a.importance));
    const tete = classe[0];
    if (tete.list.length >= 2) {
      out.push({
        cle: 'goulot',
        ton: 'calme',
        titre: `${tete.nom} porte ${pluriel(tete.list.length, 'commande')} sous 48 h`,
        detail: classe.length > 1
          ? `C’est le poste le plus chargé de la journée, devant ${classe[1].nom} `
            + `(${classe[1].list.length}). À lancer en premier.`
          : 'C’est le seul poste chargé aujourd’hui : à lancer en premier.',
        ids: tete.list.map((r) => r.id),
      });
    }
  }

  return out;
}
