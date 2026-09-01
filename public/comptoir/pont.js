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

  // --- 0. LE NOM DU CLIENT EN CAPITALES -------------------------------------
  // Règle unique de l'application : un nom de client SE LIT en capitales — un
  // particulier comme un restaurant — et c'est l'affichage qui change, jamais
  // la valeur. Elle vit dans
  // `public/nom-client.js` — le même module que la colonne « Client » du
  // planning, la fiche client et les deux papiers.
  //
  // `pont.js` est un script CLASSIQUE (les deux écrans le chargent en
  // `<script src>`) : il ne peut pas l'importer en tête de fichier, il le
  // charge donc à la demande. Aucune course : les fiches n'arrivent qu'après
  // `chargerClients()`, qui attend cette promesse avant de peindre quoi que ce
  // soit. Si le module ne vient pas, les écrans affichent le nom SAISI — un
  // comptoir qui tourne compte plus qu'une capitale.
  let NOM_AFFICHE = null;
  const reglePrete = import('../nom-client.js')
    .then((m) => { NOM_AFFICHE = m.nomClientAffiche; })
    .catch(() => { NOM_AFFICHE = null; });

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
      // `name` reste LA VALEUR, mot pour mot ce qui est en base : c'est elle
      // que le formulaire de correction reprend, elle qui repart en `PATCH`, et
      // elle qui part au planning comme nom du dossier. La mettre en capitales
      // ici, c'était transformer À L'ÉCRITURE.
      name: c.entreprise || '',
      // Ce que les écrans AFFICHENT — jamais ce qu'ils enregistrent.
      nomAffiche: NOM_AFFICHE ? NOM_AFFICHE(c.entreprise || '', c.client_type) : (c.entreprise || ''),
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
    // La règle d'affichage AVANT la première peinture : sinon la liste
    // s'afficherait une fois en minuscules, puis sauterait en capitales au
    // rafraîchissement suivant.
    await reglePrete;
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


/* ===========================================================================
   LE CALENDRIER A DEMENAGE (30/08/2026)
   ===========================================================================
   Il vivait ICI depuis le 27/08 — dessin, feuille et greffe — parce que pont.js
   etait alors le seul fichier que les DEUX ecrans du comptoir lisent. Charlie
   en a demande un troisieme le 30/08, sur le champ « Retrait » de la fiche du
   CRM : « le meme que l'autre ». Le recopier la-bas aurait donne deux
   calendriers qui se ressemblent, et qui divergent au premier correctif.
   Il est donc dans `../calendrier.js`, comme `modale.js` avant lui.

   CHARGE A LA DEMANDE, parce que pont.js n'est PAS un module : un script
   classique ne peut pas ecrire `import` en tete, mais il peut appeler
   `import()`. Le temps que le module arrive, les champs de date deja greffes
   attendent dans une file — personne ne clique une date dans les dix
   millisecondes qui suivent l'ouverture de l'ecran, et rien ne se perd si ca
   arrive.
   SI LE MODULE NE VIENT PAS, `window.oldaCalendrier` reste vide : l'ecran de
   devis retombe alors sur `showPicker()`, son repli d'origine. */
let calendrierModule=null;
const datesEnAttente=[];
function calendrierPoser(champ){
  if(!champ)return;
  if(calendrierModule){calendrierModule.calendrierPoser(champ);return}
  datesEnAttente.push(champ);
}
import('../calendrier.js').then((mod)=>{
  calendrierModule=mod;
  window.oldaCalendrier=mod.calendrierOuvrir;
  window.oldaCalendrierPoser=mod.calendrierPoser;
  datesEnAttente.splice(0).forEach(mod.calendrierPoser);
}).catch(()=>{});


  // ---- LES MENUS DÉROULANTS : ILS ONT DÉMÉNAGÉ (01/09/2026) ---------------
  // Ils vivaient ICI, 920 lignes, parce que pont.js était alors le seul fichier
  // que les DEUX écrans du comptoir lisent. Charlie en a demandé un troisième le
  // 01/09, sur le champ « Désignation » d'un article du devis : « ce input doit
  // avoir OBLIGATOIREMENT une fonction recherche COMME TOUS LES INPUTS avec un
  // menu déroulant ». Les recopier là-bas aurait donné deux menus qui se
  // ressemblent, et qui divergent au premier correctif.
  //
  // Ils sont donc dans `../menu-recherche.js`, comme `calendrier.js` avant eux,
  // et pour la même raison — le CRM ne lit pas ce fichier-ci.
  //
  // CHARGÉ À LA DEMANDE, parce que pont.js n'est PAS un module : un script
  // classique ne peut pas écrire `import` en tête, mais il peut appeler
  // `import()`. Le temps que le module arrive, les appels de l'écran ne se
  // perdent pas — ils reposent tous les menus, et reposer un menu déjà posé ne
  // fait rien.
  let menuModule = null;
  const menuAuRetour = [];
  const quandMenus = (faire) => { if (menuModule) faire(menuModule); else menuAuRetour.push(faire); };

  // LES TROIS NOMS QUE LES DEUX ÉCRANS APPELLENT restent sur `window`, à
  // l'identique : ils sont écrits dans leurs `onchange`, et un écran du patron
  // se remplace en entier — il ne doit rien avoir à apprendre.
  //
  // ⚠ ET ILS RENDENT LA MAIN TOUT DE SUITE, module ou pas. `menusPoserTous` est
  // appelé par un MutationObserver qui tourne plusieurs fois par seconde : le
  // faire attendre bloquerait le guet de l'écran de fin, donc l'envoi du
  // dossier.
  window.menusPoserTous = function menusPoserTous() {
    quandMenus((m) => m.menusPoserTous());
    // LE CALENDRIER N'EST PAS UN MENU, et il ne l'a jamais été : il reste ici,
    // posé au même moment qu'avant. Les deux parcours doivent donner le MÊME
    // calendrier — le natif de Chrome n'est réglable en rien.
    document.querySelectorAll('input[type="date"]').forEach(calendrierPoser);
  };
  window.menuRafraichir = function menuRafraichir(hote) {
    quandMenus((m) => m.menuRafraichir(hote));
  };
  window.menusRafraichirTous = function menusRafraichirTous() {
    quandMenus((m) => m.menusRafraichirTous());
  };

  import('../menu-recherche.js').then((mod) => {
    menuModule = mod;
    mod.poserStyleMenu();
    mod.menusPoserTous();
    menuAuRetour.splice(0).forEach((faire) => faire(mod));
  }).catch(() => {
    // SI LE MODULE NE VIENT PAS, les <select> natifs restent en place et
    // fonctionnent : l'écran est moins beau, il n'est pas en panne.
  });

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
    /* La colonne a qui l'on confie le defilement. Les deux parcours ne sont pas
       batis pareil : la demande de devis a `.layout > main`, la vente directe
       empile ses cartes dans `.container`. Le bloc du bas ne s'ecrit que si
       cette colonne existe (voir sa note). */
    const colonneQuiDefile = !!document.querySelector('.layout > main');
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
      /* ⚠ ET SEULEMENT SUR UN ECRAN QUI A CETTE COLONNE. On RETIRE le
         defilement au document : il faut donc qu'un element le reprenne, sinon
         la page est simplement coupee a la hauteur de la fenetre.
         C'est ce qui arrivait a la VENTE DIRECTE, qui n'a ni `.layout` ni
         `<main>` — ses cartes sont posees a la suite dans `.container`. A
         1366 x 700, mesure : `.container` demandait 1665 px dans 700, et
         « Ajouter l'article » tombait 147 px SOUS le bas de l'ecran, hors
         d'atteinte — la molette ne faisait rien, `html` et `body` etant en
         `overflow:hidden`. La vendeuse ne pouvait pas ajouter un article.
         La regle est donc conditionnee a la presence de la colonne qui doit
         defiler ; sans elle, la page garde son defilement normal, comme avant
         que ce bloc existe. */
      colonneQuiDefile ? [
        '@media screen and (min-width:981px){',
        'html,body{height:100%;overflow:hidden}',
        /* LA MARGE DU HAUT RESTE — elle seule aligne les deux parcours. Ce bloc
           ne s'ecrit que sur la demande de devis (elle seule a la colonne), donc
           un margin-top a zero ici ne montait QUE sa rangee d'etapes : mesure du
           30/08, la bulle « 1. Besoins » a 10 px et « 1. Articles » a 34 px.
           On deduit donc la marge de la hauteur au lieu de la supprimer, sinon
           le cadre depasse d'autant et overflow hidden rogne le bas de la
           colonne. */
        '.container{height:calc(100% - var(--pas-4));display:flex;flex-direction:column;margin-bottom:0;padding-bottom:0}',
        '.layout{flex:1 1 auto;min-height:0;align-items:stretch}',
        /* `min-height:0` : sans lui, un enfant de flex refuse de descendre sous
           la hauteur de son contenu et c'est la PAGE qui reprend le défilement. */
        '.layout>main{min-height:0;overflow-y:auto;padding-bottom:var(--pas-4)}',
        '.layout .sidebar{position:static;top:auto;height:100%;min-height:0;display:flex;flex-direction:column}',
        '.layout .sidebar>*{min-height:0}',
        '}',
      ].join('') : '',
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

  // LE MINUTEUR EST PARTAGÉ, PAS RECOPIÉ. Les greffes posées à la suite de ce
  // fichier (le catalogue de la vente directe) sont hors de cette fermeture et
  // ne peuvent pas le voir. Une deuxième écriture, c'est un jour où l'une des
  // deux garde 15 secondes et l'autre 30 — et un fetch sans minuteur reste
  // suspendu pour la journée.
  window.oldaFetchMinute = fetchMinute;

  /* Ouvre un menu déroulant sans clic : l'étape 5 arrive avec sa liste de
     clients déjà dépliée, il n'y a plus qu'à choisir. */
  window.oldaOuvrirMenu = (hote) => {
    const el = typeof hote === 'string' ? document.getElementById(hote) : hote;
    if (!el) return;
    window.menusPoserTous();
    quandMenus((m) => m.menuOuvrirDe(el));
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

/* ===========================================================================
   LE CATALOGUE DE LA VENTE DIRECTE (01/09/2026)
   ===========================================================================
   Charlie : « vente, devis et devis flash doivent avoir exactement la meme
   base de donnees de produit ».

   Cet ecran n'en avait AUCUNE. Son champ « Article » proposait sept intitules
   ecrits en dur dans la page — « Tee-shirt personnalise », « Tasse
   personnalisee »… — qui ne correspondaient a aucun produit reel, ne portaient
   ni reference ni prix, et ne pouvaient pas bouger sans redeploiement. Pendant
   ce temps le meme article existait en base, tarife par import, et les deux
   autres ecrans le lisaient.

   Les sept intitules sont donc REMPLACES par le catalogue — et remplaces, pas
   completes : les garder ferait deux bases dans un seul menu, et c'est
   exactement ce qu'on vient de defaire.

   CE QUI SE GREFFE ICI ET NULLE PART AILLEURS. L'ecran vient du patron : une
   nouvelle version de sa part se pose en remplacant le fichier. Tout ce qu'on
   lui ajoute vit dans ce pont — sinon la greffe part avec le fichier remplace.

   LE PRIX NE S'IMPOSE PAS. Il se pose dans « Prix article » SEULEMENT si la
   case est vide : la vente directe est une vente au comptoir, ou l'on remise,
   ou l'on arrondit, et un prix de rayon qui ecraserait un prix negocie serait
   une remise perdue a chaque fois.

   UN TEXTILE N'A PAS DE PRIX DE RAYON, et c'est voulu : il se chiffre a la
   quantite et au marquage (voir la famille « Textile » de la base). Il est bien
   dans la liste — c'est la meme base — mais il arrive sans prix, et la vendeuse
   le pose. Le devis flash, lui, sait le chiffrer : c'est la qu'on va pour un
   marquage.
   =========================================================================== */
(function () {
  const liste = document.getElementById('productsList');
  const champ = document.getElementById('productName');
  const prix = document.getElementById('articlePrice');
  if (!liste || !champ) return;   /* pas cet ecran : le pont sert les deux */

  /* Le meme repli que le menu du comptoir, et la MEME cle : la vente directe ne
     charge pas `catalogue.js`, mais les deux ecrans tournent sur le meme poste
     et le dernier catalogue lu vaut pour les deux. Un wifi qui decroche ne doit
     pas rendre un menu vide a une vendeuse qui a le client devant elle. */
  const CLE_REPLI = 'olda.catalogue';
  const parNom = new Map();

  /* L'intitule qu'on INSERE dans le champ : c'est lui qui partira sur le ticket
     et au planning. La reference et le prix vont dans le `label` de l'option —
     ils aident a choisir, ils n'ont rien a faire dans le nom de l'article. */
  const nomArticle = (p) => [p.label || p.designation, p.variante].filter(Boolean).join(' — ');

  function poser(lignes) {
    const produits = (Array.isArray(lignes) ? lignes : []).filter((p) => p && p.actif !== false && p.designation);
    if (!produits.length) return false;
    parNom.clear();
    const frag = document.createDocumentFragment();
    for (const p of produits) {
      const nom = nomArticle(p);
      if (!nom || parNom.has(nom)) continue;
      parNom.set(nom, p);
      const o = document.createElement('option');
      o.value = nom;
      /* CE QUE LE COMPOSANT SAIT FAIRE D'UNE OPTION (menu-recherche.js) :
         `data-ref` se pose en JETON en tete de ligne, `data-cherche` se cherche
         SANS s'afficher. Sans lui, taper « NS300 » ne trouvait rien : la
         recherche ne voit que ce qui est ecrit dans la ligne, et la reference
         n'y est pas. `label` reste pour le repli : si le module ne vient pas,
         c'est la liste native de Chrome qui s'ouvre, et elle le lit. */
      if (p.reference) o.dataset.ref = p.reference;
      o.dataset.cherche = [p.famille, p.reference || '', p.designation, p.variante || ''].filter(Boolean).join(' ');
      o.dataset.onglet = p.famille === 'Textile' ? 'Textile' : 'Boutique';
      const aide = [p.famille, p.reference || '', p.prixVenteTtc != null ? `${p.prixVenteTtc} EUR TTC` : '']
        .filter(Boolean).join(' · ');
      if (aide) o.label = aide;
      frag.appendChild(o);
    }
    liste.replaceChildren(frag);
    return true;
  }

  /* LE PRIX SUIT LE CHOIX, JAMAIS L'INVERSE. On ecrit dans « Prix article »
     seulement si la case est vide, et on previent l'ecran par un evenement
     `input` : ses propres ecouteurs (total, controles) tournent alors comme si
     la vendeuse avait tape. */
  function poserPrix() {
    if (!prix || String(prix.value).trim() !== '') return;
    const p = parNom.get(String(champ.value).trim());
    if (!p || p.prixVenteTtc == null) return;
    prix.value = String(p.prixVenteTtc);
    prix.dispatchEvent(new Event('input', { bubbles: true }));
  }
  champ.addEventListener('change', poserPrix);
  champ.addEventListener('input', poserPrix);

  try {
    const brut = localStorage.getItem(CLE_REPLI);
    if (brut) poser(JSON.parse(brut));
  } catch (_) { /* stockage refuse, ou contenu illisible : la base repondra */ }

  /* Le minuteur du pont, pas un `fetch` nu : une reponse qui ne vient jamais
     laisserait le menu sur son repli sans que rien ne le dise. */
  const appel = window.oldaFetchMinute
    || ((url, o) => fetch(url, { ...o, signal: AbortSignal.timeout(15000) }));
  appel('/api/catalogue-produits', { headers: { Accept: 'application/json' } })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((lignes) => {
      if (!poser(lignes)) return;
      try { localStorage.setItem(CLE_REPLI, JSON.stringify(lignes)); } catch (_) { /* stockage refuse */ }
    })
    /* ON GARDE CE QU'ON A. Une reponse ratee ne doit pas vider le menu sous les
       doigts : les sept intitules du patron, ou le dernier catalogue lu,
       restent en place. */
    .catch((err) => { console.error('Catalogue produits injoignable :', err.message); });
})();
