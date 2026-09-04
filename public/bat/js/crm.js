// ===========================================================================
// LE LIEN AVEC LE CRM
// ---------------------------------------------------------------------------
// BAT Studio a vocation à vivre DANS le CRM. Le premier fil entre les deux,
// c'est le document : un BAT produit ici doit se retrouver dans la fiche du
// client, sans que personne ne le déplace à la main.
//
// LE CRM MÈNE. C'est lui qui ouvre BAT Studio, et il annonce sur quelle fiche
// on travaille par l'adresse :
//
//     …/bat?request=<id>            (et éventuellement &client=…&projet=…)
//
// L'identifiant est retenu SUR LE PROJET : rouvrir un BAT trois jours plus tard,
// depuis la liste et sans paramètre, dépose quand même au bon endroit.
//
// Le dépôt passe par NOTRE serveur (cf. server/crm.mjs) : le mot de passe du
// CRM ne descend jamais dans la page. Le jour où les deux applications
// partagent le même processus, cette fonction devient un appel direct.

import { chemin } from './base.js';
import { nettoyerId } from './util.js';

// L'identifiant se nettoie dans `util.js` — sans DOM, donc testable en Node, et
// partagé avec `batDeLaFiche` qui applique exactement la même règle.
export { nettoyerId };

let _actif = null;   // null = pas encore demandé

// Le CRM est-il branché ? Une seule question au serveur, mémoïsée : la réponse
// ne change pas en cours de session.
export async function crmActif() {
  if (_actif !== null) return _actif;
  try {
    const r = await fetch(chemin('/api/crm'));
    _actif = r.ok ? !!(await r.json()).actif : false;
  } catch { _actif = false; }
  return _actif;
}

// Le contexte annoncé par l'adresse au chargement. Lu une fois : le CRM peut
// remplacer l'URL ensuite (navigation interne), ce qui ne change pas la fiche
// sur laquelle on a été ouvert.
const params = new URLSearchParams(location.search);
export const contexteOuverture = {
  requestId: nettoyerId(params.get('request')),
  client: (params.get('client') || '').trim(),
  projet: (params.get('projet') || '').trim(),
};

// Colle le contexte d'ouverture sur un projet qui n'en a pas encore. Ne réécrit
// JAMAIS un identifiant déjà posé : un projet appartient à une fiche, et ce
// n'est pas un paramètre d'URL qui le fait changer de client.
export function attacherContexte(project) {
  if (!project || project.crmRequestId) return false;
  if (!contexteOuverture.requestId) return false;
  project.crmRequestId = contexteOuverture.requestId;
  if (!String(project.client || '').trim() && contexteOuverture.client) project.client = contexteOuverture.client;
  if (!String(project.name || '').trim() && contexteOuverture.projet) project.name = contexteOuverture.projet;
  return true;
}

/**
 * Dépose un BAT dans la fiche du CRM.
 * Ne LÈVE PAS : le PDF est déjà produit et archivé chez nous, un CRM
 * injoignable ne doit pas transformer un export réussi en échec.
 * @returns {Promise<{ok:boolean, message:string}>}
 */
export async function deposerDansCrm(requestId, bytes, nomFichier) {
  const id = nettoyerId(requestId);
  if (!id) return { ok: false, message: 'Aucune fiche CRM associée à ce projet.' };
  try {
    const r = await fetch(chemin(`/api/crm/bat/${encodeURIComponent(id)}?name=${encodeURIComponent(nomFichier)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: bytes,
    });
    if (r.ok) return { ok: true, message: `BAT déposé dans la fiche ${id}.` };
    let detail = '';
    try { detail = (await r.json()).error || ''; } catch { /* corps illisible */ }
    return { ok: false, message: detail || `Le CRM a refusé le dépôt (${r.status}).` };
  } catch (e) {
    return { ok: false, message: 'CRM injoignable : ' + (e.message || e) };
  }
}
