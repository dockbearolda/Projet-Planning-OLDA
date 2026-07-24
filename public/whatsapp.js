// WhatsApp « votre commande est prête » — règles pures (aucun DOM)
// ===========================================================================
// Le planning pose une pastille WhatsApp sur chaque commande dont le client a
// laissé un numéro : un clic ouvre la conversation avec le message DÉJÀ ÉCRIT.
// Rien ne part tout seul — c'est l'employé qui appuie sur Envoyer.
//
// Deux règles vivent ici, à l'écart du rendu, parce qu'elles se testent seules
// (voir test/whatsapp.test.js) : mettre le numéro au format international, et
// remplir le message du patron.

// wa.me exige un numéro INTERNATIONAL. L'atelier est à Saint-Martin, où l'on
// croise autant de 0690 (Antilles) que de 06/07 métropole : l'indicatif se
// déduit donc du préfixe mobile, il ne peut pas être une constante.
const MOBILE_INDICATIFS = [
  [/^06(90|91)/, '590'],  // Guadeloupe · Saint-Martin · Saint-Barthélemy
  [/^06(96|97)/, '596'],  // Martinique
  [/^0694/, '594'],       // Guyane
  [/^06(92|93)/, '262'],  // La Réunion · Mayotte
];

// Numéro prêt pour wa.me (chiffres seuls, indicatif pays compris), ou null si
// on ne sait pas le lire : mieux vaut pas de pastille du tout qu'une pastille
// qui ouvre une conversation avec un inconnu.
export function whatsappNumber(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  // Déjà international : on fait confiance à ce qui a été saisi.
  if (s.startsWith('+')) return digits.length >= 8 ? digits : null;
  if (digits.startsWith('00')) return digits.length >= 10 ? digits.slice(2) : null;
  // Numéro français à 10 chiffres : l'indicatif vient du préfixe mobile.
  if (/^0\d{9}$/.test(digits)) {
    const found = MOBILE_INDICATIFS.find(([re]) => re.test(digits));
    return `${found ? found[1] : '33'}${digits.slice(1)}`;
  }
  // International sans « + » (590690662400) ou format local inhabituel : on ne
  // devine pas, on garde les chiffres tels quels s'ils sont plausibles.
  return digits.length >= 10 ? digits : null;
}

// Regroupe les chiffres d'un numéro par paires (« 06 90 66 24 00 ») : c'est le
// format que tout le monde sait relire d'un coup d'œil, plutôt qu'un bloc de
// dix chiffres collés. Le « + » international éventuel est conservé en tête.
export function groupDigits(raw) {
  const s = String(raw == null ? '' : raw);
  const plus = s.trim().startsWith('+') ? '+' : '';
  const digits = s.replace(/\D/g, '');
  return plus + digits.replace(/(\d{2})(?=\d)/g, '$1 ');
}

// Le message du patron, ses jetons remplis. Un jeton sans valeur laisse un
// blanc — jamais un « null » en clair sous les yeux du client — et les espaces
// en trop qu'il laisse derrière lui sont refermés.
export function fillMessage(template, { client = '', commande = '', date = '' } = {}) {
  return String(template == null ? '' : template)
    .replace(/\{client\}/g, client)
    .replace(/\{commande\}/g, commande)
    .replace(/\{date\}/g, date)
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// wa.me marche partout : application installée sur la tablette, WhatsApp Web
// sur le PC de l'atelier. On ouvre la conversation pré-remplie, jamais l'envoi.
// Renvoie null si le numéro est illisible.
export function whatsappLink(raw, template, champs) {
  const num = whatsappNumber(raw);
  if (!num) return null;
  const text = fillMessage(template, champs);
  return `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
