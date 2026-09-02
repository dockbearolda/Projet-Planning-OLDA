// LE MENU DÉROULANT AVEC RECHERCHE, POUR TOUT L'ATELIER (extrait le 01/09/2026)
// ==========================================================================
// Charlie, en désignant le champ « Désignation » d'un article du devis :
// « ce input doit avoir OBLIGATOIREMENT une fonction recherche COMME TOUS LES
// INPUTS avec un menu déroulant ».
//
// « Comme tous les autres » est une CONSIGNE D'ARCHITECTURE, pas un souhait
// d'apparence — la même que celle qui a fait déménager `calendrier.js` le
// 30/08. Ce menu existait depuis le 27/08, mais il vivait dans
// `comptoir/pont.js`, le fichier des deux écrans du comptoir, que le CRM ne
// lit pas. Le recopier aurait donné deux menus qui se ressemblent, et qui
// divergent au premier correctif. Il déménage donc ici, dans le seul endroit
// que les TROIS écrans peuvent lire.
//
// CE QU'IL EST. Le <select> natif ne sait afficher ni deux colonnes, ni deux
// graisses, ni une pastille de couleur dans une option — et il tronque. On
// l'HABILLE au lieu de le remplacer : il reste dans la page, caché, et garde sa
// valeur, son `onchange` et les options que le formulaire écrit à la volée.
// Rien de ce qui lisait `champ.value` ne change.
//
// DEUX VARIANTES, UN SEUL PANNEAU :
//   · menu FERMÉ — habille un <select> ;
//   · menu LIBRE — habille un <input list="…">, qui reste saisissable.
//
// ⚠ AUCUN ACCENT GRAVE dans le littéral de feuille qui suit : il le refermerait
// et la feuille partirait NUE — le même piège que `calendrier.js` et les deux
// papiers. Elle ne pose que des JETONS de `charte.css`, que les trois écrans
// chargent.

const STYLE_MENU = `
/* ---- UN SEUL MODÈLE DE MENU DÉROULANT POUR TOUTE LA PAGE ------------------
   Le <select> natif ne sait afficher ni deux colonnes, ni deux graisses, ni
   une pastille de couleur dans une option — et il tronque. Il reste pourtant
   en place, caché : c'est lui qui porte la valeur, le \`onchange\` et les options
   que le formulaire écrit à la volée. Ce qui suit n'est qu'une PEAU.
   Deux variantes, même panneau : le menu fermé (on choisit dans la liste) et
   le menu libre (le champ reste saisissable — la vendeuse peut écrire une
   couleur qui n'est pas au catalogue). Poste PC : survol, focus, clavier. */
/* LA PEAU PREND LA PLACE DU CHAMP QU'ELLE ENVELOPPE, et le champ remplit la
   peau. Sans ces deux lignes, une case qui donnait sa largeur a son champ la
   donne desormais a la peau — et le champ, lui, retombe sur sa largeur
   intrinseque (≈ 20 caracteres). Mesure au rendu le 01/09 dans le devis : une
   designation a 218,5 px dans une case de 619. La regle vit ICI parce que
   c'est le composant qui enveloppe : chaque ecran qui la reecrirait chez lui
   la reecrirait de travers un jour sur deux. */
.menu{position:relative;flex:1 1 auto;min-width:0}
.menu>input{width:100%}
.menu>select,.menu>datalist{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden}
/* LE DÉCLENCHEUR EST UN <div> : il ÉCHAPPE au « input,select,textarea{padding:
   13px 14px!important} » que les deux écrans imposent, et se retrouvait 5 px
   plus court que l'<input> d'à côté sur la même ligne. Il reprend donc le même
   rembourrage, la même taille de texte et la même hauteur de ligne — jamais
   une hauteur en dur : sur un poste où Manrope n'est pas encore arrivée, la
   ligne de texte rétrécit, et les deux champs doivent rétrécir ENSEMBLE.
   Hauteur de ligne en RAPPORT et non en « normal » des deux côtés : Chrome ne
   calcule pas la boîte d'un <input> comme celle d'un <div>, et « normal » les
   laissait à 22 px contre 20,5. Et comme le déclencheur est une boîte FLEX,
   sa hauteur vient de ses enfants, pas de sa hauteur de ligne : d'où le
   min-height calculé — la ligne de texte (1.375em) plus le rembourrage et le
   trait, exactement la boîte d'un champ voisin, et qui suit la taille du
   texte si elle change. Le trait, sa couleur et son arrondi viennent
   de la même règle que les champs voisins — ils étaient plus fins, plus
   sombres et moins arrondis. */
/* LES VALEURS DE REPLI NE SERVENT PLUS QU'À LA CHARTE ABSENTE. Les DEUX
   écrans du comptoir chargent charte.css depuis le 23/08 : le déclencheur
   prend l'échelle et les couleurs de sa page, thème sombre compris. Elles
   restent parce qu'un fichier de style qui ne se charge pas ne doit pas rendre
   un écran illisible. Les 3 px du calcul sont les deux traits de 1,5. */
/* LA BOÎTE SE LIT, ELLE NE SE CALCULE PLUS (25/08). Ce déclencheur déduisait
   sa hauteur d'un rembourrage et d'un interligne — trois termes à garder
   d'accord avec ceux du champ d'à côté, et ils avaient fini par diverger de
   2,4 px. Il prend maintenant la boîte nommée de l'application, comme le
   champ, le bouton et la zone de texte. */
.menu-declencheur{display:flex;align-items:center;gap:11px;width:100%;padding:0 var(--champ-x);
  min-height:var(--ctrl-h);
  border:1.5px solid var(--border);border-radius:var(--arrondi-champ);background:var(--surface);cursor:pointer;text-align:left;
  font:inherit;font-size:var(--taille-texte);line-height:var(--ligne-serre);color:var(--text-1);transition:border-color var(--dur-1) var(--ease),box-shadow var(--dur-1) var(--ease)}
/* C'est la ligne de TEXTE qui donne sa hauteur au champ fermé : ni la
   référence ni la pastille ne doivent la dépasser, sinon le champ regrandit
   et l'alignement repart. */
.menu-declencheur .menu-jeton{font-size:var(--taille-texte);line-height:1.2;padding:1px 6px}
.menu-declencheur .menu-pastille{width:16px;height:16px}
.menu-declencheur:hover{border-color:var(--border-strong)}
.menu-declencheur:focus-visible{outline:3px solid rgba(var(--primary-rgb),.15);border-color:var(--primary)}
.menu.est-ouvert .menu-declencheur,.menu.est-ouvert>input{border-color:var(--primary);box-shadow:0 0 0 3px rgba(var(--primary-rgb),.10)}
/* Menu libre : le champ de saisie EST le déclencheur. Le chevron se pose
   par-dessus, la pastille de teinte à gauche — ni l'un ni l'autre ne prend le
   clic, il revient au champ, qui ouvre le menu.
   « !important » à contrecœur : les deux écrans imposent déjà
   « input,select,textarea{padding:13px 14px!important} », et sans ça le texte
   saisi passe SOUS le chevron et sous la pastille. */
.menu>.menu-pastille{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:20px;height:20px;pointer-events:none}
.menu.a-pastille>input{padding-left:42px!important}
/* LE DOIGT EST LE CURSEUR DE LA SOURIS, PAS UNE IMAGE POSÉE DANS LE CHAMP.
   Un champ qui propose un choix se clique — donc la main. Rien dans le champ :
   ni chevron, ni pictogramme, la place revient au texte saisi. Le déclencheur
   d'une liste porte déjà son curseur main ; c'est le champ LIBRE qui affichait
   un curseur de texte et se lisait comme une simple zone de frappe. */
.menu>input{cursor:pointer;caret-color:transparent}
/* CLIQUER OUVRE LA LISTE, ÇA NE COMMENCE PAS UNE SAISIE. Le trait clignotant
   qui apparaissait au clic disait le contraire et ramenait le champ à une
   zone de frappe ordinaire. Il ne revient qu'à la PREMIÈRE FRAPPE — taper
   reste possible, c'est le geste qui change d'intention, pas le champ. */
.menu>input.est-frappe{cursor:text;caret-color:auto}
/* La référence en chiffres alignés : c'est elle qui ouvre la ligne. */
/* La référence en GRAS, dans la police de la page. Elle était composée en
   chasse fixe pour aligner les colonnes ; le patron n'en veut pas — la graisse
   suffit à la faire ressortir de la désignation qui la suit. Les chiffres
   gardent leur largeur fixe (tabular-nums), c'est du réglage de chiffres, pas
   un changement de police. */
.menu-jeton{flex:none;font-size:var(--taille-texte);font-weight:var(--graisse-forte);font-variant-numeric:tabular-nums;
  /* UNE ETIQUETTE PREND LA PILULE. La charte n'admet que trois formes, et la
     forme dit le role : rectangle = ca agit, rond = une icone seule, pilule =
     une etiquette, un etat, un compteur. Une reference posee a cote d'un
     libelle est une etiquette ; elle etait ecrite en 6 px, une quatrieme forme.
     (Aucun accent grave ici : ce bloc est un gabarit, il le terminerait.) */
  color:var(--text-1);background:var(--border-soft);border-radius:var(--pilule);padding:4px 7px;white-space:nowrap}
/* UNE VALEUR CHOISIE NE SE LIT PAS COMME UN PLACEHOLDER. Les deux états
   pointaient sur le MÊME jeton (--text-2) : « OUI — 4 % » sortait dans le gris
   exact de « Choisir », et un menu rempli avait l'air vide — d'autant plus
   depuis que la TGCA arrive renseignée. La valeur prend l'encre du texte, le
   vide garde le gris des placeholders. (Les deux valeurs de repli, elles,
   disaient déjà la bonne chose : encre foncée d'un côté, gris de l'autre.) */
.menu-texte{flex:1 1 auto;min-width:0;font-size:var(--taille-texte);color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.menu-texte.est-vide{color:var(--text-2)}
/* Une pastille de couleur EST une information : elle dit la teinte que la
   vendeuse ne devinerait pas d'après « Wet Sand ». */
.menu-pastille{flex:none;width:18px;height:18px;border-radius:50%;border:1px solid var(--text-3);box-shadow:inset 0 0 0 1px var(--surface)}

/* POSITION FIXE, ET C'EST LE FOND DU PROBLÈME. En position absolue, le
   panneau restait DANS le conteneur qui défile : large de 560 px dans une
   cellule de 178, il comptait dans la largeur défilable de <main> quoi qu'on
   calcule, et le navigateur décalait <main> pour le montrer. Hors du flux du
   conteneur, il ne compte plus nulle part — et il ne peut plus être coupé.
   La largeur et la position sont posées par menuPlacer() : en position fixe,
   un pourcentage parlerait de la FENÊTRE, plus du champ.
   (Pas d'accent grave dans ce commentaire : ce bloc vit dans un littéral de
   gabarit, un accent grave le refermerait.) */
.menu-panneau{position:fixed;z-index:40;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--arrondi-bloc);overflow:hidden;display:none;
  box-shadow:var(--shadow-2)}
.menu.est-ouvert .menu-panneau{display:block;animation:menuEntre var(--dur-2) var(--ease)}
@keyframes menuEntre{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}

.menu-tete{display:flex;align-items:center;gap:10px;padding:10px;background:var(--zone-bg);border-bottom:1px solid var(--border-soft)}
.menu-tete input{font-size:var(--taille-texte);padding:9px 11px}
/* ON CHERCHE DANS LA BULLE, PAS DANS UN CHAMP DE PLUS (27/08/2026).
   Le filtre vivait en tête du panneau : cliquer ouvrait une liste, puis il
   fallait descendre d'un cran pour taper — un deuxième champ pour la même
   question, et il ne s'affichait que sur la liste des références. Il se pose
   maintenant SUR le déclencheur, à sa place exacte : la bulle devient un champ
   de saisie, le curseur y est déjà, on tape. C'est ce que fait n'importe quel
   bon sélecteur, et ça vaut pour TOUS les menus.
   Il épouse la boîte du déclencheur — même hauteur, même rembourrage, même
   arrondi — pour que rien ne bouge à l'ouverture. */
.menu-filtre{display:none}
.menu.est-ouvert>.menu-filtre{
  display:block;position:absolute;left:0;top:0;width:100%;
  min-height:var(--ctrl-h);height:var(--ctrl-h);
  padding:0 var(--champ-x);margin:0;
  border:1.5px solid var(--primary);border-radius:var(--arrondi-champ);
  background:var(--surface);color:var(--text-1);
  font:inherit;font-size:var(--taille-texte);line-height:var(--ligne-serre);
  box-shadow:0 0 0 3px rgba(var(--primary-rgb),.10);
  outline:none;z-index:1}
/* Ce qui était choisi reste lisible pendant qu'on cherche : il devient
   l'invite du champ. Sans ça, ouvrir un menu efface sous les yeux la valeur
   qu'on venait vérifier. */
.menu.est-ouvert>.menu-filtre::placeholder{color:var(--text-2)}
.menu-compte{flex:none;font-size:var(--taille-texte);font-weight:var(--graisse-note);color:var(--text-2);font-variant-numeric:tabular-nums;white-space:nowrap}
/* LE DEFILEMENT S'ARRETE AU BAS DE LA LISTE. Sans overscroll-behavior, la
   molette poursuivie en bout de liste part dans la page derriere — et comme
   un defilement d'ecran referme le menu, la liste se fermait au moment ou
   l'on cherchait le dernier article. */
/* PAS DE REMBOURRAGE EN HAUT : c'est la zone qui defile, et le titre collant
   s'y arrete a zero. Les six pixels qu'il y avait la laissaient passer une
   bande de liste AU-DESSUS du titre — une demi-ligne de texte qui flottait au
   ras du panneau. Le blanc du haut est rendu par le titre lui-meme. */
.menu-liste{max-height:326px;overflow-y:auto;overscroll-behavior:contain;margin:0;padding:0 6px 6px;list-style:none}
/* CHAQUE FAMILLE EST SON PROPRE BLOC, et c'est ce qui fait tenir le titre
   collant. Un titre en position collante ne sort jamais de son bloc englobant :
   dans une seule liste, les treize titres se collaient au MEME endroit et s'y
   empilaient — mesure : trois titres a 374 px en meme temps. Comme ils n'ont
   pas tous la meme hauteur, celui de dessous depassait, et la liste se lisait
   au travers. Emboite, chaque titre est pousse dehors par le suivant. */
.menu-famille{list-style:none}
.menu-famille-liste{margin:0;padding:0;list-style:none}
/* Le titre de famille reste collé en haut pendant le défilement : 48
   références sur 13 familles, sans ça on ne sait plus dans quoi on est.
   Sur UNE ligne, toujours : deux titres de hauteurs differentes au meme
   endroit, c'est le defaut d'avant qui revient par la bande. */
.menu-groupe{position:sticky;top:0;z-index:1;background:var(--surface);padding:13px 10px 5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  font-size:var(--taille-texte);font-weight:var(--graisse-forte);letter-spacing:.09em;text-transform:uppercase;color:var(--text-2)}
.menu-option{display:flex;align-items:baseline;gap:12px;padding:9px 10px 9px 8px;
  border-left:3px solid transparent;border-radius:8px;cursor:pointer}
/* La colonne des références : un PLANCHER, pas une largeur fixe. « PARAGON
   218T » fait 98 px en Manrope gras et débordait sur la désignation, qui
   venait s'écrire par-dessus. Le plancher garde les courtes alignées, les
   longues poussent leur seule ligne — jamais de texte coupé sur une
   référence, c'est elle qui identifie l'article. */
.menu-option .menu-jeton{background:transparent;padding:0;min-width:100px;flex:none}
.menu-option .menu-pastille{align-self:center}
.menu-option-texte{flex:1 1 auto;min-width:0;font-size:var(--taille-texte);color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Deux états distincts : le curseur du clavier (gris plein) et le choix en
   cours (barre d'encre + texte en gras). Aucune couleur ici n'est décorative. */
.menu-option.est-vise{background:var(--surface-hover)}
.menu-option[aria-selected="true"]{border-left-color:var(--text-1);background:var(--zone-bg)}
.menu-option[aria-selected="true"] .menu-option-texte{color:var(--text-1);font-weight:var(--graisse-forte)}
.menu-rien{padding:22px 14px;text-align:center;color:var(--text-2);font-size:var(--taille-texte)}
/* ---- LES DEUX METIERS DE LA MAISON ---------------------------------------
   Charlie, 01/09 : « y'a 2 parties dans mon entreprise, Textiles et le reste ;
   dans le menu deroulant je veux pouvoir switch entre les 2 familles ».
   Une rangee de bascules, pas des pilules : la charte reserve la pilule a ce
   qui ETIQUETTE, et ceci AGIT — c'est un rectangle arrondi. Chaque bouton
   prend la boite serree de la charte, la meme que « Renommer » ou
   « Recalculer », et ils la prennent dans UNE regle. */
.menu-onglets{display:flex;gap:var(--pas-1);padding:10px;border-bottom:1px solid var(--border-soft);background:var(--zone-bg)}
.menu-onglets[hidden]{display:none}
.menu-onglet{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:var(--pas-1);
  min-height:var(--ctrl-h-serre);padding:var(--champ-y-serre) var(--pas-2);
  border:1px solid var(--border);border-radius:var(--arrondi-champ);
  background:var(--surface);color:var(--text-2);
  font:inherit;font-size:var(--taille-texte);line-height:var(--ligne-serre);font-weight:var(--graisse-note);
  white-space:nowrap;cursor:pointer;
  transition:color var(--dur-1) var(--ease),background var(--dur-1) var(--ease),border-color var(--dur-1) var(--ease)}
.menu-onglet:hover{color:var(--text-1);background:var(--surface-hover)}
.menu-onglet.est-actif{color:var(--on-primary);background:var(--primary);border-color:var(--primary)}
.menu-onglet-compte{font-variant-numeric:tabular-nums;opacity:.75}
/* CE QUI EST DE L'AUTRE COTE SE DIT, ET SE FRANCHIT D'UN CLIC. Chercher
   « NS300 » depuis « Boutique » ne rendait rien, alors que la reponse etait a
   un clic — et l'ecran n'en disait pas un mot. */
.menu-ailleurs{padding:0 14px 18px;text-align:center}
.menu-ailleurs-lien{min-height:var(--ctrl-h-serre);padding:var(--champ-y-serre) var(--pas-2);
  border:1px solid var(--border);border-radius:var(--arrondi-champ);
  background:var(--surface);color:var(--text-1);
  font:inherit;font-size:var(--taille-texte);line-height:var(--ligne-serre);font-weight:var(--graisse-note);
  cursor:pointer;transition:background var(--dur-1) var(--ease)}
.menu-ailleurs-lien:hover{background:var(--surface-hover)}
/* L'AJOUT MANUEL — la même ligne, au même endroit, dans TOUS les menus.
   Avant, trois listes portaient leur propre « produit libre » noyé au milieu
   du catalogue, les autres n'en avaient aucun : on ne savait jamais où
   chercher. Elle est épinglée AU-DESSUS du filtre, hors de la liste, donc ni
   emportée par une recherche ni repoussée par le défilement. */
/* Une ligne, pas une bannière : un « + » et un mot. Elle doit se voir sans
   se mettre devant la liste — c'est un raccourci, pas la réponse attendue. */
.menu-manuel{display:flex;align-items:center;gap:7px;width:100%;padding:8px 12px;border:0;
  border-bottom:1px solid var(--border-soft);background:var(--surface);font:inherit;font-size:var(--taille-texte);font-weight:var(--graisse-note);
  color:var(--text-2);text-align:left;cursor:pointer}
.menu-manuel:hover,.menu-manuel:focus-visible{background:var(--zone-bg);color:var(--text-1);outline:none}
.menu-plus{flex:none;font-size:var(--taille-texte);font-weight:var(--graisse-forte);line-height:1;color:inherit}
.menu-saisie{display:none;gap:8px;padding:10px;border-bottom:1px solid var(--border-soft);background:var(--zone-bg)}
.menu-saisie input{flex:1 1 auto;min-width:0;font-size:var(--taille-texte);padding:9px 11px}
.menu-saisie button{flex:none;border:0;border-radius:var(--arrondi-champ);padding:9px 14px;background:var(--text-1);
  color:var(--on-primary);font:inherit;font-weight:var(--graisse-forte);cursor:pointer}
/* Pendant la saisie libre, la liste s'efface : deux façons de répondre à la
   même question en même temps, c'est une hésitation de plus au comptoir. */
.menu.est-saisie .menu-saisie{display:flex}
.menu.est-saisie .menu-manuel,.menu.est-saisie .menu-tete,.menu.est-saisie .menu-liste{display:none}
/* Un menu fermé n'a pas de champ à rougir : c'est sa peau qui porte l'erreur.
   Mais .invalid est une règle GÉNÉRALE, écrite pour un <input>, et elle
   pose son cadre et son fond en !important : sur l'enveloppe — qui n'a
   aucun arrondi — elle dessinait un SECOND rectangle rouge, à angles droits,
   autour de la bulle déjà rougie. L'enveloppe porte la classe, la bulle
   porte le rouge. (Elle gagne : deux classes valent mieux qu'une.) */
.menu.invalid{border:0!important;background:transparent!important;box-shadow:none!important}
/* UN MENU EN ERREUR NE BOUGE PAS NON PLUS. Le déclencheur calcule sa hauteur
   minimale à partir de ses DEUX traits de 1,5 px (« + 3px ») : un trait de
   2 px le poussait à 50,6 px pendant que ses voisins restaient à 49,6. Le
   trait garde sa largeur, l'anneau fait l'épaisseur — il ne prend pas de place. */
.menu.invalid .menu-declencheur{border:1.5px solid var(--danger);background:var(--danger-bg);box-shadow:0 0 0 1px var(--danger)}
@media(prefers-reduced-motion:reduce){.menu.est-ouvert .menu-panneau{animation:none}.menu-declencheur{transition:none}}
`;

/* LA FEUILLE PART AVEC LE COMPOSANT, et une seule fois : les deux ecrans du
   comptoir et le CRM peuvent tous les trois l'importer, dans n'importe quel
   ordre. */
export function poserStyleMenu() {
  if (document.getElementById('olda-menu-style')) return;
  const s = document.createElement('style');
  s.id = 'olda-menu-style';
  s.textContent = STYLE_MENU;
  document.head.appendChild(s);
}

/* ---- UN SEUL MODÈLE DE MENU DÉROULANT -------------------------------------
   Le <select> natif ne sait afficher ni deux colonnes, ni deux graisses, ni une
   pastille de couleur — et il tronque. On l'HABILLE au lieu de le remplacer :
   il reste dans la page, caché, et garde sa valeur, son `onchange` et les
   options que le formulaire écrit à la volée. Résultat : rien de ce qui lisait
   `$('x').value` ne change, et les vingt menus de la page se ressemblent.

   Deux variantes, un seul panneau :
   - menu FERMÉ  — habille un <select>. La valeur vient de la liste.
   - menu LIBRE  — habille un <input list="…">. Le champ reste saisissable : la
     vendeuse peut écrire une couleur qui n'est pas au catalogue.

   Une option porte, au choix : `data-ref` (jeton de référence, en tête de
   ligne) et `data-hex` (pastille de teinte). Les <optgroup> deviennent les
   titres de famille. */

  const menus = new Map();       /* hôte → état, pour retrouver un menu déjà posé */
  let menuRang = 0;              /* de quoi nommer la liste d'un hôte sans id */

/* Cinq listes portaient DÉJÀ leur propre entrée libre, sous trois valeurs
   conventionnelles différentes. On les reconnaît au lieu de les étiqueter une
   à une : une liste qui en gagne une demain est prise en charge sans rien
   changer ici. `data-menu-manuel` reste le moyen de le dire à la main. */
const MENU_VALEURS_LIBRES=['__new__','__manuel','__CUSTOM__'];
function menuRenvoiManuel(hote){
  if(hote.dataset.menuManuel!==undefined)return hote.dataset.menuManuel;
  if(hote.tagName!=='SELECT')return undefined;
  const o=[...hote.options].find(o=>MENU_VALEURS_LIBRES.includes(o.value));
  return o?o.value:undefined;
}

function menuNorm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')}

/* CE QU'UNE RECHERCHE DOIT COMPRENDRE (27/08/2026).
   « NS300 », « ns 300 », « n ns 300 », « NS-300 », « ns3 » désignent tous la
   même référence, et personne ne les tape deux fois de la même façon. On
   RÉDUIT donc les deux côtés à leurs lettres et à leurs chiffres avant de
   comparer : la casse, les accents, les espaces, les tirets et les points ne
   veulent rien dire dans un code. */
function menuReduire(s){return menuNorm(s).replace(/[^a-z0-9]+/g,'')}

/* Combien une option répond à ce qu'on a tapé. -1 = elle ne répond pas.
   Le RANG compte autant que le filtre : taper « ns3 » doit faire remonter
   NS300 avant un texte qui contient « ns3 » au milieu d'une phrase. */
function menuScore(o,q){
  const mots=String(q||'').split(/\s+/).map(menuReduire).filter(Boolean);
  if(!mots.length)return 0;
  const jeton=menuReduire(o.jeton);
  const foin=menuReduire(`${o.jeton} ${o.texte} ${o.groupe} ${o.cherche}`);
  /* Chaque morceau tapé doit se retrouver quelque part — c'est ce qui fait
     marcher « n ns 300 » aussi bien que « ns300 ». */
  if(!mots.every(m=>foin.includes(m)))return -1;
  const tout=mots.join('');
  if(jeton&&jeton.startsWith(tout))return 3;   /* la référence, par son début */
  if(jeton&&jeton.includes(tout))return 2;     /* la référence, plus loin */
  if(foin.startsWith(tout))return 1;           /* le libellé, par son début */
  return 0;
}

/* Les options telles qu'elles existent à l'instant T. On les relit à CHAQUE
   ouverture : `txPopulateSelects` et `onTextileRefChange` réécrivent le contenu
   des <select> et des <datalist> en cours de route. */
function menuOptions(hote){
  if(hote.tagName==='SELECT'){
    const sorties=[];
    [...hote.children].forEach(n=>{
      if(n.tagName==='OPTGROUP'){
        [...n.children].forEach(o=>sorties.push(menuOption(o,n.label)));
      }else if(n.tagName==='OPTION'){
        sorties.push(menuOption(n,''));
      }
    });
    return sorties;
  }
  const source=document.getElementById(hote.dataset.menuListe||hote.getAttribute('list'));
  return source?[...source.options].map(o=>menuOption(o,'')):[];
}
function menuOption(o,groupe){
  return {
    valeur:o.value,
    /* Une option de <datalist> n'a pas de texte : c'est sa valeur qu'on lit. */
    texte:(o.textContent||'').trim()||o.value,
    jeton:o.dataset.ref||'',
    hex:o.dataset.hex||'',
    /* CE QU'ON CHERCHE SANS L'AFFICHER. La liste des clients se lit en une
       colonne de NOMS — le téléphone et l'e-mail à côté de chacun n'aidaient
       personne à reconnaître son client, ils allongeaient chaque ligne. Mais
       le champ de filtre promet « nom, téléphone, e-mail » : ils restent donc
       cherchables, posés en `data-cherche` sur l'option. */
    cherche:o.dataset.cherche||'',
    /* L'ONGLET est une famille GROSSIERE, au-dessus des groupes. Charlie,
       01/09 : « y'a 2 parties dans mon entreprise, Textiles et le reste ; dans
       le menu deroulant je veux pouvoir switch entre les 2 familles ». Les
       <optgroup> disent les rayons (huit, plus le textile) ; ceci dit les
       METIERS. Une option sans onglet se montre dans tous — c'est le cas du
       choix vide. */
    onglet:o.dataset.onglet||'',
    groupe,
  };
}

function menuPoser(hote){
  if(menus.has(hote))return menus.get(hote);
  const libre=hote.tagName!=='SELECT';
  const peau=document.createElement('div');
  peau.className='menu';
  hote.replaceWith(peau);
  peau.append(hote);

  let declencheur;
  if(libre){
    /* Le champ de saisie EST le déclencheur : cliquer ouvre, taper filtre.
       On DÉBRANCHE la liste native : tant que `list` reste posé, Chrome ouvre
       la sienne — fond sombre, deuxième chevron — par-dessus la nôtre. Le
       <datalist> reste dans la page (le formulaire le remplit par son id), on
       ne fait que retenir son nom ici. `autocomplete=off` coupe en plus la
       liste de saisies mémorisées par le navigateur, qui se superposerait
       pareil. */
    if(hote.getAttribute('list')){
      hote.dataset.menuListe=hote.getAttribute('list');
      hote.removeAttribute('list');
    }
    hote.setAttribute('autocomplete','off');
    declencheur=hote;
  }else{
    declencheur=document.createElement('div');
    declencheur.className='menu-declencheur';
    declencheur.setAttribute('role','combobox');
    declencheur.setAttribute('tabindex','0');
    declencheur.setAttribute('aria-haspopup','listbox');
    declencheur.setAttribute('aria-expanded','false');
    /* Le <label for="…"> du formulaire vise le <select> caché : on renvoie le
       nom accessible sur lui pour que le déclencheur s'annonce quand même. */
    const etiquette=document.querySelector(`label[for="${hote.id}"]`);
    if(etiquette)declencheur.setAttribute('aria-label',etiquette.textContent.trim());
    peau.append(declencheur);
    hote.setAttribute('tabindex','-1');
    hote.setAttribute('aria-hidden','true');
  }

  const panneau=document.createElement('div');
  panneau.className='menu-panneau';
  const tete=document.createElement('div');
  tete.className='menu-tete';
  const filtre=document.createElement('input');
  filtre.type='text';filtre.autocomplete='off';filtre.spellcheck=false;
  filtre.className='menu-filtre';
  filtre.placeholder=hote.dataset.menuFiltre||'Filtrer…';
  filtre.setAttribute('aria-label','Filtrer la liste');
  const compte=document.createElement('span');
  compte.className='menu-compte';
  /* Le filtre ne vit plus dans le panneau : il se pose SUR le déclencheur
     (voir la règle .menu.est-ouvert>.menu-filtre). L'entête du panneau ne garde
     que le compteur. */
  tete.append(compte);
  const liste=document.createElement('ul');
  liste.className='menu-liste';
  liste.setAttribute('role','listbox');
  liste.id=`${hote.id||'menu'+(++menuRang)}__liste`;
  declencheur.setAttribute('aria-controls',liste.id);
  /* Une liste dont la valeur est un CODE — un coefficient, un délai en jours,
     une heure, une clé de barème — porte `data-menu-manuel-non` : `DB.times[x]`
     rend `{}` pour une valeur inconnue, le prix tomberait à zéro SANS erreur.
     Une liste qui a déjà son entrée libre gérée par le formulaire porte
     `data-menu-manuel="<valeur de cette option>"` : la ligne l'y renvoie au
     lieu d'en inventer une deuxième. */
  const avecManuel=!hote.hasAttribute('data-menu-manuel-non');
  const manuel=document.createElement('button');
  manuel.type='button';
  manuel.className='menu-manuel';
  const plus=document.createElement('span');
  plus.className='menu-plus';plus.setAttribute('aria-hidden','true');plus.textContent='+';
  const motManuel=hote.dataset.menuManuelTexte||'Ajouter';
  const mot=document.createElement('span');
  mot.textContent=motManuel;
  manuel.append(plus,mot);

  /* UNE LISTE PEUT PORTER UNE ACTION QUI N'EST PAS UNE VALEUR. « + Ajouter »
     range ce qu'on tape DANS la liste ; « + Créer un nouveau client » ne le
     peut pas — un client, c'est un nom, un téléphone, un e-mail, un secteur,
     donc un formulaire. Le raccourci se lit pourtant au même endroit et de la
     même façon : `data-menu-action="<le mot>"` pose la ligne, le clic ferme le
     menu et laisse un évènement `menu-action` sur le <select>. La page décide
     de ce qui s'ouvre ; le menu, lui, n'en sait rien. */
  const motAction=hote.dataset.menuAction;
  let action=null;
  if(motAction){
    action=document.createElement('button');
    action.type='button';
    action.className='menu-manuel';
    const plusAction=document.createElement('span');
    plusAction.className='menu-plus';
    plusAction.setAttribute('aria-hidden','true');
    plusAction.textContent='+';
    const motAct=document.createElement('span');
    motAct.textContent=motAction;
    action.append(plusAction,motAct);
  }

  const saisie=document.createElement('div');
  saisie.className='menu-saisie';
  const champLibre=document.createElement('input');
  champLibre.type='text';champLibre.autocomplete='off';
  champLibre.placeholder='À ajouter…';
  champLibre.setAttribute('aria-label',motManuel);
  const valider=document.createElement('button');
  valider.type='button';valider.textContent='Valider';
  saisie.append(champLibre,valider);

  /* LA MÊME LIGNE PARTOUT, champ libre compris : un panneau de menu, c'est
     « + Ajouter » puis la liste, et rien d'autre. La mention qui expliquait
     qu'on pouvait écrire dans le champ est partie avec — un deuxième message
     au même endroit, formulé autrement, c'est déjà une hésitation. */
  /* LA RANGEE D'ONGLETS. Vide tant que les options ne declarent pas
     `data-onglet` — elle ne coute alors rien et ne se voit pas. Elle est POSEE
     ici et remplie a chaque peinture : le formulaire reecrit ses options en
     cours de route (le catalogue arrive apres l'ecran), et une rangee batie une
     seule fois manquerait la moitie des metiers. */
  const onglets=document.createElement('div');
  onglets.className='menu-onglets';
  onglets.setAttribute('role','tablist');
  onglets.hidden=true;
  if(action)panneau.append(action);
  if(avecManuel)panneau.append(manuel,saisie);
  panneau.append(onglets,tete,liste);
  peau.append(panneau);
  /* Posé APRÈS le panneau : il se superpose au déclencheur, pas au panneau. */
  if(!libre)peau.append(filtre);

  const etat={hote,libre,peau,declencheur,panneau,tete,filtre,compte,liste,onglets,
    avecManuel,manuel,saisie,champLibre,action,vus:[],vise:-1,ouvert:false,filtrer:false,
    /* '' = pas d'onglet actif, donc tout. C'est l'etat d'un menu qui n'en a
       pas, et celui d'un menu qui n'a pas encore ete ouvert. */
    onglet:''};
  menus.set(hote,etat);

  declencheur.addEventListener('click',()=>etat.ouvert?menuFermer(etat,false):menuOuvrir(etat));
  declencheur.addEventListener('keydown',ev=>menuTouche(etat,ev));
  if(libre){
    hote.addEventListener('input',()=>{etat.filtrer=true;etat.vise=0;if(etat.ouvert)menuPeindre(etat);menuPeindreChamp(etat)});
    /* Une touche qui écrit rend le trait ; un clic le reprend. `keydown` et
       non `input` : le trait doit être là AVANT que le caractère ne s'écrive,
       sinon il apparaît une frappe en retard. */
    hote.addEventListener('keydown',ev=>{
      if(ev.key.length===1||ev.key==='Backspace'||ev.key==='Delete')hote.classList.add('est-frappe');
    });
    hote.addEventListener('pointerdown',()=>hote.classList.remove('est-frappe'));
  }else{
    filtre.addEventListener('input',()=>{etat.vise=0;menuPeindre(etat)});
    filtre.addEventListener('keydown',ev=>menuTouche(etat,ev));
  }
  liste.addEventListener('click',ev=>{
    const li=ev.target.closest('[data-valeur]');
    if(li)menuChoisir(etat,li.dataset.valeur);
  });
  if(action){
    action.addEventListener('click',()=>{
      menuFermer(etat,false);
      hote.dispatchEvent(new CustomEvent('menu-action',{bubbles:true}));
    });
    /* Échap depuis le bouton referme le menu et rend le focus au champ, comme
       depuis la liste : une fois entré au clavier, on doit pouvoir ressortir. */
    action.addEventListener('keydown',ev=>{
      if(ev.key==='Escape'){ev.preventDefault();menuFermer(etat,true)}
    });
  }
  manuel.addEventListener('click',()=>menuManuelOuvrir(etat));
  valider.addEventListener('click',()=>menuManuelValider(etat));
  champLibre.addEventListener('keydown',ev=>{
    if(ev.key==='Enter'){ev.preventDefault();menuManuelValider(etat)}
    else if(ev.key==='Escape'){ev.preventDefault();menuManuelFermer(etat)}
  });
  /* Le survol déplace le curseur du clavier : sinon la souris éclaire une ligne
     et Entrée en valide une autre. */
  liste.addEventListener('mousemove',ev=>{
    const li=ev.target.closest('.menu-option');
    if(!li)return;
    const i=Number(li.dataset.rang);
    if(i!==etat.vise){etat.vise=i;menuPeindreVise(etat,false)}
  });
  menuPeindreChamp(etat);
  return etat;
}

/* Ce que le champ montre quand le menu est fermé. */
function menuPeindreChamp(etat){
  const {hote,libre,declencheur,peau}=etat;
  if(libre){
    /* Une pastille à gauche du champ : « Wet Sand » ne dit rien sans la teinte.
       Elle ne s'allume que sur une correspondance exacte — pas de pastille =
       coloris hors catalogue, ce qui est une information. */
    const cle=menuNorm(hote.value).trim();
    const trouve=cle?menuOptions(hote).find(o=>menuNorm(o.texte).trim()===cle):null;
    let pastille=peau.querySelector(':scope > .menu-pastille');
    if(trouve&&trouve.hex){
      if(!pastille){pastille=document.createElement('span');pastille.className='menu-pastille';
        pastille.setAttribute('aria-hidden','true');peau.append(pastille)}
      pastille.style.background=trouve.hex;
      peau.classList.add('a-pastille');
    }else{
      if(pastille)pastille.remove();
      peau.classList.remove('a-pastille');
    }
    return;
  }
  const choisie=menuOptions(hote).find(o=>o.valeur===hote.value);
  declencheur.replaceChildren();
  if(choisie&&choisie.jeton){
    const j=document.createElement('span');j.className='menu-jeton';j.textContent=choisie.jeton;
    declencheur.append(j);
  }
  if(choisie&&choisie.hex){
    const p=document.createElement('span');p.className='menu-pastille';p.style.background=choisie.hex;
    declencheur.append(p);
  }
  /* UNE OPTION QUI PORTE UNE RÉFÉRENCE SE SUFFIT À ELLE-MÊME dans le champ :
     « NS401 » identifie l'article, la désignation qui la suivait mangeait la
     largeur et finissait en points de suspension. Elle est écrite en tête du
     bloc, et l'infobulle porte toujours les deux. */
  if(!(choisie&&choisie.jeton)){
    const t=document.createElement('span');
    t.className='menu-texte'+(choisie&&choisie.valeur?'':' est-vide');
    t.textContent=choisie?choisie.texte:'Choisir…';
    declencheur.append(t);
  }
  /* Le texte est coupé à l'ellipse dans un champ étroit : l'infobulle rend la
     ligne entière sans avoir à rouvrir la liste. */
  declencheur.title=choisie&&choisie.valeur?[choisie.jeton,choisie.texte].filter(Boolean).join(' — '):'';
}

/* CE QUI EST RÉELLEMENT PROPOSÉ, relu à chaque ouverture — le formulaire
   réécrit les options en cours de route. Deux lignes n'en sont pas :
   - l'entrée libre est déjà épinglée en tête du panneau, elle n'y est pas deux
     fois ;
   - « — Choisir une référence — », « Sélectionner une option », « Non
     précisée »… tant que RIEN n'est choisi, c'est exactement ce que le champ
     fermé affiche déjà : une ligne de plus qui ne choisit rien. Elle revient
     dès qu'une vraie valeur est prise, parce qu'elle devient alors le seul
     chemin de retour — sur « Délai souhaité », « Non précisée » n'est pas un
     libellé d'attente, c'est une réponse. */
function menuProposees(etat){
  const renvoi=menuRenvoiManuel(etat.hote);
  const rienChoisi=etat.hote.value==='';
  return menuOptions(etat.hote).filter(o=>
    (renvoi===undefined||o.valeur!==renvoi) && !(rienChoisi&&o.valeur===''));
}

/* Les onglets presents, dans l'ordre du formulaire. Moins de deux : il n'y a
   rien a basculer, et une rangee d'un seul bouton est un bouton qui ne fait
   rien. */
function menuOngletsDe(etat){
  const vus=[];
  for(const o of menuProposees(etat)){
    if(o.onglet&&!vus.includes(o.onglet))vus.push(o.onglet);
  }
  return vus.length>1?vus:[];
}

/* Ce que l'onglet actif laisse passer. Une option sans onglet traverse : le
   choix vide et la saisie manuelle appartiennent aux deux metiers. */
function menuDeLOnglet(etat,liste){
  if(!etat.onglet)return liste;
  return liste.filter(o=>!o.onglet||o.onglet===etat.onglet);
}

function menuFiltrees(etat){
  const toutes=menuDeLOnglet(etat,menuProposees(etat));
  /* Un champ libre ne filtre QU'À PARTIR de la première frappe : à l'ouverture
     il contient déjà une valeur, et filtrer dessus ne laisserait voir que cette
     valeur-là — cliquer doit montrer toute la liste. */
  const brut=etat.libre?(etat.filtrer?etat.hote.value:''):etat.filtre.value;
  const q=String(brut||'').trim();
  if(!q)return toutes;
  /* On garde ce qui répond, et on remonte ce qui répond LE MIEUX. Le tri est
     stable : à score égal, la liste garde l'ordre du formulaire. */
  return toutes
    .map((o,i)=>({o,s:menuScore(o,q),i}))
    .filter(x=>x.s>=0)
    .sort((a,b)=>b.s-a.s||a.i-b.i)
    .map(x=>x.o);
}

/* La rangee d'onglets, repeinte a chaque peinture. Elle porte le compte de
   CHAQUE metier — pas seulement de celui qu'on regarde : c'est la seule facon
   de savoir qu'il y a quelque chose de l'autre cote sans y aller. */
function menuPeindreOnglets(etat){
  const noms=menuOngletsDe(etat);
  etat.onglets.hidden=!noms.length;
  if(!noms.length){etat.onglet='';etat.onglets.replaceChildren();return}
  if(!noms.includes(etat.onglet))etat.onglet=noms[0];
  const brut=etat.libre?(etat.filtrer?etat.hote.value:''):etat.filtre.value;
  const q=String(brut||'').trim();
  const toutes=menuProposees(etat);
  etat.onglets.replaceChildren(...noms.map((nom)=>{
    const b=document.createElement('button');
    b.type='button';
    b.className='menu-onglet'+(nom===etat.onglet?' est-actif':'');
    b.setAttribute('role','tab');
    b.setAttribute('aria-selected',String(nom===etat.onglet));
    const t=document.createElement('span');
    t.textContent=nom;
    b.append(t);
    /* Le compte ne s'affiche que pendant une recherche : au repos, deux
       nombres a cote de deux mots sont deux mots de plus a lire. */
    if(q){
      const n=toutes.filter(o=>o.onglet===nom&&menuScore(o,q)>=0).length;
      const c=document.createElement('span');
      c.className='menu-onglet-compte';
      c.textContent=String(n);
      b.append(c);
    }
    b.addEventListener('click',(ev)=>{
      ev.preventDefault();ev.stopPropagation();
      etat.onglet=nom;
      etat.vise=0;
      menuPeindre(etat);
      /* On rend la frappe au filtre : basculer de metier n'est pas finir de
         chercher. */
      if(!etat.libre)etat.filtre.focus(); else etat.hote.focus();
    });
    return b;
  }));
}

function menuPeindre(etat){
  menuPeindreOnglets(etat);
  const vus=menuFiltrees(etat);
  etat.vus=vus;
  etat.vise=Math.min(Math.max(etat.vise,0),vus.length-1);

  /* Le compteur porte sur ce qui est PROPOSÉ, pas sur le contenu brut du
     <select> : il affichait « 49 / 50 » alors que rien n'était filtré. */
  const toutes=menuDeLOnglet(etat,menuProposees(etat)).length;
  /* UNE SEULE RECHERCHE SUR L'ÉCRAN, celle de la référence — c'est la seule
     liste qu'on ne parcourt pas des yeux. Partout ailleurs le champ de filtre
     et son compteur sont un deuxième champ dans le champ : on le pose donc à
     la main, avec `data-menu-recherche`, et jamais par un seuil qui décide
     tout seul. Un menu libre, lui, se filtre en tapant dans le champ. */
  /* Le compteur ne se montre QUE pendant une recherche : au repos, « 49 choix »
     sur une liste qu'on a sous les yeux est un mot de plus à lire. Il dit alors
     ce qui reste, ce qui est la seule chose utile à ce moment-là. */
  const cherche=!etat.libre&&etat.filtre.value.trim()!=='';
  etat.tete.style.display=cherche?'':'none';
  if(cherche)etat.compte.textContent=`${vus.length} / ${toutes}`;

  const noeuds=[];
  if(!vus.length){
    const rien=document.createElement('li');
    rien.className='menu-rien';rien.setAttribute('role','presentation');
    rien.textContent=etat.libre?'Aucun choix ne correspond — la saisie reste libre.':'Aucun choix ne correspond.';
    noeuds.push(rien);
    /* ⚠ UNE IMPASSE SE DIT. Chercher « NS300 » depuis « Boutique » ne rendait
       RIEN, alors que la reponse est a un clic — et rien a l'ecran ne disait
       qu'elle etait de l'autre cote. On ne bascule pas tout seul (un menu qui
       change de metier sous les doigts est pire), on le PROPOSE. */
    const brut=etat.libre?(etat.filtrer?etat.hote.value:''):etat.filtre.value;
    const q=String(brut||'').trim();
    if(q){
      const toutes=menuProposees(etat);
      for(const nom of menuOngletsDe(etat)){
        if(nom===etat.onglet)continue;
        const n=toutes.filter(o=>o.onglet===nom&&menuScore(o,q)>=0).length;
        if(!n)continue;
        const li=document.createElement('li');
        li.className='menu-ailleurs';li.setAttribute('role','presentation');
        const b=document.createElement('button');
        b.type='button';
        b.className='menu-ailleurs-lien';
        b.textContent=`${n} dans « ${nom} »`;
        b.addEventListener('click',(ev)=>{
          ev.preventDefault();ev.stopPropagation();
          etat.onglet=nom;etat.vise=0;menuPeindre(etat);
          if(!etat.libre)etat.filtre.focus(); else etat.hote.focus();
        });
        li.append(b);
        noeuds.push(li);
      }
    }
  }
  /* UNE FAMILLE, UN BLOC. Le titre collant doit pouvoir SORTIR quand sa famille
     est passée : un `position:sticky` ne quitte jamais son bloc englobant, et
     à plat dans une seule liste ce bloc est la liste entière — les treize
     titres restaient donc collés au même endroit, empilés les uns sur les
     autres. Chaque famille porte maintenant sa propre liste : le titre suivant
     pousse le précédent dehors, comme il se doit.
     `cible` dit où va l'option : dans la famille en cours, ou à la racine pour
     celles qui n'en ont pas (le choix vide et la saisie manuelle, en tête). */
  let groupe=null,cible=null;
  const poser=(el)=>{if(cible)cible.append(el);else noeuds.push(el)};
  vus.forEach((o,i)=>{
    if(!o.groupe){groupe=null;cible=null}
    else if(o.groupe!==groupe){
      groupe=o.groupe;
      const bloc=document.createElement('li');
      bloc.className='menu-famille';bloc.setAttribute('role','presentation');
      const tete=document.createElement('div');
      tete.className='menu-groupe';tete.textContent=o.groupe;
      cible=document.createElement('ul');
      cible.className='menu-famille-liste';
      cible.setAttribute('role','group');
      cible.setAttribute('aria-label',o.groupe);
      bloc.append(tete,cible);
      noeuds.push(bloc);
    }
    const li=document.createElement('li');
    li.className='menu-option'+(i===etat.vise?' est-vise':'');
    li.id=`${etat.liste.id}-opt-${i}`;
    li.dataset.rang=i;
    li.dataset.valeur=o.valeur;
    li.setAttribute('role','option');
    li.setAttribute('aria-selected',String(o.valeur===etat.hote.value));
    if(o.jeton){const j=document.createElement('span');j.className='menu-jeton';j.textContent=o.jeton;li.append(j)}
    if(o.hex){const p=document.createElement('span');p.className='menu-pastille';p.style.background=o.hex;li.append(p)}
    const t=document.createElement('span');t.className='menu-option-texte';t.textContent=o.texte;li.append(t);
    poser(li);
  });
  etat.liste.replaceChildren(...noeuds);
  menuPeindreVise(etat,true);
}

function menuPeindreVise(etat,deroule){
  etat.liste.querySelectorAll('.est-vise').forEach(li=>li.classList.remove('est-vise'));
  const actif=etat.liste.querySelector(`[data-rang="${etat.vise}"]`);
  const champ=etat.libre?etat.hote:etat.filtre;
  if(!actif){champ.removeAttribute('aria-activedescendant');return}
  actif.classList.add('est-vise');
  champ.setAttribute('aria-activedescendant',actif.id);
  if(deroule!==false)actif.scrollIntoView({block:'nearest'});
}

function menuViser(etat,pas){
  const n=etat.vus.length;
  if(!n)return;
  etat.vise=(etat.vise+pas+n)%n;
  menuPeindreVise(etat,true);
}

function menuTouche(etat,ev){
  if(!etat.ouvert&&(ev.key==='ArrowDown'||ev.key==='Enter'||ev.key===' ')){
    ev.preventDefault();menuOuvrir(etat);return;
  }
  if(ev.key==='ArrowDown'){ev.preventDefault();menuViser(etat,1)}
  else if(ev.key==='ArrowUp'){ev.preventDefault();menuViser(etat,-1)}
  else if(ev.key==='Home'){ev.preventDefault();etat.vise=0;menuPeindreVise(etat,true)}
  else if(ev.key==='End'){ev.preventDefault();etat.vise=etat.vus.length-1;menuPeindreVise(etat,true)}
  else if(ev.key==='Enter'){
    const o=etat.vus[etat.vise];
    /* Menu libre sans ligne visée : Entrée garde ce qui est tapé. */
    if(o){ev.preventDefault();menuChoisir(etat,o.valeur)}
    else if(etat.libre)menuFermer(etat,false);
  }
  else if(ev.key==='Escape'){ev.preventDefault();menuFermer(etat,true)}
  /* LA TABULATION ENTRE DANS LE PANNEAU AVANT D'EN SORTIR. Un menu qui porte
     une action (« + Créer un nouveau client ») la rendait inatteignable au
     clavier : Tab refermait le panneau, et le bouton partait avec. Elle est le
     premier arrêt ; le Tab suivant, lui, referme comme avant. Sur un poste où
     la souris n'est pas la seule main, un raccourci qu'on ne peut pas
     atteindre n'existe pas. */
  else if(ev.key==='Tab'){
    if(etat.action&&document.activeElement!==etat.action){
      ev.preventDefault();etat.action.focus();return;
    }
    menuFermer(etat,false);
  }
}

/* Un seul geste pour la vendeuse, deux chemins derrière :
   - la liste a déjà son entrée libre gérée par le formulaire → on l'y renvoie ;
   - sinon ce qui est tapé devient la valeur du champ, et une vraie option de
     la liste quand c'en est une : le formulaire n'a rien de spécial à savoir,
     il lit toujours `.value`. */
function menuManuelOuvrir(etat){
  const renvoi=menuRenvoiManuel(etat.hote);
  if(renvoi!==undefined){menuChoisir(etat,renvoi);return}
  etat.peau.classList.add('est-saisie');
  etat.champLibre.value='';
  etat.champLibre.focus();
  menuPlacer(etat);
}
function menuManuelFermer(etat){
  etat.peau.classList.remove('est-saisie');
}
function menuManuelValider(etat){
  const texte=etat.champLibre.value.trim();
  if(!texte){etat.champLibre.focus();return}
  const hote=etat.hote;
  /* Un champ libre porte sa valeur directement — il n'a pas d'options où la
     ranger. Une liste, si : une deuxième saisie identique réutilise la sienne
     au lieu d'en empiler une, sinon elle se remplit de doublons au fil de la
     journée. */
  if(!etat.libre&&![...hote.options].some(o=>o.value===texte)){
    const opt=new Option(texte,texte);
    opt.dataset.manuel='1';
    hote.add(opt,hote.options[0]&&!hote.options[0].value?1:0);
  }
  menuManuelFermer(etat);
  menuChoisir(etat,texte);
}

function menuOuvrir(etat){
  if(etat.ouvert)return;
  const options=menuOptions(etat.hote);
  if(!options.length)return;          /* catalogue pas encore chargé */
  menus.forEach(a=>{if(a!==etat)menuFermer(a,false)});   /* un seul à la fois */
  etat.ouvert=true;
  etat.filtrer=false;   /* on ouvre sur la liste ENTIÈRE */
  etat.peau.classList.remove('est-saisie');   /* jamais rouvert en cours de frappe */
  etat.peau.classList.add('est-ouvert');
  etat.declencheur.setAttribute('aria-expanded','true');
  if(!etat.libre){
    etat.filtre.value='';
    /* Ce qui était choisi devient l'invite : on cherche sans perdre de vue ce
       qu'on remplace. */
    const choisie=options.find(o=>o.valeur===etat.hote.value);
    etat.filtre.placeholder=choisie&&choisie.valeur
      ? [choisie.jeton,choisie.texte].filter(Boolean).join(' — ')
      : (etat.hote.dataset.menuFiltre||'Rechercher…');
  }
  /* ON OUVRE SUR LE METIER DU CHOIX EN COURS. Rouvrir la ligne d'un t-shirt
     pour la corriger et retomber sur « Boutique » obligerait a rebasculer a
     chaque fois — et a se demander, une seconde, si on n'a pas perdu la ligne. */
  const choisieOnglet=options.find(o=>o.valeur===etat.hote.value&&o.onglet);
  if(choisieOnglet)etat.onglet=choisieOnglet.onglet;
  /* On ouvre sur le choix en cours, pas en tête de liste. */
  etat.vise=Math.max(0,options.findIndex(o=>o.valeur===etat.hote.value));
  menuPeindre(etat);
  menuPlacer(etat);
  /* LE CURSEUR EST DANS LA BULLE, TOUJOURS. Il n'y allait que sur la liste des
     références — la seule qui portait `data-menu-recherche`. Sur les autres, il
     fallait viser une ligne à la souris ou descendre à la flèche : ouvrir un
     menu, c'est vouloir en choisir une, et le plus court chemin est d'en taper
     le début. */
  if(!etat.libre)etat.filtre.focus();
}

/* CE QUI BORNE LE PANNEAU N'EST PAS LA FENÊTRE. C'est le premier ancêtre qui
   COUPE ou qui DÉFILE — et il peut être bien plus étroit qu'elle.
   Le 24/08, `.layout>main` a reçu `overflow-y:auto` pour que seule la colonne
   de saisie défile. En CSS, dès qu'un axe n'est plus `visible`, l'autre passe
   de `visible` à `auto` : <main> est donc devenu, sans qu'on le demande, un
   conteneur qui défile AUSSI de côté. Mesuré : 651 px de large dans une
   fenêtre de 1103. Un panneau de 560 px ouvert sur la 3e colonne « tenait »
   dans la fenêtre et débordait <main> de 340 px — le navigateur décalait
   alors <main> de 333 px pour le montrer, et tout le formulaire glissait sous
   les yeux au simple clic sur un menu.
   On prend donc l'INTERSECTION de la fenêtre et de tous ces ancêtres. */
function menuBornes(peau){
  const b={gauche:0,droite:window.innerWidth,haut:0,bas:window.innerHeight};
  for(let e=peau.parentElement;e&&e!==document.documentElement;e=e.parentElement){
    const cs=getComputedStyle(e);
    if(cs.overflowX==='visible'&&cs.overflowY==='visible')continue;
    const r=e.getBoundingClientRect();
    if(cs.overflowX!=='visible'){b.gauche=Math.max(b.gauche,r.left);b.droite=Math.min(b.droite,r.right)}
    if(cs.overflowY!=='visible'){b.haut=Math.max(b.haut,r.top);b.bas=Math.min(b.bas,r.bottom)}
  }
  return b;
}

/* Le panneau est posé À LA MAIN, en coordonnées de fenêtre : sous le champ,
   aligné sur son bord gauche, retourné au-dessus s'il n'y a pas la place, et
   ramené à l'intérieur des bornes plutôt que débordant. Il ne rétrécit qu'en
   dernier recours — une liste de références illisible ne vaut pas mieux. */
function menuPlacer(etat){
  const {panneau,peau}=etat;
  const marge=12,b=menuBornes(peau),champ=peau.getBoundingClientRect();
  const dispo=b.droite-b.gauche-2*marge;
  const largeur=Math.max(champ.width,Math.min(560,dispo));
  panneau.style.width=Math.round(largeur)+'px';
  /* Aligné sur le champ, puis ramené dans les bornes — dans cet ordre : un
     champ collé au bord droit doit rendre un panneau collé au bord droit, pas
     un panneau qui sort. */
  let gauche=champ.left;
  if(gauche+largeur>b.droite-marge)gauche=b.droite-marge-largeur;
  if(gauche<b.gauche+marge)gauche=b.gauche+marge;
  panneau.style.left=Math.round(gauche)+'px';
  panneau.style.right='auto';
  /* Vertical : TOUJOURS SOUS LE CHAMP (30/08). Charlie : « tous les menus
     deroulants doivent se derouler vers le bas ». Il se retournait au-dessus
     des qu'il ne tenait pas dessous et qu'il tenait dessus — le meme geste
     ouvrait la liste tantot en haut tantot en bas, selon l'endroit de l'ecran.
     S'il ne tient pas, il glisse juste assez pour rester visible : il ne passe
     plus de l'autre cote, et sa liste defile deja (`.menu-liste`, 326 px).
     La hauteur se lit APRES la largeur — une liste plus etroite est plus haute. */
  const haut=panneau.getBoundingClientRect().height;
  panneau.style.bottom='auto';
  let y=champ.bottom+6;
  if(y+haut>b.bas-marge)y=Math.max(b.haut+marge,b.bas-marge-haut);
  panneau.style.top=Math.round(y)+'px';
}

/* UN PANNEAU POSÉ EN COORDONNÉES DE FENÊTRE NE SUIT PAS CE QUI DÉFILE. Il
   resterait planté en place pendant que son champ s'en va. On le referme :
   c'est ce qu'attend n'importe quelle liste déroulante, et c'est sans état à
   tenir à jour. En capture, parce qu'un défilement de conteneur ne remonte
   pas jusqu'au document. */
// EN PASSIF, comme au CRM : en capture sur `window`, il voit chaque
// défilement de l'écran. Il ne peut pas annuler le geste — il n'a donc
// aucune raison de faire attendre la composition de l'image.
//
// MAIS SA PROPRE LISTE N'EST PAS « L'ÉCRAN QUI DÉFILE » (Charlie, 27/08/2026).
// En capture sur window, ce écouteur voit AUSSI le défilement de la liste du
// panneau — et il la refermait sous le doigt. Deux conséquences, toutes deux
// signalées comme « le menu bugue » :
//   · à la molette, 82 produits sur 13 familles : la liste part, le menu ferme ;
//   · à l'ouverture, menuPeindreVise() amène le choix en cours à l'écran par
//     scrollIntoView — donc dès qu'on avait choisi un article situé plus bas
//     que la fenêtre de liste, le menu se refermait AU MOMENT MÊME où il
//     s'ouvrait, et ne se rouvrait plus jamais.
// On ne referme donc que sur un défilement qui vient d'AILLEURS que le panneau.
function menuDefilementExterieur(ev){
  const cible=ev.target;
  menus.forEach(a=>{
    if(!a.ouvert)return;
    if(cible instanceof Node&&a.panneau.contains(cible))return;
    menuFermer(a,false);
  });
  /* Le calendrier se referme lui-même sur tout défilement, depuis
     calendrier.js — il n'a pas d'état à consulter ici. */
}
window.addEventListener('scroll',menuDefilementExterieur,{capture:true,passive:true});
window.addEventListener('resize',()=>{menus.forEach(a=>menuFermer(a,false))},{passive:true});
/* ON CHANGE D'ECRAN, LE PANNEAU RESTE (01/09). Il est en `position:fixed`, hors
   de la vue qui l'a ouvert : le CRM masque sa section, et la liste deroulee se
   retrouve posee sur l'ecran suivant, au-dessus de tout. Le module se protege
   lui-meme plutot que de demander a chaque ecran d'y penser — c'est la meme
   raison qui lui fait deja fermer ses menus au redimensionnement. */
window.addEventListener('hashchange',()=>{menuFermerTous()},{passive:true});

function menuFermer(etat,rendreFocus){
  if(!etat.ouvert)return;
  etat.ouvert=false;
  etat.peau.classList.remove('est-ouvert');
  etat.peau.classList.remove('est-saisie');
  etat.declencheur.setAttribute('aria-expanded','false');
  if(rendreFocus)etat.declencheur.focus();
}

function menuChoisir(etat,valeur){
  etat.hote.value=valeur;
  /* Une valeur choisie dans la liste n'est pas une saisie : le trait repart. */
  if(etat.libre)etat.hote.classList.remove('est-frappe');
  menuPeindreChamp(etat);
  menuFermer(etat,true);
  /* Le rouge d'un champ manquant s'efface sur `change` — le <select> visible le
     déclenchait tout seul, ici c'est à nous de le dire. Et c'est ce même
     évènement qui porte les `onchange="…"` du formulaire. */
  menuEffacerRouge(etat);
  etat.hote.dispatchEvent(new Event('change',{bubbles:true}));
  if(etat.libre)etat.hote.dispatchEvent(new Event('input',{bubbles:true}));
}

function menuEffacerRouge(etat){
  const cible=etat.peau.classList.contains('invalid')?etat.peau:etat.hote;
  cible.classList.remove('invalid');
  const suivant=etat.peau.nextElementSibling;
  if(suivant&&suivant.classList.contains('error'))suivant.remove();
}

/* Un clic hors du panneau referme. `pointerdown` et non `click` : le panneau
   doit partir AVANT que le clic n'atteigne ce qu'il visait derrière. */
document.addEventListener('pointerdown',ev=>{
  menus.forEach(etat=>{if(etat.ouvert&&!etat.peau.contains(ev.target))menuFermer(etat,false)});
});

/* Tous les menus de la page d'un coup — y compris ceux des étapes suivantes,
   qui existent déjà dans le HTML même s'ils ne sont pas encore à l'écran. */
export function menusPoserTous() {
  poserStyleMenu();
  document.querySelectorAll('select:not([data-menu-non]),input[list]').forEach(el=>{
    if(!el.closest('.menu'))menuPoser(el);
  });
}

/* Le formulaire réécrit des options en cours de route (catalogue textile,
   coloris d'une référence, genres d'une famille…) et pose des `.value` par
   programme — une écriture directe ne déclenche AUCUN évènement. Le champ
   fermé doit donc être repeint à la main. */
export function menuRafraichir(hote) {
  const etat=menus.get(hote);
  if(!etat)return;
  menuPeindreChamp(etat);
  if(etat.ouvert)menuPeindre(etat);
}
export function menusRafraichirTous() { menus.forEach((etat) => menuRafraichir(etat.hote)); }

/* ---- CE QUE LES ECRANS APPELLENT ------------------------------------------
   `menuPoser` habille UN champ : c'est ce dont se sert un ecran qui construit
   ses rangees lui-meme, comme le devis. `menuOuvrirDe` ouvre la liste d'un
   champ sans clic — l'etape 5 du comptoir arrive avec ses clients deja
   deroules.
   `menuFermerTous` n'est PAS de ceux-la : elle etait prevue pour que le CRM
   l'appelle en demontant ses ecrans, et personne ne l'a jamais appelee — le
   panneau restait donc pose sur l'ecran suivant. Depuis le 01/09 le module s'en
   charge seul (voir l'ecouteur `hashchange` plus haut) : la fonction reste,
   son `export` part. */
export { menuPoser };

export function menuOuvrirDe(hote) {
  if (!hote) return;
  const etat = menus.get(hote) || menuPoser(hote);
  if (etat) menuOuvrir(etat);
}

function menuFermerTous() {
  menus.forEach((etat) => { if (etat.ouvert) menuFermer(etat, false); });
}
