// LE CALENDRIER, POUR TOUT L'ATELIER (extrait le 30/08/2026)
// ==========================================================================
// Charlie, en designant le champ « Retrait » de la fiche : « ici je veux un
// calendrier, le meme que l'autre, qui se deroule quand je clique dessus ».
//
// « Le meme que l'autre » est une CONSIGNE D'ARCHITECTURE, pas un souhait
// d'apparence : le calendrier style SumUp existait depuis le 27/08, mais il
// vivait dans `comptoir/pont.js` — le fichier des deux ecrans du comptoir, que
// le CRM ne lit pas. Le recopier aurait donne deux calendriers qui se
// ressemblent, et qui divergent au premier correctif. Il demenage donc ici,
// dans le seul endroit que les TROIS ecrans peuvent lire, exactement comme
// `modale.js` avant lui.
//
// CE QU'IL EST. Le calendrier natif de Chrome n'est reglable en rien — ni sa
// langue, ni son dessin, ni le jour ou commence sa semaine — et il ouvrait un
// objet gris qui n'appartenait a aucun ecran. Celui-ci prend la charte : un
// mois, sept colonnes, la semaine qui commence LUNDI, aujourd'hui cercle, le
// jour choisi plein.
//
// IL SE GREFFE SUR UN `input[type=date]` et le remplace : la valeur reste une
// date ISO dans le champ, `input` et `change` partent comme avant. Rien de ce
// qui lit ces champs n'a besoin de le savoir — c'est ce qui permet a la fiche
// du CRM de lui donner un champ CACHE et de garder sa saisie au clavier
// (« demain », « +3 », « lundi ») sur le champ qu'on voit.
//
// LE WEEK-END SE VOIT MAIS NE SE REFUSE PAS. L'atelier est ferme le samedi et
// le dimanche, et l'ecran de devis le dit deja, avec la premiere date possible
// et un bouton pour la prendre. Interdire ici doublerait cette regle a un
// deuxieme endroit — et les deux finiraient par diverger.

// LA FEUILLE PART AVEC LE COMPOSANT, et une seule fois : les deux ecrans du
// comptoir et le CRM peuvent tous les trois l'importer, dans n'importe quel
// ordre. Elle ne pose que des JETONS de `charte.css`, que les trois chargent.
// ⚠ AUCUN ACCENT GRAVE dans ce qui suit : le bloc vit dans un litteral de
// gabarit, un accent grave le refermerait et la feuille partirait NUE.
const CSS_CALENDRIER = `
/* ---- LE CALENDRIER ------------------------------------------------------
   Une seule surface, la boîte de la charte, et rien qui clignote : un mois se
   lit d'un coup d'œil ou il ne sert à rien. */
.cal-panneau{position:fixed;z-index:1400;width:296px;padding:var(--pas-3);
  border:1px solid var(--border);border-radius:var(--arrondi-bloc);
  background:var(--surface);box-shadow:var(--shadow-pop);
  font:inherit;font-size:var(--taille-texte);color:var(--text-1)}
.cal-tete{display:flex;align-items:center;justify-content:space-between;gap:var(--pas-2);margin-bottom:var(--pas-2)}
.cal-mois{flex:1;text-align:center;font-weight:var(--graisse-forte);text-transform:capitalize}
/* LES DEUX ÉCRANS IMPOSENT « button{min-height:var(--dd-champ-h);padding:0 18px} »
   À TOUS LEURS BOUTONS. Sans le dire ici, chaque case du calendrier héritait
   de 18 px de rembourrage de chaque côté : la grille de sept colonnes sortait
   du panneau, et le jour choisi se retrouvait 26 px À CÔTÉ de la boîte
   (mesuré). Toute commande de ce composant redit donc sa boîte en entier.
   C'est le piege maison du comptoir : une regle nue sur l'element button
   atteint tout ce qu'on y pose. */
.cal-panneau button{padding:0;min-height:0;min-width:0;margin:0}
.cal-fleche{flex:none;width:36px;height:36px;display:grid;place-items:center;
  border:1px solid var(--border);border-radius:50%;background:var(--surface);
  color:var(--text-2);font:inherit;font-size:var(--taille-texte);line-height:1;cursor:pointer;
  transition:background var(--dur-1) var(--ease),color var(--dur-1) var(--ease),border-color var(--dur-1) var(--ease)}
.cal-fleche:hover{background:var(--primary-soft);color:var(--primary);border-color:var(--primary)}
.cal-fleche:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(var(--primary-rgb),.3)}
.cal-semaine,.cal-grille{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.cal-jour-nom{display:grid;place-items:center;height:28px;
  font-size:var(--taille-note);font-weight:var(--graisse-note);color:var(--text-2)}
.cal-jour-nom.est-weekend{color:var(--text-3)}
.cal-jour{height:36px;min-width:0;padding:0;display:grid;place-items:center;
  border:1px solid transparent;border-radius:50%;background:transparent;
  color:var(--text-1);font:inherit;font-size:var(--taille-texte);
  font-variant-numeric:tabular-nums;cursor:pointer;
  transition:background var(--dur-1) var(--ease),color var(--dur-1) var(--ease)}
.cal-jour:hover{background:var(--primary-soft);color:var(--primary)}
.cal-jour:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(var(--primary-rgb),.3)}
/* Un jour d'un autre mois reste CLIQUABLE — on ne renvoie pas quelqu'un à la
   flèche pour le 1er du mois suivant — mais il recule. */
.cal-jour.est-hors{color:var(--text-3)}
/* L'atelier est fermé le week-end : on le VOIT, on ne l'interdit pas ici.
   L'écran de devis porte déjà cette règle, avec la première date possible. */
.cal-jour.est-weekend{color:var(--text-2)}
.cal-jour.est-hors.est-weekend{color:var(--text-3)}
.cal-jour.est-aujourdhui{border-color:var(--primary);font-weight:var(--graisse-forte)}
.cal-jour.est-choisi{background:var(--primary);color:var(--on-primary);font-weight:var(--graisse-forte)}
.cal-jour.est-choisi:hover{background:var(--primary-hover);color:var(--on-primary)}
.cal-pied{display:flex;gap:var(--pas-2);margin-top:var(--pas-3);padding-top:var(--pas-2);
  border-top:1px solid var(--border-soft)}
.cal-raccourci{flex:1;min-height:38px;padding:0 var(--pas-2);min-width:0;
  border:1px solid var(--border);border-radius:var(--arrondi-champ);background:var(--surface);
  color:var(--text-2);font:inherit;font-size:var(--taille-texte);font-weight:var(--graisse-note);cursor:pointer;
  transition:background var(--dur-1) var(--ease),color var(--dur-1) var(--ease),border-color var(--dur-1) var(--ease)}
.cal-raccourci:hover{background:var(--primary-soft);color:var(--primary);border-color:var(--primary)}
.cal-raccourci:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(var(--primary-rgb),.3)}
@media(prefers-reduced-motion:reduce){.cal-fleche,.cal-jour,.cal-raccourci{transition:none}}
`;

let feuillePosee = false;
function poserFeuille() {
  if (feuillePosee || typeof document === 'undefined') return;
  feuillePosee = true;
  const s = document.createElement('style');
  s.dataset.calendrier = '';
  s.textContent = CSS_CALENDRIER;
  document.head.appendChild(s);
}

const JOURS_COURTS=['L','M','M','J','V','S','D'];
const MOIS_LONGS=['janvier','février','mars','avril','mai','juin','juillet',
  'août','septembre','octobre','novembre','décembre'];
const calendriers=new WeakSet();
let calOuvert=null;

const calISO=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
/* Une date ISO se lit à MIDI : à minuit, un fuseau à l'ouest la ramène la
   veille. L'atelier est à UTC−4, le piège est réel. */
const calDate=(iso)=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||''));
  return m?new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12,0,0):null;};
/* Lundi = 0 : la semaine française, pas celle de `getDay()`. */
const calRang=(d)=>(d.getDay()+6)%7;

function calFermer(){
  if(!calOuvert)return;
  calOuvert.panneau.remove();
  const champ=calOuvert.champ;
  calOuvert=null;
  if(champ)champ.setAttribute('aria-expanded','false');
}

function calPeindre(etat){
  const {panneau,champ}=etat;
  panneau.replaceChildren();
  const choisi=calDate(champ.value);
  const today=new Date();today.setHours(12,0,0,0);

  const tete=document.createElement('div');
  tete.className='cal-tete';
  const bouton=(nom,titre,pas)=>{
    const b=document.createElement('button');
    b.type='button';b.className='cal-fleche';b.setAttribute('aria-label',titre);
    b.textContent=nom;
    b.addEventListener('click',()=>{etat.mois.setMonth(etat.mois.getMonth()+pas);calPeindre(etat)});
    return b;
  };
  const titre=document.createElement('div');
  titre.className='cal-mois';
  titre.textContent=`${MOIS_LONGS[etat.mois.getMonth()]} ${etat.mois.getFullYear()}`;
  tete.append(bouton('‹','Mois précédent',-1),titre,bouton('›','Mois suivant',1));
  panneau.append(tete);

  const sem=document.createElement('div');
  sem.className='cal-semaine';
  JOURS_COURTS.forEach((j,i)=>{
    const c=document.createElement('span');
    c.className='cal-jour-nom'+(i>=5?' est-weekend':'');
    c.textContent=j;sem.append(c);
  });
  panneau.append(sem);

  const grille=document.createElement('div');
  grille.className='cal-grille';
  const premier=new Date(etat.mois.getFullYear(),etat.mois.getMonth(),1,12,0,0);
  const debut=new Date(premier);
  debut.setDate(premier.getDate()-calRang(premier));
  /* SIX SEMAINES, TOUJOURS. Une grille qui change de hauteur d'un mois à
     l'autre fait sauter tout ce qu'il y a dessous à chaque flèche. */
  for(let i=0;i<42;i+=1){
    const j=new Date(debut);j.setDate(debut.getDate()+i);
    const b=document.createElement('button');
    b.type='button';
    b.className='cal-jour';
    if(j.getMonth()!==etat.mois.getMonth())b.classList.add('est-hors');
    if(calRang(j)>=5)b.classList.add('est-weekend');
    if(calISO(j)===calISO(today))b.classList.add('est-aujourdhui');
    if(choisi&&calISO(j)===calISO(choisi))b.classList.add('est-choisi');
    b.textContent=String(j.getDate());
    b.setAttribute('aria-label',`${j.getDate()} ${MOIS_LONGS[j.getMonth()]} ${j.getFullYear()}`);
    b.addEventListener('click',()=>{
      champ.value=calISO(j);
      champ.dispatchEvent(new Event('input',{bubbles:true}));
      champ.dispatchEvent(new Event('change',{bubbles:true}));
      calFermer();
    });
    grille.append(b);
  }
  panneau.append(grille);

  const pied=document.createElement('div');
  pied.className='cal-pied';
  const auj=document.createElement('button');
  auj.type='button';auj.className='cal-raccourci';auj.textContent="Aujourd'hui";
  auj.addEventListener('click',()=>{
    champ.value=calISO(today);
    champ.dispatchEvent(new Event('input',{bubbles:true}));
    champ.dispatchEvent(new Event('change',{bubbles:true}));
    calFermer();
  });
  pied.append(auj);
  if(champ.value){
    const vider=document.createElement('button');
    vider.type='button';vider.className='cal-raccourci';vider.textContent='Effacer';
    vider.addEventListener('click',()=>{
      champ.value='';
      champ.dispatchEvent(new Event('input',{bubbles:true}));
      champ.dispatchEvent(new Event('change',{bubbles:true}));
      calFermer();
    });
    pied.append(vider);
  }
  panneau.append(pied);
}

/* Posé en coordonnées de FENÊTRE et dans le <body> : les deux écrans ont des
   conteneurs qui défilent, un panneau en `absolute` s'y couperait — le même
   piège que le panneau des menus. */
function calPlacer(etat,ancrage){
  const {panneau}=etat;
  const r=ancrage.getBoundingClientRect();
  const marge=12;
  panneau.style.visibility='hidden';
  panneau.style.left='0px';panneau.style.top='0px';
  document.body.appendChild(panneau);
  const p=panneau.getBoundingClientRect();
  let x=r.left;
  if(x+p.width>window.innerWidth-marge)x=window.innerWidth-marge-p.width;
  if(x<marge)x=marge;
  /* TOUJOURS VERS LE BAS (30/08). Charlie : « tous les menus deroulants doivent
     se derouler vers le bas ». Il se retournait AU-DESSUS du champ des qu'il ne
     tenait pas dessous et qu'il tenait dessus — le meme geste ouvrait le
     calendrier tantot en haut tantot en bas, selon l'endroit de l'ecran.
     S'il ne tient pas, il glisse juste assez pour rester visible : il ne passe
     plus de l'autre cote. */
  let y=r.bottom+6;
  if(y+p.height>window.innerHeight-marge)y=Math.max(marge,window.innerHeight-marge-p.height);
  panneau.style.left=`${Math.round(x)}px`;
  panneau.style.top=`${Math.round(y)}px`;
  panneau.style.visibility='';
}

/* Ouvrir le calendrier d'un champ. `ancrage` permet de l'accrocher AILLEURS que
   sur le champ lui-même : sur l'écran de devis, la date se choisit depuis une
   liste, et le champ qui la porte est un fantôme d'un pixel. */
function calOuvrir(champ,ancrage){
  calFermer();
  const panneau=document.createElement('div');
  panneau.className='cal-panneau';
  panneau.setAttribute('role','dialog');
  panneau.setAttribute('aria-label','Choisir une date');
  const choisi=calDate(champ.value);
  const mois=choisi?new Date(choisi.getFullYear(),choisi.getMonth(),1,12,0,0)
    :(()=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(1);return d})();
  const etat={champ,panneau,mois};
  calOuvert=etat;
  calPeindre(etat);
  calPlacer(etat,ancrage||champ);
  champ.setAttribute('aria-expanded','true');
  const jour=panneau.querySelector('.cal-jour.est-choisi')||panneau.querySelector('.cal-jour.est-aujourdhui');
  if(jour)jour.focus();
}

/* Le champ natif ne s'ouvre plus : on prend son clic. Il garde sa valeur, son
   type et son `change` — tout ce qui le lit continue de marcher. */
function calendrierPoserInterne(champ){
  if(!champ||calendriers.has(champ))return;
  calendriers.add(champ);
  champ.setAttribute('aria-haspopup','dialog');
  champ.setAttribute('aria-expanded','false');
  const prendre=(ev)=>{
    ev.preventDefault();
    if(calOuvert&&calOuvert.champ===champ){calFermer();return}
    calOuvrir(champ);
  };
  champ.addEventListener('pointerdown',prendre);
  champ.addEventListener('keydown',(ev)=>{
    if(ev.key==='Enter'||ev.key===' '||ev.key==='ArrowDown'){ev.preventDefault();calOuvrir(champ)}
  });
}

document.addEventListener('pointerdown',(ev)=>{
  if(!calOuvert)return;
  if(calOuvert.panneau.contains(ev.target)||ev.target===calOuvert.champ)return;
  calFermer();
},true);
/* ECHAP FERME LE CALENDRIER, ET RIEN D'AUTRE. En CAPTURE, et le composant
   retient l'evenement : l'ecran qui l'accueille a presque toujours son propre
   Echap — la fiche de l'atelier se ferme avec, l'ecran de devis aussi — et une
   seule touche fermait les DEUX. Renoncer a changer une date emportait l'ecran.
   La capture passe avant tout ecouteur pose sur `document`, quel que soit
   l'ordre de chargement des fichiers : une garde du cote de l'ecran (« y a-t-il
   un calendrier ouvert ? ») dependait, elle, de qui s'etait inscrit en premier —
   et le calendrier avait deja retire son panneau quand la fiche regardait. */
document.addEventListener('keydown',(ev)=>{
  if(ev.key!=='Escape'||!calOuvert)return;
  ev.stopPropagation();
  calFermer();
},true);
window.addEventListener('resize',calFermer,{passive:true});

/** Ouvre le calendrier d'un champ. `ancrage` permet de l'accrocher AILLEURS que
 *  sur le champ lui-meme — c'est ce dont se servent l'ecran de devis (sa date
 *  se choisit dans une liste) et la fiche du CRM (son champ de date est cache
 *  derriere celui qu'on lit). */
export function calendrierOuvrir(champ, ancrage) {
  poserFeuille();
  calOuvrir(champ, ancrage);
}

/** Greffe le calendrier sur un `input[type=date]` : son clic ouvre le notre au
 *  lieu du natif. Idempotent — un champ deja greffe est ignore. */
export function calendrierPoser(champ) {
  poserFeuille();
  calendrierPoserInterne(champ);
}
