// ===========================================================================
// LA RACINE — OÙ CETTE APPLICATION EST SERVIE
// ---------------------------------------------------------------------------
// BAT Studio a vocation à vivre DANS le CRM. Les deux servent des routes sous
// `/api/` : `/api/data`, `/api/info`, `/api/backup` ici ; `/api/requests`,
// `/api/stream` là-bas. Sur une même origine, elles se percutent.
//
// Tout ce qui est absolu passe donc par `chemin()`. Servie à la racine, la
// fonction ne fait rien ; servie sous `/bat`, elle préfixe — et côté serveur,
// une seule ligne (BAT_BASE_PATH) suffit à déplacer l'application entière.
//
// LA RACINE SE DÉDUIT, elle ne se configure pas. Ce module est chargé depuis
// `<racine>/js/base.js` : sa propre URL dit donc où l'application est posée.
// Un réglage à tenir en double — ici et sur le serveur — est un réglage qui
// finit par mentir ; celui-ci ne peut pas se tromper.
export const RACINE = new URL('../', import.meta.url).pathname.replace(/\/+$/, '');

/**
 * Chemin absolu, préfixé par la racine de l'application.
 * Nommée `chemin` et pas `url` : `url` est déjà le nom naturel d'une variable
 * locale un peu partout (une URL collée, une URL de mockup), et l'ombre serait
 * silencieuse — la variable masquerait la fonction, et l'appel échouerait
 * seulement à l'exécution, dans une branche rare.
 * @param {string} rel  chemin commençant par « / » (ex. '/api/info')
 */
export function chemin(rel) {
  return RACINE + (rel.startsWith('/') ? rel : '/' + rel);
}
