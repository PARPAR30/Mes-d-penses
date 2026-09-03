/* ============================================================
   Mon Budget — logique de l'application
   Tout est stocké dans le localStorage de cet appareil.
   Les montants sont manipulés en centimes (entiers) pour
   éviter les erreurs d'arrondi des nombres à virgule.
   ============================================================ */

const STORE_KEY = "mon-budget/v1";
const APP_VERSION = "1.8.1";

/* Palette des enveloppes, dans un ordre fixe : une nouvelle enveloppe
   prend la teinte suivante, jamais une couleur tirée au hasard.
   Les sept valeurs sont vérifiées pour rester distinguables en
   protanopie et en deutéranopie, et lisibles sur fond clair comme
   sur fond sombre — d'où des teintes un peu rabattues (l'ambre et la
   tomate d'origine passaient sous le seuil de contraste). */
const COLORS = [
  "#3F6DE0", "#E4634A", "#23A26D", "#7B57D6",
  "#B8820A", "#D6497E", "#1B9AAA",
];

const DEFAULT_ENVELOPES = [
  { nom: "Logement", couleur: "#3F6DE0", budget: 80000 },
  { nom: "Courses", couleur: "#E4634A", budget: 40000 },
  { nom: "Transports", couleur: "#23A26D", budget: 15000 },
  { nom: "Sorties", couleur: "#7B57D6", budget: 20000 },
  { nom: "Abonnements", couleur: "#B8820A", budget: 6000 },
];

/* Au-delà de six parts, la queue est repliée dans « Autres » : ajouter
   des couleurs les rendrait indistinguables les unes des autres. */
const MAX_SEGMENTS = 6;

/* Modèles pour les dépenses et revenus récurrents : une pastille couleur
   de marque + initiale, PAS les logos officiels — ce sont des marques
   déposées qu'on ne reproduit pas. Le nom en toutes lettres, toujours
   affiché juste à côté, porte l'identification réelle. */
const ICON_PRESETS = [
  { id: "netflix", nom: "Netflix", mono: "N", couleur: "#E50914", type: "depense" },
  { id: "disneyplus", nom: "Disney+", mono: "D+", couleur: "#113CCF", type: "depense" },
  { id: "spotify", nom: "Spotify", mono: "S", couleur: "#1DB954", type: "depense" },
  { id: "appletv", nom: "Apple TV+", mono: "TV", couleur: "#1D1D1F", type: "depense" },
  { id: "applemusic", nom: "Apple Musique", mono: "M", couleur: "#FA243C", type: "depense" },
  { id: "icloud", nom: "iCloud+", mono: "iC", couleur: "#3693F3", type: "depense" },
  { id: "amazonprime", nom: "Amazon Prime", mono: "P", couleur: "#FF9900", type: "depense" },
  { id: "youtube", nom: "YouTube Premium", mono: "YT", couleur: "#FF0000", type: "depense" },
  { id: "deezer", nom: "Deezer", mono: "D", couleur: "#A238FF", type: "depense" },
  { id: "canalplus", nom: "Canal+", mono: "C+", couleur: "#000000", type: "depense" },
  { id: "free", nom: "Free", mono: "F", couleur: "#CE0F17", type: "depense" },
  { id: "orange", nom: "Orange", mono: "O", couleur: "#FF7900", type: "depense" },
  { id: "sfr", nom: "SFR", mono: "SFR", couleur: "#E2001A", type: "depense" },
  { id: "bouygues", nom: "Bouygues Telecom", mono: "B", couleur: "#0082C8", type: "depense" },
  { id: "edf", nom: "EDF", mono: "E", couleur: "#FF5F00", type: "depense" },
  { id: "googleone", nom: "Google One", mono: "G", couleur: "#4285F4", type: "depense" },
  { id: "microsoft365", nom: "Microsoft 365", mono: "M", couleur: "#E81123", type: "depense" },
  { id: "adobe", nom: "Adobe", mono: "Ad", couleur: "#FA0F00", type: "depense" },
  { id: "openai", nom: "ChatGPT Plus", mono: "AI", couleur: "#10A37F", type: "depense" },
  { id: "notion", nom: "Notion", mono: "N", couleur: "#000000", type: "depense" },
  { id: "dropbox", nom: "Dropbox", mono: "Db", couleur: "#0061FF", type: "depense" },
  { id: "salle", nom: "Salle de sport", mono: "SP", couleur: "#5C6B7A", type: "depense" },
  { id: "assurance", nom: "Assurance", mono: "AS", couleur: "#5C6B7A", type: "depense" },
  { id: "salaire", nom: "Salaire", mono: "S", couleur: null, type: "revenu" },
  { id: "freelance", nom: "Freelance", mono: "F", couleur: null, type: "revenu" },
  { id: "remboursement", nom: "Remboursement", mono: "R", couleur: null, type: "revenu" },
  { id: "pension", nom: "Pension", mono: "P", couleur: null, type: "revenu" },
  { id: "autrerevenu", nom: "Autre revenu", mono: "€", couleur: null, type: "revenu" },
];

/** Couleur + initiale à afficher pour une règle récurrente. */
function iconFor(rule) {
  const preset = ICON_PRESETS.find((p) => p.id === rule.icone);
  if (preset) return { mono: preset.mono, couleur: preset.couleur ?? "var(--positive)" };
  if (rule.type === "revenu") return { mono: (rule.libelle[0] || "€").toUpperCase(), couleur: "var(--positive)" };
  const env = envById(rule.envelopeId);
  return { mono: (rule.libelle[0] || "?").toUpperCase(), couleur: env ? env.couleur : "var(--ink-3)" };
}

/* Camembert : rayon et épaisseur dans un viewBox de 100×100, gouttière
   en unités normalisées (le cercle fait 100 unités, donc 1 = 1 %).
   Mettre PIE_WIDTH à 2 × PIE_R donnerait un camembert plein. */
const PIE_R = 35, PIE_WIDTH = 26, PIE_GAP = 0.9;
const SVG_NS = "http://www.w3.org/2000/svg";

/* ---------------------------------------------------------- outils */

const $ = (sel) => document.querySelector(sel);
const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const money = (cents) => eur.format(cents / 100);

/* Centimes -> texte du champ montant : « 31,50 », mais « 850 » pour un euro
   rond. String(31.5) donnait « 31,5 » : sur le chiffre principal de l'ecran,
   un montant en euros s'ecrit avec ses deux decimales ou pas du tout. */
const toInput = (cents) => {
  const euros = cents / 100;
  return (Number.isInteger(euros) ? String(euros) : euros.toFixed(2)).replace(".", ",");
};

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** "12,50" | "12.5" | "1 234,56" | "1.234,56" | "12,50 €" -> centimes. Renvoie null si illisible.

   Un montant recopié depuis un relevé ou un mail porte souvent DEUX séparateurs :
   « 1.234,56 » (usage français) ou « 1,234.56 » (usage anglais). En ne remplaçant
   que la première virgule, on lisait « 1.234,56 » comme 1,23 € — une erreur d'un
   facteur mille, silencieuse. Règle appliquée : quand les deux caractères sont
   présents, le DERNIER rencontré est la décimale et l'autre marque les milliers.
   Un séparateur unique reste la décimale, comme avant (« 12,50 », « 12.50 »),
   et « 1.234 » demeure ambigu — on ne devine pas. */
function parseAmount(raw) {
  let text = String(raw).replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  const cut = Math.max(text.lastIndexOf(","), text.lastIndexOf("."));
  const both = text.includes(",") && text.includes(".");
  if (both) text = text.slice(0, cut).replace(/[.,]/g, "") + "." + text.slice(cut + 1);
  else text = text.replace(",", ".");
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/* Un <input> ne rétrécit pas sur son contenu : une largeur fixe + texte
   aligné à droite laisse un vide invisible à gauche des chiffres courts
   ("12,50" dans une boîte de 220 px), qui décale visuellement tout le
   groupe montant + € par rapport au centre réel du tiroir. On mesure
   donc le texte affiché et on ajuste la largeur de la boîte dessus. */
const amountMeasurer = document.createElement("canvas").getContext("2d");
function sizeAmountInput(input) {
  if (!amountMeasurer) return; // environnement sans canvas : la largeur CSS par défaut prend le relais
  /* getComputedStyle(...).font renvoie une chaîne VIDE dès qu'une des
     propriétés couvertes par le raccourci n'y est pas représentable —
     ici font-variant-numeric:tabular-nums. Le canevas retombait alors sur
     son « 10px sans-serif » par défaut, mesurait ~20 px pour « 0,00 » et
     rabotait le champ à un seul chiffre. On compose donc la fonte à la main. */
  const style = getComputedStyle(input);
  const base = Number.parseFloat(input.dataset.baseSize || style.fontSize);
  input.dataset.baseSize = String(base);
  amountMeasurer.font = `${style.fontWeight} ${base}px ${style.fontFamily}`;
  const text = input.value || input.placeholder;
  const width = amountMeasurer.measureText(text).width;
  if (!width) return; // mesure impossible : la largeur CSS par défaut vaut mieux qu'une fausse

  /* Le texte est aligné à droite : trop long, il déborde par la GAUCHE et ce sont
     les chiffres de tête qui sortent du champ — on lit 345,67 là où 12 345,67 est
     saisi. Plutôt que rogner, on rétrécit la fonte jusqu'à ce que le montant tienne
     (plancher à 22 px, en dessous ce n'est plus le chiffre principal de l'écran). */
  const max = window.innerWidth * 0.6;
  const size = width > max ? Math.max(22, Math.floor((base * max) / width)) : base;
  input.style.fontSize = `${size}px`;
  input.style.width = `${Math.min((width * size) / base + 4, max)}px`;
}

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthOf = (isoDate) => isoDate.slice(0, 7);
const todayIso = () => isoDay(new Date());

function shiftMonth(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function monthName(key, style = "long") {
  const [y, m] = key.split("-").map(Number);
  return capitalize(new Intl.DateTimeFormat("fr-FR", { month: style }).format(new Date(y, m - 1, 1)));
}

/** « mardi 1er septembre » : en français, seul le premier du mois est ordinal. */
function longDate(d) {
  const s = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(d);
  return d.getDate() === 1 ? s.replace(" 1 ", " 1er ") : s;
}

function dayHeading(iso, withYear = false) {
  if (iso === todayIso()) return "Aujourd'hui";
  const d = new Date(iso + "T12:00:00");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (iso === isoDay(yesterday)) return "Hier";
  // « mardi 3 septembre » suffit dans un mois donné ; dans une recherche qui
  // ratisse tout l'historique, il faut dire de quelle année on parle
  const year = withYear && d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  return capitalize(longDate(d)) + year;
}

/* ---------------------------------------------------------- données */

function seed() {
  return {
    version: 1,
    envelopes: DEFAULT_ENVELOPES.map((e, i) => ({ id: uid(), ordre: i, ...e })),
    expenses: [],
    incomes: [],
    recurring: [],
    settings: { theme: "auto", chart: "barre" },
    updatedAt: Date.now(),
  };
}

function isSane(d) {
  return d && Array.isArray(d.envelopes) && Array.isArray(d.expenses);
}

/* Assainissement à la lecture.

   Le sauvetage n'est pas un luxe : une SEULE dépense sans date suffisait à faire
   lever `t.date.slice(0,7)` dans expensesOf(), donc à interrompre tout le rendu.
   L'accueil restait alors vide — définitivement, puisque la même sauvegarde est
   relue à chaque ouverture. Un fichier importé (bricolé à la main, tronqué, écrit
   par une version future) ne doit jamais pouvoir mettre l'appli dans cet état :
   ce qui est lisible est gardé et réparé, ce qui ne l'est pas est écarté, et
   l'import dit combien d'enregistrements il a dû laisser de côté. */

let lastRepairCount = 0;

const isMonth = (v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
const isIsoDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Entier de centimes positif, ou null. Accepte un nombre comme une saisie texte. */
function cleanCents(v) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === "string") return parseAmount(v);
  return null;
}

function cleanMovement(t, drop) {
  const montant = cleanCents(t?.montant);
  if (montant === null || !isIsoDate(t.date)) return drop();
  return {
    ...t,
    id: typeof t.id === "string" && t.id ? t.id : uid(),
    montant,
    libelle: typeof t.libelle === "string" ? t.libelle.slice(0, 60) : "",
    createdAt: Number.isFinite(t.createdAt) ? t.createdAt : 0,
  };
}

// une sauvegarde antérieure à la version 1.6 n'a ni « incomes », ni règle avec un
// champ « type » ou « icone » ; antérieure à 1.8, aucune règle n'a de mois de début
function normalizeData(data) {
  let dropped = 0;
  const drop = () => { dropped++; return null; };
  const keep = (x) => x !== null;

  data.settings = { theme: "auto", chart: "barre", ...data.settings };
  if (!["auto", "light", "dark"].includes(data.settings.theme)) data.settings.theme = "auto";
  if (!["barre", "camembert"].includes(data.settings.chart)) data.settings.chart = "barre";

  data.envelopes = (Array.isArray(data.envelopes) ? data.envelopes : [])
    .map((e, i) => {
      const nom = typeof e?.nom === "string" ? e.nom.trim().slice(0, 24) : "";
      if (!nom) return drop();
      return {
        ...e,
        id: typeof e.id === "string" && e.id ? e.id : uid(),
        nom,
        budget: cleanCents(e.budget) ?? 0,
        couleur: /^#[0-9a-f]{6}$/i.test(e.couleur) ? e.couleur : COLORS[i % COLORS.length],
        ordre: Number.isFinite(e.ordre) ? e.ordre : i,
      };
    })
    .filter(keep);

  const known = new Set(data.envelopes.map((e) => e.id));

  data.expenses = (Array.isArray(data.expenses) ? data.expenses : [])
    .map((t) => cleanMovement(t, drop))
    .filter(keep)
    // une dépense qui pointe une enveloppe disparue reste une dépense réelle :
    // on la garde, sans enveloppe, plutôt que d'effacer une trace de l'historique
    .map((t) => ({ ...t, envelopeId: known.has(t.envelopeId) ? t.envelopeId : null }));

  data.incomes = (Array.isArray(data.incomes) ? data.incomes : [])
    .map((t) => cleanMovement(t, drop))
    .filter(keep);

  data.recurring = (Array.isArray(data.recurring) ? data.recurring : [])
    .map((r) => {
      const montant = cleanCents(r?.montant);
      const jour = Number.parseInt(r?.jour, 10);
      if (montant === null || !Number.isInteger(jour)) return drop();
      const type = r.type === "revenu" ? "revenu" : "depense";
      return {
        ...r,
        id: typeof r.id === "string" && r.id ? r.id : uid(),
        type,
        montant,
        jour: Math.min(28, Math.max(1, jour)),
        libelle: typeof r.libelle === "string" && r.libelle.trim() ? r.libelle.trim().slice(0, 60) : "Sans nom",
        actif: r.actif !== false,
        icone: typeof r.icone === "string" ? r.icone : null,
        envelopeId: type === "depense" && known.has(r.envelopeId) ? r.envelopeId : null,
        // point de départ du rattrapage : jamais avant la création de la règle
        debut: isMonth(r.debut) ? r.debut : monthOf(isoDay(new Date(r.createdAt || Date.now()))),
        createdAt: Number.isFinite(r.createdAt) ? r.createdAt : 0,
      };
    })
    .filter(keep)
    // une règle de dépense sans enveloppe valide ne sait plus où imputer : elle est écartée
    .filter((r) => {
      if (r.type === "revenu" || r.envelopeId) return true;
      drop();
      return false;
    });

  lastRepairCount = dropped;
  return data;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return seed();
    const data = JSON.parse(raw);
    if (!isSane(data)) return seed();
    return normalizeData(data);
  } catch {
    return seed();
  }
}

function save() {
  state.data.updatedAt = Date.now();
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.data));
  } catch {
    toast("Enregistrement impossible : la mémoire de l'appareil est pleine.");
  }
}

const state = {
  data: load(),
  month: todayIso().slice(0, 7),
  view: "accueil",
  filterEnv: null,
  query: "",
  focusSlice: null,
  focusSticky: false,
  calDay: null,
  managing: false,
  editingTx: null,
  editingTxType: "depense",
  editingEnv: null,
  editingRecurring: null,
  draftColor: COLORS[0],
  draftEnv: null,
  draftTxType: "depense",
  draftRecurringEnv: null,
  draftRecurringActive: true,
  draftRecurringType: "depense",
  draftRecurringIcon: null,
};

/* ---------------------------------------------------------- sélecteurs */

const envelopes = () => [...state.data.envelopes].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
const envById = (id) => state.data.envelopes.find((e) => e.id === id);
const expensesOf = (month) => state.data.expenses.filter((t) => monthOf(t.date) === month);
const incomesOf = (month) => state.data.incomes.filter((t) => monthOf(t.date) === month);

/* Identifiant de la part « Sans enveloppe » du bilan. Ce n'est pas une enveloppe :
   c'est ce qui reste quand une dépense importée pointe une enveloppe disparue.
   Sans elle, ces euros étaient comptés dans le total mais absents de la
   répartition — les pourcentages ne faisaient plus 100 et le camembert restait
   ouvert, sans que rien n'explique le trou. */
const NO_ENV = "__sans-enveloppe__";

function spentByEnv(month) {
  const totals = Object.create(null);
  for (const t of expensesOf(month)) {
    const key = envById(t.envelopeId) ? t.envelopeId : NO_ENV;
    totals[key] = (totals[key] || 0) + t.montant;
  }
  return totals;
}

const totalBudget = () => envelopes().reduce((sum, e) => sum + e.budget, 0);
const totalSpent = (month) => expensesOf(month).reduce((sum, t) => sum + t.montant, 0);
const totalIncome = (month) => incomesOf(month).reduce((sum, t) => sum + t.montant, 0);

function daysLeft(month) {
  const now = new Date();
  if (month !== todayIso().slice(0, 7)) return null;
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate() - now.getDate();
}

/** Part fixe du mois : ce qui vient d'une règle récurrente — déjà tamponné, ou
    encore à tomber d'ici la fin du mois. Elle est due, pas « au rythme de ». */
function fixedSpend(month) {
  const stamped = expensesOf(month).filter((t) => t.recurringId);
  const done = new Set(stamped.map((t) => t.recurringId));
  let total = stamped.reduce((n, t) => n + t.montant, 0);
  for (const rule of recurringRules("depense")) if (rule.actif && !done.has(rule.id)) total += rule.montant;
  return total;
}

/* Où en est le mois, et où en serait la dépense si elle continuait au même
   rythme. « Il te reste 300 € » ne dit pas si c'est confortable ou si tout va
   y passer avant le 20 : c'est la comparaison entre la part du mois écoulée et
   la part du budget consommée qui le dit. */
function monthPace(month) {
  const [y, m] = month.split("-").map(Number);
  const total = new Date(y, m, 0).getDate();
  const current = month === todayIso().slice(0, 7);
  const elapsed = current ? new Date().getDate() : total;
  return { total, elapsed, ratio: elapsed / total, current };
}

/* ---------------------------------------------------------- dépenses récurrentes
   Une règle récurrente n'est qu'un modèle : elle « tamponne » une vraie
   dépense (avec recurringId pour la reconnaître) dès que le jour choisi
   est atteint. Rien n'est jamais pré-rempli pour un mois futur, ni pour un
   mois antérieur au champ « debut » de la règle. */

/** Nombre de mois qu'un rattrapage peut remonter au maximum.
    Sans ce plafond, importer une sauvegarde de trois ans ferait apparaître d'un
    coup trente-six loyers dans l'historique. Un an couvre largement l'oubli
    d'ouvrir l'appli pendant des vacances ou un changement de téléphone. */
const MAX_BACKFILL = 12;

/** Règles valides (revenu, ou dépense dont l'enveloppe existe encore), filtrables par type. */
function recurringRules(type) {
  return state.data.recurring.filter(
    (r) => (r.type === "revenu" || envById(r.envelopeId)) && (!type || r.type === type)
  );
}

/* Une échéance manquée était une échéance perdue : l'appli ne tamponnait que le
   mois réel courant. Un iPhone laissé de côté six semaines sautait donc un loyer,
   et le bilan des mois précédents s'en trouvait faux pour toujours. On parcourt
   maintenant tous les mois depuis « debut » — posé à la création de la règle, et
   remis à aujourd'hui à chaque réactivation pour qu'une pause ne se rattrape pas. */

/** Tamponne toutes les échéances dues et pas encore générées.
    @returns {{created:number, backfilled:number}} total créé, dont mois passés. */
function generateRecurring() {
  const thisMonth = todayIso().slice(0, 7);
  const today = new Date().getDate();
  const floor = shiftMonth(thisMonth, -MAX_BACKFILL);
  let created = 0;
  let backfilled = 0;

  for (const rule of recurringRules()) {
    if (!rule.actif) continue;
    const target = rule.type === "revenu" ? state.data.incomes : state.data.expenses;
    const done = new Set(target.filter((t) => t.recurringId === rule.id).map((t) => monthOf(t.date)));

    let month = rule.debut > floor ? rule.debut : floor;
    while (month <= thisMonth) {
      // le mois en cours n'est dû qu'une fois le jour atteint ; les mois passés le sont tous
      const due = month < thisMonth || today >= rule.jour;
      if (due && !done.has(month)) {
        const record = {
          id: uid(),
          montant: rule.montant,
          libelle: rule.libelle,
          date: `${month}-${pad(rule.jour)}`,
          recurringId: rule.id,
          createdAt: Date.now(),
        };
        if (rule.type === "revenu") state.data.incomes.push(record);
        else state.data.expenses.push({ ...record, envelopeId: rule.envelopeId });
        created++;
        if (month < thisMonth) backfilled++;
      }
      month = shiftMonth(month, 1);
    }
  }
  if (created) save();
  return { created, backfilled };
}

/** Message des échéances rattrapées, ou null s'il n'y a rien à dire. */
function backfillMessage({ backfilled }) {
  if (!backfilled) return null;
  return backfilled > 1
    ? `${backfilled} échéances rattrapées sur les mois passés.`
    : "1 échéance rattrapée sur un mois passé.";
}

/* ---------------------------------------------------------- rendu */

function render() {
  document.documentElement.dataset.theme = state.data.settings.theme;
  if (state.data.settings.theme === "auto") delete document.documentElement.dataset.theme;

  // la barre du haut reste en place d'une vue à l'autre : elle porte le
  // mois là où il a un sens, et le titre de la vue là où il n'en a pas
  const reglages = state.view === "reglages";
  const thisMonth = todayIso().slice(0, 7);
  $("#topbar").classList.toggle("no-nav", reglages);
  $("#month-name").textContent = reglages ? "Réglages" : monthName(state.month);
  $("#month-year").textContent = reglages
    ? "Cet appareil"
    : state.month === thisMonth
      ? state.month.slice(0, 4)
      : "Revenir au mois en cours";
  $("#fab").hidden = reglages;

  for (const el of document.querySelectorAll(".view")) el.hidden = el.id !== `view-${state.view}`;
  for (const b of document.querySelectorAll(".tabbar button")) b.classList.toggle("on", b.dataset.view === state.view);

  if (state.view === "accueil") renderAccueil();
  if (state.view === "depenses") renderDepenses();
  if (state.view === "bilan") renderBilan();
  if (state.view === "recurrent") renderRecurrent();
  if (state.view === "reglages") renderReglages();

  positionTabPill();
}

/* La pastille de l'onglet actif est posée d'après la largeur réelle des
   boutons : les libellés n'ont pas tous la même longueur, une position
   calculée en pourcentages tomberait à côté. */
function positionTabPill() {
  const pill = $("#tab-pill");
  const active = $(".tabbar button.on");
  if (!pill || !active) return;
  const width = active.offsetWidth;
  if (!width) return; // barre pas encore mesurable : on repassera au prochain rendu
  pill.style.width = `${width}px`;
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
  pill.classList.add("ready");
}

function renderAccueil() {
  const budget = totalBudget();
  const spent = totalSpent(state.month);
  const left = budget - spent;
  const perEnv = spentByEnv(state.month);

  $("#total-k").textContent = left >= 0 ? "Il te reste" : "Tu as dépassé de";
  $("#total-figure").textContent = money(Math.abs(left));
  $("#total-figure").classList.toggle("over", left < 0);

  const track = $("#total-track");
  track.replaceChildren();
  const base = Math.max(budget, spent, 1);
  const segments = [
    ...envelopes().map((env) => ({ part: perEnv[env.id] || 0, couleur: env.couleur })),
    { part: perEnv[NO_ENV] || 0, couleur: "var(--ink-3)" },
  ];
  for (const { part, couleur } of segments) {
    if (part <= 0) continue;
    const bar = document.createElement("i");
    bar.style.width = `${(part / base) * 100}%`;
    bar.style.background = couleur;
    track.append(bar);
  }

  const pace = monthPace(state.month);

  /* Repère de rythme : le trait marque la dépense « à l'heure » du jour — la part
     du budget qui correspond à la part du mois déjà passée. La couleur remplie
     au-delà du trait se lit alors d'un coup d'œil comme une avance de dépense. */
  const mark = document.createElement("i");
  mark.className = "total-mark";
  mark.style.left = `${Math.min((budget * pace.ratio) / base, 1) * 100}%`;
  if (pace.current && budget > 0) track.append(mark);

  const rest = daysLeft(state.month);
  const parts = [`sur ${money(budget)}`];
  if (rest !== null) parts.push(rest === 0 ? "dernier jour du mois" : `${rest} jour${rest > 1 ? "s" : ""} restant${rest > 1 ? "s" : ""}`);
  $("#total-note").textContent = parts.join(" · ");

  /* Avant une semaine, une projection n'en est pas une : au 3 du mois on
     multiplie par dix ce qui a été dépensé, et le premier plein d'essence
     annonce une fin de mois à trois mille euros. */
  const showPace = pace.current && pace.elapsed >= 7 && spent > 0 && budget > 0;
  $("#total-pace").hidden = !showPace;
  if (showPace) {
    /* Seule la part VARIABLE s'extrapole. Etaler le loyer paye le 3 sur les
       trente jours du mois annonçait quatorze mille euros pour un budget de
       mille sept cents : un chiffre faux fait plus de mal que pas de chiffre. */
    const fixed = fixedSpend(state.month);
    const variable = Math.max(spent - fixed, 0);
    const projection = Math.max(spent, fixed + Math.round((variable / pace.elapsed) * pace.total));
    const gap = projection - budget;
    $("#total-pace").textContent =
      gap > 0
        ? `À ce rythme : ${money(projection)} en fin de mois, soit ${money(gap)} de trop.`
        : `À ce rythme : ${money(projection)} en fin de mois, ${money(-gap)} sous le budget.`;
    $("#total-pace").classList.toggle("is-over", gap > 0);
  }

  // sans revenu saisi, la ligne n'afficherait que des zéros : on ne la
  // montre qu'à partir du premier revenu du mois
  const income = totalIncome(state.month);
  const hasIncome = incomesOf(state.month).length > 0;
  $("#flow").hidden = !hasIncome;
  if (hasIncome) {
    const net = income - spent;
    $("#flow-in").textContent = `+${money(income)}`;
    $("#flow-out").textContent = `−${money(spent)}`;
    $("#flow-net").textContent = `${net < 0 ? "−" : "+"}${money(Math.abs(net))}`;
    $("#flow-net").className = `flow-v ${net < 0 ? "is-expense" : "is-income"}`;
  }

  $("#toggle-manage").textContent = state.managing ? "Terminé" : "Gérer";
  $("#toggle-manage").classList.toggle("on", state.managing);

  const list = $("#env-list");
  list.replaceChildren();

  for (const env of envelopes()) {
    const spentHere = perEnv[env.id] || 0;
    const over = spentHere > env.budget;
    const pct = env.budget > 0 ? Math.round((spentHere / env.budget) * 100) : spentHere > 0 ? 100 : 0;

    const row = document.createElement("button");
    row.type = "button";
    row.className = "env" + (over ? " is-over" : "");
    row.style.setProperty("--c", env.couleur);
    row.dataset.env = env.id;

    const head = document.createElement("span");
    head.className = "env-head";
    const dot = document.createElement("span");
    dot.className = "env-dot";
    const name = document.createElement("b");
    name.className = "env-n";
    name.textContent = env.nom;
    const amount = document.createElement("span");
    amount.className = "env-a";
    amount.textContent = over ? `−${money(spentHere - env.budget)}` : money(env.budget - spentHere);
    head.append(dot, name, amount);

    const foot = document.createElement("span");
    foot.className = "env-foot";
    const sub = document.createElement("span");
    sub.className = "env-sub";
    sub.textContent = `${over ? "dépassé" : "restants"} sur ${money(env.budget)}`;
    const right = document.createElement("span");
    right.className = state.managing ? "env-edit" : "env-p";
    right.textContent = state.managing ? "Modifier" : `${pct} %`;
    foot.append(sub, right);

    const track = document.createElement("span");
    track.className = "env-track";
    const fill = document.createElement("i");
    fill.style.width = `${Math.min(pct, 100)}%`;
    track.append(fill);

    row.append(head, foot, track);
    row.setAttribute("aria-label", `${env.nom}, ${amount.textContent} ${sub.textContent}, ${pct} % utilisés`);

    if (!state.managing) {
      list.append(row);
      continue;
    }

    /* En mode « Gérer », la rangée est flanquée de deux boutons d'ordre. Ils sont
       posés à CÔTÉ du bouton d'enveloppe, jamais dedans : un bouton imbriqué dans
       un autre est du HTML invalide, et le navigateur défait alors l'imbrication
       en déplaçant les nœuds — la mise en page part en morceaux. */
    const wrap = document.createElement("div");
    wrap.className = "env-row";
    const order = document.createElement("div");
    order.className = "env-order";
    const list_ = envelopes();
    const at = list_.findIndex((e) => e.id === env.id);
    for (const [dir, label] of [[-1, "Monter"], [1, "Descendre"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "env-move";
      b.dataset.move = env.id;
      b.dataset.dir = String(dir);
      b.textContent = label;
      b.disabled = at + dir < 0 || at + dir >= list_.length;
      b.setAttribute("aria-label", `${label} ${env.nom}`);
      order.append(b);
    }
    wrap.append(row, order);
    list.append(wrap);
  }

  if (state.managing) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "env-add";
    add.id = "env-add";
    add.textContent = "+  Nouvelle enveloppe";
    const hint = document.createElement("p");
    hint.className = "manage-hint";
    hint.textContent = "Touche une enveloppe pour la modifier.";
    list.append(add, hint);
  }

  if (!envelopes().length) list.append(emptyBlock("Aucune enveloppe", "Ajoute un poste de dépense pour commencer."));
}

function emptyBlock(title, sub) {
  const box = document.createElement("div");
  box.className = "empty";
  const b = document.createElement("b");
  b.textContent = title;
  const s = document.createElement("span");
  s.textContent = sub;
  box.append(b, s);
  return box;
}

function renderDepenses() {
  const list = $("#tx-list");
  list.replaceChildren();

  const filter = state.filterEnv ? envById(state.filterEnv) : null;
  $("#filter-bar").hidden = !filter;
  if (filter) $("#filter-label").textContent = `Enveloppe : ${filter.nom}`;
  $("#clear-search").hidden = !state.query;

  const query = state.query.trim().toLowerCase();

  /* Une recherche porte sur TOUT l'historique, pas sur le seul mois affiché.
     Chercher « boulangerie » et ne fouiller que septembre, c'est ne pas chercher :
     on retrouvait une ligne sur deux sans jamais savoir que l'autre existait. */
  const searching = Boolean(query);
  const pool = searching
    ? [state.data.expenses, state.data.incomes]
    : [expensesOf(state.month), incomesOf(state.month)];
  let items = [
    ...pool[0].map((t) => ({ ...t, kind: "depense" })),
    ...pool[1].map((t) => ({ ...t, kind: "revenu" })),
  ];

  // un filtre d'enveloppe ne s'applique qu'aux dépenses : un revenu n'en a pas
  if (filter) items = items.filter((t) => t.kind === "depense" && t.envelopeId === filter.id);

  if (query) {
    items = items.filter((t) => {
      const where = t.kind === "revenu" ? "revenu" : envById(t.envelopeId)?.nom ?? "sans enveloppe";
      return `${t.libelle ?? ""} ${where}`.toLowerCase().includes(query);
    });
  }

  items.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)));

  // un filtre ou une recherche pose une question chiffrée (« combien chez eux ? ») :
  // le total de ce qui est affiché est la réponse, il n'a pas à être fait de tête
  const sum = $("#tx-sum");
  sum.hidden = !(searching || filter) || !items.length;
  if (!sum.hidden) {
    const out = items.filter((t) => t.kind === "depense").reduce((n, t) => n + t.montant, 0);
    const inc = items.filter((t) => t.kind === "revenu").reduce((n, t) => n + t.montant, 0);
    const bits = [`${items.length} mouvement${items.length > 1 ? "s" : ""}`];
    if (searching) bits[0] += " dans tout l'historique";
    if (out) bits.push(`−${money(out)}`);
    if (inc) bits.push(`+${money(inc)}`);
    sum.textContent = bits.join(" · ");
  }

  if (!items.length) {
    list.append(
      emptyBlock(
        query ? "Rien trouvé" : "Rien pour ce mois-ci",
        query
          ? "Aucun mouvement de tout l'historique ne correspond à cette recherche."
          : filter
            ? "Aucune dépense dans cette enveloppe."
            : "Touche le bouton + pour noter une dépense ou un revenu."
      )
    );
    return;
  }

  let currentDay = null;
  for (const tx of items) {
    if (tx.date !== currentDay) {
      currentDay = tx.date;
      const head = document.createElement("p");
      head.className = "tx-day";
      head.textContent = dayHeading(tx.date, searching);
      list.append(head);
    }

    const revenu = tx.kind === "revenu";
    const env = revenu ? null : envById(tx.envelopeId);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tx";
    row.dataset.tx = tx.id;
    row.dataset.kind = tx.kind;

    const dot = document.createElement("span");
    dot.className = "tx-dot";
    dot.style.setProperty("--c", revenu ? "var(--positive)" : env ? env.couleur : "#9AA0AC");

    const text = document.createElement("span");
    text.className = "tx-t";
    const label = document.createElement("b");
    label.textContent =
      (tx.recurringId ? "↻ " : "") + (tx.libelle || (revenu ? "Revenu" : env ? env.nom : "Dépense"));
    const sub = document.createElement("span");
    sub.textContent = revenu ? "Revenu" : env ? env.nom : "Sans enveloppe";
    text.append(label, sub);

    const amount = document.createElement("span");
    amount.className = `tx-a ${revenu ? "is-income" : "is-expense"}`;
    amount.textContent = `${revenu ? "+" : "−"}${money(tx.montant)}`;

    row.append(dot, text, amount);
    list.append(row);
  }
}

function renderBilan() {
  const spent = totalSpent(state.month);
  $("#bilan-figure").textContent = money(spent);

  const prevKey = shiftMonth(state.month, -1);
  const prev = totalSpent(prevKey);
  let compare = `Rien à comparer avec ${monthName(prevKey).toLowerCase()}.`;
  if (prev > 0) {
    const delta = Math.round(((spent - prev) / prev) * 100);
    const sense = delta > 0 ? "de plus" : delta < 0 ? "de moins" : "autant";
    compare =
      delta === 0
        ? `Exactement autant qu'en ${monthName(prevKey).toLowerCase()}.`
        : `${Math.abs(delta)} % ${sense} qu'en ${monthName(prevKey).toLowerCase()} (${money(prev)}).`;
  }
  $("#bilan-compare").textContent = compare;

  const income = totalIncome(state.month);
  const hasIncome = incomesOf(state.month).length > 0;
  $("#bilan-net").hidden = !hasIncome;
  if (hasIncome) {
    const net = income - spent;
    $("#bilan-net").textContent =
      `Revenus +${money(income)} · solde ${net < 0 ? "−" : "+"}${money(Math.abs(net))}`;
  }

  const keys = [];
  for (let i = 5; i >= 0; i--) keys.push(shiftMonth(state.month, -i));
  const totals = keys.map((k) => totalSpent(k));
  const max = Math.max(...totals, 1);

  const hist = $("#hist");
  const labels = $("#hist-labels");
  hist.replaceChildren();
  labels.replaceChildren();
  // les barres portaient un title= : illisible au doigt, et surtout inerte —
  // le geste évident (toucher un mois pour l'ouvrir) ne faisait rien
  keys.forEach((key, i) => {
    const bar = document.createElement("button");
    bar.type = "button";
    bar.dataset.month = key;
    bar.style.setProperty("--h", `${Math.max((totals[i] / max) * 100, 3)}%`);
    if (key === state.month) bar.classList.add("on");
    bar.setAttribute("aria-label", `${monthName(key)} : ${money(totals[i])}`);
    bar.title = `${monthName(key)} : ${money(totals[i])}`;
    hist.append(bar);

    const tag = document.createElement("span");
    tag.textContent = monthName(key, "short").replace(".", "");
    labels.append(tag);
  });

  renderRepartition(spent);
}

/* Répartition : une barre empilée à 100 % — la forme faite pour la
   part-du-tout — doublée d'une légende qui donne les chiffres en
   toutes lettres. La couleur ne porte donc jamais l'information
   seule : chaque part est nommée et chiffrée juste en dessous. */
function renderRepartition(total) {
  const bar = $("#chart-bar");
  const legend = $("#repartition");
  bar.replaceChildren();
  legend.replaceChildren();

  const perEnv = spentByEnv(state.month);
  let rows = [
    ...envelopes().map((e) => ({ id: e.id, nom: e.nom, couleur: e.couleur, value: perEnv[e.id] || 0 })),
    { id: NO_ENV, nom: "Sans enveloppe", couleur: null, value: perEnv[NO_ENV] || 0 },
  ]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  $("#chart").hidden = !rows.length;
  $("#chart-mode").hidden = !rows.length; // rien à mettre en forme sans dépense
  if (!rows.length) {
    legend.append(emptyBlock("Aucune dépense", "Le bilan se remplit dès la première dépense du mois."));
    return;
  }

  if (rows.length > MAX_SEGMENTS) {
    const tail = rows.slice(MAX_SEGMENTS - 1);
    rows = rows.slice(0, MAX_SEGMENTS - 1);
    rows.push({
      id: "autres",
      nom: `${tail.length} autres postes`,
      couleur: null,
      value: tail.reduce((sum, r) => sum + r.value, 0),
    });
  }

  const share = (v) => Math.round((v / total) * 100);
  if (state.focusSlice && !rows.some((r) => r.id === state.focusSlice)) state.focusSlice = null;

  const pie = state.data.settings.chart === "camembert";
  $("#chart-bar").hidden = pie;
  $("#chart-pie").hidden = !pie;
  for (const b of document.querySelectorAll("[data-chart]")) {
    const on = b.dataset.chart === state.data.settings.chart;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }

  bar.setAttribute(
    "aria-label",
    `Répartition des dépenses : ${rows.map((r) => `${r.nom} ${share(r.value)} %`).join(", ")}`
  );
  bar.classList.toggle("has-focus", Boolean(state.focusSlice));

  for (const row of rows) {
    const active = state.focusSlice === row.id;

    const seg = document.createElement("button");
    seg.type = "button";
    seg.dataset.slice = row.id;
    if (row.couleur) seg.style.setProperty("--c", row.couleur);
    else seg.classList.add("is-other");
    seg.classList.toggle("on", active);
    seg.setAttribute("aria-label", `${row.nom}, ${money(row.value)}, ${share(row.value)} %`);
    bar.append(seg);

    const line = document.createElement("button");
    line.type = "button";
    line.className = "legend-row" + (active ? " on" : "");
    line.dataset.slice = row.id;

    const dot = document.createElement("span");
    dot.className = "legend-dot" + (row.couleur ? "" : " is-other");
    if (row.couleur) dot.style.setProperty("--c", row.couleur);

    const name = document.createElement("span");
    name.className = "legend-n";
    name.textContent = row.nom;

    const value = document.createElement("span");
    value.className = "legend-v";
    value.textContent = money(row.value);

    const pct = document.createElement("span");
    pct.className = "legend-p";
    pct.textContent = `${share(row.value)} %`;

    line.append(dot, name, value, pct);
    legend.append(line);
  }

  // une part minuscule garde 3 px pour rester visible et cliquable
  bar.style.gridTemplateColumns = rows.map((r) => `minmax(3px, ${r.value}fr)`).join(" ");

  renderPie(rows, total, share);

  const focused = rows.find((r) => r.id === state.focusSlice);
  $("#chart-tip").textContent = focused
    ? `${focused.nom} · ${money(focused.value)} · ${share(focused.value)} %`
    : "Touche une part pour le détail";
  $("#chart-tip").classList.toggle("on", Boolean(focused));
}

/* Le camembert lit exactement les mêmes parts que la barre : un seul
   cercle par part, découpé en pointillés. pathLength="100" ramène la
   circonférence à cent unités, donc une unité vaut un pour cent et il
   n'y a aucun calcul d'angle à faire. */
function renderPie(rows, total, share) {
  const svg = $("#pie-svg");
  const box = $("#chart-pie");
  svg.replaceChildren();
  box.classList.toggle("has-focus", Boolean(state.focusSlice));

  // sur une part unique, une gouttière laisserait une encoche dans un disque plein
  const gap = rows.length > 1 ? PIE_GAP : 0;
  let offset = 0;

  const ring = document.createElementNS(SVG_NS, "g");
  ring.setAttribute("transform", "rotate(-90 50 50)"); // départ à midi

  for (const row of rows) {
    const length = Math.max((row.value / total) * 100 - gap, 0.5);
    const arc = document.createElementNS(SVG_NS, "circle");
    arc.setAttribute("cx", "50");
    arc.setAttribute("cy", "50");
    arc.setAttribute("r", String(PIE_R));
    arc.setAttribute("fill", "none");
    arc.setAttribute("pathLength", "100");
    arc.setAttribute("stroke-width", String(PIE_WIDTH));
    arc.setAttribute("stroke-dasharray", `${length} ${100 - length}`);
    arc.setAttribute("stroke-dashoffset", String(-offset));
    arc.dataset.slice = row.id;
    // attribut de présentation plutôt que style.stroke : c'est la forme
    // universellement comprise, et « Autres » prend sa teinte par la CSS
    if (row.couleur) arc.setAttribute("stroke", row.couleur);
    else arc.classList.add("is-other");
    arc.classList.toggle("on", state.focusSlice === row.id);
    ring.append(arc);
    offset += (row.value / total) * 100;
  }

  svg.append(ring);
  svg.setAttribute(
    "aria-label",
    `Répartition des dépenses : ${rows.map((r) => `${r.nom} ${share(r.value)} %`).join(", ")}`
  );
  // le trou fait environ 95 px de large : un gros total y serait à l'étroit
  const label = money(total);
  $("#pie-value").textContent = label;
  $("#pie-value").style.fontSize = label.length > 10 ? "13px" : "16px";
}

function renderReglages() {
  for (const b of document.querySelectorAll("[data-theme-set]")) {
    const on = b.dataset.themeSet === state.data.settings.theme;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
  const n = state.data.expenses.length;
  const inc = state.data.incomes.length;
  const e = state.data.envelopes.length;
  const r = state.data.recurring.length;
  const when = state.data.updatedAt
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(state.data.updatedAt)
    : "jamais";
  $("#data-stat").textContent =
    `${n} dépense${n > 1 ? "s" : ""} · ${inc} revenu${inc > 1 ? "s" : ""} · ${e} enveloppe${e > 1 ? "s" : ""} · ${r} récurrente${r > 1 ? "s" : ""} · modifié le ${when}`;
  $("#version").textContent = `Mon Budget ${APP_VERSION}`;
  $("#install-stat").textContent = isStandalone()
    ? "Ouverte depuis l'écran d'accueil — plein écran, hors connexion."
    : "Ouverte dans le navigateur : installe-la pour gagner la place de la barre d'outils.";

  // un fichier local (double-clic), ou l'appli de bureau sur son hôte interne,
  // n'a pas d'adresse qu'un raccourci sur un autre appareil puisse rouvrir
  const local = /^(localhost|127\.0\.0\.1|(.*\.)?tauri\.localhost)$/i.test(location.hostname);
  const online = /^https?:$/.test(location.protocol) && !local;
  $("#shortcut-linkbox").hidden = !online;
  $("#shortcut-unavailable").hidden = online;
  if (online) $("#shortcut-link").value = `${location.origin}${location.pathname}?ajouter=1&montant=`;
}

/* ---------------------------------------------------------- récurrent : calendrier + listes */

function renderRecurrent() {
  renderCalendar();
  renderRecurringList("revenu", "#income-list", "Aucun revenu récurrent", "Salaire, versement régulier… ajoute-le une fois, il revient seul chaque mois.");
  renderRecurringList("depense", "#recurring-list", "Aucune dépense récurrente", "Le loyer, un abonnement… ajoute-le une fois, il revient seul chaque mois.");
}

/* Grille du mois affiché (même navigation que les autres vues) : un
   point rond rouge si une dépense tombe ce jour-là, un point losange
   vert si un revenu tombe ce jour-là — la forme distingue les deux en
   plus de la couleur, pour rester lisible en cas de daltonisme rouge-vert. */
function renderCalendar() {
  const grid = $("#cal-grid");
  grid.replaceChildren();

  const [y, m] = state.month.split("-").map(Number);
  const startOffset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lundi en premier
  const daysInMonth = new Date(y, m, 0).getDate();
  const rules = recurringRules().filter((r) => r.actif);
  const today = todayIso();

  for (let i = 0; i < startOffset; i++) {
    const filler = document.createElement("div");
    filler.className = "cal-cell cal-pad";
    grid.append(filler);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${state.month}-${pad(day)}`;
    const here = rules.filter((r) => r.jour === day);

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-cell";
    if (iso === today) cell.classList.add("is-today");
    if (state.calDay === iso) cell.classList.add("is-selected");
    cell.dataset.day = iso;

    const num = document.createElement("span");
    num.className = "cal-num";
    num.textContent = String(day);
    cell.append(num);

    if (here.length) {
      const dots = document.createElement("span");
      dots.className = "cal-dots";
      if (here.some((r) => r.type === "depense")) dots.append(Object.assign(document.createElement("i"), { className: "cal-dot cal-dot-out" }));
      if (here.some((r) => r.type === "revenu")) dots.append(Object.assign(document.createElement("i"), { className: "cal-dot cal-dot-in" }));
      cell.append(dots);
    }

    cell.setAttribute(
      "aria-label",
      `${day} — ${here.length ? here.map((r) => r.libelle).join(", ") : "rien de prévu"}`
    );
    grid.append(cell);
  }

  renderCalendarDay(rules);
}

function renderCalendarDay(monthRules) {
  const panel = $("#cal-day");
  panel.replaceChildren();

  if (!state.calDay) {
    panel.append(emptyBlock("Aucun jour sélectionné", "Touche un jour du calendrier pour voir le détail."));
    return;
  }

  const day = Number(state.calDay.slice(-2));
  const heading = document.createElement("p");
  heading.className = "cal-day-head";
  heading.textContent = capitalize(longDate(new Date(`${state.calDay}T12:00:00`)));
  panel.append(heading);

  const items = monthRules.filter((r) => r.jour === day);
  if (!items.length) {
    panel.append(emptyBlock("Rien ce jour-là", "Aucune dépense ni revenu récurrent prévu."));
    return;
  }

  for (const rule of items.sort((a, b) => (a.type === b.type ? 0 : a.type === "revenu" ? -1 : 1))) {
    const icon = iconFor(rule);
    const row = document.createElement("div");
    row.className = "cal-item";

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.setProperty("--c", icon.couleur);
    chip.textContent = icon.mono;

    const text = document.createElement("span");
    text.className = "tx-t";
    const name = document.createElement("b");
    name.textContent = rule.libelle;
    const sub = document.createElement("span");
    sub.textContent = rule.type === "revenu" ? "Revenu récurrent" : (envById(rule.envelopeId)?.nom ?? "Dépense récurrente");
    text.append(name, sub);

    const amount = document.createElement("span");
    amount.className = "tx-a " + (rule.type === "revenu" ? "is-income" : "is-expense");
    amount.textContent = (rule.type === "revenu" ? "+" : "−") + money(rule.montant);

    row.append(chip, text, amount);
    panel.append(row);
  }
}

/** Liste de gestion (Réglages ↔ onglet Récurrent) filtrée par type. */
function renderRecurringList(type, listId, emptyTitle, emptySub) {
  const list = $(listId);
  list.replaceChildren();

  const rules = recurringRules(type).sort((a, b) => a.jour - b.jour);
  if (!rules.length) {
    list.append(emptyBlock(emptyTitle, emptySub));
    return;
  }

  for (const rule of rules) {
    const icon = iconFor(rule);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tx" + (rule.actif ? "" : " is-paused");
    row.dataset.recurring = rule.id;

    const chip = document.createElement("span");
    chip.className = "chip chip-sm";
    chip.style.setProperty("--c", icon.couleur);
    chip.textContent = icon.mono;

    const text = document.createElement("span");
    text.className = "tx-t";
    const name = document.createElement("b");
    name.textContent = rule.libelle;
    const sub = document.createElement("span");
    const where = type === "revenu" ? "Revenu" : (envById(rule.envelopeId)?.nom ?? "");
    sub.textContent = rule.actif ? `${where} · le ${rule.jour}` : `${where} · en pause`;
    text.append(name, sub);

    const amount = document.createElement("span");
    amount.className = "tx-a " + (type === "revenu" ? "is-income" : "is-expense");
    amount.textContent = (type === "revenu" ? "+" : "−") + money(rule.montant);

    row.append(chip, text, amount);
    row.setAttribute("aria-label", `${rule.libelle}, ${money(rule.montant)}, ${sub.textContent}`);
    list.append(row);
  }
}

/* ---------------------------------------------------------- feuilles */

/* Un seul minuteur partagé pour toute la fermeture : avec un minuteur
   par tiroir, rouvrir dans les 280 ms qui suivaient une fermeture faisait
   masquer le tiroir tout juste ouvert par le minuteur encore en vol. */
let closeTimer;

function openSheet(id) {
  clearTimeout(closeTimer);
  $("#scrim").hidden = false;
  for (const other of document.querySelectorAll(".sheet")) {
    if (other.id === id.slice(1)) continue;
    other.classList.remove("show");
    other.hidden = true;
  }
  const sheet = $(id);
  sheet.hidden = false;
  requestAnimationFrame(() => {
    $("#scrim").classList.add("show");
    sheet.classList.add("show");
  });
}

function closeSheets() {
  clearTimeout(closeTimer);
  $("#scrim").classList.remove("show");
  for (const sheet of document.querySelectorAll(".sheet")) sheet.classList.remove("show");
  closeTimer = setTimeout(() => {
    for (const sheet of document.querySelectorAll(".sheet")) sheet.hidden = true;
    $("#scrim").hidden = true;
  }, 280);
  disarmAll();
}

/**
 * @param {object|null} tx    mouvement à modifier, ou null pour une création
 * @param {{montantText?:string, envId?:string, libelle?:string}|null} prefill
 *   valeurs de départ pour une création déclenchée depuis le raccourci Apple
 * @param {"depense"|"revenu"} type  nature du mouvement (à donner aussi en modification)
 */
function openTxSheet(tx, prefill = null, type = "depense") {
  state.editingTx = tx ? tx.id : null;
  state.editingTxType = tx ? type : null;
  state.draftTxType = type;

  /* Sans enveloppe, une dépense n'a nulle part où aller — mais un revenu, si.
     Refuser tout net laissait l'appli sans issue : le bouton + ne faisait plus
     rien du tout. On ouvre donc le tiroir côté revenu, en le disant. */
  const first = envelopes()[0];
  if (type === "depense" && !first) {
    if (tx) return toast("Crée d'abord une enveloppe.");
    type = "revenu";
    state.draftTxType = "revenu";
    toast("Aucune enveloppe : crée-en une pour tes dépenses. En attendant, voici un revenu.");
  }

  state.draftEnv = tx && type === "depense" ? tx.envelopeId : (prefill?.envId ?? first?.id ?? null);
  $("#tx-amount").value = tx ? toInput(tx.montant) : (prefill?.montantText ?? "");
  sizeAmountInput($("#tx-amount"));
  $("#tx-label").value = tx ? tx.libelle : (prefill?.libelle ?? "");
  $("#tx-date").value = tx ? tx.date : todayIso();
  $("#tx-amount-error").hidden = true;
  $("#tx-delete").hidden = !tx;
  $("#tx-duplicate").hidden = !tx;

  renderTxEnvPicker();
  updateTxTypeUI(Boolean(tx));

  openSheet("#sheet-tx");
  // un montant déjà rempli n'a pas besoin du clavier ; sinon on le propose tout de suite
  if (!tx && !prefill?.montantText) setTimeout(() => $("#tx-amount").focus(), 320);
}

function renderTxEnvPicker() {
  const picker = $("#tx-env-picker");
  picker.replaceChildren();
  for (const env of envelopes()) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "radio";
    b.dataset.pick = env.id;
    b.textContent = env.nom;
    b.style.setProperty("--c", env.couleur);
    b.classList.toggle("on", env.id === state.draftEnv);
    b.setAttribute("aria-checked", String(env.id === state.draftEnv));
    picker.append(b);
  }
}

/** Un revenu n'a pas d'enveloppe : le sélecteur disparaît et le titre change.
    En modification, le sélecteur de type disparaît aussi — changer la nature
    d'un mouvement déjà noté reviendrait à le déplacer d'une liste à l'autre. */
function updateTxTypeUI(editing) {
  const revenu = state.draftTxType === "revenu";
  for (const b of document.querySelectorAll("#tx-type button")) {
    const on = b.dataset.type === state.draftTxType;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
  $("#tx-type").hidden = editing;
  $("#tx-env-block").hidden = revenu;
  $("#tx-label").placeholder = revenu ? "Salaire, remboursement, prime…" : "Monoprix, essence, resto…";
  $("#tx-title").textContent = editing
    ? revenu
      ? "Modifier le revenu"
      : "Modifier la dépense"
    : revenu
      ? "Nouveau revenu"
      : "Nouvelle dépense";
  $("#tx-delete").textContent = revenu ? "Supprimer ce revenu" : "Supprimer cette dépense";
  $("#tx-delete").dataset.idle = $("#tx-delete").textContent;
}

function openEnvSheet(env) {
  state.editingEnv = env ? env.id : null;
  state.draftColor = env ? env.couleur : COLORS[state.data.envelopes.length % COLORS.length];

  $("#env-title").textContent = env ? "Modifier l'enveloppe" : "Nouvelle enveloppe";
  $("#env-name").value = env ? env.nom : "";
  $("#env-budget").value = env ? toInput(env.budget) : "";
  $("#env-name-error").hidden = true;
  $("#env-delete").hidden = !env;

  const picker = $("#env-colors");
  picker.replaceChildren();
  // une enveloppe créée avec une palette plus ancienne garde sa teinte dans le choix
  const palette = COLORS.includes(state.draftColor) ? COLORS : [state.draftColor, ...COLORS];
  for (const hex of palette) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "radio";
    b.dataset.color = hex;
    b.style.setProperty("--c", hex);
    b.classList.toggle("on", hex === state.draftColor);
    b.setAttribute("aria-label", `Couleur ${hex}`);
    b.setAttribute("aria-checked", String(hex === state.draftColor));
    picker.append(b);
  }

  openSheet("#sheet-env");
}

function openRecurringSheet(rule, defaultType = "depense") {
  state.editingRecurring = rule ? rule.id : null;
  state.draftRecurringType = rule ? rule.type : defaultType;
  state.draftRecurringIcon = rule ? rule.icone : null;
  state.draftRecurringActive = rule ? rule.actif : true;

  const first = envelopes()[0];
  state.draftRecurringEnv = rule ? rule.envelopeId : (first ? first.id : null);
  if (state.draftRecurringType === "depense" && !first) return toast("Crée d'abord une enveloppe.");

  $("#recurring-amount").value = rule ? toInput(rule.montant) : "";
  sizeAmountInput($("#recurring-amount"));
  $("#recurring-label").value = rule ? rule.libelle : "";
  $("#recurring-day").value = rule ? String(rule.jour) : "";
  $("#recurring-amount-error").hidden = true;
  $("#recurring-label-error").hidden = true;
  $("#recurring-day-error").hidden = true;
  $("#recurring-delete").hidden = !rule;

  const picker = $("#recurring-env-picker");
  picker.replaceChildren();
  for (const env of envelopes()) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "radio";
    b.dataset.pick = env.id;
    b.textContent = env.nom;
    b.style.setProperty("--c", env.couleur);
    b.classList.toggle("on", env.id === state.draftRecurringEnv);
    b.setAttribute("aria-checked", String(env.id === state.draftRecurringEnv));
    picker.append(b);
  }

  for (const b of document.querySelectorAll("#recurring-state button")) {
    const on = (b.dataset.active === "1") === state.draftRecurringActive;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }

  updateRecurringTypeUI(Boolean(rule));
  openSheet("#sheet-recurring");
  if (!rule) setTimeout(() => $("#recurring-amount").focus(), 320);
}

/** Bascule l'enveloppe (masquée pour un revenu), le titre et la liste de modèles selon le type choisi. */
function updateRecurringTypeUI(editing) {
  for (const b of document.querySelectorAll("#recurring-type button")) {
    const on = b.dataset.type === state.draftRecurringType;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
  $("#recurring-env-block").hidden = state.draftRecurringType === "revenu";

  const revenu = state.draftRecurringType === "revenu";
  $("#recurring-title").textContent = editing
    ? revenu
      ? "Modifier le revenu récurrent"
      : "Modifier la dépense récurrente"
    : revenu
      ? "Nouveau revenu récurrent"
      : "Nouvelle dépense récurrente";

  renderIconPicker();
}

/* Le libellé accompagne le modèle tant que l'utilisateur ne l'a pas écrit
   lui-même. On ne testait que « le champ est-il vide ? » : au premier modèle
   choisi il se remplissait, et plus jamais ensuite — on repartait de Netflix,
   on touchait Spotify, et la règle gardait « Netflix » sous une pastille verte.
   Le champ est donc considéré comme automatique s'il est vide OU s'il porte
   exactement le nom du modèle actuellement sélectionné ; tout le reste a été
   tapé à la main et ne doit plus bouger. */
function labelFollowsPreset() {
  const current = $("#recurring-label").value.trim();
  if (!current) return true;
  const preset = ICON_PRESETS.find((p) => p.id === state.draftRecurringIcon);
  return Boolean(preset) && current === preset.nom;
}

function renderIconPicker() {
  const picker = $("#recurring-icon-picker");
  picker.replaceChildren();

  const none = document.createElement("button");
  none.type = "button";
  none.role = "radio";
  none.dataset.icon = "";
  none.className = "icon-chip is-generic";
  none.textContent = "?";
  none.classList.toggle("on", !state.draftRecurringIcon);
  none.setAttribute("aria-label", "Aucun modèle");
  none.setAttribute("aria-checked", String(!state.draftRecurringIcon));
  picker.append(none);

  for (const preset of ICON_PRESETS.filter((p) => p.type === state.draftRecurringType)) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "radio";
    b.dataset.icon = preset.id;
    b.className = "icon-chip";
    b.style.setProperty("--c", preset.couleur ?? "var(--positive)");
    b.textContent = preset.mono;
    const on = state.draftRecurringIcon === preset.id;
    b.classList.toggle("on", on);
    b.setAttribute("aria-label", preset.nom);
    b.setAttribute("aria-checked", String(on));
    picker.append(b);
  }
}

/* ---------------------------------------------------------- confirmation en deux temps
   Pas de window.confirm() : indisponible ou bloquant selon les
   plateformes (PWA iOS, fenêtre Tauri). Le bouton se réarme seul. */

const armed = new Map();

function armDanger(btn, question, action) {
  if (armed.get(btn)) {
    clearTimeout(armed.get(btn).timer);
    armed.delete(btn);
    btn.textContent = btn.dataset.idle;
    action();
    return;
  }
  btn.dataset.idle = btn.dataset.idle || btn.textContent;
  btn.textContent = question;
  const timer = setTimeout(() => {
    btn.textContent = btn.dataset.idle;
    armed.delete(btn);
  }, 5000);
  armed.set(btn, { timer });
}

function disarmAll() {
  for (const [btn, { timer }] of armed) {
    clearTimeout(timer);
    btn.textContent = btn.dataset.idle;
  }
  armed.clear();
}

/* ---------------------------------------------------------- toast */

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => (el.hidden = true), 260);
  }, 2600);
}

/* ---------------------------------------------------------- import / export */

function exportData() {
  const stamp = todayIso();
  const json = JSON.stringify(state.data, null, 2);
  try {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `mon-budget-${stamp}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Sauvegarde exportée.");
  } catch {
    navigator.clipboard
      ?.writeText(json)
      .then(() => toast("Téléchargement bloqué : données copiées dans le presse-papiers."))
      .catch(() => toast("Export impossible sur cet appareil."));
  }
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (!isSane(data)) throw new Error("format");
      state.data = normalizeData(data);
      state.filterEnv = null;
      state.month = todayIso().slice(0, 7);
      state.calDay = null;
      const repaired = lastRepairCount;
      save();
      generateRecurring();
      render();
      // NB : le message d'import prime sur celui du rattrapage — l'utilisateur
      // vient de faire un geste explicite, c'est de lui qu'on lui parle
      toast(
        repaired
          ? `Importé : ${state.data.expenses.length} dépenses. ${repaired} enregistrement${repaired > 1 ? "s illisibles écartés" : " illisible écarté"}.`
          : `Importé : ${state.data.expenses.length} dépenses.`
      );
    } catch {
      toast("Fichier illisible : ce n'est pas une sauvegarde Mon Budget.");
    }
  };
  reader.onerror = () => toast("Lecture du fichier impossible.");
  reader.readAsText(file);
}

/* ---------------------------------------------------------- événements */

function clearFocus() {
  state.focusSlice = null;
  state.focusSticky = false;
}

function goToMonth(key) {
  state.month = key;
  clearFocus();
  state.calDay = null;
  disarmAll();
  render();
}

$("#prev-month").addEventListener("click", () => goToMonth(shiftMonth(state.month, -1)));
$("#next-month").addEventListener("click", () => goToMonth(shiftMonth(state.month, 1)));

$("#cal-grid").addEventListener("click", (e) => {
  const cell = e.target.closest("[data-day]");
  if (!cell) return;
  state.calDay = state.calDay === cell.dataset.day ? null : cell.dataset.day;
  render();
});

$("#tabbar").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  state.view = btn.dataset.view;
  if (state.view !== "depenses") state.filterEnv = null;
  clearFocus();
  // « Tout effacer » vit dans une vue, pas dans un tiroir : sans ça il restait
  // armé pendant qu'on regardait ailleurs, et un retour dans les cinq secondes
  // suffisait à effacer le budget d'un seul appui
  disarmAll();
  render();
});

// le titre du mois ramène au mois en cours quand on s'en est éloigné
$("#month-label").addEventListener("click", () => {
  const now = todayIso().slice(0, 7);
  if (state.month === now || state.view === "reglages") return;
  goToMonth(now);
});

$("#tx-search").addEventListener("input", (e) => {
  state.query = e.target.value;
  renderDepenses();
});
$("#clear-search").addEventListener("click", () => {
  state.query = "";
  $("#tx-search").value = "";
  renderDepenses();
});

$("#tx-type").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-type]");
  if (!btn || btn.dataset.type === state.draftTxType) return;
  if (btn.dataset.type === "depense" && !envelopes().length) return toast("Crée d'abord une enveloppe.");
  state.draftTxType = btn.dataset.type;
  updateTxTypeUI(false);
});

// la pastille est mesurée en pixels : elle doit être replacée quand la
// largeur de la barre change (rotation de l'écran, redimensionnement)
window.addEventListener("resize", positionTabPill);

/* Le graphique : on sélectionne une part au doigt, on la survole à la
   souris. Les deux passent par le même état, donc la barre et la
   légende restent toujours d'accord. */
function toggleSlice(id, sticky) {
  if (sticky) {
    // un second appui sur la même part la désélectionne
    const off = state.focusSticky && state.focusSlice === id;
    state.focusSlice = off ? null : id;
    state.focusSticky = !off;
  } else {
    state.focusSlice = id;
    state.focusSticky = false;
  }
  render();
}

for (const id of ["#chart-bar", "#pie-svg", "#repartition"]) {
  $(id).addEventListener("click", (e) => {
    const target = e.target.closest("[data-slice]");
    if (target) toggleSlice(target.dataset.slice, true);
  });
}

for (const id of ["#chart-bar", "#pie-svg"]) {
  $(id).addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || state.focusSticky) return;
    const seg = e.target.closest("[data-slice]");
    if (seg && seg.dataset.slice !== state.focusSlice) toggleSlice(seg.dataset.slice, false);
  });

  $(id).addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse" || state.focusSticky || !state.focusSlice) return;
    clearFocus();
    render();
  });
}

$("#hist").addEventListener("click", (e) => {
  const bar = e.target.closest("[data-month]");
  if (bar && bar.dataset.month !== state.month) goToMonth(bar.dataset.month);
});

$("#chart-mode").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-chart]");
  if (!btn) return;
  state.data.settings.chart = btn.dataset.chart;
  save();
  render();
});

$("#fab").addEventListener("click", () => openTxSheet(null));

$("#toggle-manage").addEventListener("click", () => {
  state.managing = !state.managing;
  render();
});

/** Échange une enveloppe avec sa voisine et renumérote tout le rang. */
function moveEnvelope(id, dir) {
  const order = envelopes();
  const from = order.findIndex((e) => e.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to], order[from]];
  // renuméroter en entier plutôt qu'échanger deux « ordre » : une sauvegarde
  // ancienne peut porter des valeurs en double, ou aucune
  order.forEach((env, i) => { env.ordre = i; });
  save();
  render();
}

$("#env-list").addEventListener("click", (e) => {
  const move = e.target.closest("[data-move]");
  if (move) return moveEnvelope(move.dataset.move, Number(move.dataset.dir));
  if (e.target.closest("#env-add")) return openEnvSheet(null);
  const row = e.target.closest("[data-env]");
  if (!row) return;
  const env = envById(row.dataset.env);
  if (!env) return;
  if (state.managing) return openEnvSheet(env);
  state.filterEnv = env.id;
  state.query = "";
  $("#tx-search").value = "";
  state.view = "depenses";
  render();
});

$("#tx-list").addEventListener("click", (e) => {
  const row = e.target.closest("[data-tx]");
  if (!row) return;
  const kind = row.dataset.kind === "revenu" ? "revenu" : "depense";
  const source = kind === "revenu" ? state.data.incomes : state.data.expenses;
  const tx = source.find((t) => t.id === row.dataset.tx);
  if (tx) openTxSheet(tx, null, kind);
});

$("#clear-filter").addEventListener("click", () => {
  state.filterEnv = null;
  render();
});

$("#scrim").addEventListener("click", closeSheets);
for (const btn of document.querySelectorAll("[data-close]")) btn.addEventListener("click", closeSheets);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheets();
});

for (const id of ["#tx-amount", "#recurring-amount"]) {
  $(id).addEventListener("input", () => sizeAmountInput($(id)));
}

$("#tx-env-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pick]");
  if (!btn) return;
  state.draftEnv = btn.dataset.pick;
  for (const b of $("#tx-env-picker").children) {
    const on = b === btn;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
});

$("#env-colors").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-color]");
  if (!btn) return;
  state.draftColor = btn.dataset.color;
  for (const b of $("#env-colors").children) {
    const on = b === btn;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
});

$("#tx-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const cents = parseAmount($("#tx-amount").value);
  $("#tx-amount-error").hidden = cents !== null;
  if (cents === null) return $("#tx-amount").focus();

  const revenu = state.draftTxType === "revenu";
  const target = revenu ? state.data.incomes : state.data.expenses;
  const payload = {
    montant: cents,
    libelle: $("#tx-label").value.trim(),
    date: $("#tx-date").value || todayIso(),
  };
  if (!revenu) payload.envelopeId = state.draftEnv;

  if (state.editingTx) {
    Object.assign(
      target.find((t) => t.id === state.editingTx),
      payload
    );
    toast(revenu ? "Revenu modifié." : "Dépense modifiée.");
  } else {
    target.push({ id: uid(), createdAt: Date.now(), ...payload });
    toast(
      revenu
        ? `${money(cents)} noté en revenu.`
        : `${money(cents)} noté dans ${envById(payload.envelopeId)?.nom ?? "l'enveloppe"}.`
    );
  }

  state.month = monthOf(payload.date);
  save();
  closeSheets();
  render();
});

/* Dupliquer rouvre le tiroir en création, même montant, même enveloppe, même
   libellé, mais daté d'aujourd'hui : c'est le geste de la dépense qui revient
   sans être régulière au point de mériter une règle (le plein, la nounou…).
   Rien n'est enregistré tant qu'on n'a pas validé — la date reste modifiable. */
$("#tx-duplicate").addEventListener("click", () => {
  const revenu = state.editingTxType === "revenu";
  const source = revenu ? state.data.incomes : state.data.expenses;
  const tx = source.find((t) => t.id === state.editingTx);
  if (!tx) return;
  openTxSheet(
    null,
    { montantText: toInput(tx.montant), envId: tx.envelopeId, libelle: tx.libelle },
    revenu ? "revenu" : "depense"
  );
});

$("#tx-delete").addEventListener("click", (e) => {
  const revenu = state.editingTxType === "revenu";
  armDanger(e.currentTarget, "Confirmer la suppression ?", () => {
    if (revenu) state.data.incomes = state.data.incomes.filter((t) => t.id !== state.editingTx);
    else state.data.expenses = state.data.expenses.filter((t) => t.id !== state.editingTx);
    save();
    closeSheets();
    render();
    toast(revenu ? "Revenu supprimé." : "Dépense supprimée.");
  });
});

$("#env-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const nom = $("#env-name").value.trim();
  $("#env-name-error").hidden = Boolean(nom);
  if (!nom) return $("#env-name").focus();

  const budget = parseAmount($("#env-budget").value) ?? 0;

  if (state.editingEnv) {
    Object.assign(envById(state.editingEnv), { nom, budget, couleur: state.draftColor });
    toast("Enveloppe modifiée.");
  } else {
    state.data.envelopes.push({
      id: uid(),
      nom,
      budget,
      couleur: state.draftColor,
      ordre: state.data.envelopes.length,
    });
    toast("Enveloppe créée.");
  }

  save();
  closeSheets();
  render();
});

$("#env-delete").addEventListener("click", (e) => {
  const count = state.data.expenses.filter((t) => t.envelopeId === state.editingEnv).length;
  const recurringCount = state.data.recurring.filter((r) => r.envelopeId === state.editingEnv).length;
  const parts = [];
  if (count) parts.push(`${count} dépense${count > 1 ? "s" : ""}`);
  if (recurringCount) parts.push(`${recurringCount} dépense${recurringCount > 1 ? "s" : ""} récurrente${recurringCount > 1 ? "s" : ""}`);
  const question = parts.length ? `Supprimer aussi ${parts.join(" et ")} ?` : "Confirmer la suppression ?";
  armDanger(e.currentTarget, question, () => {
    state.data.envelopes = state.data.envelopes.filter((x) => x.id !== state.editingEnv);
    state.data.expenses = state.data.expenses.filter((t) => t.envelopeId !== state.editingEnv);
    state.data.recurring = state.data.recurring.filter((r) => r.envelopeId !== state.editingEnv);
    if (state.filterEnv === state.editingEnv) state.filterEnv = null;
    save();
    closeSheets();
    render();
    toast("Enveloppe supprimée.");
  });
});

$("#recurring-add").addEventListener("click", () => openRecurringSheet(null, "depense"));
$("#income-add").addEventListener("click", () => openRecurringSheet(null, "revenu"));

for (const id of ["#recurring-list", "#income-list"]) {
  $(id).addEventListener("click", (e) => {
    const row = e.target.closest("[data-recurring]");
    if (!row) return;
    const rule = state.data.recurring.find((r) => r.id === row.dataset.recurring);
    if (rule) openRecurringSheet(rule);
  });
}

$("#recurring-type").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-type]");
  if (!btn || btn.dataset.type === state.draftRecurringType) return;
  state.draftRecurringType = btn.dataset.type;
  // les modèles ne sont pas les mêmes d'un type à l'autre : le modèle tombe, et
  // le libellé avec lui s'il en venait — « Netflix » n'a rien à faire en revenu
  const follows = labelFollowsPreset();
  state.draftRecurringIcon = null;
  if (follows) $("#recurring-label").value = "";
  if (state.draftRecurringType === "depense" && !state.draftRecurringEnv) {
    const first = envelopes()[0];
    if (!first) {
      state.draftRecurringType = "revenu"; // on ne peut pas basculer vers dépense sans enveloppe
      updateRecurringTypeUI(Boolean(state.editingRecurring)); // sinon le bouton resterait affiché sur "Dépense"
      return toast("Crée d'abord une enveloppe.");
    }
    state.draftRecurringEnv = first.id;
  }
  updateRecurringTypeUI(Boolean(state.editingRecurring));
});

$("#recurring-icon-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-icon]");
  if (!btn) return;
  // à mesurer AVANT de changer de modèle : la question porte sur l'ancien
  const follows = labelFollowsPreset();
  state.draftRecurringIcon = btn.dataset.icon || null;
  const preset = ICON_PRESETS.find((p) => p.id === state.draftRecurringIcon);
  if (preset && follows) $("#recurring-label").value = preset.nom;
  renderIconPicker();
});

$("#recurring-env-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pick]");
  if (!btn) return;
  state.draftRecurringEnv = btn.dataset.pick;
  for (const b of $("#recurring-env-picker").children) {
    const on = b === btn;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
});

$("#recurring-state").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-active]");
  if (!btn) return;
  state.draftRecurringActive = btn.dataset.active === "1";
  for (const b of $("#recurring-state").children) {
    const on = b === btn;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
});

$("#recurring-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const cents = parseAmount($("#recurring-amount").value);
  $("#recurring-amount-error").hidden = cents !== null;

  const libelle = $("#recurring-label").value.trim();
  $("#recurring-label-error").hidden = Boolean(libelle);

  const jour = Number.parseInt($("#recurring-day").value, 10);
  const jourValid = Number.isInteger(jour) && jour >= 1 && jour <= 28;
  $("#recurring-day-error").hidden = jourValid;

  const type = state.draftRecurringType;
  if (cents === null) return $("#recurring-amount").focus();
  if (!libelle) return $("#recurring-label").focus();
  if (!jourValid) return $("#recurring-day").focus();
  if (type === "depense" && !state.draftRecurringEnv) return toast("Crée d'abord une enveloppe.");

  const editing = Boolean(state.editingRecurring);
  const previous = editing ? state.data.recurring.find((r) => r.id === state.editingRecurring) : null;
  const payload = {
    type,
    montant: cents,
    libelle,
    jour,
    actif: state.draftRecurringActive,
    icone: state.draftRecurringIcon,
    envelopeId: type === "depense" ? state.draftRecurringEnv : null,
  };

  /* Point de départ du rattrapage. Une règle qui sort de pause repart
     d'aujourd'hui : les mois passés en pause n'étaient pas dus, les tamponner
     rétroactivement inventerait des dépenses qui n'ont jamais eu lieu. */
  const thisMonth = todayIso().slice(0, 7);
  payload.debut = previous && previous.actif && payload.actif ? previous.debut : thisMonth;

  if (editing) Object.assign(previous, payload);
  else state.data.recurring.push({ id: uid(), createdAt: Date.now(), ...payload });

  save();
  closeSheets();
  // un jour déjà passé ce mois-ci (création, réactivation, ou jour avancé) se rattrape tout de suite
  const { created } = generateRecurring();
  render();

  const label = type === "revenu" ? "Revenu récurrent" : "Dépense récurrente";
  if (editing) toast(created ? "Modifié — le mois en cours est à jour." : `${label} modifié${type === "revenu" ? "" : "e"}.`);
  else
    toast(
      created
        ? `« ${libelle} » ajouté${type === "revenu" ? "" : "e"} à ce mois-ci, puis chaque mois le ${jour}.`
        : `« ${libelle} » reviendra chaque mois le ${jour}.`
    );
});

$("#recurring-delete").addEventListener("click", (e) => {
  const rule = state.data.recurring.find((r) => r.id === state.editingRecurring);
  const isRevenu = rule?.type === "revenu";
  armDanger(e.currentTarget, "Confirmer la suppression ?", () => {
    state.data.recurring = state.data.recurring.filter((r) => r.id !== state.editingRecurring);
    save();
    closeSheets();
    render();
    toast(
      isRevenu
        ? "Revenu récurrent supprimé. Les montants déjà générés restent dans l'historique."
        : "Dépense récurrente supprimée. Les dépenses déjà générées restent dans l'historique."
    );
  });
});

for (const btn of document.querySelectorAll("[data-theme-set]")) {
  btn.addEventListener("click", () => {
    state.data.settings.theme = btn.dataset.themeSet;
    save();
    render();
  });
}

$("#shortcut-copy").addEventListener("click", async () => {
  const value = $("#shortcut-link").value;
  try {
    await navigator.clipboard.writeText(value);
    toast("Lien copié.");
  } catch {
    $("#shortcut-link").select();
    toast("Lien sélectionné — copie avec ⌘C.");
  }
});

$("#export-btn").addEventListener("click", exportData);
$("#import-btn").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importData(file);
  e.target.value = "";
});

$("#reset-btn").addEventListener("click", (e) => {
  armDanger(e.currentTarget, "Effacer définitivement ?", () => {
    state.data = seed();
    state.filterEnv = null;
    state.managing = false;
    save();
    render();
    toast("Tout a été effacé.");
  });
});

/* ---------------------------------------------------------- raccourci Apple
   Une URL comme ?ajouter=1&montant=12,50&env=Courses, ouverte par un
   raccourci Raccourcis (bouton Action, tapotement arrière…), ouvre
   directement le tiroir « Nouvelle dépense » plutôt que d'ajouter la
   dépense sans confirmation : le montant peut être faux (photo floue
   du reçu, presse-papiers périmé…) et la catégorie n'est jamais devinable
   depuis un simple montant. */

function matchEnvelope(raw) {
  if (!raw) return null;
  const byId = envById(raw);
  if (byId) return byId;
  const norm = (s) => s.trim().toLowerCase();
  return envelopes().find((e) => norm(e.nom) === norm(raw)) ?? null;
}

function consumeShortcutLink() {
  const params = new URLSearchParams(location.search);
  if (params.get("ajouter") !== "1") return;

  const cents = parseAmount(params.get("montant") ?? "");
  const env = matchEnvelope(params.get("env"));

  // la dépense n'est pas encore enregistrée : rien à perdre à nettoyer l'URL tout de suite
  history.replaceState(null, "", location.pathname + location.hash);

  openTxSheet(null, {
    montantText: cents !== null ? toInput(cents) : "",
    envId: env?.id,
    libelle: params.get("libelle") ?? "",
  });
}

/* ---------------------------------------------------------- démarrage */

/* Installée sur l'écran d'accueil, l'appli occupe tout l'écran ; ouverte
   dans Safari, la barre d'outils du navigateur mord sur le bas — la barre
   d'onglets doit alors remonter d'autant pour rester atteignable. */
function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches === true || navigator.standalone === true;
}
document.documentElement.dataset.standalone = isStandalone() ? "1" : "0";

/* Une sauvegarde abimee est reparee a la lecture, en memoire — mais tant qu'aucune
   modification ne declenche d'ecriture, le fichier fautif reste sur le disque et
   se fait rereparer a chaque ouverture. On le reecrit une bonne fois, pour que
   l'export lui aussi parte propre. */
if (lastRepairCount) save();

render();
const startup = generateRecurring();
if (startup.created) render();
const caughtUp = backfillMessage(startup);
if (caughtUp) toast(caughtUp);
consumeShortcutLink();
// les boutons d'onglet ne sont mesurables qu'une fois la mise en page faite
requestAnimationFrame(positionTabPill);

/* Marqueur de fin d'initialisation, lu par les tests navigateur. Se fier au
   HTML statique ne dirait rien : « 0,00 € » est deja ecrit dans index.html,
   meme si le script n'a jamais tourne. */
document.documentElement.dataset.appReady = "1";

/* Une PWA iPhone n'est pas rechargée entre deux ouvertures : sans ça,
   rouverte le mois suivant, elle afficherait encore le mois précédent et
   n'aurait tamponné aucune échéance entre-temps. */
let lastSeenDay = todayIso();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const today = todayIso();
  if (today === lastSeenDay) return;
  const wasOnCurrentMonth = state.month === lastSeenDay.slice(0, 7);
  lastSeenDay = today;
  if (wasOnCurrentMonth) state.month = today.slice(0, 7);
  const caught = backfillMessage(generateRecurring());
  render();
  if (caught) toast(caught);
});

/* Une appli posée sur l'écran d'accueil sert ses fichiers depuis son cache : une
   version corrigée peut être en ligne depuis des jours sans que l'iPhone en sache
   rien, puisqu'il ne recharge jamais la page de lui-même. Le service worker le
   sait, lui — on le laisse le dire, avec le bouton qui va avec. */
let updateAnnounced = false;
function announceUpdate() {
  if (updateAnnounced) return;
  updateAnnounced = true;
  $("#update-bar").hidden = false;
  requestAnimationFrame(() => $("#update-bar").classList.add("show"));
}

$("#update-apply").addEventListener("click", () => location.reload());
$("#update-dismiss").addEventListener("click", () => {
  $("#update-bar").classList.remove("show");
  setTimeout(() => ($("#update-bar").hidden = true), 260);
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    // à la toute première visite il n'y a pas encore de contrôleur : la prise de
    // relais qui suit est l'installation initiale, pas une mise à jour
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => {
        // « installed » alors qu'un service worker contrôle déjà la page : ce
        // n'est pas la première installation, c'est une version plus récente
        const watch = (worker) => {
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) announceUpdate();
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) announceUpdate();
        watch(reg.installing);
        reg.addEventListener("updatefound", () => watch(reg.installing));
      })
      .catch(() => {
        /* hors-ligne indisponible : l'appli fonctionne quand même */
      });
    // sw.js appelle skipWaiting() : le nouveau worker prend la main sans passer
    // par l'état « waiting », et c'est ce relais-là qui fait foi
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) announceUpdate();
    });
  });
}
