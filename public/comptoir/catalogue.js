// ===========================================================================
// LE CATALOGUE DU COMPTOIR — il vient de la BASE, plus de ce fichier
// ===========================================================================
// Ce que la boutique vend, rayon par rayon. Il a vécu ici en constante : d'abord
// dans `demande-devis.html`, puis dans ce fichier le jour où un deuxième écran
// en a eu besoin. Il est maintenant en base (table `catalogue_produits`).
//
// POURQUOI. Tant que le catalogue est du code, AUCUN prix ne peut s'y importer :
// il aurait fallu redéployer pour changer un tarif. C'était ça, le verrou — pas
// l'import. La liste des produits de ce fichier est partie dans
// `catalogue-produits-seed.json` : elle SÈME une base neuve, elle n'est plus
// jamais relue ensuite.
//
// CE QUI N'A PAS BOUGÉ : la forme. `CATALOGUE`, `catCle`, `lignesCatalogue` et
// `catalogueAPlat` rendent exactement ce qu'ils rendaient. UNE LIGNE DU MENU
// EST UN PRODUIT PRÊT À PARTIR : la variante (bois/liège, clair/foncé, taille,
// coloris de tasse) est DÉJÀ dans la ligne — il n'y a pas de deuxième choix à
// faire. C'est ce qui rend la saisie rapide.
//
// UNE FAMILLE DE PLUS = une ligne de plus en base, rien à toucher ici. La
// famille sert de catégorie : « Art de la table » dit plus que « Goodies » à
// qui rouvre le dossier trois jours plus tard — et c'est elle qui décide des
// FACES de marquage que le comptoir propose (voir `facesDeLaCategorie`).
//
// Fichier de script CLASSIQUE, pas un module : les deux écrans du comptoir sont
// des documents à part qui chargent leurs scripts par balise, sans build.

/* ⚠ CE FICHIER SE LIT AUSSI HORS NAVIGATEUR. Les tests l'exécutent dans un bac
   à sable pour éprouver le menu sans ouvrir de page — et là, ni `window`, ni
   `fetch`, ni `localStorage` n'existent. Une référence à un nom absent ne rend
   pas `undefined`, elle LÈVE : on tient donc la page dans une variable, et tout
   ce qui la touche passe par elle. */
const surLaPage = (typeof window !== 'undefined') ? window : null;

/* Le catalogue en mémoire, dans la forme que les écrans lisent déjà :
   [ { famille, note, items: [ { n, v: [], note, label, color } ] } ].
   Il commence VIDE et se remplit à la lecture de la base. */
let CATALOGUE = [];

/* LES TASSES, POUR LA COMPATIBILITÉ. `TASSES_350` n'est plus une constante du
   code : c'est ce que la base porte dans la famille des tasses, relu à chaque
   chargement. La liste reste exposée parce que des écrans s'en servent encore
   pour dessiner le nuancier. */
let TASSES_350 = [];

/* Une ligne de la demande se reconnaît à ces trois-là : reprendre le même produit
   retombe sur la même clé, donc sur la même ligne. */
function catCle(cat,label,color){return cat+'\u0001'+label+'\u0001'+(color||'')}

/* LES LIGNES DE LA BASE, REMISES EN RAYONS. Une ligne de la base est un produit
   VENDABLE (famille + désignation + variante) ; le menu, lui, groupe par
   famille et regroupe les variantes d'un même article. On refait donc le
   chemin inverse — et la famille garde l'ORDRE de la base, celui que le patron
   range depuis les réglages. */
/* ⚠ LE TEXTILE NE PASSE PAS PAR CE MENU, ET C'EST VOULU (01/09/2026).
   Depuis que les references du moteur sont dans la MEME table que les objets,
   cet ecran les verrait deux fois : une fois dans la tuile « Textile », qui
   sait les chiffrer (references, coloris TopTex, tailles, marquage, coefficients
   degressifs du fichier V9), et une fois dans la liste « Autre », qui ne sait
   qu'en poser le nom. Deux chemins pour la meme chose, c'est une question de
   plus au comptoir et une ligne mal chiffree un jour sur deux.
   La BASE est bien unique — c'est ce qu'elle MONTRE qui differe d'un ecran a
   l'autre, et chaque ecran montre le chemin qui sait faire le prix. */
const FAMILLE_TEXTILE='Textile';

function catalogueDepuisLignes(lignes){
  const familles=[];
  const parFamille=new Map();
  const parArticle=new Map();
  for(const r of (Array.isArray(lignes)?lignes:[])){
    if(!r||r.actif===false)continue;
    const famille=String(r.famille||'').trim();
    const designation=String(r.designation||'').trim();
    if(!famille||!designation)continue;
    if(famille===FAMILLE_TEXTILE)continue;
    let f=parFamille.get(famille);
    if(!f){f={famille,note:String(r.familleNote||''),items:[]};parFamille.set(famille,f);familles.push(f)}
    /* La note de famille se prend sur la PREMIÈRE ligne qui en porte une :
       l'import ne la remplit pas, et une ligne muette ne doit pas effacer
       l'intitulé du groupe. */
    if(!f.note&&r.familleNote)f.note=String(r.familleNote);
    const cleArticle=famille+'\u0001'+designation;
    let it=parArticle.get(cleArticle);
    if(!it){
      it={n:designation};
      parArticle.set(cleArticle,it);
      f.items.push(it);
    }
    const variante=String(r.variante||'').trim();
    if(variante){
      if(!it.v)it.v=[];
      if(!it.v.includes(variante))it.v.push(variante);
    }else{
      /* Un article SANS variante porte son intitulé de devis, sa note et sa
         couleur : c'est le cas des tasses (« TC 01 » se lit « Tasse céramique
         350 ml TC 01 » sur le devis). */
      if(r.note)it.note=String(r.note);
      if(r.label)it.label=String(r.label);
      if(r.couleur)it.color=String(r.couleur);
    }
  }
  CATALOGUE=familles;
  TASSES_350=[];
  for(const f of familles){
    for(const it of f.items){
      const m=/^TC\s*(\d+)$/.exec(it.n);
      const tons=String(it.note||'').split('/');
      if(m&&tons.length===2)TASSES_350.push([m[1],tons[0].trim(),tons[1].trim()]);
    }
  }
  if(surLaPage){surLaPage.CATALOGUE=CATALOGUE;surLaPage.TASSES_350=TASSES_350}
  return CATALOGUE;
}

/* Le menu à plat : une entrée par ligne vendable, dans l'ordre des familles. */
function lignesCatalogue(){
  const groupes=[];
  CATALOGUE.forEach(f=>{
    const lignes=[];
    f.items.forEach(it=>{
      const label=it.label||it.n;
      if(it.v&&it.v.length)it.v.forEach(v=>lignes.push({famille:f.famille,label,color:v,texte:it.n+' — '+v}));
      else lignes.push({famille:f.famille,label,color:it.color||'',texte:it.note?it.n+' — '+it.note:it.n});
    });
    groupes.push({famille:f.famille,note:f.note||'',lignes});
  });
  return groupes;
}

/* LA LISTE À PLAT, pour une saisie qui se cherche au clavier plutôt qu'à la
   souris. Chaque entrée porte de quoi la retrouver (`cherche`, réduit sans
   accent) et de quoi la poser dans un besoin sans rien recalculer. */
function catalogueAPlat() {
  const out = [];
  for (const g of lignesCatalogue()) {
    for (const l of g.lignes) {
      out.push({
        famille: g.famille,
        label: l.label,
        color: l.color || '',
        texte: l.texte,
        cherche: (g.famille + ' ' + l.texte).toLowerCase()
          .normalize('NFD').replace(/[̀-ͯ]/g, ''),
      });
    }
  }
  return out;
}

/* --- LA LECTURE DE LA BASE ------------------------------------------------
   LE DERNIER CATALOGUE LU RESTE SUR LE POSTE. Le comptoir sert un client qui
   est DEVANT : un wifi qui décroche ne doit pas lui rendre un menu vide. Ce
   n'est pas une deuxième source — c'est le repli du même, exactement comme le
   service worker ne sert son cache qu'à défaut de réseau. Il est remplacé dès
   que la base répond. */
const CATALOGUE_REPLI='olda.catalogue';

function catalogueEnMemoire(){
  try{
    const brut=surLaPage.localStorage.getItem(CATALOGUE_REPLI);
    if(brut)catalogueDepuisLignes(JSON.parse(brut));
  }catch(_){/* stockage refusé, ou contenu illisible : on partira de la base */}
}

/* Rendue à l'écran : elle rappelle `remplirSelectCatalogue` quand le catalogue
   arrive, parce que le menu a pu être dessiné avant. */
function catalogueCharger(){
  return fetch('/api/catalogue-produits',{headers:{Accept:'application/json'}})
    .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
    .then(lignes=>{
      if(!Array.isArray(lignes)||!lignes.length)throw new Error('catalogue vide');
      catalogueDepuisLignes(lignes);
      try{surLaPage.localStorage.setItem(CATALOGUE_REPLI,JSON.stringify(lignes))}catch(_){/* stockage refusé */}
      if(surLaPage&&typeof surLaPage.remplirSelectCatalogue==='function')surLaPage.remplirSelectCatalogue();
      return CATALOGUE;
    })
    .catch(err=>{
      /* ON GARDE CE QU'ON A. Un catalogue vidé par une réponse ratée ferait
         disparaître les rayons sous les doigts de la vendeuse ; le menu du
         comptoir dit lui-même quand il n'a rien à montrer. */
      console.error('Catalogue produits injoignable :',err.message);
      return CATALOGUE;
    });
}

if (surLaPage) {
  catalogueEnMemoire();
  surLaPage.CATALOGUE = CATALOGUE;
  surLaPage.TASSES_350 = TASSES_350;
  surLaPage.catCle = catCle;
  surLaPage.lignesCatalogue = lignesCatalogue;
  surLaPage.catalogueAPlat = catalogueAPlat;
  surLaPage.catalogueDepuisLignes = catalogueDepuisLignes;
  surLaPage.catalogueCharger = catalogueCharger;
  /* Le chargement part TOUT DE SUITE : la page a d'autres champs à remplir
     avant que la vendeuse n'arrive au menu produits. */
  if (typeof fetch === 'function') catalogueCharger();
}
