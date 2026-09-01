// ===========================================================================
// CE QUI EST SUR LA LIGNE — la fiche de production et la rangée « Manque »
// ===========================================================================
// SORTI DE `app.js` LE 27/08/2026. Le fichier faisait 437 Ko d'un seul tenant,
// et ce n'est pas un problème de POIDS (le serveur en sert 99 une fois les
// commentaires retirés) : c'est un problème de COLLISION. Deux sessions qui
// travaillent le même jour sur le planning éditent le même fichier, et c'est
// déjà arrivé — PR #151 et #153 se sont marché dessus sur le comptoir.
//
// CE MORCEAU-CI EST SORTABLE, ET PRESQUE AUCUN AUTRE. Mesuré avant de couper :
// il déclare dix noms, dont DEUX seulement servent ailleurs, et il n'emprunte
// que quatre choses au reste du fichier. À titre de comparaison, le bloc de la
// fiche projet déclare 159 noms dont 50 servent ailleurs, et en emprunte 100 :
// ce n'est pas un fichier à découper, c'est un état partagé à démêler.
//
// LES DEUX EMPRUNTS QUI RESTENT PASSENT PAR LA SIGNATURE, jamais par un import
// vers `app.js` — un cycle entre deux modules s'initialise dans un ordre qui
// dépend de qui charge qui, et le jour où il casse, il casse à l'ouverture de
// l'application. `blocFeu` reçoit donc son infobulle, `blocProduction` reçoit
// les colonnes masquées : deux valeurs, passées à l'appel.

import { eur } from './format.js';

// CE QU'IL Y A À FAIRE, EN CLAIR — le MÊME bloc sur la carte et dans le
// tableau. Le chef d'atelier ne lit pas un dossier, il lit une ligne : la
// référence et sa couleur, le nombre par taille, la largeur du logo sur chaque
// face marquée. Trois rangées, toujours dans le même ordre, toujours au même
// endroit — c'est ce qui permet de balayer une file du regard.
//
// CHACUN CHOISIT LES SIENNES (rail « Colonnes ») : à l'atelier le prix pollue
// la ligne et la largeur du dos est indispensable, au comptoir c'est l'inverse.
// Une rangée sans valeur ne s'affiche pas — un récapitulatif reprend ce qui a
// été saisi, jamais ce qui manque.
//
// QUATRE FAITS PORTENT LA GRAISSE, et eux seuls (Charlie, 26/08) : la
// RÉFÉRENCE, la QUANTITÉ, la COULEUR DU MARQUAGE et la LARGEUR DES LOGOS. Ce
// sont les quatre choses qu'on cherche du regard ; tout le reste de la rangée
// les entoure et se lit en 400. C'est la hiérarchie à la graisse de la maison,
// appliquée à l'intérieur d'une valeur.
//
// `lire` rend des MORCEAUX — `{ t, fort }` — et non une chaîne : sans ça, mettre
// la référence en avant demandait une rangée de plus, et la carte y perdait la
// densité qui permet de balayer une file.
const morceau = (t, fort) => (t ? [{ t: String(t), fort: !!fort }] : []);
const joindre = (listes, sep) => listes.filter((x) => x.length)
  .flatMap((x, i) => (i ? [{ t: sep }, ...x] : x));

const PROD_FAITS = [
  {
    key: 'prod_ref',
    label: 'Réf.',
    // LA RÉFÉRENCE NE S'ÉCRIT PAS DEUX FOIS. La désignation de l'article la
    // porte presque toujours (« T-shirt col rond NS300 ») et la ligne juste
    // en dessous la répétait : deux fois NS300 sur trois centimètres.
    lire: (p, r) => {
      const nom = String((r && r.product) || '');
      const ref = p.ref && nom.includes(p.ref) ? '' : p.ref;
      return joindre([morceau(ref, true), morceau(p.couleur)], ' · ');
    },
  },
  {
    key: 'prod_dtf',
    label: 'Marquage',
    // LA TECHNIQUE NOMME, LA COULEUR DÉCIDE : « DTF · Noir ». C'est la couleur
    // qui dit quel rouleau charger — « DTF » tout seul ne dit rien à charger —
    // donc elle seule porte la graisse. Le mot « encre » ne s'écrit nulle part
    // (Charlie, 26/08) ; la clé de la fiche s'appelle encore ainsi, on ne
    // renomme pas un champ stocké pour un mot d'écran.
    lire: (p) => joindre([morceau(p.marquage), morceau(p.encre, true)], ' · '),
  },
  {
    key: 'prod_tailles',
    label: 'Tailles',
    // LE TOTAL A QUITTÉ CETTE RANGÉE (01/09/2026) — il est passé DANS LE TITRE
    // de la ligne, « 24 × T-shirt col rond » (voir nomArticle plus bas). Il
    // s'écrivait ici « 24 pièces : 6 × S · 10 × M », en graisse forte, à trois
    // centimètres d'un titre qui portait déjà le même 24 en graisse forte : la
    // carte disait deux fois la même chose. Même règle, et même précédent, que
    // la référence juste au-dessus — elle ne s'écrit pas non plus quand la
    // désignation la porte déjà.
    // Reste ce que le titre ne peut PAS dire : la répartition, nombre d'abord
    // — « 3 × S » — comme aux trois autres endroits qui l'écrivent.
    lire: (p) => morceau((p.tailles || []).map((x) => `${x.n} × ${x.t}`).join(' · ')),
  },
  {
    key: 'prod_logos',
    label: 'Logos',
    // Les faces se séparent au point médian, les tailles d'une même face à la
    // barre : « Coeur 60 · Dos S 260/M 280 ». Sans cette différence, une face
    // mesurée taille par taille se lisait comme deux faces. La LARGEUR porte la
    // graisse, la face la nomme.
    lire: (p) => {
      const g = p.logos || [];
      // L'unité appartient à la LARGEUR : un « mm » séparé faisait deux
      // fragments gras côte à côte pour un seul fait.
      return g.flatMap((x, i) => [
        ...(i ? [{ t: ' · ' }] : []),
        { t: `${x.face} ` },
        { t: i === g.length - 1 ? `${x.mm} mm` : String(x.mm), fort: true },
      ]);
    },
  },
];

// LE TITRE DE LA LIGNE : COMBIEN, ET DE QUOI (01/09/2026)
// ---------------------------------------------------------------------------
// « Chaque ligne dit ce qu'il y a à produire, avec sa quantité. » L'article
// était sur la ligne depuis le 27/08 (`product`, la donnée la mieux remplie de
// la base : 186 dossiers de production sur 187) ; la quantité, elle, n'avait
// de colonne nulle part et ne se lisait que dans le bloc de production, une
// case du rail « Colonnes » que personne n'allume — et seulement sur les
// dossiers nés au comptoir, qui portent une `fiche.prod`. Sur un planning
// d'atelier, « T-shirt col rond NS300 » sans son nombre ne dit pas le travail.
//
// ELLE S'ÉCRIT DEVANT, ET COLLÉE : « 24 × T-shirt col rond ». C'est la
// grammaire de la maison — le nombre avant ce qu'il compte, au signe multiplié
// — celle des tailles (« 3 × S ») et celle du besoin dans la fiche depuis le
// 24/08. Un rail de colonne à elle coûterait 46 px de largeur sur toutes les
// lignes pour un nombre à deux chiffres.
//
// SEUL LE NOMBRE PORTE LA GRAISSE, avec la classe des quatre faits de
// production : c'est lui qu'on cherche du regard, la désignation l'entoure.
// LE MÊME COMPOSANT POUR LES DEUX VUES — la cellule « Article » du tableau et
// le titre de la carte. Écrit deux fois, il divergeait au premier changement.
export function nomArticle(r, hote) {
  const q = r && r.quantity != null && Number.isFinite(Number(r.quantity)) && Number(r.quantity) > 0
    ? Number(r.quantity)
    : null;
  const nom = String((r && r.product) || '');
  hote.replaceChildren();
  if (q !== null) {
    const fort = document.createElement('span');
    fort.className = 'prod-fiche__fort';
    // L'ESPACE EST INSÉCABLE : « 24 × » ne se coupe pas entre le nombre et son
    // signe, et le signe ne se retrouve pas seul devant la désignation.
    fort.textContent = `${q}\u00a0×\u00a0`;
    hote.appendChild(fort);
  }
  if (nom) hote.append(nom);
  return { q, nom, texte: q === null ? nom : `${q} × ${nom}` };
}

// ===========================================================================
// LE FEU : CE QUI MANQUE AVANT DE PRODUIRE
// ===========================================================================
// « Le souci de mon patron c'est de ne pas connaître en temps réel l'état de la
// commande. Quand le projet arrive en production il doit obligatoirement avoir
// un devis validé, un BAT validé ainsi que le paiement, mais certains ont des
// acomptes. » (Charlie, 26/08)
//
// TROIS FAITS, ET CHACUN DIT S'IL EST EXIGÉ. C'est la réponse au « difficile
// d'uniformiser » : on n'uniformise pas, chaque dossier déclare ce qu'il exige,
// et il le déclare TOUT SEUL —
//   · le devis  : un PDF déposé, ou un passage par le chiffrage ;
//   · le BAT    : un PDF déposé, ou un passage par une étape de BAT ;
//   · l'argent  : dès qu'il y a un montant à encaisser.
// La tasse à 12 € payée au comptoir n'exige donc RIEN : pas de devis, pas de
// BAT, et l'argent déjà encaissé. Sa carte ne porte pas cette rangée du tout.
// Les 200 t-shirts exigent les trois, sans que personne ait coché quoi que ce
// soit.
//
// LE VERT SE TAIT — JUSQU'AU BOUT (règle de la maison, appliquée à la lettre).
// La première version écrivait « ● Devis ◌ BAT ◌ Argent » : trois glyphes et
// trois mots sur CHAQUE carte, dont deux tiers ne disaient rien d'utile. Charlie
// (26/08) : « je n'aime pas du tout le design du feu, il faut qu'il soit bien
// visible. Quelque chose de haut de gamme et de discret. »
//
// Les trois adjectifs ne se contredisent pas — ils disent : ne montre QUE ce qui
// manque, et montre-le dans le rythme du reste. La rangée emprunte donc la
// grille de la fiche de production (même colonne d'intitulé à 84 px, mêmes
// tailles, mêmes graisses) : elle se lit comme sa cinquième ligne, pas comme une
// pastille rapportée.
//
//   RÉF.       K3025 · Noir
//   MARQUAGE   DTF · Blanc
//   TAILLES    24 pièces : 6 × S · 10 × M · 6 × L · 2 × XL
//   LOGOS      Coeur 90 · Dos 280 mm
//   MANQUE     BAT · Acompte
//
// Un seul mot porte la couleur d'ÉTAT — l'intitulé. Les valeurs prennent la
// graisse forte, comme les quatre faits de production au-dessus. Aucun glyphe :
// « ● » et « ◌ » sont des caractères de police, ils changent de dessin d'un
// poste à l'autre et se lisent comme du texte, pas comme un repère.
//
// ET QUAND RIEN NE MANQUE, LA RANGÉE N'EXISTE PAS. C'est là qu'est la
// discrétion : sur une file de trente dossiers, seuls ceux qui coincent portent
// une marque, et l'œil ne cherche que celle-là.
//
// EN LECTURE SEULE POUR L'INSTANT : ce feu AFFICHE, il ne bloque pas. Seul le
// BAT refuse encore le passage en production (verrou de server.js). On regarde
// d'abord si la règle dit vrai sur de vrais dossiers ; on verrouillera ensuite.
// LE FEU LIT CE QUE LE DOSSIER SAIT DÉJÀ, jamais une case que quelqu'un doit
// penser à cocher. Version du 26/08 : `acompte_demande` décidait de l'argent —
// mesuré le 27/08 sur les 185 dossiers réels, ce champ est NULL sur les 185. La
// règle n'était pas fausse, elle était MUETTE, et un feu muet est un feu qu'on
// finit par retirer.
//
// TROIS FAITS, ET CHACUN SE DÉDUIT DE L'ÉTAPE :
//   · le devis est ACQUIS dès que le dossier a quitté « Demande & chiffrage » —
//     on ne prépare pas une commande dont le devis a été refusé ;
//   · le BAT est ACQUIS dès l'entrée en production — le verrou de server.js
//     l'impose déjà, donc y être PROUVE qu'il est passé ;
//   · l'argent est EXIGÉ en production, et là seulement (« quand le projet
//     arrive en production il doit obligatoirement avoir […] le paiement »,
//     le patron, 26/08). Avant, « pas encore payé » n'est pas une anomalie :
//     on encaisse au retrait.
//
// Le feu ne dit donc QUE ce que l'étape ne dit pas déjà. Un dossier à
// « Paiement › à contrôler » n'a pas besoin d'un voyant « il manque l'argent » :
// c'est le nom de l'endroit où il est.
//
// MESURÉ SUR LES 185 DOSSIERS DE L'ATELIER (27/08) : 28 s'allument, soit 15 %.
//   · 15 en Demande & chiffrage — devis parti, aucun retour ;
//   · 6 en Préparation — BAT en attente ;
//   · 7 en Production — pas payé.
//   · 0 sur les 60 dossiers archivés et les 66 « paiement à contrôler ».
// La version d'avant en allumait 0 ; la toute première (« exigé dès qu'il y a un
// montant ») en allumait 184 sur 307. Un signal, ce n'est ni l'un ni l'autre.
const FEU_APRES_CHIFFRAGE = new Set(['preparation', 'production', 'facturation', 'paiement']);
const FEU_APRES_BAT = new Set(['production', 'facturation', 'paiement']);

const FEU_FAITS = [
  {
    cle: 'devis',
    label: 'Devis',
    requis: (r) => r.devis_requis === true,
    obtenu: (r) => !!r.devis_valide_le || r.sub_stage === 'devis_valide'
      || FEU_APRES_CHIFFRAGE.has(r.stage),
    // CE QUI SE LIT SUR LA LIGNE. Pas la catégorie qui manque — ce qu'on attend,
    // et depuis quand : c'est le nombre de jours qui décide si on relance
    // aujourd'hui ou pas.
    manque: () => 'Devis',
    attente: () => 'sans retour',
    dit: () => 'Devis envoye - pas encore valide par le client',
  },
  {
    cle: 'bat',
    label: 'BAT',
    requis: (r) => r.bat_requis === true,
    obtenu: (r) => !!r.bat_valide_le || r.sub_stage === 'bat_valide'
      || FEU_APRES_BAT.has(r.stage),
    manque: () => 'BAT',
    attente: () => 'sans retour',
    dit: () => 'BAT envoye - pas encore valide par le client',
  },
  {
    cle: 'argent',
    label: 'Argent',
    requis: (r) => r.stage === 'production',
    // « CERTAINS ONT DES ACOMPTES » : couvert, ce n'est pas soldé — c'est soldé
    // OU un acompte demandé ET reçu. Un acompte demandé qui n'est pas versé ne
    // couvre rien.
    obtenu: (r) => r.paye === true || (r.acompte_demande === true && r.acompte_verse === true),
    manque: (r) => (r.acompte_demande === true ? 'Acompte' : 'Paiement'),
    attente: () => 'en production',
    dit: (r) => (r.acompte_demande === true
      ? (r.acompte_montant != null
        ? `Acompte de ${eur(Number(r.acompte_montant))} demande - pas encore recu`
        : 'Acompte demande - pas encore recu')
      : 'En production sans paiement ni acompte'),
  },
];

// CE QUI MANQUE À CE DOSSIER, dans l'ordre du parcours : le devis avant le BAT,
// le BAT avant l'argent. Une liste vide = rien ne bloque, et il n'y a rien à
// afficher.
// DEPUIS QUAND. « Il manque le devis » ne dit pas s'il faut relancer ; « parti,
// sans retour depuis 12 jours » le dit. On lit `updated_at` — la dernière fois
// que le dossier a bougé — et non le journal : le journal ne couvre pas le
// passé, il dirait MOINS que la colonne sur les dossiers d'avant sa mise en
// service.
function joursDepuis(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function feuDuDossier(r) {
  const jours = joursDepuis(r.updated_at);
  return FEU_FAITS.filter((f) => f.requis(r) && !f.obtenu(r))
    .map((f) => ({
      cle: f.cle,
      mot: f.manque(r),
      jours,
      // « 12 j » et non « depuis 12 jours » : la ligne en porte deja deux, et
      // c'est le NOMBRE qu'on cherche. RIEN le jour même — « Devis aujourd'hui »
      // se lit comme un devis A FAIRE aujourd'hui, et il n'y a de toute façon
      // personne a relancer sur un dossier qui vient de bouger.
      depuis: jours ? `${jours}\u00a0j` : '',
      dit: jours == null ? f.dit(r) : `${f.dit(r)} (${f.attente(r)} depuis ${jours} j)`,
    }));
}

export function blocFeu(r, attachTip) {
  const manque = feuDuDossier(r);
  if (!manque.length) return null;
  // LA MÊME GRILLE QUE LA FICHE DE PRODUCTION — c'est ce qui la fait lire comme
  // sa dernière ligne au lieu d'une pastille rapportée. Deux écrans à un clic
  // l'un de l'autre doivent donner le même composant ; ici, deux rangées d'une
  // même carte aussi. La bande de couleur, elle, déborde de dix pixels de
  // chaque côté SANS déplacer le texte (marge négative + rembourrage égal) :
  // les intitulés des cinq rangées restent alignés sur une seule colonne.
  const bloc = document.createElement('div');
  bloc.className = 'prod-fiche feu';
  const cle = document.createElement('span');
  cle.className = 'prod-fiche__cle feu__cle';
  cle.textContent = 'Manque';
  const val = document.createElement('span');
  val.className = 'prod-fiche__val';
  manque.forEach((m, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.textContent = ' · ';
      val.appendChild(sep);
    }
    const s = document.createElement('span');
    s.className = 'prod-fiche__fort';
    s.textContent = m.mot;
    val.appendChild(s);
  });
  // DEPUIS QUAND, UNE SEULE FOIS, À LA FIN. « Devis » ne dit pas s'il faut
  // relancer ; « Devis 12 j » le dit — et c'est la seule chose que la ligne
  // ajoute. Mais l'horloge est la MÊME pour les trois faits : elle sort d'un
  // seul `updated_at`. L'écrire après chaque mot donnait « Devis 21 j · BAT
  // 21 j » — le même nombre deux fois sur la même ligne, et deux lignes de
  // haut au lieu d'une dès que deux choses manquent.
  // L'ESPACE EST INSÉCABLE : « 21 j » ne se coupe pas entre le nombre et son
  // unité, et le nombre ne se retrouve pas seul sur la ligne suivante.
  const depuis = manque.find((m) => m.depuis);
  if (depuis) {
    const d = document.createElement('span');
    d.className = 'feu__depuis';
    d.textContent = `\u00a0${depuis.depuis}`;
    val.appendChild(d);
  }
  attachTip(bloc, manque.map((m) => m.dit).join(' · '));
  bloc.setAttribute('aria-label',
    `Avant la production, il manque : ${manque.map((m) => m.dit).join(' ; ')}`);
  bloc.append(cle, val);
  return bloc;
}

export function blocProduction(r, hiddenCols) {
  const p = r.fiche && r.fiche.prod;
  if (!p || typeof p !== 'object') return null;
  const bloc = document.createElement('div');
  bloc.className = 'prod-fiche';
  for (const fait of PROD_FAITS) {
    if (hiddenCols.has(fait.key)) continue;
    const parts = fait.lire(p, r);
    if (!parts.length) continue;
    const cle = document.createElement('span');
    cle.className = 'prod-fiche__cle';
    cle.textContent = typeof fait.label === 'function' ? fait.label(p) : fait.label;
    const val = document.createElement('span');
    val.className = 'prod-fiche__val';
    for (const m of parts) {
      const s = document.createElement('span');
      if (m.fort) s.className = 'prod-fiche__fort';
      s.textContent = m.t;
      val.appendChild(s);
    }
    bloc.append(cle, val);
  }
  return bloc.childElementCount ? bloc : null;
}
