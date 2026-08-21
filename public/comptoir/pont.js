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
//   5. QUI SIGNE. « Demande prise par » était reposé à chaque dossier, dans un
//      écran d'ouverture qui n'existait que pour lui. La question se pose
//      désormais UNE fois par appareil, dans le CRM ; on reporte ici le nom
//      dans le champ que le parcours connaît déjà.
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

  // --- L'INDICATIF DU PAYS ----------------------------------------------------
  // Saint-Martin est une île FRONTIÈRE. Le côté français (+590) et le côté
  // néerlandais (+1721) se croisent au comptoir toute la journée, et les clients
  // de passage arrivent des États-Unis, d'Anguilla ou de métropole. Les deux
  // écrans, eux, ne savaient écrire qu'un plan français à dix chiffres : ils
  // TRONQUAIENT au-delà et affichaient « il manque des chiffres » sur un numéro
  // de Philipsburg parfaitement valide.
  //
  // Greffé ICI, pas dans les écrans : une nouvelle version d'un écran du patron
  // se pose en remplaçant le fichier, elle repartirait sans l'indicatif.

  // La longueur locale attendue se DÉDUIT du découpage : une seule vérité par
  // pays, pas un nombre à tenir d'accord avec un format.
  const PAYS_TEL = [
    { code: '590', nom: 'Saint-Martin · Guadeloupe', groupes: [3, 2, 2, 2] },
    { code: '1721', nom: 'Sint Maarten (côté néerlandais)', groupes: [3, 4] },
    { code: '33', nom: 'France métropole', groupes: [1, 2, 2, 2, 2] },
    { code: '596', nom: 'Martinique', groupes: [3, 2, 2, 2] },
    { code: '594', nom: 'Guyane', groupes: [3, 2, 2, 2] },
    { code: '1264', nom: 'Anguilla', groupes: [3, 4] },
    { code: '1', nom: 'États-Unis · Canada', groupes: [3, 3, 4] },
    { code: '31', nom: 'Pays-Bas', groupes: [1, 2, 2, 2, 2] },
  ];
  const PAYS_TEL_DEFAUT = '590';

  const telChiffres = (v) => String(v == null ? '' : v).replace(/\D/g, '');
  const telPays = (code) => PAYS_TEL.find((p) => p.code === code) || null;
  const telLongueur = (p) => p.groupes.reduce((t, n) => t + n, 0);

  // « 690662400 » → « 690 66 24 00 ». On s'arrête à ce qui est tapé : un numéro
  // en cours de frappe ne doit pas se voir compléter de blancs.
  function telGrouper(code, local) {
    const p = telPays(code);
    let reste = telChiffres(local);
    if (!p) return reste;
    const morceaux = [];
    for (const n of p.groupes) {
      if (!reste) break;
      morceaux.push(reste.slice(0, n));
      reste = reste.slice(n);
    }
    if (reste) morceaux.push(reste);
    return morceaux.join(' ');
  }

  // Ce qui part en base. Le « + » compte : `whatsappNumber()` (public/whatsapp.js)
  // comme les deux écrans y lisent « c'est déjà international, ne devine rien ».
  //
  // MAIS UN NUMÉRO AU PLAN FRANÇAIS S'ÉCRIT COMME AVANT — « 06 90 66 24 00 »,
  // pas « +590 690 66 24 00 ». Les fiches déjà en base sont toutes à ce format,
  // et c'est sur les CHIFFRES du numéro que les deux écrans reconnaissent un
  // client qu'on connaît déjà : passer tout le monde à l'international faisait
  // échouer ce rapprochement en silence, et la même personne repartait avec une
  // SECONDE fiche. (Vérifié : « 06 42 26 69 49 » en base contre « +590 642 26
  // 69 49 » saisi au comptoir — aucun doublon signalé.)
  //
  // Les deux formes désignent de toute façon le même abonné pour wa.me :
  // `whatsappNumber` déduit l'indicatif du préfixe mobile. Le « + » reste donc à
  // ce pour quoi il a été ajouté — les numéros réellement étrangers (Sint
  // Maarten, États-Unis, Anguilla, Pays-Bas), que l'ancien plan à dix chiffres
  // tronquait.
  const PAYS_PLAN_FRANCAIS = new Set(['590', '596', '594', '33']);
  function telAssembler(code, local) {
    const l = telChiffres(local);
    if (!l) return '';
    if (PAYS_PLAN_FRANCAIS.has(code) && l.length === 9) {
      return `0${l}`.replace(/(\d{2})(?=\d)/g, '$1 ');
    }
    return `+${code} ${telGrouper(code, l)}`;
  }

  // L'opération inverse, pour rouvrir une fiche déjà enregistrée. Le plus LONG
  // indicatif gagne — « 1721 » avant « 1 » — sinon un numéro de Sint Maarten
  // repartirait en américain, avec quatre chiffres de trop dans sa partie locale.
  function telDecouper(valeur) {
    const d = telChiffres(valeur);
    if (!d) return { code: PAYS_TEL_DEFAUT, local: '' };
    // Les numéros déjà en base sont au format local français (« 0690 66 24 00 ») :
    // l'indicatif s'y devine au préfixe. Les MOBILES d'abord (c'est ce que fait
    // aussi le planning, cf. whatsapp.js), mais les FIXES comptent autant au
    // comptoir : « 05 90 87 12 34 » est un fixe de Guadeloupe / Saint-Martin, et
    // il se rouvrait en « France métropole » — l'indicatif d'un pays voisin
    // affiché sur la fiche d'un client d'à côté.
    if (/^0\d{9}$/.test(d)) {
      const dom = [['0690', '590'], ['0691', '590'], ['0590', '590'],
        ['0696', '596'], ['0697', '596'], ['0596', '596'],
        ['0694', '594'], ['0594', '594']].find(([prefixe]) => d.startsWith(prefixe));
      return { code: dom ? dom[1] : '33', local: d.slice(1) };
    }
    const code = PAYS_TEL.map((p) => p.code)
      .sort((a, b) => b.length - a.length)
      .find((c) => d.startsWith(c) && d.length > c.length);
    return code ? { code, local: d.slice(code.length) } : { code: PAYS_TEL_DEFAUT, local: d };
  }

  // Complet = la partie locale a exactement la longueur du pays choisi.
  function telComplet(code, local) {
    const p = telPays(code);
    return !!p && telChiffres(local).length === telLongueur(p);
  }
  // --- fin des règles du téléphone --------------------------------------------

  const CHAMPS_TEL = ['newCompanyPhone', 'newIndividualPhone', 'newClientPhone', 'newClientPhone2'];

  const STYLE_TEL = `
.olda-tel{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap}
.olda-tel__pays{flex:1 1 150px;min-width:120px;min-height:44px}
/* Là où les menus déroulants sont habillés (demande-devis), c'est la peau
   qui occupe la place du <select> : sans ça le champ pays s'écrase. */
.olda-tel>.menu{flex:1 1 150px;min-width:120px}
.olda-tel__local{flex:1 1 160px;min-width:132px;min-height:44px}
@media(max-width:560px){.olda-tel__pays,.olda-tel__local{flex:1 1 100%}}
`;

  function poserStyleTel() {
    if (document.getElementById('olda-tel-style')) return;
    const s = document.createElement('style');
    s.id = 'olda-tel-style';
    s.textContent = STYLE_TEL;
    document.head.appendChild(s);
  }

  function grefferIndicatif(id) {
    const original = document.getElementById(id);
    if (!original || original.dataset.oldaTel === 'oui') return;
    poserStyleTel();

    // Les écrans reformatent et contrôlent le numéro à CHAQUE frappe, pour un
    // plan français à dix chiffres. Un clone n'emporte aucun de leurs écouteurs,
    // et les attributs `oninput` / `onblur` partent avec l'original.
    const cache = original.cloneNode(false);
    cache.removeAttribute('oninput');
    cache.removeAttribute('onblur');
    cache.removeAttribute('maxlength');
    cache.removeAttribute('placeholder');
    cache.type = 'hidden';
    cache.dataset.oldaTel = 'oui';

    const boite = document.createElement('div');
    boite.className = 'olda-tel';

    const select = document.createElement('select');
    select.className = 'olda-tel__pays';
    select.setAttribute('aria-label', 'Indicatif du pays');
    // Un indicatif est un CODE : « 590 » ou rien. Une valeur libre y ferait un
    // numéro injoignable, et le doublon client ne se verrait plus.
    select.setAttribute('data-menu-manuel-non', '');
    for (const p of PAYS_TEL) {
      const o = document.createElement('option');
      o.value = p.code;
      o.textContent = `+${p.code} · ${p.nom}`;
      select.append(o);
    }

    const local = document.createElement('input');
    local.className = 'olda-tel__local';
    local.type = 'tel';
    local.inputMode = 'tel';
    local.setAttribute('aria-label', 'Numéro sans l’indicatif');

    original.replaceWith(boite);
    boite.append(select, local, cache);

    // Les deux écrans posent déjà une ligne d'aide sous le champ : on écrit
    // dedans plutôt que d'en empiler une seconde.
    let aide = boite.nextElementSibling;
    if (!aide || !aide.classList || !aide.classList.contains('help')) {
      aide = document.createElement('div');
      aide.className = 'help';
      boite.insertAdjacentElement('afterend', aide);
    }

    function peindre() {
      const p = telPays(select.value);
      const attendu = p ? telLongueur(p) : 0;
      local.placeholder = p ? telGrouper(p.code, '0'.repeat(attendu)).replace(/0/g, '_') : '';
      local.value = telGrouper(select.value, local.value);
      const n = telChiffres(local.value).length;
      cache.value = telAssembler(select.value, local.value);
      cache.dataset.oldaVu = cache.value;
      if (!n) {
        local.style.borderColor = '';
        aide.textContent = '';
        return;
      }
      if (telComplet(select.value, local.value)) {
        local.style.borderColor = '#1c7c4a';
        aide.style.color = '#1c7c4a';
        aide.textContent = `✓ ${cache.value}`;
      } else {
        local.style.borderColor = '#c62828';
        aide.style.color = '#c62828';
        const manque = attendu - n;
        aide.textContent = manque > 0
          ? `⚠ Il manque ${manque} chiffre${manque > 1 ? 's' : ''} pour ce pays.`
          : `⚠ ${-manque} chiffre${-manque > 1 ? 's' : ''} de trop pour ce pays.`;
      }
    }

    // La fiche rouverte pour correction, ou vidée après création : l'écran écrit
    // dans le champ caché sans prévenir. On le relit et on se remet d'accord.
    function relire() {
      if (cache.value === cache.dataset.oldaVu) return;
      const { code, local: l } = telDecouper(cache.value);
      select.value = telPays(code) ? code : PAYS_TEL_DEFAUT;
      local.value = telGrouper(select.value, l);
      peindre();
    }

    select.addEventListener('change', peindre);
    local.addEventListener('input', peindre);
    local.addEventListener('blur', peindre);
    boite.__oldaRelire = relire;
    relire();
    peindre();
  }

  // TOUT L'ÉCRAN DES DEVIS PASSE PAR `phoneDigits`, QUI TRONQUE À DIX CHIFFRES.
  // C'est l'hypothèse française, enfouie : au-delà de dix, les chiffres en trop
  // sont jetés en silence. Trois fonctions en héritent, et chacune casse
  // autrement sur un numéro international :
  //
  //   · `isValidLocalPhone` refuse le numéro (onze chiffres pour Sint Maarten) ;
  //   · `formatFrenchPhone` l'ÉCRIT TRONQUÉ en base — « +1721 520 1234 »
  //     devenait « 17 21 52 01 23 », un numéro qui n'existe pas ;
  //   · `normalizePhone` bâtit l'adresse wa.me avec ces dix chiffres — la
  //     conversation s'ouvrait sur un inconnu.
  //
  // On les relaie : un numéro DÉJÀ international (il commence par « + ») passe
  // tel quel, le reste continue de suivre la règle locale — les fiches d'avant
  // sont toutes au format français, elles ne doivent rien changer.
  const estInternational = (v) => String(v == null ? '' : v).trim().startsWith('+');

  function relayer(nom, quand) {
    const base = window[nom];
    if (typeof base !== 'function' || base.__oldaTel) return;
    const relais = function oldaRelaisTel(valeur, ...reste) {
      if (estInternational(valeur)) return quand(valeur);
      return base.call(this, valeur, ...reste);
    };
    relais.__oldaTel = true;
    window[nom] = relais;
  }

  // Le même relais, mais SANS condition : pour ce que les écrans se trompent à
  // faire depuis toujours, pas seulement sur un numéro international.
  function relayerToujours(nom, faire) {
    const base = window[nom];
    if (typeof base !== 'function' || base.__oldaTel) return;
    const relais = function oldaRelaisTelToujours(valeur, ...reste) {
      const r = faire(valeur);
      return r == null ? base.call(this, valeur, ...reste) : r;
    };
    relais.__oldaTel = true;
    window[nom] = relais;
  }

  // LE NUMÉRO PRÊT POUR wa.me : indicatif du pays suivi de la partie locale.
  // C'est `telDecouper` qui tranche — le même découpage que le sélecteur, donc
  // la même vérité pour un numéro saisi et pour une fiche rouverte.
  // Les deux écrans, eux, préfixent « 590 » à TOUT numéro français à dix
  // chiffres (`waHref` côté vente, `normalizePhone` côté devis) : un portable
  // de métropole (« 06 42 26 69 49 ») ouvrait donc une conversation avec
  // « 590 642 26 69 49 » — un abonné guadeloupéen qui n'a rien demandé.
  // `null` = on ne sait pas lire ce numéro, l'écran garde la main.
  function telInternational(v) {
    const { code, local } = telDecouper(v);
    if (!telPays(code) || !telComplet(code, local)) return null;
    return `${code}${local}`;
  }

  function relayerValidation() {
    // LA LONGUEUR ATTENDUE EST CELLE DU PAYS, pas un plancher. « huit chiffres
    // au minimum » laissait passer un numéro de Sint Maarten amputé de la fin
    // (« +1721 520 12 » en fait déjà neuf) : l'écran validait, la fiche partait
    // en base avec un numéro qui n'appelle personne, et l'erreur ne se voyait
    // qu'au moment de joindre le client. On relit l'indicatif et on exige le
    // compte exact — le plancher ne sert plus que pour un pays hors de la
    // liste, où l'on ne sait rien du découpage.
    relayer('isValidLocalPhone', (v) => {
      const { code, local } = telDecouper(v);
      return telPays(code) ? telComplet(code, local) : telChiffres(v).length >= 8;
    });
    // Ce qui s'écrit en base : on ne retouche rien.
    relayer('formatFrenchPhone', (v) => String(v).trim());
    // Ce qui part vers wa.me, en revanche, se corrige POUR TOUS LES NUMÉROS :
    // « 590 » collé devant n'importe quel numéro français est faux dès qu'il
    // s'agit d'un portable de métropole, et ces fiches-là sont en base depuis
    // l'import. Les deux écrans ont chacun leur fonction — même erreur, deux
    // noms.
    relayerToujours('normalizePhone', telInternational);
    relayerToujours('waHref', (v) => {
      const num = telInternational(v);
      return num ? `https://wa.me/${num}` : null;
    });
  }

  function grefferLesIndicatifs() {
    CHAMPS_TEL.forEach(grefferIndicatif);
    relayerValidation();
    for (const boite of document.querySelectorAll('.olda-tel')) {
      if (boite.__oldaRelire) boite.__oldaRelire();
    }
  }

  // --- 5. QUI SIGNE LE DOSSIER ------------------------------------------------
  // Le nom de la personne au poste est choisi UNE fois dans le CRM (« Qui est
  // au poste ? », voir ../poste.js) et vit dans `localStorage`. Le cadre du
  // parcours est sur la même origine : il lit donc le même stockage, sans
  // message ni API.
  //
  // ⚠ La clé est `olda.qui`, PAS `olda.poste` — cette dernière est
  // l'identifiant à trois caractères de la MACHINE, plus haut dans ce fichier.
  // Les confondre ferait échouer le `/^[A-Z0-9]{3}$/` du poste, qui tirerait un
  // nouvel identifiant à chaque chargement en effaçant le prénom au passage :
  // deux tablettes hors réseau se disputeraient à nouveau une référence.
  // La clé est réécrite en toutes lettres parce que ce fichier est un script
  // classique servi tel quel aux écrans du patron : il ne peut pas importer un
  // module.
  const QUI_KEY = 'olda.qui';

  function reporterQuiEstAuPoste() {
    // L'autre parcours (vente directe) n'a pas ce champ : la greffe s'abstient.
    const champ = document.getElementById('salesperson');
    if (!champ) return;
    let nom = '';
    try { nom = localStorage.getItem(QUI_KEY) || ''; } catch (_) { /* stockage refusé */ }
    if (!nom || champ.value === nom) return;
    champ.value = nom;
    // Le panneau latéral et le contrôle en direct LISENT ce champ. Sans ce
    // rappel, le dossier serait bien signé mais afficherait « personne au
    // poste » jusqu'à la prochaine frappe — de quoi croire que ça n'a pas pris.
    try { window.updateSidebar?.(); } catch (_) { /* le parcours reste utilisable */ }
  }

  reporterQuiEstAuPoste();
  // La relève de la journée : le CRM prévient le cadre directement (`storage`
  // ne se déclenche jamais dans le document qui a écrit), et `storage` couvre
  // les autres onglets ouverts sur le même poste.
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    if (e.data && e.data.type === 'OLDA_POSTE') reporterQuiEstAuPoste();
  });
  window.addEventListener('storage', (e) => { if (e.key === QUI_KEY) reporterQuiEstAuPoste(); });

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

  // LE NUMÉRO NE S'IMPRIME PLUS. Ce papier va à l'établi : celui qui produit y
  // cherche quoi faire, pour qui et pour quand, pas un identifiant de dossier.
  // La référence reste ÉCRITE par l'écran (`#ticketOrder` garde son texte, et
  // c'est elle qui part au planning) — elle quitte l'affichage, pas la source.
  //
  // MASQUÉ, PAS RETIRÉ. Les deux écrans réécrivent `#ticketOrder` à CHAQUE
  // remplissage, sans garde : `printTicket()` rappelle `fillTicket()`, qui
  // mourait sur le nœud disparu AVANT d'atteindre `window.print()`. Le bouton
  // « Imprimer » ne faisait alors plus rien du tout, sans un mot à l'écran.
  // On coupe dans l'AFFICHAGE, jamais dans le DOM que l'écran tient à jour.
  function allegerTicket() {
    const num = document.getElementById('ticketOrder');
    // `display` et non l'attribut `hidden` : il est inconditionnel, et il tient
    // aussi face au `visibility: visible !important` de la feuille d'impression.
    if (num) num.style.display = 'none';
    elaguer('ticketClientDetails');
    elaguer('ticketExtraDetails');
    retirerPied();
  }

  // On se greffe SUR le remplissage de l'écran, sans le refaire : il garde la
  // main sur ce qu'il imprime, on ne fait qu'en retirer des lignes. Un écran qui
  // n'existe pas sur cette page (l'autre parcours) ne se greffe pas.
  function grefferSurLeTicket(nom) {
    const original = window[nom];
    if (typeof original !== 'function' || original.__oldaPapier) return;
    const greffe = function greffePapier(...args) {
      const rendu = original.apply(this, args);
      // Un ticket qui s'imprime avec une ligne de trop vaut mieux qu'un ticket
      // qui ne s'imprime pas : l'élagage ne prend jamais le parcours avec lui.
      try { allegerTicket(); } catch (_) { /* le papier reste imprimable tel quel */ }
      return rendu;
    };
    greffe.__oldaPapier = true;
    window[nom] = greffe;
  }

  grefferSurLeTicket('fillTicket');
  grefferSurLeTicket('fillFinal');
  retirerPied();

  // On guette le CHANGEMENT, pas l'horloge : les deux écrans démasquent leur
  // carte de fin en retirant une classe, un observateur le voit à l'instant
  // même. Un `setInterval` suffirait presque — mais un navigateur bride ses
  // minuteurs à ~1 s dès que l'onglet passe au second plan, et l'envoi du
  // dossier ne doit pas dépendre de ça. La scrutation reste en second rideau,
  // pour ce qui ne passe pas par une mutation (et parce que les écrans

  // ---- LES MENUS DÉROULANTS DES DEUX ÉCRANS ------------------------------
  // Greffé ici et pas dans une page : les deux écrans du comptoir doivent
  // avoir les mêmes menus, et un écran remplacé par le patron ne doit pas
  // emporter le composant avec lui.
  const STYLE_MENU = `
/* ---- UN SEUL MODÈLE DE MENU DÉROULANT POUR TOUTE LA PAGE ------------------
   Le <select> natif ne sait afficher ni deux colonnes, ni deux graisses, ni
   une pastille de couleur dans une option — et il tronque. Il reste pourtant
   en place, caché : c'est lui qui porte la valeur, le \`onchange\` et les options
   que le formulaire écrit à la volée. Ce qui suit n'est qu'une PEAU.
   Deux variantes, même panneau : le menu fermé (on choisit dans la liste) et
   le menu libre (le champ reste saisissable — la vendeuse peut écrire une
   couleur qui n'est pas au catalogue). Poste PC : survol, focus, clavier. */
.menu{position:relative}
.menu>select,.menu>datalist{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden}
.menu-declencheur{display:flex;align-items:center;gap:11px;width:100%;min-height:46px;padding:8px 12px;
  border:1px solid #bcc2c8;border-radius:9px;background:#fff;cursor:pointer;text-align:left;
  font:inherit;font-size:16px;color:var(--text);transition:border-color .12s ease,box-shadow .12s ease}
.menu-declencheur:hover{border-color:#8d959d}
.menu-declencheur:focus-visible{outline:3px solid rgba(20,46,84,.13);border-color:var(--green)}
.menu.est-ouvert .menu-declencheur,.menu.est-ouvert>input{border-color:var(--green);box-shadow:0 0 0 3px rgba(20,46,84,.10)}
/* Menu libre : le champ de saisie EST le déclencheur. Le chevron se pose
   par-dessus, la pastille de teinte à gauche — ni l'un ni l'autre ne prend le
   clic, il revient au champ, qui ouvre le menu.
   « !important » à contrecœur : les deux écrans imposent déjà
   « input,select,textarea{padding:13px 14px!important} », et sans ça le texte
   saisi passe SOUS le chevron et sous la pastille. */
.menu>input{padding-right:40px!important}
.menu>.menu-pastille{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:20px;height:20px;pointer-events:none}
.menu.a-pastille>input{padding-left:42px!important}
/* Un doigt ne se retourne pas quand la liste s'ouvre — à l'envers il ne veut
   plus rien dire. C'est sa COULEUR qui répond : gris au repos, encre dès que
   le champ est survolé ou ouvert. */
.menu-doigt{position:absolute;right:11px;top:50%;transform:translateY(-50%);width:17px;height:17px;
  color:#8b9199;pointer-events:none;transition:color .14s ease}
.menu-declencheur .menu-doigt{position:static;transform:none;flex:none}
.menu:hover .menu-doigt,.menu.est-ouvert .menu-doigt{color:#111827}
/* La référence en chiffres alignés : c'est elle qui ouvre la ligne. */
.menu-jeton{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;
  font-weight:700;letter-spacing:.02em;font-variant-numeric:tabular-nums;color:#111827;
  background:#eef0f3;border-radius:6px;padding:4px 7px;white-space:nowrap}
.menu-texte{flex:1 1 auto;min-width:0;font-size:15px;color:#3b424a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.menu-texte.est-vide{color:#767d85}
/* Une pastille de couleur EST une information : elle dit la teinte que la
   vendeuse ne devinerait pas d'après « Wet Sand ». */
.menu-pastille{flex:none;width:18px;height:18px;border-radius:50%;border:1px solid #9aa2aa;box-shadow:inset 0 0 0 1px #fff}

.menu-panneau{position:absolute;z-index:40;top:calc(100% + 6px);left:0;width:max(100%,min(560px,80vw));
  background:#fff;border:1px solid #d5d9de;border-radius:12px;overflow:hidden;display:none;
  box-shadow:0 14px 34px rgba(17,24,39,.15),0 2px 6px rgba(17,24,39,.06)}
.menu.est-ouvert .menu-panneau{display:block;animation:menuEntre .13s ease-out}
@keyframes menuEntre{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
.menu-tete{display:flex;align-items:center;gap:10px;padding:10px;background:#fafbfc;border-bottom:1px solid #eceff2}
.menu-tete input{font-size:15px;padding:9px 11px}
.menu-compte{flex:none;font-size:12px;font-weight:700;color:#767d85;font-variant-numeric:tabular-nums;white-space:nowrap}
.menu-liste{max-height:326px;overflow-y:auto;margin:0;padding:6px;list-style:none}
/* Le titre de famille reste collé en haut pendant le défilement : 48
   références sur 13 familles, sans ça on ne sait plus dans quoi on est. */
.menu-groupe{position:sticky;top:0;z-index:1;background:#fff;padding:13px 10px 5px;
  font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#8b9199}
.menu-groupe:first-child{padding-top:5px}
.menu-option{display:flex;align-items:baseline;gap:12px;padding:9px 10px 9px 8px;
  border-left:3px solid transparent;border-radius:8px;cursor:pointer}
.menu-option .menu-jeton{background:transparent;padding:0;width:76px;flex:none}
.menu-option .menu-pastille{align-self:center}
.menu-option-texte{flex:1 1 auto;min-width:0;font-size:15px;color:#2b3138;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Deux états distincts : le curseur du clavier (gris plein) et le choix en
   cours (barre d'encre + texte en gras). Aucune couleur ici n'est décorative. */
.menu-option.est-vise{background:#eaeef3}
.menu-option[aria-selected="true"]{border-left-color:#111827;background:#f5f6f8}
.menu-option[aria-selected="true"] .menu-option-texte{color:#111827;font-weight:700}
.menu-rien{padding:22px 14px;text-align:center;color:#767d85;font-size:14px}
/* L'AJOUT MANUEL — la même ligne, au même endroit, dans TOUS les menus.
   Avant, trois listes portaient leur propre « produit libre » noyé au milieu
   du catalogue, les autres n'en avaient aucun : on ne savait jamais où
   chercher. Elle est épinglée AU-DESSUS du filtre, hors de la liste, donc ni
   emportée par une recherche ni repoussée par le défilement. */
.menu-manuel{display:flex;align-items:center;gap:10px;width:100%;padding:12px;border:0;
  border-bottom:1px solid #eceff2;background:#fff;font:inherit;font-size:14px;font-weight:800;
  color:#111827;text-align:left;cursor:pointer}
.menu-manuel:hover,.menu-manuel:focus-visible{background:#f5f6f8;outline:none}
.menu-mention{margin:0;padding:9px 12px;border-bottom:1px solid #eceff2;background:#fafbfc;
  font-size:12px;color:#767d85}
.menu-plus{flex:none;width:22px;height:22px;display:grid;place-items:center;border-radius:50%;
  background:#111827;color:#fff;font-size:15px;font-weight:800;line-height:1}
.menu-saisie{display:none;gap:8px;padding:10px;border-bottom:1px solid #eceff2;background:#fafbfc}
.menu-saisie input{flex:1 1 auto;min-width:0;font-size:15px;padding:9px 11px}
.menu-saisie button{flex:none;border:0;border-radius:9px;padding:9px 14px;background:#111827;
  color:#fff;font:inherit;font-weight:800;cursor:pointer}
/* Pendant la saisie libre, la liste s'efface : deux façons de répondre à la
   même question en même temps, c'est une hésitation de plus au comptoir. */
.menu.est-saisie .menu-saisie{display:flex}
.menu.est-saisie .menu-manuel,.menu.est-saisie .menu-tete,.menu.est-saisie .menu-liste{display:none}
/* Un menu fermé n'a pas de champ à rougir : c'est sa peau qui porte l'erreur. */
.menu.invalid .menu-declencheur{border:2px solid var(--red);background:var(--red-soft)}
@media(prefers-reduced-motion:reduce){.menu.est-ouvert .menu-panneau{animation:none}.menu-doigt,.menu-declencheur{transition:none}}
`;

  function poserStyleMenu() {
    if (document.getElementById('olda-menu-style')) return;
    const s = document.createElement('style');
    s.id = 'olda-menu-style';
    s.textContent = STYLE_MENU;
    document.head.appendChild(s);
  }

/* ---- UN SEUL MODÈLE DE MENU DÉROULANT -------------------------------------
   Le <select> natif ne sait afficher ni deux colonnes, ni deux graisses, ni une
   pastille de couleur — et il tronque. On l'HABILLE au lieu de le remplacer :
   il reste dans la page, caché, et garde sa valeur, son `onchange` et les
   options que le formulaire écrit à la volée. Résultat : rien de ce qui lisait
   `$('x').value` ne change, et les vingt menus de la page se ressemblent.

   Deux variantes, un seul panneau :
   - menu FERMÉ  — habille un <select>. La valeur vient de la liste.
   - menu LIBRE  — habille un <input list="…">. Le champ reste saisissable : la
     vendeuse peut écrire une couleur qui n'est pas au catalogue.

   Une option porte, au choix : `data-ref` (jeton de référence, en tête de
   ligne) et `data-hex` (pastille de teinte). Les <optgroup> deviennent les
   titres de famille. */

  const MENU_SEUIL_FILTRE = 8;   /* en dessous, un champ de filtre est du bruit */
  const menus = new Map();       /* hôte → état, pour retrouver un menu déjà posé */
  let menuRang = 0;              /* de quoi nommer la liste d'un hôte sans id */

/* Cinq listes portaient DÉJÀ leur propre entrée libre, sous trois valeurs
   conventionnelles différentes. On les reconnaît au lieu de les étiqueter une
   à une : une liste qui en gagne une demain est prise en charge sans rien
   changer ici. `data-menu-manuel` reste le moyen de le dire à la main. */
const MENU_VALEURS_LIBRES=['__new__','__manuel','__CUSTOM__'];
function menuRenvoiManuel(hote){
  if(hote.dataset.menuManuel!==undefined)return hote.dataset.menuManuel;
  if(hote.tagName!=='SELECT')return undefined;
  const o=[...hote.options].find(o=>MENU_VALEURS_LIBRES.includes(o.value));
  return o?o.value:undefined;
}

function menuNorm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')}

/* UN DOIGT, PAS UN CHEVRON. Le chevron dit « il y a autre chose en dessous » ;
   au comptoir la question n'est pas là, c'est « est-ce que ça se clique ? ».
   Le doigt le dit sans un mot, et le dit pareil sur les vingt-cinq champs. */
function menuDoigt(){
  const NS='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(NS,'svg');
  svg.setAttribute('class','menu-doigt');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
  svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');
  svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  for(const d of [
    'M9.2 11.4V5.4a1.7 1.7 0 0 1 3.4 0v5.3',
    'M12.6 10.7V9.3a1.6 1.6 0 0 1 3.2 0v1.4',
    'M15.8 10.9v-.8a1.6 1.6 0 0 1 3.2 0v4.6a5.6 5.6 0 0 1-5.6 5.6h-1.5a5.5 5.5 0 0 1-4.2-1.9l-2.9-3.4a1.7 1.7 0 0 1 2.5-2.3l1.9 1.9',
  ]){
    const p=document.createElementNS(NS,'path');
    p.setAttribute('d',d);
    svg.append(p);
  }
  return svg;
}

/* Les options telles qu'elles existent à l'instant T. On les relit à CHAQUE
   ouverture : `txPopulateSelects` et `onTextileRefChange` réécrivent le contenu
   des <select> et des <datalist> en cours de route. */
function menuOptions(hote){
  if(hote.tagName==='SELECT'){
    const sorties=[];
    [...hote.children].forEach(n=>{
      if(n.tagName==='OPTGROUP'){
        [...n.children].forEach(o=>sorties.push(menuOption(o,n.label)));
      }else if(n.tagName==='OPTION'){
        sorties.push(menuOption(n,''));
      }
    });
    return sorties;
  }
  const source=document.getElementById(hote.dataset.menuListe||hote.getAttribute('list'));
  return source?[...source.options].map(o=>menuOption(o,'')):[];
}
function menuOption(o,groupe){
  return {
    valeur:o.value,
    /* Une option de <datalist> n'a pas de texte : c'est sa valeur qu'on lit. */
    texte:(o.textContent||'').trim()||o.value,
    jeton:o.dataset.ref||'',
    hex:o.dataset.hex||'',
    groupe,
  };
}

function menuPoser(hote){
  if(menus.has(hote))return menus.get(hote);
  const libre=hote.tagName!=='SELECT';
  const peau=document.createElement('div');
  peau.className='menu';
  hote.replaceWith(peau);
  peau.append(hote);

  let declencheur;
  if(libre){
    /* Le champ de saisie EST le déclencheur : cliquer ouvre, taper filtre.
       On DÉBRANCHE la liste native : tant que `list` reste posé, Chrome ouvre
       la sienne — fond sombre, deuxième chevron — par-dessus la nôtre. Le
       <datalist> reste dans la page (le formulaire le remplit par son id), on
       ne fait que retenir son nom ici. `autocomplete=off` coupe en plus la
       liste de saisies mémorisées par le navigateur, qui se superposerait
       pareil. */
    if(hote.getAttribute('list')){
      hote.dataset.menuListe=hote.getAttribute('list');
      hote.removeAttribute('list');
    }
    hote.setAttribute('autocomplete','off');
    declencheur=hote;
    peau.append(menuDoigt());
  }else{
    declencheur=document.createElement('div');
    declencheur.className='menu-declencheur';
    declencheur.setAttribute('role','combobox');
    declencheur.setAttribute('tabindex','0');
    declencheur.setAttribute('aria-haspopup','listbox');
    declencheur.setAttribute('aria-expanded','false');
    /* Le <label for="…"> du formulaire vise le <select> caché : on renvoie le
       nom accessible sur lui pour que le déclencheur s'annonce quand même. */
    const etiquette=document.querySelector(`label[for="${hote.id}"]`);
    if(etiquette)declencheur.setAttribute('aria-label',etiquette.textContent.trim());
    peau.append(declencheur);
    hote.setAttribute('tabindex','-1');
    hote.setAttribute('aria-hidden','true');
  }

  const panneau=document.createElement('div');
  panneau.className='menu-panneau';
  const tete=document.createElement('div');
  tete.className='menu-tete';
  const filtre=document.createElement('input');
  filtre.type='text';filtre.autocomplete='off';filtre.spellcheck=false;
  filtre.className='menu-filtre';
  filtre.placeholder=hote.dataset.menuFiltre||'Filtrer…';
  filtre.setAttribute('aria-label','Filtrer la liste');
  const compte=document.createElement('span');
  compte.className='menu-compte';
  tete.append(filtre,compte);
  const liste=document.createElement('ul');
  liste.className='menu-liste';
  liste.setAttribute('role','listbox');
  liste.id=`${hote.id||'menu'+(++menuRang)}__liste`;
  declencheur.setAttribute('aria-controls',liste.id);
  /* Une liste dont la valeur est un CODE — un coefficient, un délai en jours,
     une heure, une clé de barème — porte `data-menu-manuel-non` : `DB.times[x]`
     rend `{}` pour une valeur inconnue, le prix tomberait à zéro SANS erreur.
     Une liste qui a déjà son entrée libre gérée par le formulaire porte
     `data-menu-manuel="<valeur de cette option>"` : la ligne l'y renvoie au
     lieu d'en inventer une deuxième. */
  const avecManuel=!hote.hasAttribute('data-menu-manuel-non');
  const manuel=document.createElement('button');
  manuel.type='button';
  manuel.className='menu-manuel';
  const plus=document.createElement('span');
  plus.className='menu-plus';plus.setAttribute('aria-hidden','true');plus.textContent='+';
  const motManuel=hote.dataset.menuManuelTexte||'Saisir autre chose…';
  const mot=document.createElement('span');
  mot.textContent=motManuel;
  manuel.append(plus,mot);

  const saisie=document.createElement('div');
  saisie.className='menu-saisie';
  const champLibre=document.createElement('input');
  champLibre.type='text';champLibre.autocomplete='off';
  champLibre.placeholder='Ce qui n’est pas dans la liste…';
  champLibre.setAttribute('aria-label',motManuel);
  const valider=document.createElement('button');
  valider.type='button';valider.textContent='Valider';
  saisie.append(champLibre,valider);

  /* Dans un champ LIBRE, la grosse ligne d'ajout est du bruit : on peut déjà
     écrire dans le champ. Il ne manque que de le dire — une mention discrète,
     en tête du panneau, qui ne se clique pas et ne prend pas la place d'un
     choix. */
  const mention=document.createElement('p');
  mention.className='menu-mention';
  mention.textContent='Écris directement dans le champ pour autre chose.';
  if(avecManuel)panneau.append(...(libre?[mention]:[manuel,saisie]));
  panneau.append(tete,liste);
  peau.append(panneau);

  const etat={hote,libre,peau,declencheur,panneau,tete,filtre,compte,liste,
    avecManuel,manuel,saisie,champLibre,vus:[],vise:-1,ouvert:false,filtrer:false};
  menus.set(hote,etat);

  declencheur.addEventListener('click',()=>etat.ouvert?menuFermer(etat,false):menuOuvrir(etat));
  declencheur.addEventListener('keydown',ev=>menuTouche(etat,ev));
  if(libre){
    hote.addEventListener('input',()=>{etat.filtrer=true;etat.vise=0;if(etat.ouvert)menuPeindre(etat);menuPeindreChamp(etat)});
  }else{
    filtre.addEventListener('input',()=>{etat.vise=0;menuPeindre(etat)});
    filtre.addEventListener('keydown',ev=>menuTouche(etat,ev));
  }
  liste.addEventListener('click',ev=>{
    const li=ev.target.closest('[data-valeur]');
    if(li)menuChoisir(etat,li.dataset.valeur);
  });
  manuel.addEventListener('click',()=>menuManuelOuvrir(etat));
  valider.addEventListener('click',()=>menuManuelValider(etat));
  champLibre.addEventListener('keydown',ev=>{
    if(ev.key==='Enter'){ev.preventDefault();menuManuelValider(etat)}
    else if(ev.key==='Escape'){ev.preventDefault();menuManuelFermer(etat)}
  });
  /* Le survol déplace le curseur du clavier : sinon la souris éclaire une ligne
     et Entrée en valide une autre. */
  liste.addEventListener('mousemove',ev=>{
    const li=ev.target.closest('.menu-option');
    if(!li)return;
    const i=Number(li.dataset.rang);
    if(i!==etat.vise){etat.vise=i;menuPeindreVise(etat,false)}
  });
  menuPeindreChamp(etat);
  return etat;
}

/* Ce que le champ montre quand le menu est fermé. */
function menuPeindreChamp(etat){
  const {hote,libre,declencheur,peau}=etat;
  if(libre){
    /* Une pastille à gauche du champ : « Wet Sand » ne dit rien sans la teinte.
       Elle ne s'allume que sur une correspondance exacte — pas de pastille =
       coloris hors catalogue, ce qui est une information. */
    const cle=menuNorm(hote.value).trim();
    const trouve=cle?menuOptions(hote).find(o=>menuNorm(o.texte).trim()===cle):null;
    let pastille=peau.querySelector(':scope > .menu-pastille');
    if(trouve&&trouve.hex){
      if(!pastille){pastille=document.createElement('span');pastille.className='menu-pastille';
        pastille.setAttribute('aria-hidden','true');peau.append(pastille)}
      pastille.style.background=trouve.hex;
      peau.classList.add('a-pastille');
    }else{
      if(pastille)pastille.remove();
      peau.classList.remove('a-pastille');
    }
    return;
  }
  const choisie=menuOptions(hote).find(o=>o.valeur===hote.value);
  declencheur.replaceChildren();
  if(choisie&&choisie.jeton){
    const j=document.createElement('span');j.className='menu-jeton';j.textContent=choisie.jeton;
    declencheur.append(j);
  }
  if(choisie&&choisie.hex){
    const p=document.createElement('span');p.className='menu-pastille';p.style.background=choisie.hex;
    declencheur.append(p);
  }
  const t=document.createElement('span');
  t.className='menu-texte'+(choisie&&choisie.valeur?'':' est-vide');
  t.textContent=choisie?choisie.texte:'Choisir…';
  declencheur.append(t,menuDoigt());
  /* Le texte est coupé à l'ellipse dans un champ étroit : l'infobulle rend la
     ligne entière sans avoir à rouvrir la liste. */
  declencheur.title=choisie&&choisie.valeur?[choisie.jeton,choisie.texte].filter(Boolean).join(' — '):'';
}

function menuFiltrees(etat){
  /* L'option vers laquelle la ligne du haut renvoie ne se montre pas DEUX
     fois : elle est déjà là, épinglée, en tête du panneau. */
  const renvoi=menuRenvoiManuel(etat.hote);
  const toutes=menuOptions(etat.hote).filter(o=>renvoi===undefined||o.valeur!==renvoi);
  /* Un champ libre ne filtre QU'À PARTIR de la première frappe : à l'ouverture
     il contient déjà une valeur, et filtrer dessus ne laisserait voir que cette
     valeur-là — cliquer doit montrer toute la liste. */
  const brut=etat.libre?(etat.filtrer?etat.hote.value:''):etat.filtre.value;
  const q=menuNorm(brut).trim();
  if(!q)return toutes;
  const mots=q.split(/\s+/);
  return toutes.filter(o=>{
    const foin=menuNorm(`${o.jeton} ${o.texte} ${o.groupe}`);
    return mots.every(m=>foin.includes(m));
  });
}

function menuPeindre(etat){
  const vus=menuFiltrees(etat);
  etat.vus=vus;
  etat.vise=Math.min(Math.max(etat.vise,0),vus.length-1);

  const toutes=menuOptions(etat.hote).length;
  /* Sous le seuil, un champ de filtre et un compteur sont du bruit : deux
     valeurs se lisent d'un coup d'œil. Un menu libre se filtre en tapant. */
  const filtrable=!etat.libre&&toutes>MENU_SEUIL_FILTRE;
  etat.tete.style.display=filtrable?'':'none';
  if(filtrable)etat.compte.textContent=vus.length===toutes?`${toutes} choix`:`${vus.length} / ${toutes}`;

  const noeuds=[];
  if(!vus.length){
    const rien=document.createElement('li');
    rien.className='menu-rien';rien.setAttribute('role','presentation');
    rien.textContent=etat.libre?'Aucun choix ne correspond — la saisie reste libre.':'Aucun choix ne correspond.';
    noeuds.push(rien);
  }
  let groupe=null;
  vus.forEach((o,i)=>{
    if(o.groupe&&o.groupe!==groupe){
      groupe=o.groupe;
      const tete=document.createElement('li');
      tete.className='menu-groupe';tete.setAttribute('role','presentation');tete.textContent=o.groupe;
      noeuds.push(tete);
    }
    const li=document.createElement('li');
    li.className='menu-option'+(i===etat.vise?' est-vise':'');
    li.id=`${etat.liste.id}-opt-${i}`;
    li.dataset.rang=i;
    li.dataset.valeur=o.valeur;
    li.setAttribute('role','option');
    li.setAttribute('aria-selected',String(o.valeur===etat.hote.value));
    if(o.jeton){const j=document.createElement('span');j.className='menu-jeton';j.textContent=o.jeton;li.append(j)}
    if(o.hex){const p=document.createElement('span');p.className='menu-pastille';p.style.background=o.hex;li.append(p)}
    const t=document.createElement('span');t.className='menu-option-texte';t.textContent=o.texte;li.append(t);
    noeuds.push(li);
  });
  etat.liste.replaceChildren(...noeuds);
  menuPeindreVise(etat,true);
}

function menuPeindreVise(etat,deroule){
  etat.liste.querySelectorAll('.est-vise').forEach(li=>li.classList.remove('est-vise'));
  const actif=etat.liste.querySelector(`[data-rang="${etat.vise}"]`);
  const champ=etat.libre?etat.hote:etat.filtre;
  if(!actif){champ.removeAttribute('aria-activedescendant');return}
  actif.classList.add('est-vise');
  champ.setAttribute('aria-activedescendant',actif.id);
  if(deroule!==false)actif.scrollIntoView({block:'nearest'});
}

function menuViser(etat,pas){
  const n=etat.vus.length;
  if(!n)return;
  etat.vise=(etat.vise+pas+n)%n;
  menuPeindreVise(etat,true);
}

function menuTouche(etat,ev){
  if(!etat.ouvert&&(ev.key==='ArrowDown'||ev.key==='Enter'||ev.key===' ')){
    ev.preventDefault();menuOuvrir(etat);return;
  }
  if(ev.key==='ArrowDown'){ev.preventDefault();menuViser(etat,1)}
  else if(ev.key==='ArrowUp'){ev.preventDefault();menuViser(etat,-1)}
  else if(ev.key==='Home'){ev.preventDefault();etat.vise=0;menuPeindreVise(etat,true)}
  else if(ev.key==='End'){ev.preventDefault();etat.vise=etat.vus.length-1;menuPeindreVise(etat,true)}
  else if(ev.key==='Enter'){
    const o=etat.vus[etat.vise];
    /* Menu libre sans ligne visée : Entrée garde ce qui est tapé. */
    if(o){ev.preventDefault();menuChoisir(etat,o.valeur)}
    else if(etat.libre)menuFermer(etat,false);
  }
  else if(ev.key==='Escape'){ev.preventDefault();menuFermer(etat,true)}
  else if(ev.key==='Tab')menuFermer(etat,false);
}

/* Un seul geste pour la vendeuse, deux chemins derrière :
   - la liste a déjà son entrée libre gérée par le formulaire → on l'y renvoie ;
   - sinon ce qui est tapé devient une vraie option de la liste, et le
     formulaire n'a rien de spécial à savoir : il lit toujours `.value`.
   Un champ LIBRE, lui, n'a pas de bouton du tout : il s'écrit déjà, une
   mention discrète le dit et c'est tout. */
function menuManuelOuvrir(etat){
  const renvoi=menuRenvoiManuel(etat.hote);
  if(renvoi!==undefined){menuChoisir(etat,renvoi);return}
  etat.peau.classList.add('est-saisie');
  etat.champLibre.value='';
  etat.champLibre.focus();
  menuPlacer(etat);
}
function menuManuelFermer(etat){
  etat.peau.classList.remove('est-saisie');
}
function menuManuelValider(etat){
  const texte=etat.champLibre.value.trim();
  if(!texte){etat.champLibre.focus();return}
  const hote=etat.hote;
  /* Une deuxième saisie identique réutilise son option au lieu d'en empiler
     une : la liste se remplirait de doublons au fil de la journée. */
  if(![...hote.options].some(o=>o.value===texte)){
    const opt=new Option(texte,texte);
    opt.dataset.manuel='1';
    hote.add(opt,hote.options[0]&&!hote.options[0].value?1:0);
  }
  menuManuelFermer(etat);
  menuChoisir(etat,texte);
}

function menuOuvrir(etat){
  if(etat.ouvert)return;
  const options=menuOptions(etat.hote);
  if(!options.length)return;          /* catalogue pas encore chargé */
  menus.forEach(a=>{if(a!==etat)menuFermer(a,false)});   /* un seul à la fois */
  etat.ouvert=true;
  etat.filtrer=false;   /* on ouvre sur la liste ENTIÈRE */
  etat.peau.classList.remove('est-saisie');   /* jamais rouvert en cours de frappe */
  etat.peau.classList.add('est-ouvert');
  etat.declencheur.setAttribute('aria-expanded','true');
  if(!etat.libre)etat.filtre.value='';
  /* On ouvre sur le choix en cours, pas en tête de liste. */
  etat.vise=Math.max(0,options.findIndex(o=>o.valeur===etat.hote.value));
  menuPeindre(etat);
  menuPlacer(etat);
  if(!etat.libre&&etat.tete.style.display!=='none')etat.filtre.focus();
}

/* Le panneau est plus large que son champ : posé à gauche, celui de la
   dernière colonne débordait de la page et la faisait défiler de côté. On le
   retourne quand il ne tient pas — à droite, ou au-dessus. */
function menuPlacer(etat){
  const {panneau,peau}=etat;
  panneau.style.left='';panneau.style.right='';panneau.style.top='';panneau.style.bottom='';
  const marge=12,champ=peau.getBoundingClientRect(),boite=panneau.getBoundingClientRect();
  if(champ.left+boite.width>window.innerWidth-marge){panneau.style.left='auto';panneau.style.right='0'}
  const place=window.innerHeight-champ.bottom-marge;
  if(boite.height>place&&champ.top>place){panneau.style.top='auto';panneau.style.bottom='calc(100% + 6px)'}
}

function menuFermer(etat,rendreFocus){
  if(!etat.ouvert)return;
  etat.ouvert=false;
  etat.peau.classList.remove('est-ouvert');
  etat.peau.classList.remove('est-saisie');
  etat.declencheur.setAttribute('aria-expanded','false');
  if(rendreFocus)etat.declencheur.focus();
}

function menuChoisir(etat,valeur){
  etat.hote.value=valeur;
  menuPeindreChamp(etat);
  menuFermer(etat,true);
  /* Le rouge d'un champ manquant s'efface sur `change` — le <select> visible le
     déclenchait tout seul, ici c'est à nous de le dire. Et c'est ce même
     évènement qui porte les `onchange="…"` du formulaire. */
  menuEffacerRouge(etat);
  etat.hote.dispatchEvent(new Event('change',{bubbles:true}));
  if(etat.libre)etat.hote.dispatchEvent(new Event('input',{bubbles:true}));
}

function menuEffacerRouge(etat){
  const cible=etat.peau.classList.contains('invalid')?etat.peau:etat.hote;
  cible.classList.remove('invalid');
  const suivant=etat.peau.nextElementSibling;
  if(suivant&&suivant.classList.contains('error'))suivant.remove();
}

/* Un clic hors du panneau referme. `pointerdown` et non `click` : le panneau
   doit partir AVANT que le clic n'atteigne ce qu'il visait derrière. */
document.addEventListener('pointerdown',ev=>{
  menus.forEach(etat=>{if(etat.ouvert&&!etat.peau.contains(ev.target))menuFermer(etat,false)});
});

/* Tous les menus de la page d'un coup — y compris ceux des étapes suivantes,
   qui existent déjà dans le HTML même s'ils ne sont pas encore à l'écran. */
  window.menusPoserTous = function menusPoserTous(){
  document.querySelectorAll('select:not([data-menu-non]),input[list]').forEach(el=>{
    if(!el.closest('.menu'))menuPoser(el);
  });
}

/* Le formulaire réécrit des options en cours de route (catalogue textile,
   coloris d'une référence, genres d'une famille…) et pose des `.value` par
   programme — une écriture directe ne déclenche AUCUN évènement. Le champ
   fermé doit donc être repeint à la main. */
  window.menuRafraichir = function menuRafraichir(hote){
  const etat=menus.get(hote);
  if(!etat)return;
  menuPeindreChamp(etat);
  if(etat.ouvert)menuPeindre(etat);
}
  window.menusRafraichirTous = function menusRafraichirTous(){menus.forEach(etat=>menuRafraichir(etat.hote))};

  // regreffent leurs propres boutons toutes les 400 ms).
  const veilleur = new MutationObserver(() => { guetterEcranFinal(); rebrancherBoutonBrouillon(); grefferLesIndicatifs(); window.menusPoserTous(); });
  // `attributeFilter` : le guet ne réagit qu'à la classe — c'est elle (`hidden`)
  // qui démasque l'écran de fin. Sans le filtre, CHAQUE changement d'attribut
  // du document (les minuteurs des écrans en produisent plusieurs par seconde)
  // rejouait les deux contrôles. `childList` reste entier : le bouton brouillon
  // et la carte de fin sont régulièrement regreffés en tant que nœuds.
  veilleur.observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
  });
  setInterval(() => { guetterEcranFinal(); rebrancherBoutonBrouillon(); grefferLesIndicatifs(); window.menusPoserTous(); }, VEILLE_MS);
  guetterEcranFinal();
  grefferLesIndicatifs();
  poserStyleMenu();
  window.menusPoserTous();
  rebrancherBoutonBrouillon();
  montrerBrouillonsOublies();

  // L'hôte réaffiche l'écran pour un nouveau client : la base a pu bouger
  // entre-temps (un client créé depuis l'onglet Base clients).
  window.oldaRafraichirClients = () => chargerClients().catch(raterEnSilence('base clients indisponible'));
})();
