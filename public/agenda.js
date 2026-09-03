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
// TROIS CHOSES PAR LIGNE, ET RIEN DE PLUS : l'heure, le client, ce qu'il vient
// chercher. La quatrième colonne n'est pas une information de plus, c'est la
// réponse à la seule question qui reste quand le client est devant le
// comptoir — est-ce que c'est prêt ?
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

const majuscule = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const NOM_DU_JOUR = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
});
const JOUR_COURT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: '2-digit', timeZone: 'UTC',
});

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

export function createAgenda(deps) {
  const { root, STAGE_LABEL = {}, SUB_LABEL = {}, ouvrirDossier } = deps;

  let visible = false;
  let donnees = null;      // { lignes, sansDate } — le dernier chargement réussi
  let erreur = null;
  let enVol = null;
  let jourPeint = null;    // le jour civil avec lequel l'écran a été dessiné
  let $corps = null;
  let $tete = null;

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

  // ------------------------------------------------------------- le rendu
  function texteCompte(lignes, sansDate) {
    const n = lignes.length;
    const base = `${n} retrait${n > 1 ? 's' : ''}`;
    // CE QUI N'EST PAS DANS L'AGENDA SE DIT. Un dossier sans date de retrait ne
    // peut se ranger sous aucun jour — mais le taire ferait lire cette liste
    // comme complète, et c'est le genre de silence qui fait rater un client.
    return sansDate
      ? `${base} · ${sansDate} dossier${sansDate > 1 ? 's' : ''} sans date`
      : base;
  }

  function render() {
    if (!root || !$corps) return;
    const jour = aujourdhui();
    jourPeint = jour;

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
    $tete.majCompte(texteCompte(lignes, sansDate));
    const blocs = grouper(lignes, jour);
    if (!blocs.length) {
      $corps.replaceChildren(el('p', 'ag-vide',
        'Aucun retrait daté. Les dates de retrait se posent au comptoir, ou sur la fiche d’un dossier.'));
      return;
    }
    $corps.replaceChildren(...blocs.map(bloc));
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
    $tete = ecranTete({ titre: 'Agenda des retraits' });
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
