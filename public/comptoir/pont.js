'use strict';

// PONT — ce qui relie les deux écrans du comptoir au reste du CRM.
// ===========================================================================
// `vente-directe.html` et `demande-devis.html` sont les écrans validés par le
// patron, repris tels quels. Ils ne connaissent rien du CRM : ils savent
// afficher un parcours et produire un récapitulatif. Ce fichier — chargé en
// dernier dans les deux pages — leur branche ce qui ne peut PAS vivre dans un
// écran isolé, ou ce qui ne doit pas repartir au prochain remplacement :
//
//   1. LA BASE CLIENTS. La vendeuse doit chercher dans les clients de
//      l'atelier, pas dans un jeu d'exemple. On remplit le tableau de l'écran
//      depuis GET /api/clients.
//   2. LE NUMÉRO DU JOUR. Deux postes qui encaissent en même temps ne doivent
//      jamais remettre le même numéro au client : le compteur vit en base
//      (POST /api/vente/numero · /api/devis/numero), pas dans le navigateur.
//
//   3. LE FILET. L'écran de fin annonce « ✅ enregistrée » alors que rien n'est
//      parti, et le seul bouton qui enregistre vraiment est greffé en dernier,
//      APRÈS ceux qui effacent le dossier. On envoie donc le dossier dès que
//      cet écran s'affiche, et on dit à la vendeuse où il en est (section 4).
//   4. LE PAPIER. Le ticket imprimé part à l'atelier avec le dossier : la
//      vendeuse a demandé qu'il cesse d'imprimer ce que personne n'y lit. Les
//      lignes retirées le sont à l'AFFICHAGE — la fiche envoyée au planning,
//      elle, garde tout.
//
// L'envoi au planning lui-même passe par le message `OLDA_CREATE_PROJECT` que
// la page poste déjà à la fenêtre parente ; c'est `nouveau-projet.js` qui
// l'écoute et appelle l'API. L'écran n'a donc aucune adresse d'API à connaître.
//
// Tout est en « si ça rate, on continue » : sans réseau, l'écran reste
// utilisable avec sa recherche vide et son numéro de secours. Une vente qui ne
// part pas au planning se voit — dans l'écran même, pas seulement dans le
// bandeau de l'hôte ; une vente qu'on ne peut pas SAISIR bloquerait le comptoir.

(function () {
  // Minuteur : sur un wifi qui décroche, `fetch` n'échoue jamais — il attend.
  // Ici c'est la réservation d'un numéro de ticket au moment où le client est
  // devant le comptoir : mieux vaut une erreur au bout de 15 s (l'écran bascule
  // alors sur son numéro de secours) qu'un écran qui ne rend jamais la main.
  // Ce fichier est chargé en script simple par les deux écrans du patron : il ne
  // peut pas importer `reseau.js`, d'où le minuteur écrit ici.
  const api = async (method, url, body) => {
    const minuteur = new AbortController();
    const stop = setTimeout(() => minuteur.abort(), 15000);
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: minuteur.signal,
      });
      if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(stop);
    }
  };

  // Le jour du POSTE, pas celui du serveur : le conteneur tourne en UTC, il
  // basculerait au lendemain dès 20 h à Saint-Martin.
  const jourDuPoste = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  // --- Le POSTE ---------------------------------------------------------------
  // Les deux écrans se donnent une référence de secours quand le compteur du
  // serveur est injoignable — et ils la tirent d'un compteur LOCAL qui repart à
  // 1 chaque matin. Deux tablettes hors réseau produisaient donc la MÊME
  // référence (« DEV-26.08.05-001 »), et le serveur, la prenant pour un renvoi
  // du même dossier, gardait la première et jetait la seconde sans un mot.
  // On marque donc chaque référence de secours du poste qui l'a émise : deux
  // tablettes ne peuvent plus se disputer un numéro, même sans réseau.
  const POSTE_KEY = 'olda.poste';
  let posteMemo = null;
  function poste() {
    if (posteMemo) return posteMemo;
    let id = null;
    try { id = localStorage.getItem(POSTE_KEY); } catch (_) { /* stockage refusé */ }
    if (!id || !/^[A-Z0-9]{3}$/.test(id)) {
      id = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0');
      try { localStorage.setItem(POSTE_KEY, id); } catch (_) { /* on garde en mémoire */ }
    }
    posteMemo = id;
    return id;
  }
  // Une référence déjà marquée ne l'est pas deux fois (l'écran peut se recharger).
  const marquerPoste = (ref) => {
    const s = String(ref || '').trim();
    if (!s) return s;
    return s.endsWith(`-${poste()}`) ? s : `${s}-${poste()}`;
  };

  // --- 1. La base clients ---------------------------------------------------
  // Une fiche de la base (colonnes du CRM) vue par l'écran du comptoir. Les
  // deux écrans lisent les mêmes clés, on les sert donc toutes :
  //   `name` = ce qu'on affiche (raison sociale, ou « Prénom NOM » d'un
  //   particulier) ; `company` n'est posé que pour un pro, c'est ce qui
  //   distingue les deux natures dans les écrans.
  // La NATURE telle que la nomme l'écran du comptoir. Tout ramener à
  // « Professionnel » faisait repartir une association ou un revendeur en pro
  // sur la ligne de planning, alors que sa fiche, elle, disait le contraire.
  const NATURE_ECRAN = {
    perso: 'Particulier',
    asso: 'Association',
    revendeur: 'Revendeur',
    pro: 'Professionnel',
  };

  function versEcran(c) {
    const pro = c.client_type !== 'perso';
    const fiche = {
      id: c.id,
      type: NATURE_ECRAN[c.client_type] || 'Professionnel',
      name: c.entreprise || '',
      phone: c.telephone || '',
      email: c.email || '',
    };
    if (!pro) return fiche;
    fiche.company = c.entreprise || '';
    fiche.contact = c.nom || '';
    fiche.contactRole = c.fonction || '';
    fiche.sector = c.type || '';
    fiche.address = c.adresse || '';
    fiche.city = c.zone || '';
    return fiche;
  }

  // `clients` (vente directe) et `clientDirectory` (demande de devis) sont des
  // `const` de la page : on les REMPLIT sur place, on ne les remplace pas.
  // `typeof` évite le ReferenceError sur l'écran qui n'a pas l'autre.
  async function chargerClients() {
    const liste = await api('GET', '/api/clients');
    const fiches = (Array.isArray(liste) ? liste : []).map(versEcran);
    if (typeof clients !== 'undefined' && Array.isArray(clients)) {
      clients.splice(0, clients.length, ...fiches);
    }
    if (typeof clientDirectory !== 'undefined' && Array.isArray(clientDirectory)) {
      clientDirectory.splice(0, clientDirectory.length, ...fiches);
      // La liste de l'étape 5 est déjà à l'écran, vide : on la redessine.
      if (typeof renderClientQuickList === 'function') renderClientQuickList();
    }
  }

  // --- 2. Le numéro du jour -------------------------------------------------
  // Réservé au PREMIER ARTICLE (vente) ou au PREMIER BESOIN (demande), JAMAIS à
  // l'ouverture de l'écran. Un numéro attribué n'est jamais réutilisé : ouvrir
  // l'onglet pour rien ferait un trou dans la numérotation des tickets remis aux
  // clients. C'est aussi la règle qu'appliquait l'écran précédent.
  // On surveille le panier plutôt que d'intercepter un bouton : les deux écrans
  // rebranchent les leurs à plusieurs endroits, le contenu du panier, lui, ne
  // ment pas.
  const premierArticle = () => (typeof products !== 'undefined' && Array.isArray(products) && products.length > 0);
  const premierBesoin = () => (typeof needs !== 'undefined' && Array.isArray(needs) && needs.length > 0);

  // VENTE DIRECTE : « 26.07.31-001 » dans le champ caché que lisent le ticket et
  // la ligne du planning. En attendant, la page garde le numéro de secours
  // qu'elle s'est donnée — jamais de champ vide sur un ticket.
  async function numeroVente() {
    const champ = document.getElementById('orderNumber');
    if (!champ) return;
    const r = await api('POST', '/api/vente/numero', { jour: jourDuPoste() });
    if (r && r.numero) champ.value = r.numero;
  }

  // Le numéro de secours que la page s'est donnée à son chargement porte, lui
  // aussi, la marque du poste — sinon deux tablettes hors réseau tirent le même
  // « VD-260805-417 » sur un coup de dé à 1 chance sur 900.
  function marquerNumeroVenteDeSecours() {
    const champ = document.getElementById('orderNumber');
    if (champ && champ.value) champ.value = marquerPoste(champ.value);
  }

  // DEMANDE DE DEVIS : « DEV-26.07.31-001 ». `reference` est la variable que
  // toute la page relit (bandeaux d'étape, récapitulatif, message au planning),
  // donc on la réécrit ET on rafraîchit les bandeaux déjà dessinés.
  // Contrairement au ticket de vente, cette référence est AFFICHÉE dès la
  // première étape : tant qu'elle n'est pas réservée on montre « — » plutôt
  // qu'un numéro provisoire que la vendeuse pourrait annoncer au client avant
  // qu'il ne change.
  let refSecours = '';
  function peindreRef() {
    document.querySelectorAll('.ref-display').forEach((el) => { el.textContent = reference || '—'; });
  }
  function masquerRef() {
    if (typeof reference === 'undefined') return;
    refSecours = marquerPoste(reference);
    reference = '';
    peindreRef();
  }
  async function numeroDevis() {
    if (typeof reference === 'undefined') return;
    try {
      const r = await api('POST', '/api/devis/numero', { jour: jourDuPoste() });
      reference = (r && r.numero) || refSecours;
    } catch (err) {
      // Hors ligne : on retombe sur le numéro que la page s'était donné plutôt
      // que de laisser la demande sans référence.
      reference = refSecours;
      throw err;
    } finally {
      peindreRef();
    }
  }

  const raterEnSilence = (quoi) => (err) => console.warn(`Comptoir : ${quoi} — ${err.message}`);

  // Scrutation bornée : un écran ouvert puis laissé de côté toute la journée ne
  // doit pas garder une minuterie qui tourne dans le vide. Deux heures couvrent
  // très largement la prise d'une commande au comptoir ; au-delà, la page a été
  // abandonnée et le prochain client repartira d'un document neuf (resetProjet).
  const VEILLE_MS = 400;
  const VEILLE_MAX = 2 * 60 * 60 * 1000;
  function guetterPremiereLigne() {
    let reserve = false;
    let ecoule = 0;
    const veille = setInterval(() => {
      if (reserve) return;
      ecoule += VEILLE_MS;
      const vente = premierArticle();
      if (!vente && !premierBesoin()) {
        if (ecoule >= VEILLE_MAX) clearInterval(veille);
        return;
      }
      reserve = true;
      clearInterval(veille);
      (vente ? numeroVente() : numeroDevis())
        .catch(raterEnSilence('numéro du jour indisponible — numéro de secours conservé'));
    }, VEILLE_MS);
  }

  chargerClients().catch(raterEnSilence('base clients indisponible'));
  masquerRef();
  marquerNumeroVenteDeSecours();
  guetterPremiereLigne();

  // --- 3. Filet : l'écran ouvert SANS le CRM autour -------------------------
  // Dans le CRM, « Créer dans le planning » poste `OLDA_CREATE_PROJECT` à la
  // fenêtre parente, qui appelle l'API. Ouvert en direct (ancien favori, onglet
  // sur le fichier), parent = la page elle-même : le message ne rejoignait
  // PERSONNE et la vente n'entrait jamais au planning — sans erreur, sans bruit.
  // Ici, on rattrape ce message orphelin et on appelle l'API nous-mêmes, avec
  // un retour VISIBLE dans les deux sens : la vendeuse sait, toujours.
  // Ce que le serveur a réellement fait, en clair. Trois issues, trois phrases :
  // la ligne est née ; c'était le MÊME dossier renvoyé (rien de créé, et c'est
  // très bien) ; ou une AUTRE commande portait déjà cette référence et celle-ci
  // a dû en prendre une autre — auquel cas le ticket remis au client ne dit plus
  // la vérité, et il faut le savoir tout de suite.
  function messageEnregistrement(data) {
    const d = data && typeof data === 'object' ? data : {};
    if (d.dejaEnregistre) {
      return 'Ce dossier était déjà au planning : l’envoi précédent avait abouti.\nRien n’a été créé en double.';
    }
    if (d.refModifiee) {
      return `Commande enregistrée au planning ✔\n\nATTENTION : la référence du ticket était déjà prise par une AUTRE commande.\nCelle-ci est enregistrée sous « ${d.refModifiee} ».\nCorrige le numéro sur le ticket remis au client.`;
    }
    return 'Commande enregistrée au planning ✔';
  }

  // Une panne de LIAISON (réseau tombé, minuteur échu) se distingue d'un refus
  // du serveur : la première se retente toute seule, le second non — renvoyer
  // un dossier invalide donnerait la même erreur trois secondes plus tard.
  const estPanneLiaison = (err) => !!err
    && (err.name === 'AbortError' || err instanceof TypeError);

  let envoiEnCours = false;
  if (window.parent === window) {
    window.addEventListener('message', async (e) => {
      if (e.source !== window) return; // seul le message que la page s'adresse
      if (e.origin !== location.origin) return; // même verrou explicite qu'en iframe
      const msg = e.data;
      if (!msg || msg.type !== 'OLDA_CREATE_PROJECT' || !msg.payload) return;
      if (envoiEnCours) return; // double tap = une seule ligne
      envoiEnCours = true;
      try {
        let data;
        try {
          data = await api('POST', '/api/comptoir/projet', msg.payload);
        } catch (err1) {
          // Le wifi de l'atelier décroche par à-coups de quelques secondes —
          // exactement la durée d'une impression de ticket. UNE relance
          // automatique avant de déranger la vendeuse : l'empreinte du dossier
          // garantit côté serveur qu'un doublon est impossible.
          if (!estPanneLiaison(err1)) throw err1;
          await new Promise((r) => setTimeout(r, 3000));
          data = await api('POST', '/api/comptoir/projet', msg.payload);
        }
        // Le serveur ne dit pas seulement « c'est passé » : il dit AUSSI quand
        // il a reconnu un renvoi du même dossier, et quand il a dû changer la
        // référence parce qu'un autre dossier la portait déjà. Annoncer les
        // trois cas de la même façon, c'était laisser croire à un enregistrement
        // là où rien n'avait été créé.
        resultatEnvoi(true, messageEnregistrement(data));
        // Un envoi AUTOMATIQUE ne s'annonce pas par une boîte de dialogue : la
        // vendeuse est en train d'imprimer le ticket du client, un `alert` lui
        // barre l'écran pour dire ce que le bandeau dit déjà.
        if (!envoiAutomatique) alert(messageEnregistrement(data));
      } catch (err) {
        resultatEnvoi(false, err.message);
        if (!envoiAutomatique) alert(`Enregistrement au planning IMPOSSIBLE : ${err.message}\nLe dossier est intact — réessaie.`);
      } finally {
        envoiEnCours = false;
      }
    });
  } else {
    // Dans le CRM, c'est l'hôte qui appelle l'API : lui seul sait ce qu'elle a
    // répondu. Il nous le renvoie, sinon l'écran de la vendeuse ne peut RIEN
    // dire de son propre dossier — c'est précisément le trou par lequel les
    // dossiers partaient sans que personne ne s'en aperçoive.
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return;
      // Seul L'HÔTE a le droit de dire « c'est au planning » : sans ce verrou,
      // n'importe quelle fenêtre de même origine (l'iframe voisine, un autre
      // onglet) pouvait peindre « ✔ » sur un dossier jamais parti — et éteindre
      // du même coup le bouton Réessayer et le garde-fou de fermeture.
      if (e.source !== window.parent) return;
      const m = e.data;
      if (!m || m.type !== 'OLDA_PROJET_RESULT') return;
      resultatEnvoi(!!m.ok, m.message || '');
    });
  }

  // --- 4. LE FILET : le dossier n'attend plus un dernier bouton --------------
  // L'écran de fin des deux parcours annonce « ✅ Demande enregistrée » /
  // « ✅ Commande enregistrée » ALORS QUE RIEN n'est parti au planning : à cet
  // instant le dossier n'existe que dans cet onglet. La seule action qui
  // l'enregistre vraiment — « 📅 Créer dans le planning » — est greffée EN
  // DERNIER, après « Nouvelle demande » / « Nouvelle vente » (qui rechargent la
  // page et effacent tout) et, côté devis, après « 💾 Enregistrer » (qui écrit
  // un brouillon dans le navigateur que RIEN ne relit jamais, en annonçant
  // « Brouillon enregistré »).
  //
  // Une vendeuse qui imprime le ticket, le remet au client et enchaîne perd
  // donc le dossier — sans message, sans trace, et sans que la recherche du
  // planning puisse le retrouver puisqu'il n'a jamais existé. C'est ce qui
  // s'est passé le 13/08 : numéro de devis réservé côté serveur
  // (`app_meta.devis_seq_20260813`), aucune ligne au planning, une cliente
  // introuvable le lendemain.
  //
  // Trois corrections, ici et pas dans les écrans du patron :
  //   1. dès que l'écran de fin s'affiche, le dossier part au planning TOUT
  //      SEUL — l'écran dit déjà « enregistrée », on le rend vrai ;
  //   2. un bandeau DANS l'écran dit où en est ce dossier, avec un bouton pour
  //      réessayer (le message d'erreur de l'hôte, lui, vit au-dessus du cadre,
  //      donc hors de vue sur la tablette) ;
  //   3. les boutons qui EFFACENT le dossier préviennent tant qu'il n'est pas
  //      au planning.

  // Les deux écrans de fin, chacun repéré par son identifiant, tous deux
  // masqués par la classe `hidden` de la page.
  const ECRANS_FINAUX = ['step7', 'paymentSuccess'];
  function ecranFinal() {
    for (const id of ECRANS_FINAUX) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) return el;
    }
    return null;
  }

  // attente → envoi → ok | echec. `ok` est le seul état où le dossier existe
  // ailleurs que dans cet onglet.
  let etatEnvoi = 'attente';
  let envoiAutomatique = false;
  let abandonAssume = false;

  const STYLE_ETAT = `
    .olda-etat{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
      margin:0 0 14px;padding:14px 16px;border-radius:14px;
      font:700 15px/1.35 inherit;border:2px solid transparent}
    .olda-etat__texte{flex:1 1 220px;white-space:pre-line}
    .olda-etat--envoi{background:#f5f6f8;color:#111827;border-color:#d7dae0}
    .olda-etat--ok{background:#e9f7ef;color:#0b5c34;border-color:#0b5c34}
    .olda-etat--echec{background:#fdecea;color:#8f1d14;border-color:#8f1d14}
    .olda-etat__reessai{min-height:44px;padding:0 18px;border-radius:12px;
      border:0;background:#8f1d14;color:#fff;font:700 15px/44px inherit;
      cursor:pointer}
  `;
  function poserStyle() {
    if (document.getElementById('olda-etat-style')) return;
    const s = document.createElement('style');
    s.id = 'olda-etat-style';
    s.textContent = STYLE_ETAT;
    document.head.appendChild(s);
  }

  // Le bandeau vit EN TÊTE de l'écran de fin : c'est la première chose lue, et
  // il suit l'écran s'il change (les deux parcours réaffichent leur carte).
  function bandeau() {
    const ecran = ecranFinal();
    if (!ecran) return null;
    poserStyle();
    let el = document.getElementById('olda-etat-planning');
    if (!el) {
      el = document.createElement('div');
      el.id = 'olda-etat-planning';
      el.setAttribute('role', 'status');
      const texte = document.createElement('span');
      texte.className = 'olda-etat__texte';
      const reessai = document.createElement('button');
      reessai.type = 'button';
      reessai.className = 'olda-etat__reessai';
      reessai.textContent = 'Réessayer l’enregistrement';
      reessai.addEventListener('click', () => envoyerAuPlanning(false));
      el.append(texte, reessai);
    }
    if (el.parentNode !== ecran || ecran.firstChild !== el) ecran.insertBefore(el, ecran.firstChild);
    return el;
  }

  const PHRASES = {
    attente: 'Ce dossier n’est pas encore au planning.',
    envoi: 'Enregistrement au planning…',
    // On dit AUSSI où il est. Tout ce qui sort du comptoir attend désormais
    // dans « À trier », en tête du planning : la vendeuse enchaîne
    // ses clients, puis range les dossiers d'un geste chacun.
    ok: '✔ Ce dossier est au planning, dans « À trier ».',
    echec: '⚠ Ce dossier n’est PAS au planning.',
  };
  let dernierPeint = '';
  let dernierDetail = '';
  function peindreEtat(nouveau) {
    // `null` vaut « garde ce que tu disais » : le guet repasse à chaque mutation
    // de la page pour ré-ancrer le bandeau, et il ne doit pas effacer au passage
    // la RAISON d'un échec — la seule chose utile à lire dans le bandeau rouge.
    if (nouveau != null) dernierDetail = nouveau;
    const detail = dernierDetail;
    const el = bandeau();
    if (!el) return;
    // Le guet repasse toutes les 400 ms : on ne réécrit que ce qui change,
    // sinon on remonte le même texte sous les yeux de la vendeuse en boucle.
    const signature = `${etatEnvoi}${detail}`;
    if (signature === dernierPeint) return;
    dernierPeint = signature;
    el.className = `olda-etat olda-etat--${etatEnvoi === 'ok' ? 'ok' : etatEnvoi === 'echec' ? 'echec' : 'envoi'}`;
    el.firstChild.textContent = detail ? `${PHRASES[etatEnvoi]}\n${detail}` : PHRASES[etatEnvoi];
    el.lastChild.hidden = etatEnvoi !== 'echec' && etatEnvoi !== 'attente';
    // Le bouton greffé par l'écran ne peut plus dire « Créer » une fois la
    // ligne créée : elle l'est, et le retaper ne crée rien (l'empreinte du
    // dossier le fait reconnaître). On le dit plutôt que de le laisser mentir.
    const btn = document.getElementById('oldaCreatePlanningBtn');
    if (btn && etatEnvoi === 'ok') {
      btn.disabled = true;
      btn.textContent = '📅 Déjà au planning';
    }
  }

  function resultatEnvoi(ok, message) {
    clearTimeout(minuteurEnvoi);
    minuteurEnvoi = null;
    etatEnvoi = ok ? 'ok' : 'echec';
    envoiAutomatique = false;
    // Même en cas de succès, le serveur a parfois quelque chose d'URGENT à dire :
    // « la référence était déjà prise, ce dossier porte désormais un autre
    // numéro » — donc le ticket entre les mains du client est faux. Cette
    // phrase-là doit être dans l'écran, pas seulement dans le bandeau de l'hôte
    // qui, sur la tablette en paysage, est au-dessus du cadre et hors de vue.
    peindreEtat(message || '');
  }

  // Le payload appartient à l'écran : il est construit par le bouton que la
  // page se greffe (`patchPlanningButton`), avec TOUT ce que le parcours a
  // recueilli. On ne le retranscrit pas — on presse son bouton.
  //
  // LE CHIEN DE GARDE. L'état « envoi » s'en remettait entièrement au retour
  // d'un message : si rien ne revenait JAMAIS (bouton regreffé dont le clic
  // tombe dans le vide, hôte qui jette le message, gestionnaire de la page qui
  // abandonne sans mot dire), le bandeau restait sur « Enregistrement… » pour
  // toujours — SANS bouton Réessayer (masqué hors échec), et avec le garde-fou
  // de fermeture qui empêchait même de quitter l'écran. Le dossier qu'on
  // protège restait prisonnier de sa protection.
  const ENVOI_MAX_MS = 25000;
  let minuteurEnvoi = null;

  function envoyerAuPlanning(auto) {
    if (etatEnvoi === 'envoi' || etatEnvoi === 'ok') return;
    if (typeof window.patchPlanningButton === 'function') window.patchPlanningButton();
    const btn = document.getElementById('oldaCreatePlanningBtn');
    // `isConnected` : les écrans regreffent leurs boutons sur leur propre
    // minuteur — cliquer un nœud détaché ne poste rien, sans erreur.
    if (!btn || !btn.isConnected) {
      etatEnvoi = 'echec';
      peindreEtat('Le bouton « Créer dans le planning » est introuvable sur cet écran.');
      return;
    }
    etatEnvoi = 'envoi';
    envoiAutomatique = !!auto;
    peindreEtat('');
    clearTimeout(minuteurEnvoi);
    minuteurEnvoi = setTimeout(() => {
      minuteurEnvoi = null;
      if (etatEnvoi !== 'envoi') return;
      etatEnvoi = 'echec';
      peindreEtat('Aucune réponse — le réseau a peut-être décroché. Réessaie.');
    }, ENVOI_MAX_MS);
    // L'hôte saute sur la ligne créée — parfait quand c'est la vendeuse qui l'a
    // demandé, désastreux quand c'est automatique : elle a le ticket du client
    // à l'écran et se retrouverait au planning sans l'avoir imprimé.
    if (window.parent !== window && auto) {
      parent.postMessage({ type: 'OLDA_ENVOI_AUTOMATIQUE' }, location.origin);
    }
    btn.click();
  }

  // L'écran de fin vient de s'afficher : le dossier est complet (le devis a
  // passé ses contrôles, la vente a été encaissée). Il part.
  let finalVu = false;
  function guetterEcranFinal() {
    const ecran = ecranFinal();
    if (!ecran) { finalVu = false; return; }
    // Le repassage ne fait que RÉ-ANCRER le bandeau (les deux parcours
    // reconstruisent leur carte) : `null` = « garde ce que tu disais ». Écraser
    // le détail effaçait la raison de l'échec — précisément ce qu'il faut lire.
    if (finalVu) { peindreEtat(null); return; }
    finalVu = true;
    peindreEtat('');
    envoyerAuPlanning(true);
  }

  // « 💾 Enregistrer » (écran devis) écrivait un brouillon dans le navigateur
  // que RIEN ne relit — jamais — et annonçait « Brouillon enregistré » : la
  // vendeuse repartait convaincue d'avoir sauvegardé son dossier. On le
  // rebranche sur le seul enregistrement qui existe.
  // Le nœud rebranché est mémorisé : tant qu'il est vivant, on ne repaie pas le
  // sélecteur d'attribut par préfixe (le plus lent qui soit, non indexable) —
  // qui tournait ici plusieurs fois par seconde, sur un document de 126 Ko.
  let boutonBrouillon = null;
  function rebrancherBoutonBrouillon() {
    if (boutonBrouillon && boutonBrouillon.isConnected) return;
    boutonBrouillon = null;
    const b = document.querySelector('[onclick^="saveDraft"]');
    if (!b) return;
    boutonBrouillon = b;
    if (b.__oldaRebranche) return;
    b.__oldaRebranche = true;
    b.removeAttribute('onclick');
    b.onclick = null;
    b.textContent = '💾 Enregistrer au planning';
    b.addEventListener('click', () => envoyerAuPlanning(false));
  }

  // Les boutons qui EFFACENT le dossier : « Nouvelle demande » et « Nouvelle
  // vente » rechargent la page, « Retour accueil » quitte l'écran de fin. Tant
  // que le dossier n'est pas au planning, ils le perdent pour de bon. On ne les
  // bloque pas — une vendeuse doit pouvoir abandonner un dossier — on lui dit
  // ce qu'elle est en train de faire.
  const DESTRUCTEURS = '#newSaleBtn, #homeBtn, [onclick^="newRequest"]';
  document.addEventListener('click', (e) => {
    const cible = e.target && e.target.closest ? e.target.closest(DESTRUCTEURS) : null;
    if (!cible) return;
    if (abandonAssume) return;
    if (!ecranFinal() || etatEnvoi === 'ok') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const perdre = window.confirm(
      'Ce dossier n’est PAS enregistré au planning.\n\n'
      + 'Si tu continues, il sera perdu : personne ne pourra le retrouver, ni par la recherche, ni autrement.\n\n'
      + 'OK = continuer quand même · Annuler = rester (bouton « Réessayer » en haut de l’écran)',
    );
    if (!perdre) return;
    // Le geste est assumé : on le rejoue tel quel, et le garde-fou de fermeture
    // se tait lui aussi. Si l'écran demande sa propre confirmation et qu'elle
    // l'annule, la page reste : le drapeau retombe au tour de boucle suivant.
    abandonAssume = true;
    cible.click();
    setTimeout(() => { abandonAssume = false; }, 0);
  }, true);

  // Dernier garde-fou : fermer l'onglet ou recharger le CRM emporte, lui aussi,
  // un dossier qui n'est pas parti.
  window.addEventListener('beforeunload', (e) => {
    if (!ecranFinal() || etatEnvoi === 'ok' || abandonAssume) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // Les brouillons déjà écrits par l'ancien bouton dorment dans ce navigateur
  // et rien ne les relit : ce sont peut-être des dossiers jamais arrivés au
  // planning. On les montre plutôt que de les laisser mourir avec le cache.
  function montrerBrouillonsOublies() {
    let cles = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith('oldaDraft-')) cles.push(k);
      }
    } catch (_) { return; } // stockage refusé : rien à montrer
    if (!cles.length) return;
    poserStyle();
    const box = document.createElement('div');
    box.className = 'olda-etat olda-etat--echec';
    box.style.margin = '12px';
    const texte = document.createElement('span');
    texte.className = 'olda-etat__texte';
    texte.textContent = `${cles.length} brouillon(s) enregistré(s) sur CETTE tablette et jamais envoyés au planning : `
      + `${cles.map((k) => k.replace('oldaDraft-', '')).join(', ')}. `
      + 'Ouvre-les pour recopier le dossier, puis efface-les.';
    const voir = document.createElement('button');
    voir.type = 'button';
    voir.className = 'olda-etat__reessai';
    voir.textContent = 'Voir le contenu';
    voir.addEventListener('click', () => {
      const tout = cles.map((k) => {
        let d = {};
        try { d = JSON.parse(localStorage.getItem(k)) || {}; } catch (_) { /* illisible */ }
        const client = d.selectedClient ? (d.selectedClient.company || d.selectedClient.name || '') : '';
        const besoins = (d.needs || []).map((n) => `${n.qty} x ${n.label}`).join(' • ');
        const champs = Object.entries(d.fields || {})
          .filter(([, v]) => v !== '' && v !== false && v != null)
          .map(([c, v]) => `  ${c} : ${v}`).join('\n');
        return `${k.replace('oldaDraft-', '')}\nClient : ${client || '—'}\nBesoins : ${besoins || '—'}\n${champs}`;
      }).join('\n\n———\n\n');
      window.alert(tout);
    });
    const effacer = document.createElement('button');
    effacer.type = 'button';
    effacer.className = 'olda-etat__reessai';
    effacer.textContent = 'Effacer';
    effacer.addEventListener('click', () => {
      if (!window.confirm('Effacer ces brouillons de cette tablette ?')) return;
      for (const k of cles) { try { localStorage.removeItem(k); } catch (_) { /* rien à faire */ } }
      cles = [];
      box.remove();
    });
    box.append(texte, voir, effacer);
    document.body.insertBefore(box, document.body.firstChild);
  }

  // --- LE PAPIER --------------------------------------------------------------
  // Ce que la vendeuse imprime et qui part à l'atelier avec le dossier. Les deux
  // écrans remplissent ce ticket chacun de leur côté (`fillTicket` pour la
  // vente, `fillFinal` pour la demande) ; on repasse derrière eux pour retirer
  // du PAPIER ce qui n'y sert à personne.
  //
  // ON RETIRE DE L'AFFICHAGE, JAMAIS DE LA SOURCE. `clientInfoLines` alimente
  // aussi le dossier envoyé au planning (`client_info`) et la carte du client à
  // l'écran : filtrer à la source appauvrirait la fiche du CRM pour un choix de
  // mise en page. On coupe donc dans les lignes DÉJÀ DESSINÉES.
  //
  // Et c'est ici, pas dans les écrans : une nouvelle version d'un écran du
  // patron se pose en remplaçant le fichier, elle réimprimerait tout.

  // Les deux écrans écrivent « Non renseigné » ou « — » plutôt que rien. Sur le
  // papier, une ligne qui dit qu'il n'y a rien à dire est une ligne de trop.
  const RIEN_A_DIRE = (v) => {
    const s = String(v == null ? '' : v).trim();
    return s === '' || s === '—' || s === 'Non renseigné' || s === 'Non renseignée';
  };

  // CE QUI RESTE SUR LE PAPIER, ligne par ligne. Pur : c'est la règle, pas le
  // DOM — elle se relit et s'éprouve sans navigateur.
  function surLePapier(libelle, valeur) {
    // Le nom du client s'imprimait DEUX FOIS : en tête du bloc (« Client : … »)
    // et en ligne « Nom / société » juste dessous. On garde la tête.
    if (libelle === 'Nom / société') return false;
    // Une adresse e-mail qu'on n'a pas ne s'imprime pas.
    if (libelle === 'E-mail') return !RIEN_A_DIRE(valeur);
    // Le délai souhaité redit à sa façon la « Récupération prévue » imprimée en
    // tête : deux façons de dire quand, c'en est une de trop.
    if (libelle === 'Délai souhaité') return false;
    return true;
  }

  // Une ligne du ticket, telle que les deux écrans la dessinent :
  // `<div class="tl"><span>libellé</span><strong>valeur</strong></div>`.
  function elaguer(id) {
    const box = document.getElementById(id);
    if (!box) return;
    for (const tl of [...box.querySelectorAll('.tl')]) {
      const k = tl.querySelector('span');
      const v = tl.querySelector('strong');
      if (!surLePapier(k ? k.textContent.trim() : '', v ? v.textContent.trim() : '')) tl.remove();
    }
  }

  // Le ticket part à l'atelier avec le dossier : il n'a pas de formule de
  // politesse à porter.
  function retirerPied() {
    const pied = document.querySelector('.ticket-footer');
    if (pied) pied.remove();
  }

  // `titreNumero` : « Commande : 26.08.17-004 » ne dit pas ce qu'est ce nombre.
  // La vendeuse et l'atelier y lisent un NUMÉRO — et l'écran des devis n'annonce
  // pas une commande.
  function allegerTicket(titreNumero) {
    const num = document.getElementById('ticketOrder');
    if (num) num.textContent = num.textContent.replace(/^\s*Commande\s*:/, `${titreNumero} :`);
    elaguer('ticketClientDetails');
    elaguer('ticketExtraDetails');
    retirerPied();
  }

  // On se greffe SUR le remplissage de l'écran, sans le refaire : il garde la
  // main sur ce qu'il imprime, on ne fait qu'en retirer des lignes. Un écran qui
  // n'existe pas sur cette page (l'autre parcours) ne se greffe pas.
  function grefferSurLeTicket(nom, titreNumero) {
    const original = window[nom];
    if (typeof original !== 'function' || original.__oldaPapier) return;
    const greffe = function greffePapier(...args) {
      const rendu = original.apply(this, args);
      // Un ticket qui s'imprime avec une ligne de trop vaut mieux qu'un ticket
      // qui ne s'imprime pas : l'élagage ne prend jamais le parcours avec lui.
      try { allegerTicket(titreNumero); } catch (_) { /* le papier reste imprimable tel quel */ }
      return rendu;
    };
    greffe.__oldaPapier = true;
    window[nom] = greffe;
  }

  grefferSurLeTicket('fillTicket', 'Numéro de commande');
  grefferSurLeTicket('fillFinal', 'Numéro de la demande');
  retirerPied();

  // On guette le CHANGEMENT, pas l'horloge : les deux écrans démasquent leur
  // carte de fin en retirant une classe, un observateur le voit à l'instant
  // même. Un `setInterval` suffirait presque — mais un navigateur bride ses
  // minuteurs à ~1 s dès que l'onglet passe au second plan, et l'envoi du
  // dossier ne doit pas dépendre de ça. La scrutation reste en second rideau,
  // pour ce qui ne passe pas par une mutation (et parce que les écrans
  // regreffent leurs propres boutons toutes les 400 ms).
  const veilleur = new MutationObserver(() => { guetterEcranFinal(); rebrancherBoutonBrouillon(); });
  // `attributeFilter` : le guet ne réagit qu'à la classe — c'est elle (`hidden`)
  // qui démasque l'écran de fin. Sans le filtre, CHAQUE changement d'attribut
  // du document (les minuteurs des écrans en produisent plusieurs par seconde)
  // rejouait les deux contrôles. `childList` reste entier : le bouton brouillon
  // et la carte de fin sont régulièrement regreffés en tant que nœuds.
  veilleur.observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
  });
  setInterval(() => { guetterEcranFinal(); rebrancherBoutonBrouillon(); }, VEILLE_MS);
  guetterEcranFinal();
  rebrancherBoutonBrouillon();
  montrerBrouillonsOublies();

  // L'hôte réaffiche l'écran pour un nouveau client : la base a pu bouger
  // entre-temps (un client créé depuis l'onglet Base clients).
  window.oldaRafraichirClients = () => chargerClients().catch(raterEnSilence('base clients indisponible'));
})();
