// ===========================================================================
// LE CATALOGUE DU COMPTOIR — une seule source, trois écrans
// ===========================================================================
// Ce que la boutique vend, rayon par rayon. Il vivait en constante dans
// `demande-devis.html` : le jour où un deuxième écran a eu besoin des mêmes
// produits, il y avait deux catalogues à tenir — et deux catalogues, c'est un
// produit ajouté d'un côté et introuvable de l'autre. Il descend donc dans son
// propre fichier, comme les composants partagés descendent dans `charte.css`.
//
// UNE LIGNE DU MENU EST UN PRODUIT PRÊT À PARTIR : la variante (bois/liège,
// clair/foncé, taille, coloris de tasse) est DÉJÀ dans la ligne — il n'y a pas
// de deuxième choix à faire. C'est ce qui rend la saisie rapide.
//
// UNE FAMILLE DE PLUS = un bloc de plus ici, rien d'autre à toucher. La famille
// sert de catégorie : « Art de la table » dit plus que « Goodies » à qui rouvre
// le dossier trois jours plus tard — et c'est elle qui décide des FACES de
// marquage que le comptoir propose (voir `facesDeLaCategorie`).
//
// Fichier de script CLASSIQUE, pas un module : les deux écrans du comptoir sont
// des documents à part qui chargent leurs scripts par balise, sans build.

const TASSES_350=[['01','Rouge','Blanc'],['02','Orange','Blanc'],['03','Rose','Blanc'],['04','Bleu','Blanc'],['05','Vert','Blanc'],['06','Noir','Blanc'],['07','Blanc','Bleu'],['08','Blanc','Jaune'],['09','Blanc','Orange'],['10','Blanc','Rouge'],['11','Blanc','Vert'],['12','Blanc','Noir'],['13','Noir','Rose'],['14','Noir','Jaune'],['15','Noir','Rouge'],['16','Noir','Vert'],['17','Noir','Orange']];
const CATALOGUE=[
{famille:'Art de la table',items:[
  {n:'Bouchon Bois'},
  {n:'Coffret à Vin'},
  {n:'Couteau Multi',v:['Bois','Liège']},
  {n:'Décapsuleur Bois'},
  {n:'Flasque Bois',v:['Clair','Foncé']},
  {n:'Limonadier Bois',v:['Clair','Foncé']},
  {n:'Service à Whisky'},
  {n:'Shaker inox'},
  {n:'Dessous de plat Liège'},
  {n:'Dessous de verre Liège'},
  {n:'Plateau Liège'},
  {n:'Pelle Bois Aulne'},
  {n:'Planche à découper Aulne',v:['Grande','Petite']},
  {n:'Planche bois Acacia',v:['Petite','Carré','Rectangle']}]},
{famille:'Du quotidien',items:[
  {n:'Cendrier Liège'},
  {n:'Lot brosse et peigne bois'},
  {n:'Miroir Liège',v:['XL','Petit']},
  {n:'Pince à billet',v:['Argent','Or']},
  {n:'Porte Carte Liège'},
  {n:'Porte Monnaie Liège'},
  {n:'Porte sac'},
  {n:'Sabot veilleuse bois'}]},
{famille:'Voyage',items:[
  {n:'Etui à Passeport Cuir PU',v:['Bleu Brume','Brun','Noir','Rose']},
  {n:'Identificateur Valise Cuir PU',v:['Bleu Brume','Brun','Noir','Rose']},
  {n:'Identificateur Valise Liège'},
  {n:'Identificateur Valise Métal'}]},
{famille:'Gourdes',items:[
  {n:'Gourde 500 ml Métal',v:['Blanc','Noir']},
  {n:'Gourde 800 ml Métal',v:['Blanc','Noir','Inox']}]},
{famille:'Jeux & loisirs',items:[
  {n:'Dominos'},
  {n:'Jeux de Cartes'},
  {n:'Mikado'},
  {n:'Morpion'},
  {n:'Yoyo'},
  {n:'Puzzle'},
  {n:'Raquette Bois'}]},
{famille:'Papeterie',items:[
  {n:'Bloc Note Liège',v:['A5','A6']},
  {n:'Crayon papier bois'},
  {n:'Grand Bloc Note Similicuir A5',v:['Bleu']},
  {n:'Stylo à bille en bois'}]},
{famille:'Porte-clés',items:[
  {n:'Porte-Clés Bois Tir Bouchon'},
  {n:'Porte-Clés Bois vintage',v:['rectangle','rond']},
  {n:'Porte-Clés Décapsuleur',v:['Bois','Similicuir','Acrylique']},
  {n:'Porte-Clés Flotteur Liège',v:['Bleu','Marron']}]},
/* Les tasses : la couleur du DEHORS puis celle du DEDANS. La ligne du devis
   porte le numéro (TC 01) ET les deux tons — « TC 01 » seul ne dit rien à
   l'atelier trois jours plus tard. */
{famille:'Tasse céramique 350 ml',note:'extérieur / intérieur',items:TASSES_350.map(function(t){
  return {n:'TC '+t[0],note:t[1]+' / '+t[2],
          label:'Tasse céramique 350 ml TC '+t[0],color:t[1]+' (ext.) / '+t[2]+' (int.)'};})}];
/* Une ligne de la demande se reconnaît à ces trois-là : reprendre le même produit
   retombe sur la même clé, donc sur la même ligne. */
function catCle(cat,label,color){return cat+'\u0001'+label+'\u0001'+(color||'')}
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

window.TASSES_350 = TASSES_350;
window.CATALOGUE = CATALOGUE;
window.catCle = catCle;
window.lignesCatalogue = lignesCatalogue;
window.catalogueAPlat = catalogueAPlat;
