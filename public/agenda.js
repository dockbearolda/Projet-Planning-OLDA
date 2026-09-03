// ===========================================================================
// L'AGENDA DES RETRAITS — qui vient chercher quoi, et quel jour (03/09/2026)
// ===========================================================================
// Demande de Charlie : « un agenda par jours, avec juste les noms des clients
// et les jours de retrait, pour que ma vendeuse en 1 regard puisse voir qui
// vient chercher quoi pour aujourd'hui, demain… ».
//
// C'EST UNE VUE DU PLANNING, pas un écran de plus : mêmes dossiers, même base,
// aucune donnée propre. Ce qui change, c'est l'axe — le planning range par
// ÉTAPE (où en est le travail), l'agenda range par JOUR (qui passe, et quand).
// La vendeuse n'a pas à visiter cinq étapes pour savoir qui pousse la porte
// dans l'heure.
//
// DEUX VUES, ET UNE SEULE LISTE DERRIÈRE (03/09) :
//   · AU JOUR — la journée qui commence, détaillée : heure, client, article,
//     état. C'est l'écran du matin, celui qui répond à « qui passe dans
//     l'heure ? ».
//   · AU MOIS — le calendrier, et RIEN QUE LES NOMS dans chaque journée.
//     Celui-là répond à « à quoi ressemble la fin du mois ? ». Le reste (heure,
//     article, état) est au survol du nom, pas à l'écran.
// Les deux lisent le MÊME chargement : passer de l'une à l'autre ne coûte pas
// une requête, et ne peut pas afficher deux vérités.
//
// TROIS CHOSES PAR LIGNE (vue au jour), ET RIEN DE PLUS : l'heure, le client,
// ce qu'il vient chercher. La quatrième colonne n'est pas une information de
// plus, c'est la réponse à la seule question qui reste quand le client est
// devant le comptoir — est-ce que c'est prêt ?
//
// AUCUN PRIX. Ce n'est pas une omission : l'écran sert à préparer une remise,
// pas à encaisser (l'argent vit sur la fiche), et le serveur ne l'envoie même
// pas — voir `GET /api/agenda`.

import { fetchBorne } from './reseau.js';
import { ecranTete } from './ecran-tete.js';
// UN NOM DE CLIENT SE LIT EN CAPITALES — règle unique, voir nom-client.js.
import { nomClientAffiche } from './nom-client.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// LE JOUR CIVIL DE L'ATELIER, jamais celui de la machine (CLAUDE.md). Le
// conteneur de production tourne en UTC et Saint-Martin est à UTC−4 : dès 20 h
// locales, un `new Date()` naïf date du lendemain — et « Aujourd'hui » se
// viderait tout seul en fin de journée, précisément à l'heure des derniers
// retraits. Même formateur que `montravail.js`, pour la même raison.
const JOUR_ATELIER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Marigot', year: 'numeric', month: '2-digit', day: '2-digit',
});
const aujourdhui = () => JOUR_ATELIER.format(new Date());

// « aaaa-mm-jj » → le midi UTC de ce jour-là. On date à MIDI et pas à minuit :
// c'est ce qui rend la soustraction insensible au fuseau du poste, quel qu'il
// soit — une heure de décalage ne peut plus faire basculer un jour entier.
const enJour = (iso) => {
  const j = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(j) ? j : null;
};
const enTemps = (jour) => Date.parse(`${jour}T12:00:00Z`);
const ecartJours = (jour, base) => Math.round((enTemps(jour) - enTemps(base)) / 86400000);

const NOM_DU_JOUR = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
});
const JOUR_COURT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: '2-digit', timeZone: 'UTC',
});
const NOM_DU_MOIS = new Intl.DateTimeFormat('fr-FR', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
});

// LES SEPT JOURS SE NOMMENT DEPUIS UNE DATE CONNUE, jamais depuis une liste
// écrite à la main : le 5 janvier 2026 est un LUNDI, et la semaine française
// commence le lundi. Une liste tapée se relit sans erreur ET se décale d'un
// cran le jour où quelqu'un la réordonne.
const JOUR_SEMAINE = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });
const majuscule = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const JOURS_SEMAINE = Array.from({ length: 7 },
  (_, i) => majuscule(JOUR_SEMAINE.format(new Date(Date.UTC(2026, 0, 5 + i, 12)))));

// « aaaa-mm-jj » → « aaaa-mm », et le mois d'à côté. On passe par `Date.UTC`
// plutôt que d'additionner des nombres : décembre + 1 doit donner janvier de
// l'année SUIVANTE, et c'est le genre de report qu'on écrit de travers une fois
// sur deux.
const moisDe = (jour) => String(jour || '').slice(0, 7);
const moisDecale = (mois, n) => {
  const [a, m] = String(mois).split('-').map(Number);
  const d = new Date(Date.UTC(a, (m - 1) + n, 1, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const premierDuMois = (mois) => {
  const [a, m] = String(mois).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, 1, 12));
};
// Le 0e jour du mois suivant EST le dernier du mois courant : la seule écriture
// qui n'a pas besoin de connaître les années bissextiles.
const joursDuMois = (mois) => {
  const [a, m] = String(mois).split('-').map(Number);
  return new Date(Date.UTC(a, m, 0, 12)).getUTCDate();
};

// « 16:30 » → « 16h30 ». Un deux-points est une heure de tableur ; l'atelier
// écrit et lit des heures françaises, sur le ticket comme à l'écran.
const enHeure = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ''));
  return m ? `${m[1].padStart(2, '0')}h${m[2]}` : '';
};

// CE QUE LE CLIENT VIENT CHERCHER. Même titre que la carte du planning : la
// quantité colle à l'article, parce que « 25 T-shirts » et « 1 T-shirt » ne se
// préparent pas pareil, et que le nombre est ce qu'on vérifie en le donnant.
function libelleArticle(l) {
  const nom = (l.product || '').trim();
  if (!nom) return 'Sans description';
  const n = Number(l.quantity);
  return Number.isFinite(n) && n > 1 ? `${n} × ${nom}` : nom;
}

// LA VUE CHOISIE SUIT L'APPAREIL. Celle qui prépare les retraits le matin veut
// retrouver SON écran, pas celui du collègue de la veille : c'est la même règle
// que le repli du rail et la largeur des colonnes. Un seul bit, une seule clé —
// contrairement au rail, ce choix ne dépend pas du métier de qui est au poste,
// seulement de l'habitude de la machine.
const CLE_VUE = 'olda.agenda-vue';
const VUES = ['jour', 'mois'];
function lireVue() {
  try {
    const v = localStorage.getItem(CLE_VUE);
    return VUES.includes(v) ? v : 'jour';
  } catch (_) { return 'jour'; }        // stockage refusé (navigation privée)
}

export function createAgenda(deps) {
  const {
    root, STAGE_LABEL = {}, SUB_LABEL = {}, ouvrirDossier, attachTip = () => {},
  } = deps;

  let visible = false;
  let donnees = null;      // { lignes, sansDate } — le dernier chargement réussi
  let erreur = null;
  let enVol = null;
  let jourPeint = null;    // le jour civil avec lequel l'écran a été dessiné
  let vue = lireVue();     // 'jour' (la liste) | 'mois' (le calendrier)
  let mois = null;         // « aaaa-mm » affiché par la vue au mois
  let $corps = null;
  let $tete = null;
  let $bascule = null;     // les deux boutons Jour / Mois
  let $navMois = null;     // ‹ septembre 2026 ›
  let $moisNom = null;
  let $retourMois = null;  // « Revenir à ce mois-ci », caché sur le mois courant

  // ------------------------------------------------------------------ l'état
  // OÙ EN EST LE DOSSIER — et à la granularité qui sert ICI, pas ailleurs.
  //
  // « Facturation & remise au client » est la famille où le travail est FAIT :
  // ses quatre sous-étapes sont justement les nuances du retrait (à facturer,
  // client à prévenir, client prévenu). Ce sont celles-là que la vendeuse
  // arbitre, donc c'est la SOUS-ÉTAPE qu'on nomme.
  //
  // Partout ailleurs, la sous-étape ne lui apprend rien qu'elle puisse faire —
  // « Découpe & Contrôle DTF » ou « Pressage », dans les deux cas ce n'est pas
  // prêt. On nomme donc la FAMILLE, et l'écran reste lisible d'un coup d'œil.
  const PRET = 'facturation';
  function etatDe(l) {
    if (l.stage === PRET) return SUB_LABEL[l.sub_stage] || STAGE_LABEL[l.stage] || 'Prêt';
    return STAGE_LABEL[l.stage] || l.stage || '';
  }

  // ------------------------------------------------------------- une rangée
  function rangee(l, { avecDate }) {
    const b = el('button', 'ag-ligne');
    b.type = 'button';
    b.dataset.id = l.id;

    // QUAND. L'heure dans un jour daté ; la date dans le bloc « En retard »,
    // qui rassemble plusieurs jours et où l'heure ne situe plus rien.
    const heure = enHeure(l.heure);
    const jour = enJour(l.deadline);
    const quand = el('span', 'ag-ligne__quand');
    if (avecDate) {
      quand.textContent = jour ? JOUR_COURT.format(new Date(enTemps(jour))) : '—';
      quand.setAttribute('aria-label', `Attendu le ${quand.textContent}`);
    } else {
      // PAS DE TIRET QUAND L'HEURE MANQUE, et c'est voulu : sur une liste où
      // la plupart des lignes n'en portent pas, une colonne de tirets se lit
      // comme une donnée manquante à aller chercher. Une heure vide veut dire
      // « dans la journée » — la colonne se tait.
      quand.textContent = heure;
      if (heure) quand.setAttribute('aria-label', `À ${heure}`);
    }
    b.append(quand);

    // QUI. Le nom du dossier, en capitales quand c'est un particulier.
    const qui = el('span', 'ag-ligne__client',
      nomClientAffiche(l.billing_company, l.client_type) || 'Sans nom');
    b.append(qui);

    // QUOI.
    const quoi = el('span', 'ag-ligne__quoi', libelleArticle(l));
    b.append(quoi);

    // EST-CE PRÊT. Une commande bloquée le dit à la place du reste : c'est la
    // seule ligne où l'état ne suffit pas — il faut le motif, sinon la
    // vendeuse promet un retrait qui n'aura pas lieu.
    const etat = el('span', 'ag-ligne__etat');
    if (l.flag === 'bloque') {
      etat.classList.add('is-bloque');
      etat.textContent = l.flag_reason || 'Bloquée';
    } else {
      if (l.stage === PRET) etat.classList.add('is-pret');
      etat.textContent = etatDe(l);
    }
    b.append(etat);

    // LE NOM ACCESSIBLE EST LA RANGÉE LUE À VOIX HAUTE. Il nomme ses cellules,
    // il ne les repêche pas par leur rang : une colonne ajoutée un jour
    // décalerait l'index, et la ligne s'annoncerait de travers sans que rien
    // ne le signale.
    b.setAttribute('aria-label', [
      quand.textContent, qui.textContent, quoi.textContent, etat.textContent,
    ].filter(Boolean).join(' — '));
    b.addEventListener('click', () => ouvrirDossier && ouvrirDossier(l.id));
    return b;
  }

  // --------------------------------------------------------------- un bloc
  // L'EN-TÊTE DE JOUR RESTE SOUS LES YEUX pendant qu'on parcourt ses lignes :
  // sans lui, à mi-liste, on ne sait plus quel jour on lit. Il est collant DANS
  // SON BLOC — un titre collant ne sort jamais du sien, sinon celui de demain
  // se colle en haut pendant qu'on lit encore aujourd'hui.
  function bloc({ cle, nom, precision, lignes, retard, avecDate }) {
    const s = el('section', 'ag-jour');
    if (retard) s.classList.add('is-retard');
    if (cle) s.dataset.jour = cle;
    const tete = el('header', 'ag-jour__tete');
    tete.append(el('h2', 'ag-jour__nom', nom));
    if (precision) tete.append(el('span', 'ag-jour__date', precision));
    tete.append(el('span', 'ag-jour__n',
      `${lignes.length} retrait${lignes.length > 1 ? 's' : ''}`));
    s.append(tete);
    const liste = el('div', 'ag-liste');
    for (const l of lignes) liste.append(rangee(l, { avecDate }));
    s.append(liste);
    return s;
  }

  // ------------------------------------------------------ le regroupement
  // UN BLOC PAR JOUR, dans l'ordre du calendrier — et rien pour les jours sans
  // retrait : un agenda qui affiche ses trous fait défiler du vide.
  //
  // LE RETARD EST UN SEUL BLOC, et il est en tête. Un bloc par jour passé
  // donnerait dix en-têtes de deux lignes avant « Aujourd'hui », c'est-à-dire
  // exactement ce que cet écran existe pour éviter ; et le mettre en bas
  // reviendrait à ranger sous le tapis les clients qui attendent depuis le plus
  // longtemps. Là, ses lignes portent leur date à la place de leur heure.
  function grouper(lignes, jour) {
    const enRetard = [];
    const parJour = new Map();
    for (const l of lignes) {
      const j = enJour(l.deadline);
      if (!j) continue;                       // le serveur ne devrait pas en envoyer
      if (ecartJours(j, jour) < 0) { enRetard.push(l); continue; }
      if (!parJour.has(j)) parJour.set(j, []);
      parJour.get(j).push(l);
    }
    const blocs = [];
    if (enRetard.length) {
      blocs.push({
        cle: 'retard', nom: 'En retard', lignes: enRetard, retard: true, avecDate: true,
        precision: 'commandes non retirées',
      });
    }
    for (const j of [...parJour.keys()].sort()) {
      const ecart = ecartJours(j, jour);
      const date = majuscule(NOM_DU_JOUR.format(new Date(enTemps(j))));
      blocs.push(ecart === 0
        ? { cle: j, nom: 'Aujourd’hui', precision: date, lignes: parJour.get(j) }
        : ecart === 1
          ? { cle: j, nom: 'Demain', precision: date, lignes: parJour.get(j) }
          : { cle: j, nom: date, lignes: parJour.get(j) });
    }
    return blocs;
  }

  // ===========================================================================
  // LA VUE AU MOIS — le calendrier, et RIEN QUE LES NOMS (03/09/2026)
  // ===========================================================================
  // Charlie : « l'agenda doit avoir une vue au mois avec uniquement les noms des
  // clients en liste dans les jours ».
  //
  // Donc : sept colonnes, les semaines l'une sous l'autre, et dans chaque
  // journée la liste des noms — pas l'heure, pas l'article, pas l'état. Ce que
  // la vue au jour détaille, celle-ci le résume : elle répond à « à quoi
  // ressemble la fin du mois ? », pas à « qui passe dans l'heure ? ».
  //
  // CE QUI NE TIENT PAS DANS LA CASE NE DISPARAÎT PAS. Les rangées grandissent
  // avec leur contenu, et le mois défile si la charge l'exige. Un « + 3 » qui
  // cache trois noms coûterait un clic à l'endroit précis où l'on est venu
  // LIRE des noms — et le mois d'un atelier normal tient sans défiler.
  //
  // LE RESTE EST AU SURVOL. L'heure, l'article et l'état vivent dans la bulle
  // du nom : la case reste une liste de noms, et on ne perd rien.

  // Les cases d'un mois : les jours du mois précédent qui complètent la
  // première semaine, les jours du mois, puis ceux du suivant. Les jours d'à
  // côté ne portent AUCUN nom — ce sont des bouche-trous de grille, et leur
  // mois est à un clic. Sans eux, un mois qui commence un jeudi décalerait
  // toute sa première semaine sous les mauvais intitulés.
  function casesDuMois(cible, parJour, jour) {
    const cases = [];
    const avant = moisDecale(cible, -1);
    const decalage = (premierDuMois(cible).getUTCDay() + 6) % 7;   // lundi = 0
    const finAvant = joursDuMois(avant);
    for (let i = decalage; i > 0; i -= 1) {
      cases.push({ hors: true, n: finAvant - i + 1, lignes: [] });
    }
    const dernier = joursDuMois(cible);
    for (let n = 1; n <= dernier; n += 1) {
      const j = `${cible}-${String(n).padStart(2, '0')}`;
      cases.push({ n, jour: j, ecart: ecartJours(j, jour), lignes: parJour.get(j) || [] });
    }
    // La dernière semaine se complète : une grille de sept colonnes qui
    // s'arrête au milieu d'une rangée laisse un trou sans bordure.
    let n = 1;
    while (cases.length % 7 !== 0) cases.push({ hors: true, n: n++, lignes: [] });
    return cases;
  }

  // UN NOM, ET RIEN D'AUTRE À L'ÉCRAN. C'est un vrai bouton : il ouvre le
  // dossier, comme une rangée de la vue au jour — même geste sur les deux vues.
  function nomDuClient(l) {
    const b = el('button', 'ag-nom');
    b.type = 'button';
    b.dataset.id = l.id;
    if (l.flag === 'bloque') b.classList.add('is-bloque');
    const nom = nomClientAffiche(l.billing_company, l.client_type) || 'Sans nom';
    b.textContent = nom;
    // TOUT LE RESTE AU SURVOL — l'heure, ce qu'il vient chercher, où ça en est.
    // À l'écran, la case ne porte que des noms ; sous la souris, elle en dit
    // autant qu'une rangée de la vue au jour.
    const detail = [enHeure(l.heure), libelleArticle(l),
      l.flag === 'bloque' ? (l.flag_reason || 'Bloquée') : etatDe(l)].filter(Boolean).join(' · ');
    attachTip(b, detail);
    b.setAttribute('aria-label', `${nom} — ${detail}`);
    b.addEventListener('click', () => ouvrirDossier && ouvrirDossier(l.id));
    return b;
  }

  function caseDuMois(c) {
    const d = el('div', 'ag-case');
    if (c.hors) d.classList.add('is-hors');
    if (c.ecart === 0) d.classList.add('is-aujourdhui');
    // UN JOUR PASSÉ QUI PORTE ENCORE DES NOMS EST UN RETARD, et le retard est un
    // état : c'est la seule couleur de cette grille, et elle ne tient qu'au
    // NUMÉRO du jour. Peindre la case entière ferait une page rouge au premier
    // mois un peu chargé, et une alerte permanente n'alerte plus.
    if (c.ecart < 0 && c.lignes.length) d.classList.add('is-retard');
    d.append(el('span', 'ag-case__jour', String(c.n)));
    if (c.lignes.length) {
      const liste = el('div', 'ag-case__noms');
      for (const l of c.lignes) liste.append(nomDuClient(l));
      d.append(liste);
    }
    return d;
  }

  function rendreMois(lignes, jour) {
    const cible = mois || moisDe(jour);
    const parJour = new Map();
    let duMois = 0;
    for (const l of lignes) {
      const j = enJour(l.deadline);
      if (!j || moisDe(j) !== cible) continue;
      if (!parJour.has(j)) parJour.set(j, []);
      parJour.get(j).push(l);
      duMois += 1;
    }
    const grille = el('div', 'ag-mois');
    // LES INTITULÉS DE COLONNE RESTENT SOUS LES YEUX. Sur un mois qui défile,
    // sans eux on ne sait plus quelle colonne est samedi.
    const tete = el('div', 'ag-mois__tete');
    for (const nom of JOURS_SEMAINE) tete.append(el('span', 'ag-mois__jour', nom));
    grille.append(tete);
    const corps = el('div', 'ag-mois__corps');
    for (const c of casesDuMois(cible, parJour, jour)) corps.append(caseDuMois(c));
    grille.append(corps);
    return { grille, duMois };
  }

  // ------------------------------------------------------------- le rendu
  // LE COMPTEUR PORTE SUR CE QU'ON VOIT. En vue au jour, c'est toute la liste ;
  // en vue au mois, c'est le mois affiché — annoncer 25 retraits au-dessus d'un
  // mois qui en montre 12, ce serait deux chiffres justes sur un écran faux.
  function texteCompte(n, sansDate) {
    const base = `${n} retrait${n > 1 ? 's' : ''}`;
    // CE QUI N'EST PAS DANS L'AGENDA SE DIT. Un dossier sans date de retrait ne
    // peut se ranger sous aucun jour — mais le taire ferait lire cette liste
    // comme complète, et c'est le genre de silence qui fait rater un client.
    return sansDate
      ? `${base} · ${sansDate} sans date`
      : base;
  }

  function render() {
    if (!root || !$corps) return;
    const jour = aujourdhui();
    jourPeint = jour;
    if (!mois) mois = moisDe(jour);
    majCommandes(jour);

    if (!donnees) {
      $tete.majCompte('');
      $corps.replaceChildren(el('p', 'ag-vide', erreur
        // Un écran vide sans explication se lit « personne ne vient » : c'est
        // exactement le contresens à ne pas laisser passer ici.
        ? 'Agenda indisponible — vérifie la connexion. Ne pars pas du principe que personne ne vient.'
        : 'Chargement de l’agenda…'));
      return;
    }

    const { lignes, sansDate } = donnees;

    if (vue === 'mois') {
      const { grille, duMois } = rendreMois(lignes, jour);
      $tete.majCompte(texteCompte(duMois, sansDate));
      $corps.replaceChildren(grille);
      return;
    }

    $tete.majCompte(texteCompte(lignes.length, sansDate));
    const blocs = grouper(lignes, jour);
    if (!blocs.length) {
      $corps.replaceChildren(el('p', 'ag-vide',
        'Aucun retrait daté. Les dates de retrait se posent au comptoir, ou sur la fiche d’un dossier.'));
      return;
    }
    $corps.replaceChildren(...blocs.map(bloc));
  }

  // ------------------------------------------------- les commandes de l'en-tête
  // ELLES SE METTENT À JOUR SUR PLACE, elles ne se reconstruisent pas : une
  // rangée refaite à chaque rendu perd le survol, l'onde du clic et le focus du
  // clavier — et cet écran se repeint à chaque évènement temps réel.
  function majCommandes(jour) {
    if (!$bascule) return;
    for (const b of $bascule.children) {
      b.setAttribute('aria-pressed', String(b.dataset.vue === vue));
    }
    $navMois.hidden = vue !== 'mois';
    $moisNom.textContent = majuscule(NOM_DU_MOIS.format(premierDuMois(mois)));
    // « Revenir à ce mois-ci » n'apparaît QUE quand on l'a quitté : sans lui on
    // entre dans les mois d'après sans savoir en ressortir autrement qu'en
    // recomptant les clics. Même règle que l'ordre manuel du planning — une
    // sortie qui n'existe que quand il y a quelque chose à quitter.
    $retourMois.hidden = vue !== 'mois' || mois === moisDe(jour);
  }

  function boutonVue(id, libelle) {
    const b = el('button', 'help-btn', libelle);
    b.type = 'button';
    b.dataset.vue = id;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      if (vue === id) return;              // une bascule = UN mouvement
      vue = id;
      try { localStorage.setItem(CLE_VUE, id); } catch (_) { /* stockage refusé */ }
      // On revient TOUJOURS au mois en cours en rouvrant la vue au mois : on ne
      // rouvre pas un écran sur février parce qu'on y était passé la veille.
      if (id === 'mois') mois = moisDe(aujourdhui());
      render();
    });
    return b;
  }

  // LES DEUX CHEVRONS SONT DESSINÉS. La police d'icônes est un sous-ensemble
  // figé de 91 glyphes : elle porte `chevron_right` et PAS `chevron_left`, et un
  // nom absent s'affiche en texte réduit à sa première lettre, sans la moindre
  // erreur. Deux traits en SVG ne dépendent de rien.
  function chevron(vers) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', vers < 0 ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7');
    svg.append(p);
    return svg;
  }

  function boutonMois(vers, etiquette) {
    const b = el('button', 'icon-btn');
    b.type = 'button';
    b.setAttribute('aria-label', etiquette);
    b.append(chevron(vers));
    attachTip(b, etiquette);
    b.addEventListener('click', () => { mois = moisDecale(mois, vers); render(); });
    return b;
  }

  function monterCommandes() {
    $bascule = el('div', 'ag-vues');
    $bascule.setAttribute('role', 'group');
    $bascule.setAttribute('aria-label', 'Vue de l’agenda');
    $bascule.append(boutonVue('jour', 'Jour'), boutonVue('mois', 'Mois'));

    $moisNom = el('span', 'ag-mois-nom');
    $moisNom.setAttribute('aria-live', 'polite');
    $navMois = el('div', 'ag-nav');
    $navMois.append(boutonMois(-1, 'Mois précédent'), $moisNom, boutonMois(1, 'Mois suivant'));

    $retourMois = el('button', 'action-ligne', 'Revenir à ce mois-ci');
    $retourMois.type = 'button';
    $retourMois.hidden = true;
    $retourMois.addEventListener('click', () => { mois = moisDe(aujourdhui()); render(); });
  }

  // ------------------------------------------------------------ les données
  async function charger() {
    if (enVol) return enVol;
    enVol = (async () => {
      try {
        const res = await fetchBorne('/api/agenda');
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        const recu = await res.json();
        donnees = {
          lignes: Array.isArray(recu && recu.lignes) ? recu.lignes : [],
          sansDate: Number(recu && recu.sansDate) || 0,
        };
        erreur = null;
      } catch (err) {
        erreur = err;
        // ON GARDE LA DERNIÈRE LISTE CONNUE. Un réseau qui tousse ne doit pas
        // vider l'agenda sous les yeux de quelqu'un qui s'en sert : périmée de
        // trente secondes, elle vaut infiniment mieux que rien.
      } finally {
        enVol = null;
      }
      render();
    })();
    return enVol;
  }

  // ------------------------------------------------------------ API publique
  function start() {
    monterCommandes();
    $tete = ecranTete({
      titre: 'Agenda des retraits',
      gauche: [$retourMois],
      droite: [$navMois, $bascule],
    });
    $corps = el('div', 'ag-page');
    root.replaceChildren($tete, $corps);
    render();
  }

  function show() {
    visible = true;
    if (!$corps) start();
    // On repeint avec ce qu'on a AVANT de redemander : l'écran ne clignote pas
    // au retour d'onglet, et la liste fraîche se pose dessus.
    render();
    charger();
  }

  function hide() { visible = false; }

  // Appelé par app.js à chaque évènement temps réel. MASQUÉ, on ne redemande
  // rien : l'agenda n'a ni badge ni compteur qui vivent ailleurs que sur lui,
  // et `show()` recharge de toute façon. Une commande déplacée à l'atelier ne
  // doit pas coûter une requête à chaque poste resté sur le planning.
  function notifyChange() { if (visible) charger(); }

  // L'HORLOGE FAIT PARTIE DES DONNÉES DE CET ÉCRAN. « Aujourd'hui » et
  // « Demain » sont des étiquettes relatives : passé minuit, un agenda resté
  // ouvert (les postes ne se rechargent jamais) désignerait la veille. On
  // repeint au changement de jour civil, et à ce moment-là seulement.
  function tick() {
    if (!visible || !$corps) return;
    if (aujourdhui() !== jourPeint) render();
  }

  return { start, show, hide, notifyChange, tick };
}
