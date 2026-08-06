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
export const DELAI_DEFAUT = 20000;
// Un PDF de plusieurs mégaoctets sur l'ADSL de l'atelier prend légitimement du
// temps : lui appliquer le délai des requêtes courtes couperait des envois qui
// se seraient bien terminés.
export const DELAI_ENVOI = 60000;

// Le message est en français et sans jargon : il traverse `estPanneReseau`, qui
// le range avec « Failed to fetch » — pour l'atelier, un serveur qui ne répond
// pas et un réseau tombé, c'est la même chose et la même conduite à tenir.
export const MESSAGE_DELAI = 'le serveur ne répond pas';

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
