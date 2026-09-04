// Réseau — une seule règle : TOUTE REQUÊTE A UNE FIN.
//
// `fetch` n'abandonne pas. Sur un wifi d'atelier qui décroche à mi-chemin, ou en
// 4G quand la tablette passe derrière un mur, la connexion reste ouverte côté
// navigateur : rien ne revient, rien n'échoue. L'écran attend, et il attend
// jusqu'à ce que quelqu'un recharge la page.
//
// Ce n'est pas qu'un désagrément d'affichage. Les écrans se protègent d'un
// double envoi avec un drapeau « en cours » qu'on ne baisse qu'au retour de la
// requête : une requête sans retour, c'est un bouton mort. Le Point du jour fait
// pareil (`refreshing`) — un seul appel suspendu et il ne se rafraîchit plus de
// la journée, même une fois le réseau revenu.
//
// Le parcours du comptoir avait déjà son minuteur, posé le jour où une vente
// est restée en suspens sans message. Il vaut pour tout le reste.
import { lirePoste } from './poste.js';

export const DELAI_DEFAUT = 20000;
// Un PDF de plusieurs mégaoctets sur l'ADSL de l'atelier prend légitimement du
// temps : lui appliquer le délai des requêtes courtes couperait des envois qui
// se seraient bien terminés.
export const DELAI_ENVOI = 60000;

// Le message est en français et sans jargon : il traverse `estPanneReseau`, qui
// le range avec « Failed to fetch » — pour l'atelier, un serveur qui ne répond
// pas et un réseau tombé, c'est la même chose et la même conduite à tenir.
const MESSAGE_DELAI = 'le serveur ne répond pas';

export async function fetchBorne(url, opts = {}, ms = DELAI_DEFAUT) {
  const minuteur = new AbortController();
  const stop = setTimeout(() => minuteur.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: minuteur.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(MESSAGE_DELAI);
    throw err;
  } finally {
    clearTimeout(stop);
  }
}

// L'APPEL À L'API, UNE SEULE FOIS (01/09). Cinq écrans en portaient chacun une
// copie — trois identiques au mot près, une sans délai ni signature (le devis
// flash), une avec les deux (le planning). Une correction se faisait donc cinq
// fois, ou quatre, ou une : c'est ici qu'elle se fait désormais.
//
// LE POSTE SIGNE CE QU'IL FAIT. Le prénom choisi une fois par appareil part
// avec chaque appel : c'est ce que le journal enregistre dans « qui ».
// Déclaratif, jamais une preuve — mais « Mélina, hier à 16 h » répond à une
// question à laquelle « hier à 16 h » ne répondait pas. Sur les lectures
// aussi : ça ne coûte rien et ça évite d'avoir à se demander, à chaque nouvel
// appel, s'il fallait le mettre.
// ⚠ ENCODÉ, et ce n'est pas de la coquetterie : `fetch` REFUSE un en-tête qui
// sort du latin-1 et lève une TypeError. Un prénom saisi avec un caractère
// exotique ferait alors échouer NON PAS la signature, mais l'appel entier —
// toutes les écritures de l'application, pour un champ décoratif. En pourcent,
// c'est de l'ASCII quoi qu'on tape ; le serveur le décode.
//
// LE STATUT AVANT LE CORPS : une page d'erreur du proxy (HTML) faisait échouer
// l'analyse JSON d'abord, et le message affiché devenait « Unexpected token < »
// au lieu de « Erreur 502 ».
//
// LE CORPS DU REFUS VOYAGE AVEC L'ERREUR (`err.detail`, `err.status`) : sans
// lui, un 409 « BAT non validé » n'est qu'un texte, et l'écran ne peut rien
// proposer d'autre que de le lire. C'est ce qui permet à la Direction de
// forcer le passage.
//
// 401 EN PLEIN TRAVAIL : la session a expiré, ou les comptes viennent d'être
// allumés depuis un autre poste. Le planning enregistre ici ce qu'il faut
// faire alors (redemander qui est là) ; l'erreur est MARQUÉE `aConnecter` pour
// que le reste de l'application se taise — le voile de connexion dit déjà quoi
// faire.
let surNonConnecteFn = null;
export function surNonConnecte(fn) { surNonConnecteFn = typeof fn === 'function' ? fn : null; }

export async function api(method, url, body, ms = DELAI_DEFAUT) {
  const opts = { method, headers: {} };
  const qui = lirePoste();
  if (qui) opts.headers['X-Qui'] = encodeURIComponent(qui);
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetchBorne(url, opts, ms);
  const texte = await res.text();
  let data = null;
  try { data = texte ? JSON.parse(texte) : null; } catch (_) { data = null; }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.erreur)) || `Erreur ${res.status}`);
    err.detail = data;
    err.status = res.status;
    if (res.status === 401 && data && data.connexion && surNonConnecteFn) {
      surNonConnecteFn();
      err.aConnecter = true;
    }
    throw err;
  }
  return data;
}

// ===========================================================================
// DÉPOSER UN PAPIER SUR UNE LIGNE — ou sur toutes celles d'un dossier
// ===========================================================================
// Charlie, 04/09 : « la ligne créée contienne automatiquement le devis ou la
// facture à l'intérieur ». Les trois emplacements existaient depuis toujours ;
// personne n'y déposait rien, ils attendaient qu'on choisisse un fichier.
//
// ⚠ ICI ET PAS AVEC LE RENDU PDF. Envoyer des octets n'a besoin d'aucune
// bibliothèque de PDF — et `papier-pdf.js` en tire 511 Ko. Importé en tête des
// deux écrans flash pour cette seule fonction, il les aurait fait descendre à
// chaque ouverture, et il aurait fallu le mettre dans la coquille hors ligne.
//
// ⚠ SUR TOUTES LES LIGNES DU GROUPE. Depuis le 04/09 un article fait une
// ligne : une vente à trois articles en ouvre trois, et le papier est le MÊME
// pour les trois — c'est un seul document, celui que le client tient. Le
// déposer sur la première laisserait deux lignes vides du même dossier.
//
// ⚠ ET C'EST UN CONFORT, JAMAIS UNE CONDITION. La facture est déjà émise et
// archivée quand on arrive ici, le devis déjà au planning : un dépôt qui
// échoue ne doit pas transformer une vente réussie en échec. `allSettled` —
// une ligne qui refuse n'empêche pas les autres. Ne REJETTE jamais.
//
// @returns {Promise<{deposes: number, total: number}>}
export async function deposerPapier(ids, kind, bytes, nom) {
  const cibles = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!cibles.length || !bytes) return { deposes: 0, total: 0 };
  const un = async (id) => {
    const res = await fetchBorne(
      `/api/requests/${encodeURIComponent(id)}/pdf/${kind}?name=${encodeURIComponent(nom)}`,
      { method: 'PUT', body: bytes },
      DELAI_ENVOI,
    );
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
  };
  const sorties = await Promise.allSettled(cibles.map(un));
  return { deposes: sorties.filter((r) => r.status === 'fulfilled').length, total: cibles.length };
}
