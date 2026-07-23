// ===========================================================================
// Moteur de priorité — « Sur quoi passer en premier ? »
// ===========================================================================
// Fonction PURE, sans DOM ni horloge implicite (on injecte `now` en ms) : le
// dashboard s'en sert pour classer la file « À faire maintenant », et le test
// test/priority.test.js la rejoue à l'identique.
//
// Idée : un score additif TRANSPARENT. Chaque signal est ramené entre 0 et 1,
// pondéré, et la somme classe la commande. Le « pourquoi » de chaque ligne est
// dérivé des signaux les plus forts. Rien de magique, tout est explicable.
//
//   score = 0.5·échéance + 0.2·priorité + 0.2·machine + 0.1·stagnation
//
// Les leviers du patron : les ÉTOILES (priorité, par commande) et l'IMPORTANCE
// d'une MACHINE (réglages) — une machine « goulot » pousse ses commandes en tête.

// Pondération par défaut : l'échéance domine, la stagnation n'est qu'un rappel.
export const DEFAULT_WEIGHTS = { deadline: 0.5, priority: 0.2, machine: 0.2, stagnation: 0.1 };

// Au-delà de cet horizon, l'échéance ne pèse plus (une commande à 3 semaines
// n'est pas « à faire maintenant »).
export const DEADLINE_HORIZON_DAYS = 14;
// Une commande figée depuis ce nombre de jours atteint le poids de stagnation max.
export const STAGNATION_CAP_DAYS = 7;
// Importance « neutre » d'une machine (échelle 1..5) : au-dessus = coup de pouce.
export const NEUTRAL_IMPORTANCE = 3;

// Familles hors du « à faire maintenant » : rien à pousser (fin de flux / hors flux).
export const INACTIVE_STAGES = new Set(['termine', 'archive', 'fiverr']);

// Sous-étape de PRODUCTION → machine (signal le plus sûr : on est déjà au poste).
export const SUBSTAGE_MACHINE = {
  prod_dtf: 'dtf',
  prod_pressage: 'presse',
  prod_trotec: 'trotec',
  prod_uv: 'uv',
};

// Technique de la fiche (prise de commande) → machine, AVANT la production, pour
// que l'importance d'une machine goulot compte dès le chiffrage / la prépa.
export const TECHNIQUE_MACHINE = {
  dtf: 'dtf',
  uv: 'uv',
  laser: 'trotec',
  sublimation: 'presse',
  serigraphie: 'presse',
  flex: 'presse',
  // broderie : pas de poste dédié dans le registre v1 → aucune machine.
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Machine d'une commande : la sous-étape de production fait foi ; sinon on tente
// la technique de la fiche « commande-atelier » ; sinon rien (poids neutre).
export function machineOf(r) {
  if (!r) return null;
  if (SUBSTAGE_MACHINE[r.sub_stage]) return SUBSTAGE_MACHINE[r.sub_stage];
  const fiche = r.fiche;
  if (fiche && Array.isArray(fiche.articles)) {
    for (const a of fiche.articles) {
      for (const z of (a && a.zones) || []) {
        if (z && TECHNIQUE_MACHINE[z.technique]) return TECHNIQUE_MACHINE[z.technique];
      }
    }
  }
  return null;
}

// Jours pleins d'ici l'échéance depuis `now` (ms). On lit la date civile LOCALE
// de `now` (comme app.js) et on compare deux minuits UTC : pas d'heure, pas de
// dérive de fuseau. On accepte la date EN TÊTE quel que soit le suffixe : le
// vrai Postgres rend « aaaa-mm-jj », mais pg-mem (local) rend un ISO complet
// « aaaa-mm-jjT00:00:00.000Z ». null si pas de date exploitable.
export function daysUntil(deadline, now) {
  if (typeof deadline !== 'string') return null;
  const m = deadline.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const n = new Date(now);
  const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(target)) return null;
  return Math.round((target - today) / 86400000);
}

// Âge en jours depuis un horodatage ISO (updated_at) ; 0 si illisible.
export function ageDays(ts, now) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

// Score d'une commande + le détail des contributions (pour le « pourquoi »).
// ctx = { now, machines: Map(slug → machine), weights }.
export function scoreRequest(r, ctx) {
  const w = ctx.weights || DEFAULT_WEIGHTS;

  const d = daysUntil(r.deadline, ctx.now);
  // Échéance : max en retard ou aujourd'hui, décroît jusqu'à l'horizon, puis 0.
  const fDeadline = d === null
    ? 0
    : d <= 0
      ? 1
      : Math.max(0, ((DEADLINE_HORIZON_DAYS - d) / DEADLINE_HORIZON_DAYS) * 0.9);

  const prio = [1, 2, 3].includes(r.priority) ? r.priority : 1;
  const fPriority = (prio - 1) / 2;

  const slug = machineOf(r);
  const machine = slug && ctx.machines ? ctx.machines.get(slug) : null;
  const importance = machine && Number.isFinite(machine.importance) ? machine.importance : null;
  // Importance NEUTRE (3) = aucun effet ; seul un réglage AU-DESSUS de 3 pousse
  // la commande (4 → +½, 5 → +max). En dessous, pas de pénalité, juste zéro.
  const fMachine = importance === null ? 0 : clamp01((importance - NEUTRAL_IMPORTANCE) / (5 - NEUTRAL_IMPORTANCE));

  const age = ageDays(r.updated_at, ctx.now);
  const fStagnation = clamp01(age / STAGNATION_CAP_DAYS);

  const parts = {
    deadline: w.deadline * fDeadline,
    priority: w.priority * fPriority,
    machine: w.machine * fMachine,
    stagnation: w.stagnation * fStagnation,
  };
  const score = parts.deadline + parts.priority + parts.machine + parts.stagnation;

  return {
    score, parts, d, prio, age,
    machineSlug: slug,
    machineName: machine ? machine.name : null,
    importance,
  };
}

// « Pourquoi » lisible : l'échéance en tête (le motif le plus parlant le matin),
// puis les 1-2 signaux les plus forts. Au plus 2 lignes.
export function reasonsFor(s) {
  const out = [];
  if (s.d !== null && s.d < 0) out.push(`En retard de ${-s.d} j`);
  else if (s.d === 0) out.push('Échéance aujourd’hui');
  else if (s.d === 1) out.push('Échéance demain');
  else if (s.d !== null && s.d <= 3) out.push(`Échéance dans ${s.d} j`);

  const extra = [];
  if (s.importance !== null && s.importance > NEUTRAL_IMPORTANCE && s.machineName) {
    extra.push({ t: `Passe par ${s.machineName} (priorité atelier)`, w: s.parts.machine });
  }
  if (s.prio === 3) extra.push({ t: 'Priorité haute (3★)', w: s.parts.priority });
  if (s.age >= STAGNATION_CAP_DAYS) extra.push({ t: `Sans mouvement depuis ${s.age} j`, w: s.parts.stagnation });
  extra.sort((a, b) => b.w - a.w);

  for (const e of extra) {
    if (out.length >= 2) break;
    out.push(e.t);
  }
  if (!out.length && s.machineName) out.push(`Sur ${s.machineName}`);
  return out;
}

// Classe le planning en trois seaux :
//   queue   : « à faire maintenant », classée (objets { r, score, reasons, meta })
//   blocked : « à débloquer » (alerte BLOQUÉE), du plus figé au plus récent
//   waiting : « à relancer » (attente client), idem
export function rankRequests(rows, machinesList, opts) {
  const o = opts || {};
  const now = o.now;
  const weights = o.weights || DEFAULT_WEIGHTS;
  const machines = machinesList instanceof Map
    ? machinesList
    : new Map((machinesList || []).map((m) => [m.slug, m]));

  const queue = [];
  const blocked = [];
  const waiting = [];

  for (const r of rows || []) {
    if (!r || INACTIVE_STAGES.has(r.stage)) continue;
    if (r.flag === 'bloque') { blocked.push(r); continue; }
    if (r.stage === 'attente_client') { waiting.push(r); continue; }
    const meta = scoreRequest(r, { now, machines, weights });
    queue.push({ r, score: meta.score, reasons: reasonsFor(meta), meta });
  }

  queue.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Départage : échéance la plus proche (null en dernier), puis priorité, puis ancienneté.
    const da = a.meta.d;
    const db = b.meta.d;
    if (da === null && db !== null) return 1;
    if (db === null && da !== null) return -1;
    if (da !== null && db !== null && da !== db) return da - db;
    if (a.meta.prio !== b.meta.prio) return b.meta.prio - a.meta.prio;
    return String(a.r.created_at).localeCompare(String(b.r.created_at));
  });

  const byStuck = (x, y) => ageDays(y.updated_at, now) - ageDays(x.updated_at, now);
  blocked.sort(byStuck);
  waiting.sort(byStuck);

  return { queue, blocked, waiting };
}
