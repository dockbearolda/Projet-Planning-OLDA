// Glisser un document de la ligne vers WhatsApp — règles pures (aucun DOM)
// ===========================================================================
// La vendeuse attrape la pastille d'un devis / d'une facture / d'un BAT sur la
// ligne du planning et la lâche dans la conversation WhatsApp ouverte à côté :
// le PDF y arrive en pièce jointe, tel quel.
//
// Pourquoi pas un copier-coller, qui serait le geste naturel : un PDF ne peut
// PAS passer par le presse-papier. Chrome n'y accepte que du texte, du HTML et
// des images — « application/pdf » est refusé net. Le seul contournement serait
// de convertir la première page en photo, ce qui ampute un devis de ses pages
// suivantes et transforme une facture en capture d'écran. Le glisser reste donc
// le seul chemin qui dépose un VRAI document dans la conversation.
//
// Deux règles vivent ici, à l'écart du rendu, parce qu'elles se testent seules
// (voir test/glisser-documents.test.js) : le nom sous lequel le client reçoit
// le fichier, et la charge utile que Chrome attend pour sortir le fichier de la
// page.

const LIBELLES = { devis: 'Devis', facture: 'Facture', bat: 'BAT' };

// Ce qu'un nom de fichier ne peut pas porter : Windows refuse ces neuf
// caractères, et le « : » casserait EN PLUS le découpage de la charge utile
// ci-dessous (type:nom:adresse) — le document partirait alors sous un nom
// tronqué, sans la moindre erreur nulle part.
const INTERDITS = '<>:"/\\|?*';

// Un nom de fichier reste court : au-delà, Windows et Android le tronquent et
// le client lit une bouillie dans sa conversation.
const NOM_MAX = 120;

// Les caractères interdits deviennent des espaces (plutôt que de disparaître :
// « Dupont/Martin » doit se lire « Dupont Martin », pas « DupontMartin »), et
// les blancs qu'ils laissent derrière eux sont refermés. Tout ce qui est sous
// l'espace est un caractère de contrôle et suit la même route.
function nettoyer(brut) {
  let sortie = '';
  for (const c of String(brut == null ? '' : brut)) {
    sortie += INTERDITS.includes(c) || c < ' ' ? ' ' : c;
  }
  return sortie.replace(/\s+/g, ' ').trim();
}

// Le nom sous lequel le client reçoit le fichier dans WhatsApp. Le nom d'origine
// ne convient pas : ce qui monte depuis la tablette du comptoir s'appelle
// « scan_0012.pdf » ou « devis (3).pdf », et c'est ce que le client lit dans sa
// conversation. Comme le glisser réclame de toute façon un nom, autant qu'il
// soit présentable. Sans client lisible on garde le seul libellé, plutôt que
// d'envoyer un tiret orphelin (« Devis - .pdf »).
export function nomDocument(kind, client) {
  const libelle = LIBELLES[kind] || 'Document';
  const place = NOM_MAX - libelle.length - ' - '.length - '.pdf'.length;
  const nom = nettoyer(client).slice(0, place).trim();
  return `${nom ? `${libelle} - ${nom}` : libelle}.pdf`;
}

// La charge utile « DownloadURL » de Chrome : type:nom:adresse. Posée sur le
// glisser, elle fait télécharger le PDF pendant le déplacement et le remet à
// l'application native au lâcher — c'est le mécanisme qui permet déjà de
// glisser une image de Chrome vers n'importe quel logiciel.
//
// L'adresse DOIT être absolue : une adresse relative est acceptée sans broncher
// par `setData`, et le fichier n'arrive simplement jamais. On rend `null` plutôt
// que de laisser partir un glisser qui ne déposera rien — l'appelant garde
// alors le glisser par défaut du navigateur.
export function chargeGlisser(nom, url) {
  const adresse = String(url == null ? '' : url).trim();
  if (!/^https?:\/\//i.test(adresse)) return null;
  const fichier = nettoyer(nom);
  if (!fichier) return null;
  return `application/pdf:${fichier}:${adresse}`;
}
