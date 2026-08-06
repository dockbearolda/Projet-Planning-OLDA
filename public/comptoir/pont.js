'use strict';

// PONT — ce qui relie les deux écrans du comptoir au reste du CRM.
// ===========================================================================
// `vente-directe.html` et `demande-devis.html` sont les écrans validés par le
// patron, repris tels quels. Ils ne connaissent rien du CRM : ils savent
// afficher un parcours et produire un récapitulatif. Ce fichier — chargé en
// dernier dans les deux pages — leur branche les deux seules choses qui ne
// peuvent PAS vivre dans un écran isolé :
//
//   1. LA BASE CLIENTS. La vendeuse doit chercher dans les clients de
//      l'atelier, pas dans un jeu d'exemple. On remplit le tableau de l'écran
//      depuis GET /api/clients.
//   2. LE NUMÉRO DU JOUR. Deux postes qui encaissent en même temps ne doivent
//      jamais remettre le même numéro au client : le compteur vit en base
//      (POST /api/vente/numero · /api/devis/numero), pas dans le navigateur.
//
// Le reste — l'envoi au planning — passe par le message `OLDA_CREATE_PROJECT`
// que la page poste déjà à la fenêtre parente ; c'est `nouveau-projet.js` qui
// l'écoute et appelle l'API. L'écran n'a donc aucune adresse d'API à connaître.
//
// Tout est en « si ça rate, on continue » : sans réseau, l'écran reste
// utilisable avec sa recherche vide et son numéro de secours. Une vente qui ne
// part pas au planning se voit (message d'erreur côté hôte) ; une vente qu'on
// ne peut pas SAISIR bloquerait le comptoir.

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

  let envoiEnCours = false;
  if (window.parent === window) {
    window.addEventListener('message', async (e) => {
      if (e.source !== window) return; // seul le message que la page s'adresse
      const msg = e.data;
      if (!msg || msg.type !== 'OLDA_CREATE_PROJECT' || !msg.payload) return;
      if (envoiEnCours) return; // double tap = une seule ligne
      envoiEnCours = true;
      try {
        const data = await api('POST', '/api/comptoir/projet', msg.payload);
        // Le serveur ne dit pas seulement « c'est passé » : il dit AUSSI quand
        // il a reconnu un renvoi du même dossier, et quand il a dû changer la
        // référence parce qu'un autre dossier la portait déjà. Annoncer les
        // trois cas de la même façon, c'était laisser croire à un enregistrement
        // là où rien n'avait été créé.
        alert(messageEnregistrement(data));
      } catch (err) {
        alert(`Enregistrement au planning IMPOSSIBLE : ${err.message}\nLe dossier est intact — réessaie.`);
      } finally {
        envoiEnCours = false;
      }
    });
  }

  // L'hôte réaffiche l'écran pour un nouveau client : la base a pu bouger
  // entre-temps (un client créé depuis l'onglet Base clients).
  window.oldaRafraichirClients = () => chargerClients().catch(raterEnSilence('base clients indisponible'));
})();
