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

//   6. LE MESSAGE DE REFUS. Les deux écrans refusaient par `alert()` —
//      dix-neuf appels au total. Une boîte système est la seule surface que la
//      charte ne peut pas habiller, elle bloque le navigateur entier, et elle
//      retarde le `focus()` que le code pose juste après : le curseur n'arrive
//      dans le champ fautif qu'une fois la boîte fermée. On les route vers un
//      bandeau posé (`.msg-ecran`, charte.css). Ce qui doit être ACQUITTÉ —
//      « la référence du ticket a changé, corrige le papier remis au client » —
//      garde une vraie boîte, par `window.alertSysteme`.

(function () {
  // ------------------------------------------------------------- LE BANDEAU
  // UN SEUL à l'écran : deux refus d'affilée remplacent le texte, ils
  // n'empilent pas deux bandeaux. Posé en `fixed` — il ne pousse aucun champ.
  const MSG_MS = 6000;
  let bandeauMsg = null;
  let minuteurMsg = null;

  function montrerMessage(texte) {
    const dit = String(texte == null ? '' : texte).trim();
    if (!dit) return;
    if (!bandeauMsg) {
      bandeauMsg = document.createElement('p');
      bandeauMsg.className = 'msg-ecran';
      bandeauMsg.setAttribute('role', 'alert');
      // Un clic dessus l'efface : on ne fait pas viser une croix de 12 px pour
      // se débarrasser d'une phrase qu'on vient de lire.
      bandeauMsg.addEventListener('click', () => cacherMessage());
      document.body.appendChild(bandeauMsg);
    }
    bandeauMsg.textContent = dit;
    // Deux images : la première pose le nœud, la seconde déclenche le fondu.
    // Sans elle, le navigateur voit l'état final d'emblée et rien ne bouge.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (bandeauMsg) bandeauMsg.classList.add('est-la');
    }));
    clearTimeout(minuteurMsg);
    minuteurMsg = setTimeout(cacherMessage, MSG_MS);
  }

  function cacherMessage() {
    clearTimeout(minuteurMsg);
    minuteurMsg = null;
    if (bandeauMsg) bandeauMsg.classList.remove('est-la');
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cacherMessage(); });

  // LA BOÎTE SYSTÈME RESTE JOIGNABLE, sous son vrai nom : ce qui doit être
  // ACQUITTÉ ne peut pas passer par un bandeau qui s'efface tout seul.
  window.alertSysteme = window.alert.bind(window);
  window.alert = montrerMessage;
  window.oldaMessage = montrerMessage;

  // Minuteur : sur un wifi qui décroche, `fetch` n'échoue jamais — il attend.
  // Ici c'est la réservation d'un numéro de ticket au moment où le client est
  // devant le comptoir : mieux vaut une erreur au bout de 15 s (l'écran bascule
  // alors sur son numéro de secours) qu'un écran qui ne rend jamais la main.
  // Ce fichier est chargé en script simple par les deux écrans du patron : il ne
  // peut pas importer `reseau.js`, d'où le minuteur écrit ici.
  // Le minuteur, à part : `api` jette tout ce qui n'est pas un 200, alors que
  // la création d'un client a BESOIN du corps de la réponse (le 409 « déjà dans
  // la base » n'est pas une panne, c'est une information). Les deux passent
  // donc par le même minuteur, sans partager la façon de lire la réponse.
  const fetchMinute = async (url, options) => {
    const minuteur = new AbortController();
    const stop = setTimeout(() => minuteur.abort(), 15000);
    try {
      return await fetch(url, { ...options, signal: minuteur.signal });
    } finally {
      clearTimeout(stop);
    }
  };

  // LE COMPTOIR SIGNE AUSSI. Le prénom de la vendeuse part avec chaque appel,
  // dans le même en-tête que le CRM : sans lui, tout ce qui se saisit ici
  // arriverait au journal sans nom, alors que c'est précisément là que les
  // dossiers naissent.
  //
  // ⚠ Encodé en pourcent : `fetch` REFUSE un en-tête hors latin-1 et lève —
  // un prénom exotique ferait échouer l'envoi du dossier, pas seulement sa
  // signature. La clé est réécrite ici parce que ce fichier est servi tel quel
  // aux écrans du patron : il ne peut pas importer `poste.js`.
  const enTeteQui = () => {
    let nom = '';
    try { nom = localStorage.getItem('olda.qui') || ''; } catch (_) { /* stockage refusé */ }
    return nom ? { 'X-Qui': encodeURIComponent(nom) } : {};
  };

  const api = async (method, url, body) => {
    const res = await fetchMinute(url, {
      method,
      headers: body === undefined
        ? enTeteQui()
        : { 'Content-Type': 'application/json', ...enTeteQui() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
    return await res.json();
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

  // Le chemin INVERSE de `versEcran` : l'écran nomme les natures en toutes
  // lettres, la base les range en code.
  const NATURE_BASE = {
    Particulier: 'perso', Association: 'asso', Revendeur: 'revendeur', Professionnel: 'pro',
  };

  // Même découpe que le serveur : le texte ENTIER reste le nom du dossier
  // (c'est lui la clé de rapprochement), on n'en tire que prénom et nom.
  function couperNomPerso(nomComplet) {
    const mots = String(nomComplet || '').trim().split(/\s+/).filter(Boolean);
    if (mots.length < 2) return { prenom: '', nom: mots[0] || '' };
    return { prenom: mots[0], nom: mots.slice(1).join(' ') };
  }

  // Même normalisation que `clientKey` (db.js) : c'est elle qui décide si deux
  // graphies désignent le même client. Sert uniquement à retrouver la fiche que
  // le serveur vient de nous refuser en doublon.
  const cleClient = (v) => String(v == null ? '' : v)
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function versBase(fiche) {
    const nature = NATURE_BASE[fiche.type] || 'pro';
    const corps = {
      entreprise: fiche.name || '',
      client_type: nature,
      telephone: fiche.phone || '',
      email: fiche.email || '',
    };
    if (nature === 'perso') {
      const p = couperNomPerso(fiche.name);
      corps.prenom = p.prenom;
      corps.nom = p.nom;
    } else {
      corps.nom = fiche.contact || '';
      corps.fonction = fiche.contactRole || '';
      corps.type = fiche.sector || '';
      corps.adresse = fiche.address || '';
      corps.zone = fiche.city || '';
      corps.code_postal = fiche.postal || '';
    }
    return corps;
  }

  // LA FICHE ENTRE EN BASE AU MOMENT OÙ ON LA CRÉE, plus au moment où la
  // demande part au planning. Une demande abandonnée emportait le client avec
  // elle ; et le client n'avait, jusque-là, qu'un identifiant inventé dans
  // l'onglet (`c1724…`) — donc pas de code CLI-PRO-xxxx, pas de fiche, et rien
  // que le poste d'à côté puisse voir.
  //
  // Le doublon n'est PAS une erreur : deux comptoirs qui inscrivent le même
  // nouveau client en même temps, c'est le cas normal ici. Le serveur refuse la
  // seconde écriture (409) ; on récupère alors la fiche qui a gagné et on
  // travaille avec elle, plutôt que d'en fabriquer une deuxième.
  async function enregistrerClient(fiche, idExistant) {
    const corps = versBase(fiche);
    if (!corps.entreprise) throw new Error('le nom du client est vide');
    const url = idExistant ? `/api/clients/${encodeURIComponent(idExistant)}` : '/api/clients';
    const res = await fetchMinute(url, {
      method: idExistant ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', ...enTeteQui() },
      body: JSON.stringify(corps),
    });
    if (res.status === 409) {
      await chargerClients();
      const cle = cleClient(corps.entreprise);
      const deja = (typeof clientDirectory !== 'undefined' ? clientDirectory : [])
        .find((c) => cleClient(c.name) === cle);
      if (deja) {
        return { fiche: deja, avis: `« ${corps.entreprise} » était déjà dans la base clients : c'est cette fiche-là qui est associée à la demande.` };
      }
      throw new Error(`« ${corps.entreprise} » est déjà dans la base clients`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `enregistrement refusé (${res.status})`);
    const enregistree = versEcran(data);
    // La base fait foi : on remplace la fiche locale par celle qu'elle rend
    // (vrai identifiant, code CLI-…), on n'en garde pas deux versions.
    if (typeof clientDirectory !== 'undefined' && Array.isArray(clientDirectory)) {
      const i = clientDirectory.findIndex((c) => c.id === enregistree.id || c.id === idExistant);
      if (i >= 0) clientDirectory.splice(i, 1, enregistree);
      else clientDirectory.unshift(enregistree);
    }
    return { fiche: enregistree, avis: '' };
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
      if (typeof window.renderClientOptions === 'function') window.renderClientOptions();
      else if (typeof renderClientQuickList === 'function') renderClientQuickList();
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
  // toute la page relit (récapitulatif, ticket, message au planning).
  // Elle est VIDÉE à l'ouverture et ne vaut quelque chose qu'une fois le numéro
  // réservé au SERVEUR, à la première ligne saisie : deux postes qui comptent
  // chacun dans leur coin finissaient par se donner le même numéro. Le numéro
  // que la page s'était donné toute seule reste en secours, signé du poste, pour
  // le cas où le serveur ne répond pas.
  //
  // Les bandeaux « .ref-display » qui l'affichaient sur les étapes 3, 4 et 5 ont
  // été RETIRÉS de l'écran le 25/08 : il n'y a plus rien à repeindre, et la
  // référence ne se lit plus que sur le ticket et dans le PDF.
  let refSecours = '';
  function masquerRef() {
    if (typeof reference === 'undefined') return;
    refSecours = marquerPoste(reference);
    reference = '';
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
    // UN DOSSIER À PLUSIEURS ARTICLES DEVIENT PLUSIEURS LIGNES. Sans le dire, la
    // vendeuse croit avoir enregistré une commande et en trouve quatre au
    // planning — elle penserait à un doublon et en supprimerait trois.
    const n = d.lot && Number(d.lot.total) > 1 ? Number(d.lot.total) : 0;
    if (n) return `Commande enregistrée au planning ✔\n\n${n} articles → ${n} lignes, regroupées sous le même ticket.\nChacune avance à son rythme (production, commande fournisseur…).`;
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
        // LA BOÎTE DE DIALOGUE NE SERT QU'À CE QUI DEMANDE UN GESTE (26/08).
        // Le raisonnement était déjà écrit pour l'envoi automatique — « un
        // `alert` lui barre l'écran pour dire ce que le bandeau dit déjà » —
        // il vaut aussi pour l'envoi manuel : `resultatEnvoi` vient de peindre
        // ce message DANS l'écran, en toutes lettres. Le répéter dans une boîte
        // système, c'est un clic de plus à chaque commande, sur la seule
        // surface de l'application que la charte ne peut pas habiller.
        //
        // SAUF quand la référence a changé : le ticket est déjà entre les mains
        // du client et porte un numéro faux. Là, il ne suffit pas de le dire —
        // il faut que quelqu'un le lise. Un bandeau se contourne, pas une boîte.
        if (!envoiAutomatique && data && data.refModifiee) window.alertSysteme(messageEnregistrement(data));
      } catch (err) {
        resultatEnvoi(false, err.message);
        if (!envoiAutomatique) window.alertSysteme(`Enregistrement au planning IMPOSSIBLE : ${err.message}\nLe dossier est intact — réessaie.`);
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
    .olda-etat--envoi{background:var(--zone-bg);color:var(--text-1);border-color:var(--border)}
    .olda-etat--ok{background:var(--success-bg);color:var(--success);border-color:var(--success-line)}
    .olda-etat--echec{background:var(--danger-bg);color:var(--danger);border-color:var(--danger-line)}
    .olda-etat__reessai{min-height:44px;padding:0 18px;border-radius:var(--arrondi-champ);
      border:0;background:var(--danger);color:var(--surface);font:inherit;font-weight:var(--graisse-forte);
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
    // LE VERT NE DIT PLUS RIEN. « ✔ Ce dossier est au planning » répétait ce
    // que le bouton d'à côté dit déjà en devenant « 📅 Déjà au planning » et
    // inactif. Ce qu'on ne peut PAS deviner en regardant l'écran — l'envoi en
    // cours, l'échec et son bouton Réessayer — reste, entier : c'est par ce
    // trou-là que des dossiers sont partis sans que personne ne s'en aperçoive.
    // `display` et non `hidden` : `.olda-etat` porte sa propre règle `display`,
    // elle défait l'attribut.
    el.style.display = etatEnvoi === 'ok' ? 'none' : '';
    el.className = `olda-etat olda-etat--${etatEnvoi === 'ok' ? 'ok' : etatEnvoi === 'echec' ? 'echec' : 'envoi'}`;
    el.firstChild.textContent = detail ? `${PHRASES[etatEnvoi]}\n${detail}` : PHRASES[etatEnvoi];
    el.lastChild.hidden = etatEnvoi !== 'echec' && etatEnvoi !== 'attente';
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
    // UN `.click()` SUR UN BOUTON DÉSACTIVÉ NE FAIT RIEN, ET NE LÈVE RIEN.
    // L'envoi ne partait pas, le bandeau restait sur « Enregistrement… », puis
    // annonçait « Aucune réponse — le réseau a peut-être décroché » : de quoi
    // chercher une panne de réseau qui n'a jamais existé. On ne dépend donc pas
    // de l'état d'un bouton pour envoyer. Ce qui empêche vraiment le double
    // envoi, c'est la garde en tête de cette fonction (`etatEnvoi === 'ok'`) —
    // et, côté serveur, l'empreinte du dossier.
    btn.disabled = false;
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

  // LE BOUTON « 💾 Enregistrer » A ÉTÉ RETIRÉ DE L'ÉCRAN (24/08/2026), et le
  // rebranchement qui vivait ici avec lui. Il écrivait un brouillon dans le
  // navigateur que RIEN ne relit jamais, en annonçant « Brouillon enregistré » :
  // on l'avait rebranché sur le vrai envoi. Il n'y a plus de geste à
  // rebrancher — le dossier part TOUT SEUL dès que l'écran de fin s'affiche
  // (`guetterEcranFinal`), et le seul geste qui reste est le « Réessayer » du
  // bandeau rouge, quand l'envoi a échoué.
  // Les brouillons DÉJÀ écrits sur les postes, eux, continuent d'être proposés
  // à la récupération (`montrerBrouillonsOublies`).

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
      window.alertSysteme(tout);
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
    // Qu'on vienne de la poser ou qu'on reprenne celle de l'écran, cette ligne
    // CHANGE de contenu à chaque frappe : elle doit flotter. Sans la classe,
    // elle passait de 0 à 22 px au premier chiffre saisi et poussait le champ
    // suivant — la règle nucléaire du 24/08 (voir charte.css).
    aide.classList.add('msg-flottant');

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
    // LE THÈME SUIT CELUI DU CRM, EN DIRECT. Le thème d'ouverture arrive par
    // l'adresse du cadre (voir le script en tête de chaque écran) ; celui-ci
    // couvre la BASCULE — le patron clique sur l'interrupteur du planning
    // pendant qu'un parcours est ouvert derrière, et le cadre restait clair
    // au milieu d'une application devenue sombre.
    if (e.data && e.data.type === 'OLDA_THEME') {
      const t = e.data.theme === 'dark' ? 'dark' : 'light';
      if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
    }
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
/* LE DÉCLENCHEUR EST UN <div> : il ÉCHAPPE au « input,select,textarea{padding:
   13px 14px!important} » que les deux écrans imposent, et se retrouvait 5 px
   plus court que l'<input> d'à côté sur la même ligne. Il reprend donc le même
   rembourrage, la même taille de texte et la même hauteur de ligne — jamais
   une hauteur en dur : sur un poste où Manrope n'est pas encore arrivée, la
   ligne de texte rétrécit, et les deux champs doivent rétrécir ENSEMBLE.
   Hauteur de ligne en RAPPORT et non en « normal » des deux côtés : Chrome ne
   calcule pas la boîte d'un <input> comme celle d'un <div>, et « normal » les
   laissait à 22 px contre 20,5. Et comme le déclencheur est une boîte FLEX,
   sa hauteur vient de ses enfants, pas de sa hauteur de ligne : d'où le
   min-height calculé — la ligne de texte (1.375em) plus le rembourrage et le
   trait, exactement la boîte d'un champ voisin, et qui suit la taille du
   texte si elle change. Le trait, sa couleur et son arrondi viennent
   de la même règle que les champs voisins — ils étaient plus fins, plus
   sombres et moins arrondis. */
/* LES VALEURS DE REPLI NE SERVENT PLUS QU'À LA CHARTE ABSENTE. Les DEUX
   écrans du comptoir chargent charte.css depuis le 23/08 : le déclencheur
   prend l'échelle et les couleurs de sa page, thème sombre compris. Elles
   restent parce qu'un fichier de style qui ne se charge pas ne doit pas rendre
   un écran illisible. Les 3 px du calcul sont les deux traits de 1,5. */
/* LA BOÎTE SE LIT, ELLE NE SE CALCULE PLUS (25/08). Ce déclencheur déduisait
   sa hauteur d'un rembourrage et d'un interligne — trois termes à garder
   d'accord avec ceux du champ d'à côté, et ils avaient fini par diverger de
   2,4 px. Il prend maintenant la boîte nommée de l'application, comme le
   champ, le bouton et la zone de texte. */
.menu-declencheur{display:flex;align-items:center;gap:11px;width:100%;padding:0 var(--champ-x);
  min-height:var(--ctrl-h);
  border:1.5px solid var(--border);border-radius:var(--arrondi-champ);background:var(--surface);cursor:pointer;text-align:left;
  font:inherit;font-size:var(--taille-texte);line-height:var(--ligne-champ);color:var(--text-1);transition:border-color var(--dur-1) var(--ease),box-shadow var(--dur-1) var(--ease)}
/* C'est la ligne de TEXTE qui donne sa hauteur au champ fermé : ni la
   référence ni la pastille ne doivent la dépasser, sinon le champ regrandit
   et l'alignement repart. */
.menu-declencheur .menu-jeton{font-size:var(--taille-texte);line-height:1.2;padding:1px 6px}
.menu-declencheur .menu-pastille{width:16px;height:16px}
.menu-declencheur:hover{border-color:var(--border-strong)}
.menu-declencheur:focus-visible{outline:3px solid rgba(var(--primary-rgb),.15);border-color:var(--primary)}
.menu.est-ouvert .menu-declencheur,.menu.est-ouvert>input{border-color:var(--primary);box-shadow:0 0 0 3px rgba(var(--primary-rgb),.10)}
/* Menu libre : le champ de saisie EST le déclencheur. Le chevron se pose
   par-dessus, la pastille de teinte à gauche — ni l'un ni l'autre ne prend le
   clic, il revient au champ, qui ouvre le menu.
   « !important » à contrecœur : les deux écrans imposent déjà
   « input,select,textarea{padding:13px 14px!important} », et sans ça le texte
   saisi passe SOUS le chevron et sous la pastille. */
.menu>.menu-pastille{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:20px;height:20px;pointer-events:none}
.menu.a-pastille>input{padding-left:42px!important}
/* LE DOIGT EST LE CURSEUR DE LA SOURIS, PAS UNE IMAGE POSÉE DANS LE CHAMP.
   Un champ qui propose un choix se clique — donc la main. Rien dans le champ :
   ni chevron, ni pictogramme, la place revient au texte saisi. Le déclencheur
   d'une liste porte déjà son curseur main ; c'est le champ LIBRE qui affichait
   un curseur de texte et se lisait comme une simple zone de frappe. */
.menu>input{cursor:pointer;caret-color:transparent}
/* CLIQUER OUVRE LA LISTE, ÇA NE COMMENCE PAS UNE SAISIE. Le trait clignotant
   qui apparaissait au clic disait le contraire et ramenait le champ à une
   zone de frappe ordinaire. Il ne revient qu'à la PREMIÈRE FRAPPE — taper
   reste possible, c'est le geste qui change d'intention, pas le champ. */
.menu>input.est-frappe{cursor:text;caret-color:auto}
/* La référence en chiffres alignés : c'est elle qui ouvre la ligne. */
/* La référence en GRAS, dans la police de la page. Elle était composée en
   chasse fixe pour aligner les colonnes ; le patron n'en veut pas — la graisse
   suffit à la faire ressortir de la désignation qui la suit. Les chiffres
   gardent leur largeur fixe (tabular-nums), c'est du réglage de chiffres, pas
   un changement de police. */
.menu-jeton{flex:none;font-size:var(--taille-texte);font-weight:var(--graisse-forte);font-variant-numeric:tabular-nums;
  color:var(--text-1);background:var(--border-soft);border-radius:6px;padding:4px 7px;white-space:nowrap}
/* UNE VALEUR CHOISIE NE SE LIT PAS COMME UN PLACEHOLDER. Les deux états
   pointaient sur le MÊME jeton (--text-2) : « OUI — 4 % » sortait dans le gris
   exact de « Choisir », et un menu rempli avait l'air vide — d'autant plus
   depuis que la TGCA arrive renseignée. La valeur prend l'encre du texte, le
   vide garde le gris des placeholders. (Les deux valeurs de repli, elles,
   disaient déjà la bonne chose : encre foncée d'un côté, gris de l'autre.) */
.menu-texte{flex:1 1 auto;min-width:0;font-size:var(--taille-texte);color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.menu-texte.est-vide{color:var(--text-2)}
/* Une pastille de couleur EST une information : elle dit la teinte que la
   vendeuse ne devinerait pas d'après « Wet Sand ». */
.menu-pastille{flex:none;width:18px;height:18px;border-radius:50%;border:1px solid var(--text-3);box-shadow:inset 0 0 0 1px var(--surface)}

/* POSITION FIXE, ET C'EST LE FOND DU PROBLÈME. En position absolue, le
   panneau restait DANS le conteneur qui défile : large de 560 px dans une
   cellule de 178, il comptait dans la largeur défilable de <main> quoi qu'on
   calcule, et le navigateur décalait <main> pour le montrer. Hors du flux du
   conteneur, il ne compte plus nulle part — et il ne peut plus être coupé.
   La largeur et la position sont posées par menuPlacer() : en position fixe,
   un pourcentage parlerait de la FENÊTRE, plus du champ.
   (Pas d'accent grave dans ce commentaire : ce bloc vit dans un littéral de
   gabarit, un accent grave le refermerait.) */
.menu-panneau{position:fixed;z-index:40;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--arrondi-bloc);overflow:hidden;display:none;
  box-shadow:var(--shadow-2)}
.menu.est-ouvert .menu-panneau{display:block;animation:menuEntre var(--dur-2) var(--ease)}
@keyframes menuEntre{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
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

.menu-tete{display:flex;align-items:center;gap:10px;padding:10px;background:var(--zone-bg);border-bottom:1px solid var(--border-soft)}
.menu-tete input{font-size:var(--taille-texte);padding:9px 11px}
/* ON CHERCHE DANS LA BULLE, PAS DANS UN CHAMP DE PLUS (27/08/2026).
   Le filtre vivait en tête du panneau : cliquer ouvrait une liste, puis il
   fallait descendre d'un cran pour taper — un deuxième champ pour la même
   question, et il ne s'affichait que sur la liste des références. Il se pose
   maintenant SUR le déclencheur, à sa place exacte : la bulle devient un champ
   de saisie, le curseur y est déjà, on tape. C'est ce que fait n'importe quel
   bon sélecteur, et ça vaut pour TOUS les menus.
   Il épouse la boîte du déclencheur — même hauteur, même rembourrage, même
   arrondi — pour que rien ne bouge à l'ouverture. */
.menu-filtre{display:none}
.menu.est-ouvert>.menu-filtre{
  display:block;position:absolute;left:0;top:0;width:100%;
  min-height:var(--ctrl-h);height:var(--ctrl-h);
  padding:0 var(--champ-x);margin:0;
  border:1.5px solid var(--primary);border-radius:var(--arrondi-champ);
  background:var(--surface);color:var(--text-1);
  font:inherit;font-size:var(--taille-texte);line-height:var(--ligne-champ);
  box-shadow:0 0 0 3px rgba(var(--primary-rgb),.10);
  outline:none;z-index:1}
/* Ce qui était choisi reste lisible pendant qu'on cherche : il devient
   l'invite du champ. Sans ça, ouvrir un menu efface sous les yeux la valeur
   qu'on venait vérifier. */
.menu.est-ouvert>.menu-filtre::placeholder{color:var(--text-2)}
.menu-compte{flex:none;font-size:var(--taille-texte);font-weight:var(--graisse-note);color:var(--text-2);font-variant-numeric:tabular-nums;white-space:nowrap}
/* LE DEFILEMENT S'ARRETE AU BAS DE LA LISTE. Sans overscroll-behavior, la
   molette poursuivie en bout de liste part dans la page derriere — et comme
   un defilement d'ecran referme le menu, la liste se fermait au moment ou
   l'on cherchait le dernier article. */
/* PAS DE REMBOURRAGE EN HAUT : c'est la zone qui defile, et le titre collant
   s'y arrete a zero. Les six pixels qu'il y avait la laissaient passer une
   bande de liste AU-DESSUS du titre — une demi-ligne de texte qui flottait au
   ras du panneau. Le blanc du haut est rendu par le titre lui-meme. */
.menu-liste{max-height:326px;overflow-y:auto;overscroll-behavior:contain;margin:0;padding:0 6px 6px;list-style:none}
/* CHAQUE FAMILLE EST SON PROPRE BLOC, et c'est ce qui fait tenir le titre
   collant. Un titre en position collante ne sort jamais de son bloc englobant :
   dans une seule liste, les treize titres se collaient au MEME endroit et s'y
   empilaient — mesure : trois titres a 374 px en meme temps. Comme ils n'ont
   pas tous la meme hauteur, celui de dessous depassait, et la liste se lisait
   au travers. Emboite, chaque titre est pousse dehors par le suivant. */
.menu-famille{list-style:none}
.menu-famille-liste{margin:0;padding:0;list-style:none}
/* Le titre de famille reste collé en haut pendant le défilement : 48
   références sur 13 familles, sans ça on ne sait plus dans quoi on est.
   Sur UNE ligne, toujours : deux titres de hauteurs differentes au meme
   endroit, c'est le defaut d'avant qui revient par la bande. */
.menu-groupe{position:sticky;top:0;z-index:1;background:var(--surface);padding:13px 10px 5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  font-size:var(--taille-texte);font-weight:var(--graisse-forte);letter-spacing:.09em;text-transform:uppercase;color:var(--text-2)}
.menu-option{display:flex;align-items:baseline;gap:12px;padding:9px 10px 9px 8px;
  border-left:3px solid transparent;border-radius:8px;cursor:pointer}
/* La colonne des références : un PLANCHER, pas une largeur fixe. « PARAGON
   218T » fait 98 px en Manrope gras et débordait sur la désignation, qui
   venait s'écrire par-dessus. Le plancher garde les courtes alignées, les
   longues poussent leur seule ligne — jamais de texte coupé sur une
   référence, c'est elle qui identifie l'article. */
.menu-option .menu-jeton{background:transparent;padding:0;min-width:100px;flex:none}
.menu-option .menu-pastille{align-self:center}
.menu-option-texte{flex:1 1 auto;min-width:0;font-size:var(--taille-texte);color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Deux états distincts : le curseur du clavier (gris plein) et le choix en
   cours (barre d'encre + texte en gras). Aucune couleur ici n'est décorative. */
.menu-option.est-vise{background:var(--surface-hover)}
.menu-option[aria-selected="true"]{border-left-color:var(--text-1);background:var(--zone-bg)}
.menu-option[aria-selected="true"] .menu-option-texte{color:var(--text-1);font-weight:var(--graisse-forte)}
.menu-rien{padding:22px 14px;text-align:center;color:var(--text-2);font-size:var(--taille-texte)}
/* L'AJOUT MANUEL — la même ligne, au même endroit, dans TOUS les menus.
   Avant, trois listes portaient leur propre « produit libre » noyé au milieu
   du catalogue, les autres n'en avaient aucun : on ne savait jamais où
   chercher. Elle est épinglée AU-DESSUS du filtre, hors de la liste, donc ni
   emportée par une recherche ni repoussée par le défilement. */
/* Une ligne, pas une bannière : un « + » et un mot. Elle doit se voir sans
   se mettre devant la liste — c'est un raccourci, pas la réponse attendue. */
.menu-manuel{display:flex;align-items:center;gap:7px;width:100%;padding:8px 12px;border:0;
  border-bottom:1px solid var(--border-soft);background:var(--surface);font:inherit;font-size:var(--taille-texte);font-weight:var(--graisse-note);
  color:var(--text-2);text-align:left;cursor:pointer}
.menu-manuel:hover,.menu-manuel:focus-visible{background:var(--zone-bg);color:var(--text-1);outline:none}
.menu-plus{flex:none;font-size:var(--taille-texte);font-weight:var(--graisse-forte);line-height:1;color:inherit}
.menu-saisie{display:none;gap:8px;padding:10px;border-bottom:1px solid var(--border-soft);background:var(--zone-bg)}
.menu-saisie input{flex:1 1 auto;min-width:0;font-size:var(--taille-texte);padding:9px 11px}
.menu-saisie button{flex:none;border:0;border-radius:var(--arrondi-champ);padding:9px 14px;background:var(--text-1);
  color:var(--on-primary);font:inherit;font-weight:var(--graisse-forte);cursor:pointer}
/* Pendant la saisie libre, la liste s'efface : deux façons de répondre à la
   même question en même temps, c'est une hésitation de plus au comptoir. */
.menu.est-saisie .menu-saisie{display:flex}
.menu.est-saisie .menu-manuel,.menu.est-saisie .menu-tete,.menu.est-saisie .menu-liste{display:none}
/* Un menu fermé n'a pas de champ à rougir : c'est sa peau qui porte l'erreur.
   Mais .invalid est une règle GÉNÉRALE, écrite pour un <input>, et elle
   pose son cadre et son fond en !important : sur l'enveloppe — qui n'a
   aucun arrondi — elle dessinait un SECOND rectangle rouge, à angles droits,
   autour de la bulle déjà rougie. L'enveloppe porte la classe, la bulle
   porte le rouge. (Elle gagne : deux classes valent mieux qu'une.) */
.menu.invalid{border:0!important;background:transparent!important;box-shadow:none!important}
/* UN MENU EN ERREUR NE BOUGE PAS NON PLUS. Le déclencheur calcule sa hauteur
   minimale à partir de ses DEUX traits de 1,5 px (« + 3px ») : un trait de
   2 px le poussait à 50,6 px pendant que ses voisins restaient à 49,6. Le
   trait garde sa largeur, l'anneau fait l'épaisseur — il ne prend pas de place. */
.menu.invalid .menu-declencheur{border:1.5px solid var(--danger);background:var(--danger-bg);box-shadow:0 0 0 1px var(--danger)}
@media(prefers-reduced-motion:reduce){.menu.est-ouvert .menu-panneau{animation:none}.menu-declencheur{transition:none}}
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

/* CE QU'UNE RECHERCHE DOIT COMPRENDRE (27/08/2026).
   « NS300 », « ns 300 », « n ns 300 », « NS-300 », « ns3 » désignent tous la
   même référence, et personne ne les tape deux fois de la même façon. On
   RÉDUIT donc les deux côtés à leurs lettres et à leurs chiffres avant de
   comparer : la casse, les accents, les espaces, les tirets et les points ne
   veulent rien dire dans un code. */
function menuReduire(s){return menuNorm(s).replace(/[^a-z0-9]+/g,'')}

/* Combien une option répond à ce qu'on a tapé. -1 = elle ne répond pas.
   Le RANG compte autant que le filtre : taper « ns3 » doit faire remonter
   NS300 avant un texte qui contient « ns3 » au milieu d'une phrase. */
function menuScore(o,q){
  const mots=String(q||'').split(/\s+/).map(menuReduire).filter(Boolean);
  if(!mots.length)return 0;
  const jeton=menuReduire(o.jeton);
  const foin=menuReduire(`${o.jeton} ${o.texte} ${o.groupe} ${o.cherche}`);
  /* Chaque morceau tapé doit se retrouver quelque part — c'est ce qui fait
     marcher « n ns 300 » aussi bien que « ns300 ». */
  if(!mots.every(m=>foin.includes(m)))return -1;
  const tout=mots.join('');
  if(jeton&&jeton.startsWith(tout))return 3;   /* la référence, par son début */
  if(jeton&&jeton.includes(tout))return 2;     /* la référence, plus loin */
  if(foin.startsWith(tout))return 1;           /* le libellé, par son début */
  return 0;
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
    /* CE QU'ON CHERCHE SANS L'AFFICHER. La liste des clients se lit en une
       colonne de NOMS — le téléphone et l'e-mail à côté de chacun n'aidaient
       personne à reconnaître son client, ils allongeaient chaque ligne. Mais
       le champ de filtre promet « nom, téléphone, e-mail » : ils restent donc
       cherchables, posés en `data-cherche` sur l'option. */
    cherche:o.dataset.cherche||'',
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
  /* Le filtre ne vit plus dans le panneau : il se pose SUR le déclencheur
     (voir la règle .menu.est-ouvert>.menu-filtre). L'entête du panneau ne garde
     que le compteur. */
  tete.append(compte);
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
  const motManuel=hote.dataset.menuManuelTexte||'Ajouter';
  const mot=document.createElement('span');
  mot.textContent=motManuel;
  manuel.append(plus,mot);

  /* UNE LISTE PEUT PORTER UNE ACTION QUI N'EST PAS UNE VALEUR. « + Ajouter »
     range ce qu'on tape DANS la liste ; « + Créer un nouveau client » ne le
     peut pas — un client, c'est un nom, un téléphone, un e-mail, un secteur,
     donc un formulaire. Le raccourci se lit pourtant au même endroit et de la
     même façon : `data-menu-action="<le mot>"` pose la ligne, le clic ferme le
     menu et laisse un évènement `menu-action` sur le <select>. La page décide
     de ce qui s'ouvre ; le menu, lui, n'en sait rien. */
  const motAction=hote.dataset.menuAction;
  let action=null;
  if(motAction){
    action=document.createElement('button');
    action.type='button';
    action.className='menu-manuel';
    const plusAction=document.createElement('span');
    plusAction.className='menu-plus';
    plusAction.setAttribute('aria-hidden','true');
    plusAction.textContent='+';
    const motAct=document.createElement('span');
    motAct.textContent=motAction;
    action.append(plusAction,motAct);
  }

  const saisie=document.createElement('div');
  saisie.className='menu-saisie';
  const champLibre=document.createElement('input');
  champLibre.type='text';champLibre.autocomplete='off';
  champLibre.placeholder='À ajouter…';
  champLibre.setAttribute('aria-label',motManuel);
  const valider=document.createElement('button');
  valider.type='button';valider.textContent='Valider';
  saisie.append(champLibre,valider);

  /* LA MÊME LIGNE PARTOUT, champ libre compris : un panneau de menu, c'est
     « + Ajouter » puis la liste, et rien d'autre. La mention qui expliquait
     qu'on pouvait écrire dans le champ est partie avec — un deuxième message
     au même endroit, formulé autrement, c'est déjà une hésitation. */
  if(action)panneau.append(action);
  if(avecManuel)panneau.append(manuel,saisie);
  panneau.append(tete,liste);
  peau.append(panneau);
  /* Posé APRÈS le panneau : il se superpose au déclencheur, pas au panneau. */
  if(!libre)peau.append(filtre);

  const etat={hote,libre,peau,declencheur,panneau,tete,filtre,compte,liste,
    avecManuel,manuel,saisie,champLibre,action,vus:[],vise:-1,ouvert:false,filtrer:false};
  menus.set(hote,etat);

  declencheur.addEventListener('click',()=>etat.ouvert?menuFermer(etat,false):menuOuvrir(etat));
  declencheur.addEventListener('keydown',ev=>menuTouche(etat,ev));
  if(libre){
    hote.addEventListener('input',()=>{etat.filtrer=true;etat.vise=0;if(etat.ouvert)menuPeindre(etat);menuPeindreChamp(etat)});
    /* Une touche qui écrit rend le trait ; un clic le reprend. `keydown` et
       non `input` : le trait doit être là AVANT que le caractère ne s'écrive,
       sinon il apparaît une frappe en retard. */
    hote.addEventListener('keydown',ev=>{
      if(ev.key.length===1||ev.key==='Backspace'||ev.key==='Delete')hote.classList.add('est-frappe');
    });
    hote.addEventListener('pointerdown',()=>hote.classList.remove('est-frappe'));
  }else{
    filtre.addEventListener('input',()=>{etat.vise=0;menuPeindre(etat)});
    filtre.addEventListener('keydown',ev=>menuTouche(etat,ev));
  }
  liste.addEventListener('click',ev=>{
    const li=ev.target.closest('[data-valeur]');
    if(li)menuChoisir(etat,li.dataset.valeur);
  });
  if(action){
    action.addEventListener('click',()=>{
      menuFermer(etat,false);
      hote.dispatchEvent(new CustomEvent('menu-action',{bubbles:true}));
    });
    /* Échap depuis le bouton referme le menu et rend le focus au champ, comme
       depuis la liste : une fois entré au clavier, on doit pouvoir ressortir. */
    action.addEventListener('keydown',ev=>{
      if(ev.key==='Escape'){ev.preventDefault();menuFermer(etat,true)}
    });
  }
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
  /* UNE OPTION QUI PORTE UNE RÉFÉRENCE SE SUFFIT À ELLE-MÊME dans le champ :
     « NS401 » identifie l'article, la désignation qui la suivait mangeait la
     largeur et finissait en points de suspension. Elle est écrite en tête du
     bloc, et l'infobulle porte toujours les deux. */
  if(!(choisie&&choisie.jeton)){
    const t=document.createElement('span');
    t.className='menu-texte'+(choisie&&choisie.valeur?'':' est-vide');
    t.textContent=choisie?choisie.texte:'Choisir…';
    declencheur.append(t);
  }
  /* Le texte est coupé à l'ellipse dans un champ étroit : l'infobulle rend la
     ligne entière sans avoir à rouvrir la liste. */
  declencheur.title=choisie&&choisie.valeur?[choisie.jeton,choisie.texte].filter(Boolean).join(' — '):'';
}

/* CE QUI EST RÉELLEMENT PROPOSÉ, relu à chaque ouverture — le formulaire
   réécrit les options en cours de route. Deux lignes n'en sont pas :
   - l'entrée libre est déjà épinglée en tête du panneau, elle n'y est pas deux
     fois ;
   - « — Choisir une référence — », « Sélectionner une option », « Non
     précisée »… tant que RIEN n'est choisi, c'est exactement ce que le champ
     fermé affiche déjà : une ligne de plus qui ne choisit rien. Elle revient
     dès qu'une vraie valeur est prise, parce qu'elle devient alors le seul
     chemin de retour — sur « Délai souhaité », « Non précisée » n'est pas un
     libellé d'attente, c'est une réponse. */
function menuProposees(etat){
  const renvoi=menuRenvoiManuel(etat.hote);
  const rienChoisi=etat.hote.value==='';
  return menuOptions(etat.hote).filter(o=>
    (renvoi===undefined||o.valeur!==renvoi) && !(rienChoisi&&o.valeur===''));
}

function menuFiltrees(etat){
  const toutes=menuProposees(etat);
  /* Un champ libre ne filtre QU'À PARTIR de la première frappe : à l'ouverture
     il contient déjà une valeur, et filtrer dessus ne laisserait voir que cette
     valeur-là — cliquer doit montrer toute la liste. */
  const brut=etat.libre?(etat.filtrer?etat.hote.value:''):etat.filtre.value;
  const q=String(brut||'').trim();
  if(!q)return toutes;
  /* On garde ce qui répond, et on remonte ce qui répond LE MIEUX. Le tri est
     stable : à score égal, la liste garde l'ordre du formulaire. */
  return toutes
    .map((o,i)=>({o,s:menuScore(o,q),i}))
    .filter(x=>x.s>=0)
    .sort((a,b)=>b.s-a.s||a.i-b.i)
    .map(x=>x.o);
}

function menuPeindre(etat){
  const vus=menuFiltrees(etat);
  etat.vus=vus;
  etat.vise=Math.min(Math.max(etat.vise,0),vus.length-1);

  /* Le compteur porte sur ce qui est PROPOSÉ, pas sur le contenu brut du
     <select> : il affichait « 49 / 50 » alors que rien n'était filtré. */
  const toutes=menuProposees(etat).length;
  /* UNE SEULE RECHERCHE SUR L'ÉCRAN, celle de la référence — c'est la seule
     liste qu'on ne parcourt pas des yeux. Partout ailleurs le champ de filtre
     et son compteur sont un deuxième champ dans le champ : on le pose donc à
     la main, avec `data-menu-recherche`, et jamais par un seuil qui décide
     tout seul. Un menu libre, lui, se filtre en tapant dans le champ. */
  /* Le compteur ne se montre QUE pendant une recherche : au repos, « 49 choix »
     sur une liste qu'on a sous les yeux est un mot de plus à lire. Il dit alors
     ce qui reste, ce qui est la seule chose utile à ce moment-là. */
  const cherche=!etat.libre&&etat.filtre.value.trim()!=='';
  etat.tete.style.display=cherche?'':'none';
  if(cherche)etat.compte.textContent=`${vus.length} / ${toutes}`;

  const noeuds=[];
  if(!vus.length){
    const rien=document.createElement('li');
    rien.className='menu-rien';rien.setAttribute('role','presentation');
    rien.textContent=etat.libre?'Aucun choix ne correspond — la saisie reste libre.':'Aucun choix ne correspond.';
    noeuds.push(rien);
  }
  /* UNE FAMILLE, UN BLOC. Le titre collant doit pouvoir SORTIR quand sa famille
     est passée : un `position:sticky` ne quitte jamais son bloc englobant, et
     à plat dans une seule liste ce bloc est la liste entière — les treize
     titres restaient donc collés au même endroit, empilés les uns sur les
     autres. Chaque famille porte maintenant sa propre liste : le titre suivant
     pousse le précédent dehors, comme il se doit.
     `cible` dit où va l'option : dans la famille en cours, ou à la racine pour
     celles qui n'en ont pas (le choix vide et la saisie manuelle, en tête). */
  let groupe=null,cible=null;
  const poser=(el)=>{if(cible)cible.append(el);else noeuds.push(el)};
  vus.forEach((o,i)=>{
    if(!o.groupe){groupe=null;cible=null}
    else if(o.groupe!==groupe){
      groupe=o.groupe;
      const bloc=document.createElement('li');
      bloc.className='menu-famille';bloc.setAttribute('role','presentation');
      const tete=document.createElement('div');
      tete.className='menu-groupe';tete.textContent=o.groupe;
      cible=document.createElement('ul');
      cible.className='menu-famille-liste';
      cible.setAttribute('role','group');
      cible.setAttribute('aria-label',o.groupe);
      bloc.append(tete,cible);
      noeuds.push(bloc);
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
    poser(li);
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
  /* LA TABULATION ENTRE DANS LE PANNEAU AVANT D'EN SORTIR. Un menu qui porte
     une action (« + Créer un nouveau client ») la rendait inatteignable au
     clavier : Tab refermait le panneau, et le bouton partait avec. Elle est le
     premier arrêt ; le Tab suivant, lui, referme comme avant. Sur un poste où
     la souris n'est pas la seule main, un raccourci qu'on ne peut pas
     atteindre n'existe pas. */
  else if(ev.key==='Tab'){
    if(etat.action&&document.activeElement!==etat.action){
      ev.preventDefault();etat.action.focus();return;
    }
    menuFermer(etat,false);
  }
}

/* Un seul geste pour la vendeuse, deux chemins derrière :
   - la liste a déjà son entrée libre gérée par le formulaire → on l'y renvoie ;
   - sinon ce qui est tapé devient la valeur du champ, et une vraie option de
     la liste quand c'en est une : le formulaire n'a rien de spécial à savoir,
     il lit toujours `.value`. */
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
  /* Un champ libre porte sa valeur directement — il n'a pas d'options où la
     ranger. Une liste, si : une deuxième saisie identique réutilise la sienne
     au lieu d'en empiler une, sinon elle se remplit de doublons au fil de la
     journée. */
  if(!etat.libre&&![...hote.options].some(o=>o.value===texte)){
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
  if(!etat.libre){
    etat.filtre.value='';
    /* Ce qui était choisi devient l'invite : on cherche sans perdre de vue ce
       qu'on remplace. */
    const choisie=options.find(o=>o.valeur===etat.hote.value);
    etat.filtre.placeholder=choisie&&choisie.valeur
      ? [choisie.jeton,choisie.texte].filter(Boolean).join(' — ')
      : (etat.hote.dataset.menuFiltre||'Rechercher…');
  }
  /* On ouvre sur le choix en cours, pas en tête de liste. */
  etat.vise=Math.max(0,options.findIndex(o=>o.valeur===etat.hote.value));
  menuPeindre(etat);
  menuPlacer(etat);
  /* LE CURSEUR EST DANS LA BULLE, TOUJOURS. Il n'y allait que sur la liste des
     références — la seule qui portait `data-menu-recherche`. Sur les autres, il
     fallait viser une ligne à la souris ou descendre à la flèche : ouvrir un
     menu, c'est vouloir en choisir une, et le plus court chemin est d'en taper
     le début. */
  if(!etat.libre)etat.filtre.focus();
}

/* CE QUI BORNE LE PANNEAU N'EST PAS LA FENÊTRE. C'est le premier ancêtre qui
   COUPE ou qui DÉFILE — et il peut être bien plus étroit qu'elle.
   Le 24/08, `.layout>main` a reçu `overflow-y:auto` pour que seule la colonne
   de saisie défile. En CSS, dès qu'un axe n'est plus `visible`, l'autre passe
   de `visible` à `auto` : <main> est donc devenu, sans qu'on le demande, un
   conteneur qui défile AUSSI de côté. Mesuré : 651 px de large dans une
   fenêtre de 1103. Un panneau de 560 px ouvert sur la 3e colonne « tenait »
   dans la fenêtre et débordait <main> de 340 px — le navigateur décalait
   alors <main> de 333 px pour le montrer, et tout le formulaire glissait sous
   les yeux au simple clic sur un menu.
   On prend donc l'INTERSECTION de la fenêtre et de tous ces ancêtres. */
function menuBornes(peau){
  const b={gauche:0,droite:window.innerWidth,haut:0,bas:window.innerHeight};
  for(let e=peau.parentElement;e&&e!==document.documentElement;e=e.parentElement){
    const cs=getComputedStyle(e);
    if(cs.overflowX==='visible'&&cs.overflowY==='visible')continue;
    const r=e.getBoundingClientRect();
    if(cs.overflowX!=='visible'){b.gauche=Math.max(b.gauche,r.left);b.droite=Math.min(b.droite,r.right)}
    if(cs.overflowY!=='visible'){b.haut=Math.max(b.haut,r.top);b.bas=Math.min(b.bas,r.bottom)}
  }
  return b;
}

/* ===========================================================================
   LE CALENDRIER DES DEUX ÉCRANS (Charlie, 27/08/2026)
   ===========================================================================
   « le calendrier doit être le calendrier style SumUp ».

   Le calendrier natif de Chrome n'est pas réglable : ni sa langue, ni son
   dessin, ni sa semaine ne suivent la page — et sur les deux écrans du comptoir
   il ouvrait un objet gris qui n'appartenait à rien. Celui-ci prend la charte :
   un mois, sept colonnes, la semaine qui commence LUNDI, aujourd'hui cerclé, le
   jour choisi plein.

   IL VIT DANS pont.js, pas dans un écran. Les deux parcours posent une date —
   la vente directe par son champ, la demande de devis par son option « Choisir
   une date » — et deux écrans à un clic l'un de l'autre ne peuvent pas offrir
   deux calendriers différents.

   IL SE GREFFE SUR UN `input[type=date]` et le remplace : la valeur reste une
   date ISO dans le champ, `change` part comme avant. Rien de ce qui lit ces
   champs n'a besoin de le savoir.

   LE WEEK-END SE VOIT MAIS NE SE REFUSE PAS. L'atelier est fermé le samedi et
   le dimanche, et l'écran de devis le dit déjà, avec la première date possible
   et un bouton pour la prendre. Interdire ici doublerait cette règle à un
   deuxième endroit — et les deux finiraient par diverger. */
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
  let y=r.bottom+6;
  if(y+p.height>window.innerHeight-marge&&r.top-6-p.height>marge)y=r.top-6-p.height;
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
function calendrierPoser(champ){
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
document.addEventListener('keydown',(ev)=>{if(ev.key==='Escape')calFermer()});
window.addEventListener('resize',calFermer,{passive:true});

window.oldaCalendrier=calOuvrir;
window.oldaCalendrierPoser=calendrierPoser;

/* Le panneau est posé À LA MAIN, en coordonnées de fenêtre : sous le champ,
   aligné sur son bord gauche, retourné au-dessus s'il n'y a pas la place, et
   ramené à l'intérieur des bornes plutôt que débordant. Il ne rétrécit qu'en
   dernier recours — une liste de références illisible ne vaut pas mieux. */
function menuPlacer(etat){
  const {panneau,peau}=etat;
  const marge=12,b=menuBornes(peau),champ=peau.getBoundingClientRect();
  const dispo=b.droite-b.gauche-2*marge;
  const largeur=Math.max(champ.width,Math.min(560,dispo));
  panneau.style.width=Math.round(largeur)+'px';
  /* Aligné sur le champ, puis ramené dans les bornes — dans cet ordre : un
     champ collé au bord droit doit rendre un panneau collé au bord droit, pas
     un panneau qui sort. */
  let gauche=champ.left;
  if(gauche+largeur>b.droite-marge)gauche=b.droite-marge-largeur;
  if(gauche<b.gauche+marge)gauche=b.gauche+marge;
  panneau.style.left=Math.round(gauche)+'px';
  panneau.style.right='auto';
  /* Vertical : sous le champ, au-dessus si ça ne tient pas en dessous ET que
     ça tient au-dessus. La hauteur se lit APRÈS la largeur — une liste plus
     étroite est plus haute. */
  const haut=panneau.getBoundingClientRect().height;
  const dessous=b.bas-champ.bottom-marge, dessus=champ.top-b.haut-marge;
  panneau.style.bottom='auto';
  panneau.style.top=Math.round(haut>dessous&&dessus>dessous ? Math.max(b.haut+marge,champ.top-6-haut) : champ.bottom+6)+'px';
}

/* UN PANNEAU POSÉ EN COORDONNÉES DE FENÊTRE NE SUIT PAS CE QUI DÉFILE. Il
   resterait planté en place pendant que son champ s'en va. On le referme :
   c'est ce qu'attend n'importe quelle liste déroulante, et c'est sans état à
   tenir à jour. En capture, parce qu'un défilement de conteneur ne remonte
   pas jusqu'au document. */
// EN PASSIF, comme au CRM : en capture sur `window`, il voit chaque
// défilement de l'écran. Il ne peut pas annuler le geste — il n'a donc
// aucune raison de faire attendre la composition de l'image.
//
// MAIS SA PROPRE LISTE N'EST PAS « L'ÉCRAN QUI DÉFILE » (Charlie, 27/08/2026).
// En capture sur window, ce écouteur voit AUSSI le défilement de la liste du
// panneau — et il la refermait sous le doigt. Deux conséquences, toutes deux
// signalées comme « le menu bugue » :
//   · à la molette, 82 produits sur 13 familles : la liste part, le menu ferme ;
//   · à l'ouverture, menuPeindreVise() amène le choix en cours à l'écran par
//     scrollIntoView — donc dès qu'on avait choisi un article situé plus bas
//     que la fenêtre de liste, le menu se refermait AU MOMENT MÊME où il
//     s'ouvrait, et ne se rouvrait plus jamais.
// On ne referme donc que sur un défilement qui vient d'AILLEURS que le panneau.
function menuDefilementExterieur(ev){
  const cible=ev.target;
  menus.forEach(a=>{
    if(!a.ouvert)return;
    if(cible instanceof Node&&a.panneau.contains(cible))return;
    menuFermer(a,false);
  });
  /* Le calendrier, lui, n'a rien qui défile : tout défilement le laisse en
     plan, posé en coordonnées de fenêtre pendant que son champ s'en va. */
  if(calOuvert&&!(cible instanceof Node&&calOuvert.panneau.contains(cible)))calFermer();
}
window.addEventListener('scroll',menuDefilementExterieur,{capture:true,passive:true});
window.addEventListener('resize',()=>{menus.forEach(a=>menuFermer(a,false))},{passive:true});

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
  /* Une valeur choisie dans la liste n'est pas une saisie : le trait repart. */
  if(etat.libre)etat.hote.classList.remove('est-frappe');
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
  /* TOUTE DATE DE L'ÉCRAN PASSE PAR NOTRE CALENDRIER. Le natif de Chrome n'est
     réglable en rien — ni sa langue, ni son dessin, ni le jour où commence sa
     semaine — et il ouvrait un objet gris qui n'appartenait à aucun des deux
     écrans. Posé ici et pas dans chaque page : les deux parcours doivent
     donner le MÊME calendrier. */
  document.querySelectorAll('input[type="date"]').forEach(calendrierPoser);
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
  const veilleur = new MutationObserver(() => { guetterEcranFinal(); grefferLesIndicatifs(); window.menusPoserTous(); });
  // `attributeFilter` : le guet ne réagit qu'à la classe — c'est elle (`hidden`)
  // qui démasque l'écran de fin. Sans le filtre, CHAQUE changement d'attribut
  // du document (les minuteurs des écrans en produisent plusieurs par seconde)
  // rejouait les deux contrôles. `childList` reste entier : le bouton brouillon
  // et la carte de fin sont régulièrement regreffés en tant que nœuds.
  veilleur.observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
  });
  setInterval(() => { guetterEcranFinal(); grefferLesIndicatifs(); window.menusPoserTous(); }, VEILLE_MS);
  guetterEcranFinal();
  grefferLesIndicatifs();
  poserStyleMenu();
  window.menusPoserTous();
  montrerBrouillonsOublies();

  /* ─────────────────────── LA RANGÉE D'ÉTAPES ─────────────────────────────
     L'en-tête coûtait 155 px avant le premier champ : 61 px pour une barre de
     l'hôte qui ne contenait QU'UNE flèche, et 94 px pour la rangée d'étapes,
     passée à deux lignes. Les deux n'en font plus qu'une.

     LA FLÈCHE DE SORTIE EST PARTIE (Charlie, 27/08/2026 : « cette flèche
     devient inutile, supprime »). Elle avait sa raison quand le parcours
     occupait l'écran entier : c'était la seule porte. Depuis que la barre de
     navigation reste visible autour du cadre, elle en est une deuxième — et
     deux sorties à trois centimètres l'une de l'autre ne disent pas la même
     chose, elles se contredisent. Le geste « revenir d'une étape » qu'elle
     portait aussi s'en va avec elle : la rangée d'étapes dit où l'on est, elle
     n'a jamais dit qu'on pouvait y remonter.

     LA BARRE, ELLE, RESTE. Elle n'a jamais été là pour la flèche : c'est elle
     qui pose le fond, la hauteur fixe et la rangée sur UNE seule ligne, et
     c'est le seul élément à figer plutôt qu'un par écran — les deux parcours
     ne composent pas leurs étapes pareil (la demande de devis en flex, la
     vente directe en grille de quatre colonnes). */
  function grefferBarreEtapes() {
    const etapes = document.querySelector('.stepper');
    if (!etapes || etapes.parentNode.classList.contains('etapes-barre')) return;
    const barre = document.createElement('div');
    barre.className = 'etapes-barre no-print';
    etapes.parentNode.insertBefore(barre, etapes);
    barre.appendChild(etapes);
  }
  function poserStyleRangeeEtapes() {
    if (document.getElementById('styleRangeeEtapes')) return;
    const st = document.createElement('style');
    st.id = 'styleRangeeEtapes';
    /* `top: 0` : le cadre est ce qui défile (l'hôte, lui, ne bouge pas).
       Le fond est OBLIGATOIRE — sans lui le contenu défile en transparence
       derrière les pastilles. La marge haute du conteneur repasse en
       rembourrage de la rangée, sinon un blanc de 24 px reste collé au-dessus
       d'elle une fois qu'elle s'est figée. */
    st.textContent = [
      /* Elle n'a plus besoin d'être COLLANTE : elle n'est plus dans ce qui
         défile (voir plus bas). Le fond reste, il la sépare de la colonne qui
         passe dessous, et la marge basse de la rangée passe sur la barre. */
      '.etapes-barre{flex:0 0 auto;z-index:30;background:var(--bg);display:flex;',
      'align-items:center;gap:var(--pas-2);padding:var(--pas-2) 0;margin-bottom:var(--pas-3)}',
      '.etapes-barre .stepper{flex:1 1 auto;min-width:0;margin-bottom:0}',
      /* UNE SEULE RANGÉE, TOUJOURS. Sous 980 px de cadre, les pastilles se
         voyaient imposer `flex-basis: 20%` : cinq de 138 px ne tiennent pas
         dans 569, et elles tombaient sur CINQ lignes. Elles se compriment
         maintenant (`flex: 1 1 0`), et le libellé qui ne rentre plus se coupe
         proprement plutôt que de pousser la rangée. */
      '.etapes-barre .stepper{flex-wrap:nowrap}',
      '.etapes-barre .step{flex:1 1 0!important;min-width:0;white-space:nowrap;',
      'overflow:hidden;text-overflow:ellipsis;padding-left:var(--pas-1);padding-right:var(--pas-1)}',
      /* ─────────── SEULE LA COLONNE DE SAISIE DÉFILE ───────────────────────
         Coller la barre et le panier ne suffisait pas : « collant » veut dire
         que l'élément suit le défilement JUSQU'À sa marque, puis s'arrête. Il
         bouge donc quand même, sur les premiers pixels — c'est ce léger
         glissement que le patron voyait.
         On retire le défilement au DOCUMENT et on le donne à la seule colonne
         qui doit bouger. La barre et le panier ne défilent plus du tout : ils
         ne sont plus DANS ce qui défile. Plus rien à caler, plus rien à
         mesurer, et zéro pixel de glissement.
         Deux colonnes seulement : sous 981 px la mise en page s'empile, le
         panier passe au-dessus du formulaire et cette hauteur fixe n'aurait
         plus de sens — on rend alors le défilement à la page.
         Et JAMAIS À L'IMPRESSION : une hauteur d'écran y couperait le
         récapitulatif à la première page. */
      '@media screen and (min-width:981px){',
      'html,body{height:100%;overflow:hidden}',
      '.container{height:100%;display:flex;flex-direction:column;margin-top:0;margin-bottom:0;padding-bottom:0}',
      '.layout{flex:1 1 auto;min-height:0;align-items:stretch}',
      /* `min-height:0` : sans lui, un enfant de flex refuse de descendre sous
         la hauteur de son contenu et c'est la PAGE qui reprend le défilement. */
      '.layout>main{min-height:0;overflow-y:auto;padding-bottom:var(--pas-4)}',
      '.layout .sidebar{position:static;top:auto;height:100%;min-height:0;display:flex;flex-direction:column}',
      '.layout .sidebar>*{min-height:0}',
      '}',
    ].join('');
    document.head.appendChild(st);
  }
  poserStyleRangeeEtapes();
  grefferBarreEtapes();

  // L'hôte réaffiche l'écran pour un nouveau client : la base a pu bouger
  // entre-temps (un client créé depuis l'onglet Base clients).
  window.oldaRafraichirClients = () => chargerClients().catch(raterEnSilence('base clients indisponible'));

  // EST-CE QUE QUELQU'UN A TAPÉ QUELQUE CHOSE ICI ?
  // L'hôte recharge le parcours à chaque « Nouveau Projet » — c'est la règle du
  // comptoir : le client suivant ne trouve jamais le formulaire du précédent.
  // Mais recharger un écran ENCORE VIERGE, c'est 120 Ko de document ré-analysé
  // et un écran qui blanchit pour revenir exactement au même endroit. C'est ce
  // que Charlie a vu le 27/08/2026 : « toute la page recharge, c'est bizarre
  // comme effet ».
  // On répond donc à la seule question qui décide : y a-t-il quelque chose à
  // jeter ? Le drapeau se lève à la PREMIÈRE frappe et ne redescend jamais —
  // en cas de doute (fonction absente, cadre pas encore chargé), l'hôte
  // recharge : c'est le côté sûr.
  let saisieCommencee = false;
  const marquerSaisie = () => { saisieCommencee = true; };
  document.addEventListener('input', marquerSaisie, true);
  document.addEventListener('change', marquerSaisie, true);
  window.oldaParcoursVierge = () => !saisieCommencee && !ecranFinal();

  // L'écran ne parle jamais au serveur lui-même : il appelle ceci s'il existe,
  // et continue de tourner seul s'il n'existe pas (fichier ouvert sans pont).
  window.oldaEnregistrerClient = enregistrerClient;

  /* Ouvre un menu déroulant sans clic : l'étape 5 arrive avec sa liste de
     clients déjà dépliée, il n'y a plus qu'à choisir. */
  window.oldaOuvrirMenu = (hote) => {
    const el = typeof hote === 'string' ? document.getElementById(hote) : hote;
    if (!el) return;
    window.menusPoserTous();
    const etat = menus.get(el);
    if (etat) menuOuvrir(etat);
  };
})();

/* ===========================================================================
   LES FACES D'UN ARTICLE — LA VENDEUSE ÉCRIT DESSUS (26/08/2026)
   ===========================================================================
   Charlie : « une tasse y'a 2 faces et le cul de la tasse, ce qui fait
   3 faces » — puis « du mug au couteau à graver, une carte adaptée à chaque
   article ».

   Un objet n'a pas de TAILLES, il a des EMPLACEMENTS. Jusqu'ici la vendeuse
   décrivait ses zones dans le pavé « Informations importantes », et l'atelier
   lisait un paragraphe au lieu d'une carte — c'est le fond qu'on oublie, et un
   fond oublié c'est une tasse à refaire.

   LES FACES VIENNENT DU TABLEAU DES TAILLES DE LOGO, pas d'ici. Chaque famille
   y déclare les siennes (Réglages → Tailles de logo) : c'est déjà là que vit
   « un tote bag a deux faces, une casquette une seule ». Une famille créée
   demain marchera donc au comptoir le jour où elle est créée, sans qu'on
   revienne dans ce fichier — et une famille sans faces n'affiche rien, ce qui
   est exactement le comportement d'avant.

   PAS DE MILLIMÈTRES ICI. Au comptoir on sait QUOI marquer, pas COMBIEN de mm —
   c'est l'atelier qui mesure, et le ticket sort déjà un trait pour l'écrire.
   Demander une largeur au comptoir, c'est obtenir un chiffre inventé.
   ======================================================================== */

/* La clé d'une face : son nom réduit, sans accent ni article. Elle ne sert qu'à
   deux choses — retrouver une valeur déjà saisie quand le tableau a été
   retouché entre-temps, et donner sa forme au dessin (le fond est un disque).
   Ce n'est JAMAIS elle qui part en production : c'est le nom, tel qu'il est
   écrit dans le tableau, que l'atelier lira sur le papier. */
function cleDeFace(nom) {
  return String(nom == null ? '' : nom).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^(face|cote|coté)\s+/, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* LA SEULE FAMILLE DESSINÉE. Le dessin de la tasse (deux parois, une anse, un
   disque) se reconnaît sans être lu, et c'est ce qui empêche d'écrire au
   mauvais endroit. Les autres familles prennent la grille nue, qui suffit.
   Comparaison sur le nom réduit : « Tasses céramique 350 ml » marche aussi. */
const FACES_DESSIN = { 'tasse-ceramique-350-ml': 'tasse' };
function dessinDeFamille(famille) {
  // Le nom réduit MOT À MOT, pluriel compris : le tableau des tailles de logo
  // et le catalogue ne se sont jamais mis d'accord sur les pluriels
  // (« Pochette » / « Pochettes »), et l'atelier écrit les deux.
  const cle = String(famille == null ? '' : famille).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(Boolean)
    .map((mot) => mot.replace(/s$/, ''))
    .join('-');
  return FACES_DESSIN[cle] || '';
}

/* Ce qui se lit en filigrane dans une face vide. Un texte d'aide par NOM de
   face quand on en connaît un, sinon la même invitation pour toutes : ce qu'on
   attend est le contenu à marquer, jamais une dimension. */
const FACES_AIDE = {
  avant: 'Logo, texte, photo…',
  arriere: 'Rien si vierge',
  dessous: 'Souvent le logo OLDA',
  fond: 'Souvent le logo OLDA',
};
/* LE MEME COTE SOUS DEUX NOMS. « Fond » s'est appele « Dessous » le 29/08 —
   c'est le mot de l'atelier. Les dossiers deja ecrits portent l'ancien nom et le
   gardent ; c'est ici qu'on sait que les deux designent la meme piece, pour que
   le disque se dessine et que ce qui etait ecrit dessus se retrouve. */
const FACE_ALIAS = { dessous: 'fond', fond: 'dessous' };
const FACES_AIDE_DEFAUT = 'Ce qu’on marque ici';

/* Pose les faces dans `hote` et renvoie de quoi les relire.
   `faces`   : les noms déclarés par la famille — ['Face avant', 'Fond', …].
   `valeurs` : ce qui était déjà saisi, par nom de face.
   `auChangement` : appelé à chaque frappe avec l'objet complet.
   `dessin`  : '' ou 'tasse'. */
function facesArticle(hote, faces, valeurs, auChangement, dessin) {
  const noms = (Array.isArray(faces) ? faces : [])
    .map((f) => String(f == null ? '' : f).trim()).filter(Boolean);
  const etat = {};
  /* On reprend une valeur par son NOM, et à défaut par sa clé : renommer
     « Fond » en « Dessous » dans le tableau ne doit pas effacer ce que la
     vendeuse venait d'écrire dessus. */
  const parCle = {};
  for (const [k, v] of Object.entries(valeurs || {})) parCle[cleDeFace(k)] = v;
  for (const nom of noms) {
    const v = (valeurs || {})[nom];
    const cle = cleDeFace(nom);
    /* … et a defaut par son ALIAS : une tasse dont le dessous portait « Fond »
       garde ce qui y etait ecrit quand le tableau dit maintenant « Dessous ».
       Sans ca, le renommage effacait la mention a la premiere reouverture. */
    const repli = parCle[cle] === undefined ? parCle[FACE_ALIAS[cle]] : parCle[cle];
    etat[nom] = String((v === undefined ? repli : v) || '');
  }

  const boite = document.createElement('div');
  boite.className = 'faces' + (dessin ? ' faces--' + dessin : '');

  for (const nom of noms) {
    const cle = cleDeFace(nom);
    const face = document.createElement('div');
    face.className = 'faces__face faces__face--' + (cle || 'x');

    const etiquette = document.createElement('label');
    etiquette.className = 'faces__nom';
    etiquette.textContent = nom;

    const zone = document.createElement('textarea');
    zone.className = 'faces__zone';
    zone.value = etat[nom];
    zone.placeholder = FACES_AIDE[cle] || FACES_AIDE_DEFAUT;
    /* La vendeuse est à la SOURIS pour naviguer et au CLAVIER pour écrire
       (Charlie, 26/08). Donc : rien à intercepter. Un textarea nu garde le
       copier/coller, le Ctrl+A, la sélection et l'annulation du navigateur —
       tout ce qu'elle utilise réellement. Poser un raccourci ici, c'est en
       casser un qu'elle connaît déjà. */
    zone.addEventListener('input', () => {
      etat[nom] = zone.value;
      if (auChangement) auChangement({ ...etat });
    });

    const id = 'face-' + (cle || 'x') + '-' + Math.random().toString(36).slice(2, 8);
    zone.id = id;
    etiquette.setAttribute('for', id);

    face.append(etiquette, zone);
    /* L'anse ne se pose que sur la face avant d'une tasse : c'est elle qui dit
       de quel côté on regarde. */
    if (dessin === 'tasse' && cle === 'avant') {
      const anse = document.createElement('span');
      anse.className = 'faces__anse';
      anse.setAttribute('aria-hidden', 'true');
      face.appendChild(anse);
    }
    boite.appendChild(face);
  }

  /* UNE BASCULE = UN MOUVEMENT : on ne vide jamais un conteneur avant d'avoir
     de quoi le remplacer. Le contenu sortant reste jusqu'à ce que le nouveau
     soit prêt — d'où la construction complète AVANT la pose. */
  hote.replaceChildren(boite);
  return { lire: () => ({ ...etat }) };
}

/* CE QUE LES FACES DONNENT À LA FICHE DE PRODUCTION. Chaque face écrite devient
   une ZONE du ticket — même sans mesure : le papier sort alors un trait pour
   l'écrire à l'établi. Une face laissée vide n'est pas une zone : on ne marque
   rien dessus, et une carte vide sur le papier finit par être remplie de
   n'importe quoi. */
function zonesDepuisFaces(faces, valeurs) {
  const v = valeurs || {};
  return (Array.isArray(faces) ? faces : [])
    .map((f) => String(f == null ? '' : f).trim())
    .filter((nom) => nom && String(v[nom] || '').trim())
    .map((nom) => ({ face: nom, mm: '', quoi: String(v[nom]).trim() }));
}

/* Et le chemin inverse, pour rouvrir un article déjà saisi : une ligne relue
   doit se relire à l'identique, y compris ses faces. */
function valeursDepuisZones(zones) {
  const out = {};
  for (const z of Array.isArray(zones) ? zones : []) {
    if (z && z.face) out[String(z.face)] = String(z.quoi || '');
  }
  return out;
}

window.facesArticle = facesArticle;
window.zonesDepuisFaces = zonesDepuisFaces;
window.valeursDepuisZones = valeursDepuisZones;
window.dessinDeFamille = dessinDeFamille;
window.cleDeFace = cleDeFace;
