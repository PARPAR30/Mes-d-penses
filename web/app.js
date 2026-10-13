/* ============================================================
   Mon Budget — logique de l'application
   Tout est stocké dans le localStorage de cet appareil.
   Les montants sont manipulés en centimes (entiers) pour
   éviter les erreurs d'arrondi des nombres à virgule.
   ============================================================ */

const STORE_KEY = "mon-budget/v1";
const APP_VERSION = "2.1.0";

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

/* Enveloppes proposées au premier lancement. Les budgets sont VIDES : ils
   n'étaient que des chiffres inventés (800 € de logement…) qui faussaient
   l'accueil avant la moindre saisie. `suggestion` n'apparaît qu'en filigrane. */
const DEFAULT_ENVELOPES = [
  { nom: "Logement", couleur: "#3F6DE0", suggestion: 800 },
  { nom: "Courses", couleur: "#E4634A", suggestion: 400 },
  { nom: "Transports", couleur: "#23A26D", suggestion: 150 },
  { nom: "Sorties", couleur: "#7B57D6", suggestion: 200 },
  { nom: "Abonnements", couleur: "#B8820A", suggestion: 60 },
  { nom: "Santé", couleur: "#D6497E", suggestion: 60 },
  { nom: "Loisirs", couleur: "#1B9AAA", suggestion: 80 },
];

/* « Évitable » est une ÉTIQUETTE posée sur une dépense, pas une enveloppe : un
   resto est à la fois « Sorties » et évitable. Une enveloppe qui s'appelle
   « Évitable » (créée avec la 1.9) continue pourtant d'être comptée comme telle. */
const noAccent = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

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
/* L'espace des milliers de fr-FR est une espace fine insécable (U+202F) : dans
   Archivo, avec les chiffres tabulaires, elle se réduit à un filet et « 1 090,29 »
   se lit « 1090,29 ». On la remplace par l'espace insécable ordinaire. */
const money = (cents) => eur.format(cents / 100).replace(/\u202f/g, "\u00a0");

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
  const max = window.innerWidth * 0.68;
  const size = width > max ? Math.max(26, Math.floor((base * max) / width)) : base;
  input.style.fontSize = `${size}px`;
  input.style.width = `${Math.min((width * size) / base + 4, max)}px`;
}

/* Montant compact pour les petits espaces (graphique des mois) : « 850 € », « 1,1 k€ ». */
function compactMoney(cents) {
  const euros = Math.round(cents / 100);
  if (euros < 1000) return `${euros}\u00a0€`;
  const k = euros / 1000;
  return `${(k >= 10 ? Math.round(k) : Math.round(k * 10) / 10).toString().replace(".", ",")}\u00a0k€`;
}

/* Luminance relative (WCAG) d'une couleur #rrggbb. */
function luminance(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const INK = "#1B1E24";

/* Encre lisible sur une couleur : celle des deux (blanc ou encre) qui offre le MEILLEUR
   contraste. Un seuil fixe laissait du blanc sur l'ambre (3,4:1) alors que l'encre y fait 4,9:1.
   Le vert « positif » change de teinte avec le thème : son encre est une variable CSS. */
function onColor(hex) {
  if (hex === "var(--positive)") return "var(--on-positive)";
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return "#fff";
  const l = luminance(hex);
  const white = 1.05 / (l + 0.05);
  const ink = (l + 0.05) / (luminance(INK) + 0.05);
  return ink > white ? INK : "#fff";
}

const initialOf = (nom) => (Array.from(nom || "?")[0] || "?").toUpperCase();

/* Pastille d'enveloppe : couleur + INITIALE. La couleur seule ne tient pas pour
   deux teintes proches (rose / rouge) ni pour un œil daltonien ; la lettre, si. */
function badge(className, couleur, text) {
  const el = document.createElement("span");
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  el.style.setProperty("--c", couleur);
  el.style.setProperty("--on", onColor(couleur));
  el.textContent = text;
  return el;
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

const SCHEMA = 2;
const EVITABLE_COLOR = "#D6497E";

function seed() {
  return {
    version: 1,
    schema: SCHEMA,
    envelopes: DEFAULT_ENVELOPES.slice(0, 5).map((e, i) => ({ id: uid(), ordre: i, nom: e.nom, couleur: e.couleur, budget: 0 })),
    expenses: [],
    incomes: [],
    recurring: [],
    goals: [],
    settings: { theme: "auto", chart: "barre", envSort: "ordre", histMode: "6", onboarded: false },
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

/** Historique des budgets : [{from:"YYYY-MM"|"0000-00", cents}], trié, sans doublon de mois. */
function cleanBudgetHistory(h) {
  if (!Array.isArray(h)) return [];
  const byMonth = new Map();
  for (const x of h) {
    if (!x || !(x.from === "0000-00" || isMonth(x.from))) continue;
    byMonth.set(x.from, cleanCents(x.cents) ?? 0);
  }
  return [...byMonth].map(([from, cents]) => ({ from, cents })).sort((a, b) => a.from.localeCompare(b.from));
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
    ...(t.evitable === true ? { evitable: true } : {}),
  };
}

// une sauvegarde antérieure à la version 1.6 n'a ni « incomes », ni règle avec un
// champ « type » ou « icone » ; antérieure à 1.8, aucune règle n'a de mois de début
function normalizeData(data) {
  let dropped = 0;
  const drop = () => { dropped++; return null; };
  const keep = (x) => x !== null;

  data.settings = { theme: "auto", chart: "barre", envSort: "ordre", histMode: "6", ...data.settings };
  if (!["6", "12", "annee"].includes(data.settings.histMode)) data.settings.histMode = "6";
  for (const k of ["lastExport", "lastReminder"]) if (!Number.isFinite(data.settings[k])) data.settings[k] = null;
  // une sauvegarde qui n'a pas ce champ a déjà servi (ou vient d'un import) : pas d'accueil guidé
  if (typeof data.settings.onboarded !== "boolean") data.settings.onboarded = true;
  if (!["auto", "light", "dark"].includes(data.settings.theme)) data.settings.theme = "auto";
  if (!["barre", "camembert"].includes(data.settings.chart)) data.settings.chart = "barre";
  if (!["ordre", "entame"].includes(data.settings.envSort)) data.settings.envSort = "ordre";

  data.envelopes = (Array.isArray(data.envelopes) ? data.envelopes : [])
    .map((e, i) => {
      const nom = typeof e?.nom === "string" ? e.nom.trim().slice(0, 24) : "";
      if (!nom) return drop();
      return {
        ...e,
        id: typeof e.id === "string" && e.id ? e.id : uid(),
        nom,
        budget: cleanCents(e.budget) ?? 0,
        budgetHistory: cleanBudgetHistory(e.budgetHistory),
        report: e.report === true,
        reportDepuis: isMonth(e.reportDepuis) ? e.reportDepuis : null,
        archivee: e.archivee === true,
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
        jour: Math.min(31, Math.max(1, jour)),
        evitable: r.evitable === true,
        libelle: typeof r.libelle === "string" && r.libelle.trim() ? r.libelle.trim().slice(0, 60) : "Sans nom",
        actif: r.actif !== false,
        icone: typeof r.icone === "string" ? r.icone : null,
        // mois que l'utilisateur a supprimés à la main : la règle ne les recrée pas
        skipped: Array.isArray(r.skipped) ? [...new Set(r.skipped.filter(isMonth))] : [],
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

  data.goals = (Array.isArray(data.goals) ? data.goals : [])
    .map((g) => {
      const cible = cleanCents(g?.cible);
      const nom = typeof g?.nom === "string" ? g.nom.trim().slice(0, 40) : "";
      if (cible === null || !nom) return drop();
      return {
        id: typeof g.id === "string" && g.id ? g.id : uid(),
        nom,
        cible,
        epargne: Math.max(0, Math.round(Number.isFinite(g.epargne) ? g.epargne : 0)),
        echeance: isMonth(g.echeance) ? g.echeance : null,
        createdAt: Number.isFinite(g.createdAt) ? g.createdAt : 0,
      };
    })
    .filter(keep);

  data.schema = SCHEMA;
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

/* Compteur de révision : les tables dérivées (dépensé par mois et par enveloppe)
   sont recalculées quand il change, jamais avant. Toute modification passe par save(). */
let dataRev = 0;

function save() {
  dataRev++;
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
  filtersOpen: false,
  period: "mois", // mois | 30j | 3m | annee | tout | perso
  dateFrom: "",
  dateTo: "",
  onlyAvoidable: false,
  editingGoal: null,
  fate: "archive",
  fateTo: null,
  draftEnvManual: false,
  draftEvManual: false,
  suggestedFrom: null,
  draftBulkEv: "",
  limit: 60,
  limitKey: "",
  itemKeys: [],
  amountMin: null, // centimes, ou null
  amountMax: null,
  selecting: false,
  picked: new Set(),
  draftBulkEnv: "",
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

/* Les enveloppes ARCHIVÉES ne s'offrent plus à la saisie (envelopes()) mais gardent
   leur nom, leur couleur et leur historique (allEnvelopes(), envById()). */
const sortByOrder = (list) => [...list].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
const envelopes = () => sortByOrder(state.data.envelopes.filter((e) => !e.archivee));
const allEnvelopes = () => sortByOrder(state.data.envelopes);
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

/* ---- budgets : un montant par enveloppe ET par mois ----
   Changer le budget de Courses ne doit pas réécrire les jauges de l'an dernier.
   `budgetHistory` garde les changements : [{from:"0000-00", cents}, {from:"2026-10", cents}]
   — chaque entrée vaut à partir de son mois. Sans historique, `budget` vaut partout. */
function budgetFor(env, month) {
  const h = env.budgetHistory;
  if (!h || !h.length) return env.budget;
  let cents = h[0].cents;
  for (const e of h) if (e.from <= month) cents = e.cents;
  return cents;
}

/** Fixe le budget à partir de `month` : les mois d'avant gardent le leur. */
function setBudgetFrom(env, month, cents) {
  const h = env.budgetHistory?.length ? env.budgetHistory.map((e) => ({ ...e })) : [{ from: "0000-00", cents: env.budget }];
  const at = h.find((e) => e.from === month);
  if (at) at.cents = cents;
  else h.push({ from: month, cents });
  h.sort((a, b) => a.from.localeCompare(b.from));
  // deux entrées voisines identiques ne disent rien de plus
  env.budgetHistory = h.filter((e, i) => i === 0 || e.cents !== h[i - 1].cents);
  env.budget = budgetFor(env, todayIso().slice(0, 7));
}

/** Dépensé par mois puis par enveloppe, sur tout l'historique — calculé une fois par révision. */
let spentCache = { rev: -1, data: null, table: null };
function spentTable() {
  if (spentCache.rev === dataRev && spentCache.data === state.data) return spentCache.table;
  const table = Object.create(null);
  for (const t of state.data.expenses) {
    const m = monthOf(t.date);
    const row = (table[m] ||= Object.create(null));
    row[t.envelopeId] = (row[t.envelopeId] || 0) + t.montant;
  }
  spentCache = { rev: dataRev, data: state.data, table };
  return table;
}

/** Report : ce qui n'a pas été dépensé un mois s'ajoute au suivant (jamais une dette). */
const MAX_CARRY_MONTHS = 60;
function carryIn(env, month) {
  if (!env.report || !isMonth(env.reportDepuis) || month <= env.reportDepuis) return 0;
  const table = spentTable();
  let carry = 0;
  let m = env.reportDepuis;
  for (let i = 0; m < month && i < MAX_CARRY_MONTHS; i++) {
    carry = Math.max(0, budgetFor(env, m) + carry - (table[m]?.[env.id] || 0));
    m = shiftMonth(m, 1);
  }
  return carry;
}

/** Ce dont l'enveloppe dispose ce mois-là : son budget + le report. */
const budgetOf = (env, month) => budgetFor(env, month) + carryIn(env, month);

/** Enveloppes à montrer pour un mois : les actives, plus les archivées qui y ont encore des dépenses. */
function envelopesFor(month) {
  const spent = spentTable()[month] || {};
  return sortByOrder(state.data.envelopes.filter((e) => !e.archivee || spent[e.id]));
}

const totalBudget = (month) => envelopesFor(month).reduce((sum, e) => sum + budgetOf(e, month), 0);

/* ---- étiquette « évitable » ---- */
const isAvoidableEnv = (env) => Boolean(env) && noAccent(env.nom) === "evitable";
const isAvoidable = (t) => t.evitable === true || isAvoidableEnv(envById(t.envelopeId));
const avoidableSpent = (month) => expensesOf(month).filter(isAvoidable).reduce((n, t) => n + t.montant, 0);

/* ---- jour d'échéance : au-delà de la fin du mois, c'est le dernier jour ---- */
const daysIn = (month) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
const effDay = (rule, month) => Math.min(rule.jour, daysIn(month));
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
    for (const m of rule.skipped || []) done.add(m);

    let month = rule.debut > floor ? rule.debut : floor;
    while (month <= thisMonth) {
      // le mois en cours n'est dû qu'une fois le jour atteint ; les mois passés le sont tous
      const due = month < thisMonth || today >= effDay(rule, month);
      if (due && !done.has(month)) {
        const record = {
          id: uid(),
          montant: rule.montant,
          libelle: rule.libelle,
          date: `${month}-${pad(effDay(rule, month))}`,
          recurringId: rule.id,
          createdAt: Date.now(),
          ...(rule.evitable ? { evitable: true } : {}),
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

/* Supprimer à la main l'occurrence d'un mois ne doit pas la faire revenir : la règle la
   recréait à chaque ouverture (rien n'y était plus, donc « il manque »). On retient le
   mois dans `rule.skipped`. Renvoie le nombre de mois retenus et la fonction qui les rend. */
function skipStamped(movements) {
  const touched = [];
  for (const t of movements) {
    if (!t.recurringId) continue;
    const rule = state.data.recurring.find((r) => r.id === t.recurringId);
    if (!rule) continue;
    rule.skipped ||= [];
    const m = monthOf(t.date);
    if (!rule.skipped.includes(m)) {
      rule.skipped.push(m);
      touched.push([rule, m]);
    }
  }
  return {
    count: touched.length,
    undo: () => {
      for (const [rule, m] of touched) rule.skipped = rule.skipped.filter((x) => x !== m);
    },
  };
}
const SKIP_NOTE = " Elle ne reviendra pas ce mois-ci.";

/** Une règle modifiée met à jour l'occurrence DÉJÀ tamponnée du mois en cours (montant,
    libellé, enveloppe, étiquette) : sinon corriger un loyer ne changeait que les mois à venir,
    et le mois affiché gardait l'ancien chiffre. Renvoie la fonction qui défait ce changement. */
function syncStamped(rule) {
  const month = todayIso().slice(0, 7);
  const list = rule.type === "revenu" ? state.data.incomes : state.data.expenses;
  const rec = list.find((t) => t.recurringId === rule.id && monthOf(t.date) === month);
  if (!rec) return () => {};
  const restore = snapshotOf(rec);
  rec.montant = rule.montant;
  rec.libelle = rule.libelle;
  // la date ne passe jamais dans le futur : une échéance déjà tombée ne se « re-pose » pas
  const day = effDay(rule, month);
  if (day <= new Date().getDate()) rec.date = `${month}-${pad(day)}`;
  if (rule.type === "depense") {
    rec.envelopeId = rule.envelopeId;
    if (rule.evitable) rec.evitable = true;
    else delete rec.evitable;
  }
  return restore;
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
      : state.month.slice(0, 4);
  $("#open-settings").classList.toggle("on", reglages);
  $("#open-settings").setAttribute("aria-current", reglages ? "page" : "false");

  // la sélection n'a de sens que dans la liste des mouvements
  if (state.view !== "depenses") {
    state.selecting = false;
    state.picked.clear();
  }
  $("#tabbar").hidden = state.selecting;
  $("#bulkbar").hidden = !state.selecting;

  for (const el of document.querySelectorAll(".view")) el.hidden = el.id !== `view-${state.view}`;
  for (const b of document.querySelectorAll(".tabbar button")) b.classList.toggle("on", b.dataset.view === state.view);

  if (state.view === "accueil") renderAccueil();
  if (state.view === "depenses") renderDepenses();
  if (state.view === "bilan") renderBilan();
  if (state.view === "recurrent") renderRecurrent();
  if (state.view === "reglages") renderReglages();

  positionTabPill();
  syncOnboarding();
}

/* La pastille de l'onglet actif est posée d'après la largeur réelle des
   boutons : les libellés n'ont pas tous la même longueur, une position
   calculée en pourcentages tomberait à côté. */
function positionTabPill() {
  const pill = $("#tab-pill");
  const active = $(".tabbar button.on");
  if (!pill) return;
  // en Réglages (hors barre d'onglets) aucun onglet n'est actif : la pastille s'efface
  if (!active) return void pill.classList.remove("ready");
  const width = active.offsetWidth;
  if (!width) return; // barre pas encore mesurable : on repassera au prochain rendu
  pill.style.width = `${width}px`;
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
  pill.classList.add("ready");
}

function renderAccueil() {
  const budget = totalBudget(state.month);
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
    ...allEnvelopes().map((env) => ({ part: perEnv[env.id] || 0, couleur: env.couleur })),
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

  /* « Il te reste » mesure les BUDGETS (ce qui est prévu), « Solde » les REVENUS (ce qui est
     entré). Quand les budgets promettent plus que les revenus, le premier chiffre est flatteur :
     on le dit, au lieu de laisser deux « reste » se contredire. */
  const incomeNow = totalIncome(state.month);
  const warn = $("#total-warn");
  const overPromised = incomesOf(state.month).length > 0 && budget > incomeNow;
  warn.hidden = !overPromised;
  if (overPromised)
    warn.textContent = `Tes budgets (${money(budget)}) dépassent tes revenus du mois (${money(incomeNow)}) de ${money(budget - incomeNow)}.`;

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
    $("#flow-net-k").textContent = net < 0 ? "Déficit" : "Épargné";
  }

  $("#toggle-manage").textContent = state.managing ? "Terminé" : "Gérer";
  $("#toggle-manage").classList.toggle("on", state.managing);

  /* Tri « plus entamées » : les enveloppes les plus proches de la limite (ou
     déjà dépassées) remontent en tête — c'est là qu'il y a quelque chose à
     faire. En mode Gérer l'ordre est celui que l'on règle, donc toujours le sien. */
  const byUse = state.data.settings.envSort === "entame" && !state.managing;
  const budgetHere = (e) => budgetOf(e, state.month);
  const use = (e) => (budgetHere(e) > 0 ? (perEnv[e.id] || 0) / budgetHere(e) : perEnv[e.id] ? Infinity : 0);
  const shown = state.managing ? envelopes() : envelopesFor(state.month);
  if (byUse) shown.sort((a, b) => use(b) - use(a));
  const sortBtn = $("#toggle-sort");
  sortBtn.hidden = state.managing;
  sortBtn.textContent = byUse ? "↓ Plus entamées" : "↓ Mon ordre";
  sortBtn.setAttribute("aria-label", byUse ? "Tri : plus entamées d'abord. Revenir à mon ordre" : "Tri : mon ordre. Trier par enveloppe la plus entamée");

  const list = $("#env-list");
  list.replaceChildren();

  for (const env of shown) {
    const spentHere = perEnv[env.id] || 0;
    const envBudget = budgetHere(env);
    const carried = carryIn(env, state.month);
    const over = spentHere > envBudget;
    const pct = envBudget > 0 ? Math.round((spentHere / envBudget) * 100) : spentHere > 0 ? 100 : 0;

    const row = document.createElement("button");
    row.type = "button";
    row.className = "env" + (over ? " is-over" : "");
    row.style.setProperty("--c", env.couleur);
    row.dataset.env = env.id;

    const head = document.createElement("span");
    head.className = "env-head";
    const dot = badge("env-dot", env.couleur, initialOf(env.nom));
    const name = document.createElement("b");
    name.className = "env-n";
    name.textContent = env.nom;
    const amount = document.createElement("span");
    amount.className = "env-a";
    amount.textContent = over ? `−${money(spentHere - envBudget)}` : money(envBudget - spentHere);
    head.append(dot, name, amount);

    const foot = document.createElement("span");
    foot.className = "env-foot";
    const sub = document.createElement("span");
    sub.className = "env-sub";
    sub.textContent =
      `${over ? "dépassé" : "restants"} sur ${money(envBudget)}` +
      (carried ? ` (dont ${money(carried)} reportés)` : "") +
      (env.archivee ? " · archivée" : "");
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
    const archived = state.data.envelopes.filter((e) => e.archivee);
    if (archived.length) {
      const head = document.createElement("p");
      head.className = "manage-hint";
      head.textContent = "Archivées — l'historique reste, la saisie est fermée";
      list.append(head);
      for (const env of archived) {
        const row = document.createElement("div");
        row.className = "env-archived";
        row.append(badge("env-dot", env.couleur, initialOf(env.nom)));
        const name = document.createElement("span");
        name.textContent = env.nom;
        const back = document.createElement("button");
        back.type = "button";
        back.className = "btn btn-sm";
        back.dataset.restore = env.id;
        back.textContent = "Restaurer";
        row.append(name, back);
        list.append(row);
      }
    }
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

  if (!envelopes().length)
    list.append(emptyBlock("Aucune enveloppe", "Ajoute un poste de dépense pour commencer.", { label: "Créer une enveloppe", run: () => openEnvSheet(null) }, "wallet"));
  renderGoals();
}

/* ---------------------------------------------------------- objectifs d'épargne */

/** Ce qu'il faut mettre de côté chaque mois pour tenir l'échéance (mois en cours compris). */
function goalMonthly(g) {
  if (!g.echeance) return null;
  const left = g.cible - g.epargne;
  if (left <= 0) return 0;
  const [y1, m1] = todayIso().slice(0, 7).split("-").map(Number);
  const [y2, m2] = g.echeance.split("-").map(Number);
  const months = (y2 - y1) * 12 + (m2 - m1) + 1;
  return months < 1 ? null : Math.ceil(left / months);
}

function renderGoals() {
  const list = $("#goal-list");
  list.replaceChildren();
  const goals = state.data.goals;
  if (!goals.length) {
    list.append(emptyBlock("Aucun objectif", "Vacances, fonds d'urgence… fixe un montant et suis ta progression.", { label: "Créer un objectif", run: () => openGoalSheet(null) }, "target"));
    return;
  }
  for (const g of goals) {
    const pct = Math.min(100, Math.round((g.epargne / g.cible) * 100));
    const done = g.epargne >= g.cible;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "goal" + (done ? " is-done" : "");
    row.dataset.goal = g.id;

    const head = document.createElement("span");
    head.className = "goal-head";
    const name = document.createElement("b");
    name.className = "goal-n";
    name.textContent = g.nom;
    const amount = document.createElement("span");
    amount.className = "goal-a";
    amount.textContent = `${money(g.epargne)} / ${money(g.cible)}`;
    head.append(name, amount);

    const track = document.createElement("span");
    track.className = "goal-track";
    const fill = document.createElement("i");
    fill.style.width = `${pct}%`;
    track.append(fill);

    const sub = document.createElement("span");
    sub.className = "goal-sub";
    const monthly = goalMonthly(g);
    sub.textContent = done
      ? "Objectif atteint"
      : `${pct} %` +
        (g.echeance ? ` · pour ${monthName(g.echeance).toLowerCase()} ${g.echeance.slice(0, 4)}` : "") +
        (monthly ? ` · ${money(monthly)} par mois` : "");

    row.append(head, track, sub);
    row.setAttribute("aria-label", `${g.nom}, ${money(g.epargne)} sur ${money(g.cible)}, ${pct} %`);
    list.append(row);
  }
}

function openGoalSheet(goal) {
  state.editingGoal = goal ? goal.id : null;
  $("#goal-title").textContent = goal ? "Modifier l'objectif" : "Nouvel objectif";
  $("#goal-name").value = goal ? goal.nom : "";
  $("#goal-target").value = goal ? toInput(goal.cible) : "";
  $("#goal-saved").value = goal && goal.epargne ? toInput(goal.epargne) : "";
  $("#goal-date").value = goal?.echeance ?? "";
  $("#goal-deposit").value = "";
  $("#goal-name-error").hidden = true;
  $("#goal-target-error").hidden = true;
  $("#goal-delete").hidden = !goal;
  $("#goal-deposit-block").hidden = !goal;
  updateGoalPace();
  openSheet("#sheet-goal");
}

function updateGoalPace() {
  const cible = parseAmount($("#goal-target").value);
  const saved = parseAmount($("#goal-saved").value) ?? 0;
  const echeance = $("#goal-date").value;
  const hint = $("#goal-pace");
  const monthly = cible && echeance ? goalMonthly({ cible, epargne: saved, echeance }) : null;
  hint.hidden = !monthly;
  if (monthly) hint.textContent = `Pour y arriver : ${money(monthly)} à mettre de côté chaque mois.`;
}
for (const id of ["#goal-target", "#goal-saved", "#goal-date"]) $(id).addEventListener("input", updateGoalPace);

$("#goal-add").addEventListener("click", () => openGoalSheet(null));
$("#goal-list").addEventListener("click", (e) => {
  const row = e.target.closest("[data-goal]");
  const goal = row && state.data.goals.find((g) => g.id === row.dataset.goal);
  if (goal) openGoalSheet(goal);
});

$("#goal-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const nom = $("#goal-name").value.trim();
  const cible = parseAmount($("#goal-target").value);
  $("#goal-name-error").hidden = Boolean(nom);
  $("#goal-target-error").hidden = cible !== null;
  if (!nom) return $("#goal-name").focus();
  if (cible === null) return $("#goal-target").focus();
  const payload = {
    nom,
    cible,
    epargne: parseAmount($("#goal-saved").value) ?? 0,
    echeance: $("#goal-date").value || null,
  };
  if (state.editingGoal) {
    const goal = state.data.goals.find((g) => g.id === state.editingGoal);
    const restore = snapshotOf(goal);
    Object.assign(goal, payload);
    save();
    closeSheets();
    render();
    return offerUndo("Objectif modifié.", restore);
  }
  state.data.goals.push({ id: uid(), createdAt: Date.now(), ...payload });
  save();
  closeSheets();
  render();
  toast("Objectif créé.");
});

$("#goal-deposit-btn").addEventListener("click", () => {
  const goal = state.data.goals.find((g) => g.id === state.editingGoal);
  const cents = parseAmount($("#goal-deposit").value);
  if (!goal || cents === null) return toast("Entre un montant à verser.");
  const restore = snapshotOf(goal);
  goal.epargne += cents;
  save();
  closeSheets();
  render();
  offerUndo(goal.epargne >= goal.cible ? `${money(cents)} versés — objectif atteint !` : `${money(cents)} versés sur « ${goal.nom} ».`, restore);
});

$("#goal-delete").addEventListener("click", (e) => {
  const goal = state.data.goals.find((g) => g.id === state.editingGoal);
  armDanger(e.currentTarget, "Confirmer la suppression ?", () => {
    state.data.goals = state.data.goals.filter((g) => g.id !== state.editingGoal);
    save();
    closeSheets();
    render();
    offerUndo("Objectif supprimé.", () => {
      if (goal) state.data.goals.push(goal);
    });
  });
});

const EMPTY_ICONS = {
  list: '<path d="M5 4.5h14v15l-2.3-1.6-2.4 1.6-2.3-1.6-2.4 1.6-2.3-1.6L5 19.5z"/><path d="M8.5 9h7M8.5 12.5h7"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l5-5"/>',
  chart: '<path d="M5.5 20V11M12 20V4.5M18.5 20v-6.5"/>',
  repeat: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L20 9.2M20 4.7v4.5h-4.5M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4 14.8M4 19.3v-4.5h4.5"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><path d="M4 7.5V17a2 2 0 0 0 2 2h13V8H6.5A2.5 2.5 0 0 1 4 7.5z"/><circle cx="15.5" cy="13.5" r="1"/>',
};

function emptyBlock(title, sub, action, icon) {
  const box = document.createElement("div");
  box.className = "empty";
  if (icon && EMPTY_ICONS[icon]) {
    const art = document.createElementNS(SVG_NS, "svg");
    art.setAttribute("viewBox", "0 0 24 24");
    art.setAttribute("aria-hidden", "true");
    art.setAttribute("class", "empty-art");
    art.innerHTML = EMPTY_ICONS[icon]; // chaînes statiques ci-dessus, jamais de donnée saisie
    box.append(art);
  }
  const b = document.createElement("b");
  b.textContent = title;
  const s = document.createElement("span");
  s.textContent = sub;
  box.append(b, s);
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm empty-action";
    btn.textContent = action.label;
    btn.addEventListener("click", action.run);
    box.append(btn);
  }
  return box;
}

/* ---- filtres de la liste : période et montant ---- */

const PERIOD_LABEL = {
  "30j": "sur 30 jours",
  "3m": "sur 3 mois",
  annee: "depuis le début de l'année",
  tout: "dans tout l'historique",
};

/** Bornes ISO [du, au] de la période choisie, ou null pour « le mois affiché » / « tout ». */
function periodRange() {
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  switch (state.period) {
    case "30j": {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      return { from: isoDay(d), to: today };
    }
    case "3m": return { from: `${shiftMonth(thisMonth, -2)}-01`, to: today };
    case "annee": return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "perso": return { from: state.dateFrom || "0000-00-00", to: state.dateTo || "9999-99-99" };
    default: return null;
  }
}

/** Nombre de réglages de filtre qui s'écartent de l'affichage par défaut. */
const activeFilters = () =>
  (state.period !== "mois" ? 1 : 0) +
  (state.amountMin !== null ? 1 : 0) +
  (state.amountMax !== null ? 1 : 0) +
  (state.onlyAvoidable ? 1 : 0);

function renderFilters() {
  const n = activeFilters();
  $("#filters").hidden = !state.filtersOpen;
  $("#filters-toggle").setAttribute("aria-expanded", String(state.filtersOpen));
  $("#filters-toggle").classList.toggle("on", state.filtersOpen || n > 0);
  $("#filters-count").hidden = !n;
  $("#filters-count").textContent = String(n);
  $("#filters-reset").hidden = !n;
  $("#range-dates").hidden = state.period !== "perso";
  for (const b of document.querySelectorAll("[data-period]")) {
    const on = b.dataset.period === state.period;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
  $("#filter-avoidable").classList.toggle("on", state.onlyAvoidable);
  $("#filter-avoidable").setAttribute("aria-pressed", String(state.onlyAvoidable));
  $("#select-toggle").textContent = state.selecting ? "Terminer" : "Sélectionner";
  $("#select-toggle").setAttribute("aria-pressed", String(state.selecting));
  $("#select-toggle").classList.toggle("on", state.selecting);
}

const keyOf = (tx) => `${tx.kind}:${tx.id}`;

function renderDepenses() {
  const list = $("#tx-list");
  list.replaceChildren();

  const filter = state.filterEnv ? envById(state.filterEnv) : null;
  $("#filter-bar").hidden = !filter;
  if (filter) $("#filter-label").textContent = `Enveloppe : ${filter.nom}`;
  $("#clear-search").hidden = !state.query;
  renderFilters();

  const query = state.query.trim().toLowerCase();
  const range = periodRange();

  /* Une recherche porte sur TOUT l'historique, pas sur le seul mois affiché.
     Chercher « boulangerie » et ne fouiller que septembre, c'est ne pas chercher :
     on retrouvait une ligne sur deux sans jamais savoir que l'autre existait.
     Une période choisie explicitement reprend la main : elle borne aussi la recherche. */
  const searching = Boolean(query);
  const wide = searching || state.period !== "mois";
  const pool = wide
    ? [state.data.expenses, state.data.incomes]
    : [expensesOf(state.month), incomesOf(state.month)];
  let items = [
    ...pool[0].map((t) => ({ ...t, kind: "depense" })),
    ...pool[1].map((t) => ({ ...t, kind: "revenu" })),
  ];

  if (range) items = items.filter((t) => t.date >= range.from && t.date <= range.to);
  if (state.amountMin !== null) items = items.filter((t) => t.montant >= state.amountMin);
  if (state.amountMax !== null) items = items.filter((t) => t.montant <= state.amountMax);
  if (state.onlyAvoidable) items = items.filter((t) => t.kind === "depense" && isAvoidable(t));

  // un filtre d'enveloppe ne s'applique qu'aux dépenses : un revenu n'en a pas
  if (filter) items = items.filter((t) => t.kind === "depense" && t.envelopeId === filter.id);

  if (query) {
    items = items.filter((t) => {
      const where = t.kind === "revenu" ? "revenu" : envById(t.envelopeId)?.nom ?? "sans enveloppe";
      return `${t.libelle ?? ""} ${where}`.toLowerCase().includes(query);
    });
  }

  items.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)));

  /* Sur plusieurs années, « Tout » fait des milliers de lignes : on n'en monte que
     soixante à la fois. Le compteur et « Tout sélectionner » portent, eux, sur tout. */
  const limitKey = [state.month, state.query, state.period, state.dateFrom, state.dateTo, state.amountMin, state.amountMax, state.onlyAvoidable, state.filterEnv].join("|");
  if (state.limitKey !== limitKey) {
    state.limitKey = limitKey;
    state.limit = PAGE_SIZE;
  }
  state.itemKeys = items.map(keyOf);
  const allItems = items;
  items = items.slice(0, state.limit);

  // la sélection ne garde que ce qui est encore affiché
  const shownKeys = new Set(state.itemKeys);
  for (const k of state.picked) if (!shownKeys.has(k)) state.picked.delete(k);
  renderBulkBar(allItems);

  // un filtre ou une recherche pose une question chiffrée (« combien chez eux ? ») :
  // le total de ce qui est affiché est la réponse, il n'a pas à être fait de tête
  const sum = $("#tx-sum");
  sum.hidden = !(searching || filter || activeFilters()) || !allItems.length;
  if (!sum.hidden) {
    const items = allItems;
    const out = items.filter((t) => t.kind === "depense").reduce((n, t) => n + t.montant, 0);
    const inc = items.filter((t) => t.kind === "revenu").reduce((n, t) => n + t.montant, 0);
    const bits = [`${items.length} mouvement${items.length > 1 ? "s" : ""}`];
    if (state.period === "perso") bits[0] += " sur la période choisie";
    else if (PERIOD_LABEL[state.period]) bits[0] += ` ${PERIOD_LABEL[state.period]}`;
    else if (searching) bits[0] += " dans tout l'historique";
    if (out) bits.push(`−${money(out)}`);
    if (inc) bits.push(`+${money(inc)}`);
    sum.textContent = bits.join(" · ");
  }

  if (!items.length) {
    const narrowed = Boolean(query) || Boolean(filter) || activeFilters() > 0;
    list.append(
      emptyBlock(
        query || activeFilters() ? "Rien trouvé" : "Rien pour ce mois-ci",
        query
          ? "Aucun mouvement ne correspond à cette recherche."
          : activeFilters()
            ? "Aucun mouvement ne correspond à ces filtres."
            : filter
              ? "Aucune dépense dans cette enveloppe."
              : narrowed
                ? "Rien à afficher."
                : "Touche le bouton + pour noter une dépense ou un revenu.",
        !query && !activeFilters() && !filter ? { label: "Ajouter une dépense", run: () => openTxSheet(null) } : undefined,
        "list"
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
      head.textContent = dayHeading(tx.date, wide);
      list.append(head);
    }

    const revenu = tx.kind === "revenu";
    const env = revenu ? null : envById(tx.envelopeId);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tx";
    row.dataset.tx = tx.id;
    row.dataset.kind = tx.kind;

    if (state.selecting) {
      const picked = state.picked.has(keyOf(tx));
      row.classList.toggle("is-picked", picked);
      row.setAttribute("role", "checkbox");
      row.setAttribute("aria-checked", String(picked));
      const box = document.createElement("span");
      box.className = "tx-check";
      box.setAttribute("aria-hidden", "true");
      row.append(box);
    }

    const dot = badge(
      "tx-dot",
      revenu ? "var(--positive)" : env ? env.couleur : "#9AA0AC",
      revenu ? "+" : env ? initialOf(env.nom) : "?"
    );

    const text = document.createElement("span");
    text.className = "tx-t";
    const label = document.createElement("b");
    label.textContent =
      (tx.recurringId ? "↻ " : "") + (tx.libelle || (revenu ? "Revenu" : env ? env.nom : "Dépense"));
    const sub = document.createElement("span");
    sub.textContent =
      (revenu ? "Revenu" : env ? env.nom : "Sans enveloppe") + (!revenu && isAvoidable(tx) ? " · évitable" : "");
    text.append(label, sub);

    const amount = document.createElement("span");
    amount.className = `tx-a ${revenu ? "is-income" : "is-expense"}`;
    amount.textContent = `${revenu ? "+" : "−"}${money(tx.montant)}`;

    row.append(dot, text, amount);
    list.append(row);
  }

  if (allItems.length > items.length) {
    const more = document.createElement("button");
    more.type = "button";
    more.id = "tx-more";
    more.className = "btn more-btn";
    more.textContent = `Afficher plus (${allItems.length - items.length} restants)`;
    list.append(more);
  }
}

const PAGE_SIZE = 60;

/** Barre d'actions du mode sélection : compteur, « tout », et ce qu'on peut faire. */
function renderBulkBar(items) {
  if (!state.selecting) return;
  const n = state.picked.size;
  $("#bulk-count").textContent = n ? `${n} sélectionné${n > 1 ? "s" : ""}` : "Touche des lignes pour les choisir";
  $("#bulk-all").textContent = n && n === items.length ? "Tout désélectionner" : "Tout sélectionner";
  $("#bulk-all").hidden = !items.length;
  $("#bulk-edit").disabled = !n;
  $("#bulk-delete").disabled = !n;
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

  // la part « évitable » : dépenses étiquetées (ou rangées dans une enveloppe nommée ainsi)
  const avoidable = avoidableSpent(state.month);
  $("#bilan-evitable").hidden = !avoidable;
  if (avoidable) {
    $("#bilan-evitable").style.setProperty("--c", EVITABLE_COLOR);
    const part = Math.round((avoidable / spent) * 100);
    $("#bilan-evitable").textContent = `dont évitable ${money(avoidable)} · ${part} % des dépenses`;
  }

  /* Fenêtre du graphique : six mois (défaut), douze mois, ou l'année civile du mois affiché.
     À douze barres il n'y a plus de place pour un montant sous chacune : seule la barre
     choisie porte le sien, et les mois s'abrègent à leur initiale. */
  const mode = state.data.settings.histMode;
  const keys = [];
  if (mode === "annee") for (let m = 1; m <= 12; m++) keys.push(`${state.month.slice(0, 4)}-${pad(m)}`);
  else for (let i = (mode === "12" ? 11 : 5); i >= 0; i--) keys.push(shiftMonth(state.month, -i));
  const dense = keys.length > 6;
  const totals = keys.map((k) => totalSpent(k));
  const max = Math.max(...totals, 1);

  $("#hist-title").textContent =
    mode === "annee" ? `Année ${state.month.slice(0, 4)}` : mode === "12" ? "12 derniers mois" : "Six derniers mois";
  for (const b of document.querySelectorAll("[data-hist]")) {
    const on = b.dataset.hist === mode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }

  const hist = $("#hist");
  const labels = $("#hist-labels");
  hist.replaceChildren();
  labels.replaceChildren();
  // à douze barres, le montant du mois choisi se lit dans une ligne au-dessus du graphique
  const note = $("#hist-note");
  note.hidden = !dense;
  if (dense) {
    const at = keys.indexOf(state.month);
    note.textContent = at >= 0 ? `${monthName(state.month)} ${state.month.slice(0, 4)} : ${money(totals[at])}` : "Touche un mois pour le détail";
    note.classList.toggle("is-empty", at < 0);
  }
  hist.classList.toggle("dense", dense);
  labels.classList.toggle("dense", dense);
  // les barres portaient un title= : illisible au doigt, et surtout inerte —
  // le geste évident (toucher un mois pour l'ouvrir) ne faisait rien
  keys.forEach((key, i) => {
    const bar = document.createElement("button");
    bar.type = "button";
    bar.dataset.month = key;
    bar.style.setProperty("--h", `${Math.max((totals[i] / max) * 100, 3)}%`);
    if (key === state.month) bar.classList.add("on");
    if (!totals[i]) bar.classList.add("is-empty");
    // le total au-dessus de sa barre : sans lui il faut toucher chaque mois pour le connaître
    const amount = document.createElement("span");
    amount.className = "hist-v";
    amount.setAttribute("aria-hidden", "true");
    amount.textContent = totals[i] ? compactMoney(totals[i]) : "–";
    bar.append(amount);
    bar.setAttribute("aria-label", `${monthName(key)} : ${money(totals[i])}`);
    bar.title = `${monthName(key)} : ${money(totals[i])}`;
    hist.append(bar);

    const tag = document.createElement("span");
    tag.textContent = dense ? monthName(key, "narrow") : monthName(key, "short").replace(".", "");
    labels.append(tag);
  });

  renderTrend(keys);
  renderRepartition(spent);
}

/* Par enveloppe : sur la fenêtre du graphique, la dépense de chaque mois en petites barres,
   la moyenne mensuelle, et sa place par rapport au budget d'aujourd'hui. Toucher une ligne
   ouvre ses dépenses sur cette période. */
function renderTrend(keys) {
  const box = $("#env-trend");
  box.replaceChildren();
  const table = spentTable();
  const rows = allEnvelopes()
    .map((env) => {
      const series = keys.map((k) => table[k]?.[env.id] || 0);
      return { env, series, total: series.reduce((a, b) => a + b, 0) };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  $("#trend-title").textContent = `Par enveloppe · ${keys.length === 12 ? "12 mois" : keys.length === 6 ? "6 mois" : "année"}`;
  if (!rows.length) {
    box.append(emptyBlock("Rien à comparer", "Les dépenses des mois affichés apparaîtront ici, enveloppe par enveloppe.", undefined, "chart"));
    return;
  }
  const nonEmpty = keys.filter((k) => totalSpent(k) > 0).length || 1;
  for (const { env, series, total } of rows) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "trend";
    row.dataset.trend = env.id;
    row.style.setProperty("--c", env.couleur);

    const text = document.createElement("span");
    text.className = "trend-t";
    const name = document.createElement("b");
    name.textContent = env.nom;
    const avg = Math.round(total / nonEmpty);
    const budget = budgetFor(env, todayIso().slice(0, 7));
    const sub = document.createElement("span");
    sub.textContent = `moy. ${compactMoney(avg)}/mois` + (budget ? ` · budget ${compactMoney(budget)}` : "");
    if (budget && avg > budget) sub.classList.add("is-over");
    text.append(name, sub);

    const spark = document.createElement("span");
    spark.className = "spark";
    spark.setAttribute("aria-hidden", "true");
    const peak = Math.max(...series, 1);
    series.forEach((v, i) => {
      const bar = document.createElement("i");
      bar.style.height = `${Math.max((v / peak) * 100, 6)}%`;
      if (v > 0) bar.classList.add("on");
      spark.append(bar);
      void i;
    });

    const amount = document.createElement("span");
    amount.className = "trend-a";
    amount.textContent = money(total);

    row.append(badge("env-dot", env.couleur, initialOf(env.nom)), text, spark, amount);
    row.setAttribute("aria-label", `${env.nom} : ${money(total)} sur la période, moyenne ${money(avg)} par mois`);
    row.dataset.from = `${keys[0]}-01`;
    row.dataset.to = `${keys[keys.length - 1]}-${pad(daysIn(keys[keys.length - 1]))}`;
    box.append(row);
  }
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
    ...allEnvelopes().map((e) => ({ id: e.id, nom: e.nom, couleur: e.couleur, value: perEnv[e.id] || 0 })),
    { id: NO_ENV, nom: "Sans enveloppe", couleur: null, value: perEnv[NO_ENV] || 0 },
  ]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  $("#chart").hidden = !rows.length;
  $("#chart-mode").hidden = !rows.length; // rien à mettre en forme sans dépense
  if (!rows.length) {
    legend.append(emptyBlock("Aucune dépense", "Le bilan se remplit dès la première dépense du mois.", { label: "Ajouter une dépense", run: () => openTxSheet(null) }, "chart"));
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

    const dot = badge(
      "legend-dot" + (row.couleur ? "" : " is-other"),
      row.couleur || "#6E7686",
      row.id === NO_ENV ? "?" : row.couleur ? initialOf(row.nom) : "…"
    );

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
  const last = state.data.settings.lastExport;
  $("#backup-stat").textContent = last
    ? `Dernière sauvegarde : ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(last)} (il y a ${Math.floor((Date.now() - last) / DAY_MS)} jour${Math.floor((Date.now() - last) / DAY_MS) > 1 ? "s" : ""}).`
    : "Jamais sauvegardé : exporte un fichier pour ne rien perdre.";
  $("#backup-stat").classList.toggle("is-warn", !last || Date.now() - last > 30 * DAY_MS);
  $("#persist-stat").textContent =
    storagePersisted === null
      ? ""
      : storagePersisted
        ? "Stockage protégé contre le nettoyage automatique."
        : "Stockage non protégé : installe l'appli sur l'écran d'accueil et sauvegarde régulièrement.";
  $("#version").textContent = `Mon Budget ${APP_VERSION}`;
  // déjà installée : la carte d'instructions n'a plus rien à apprendre
  const installed = isStandalone();
  $("#install-head").hidden = installed;
  $("#install-card").hidden = installed;
  $("#install-stat").textContent = "Ouverte dans le navigateur : installe-la pour gagner la place de la barre d'outils.";

  // un fichier local (double-clic), ou l'appli de bureau sur son hôte interne,
  // n'a pas d'adresse qu'un raccourci sur un autre appareil puisse rouvrir
  const local = /^(localhost|127\.0\.0\.1|(.*\.)?tauri\.localhost)$/i.test(location.hostname);
  const online = /^https?:$/.test(location.protocol) && !local;
  $("#shortcut-linkbox").hidden = !online;
  $("#shortcut-unavailable").hidden = online;
  if (online) $("#shortcut-link").value = `${location.origin}${location.pathname}?ajouter=1&montant=`;
}

/* ---------------------------------------------------------- récurrent : calendrier + listes */

/** Prochaines échéances dans les 7 jours : règles actives dont la date tombe d'ici là
    et qui n'ont pas déjà été tamponnées pour ce mois-ci. */
function upcomingRules() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const out = [];
  for (const rule of recurringRules().filter((r) => r.actif)) {
    for (const delta of [0, 1]) {
      const month = shiftMonth(todayIso().slice(0, 7), delta);
      const day = effDay(rule, month);
      const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, day);
      const days = Math.round((date - start) / 86400000);
      if (days < 0 || days > 7) continue;
      const list = rule.type === "revenu" ? state.data.incomes : state.data.expenses;
      // déjà tombée ce mois-ci : elle est dans l'historique, pas « à venir »
      if (list.some((t) => t.recurringId === rule.id && monthOf(t.date) === month)) continue;
      out.push({ rule, days, date });
      break;
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

function renderUpcoming() {
  const list = $("#upcoming-list");
  list.replaceChildren();
  const items = upcomingRules();
  if (!items.length) {
    list.append(emptyBlock("Rien dans les 7 jours", "Aucune échéance récurrente n'est attendue d'ici là."));
    list.firstChild.style.padding = "10px 8px 14px";
  }
  for (const { rule, days, date } of items) {
    const icon = iconFor(rule);
    const row = document.createElement("div");
    row.className = "up-row";
    const chip = document.createElement("span");
    chip.className = "chip chip-sm";
    chip.style.setProperty("--c", icon.couleur);
    chip.style.setProperty("--on", onColor(icon.couleur));
    chip.textContent = icon.mono;
    chip.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "tx-t";
    const name = document.createElement("b");
    name.textContent = rule.libelle;
    const sub = document.createElement("span");
    sub.textContent = days === 0 ? "Aujourd'hui" : days === 1 ? "Demain" : `Dans ${days} jours · ${capitalize(longDate(date))}`;
    text.append(name, sub);
    const amount = document.createElement("span");
    amount.className = "tx-a " + (rule.type === "revenu" ? "is-income" : "is-expense");
    amount.textContent = (rule.type === "revenu" ? "+" : "−") + money(rule.montant);
    row.append(chip, text, amount);
    list.append(row);
  }

  // charges fixes contre revenus récurrents : ce qui reste une fois le fixe payé
  const sum = (type) => recurringRules(type).filter((r) => r.actif).reduce((n, r) => n + r.montant, 0);
  const fixed = sum("depense");
  const incomes = sum("revenu");
  const free = incomes - fixed;
  const box = $("#fixed-sum");
  box.hidden = !fixed && !incomes;
  box.replaceChildren();
  for (const [k, v, cls] of [
    ["Charges fixes", `−${money(fixed)}`, "is-expense"],
    ["Revenus fixes", `+${money(incomes)}`, "is-income"],
    [free < 0 ? "Manque" : "Reste libre", `${free < 0 ? "−" : "+"}${money(Math.abs(free))}`, free < 0 ? "is-expense" : "is-income"],
  ]) {
    const cell = document.createElement("div");
    const kk = document.createElement("p");
    kk.className = "flow-k";
    kk.textContent = k;
    const vv = document.createElement("p");
    vv.className = `flow-v ${cls}`;
    vv.textContent = v;
    cell.append(kk, vv);
    box.append(cell);
  }
}

function renderRecurrent() {
  renderUpcoming();
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
    const here = rules.filter((r) => effDay(r, state.month) === day);

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

  const items = monthRules.filter((r) => effDay(r, state.month) === day);
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
    chip.style.setProperty("--on", onColor(icon.couleur));
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
    chip.style.setProperty("--on", onColor(icon.couleur));
    chip.textContent = icon.mono;

    const text = document.createElement("span");
    text.className = "tx-t";
    const name = document.createElement("b");
    name.textContent = rule.libelle;
    const sub = document.createElement("span");
    const where = type === "revenu" ? "Revenu" : (envById(rule.envelopeId)?.nom ?? "");
    sub.textContent = rule.actif
      ? `${where} · ${rule.jour > 28 ? `le ${rule.jour} (ou fin de mois)` : `le ${rule.jour}`}`
      : `${where} · en pause`;
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

let opener = null;

function openSheet(id) {
  clearTimeout(closeTimer);
  // le déclencheur n'est retenu qu'à la PREMIÈRE ouverture : passer d'un tiroir à l'autre ne le perd pas
  if (!document.querySelector(".sheet.show")) opener = document.activeElement;
  $(".app").inert = true; // ni Tab ni VoiceOver n'atteignent ce qui est derrière
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
    sheet.tabIndex = -1;
    sheet.focus({ preventScroll: true }); // la saisie du montant reprend ensuite la main, si elle doit
  });
}

function closeSheets() {
  clearTimeout(closeTimer);
  if (document.querySelector(".sheet.show")) {
    if ($("#onboard").hidden) $(".app").inert = false;
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
  }
  $("#scrim").classList.remove("show");
  for (const sheet of document.querySelectorAll(".sheet")) sheet.classList.remove("show");
  closeTimer = setTimeout(() => {
    for (const sheet of document.querySelectorAll(".sheet")) sheet.hidden = true;
    $("#scrim").hidden = true;
  }, 280);
  disarmAll();
}

/* Clavier à l'écran. Sur iPhone, quand le clavier monte, c'est la fenêtre VISIBLE
   (visualViewport) qui rétrécit ; la fenêtre de mise en page ne bouge pas, et un
   tiroir « bottom:0 » reste donc planqué DERRIÈRE le clavier — sur un SE, il ne
   restait de visible que la poignée. On mesure l'écart et on remonte le tiroir
   d'autant, en limitant sa hauteur à ce qui est réellement visible. */
function fitSheetsToViewport() {
  const vv = window.visualViewport;
  const root = document.documentElement.style;
  if (!vv) return;
  const keyboard = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  root.setProperty("--kb", `${keyboard}px`);
  root.setProperty("--vvh", `${Math.round(vv.height)}px`);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fitSheetsToViewport);
  window.visualViewport.addEventListener("scroll", fitSheetsToViewport);
}
// le champ touché doit rester visible : on le ramène au centre du tiroir une fois le clavier levé
document.addEventListener("focusin", (e) => {
  if (!e.target.closest?.(".sheet") || !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 320);
});

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
  // la suggestion d'après le libellé ne pousse jamais contre un choix déjà fait
  state.draftEnvManual = Boolean(tx || prefill?.envId);
  state.draftEvManual = Boolean(tx || prefill);
  $("#tx-amount").value = tx ? toInput(tx.montant) : (prefill?.montantText ?? "");
  sizeAmountInput($("#tx-amount"));
  $("#tx-label").value = tx ? tx.libelle : (prefill?.libelle ?? "");
  $("#tx-date").value = tx ? tx.date : todayIso();
  $("#tx-evitable").checked = Boolean(tx ? tx.evitable : prefill?.evitable);
  $("#tx-amount-error").hidden = true;
  $("#tx-delete").hidden = !tx;
  $("#tx-duplicate").hidden = !tx;

  renderTxEnvPicker();
  updateTxTypeUI(Boolean(tx));
  updateLabelSuggestions();

  openSheet("#sheet-tx");
  // un montant déjà rempli n'a pas besoin du clavier ; sinon on le propose tout de suite
  if (!tx && !prefill?.montantText) setTimeout(() => $("#tx-amount").focus(), 320);
}

/* ---- suggestion d'enveloppe d'après le libellé ----
   « Monoprix » a déjà été rangé douze fois dans Courses : inutile de le redemander.
   On regroupe les dépenses passées par libellé (sans accent ni casse) ; si ce qui est
   tapé désigne UN libellé connu, son enveloppe la plus fréquente est présélectionnée,
   et trois suggestions s'offrent en un geste. Un choix manuel arrête tout. */
function labelGroups(query) {
  const q = noAccent(query);
  if (q.length < 2) return [];
  const groups = new Map();
  for (const t of state.data.expenses) {
    if (!t.libelle) continue;
    const key = noAccent(t.libelle);
    if (!(key.startsWith(q) || key.split(/\s+/).some((w) => w.startsWith(q)))) continue;
    const g = groups.get(key) || { key, label: t.libelle, n: 0, last: 0, envs: new Map(), ev: 0 };
    const at = Date.parse(t.date) || 0;
    if (at >= g.last) {
      g.last = at;
      g.label = t.libelle;
    }
    g.n++;
    g.envs.set(t.envelopeId, (g.envs.get(t.envelopeId) || 0) + 1);
    if (t.evitable === true) g.ev++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.n - a.n || b.last - a.last);
}
const topEnvOf = (g) => [...g.envs].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

function applyGroup(g, { fill }) {
  const envId = topEnvOf(g);
  if (fill) $("#tx-label").value = g.label;
  if (!state.draftEnvManual && envId && envelopes().some((e) => e.id === envId)) {
    state.draftEnv = envId;
    renderTxEnvPicker();
    $("#env-suggest-hint").textContent = `Rangée dans « ${envById(envId).nom} » comme « ${g.label} » (${g.n} fois).`;
    $("#env-suggest-hint").hidden = false;
  }
  if (!state.draftEvManual) $("#tx-evitable").checked = g.ev * 2 > g.n;
}

function updateLabelSuggestions() {
  const box = $("#label-suggest");
  const hint = $("#env-suggest-hint");
  box.replaceChildren();
  if (state.editingTx || state.draftTxType !== "depense") {
    box.hidden = true;
    hint.hidden = true;
    return;
  }
  const text = $("#tx-label").value;
  const groups = labelGroups(text);
  const typed = noAccent(text);
  for (const g of groups.filter((x) => x.key !== typed).slice(0, 3)) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.suggest = g.key;
    b.textContent = g.label;
    box.append(b);
  }
  box.hidden = !box.children.length;
  const best = groups.find((g) => g.key === typed) || (groups.length === 1 ? groups[0] : null);
  if (best) applyGroup(best, { fill: false });
  else if (!text.trim()) hint.hidden = true;
}

$("#tx-label").addEventListener("input", updateLabelSuggestions);
$("#tx-evitable").addEventListener("change", () => (state.draftEvManual = true));
$("#label-suggest").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-suggest]");
  const g = btn && labelGroups($("#tx-label").value).find((x) => x.key === btn.dataset.suggest);
  if (!g) return;
  applyGroup(g, { fill: true });
  updateLabelSuggestions();
});

function renderTxEnvPicker() {
  const picker = $("#tx-env-picker");
  picker.replaceChildren();
  for (const env of envelopes()) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "radio";
    b.dataset.pick = env.id;
    b.dataset.i = initialOf(env.nom);
    b.textContent = env.nom;
    b.style.setProperty("--c", env.couleur);
    b.style.setProperty("--on", onColor(env.couleur));
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
  $("#tx-evitable-row").hidden = revenu;
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
  $("#env-budget").value = env ? toInput(budgetFor(env, state.month)) : "";
  $("#env-budget-past").checked = false;
  $("#env-past-row").hidden = !env;
  $("#env-report").checked = Boolean(env?.report);
  $("#env-budget-hint").textContent = env
    ? `Ce budget vaut pour ${monthName(state.month).toLowerCase()} ${state.month.slice(0, 4)} et les mois suivants ; les mois précédents gardent le leur.`
    : "";
  $("#env-budget-hint").hidden = !env;
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
  $("#recurring-evitable").checked = Boolean(rule?.evitable);
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
    b.dataset.i = initialOf(env.nom);
    b.textContent = env.nom;
    b.style.setProperty("--c", env.couleur);
    b.style.setProperty("--on", onColor(env.couleur));
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
  $("#recurring-evitable-row").hidden = state.draftRecurringType === "revenu";

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
    b.style.setProperty("--on", onColor(preset.couleur ?? "var(--positive)"));
    b.textContent = preset.mono;
    const on = state.draftRecurringIcon === preset.id;
    b.classList.toggle("on", on);
    b.setAttribute("aria-label", preset.nom);
    b.setAttribute("aria-checked", String(on));
    picker.append(b);
  }
}

/* Glisser la poignée (ou l'en-tête) vers le bas ferme le tiroir : elle le promettait sans le faire. */
let drag = null;
document.addEventListener("pointerdown", (e) => {
  const sheet = e.target.closest(".sheet.show");
  if (!sheet || !e.target.closest(".sheet-grip, .sheet-head") || e.target.closest("button, input")) return;
  drag = { sheet, y: e.clientY, t: performance.now(), dy: 0 };
  sheet.style.transition = "none";
});
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.dy = Math.max(0, e.clientY - drag.y);
  drag.sheet.style.transform = `translateY(${drag.dy}px)`;
});
function endDrag() {
  if (!drag) return;
  const { sheet, dy, t } = drag;
  drag = null;
  const speed = dy / Math.max(1, performance.now() - t);
  sheet.style.transition = "";
  sheet.style.transform = "";
  if (dy > 110 || (dy > 40 && speed > 0.6)) closeSheets();
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);

/* Un groupe `role="radiogroup"` se parcourt aux flèches, comme un vrai : le clavier et
   VoiceOver n'avaient que Tab, et chaque pastille était un arrêt. */
document.addEventListener("keydown", (e) => {
  if (!/^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) return;
  const current = e.target.closest?.('[role="radio"]');
  const group = current?.closest('[role="radiogroup"]');
  if (!group) return;
  const radios = [...group.querySelectorAll('[role="radio"]')].filter((r) => r.closest('[role="radiogroup"]') === group && !r.disabled);
  const at = radios.indexOf(current);
  const next =
    e.key === "Home" ? 0 : e.key === "End" ? radios.length - 1
    : (at + (/Right|Down/.test(e.key) ? 1 : -1) + radios.length) % radios.length;
  e.preventDefault();
  const gid = group.id;
  radios[next].focus();
  radios[next].click();
  // beaucoup de groupes se redessinent au choix : on remet le focus sur le choix retenu
  requestAnimationFrame(() => {
    const g = gid ? document.getElementById(gid) : group;
    (g?.querySelector('[aria-checked="true"]') || g?.querySelector(".on"))?.focus();
  });
});

/* Retour tactile. Safari iOS n'offre pas navigator.vibrate ; depuis iOS 17.4, basculer un
   <input switch> déclenche pourtant le même petit tic. Sans effet (et sans erreur) ailleurs. */
let hapticLabel = null;
function haptic() {
  try {
    if (navigator.vibrate) return void navigator.vibrate(10);
    if (!hapticLabel) {
      hapticLabel = document.createElement("label");
      hapticLabel.setAttribute("aria-hidden", "true");
      hapticLabel.style.cssText = "position:fixed;left:-100px;top:-100px;opacity:0;pointer-events:none";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.setAttribute("switch", "");
      hapticLabel.append(box);
      document.body.append(hapticLabel);
    }
    hapticLabel.click();
  } catch {
    /* pas de retour tactile sur cet appareil */
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
let toastHideTimer;

function hideToast() {
  const el = $("#toast");
  clearTimeout(toastTimer);
  el.classList.remove("show");
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => (el.hidden = true), 260);
}

/** @param {{label:string, run:()=>void}} [action]  bouton d'action (« Annuler ») */
function toast(message, action) {
  const el = $("#toast");
  clearTimeout(toastHideTimer);
  el.replaceChildren(document.createTextNode(message));
  el.classList.toggle("has-action", Boolean(action));
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      hideToast();
      action.run();
    });
    el.append(btn);
  }
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  // un message à lire dure 2,6 s ; une action à saisir laisse le temps du pouce
  toastTimer = setTimeout(hideToast, action ? 7000 : 2600);
}

/** Photographie un objet et rend la fonction qui le remet EXACTEMENT dans cet état
    (y compris en retirant les clés apparues depuis). */
function snapshotOf(obj) {
  const before = { ...obj };
  return () => {
    for (const k of Object.keys(obj)) if (!(k in before)) delete obj[k];
    Object.assign(obj, before);
  };
}

/* Annuler une suppression. Plutôt que de restaurer un instantané de TOUTES les
   données (ce qui effacerait ce qui a été noté dans l'intervalle), chaque
   suppression fournit sa propre remise en place : on ne rend que ce qu'on a pris. */
function offerUndo(message, restore) {
  haptic();
  toast(message, {
    label: "Annuler",
    run: () => {
      haptic();
      restore();
      save();
      render();
      toast("Rétabli.");
    },
  });
}

/* ---------------------------------------------------------- import / export */

/* Sauvegarde. Les données ne vivent que dans cet appareil : la sauvegarde est la seule
   assurance. Sur iPhone installé, le téléchargement par <a download> est peu fiable (rien,
   ou une page JSON blanche) ; le menu Partager (fichier joint) y est le chemin sûr —
   Enregistrer dans Fichiers, AirDrop, Mail, iCloud Drive. */
const DAY_MS = 86400000;

function markExported() {
  state.data.settings.lastExport = Date.now();
  save();
  if (state.view === "reglages") renderReglages();
}

async function exportData() {
  const json = JSON.stringify(state.data, null, 2);
  const name = `mon-budget-${todayIso()}.json`;

  const touch = isStandalone() || /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (touch && navigator.share && navigator.canShare) {
    try {
      const file = new File([json], name, { type: "application/json" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Sauvegarde Mon Budget" });
        markExported();
        return toast("Sauvegarde partagée.");
      }
    } catch (e) {
      if (e?.name === "AbortError") return; // l'utilisateur a refermé la feuille : rien à dire, rien à retenter
      // autre échec : on retombe sur le téléchargement
    }
  }

  try {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    markExported();
    toast("Sauvegarde exportée.");
  } catch {
    navigator.clipboard
      ?.writeText(json)
      .then(() => {
        markExported();
        toast("Téléchargement bloqué : données copiées dans le presse-papiers.");
      })
      .catch(() => toast("Export impossible sur cet appareil."));
  }
}

/** Rappel discret : plus de 30 jours sans sauvegarde, au plus un rappel par semaine. */
function maybeRemindBackup() {
  const d = state.data;
  if (d.expenses.length + d.incomes.length < 10 || needsOnboarding()) return false;
  const now = Date.now();
  const last = d.settings.lastExport || 0;
  if (now - last < 30 * DAY_MS || now - (d.settings.lastReminder || 0) < 7 * DAY_MS) return false;
  d.settings.lastReminder = now;
  save();
  const days = Math.floor((now - last) / DAY_MS);
  toast(
    last ? `Dernière sauvegarde il y a ${days} jours.` : "Tes données n'existent que sur cet appareil : pense à les sauvegarder.",
    { label: "Sauvegarder", run: exportData }
  );
  return true;
}

/** Demande au système de ne pas purger le stockage de l'appli (Safari le fait après sept jours d'inactivité hors installation). */
let storagePersisted = null;
function requestPersistence() {
  const store = navigator.storage;
  if (!store?.persist) return;
  Promise.resolve(store.persisted?.())
    .then((already) => already || store.persist())
    .then((ok) => {
      storagePersisted = Boolean(ok);
      if (state.view === "reglages") renderReglages();
    })
    .catch(() => {});
}

/* ---- import : on lit, on compare, on demande — jamais d'écrasement silencieux ---- */
let pendingImport = null;

const countOf = (d) => ({
  depenses: d.expenses.length,
  revenus: d.incomes.length,
  enveloppes: d.envelopes.length,
  recurrentes: d.recurring.length,
});
const describeCount = (c) =>
  `${c.depenses} dépense${c.depenses > 1 ? "s" : ""}, ${c.revenus} revenu${c.revenus > 1 ? "s" : ""}, ${c.enveloppes} enveloppe${c.enveloppes > 1 ? "s" : ""}, ${c.recurrentes} récurrente${c.recurrentes > 1 ? "s" : ""}`;

function applyImport({ candidate, repaired }) {
  const previous = state.data;
  state.data = candidate;
  state.filterEnv = null;
  state.month = todayIso().slice(0, 7);
  state.calDay = null;
  save();
  generateRecurring();
  render();
  // NB : le message d'import prime sur celui du rattrapage — l'utilisateur
  // vient de faire un geste explicite, c'est de lui qu'on lui parle
  offerUndo(
    repaired
      ? `Importé : ${state.data.expenses.length} dépenses. ${repaired} enregistrement${repaired > 1 ? "s illisibles écartés" : " illisible écarté"}.`
      : `Importé : ${state.data.expenses.length} dépenses.`,
    () => {
      state.data = previous;
    }
  );
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let candidate;
    try {
      const data = JSON.parse(String(reader.result));
      if (!isSane(data)) throw new Error("format");
      candidate = normalizeData(data);
    } catch {
      return toast("Fichier illisible : ce n'est pas une sauvegarde Mon Budget.");
    }
    const incoming = { candidate, repaired: lastRepairCount };
    const current = state.data;
    const empty = !current.expenses.length && !current.incomes.length && !current.recurring.length && !current.goals.length;
    // rien à perdre : on importe directement (l'annulation reste offerte)
    if (empty) return applyImport(incoming);

    pendingImport = incoming;
    $("#import-note").textContent =
      `Ce fichier contient ${describeCount(countOf(candidate))}. ` +
      `Tes données actuelles — ${describeCount(countOf(current))} — seront remplacées. ` +
      `Pense à exporter d'abord si tu veux les garder.`;
    openSheet("#sheet-import");
  };
  reader.onerror = () => toast("Lecture du fichier impossible.");
  reader.readAsText(file);
}

$("#import-confirm").addEventListener("click", () => {
  const incoming = pendingImport;
  pendingImport = null;
  closeSheets();
  if (incoming) applyImport(incoming);
});

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

function showView(view) {
  state.view = view;
  if (state.view !== "depenses") state.filterEnv = null;
  clearFocus();
  // « Tout effacer » vit dans une vue, pas dans un tiroir : sans ça il restait
  // armé pendant qu'on regardait ailleurs, et un retour dans les cinq secondes
  // suffisait à effacer le budget d'un seul appui
  disarmAll();
  render();
}
// onglets de la barre du bas, et engrenage Réglages dans la barre du haut
for (const bar of ["#tabbar", "#topbar"]) {
  $(bar).addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (btn) showView(btn.dataset.view);
  });
}

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

$("#hist-mode").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-hist]");
  if (!btn) return;
  state.data.settings.histMode = btn.dataset.hist;
  save();
  render();
});

$("#env-trend").addEventListener("click", (e) => {
  const row = e.target.closest("[data-trend]");
  if (!row) return;
  state.filterEnv = row.dataset.trend;
  state.query = "";
  $("#tx-search").value = "";
  state.period = "perso";
  state.dateFrom = row.dataset.from;
  state.dateTo = row.dataset.to;
  $("#date-from").value = state.dateFrom;
  $("#date-to").value = state.dateTo;
  state.view = "depenses";
  render();
});

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

$("#toggle-sort").addEventListener("click", () => {
  state.data.settings.envSort = state.data.settings.envSort === "entame" ? "ordre" : "entame";
  save();
  render();
});

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
  const restore = e.target.closest("[data-restore]");
  if (restore) {
    const env = envById(restore.dataset.restore);
    if (env) {
      env.archivee = false;
      env.ordre = state.data.envelopes.length;
      save();
      render();
      toast(`« ${env.nom} » est de retour.`);
    }
    return;
  }
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
  if (e.target.closest("#tx-more")) {
    state.limit += PAGE_SIZE;
    return renderDepenses();
  }
  if (justSwiped) return; // le doigt qui relâche un balayage ne « touche » pas la ligne
  const row = e.target.closest("[data-tx]");
  if (!row) return;
  const kind = row.dataset.kind === "revenu" ? "revenu" : "depense";
  if (state.selecting) {
    const key = `${kind}:${row.dataset.tx}`;
    if (!state.picked.delete(key)) state.picked.add(key);
    disarmAll();
    return renderDepenses();
  }
  const source = kind === "revenu" ? state.data.incomes : state.data.expenses;
  const tx = source.find((t) => t.id === row.dataset.tx);
  if (tx) openTxSheet(tx, null, kind);
});

/* ---- balayage d'une ligne vers la gauche : supprimer (annulable) ----
   « touch-action: pan-y » laisse le navigateur défiler à la verticale et nous donne
   les mouvements horizontaux. La suppression est immédiate parce qu'elle s'annule
   d'un geste : demander confirmation à un balayage, ce serait le rendre pénible. */
const SWIPE_AT = 96;
let swipe = null;
let justSwiped = false;

function deleteMovement(kind, id) {
  const revenu = kind === "revenu";
  const list = revenu ? state.data.incomes : state.data.expenses;
  const removed = list.find((t) => t.id === id);
  if (!removed) return;
  if (revenu) state.data.incomes = state.data.incomes.filter((t) => t.id !== id);
  else state.data.expenses = state.data.expenses.filter((t) => t.id !== id);
  const skip = skipStamped([removed]);
  save();
  render();
  offerUndo((revenu ? "Revenu supprimé." : "Dépense supprimée.") + (skip.count ? SKIP_NOTE : ""), () => {
    (revenu ? state.data.incomes : state.data.expenses).push(removed);
    skip.undo();
  });
}

$("#tx-list").addEventListener("pointerdown", (e) => {
  const row = e.target.closest(".tx");
  if (!row || state.selecting || (e.pointerType === "mouse" && e.button !== 0)) return;
  swipe = { row, x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId };
});
$("#tx-list").addEventListener("pointermove", (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (swipe = null); // c'est un défilement
    if (!(Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5)) return;
    swipe.active = true;
    swipe.row.classList.add("is-swiping");
    try { swipe.row.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ }
  }
  swipe.dx = Math.min(0, dx);
  swipe.row.style.transform = `translateX(${swipe.dx}px)`;
  swipe.row.classList.toggle("will-delete", swipe.dx < -SWIPE_AT);
});
function endSwipe() {
  if (!swipe) return;
  const { row, dx, active } = swipe;
  swipe = null;
  if (!active) return;
  justSwiped = true;
  setTimeout(() => (justSwiped = false), 350);
  row.classList.remove("is-swiping", "will-delete");
  if (dx < -SWIPE_AT) {
    row.style.transform = "translateX(-110%)";
    setTimeout(() => deleteMovement(row.dataset.kind === "revenu" ? "revenu" : "depense", row.dataset.tx), 160);
  } else row.style.transform = "";
}
$("#tx-list").addEventListener("pointerup", endSwipe);
$("#tx-list").addEventListener("pointercancel", endSwipe);

/* ---- balayage d'une vue : mois précédent / suivant ---- */
let pan = null;
$(".views").addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch" || state.view === "reglages" || state.selecting) return;
  if (e.target.closest(".tx, input, textarea, select, .cal-grid, .hist")) return;
  pan = { x: e.clientX, y: e.clientY };
});
$(".views").addEventListener("pointerup", (e) => {
  if (!pan) return;
  const dx = e.clientX - pan.x;
  const dy = e.clientY - pan.y;
  pan = null;
  if (Math.abs(dx) > 80 && Math.abs(dy) < 50 && Math.abs(dx) > Math.abs(dy) * 2) goToMonth(shiftMonth(state.month, dx < 0 ? 1 : -1));
});
$(".views").addEventListener("pointercancel", () => (pan = null));

/* ---- sélecteur de mois ---- */
let pickYear = Number(todayIso().slice(0, 4));
function renderMonthPicker() {
  $("#year-label").textContent = String(pickYear);
  const grid = $("#month-grid");
  grid.replaceChildren();
  const now = todayIso().slice(0, 7);
  const table = spentTable();
  for (let m = 1; m <= 12; m++) {
    const key = `${pickYear}-${pad(m)}`;
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.pickMonth = key;
    b.textContent = monthName(key, "short").replace(".", "");
    b.setAttribute("aria-label", `${monthName(key)} ${pickYear}`);
    if (key === state.month) b.classList.add("on");
    if (key === now) b.classList.add("is-now");
    if (table[key] || incomesOf(key).length) b.classList.add("has-data");
    grid.append(b);
  }
}
$("#month-label").addEventListener("click", () => {
  if (state.view === "reglages") return;
  pickYear = Number(state.month.slice(0, 4));
  renderMonthPicker();
  openSheet("#sheet-month");
});
$("#year-prev").addEventListener("click", () => { pickYear--; renderMonthPicker(); });
$("#year-next").addEventListener("click", () => { pickYear++; renderMonthPicker(); });
$("#month-grid").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pick-month]");
  if (!btn) return;
  closeSheets();
  goToMonth(btn.dataset.pickMonth);
});
$("#month-today").addEventListener("click", () => {
  closeSheets();
  goToMonth(todayIso().slice(0, 7));
});

$("#clear-filter").addEventListener("click", () => {
  state.filterEnv = null;
  render();
});

/* ---- filtres : période et montant ---- */
$("#filters-toggle").addEventListener("click", () => {
  state.filtersOpen = !state.filtersOpen;
  renderDepenses();
});

$("#period-chips").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-period]");
  if (!btn) return;
  state.period = btn.dataset.period;
  renderDepenses();
});

for (const [id, key] of [["#date-from", "dateFrom"], ["#date-to", "dateTo"]]) {
  $(id).addEventListener("input", (e) => {
    state[key] = e.target.value;
    renderDepenses();
  });
}

// un champ vide ou illisible ne filtre pas : « 0 » ou du texte ne doit pas tout masquer
for (const [id, key] of [["#amount-min", "amountMin"], ["#amount-max", "amountMax"]]) {
  $(id).addEventListener("input", (e) => {
    state[key] = parseAmount(e.target.value);
    renderDepenses();
  });
}

$("#filter-avoidable").addEventListener("click", () => {
  state.onlyAvoidable = !state.onlyAvoidable;
  renderDepenses();
});

$("#filters-reset").addEventListener("click", () => {
  state.onlyAvoidable = false;
  state.period = "mois";
  state.dateFrom = state.dateTo = "";
  state.amountMin = state.amountMax = null;
  for (const id of ["#date-from", "#date-to", "#amount-min", "#amount-max"]) $(id).value = "";
  renderDepenses();
});

/* ---- sélection multiple ---- */
function setSelecting(on) {
  state.selecting = on;
  state.picked.clear();
  disarmAll();
  render();
}
$("#select-toggle").addEventListener("click", () => setSelecting(!state.selecting));
$("#bulk-done").addEventListener("click", () => setSelecting(false));

$("#bulk-all").addEventListener("click", () => {
  const keys = state.itemKeys;
  const all = keys.length > 0 && keys.every((k) => state.picked.has(k));
  state.picked.clear();
  if (!all) for (const k of keys) state.picked.add(k);
  disarmAll();
  renderDepenses();
});

/** Mouvements réellement choisis, avec leur nature. */
function pickedItems() {
  const out = [];
  for (const key of state.picked) {
    const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const item = (kind === "revenu" ? state.data.incomes : state.data.expenses).find((t) => t.id === id);
    if (item) out.push({ kind, item });
  }
  return out;
}

$("#bulk-delete").addEventListener("click", (e) => {
  const n = state.picked.size;
  if (!n) return;
  armDanger(e.currentTarget, `Supprimer ${n} ?`, () => {
    const taken = pickedItems();
    const ids = (kind) => new Set(taken.filter((t) => t.kind === kind).map((t) => t.item.id));
    const [dep, rev] = [ids("depense"), ids("revenu")];
    state.data.expenses = state.data.expenses.filter((t) => !dep.has(t.id));
    state.data.incomes = state.data.incomes.filter((t) => !rev.has(t.id));
    const skip = skipStamped(taken.map((t) => t.item));
    save();
    setSelecting(false);
    offerUndo(`${taken.length} mouvement${taken.length > 1 ? "s supprimés" : " supprimé"}.` + (skip.count ? " Les échéances récurrentes ne reviendront pas ce mois-ci." : ""), () => {
      for (const { kind, item } of taken) (kind === "revenu" ? state.data.incomes : state.data.expenses).push(item);
      skip.undo();
    });
  });
});

$("#bulk-edit").addEventListener("click", () => {
  const taken = pickedItems();
  if (!taken.length) return;
  const nb = taken.length;
  const expenses = taken.filter((t) => t.kind === "depense").length;
  state.draftBulkEnv = "";
  $("#bulk-title").textContent = `Modifier ${nb} mouvement${nb > 1 ? "s" : ""}`;
  $("#bulk-note").textContent =
    expenses === nb
      ? "Ce que tu renseignes s'applique à toute la sélection ; le reste ne bouge pas."
      : "Les revenus n'ont pas d'enveloppe : seule la date les concerne.";
  $("#bulk-env-block").hidden = expenses === 0;
  $("#bulk-ev-block").hidden = expenses === 0;
  state.draftBulkEv = "";
  renderBulkEv();
  $("#bulk-date").value = "";
  renderBulkEnvPicker();
  openSheet("#sheet-bulk");
});

function renderBulkEnvPicker() {
  const picker = $("#bulk-env-picker");
  picker.replaceChildren();
  const keep = document.createElement("button");
  keep.type = "button";
  keep.role = "radio";
  keep.dataset.pick = "";
  keep.className = "is-keep";
  keep.textContent = "Inchangée";
  keep.classList.toggle("on", state.draftBulkEnv === "");
  keep.setAttribute("aria-checked", String(state.draftBulkEnv === ""));
  picker.append(keep);
  for (const env of envelopes()) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "radio";
    b.dataset.pick = env.id;
    b.dataset.i = initialOf(env.nom);
    b.textContent = env.nom;
    b.style.setProperty("--c", env.couleur);
    b.style.setProperty("--on", onColor(env.couleur));
    b.classList.toggle("on", env.id === state.draftBulkEnv);
    b.setAttribute("aria-checked", String(env.id === state.draftBulkEnv));
    picker.append(b);
  }
}

function renderBulkEv() {
  for (const b of document.querySelectorAll("#bulk-ev [data-ev]")) {
    const on = b.dataset.ev === state.draftBulkEv;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
}
$("#bulk-ev").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-ev]");
  if (!btn) return;
  state.draftBulkEv = btn.dataset.ev;
  renderBulkEv();
});

$("#bulk-env-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pick]");
  if (!btn) return;
  state.draftBulkEnv = btn.dataset.pick;
  renderBulkEnvPicker();
});

$("#bulk-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const taken = pickedItems();
  const date = $("#bulk-date").value;
  const env = state.draftBulkEnv;
  const ev = state.draftBulkEv;
  if (!env && !date && !ev) return toast("Choisis une enveloppe, une date ou l'étiquette à appliquer.");

  // l'état d'origine de chaque ligne, pour que « Annuler » remette exactement ce qui était là
  const before = taken.map(({ item }) => ({ item, envelopeId: item.envelopeId, date: item.date, evitable: item.evitable }));
  let changed = 0;
  for (const { kind, item } of taken) {
    if (env && kind === "depense") item.envelopeId = env;
    if (ev && kind === "depense") {
      if (ev === "1") item.evitable = true;
      else delete item.evitable;
    }
    if (date) item.date = date;
    changed++;
  }
  save();
  closeSheets();
  setSelecting(false);
  offerUndo(`${changed} mouvement${changed > 1 ? "s modifiés" : " modifié"}.`, () => {
    for (const b of before) {
      if ("envelopeId" in b.item || b.envelopeId !== undefined) b.item.envelopeId = b.envelopeId;
      if (b.evitable) b.item.evitable = true;
      else delete b.item.evitable;
      b.item.date = b.date;
    }
  });
});

$("#scrim").addEventListener("click", closeSheets);
for (const btn of document.querySelectorAll("[data-close]")) btn.addEventListener("click", closeSheets);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheets();
});

for (const id of ["#tx-amount", "#recurring-amount"]) {
  $(id).addEventListener("input", () => sizeAmountInput($(id)));
}

$("#tx-date-quick").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-ago]");
  if (!btn) return;
  const d = new Date();
  d.setDate(d.getDate() - Number(btn.dataset.ago));
  $("#tx-date").value = isoDay(d);
});

$("#tx-env-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pick]");
  if (!btn) return;
  state.draftEnv = btn.dataset.pick;
  state.draftEnvManual = true;
  $("#env-suggest-hint").hidden = true;
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
  let undoAfterEdit = null;
  const payload = {
    montant: cents,
    libelle: $("#tx-label").value.trim(),
    date: $("#tx-date").value || todayIso(),
  };
  if (!revenu) {
    payload.envelopeId = state.draftEnv;
    if ($("#tx-evitable").checked) payload.evitable = true;
  }

  if (state.editingTx) {
    const record = target.find((t) => t.id === state.editingTx);
    const restore = snapshotOf(record);
    const before = { ...record };
    if (!payload.evitable) delete record.evitable;
    Object.assign(record, payload);
    // une échéance déplacée dans un autre mois laisse un trou dans l'ancien : la règle ne doit pas le « combler »
    const skip = monthOf(payload.date) !== monthOf(before.date) ? skipStamped([before]) : { undo() {} };
    undoAfterEdit = [revenu ? "Revenu modifié." : "Dépense modifiée.", () => { restore(); skip.undo(); }];
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
  // la confirmation d'une création est un simple message ; celle d'une modification offre « Annuler »
  if (undoAfterEdit) offerUndo(...undoAfterEdit);
  else haptic();
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
    { montantText: toInput(tx.montant), envId: tx.envelopeId, libelle: tx.libelle, evitable: tx.evitable },
    revenu ? "revenu" : "depense"
  );
});

$("#tx-delete").addEventListener("click", (e) => {
  const revenu = state.editingTxType === "revenu";
  armDanger(e.currentTarget, "Confirmer la suppression ?", () => {
    const removed = (revenu ? state.data.incomes : state.data.expenses).find((t) => t.id === state.editingTx);
    if (revenu) state.data.incomes = state.data.incomes.filter((t) => t.id !== state.editingTx);
    else state.data.expenses = state.data.expenses.filter((t) => t.id !== state.editingTx);
    const skip = skipStamped(removed ? [removed] : []);
    save();
    closeSheets();
    render();
    offerUndo((revenu ? "Revenu supprimé." : "Dépense supprimée.") + (skip.count ? SKIP_NOTE : ""), () => {
      if (removed) (revenu ? state.data.incomes : state.data.expenses).push(removed);
      skip.undo();
    });
  });
});

$("#env-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const nom = $("#env-name").value.trim();
  $("#env-name-error").hidden = Boolean(nom);
  if (!nom) return $("#env-name").focus();

  const budget = parseAmount($("#env-budget").value) ?? 0;

  const report = $("#env-report").checked;

  if (state.editingEnv) {
    const env = envById(state.editingEnv);
    const restore = snapshotOf(env);
    const before = budgetFor(env, state.month);
    env.nom = nom;
    env.couleur = state.draftColor;
    if (budget !== before) {
      if ($("#env-budget-past").checked) {
        env.budgetHistory = [];
        env.budget = budget;
      } else setBudgetFrom(env, state.month, budget);
    }
    if (report && !env.report) env.reportDepuis = state.month;
    env.report = report;
    save();
    closeSheets();
    render();
    return offerUndo("Enveloppe modifiée.", restore);
  }
  state.data.envelopes.push({
    id: uid(),
    nom,
    budget,
    budgetHistory: [],
    report,
    reportDepuis: report ? state.month : null,
    archivee: false,
    couleur: state.draftColor,
    ordre: state.data.envelopes.length,
  });
  toast("Enveloppe créée.");

  save();
  closeSheets();
  render();
});

/** Retire une enveloppe selon le sort choisi pour ses dépenses ; rend la remise en place. */
function removeEnvelope(id, fate, to) {
  const env = envById(id);
  const mine = (list) => list.filter((x) => x.envelopeId === id);
  const expenses = mine(state.data.expenses);
  const rules = mine(state.data.recurring);
  const was = { archivee: env.archivee, ordre: env.ordre };
  const activeRules = rules.filter((r) => r.actif);
  let restore;

  if (fate === "move") {
    for (const x of [...expenses, ...rules]) x.envelopeId = to;
    state.data.envelopes = state.data.envelopes.filter((x) => x.id !== id);
    restore = () => {
      state.data.envelopes.push(env);
      for (const x of [...expenses, ...rules]) x.envelopeId = id;
    };
  } else if (fate === "archive") {
    env.archivee = true;
    for (const r of activeRules) r.actif = false;
    restore = () => {
      env.archivee = was.archivee;
      for (const r of activeRules) r.actif = true;
    };
  } else {
    state.data.envelopes = state.data.envelopes.filter((x) => x.id !== id);
    state.data.expenses = state.data.expenses.filter((t) => t.envelopeId !== id);
    state.data.recurring = state.data.recurring.filter((r) => r.envelopeId !== id);
    restore = () => {
      state.data.envelopes.push(env);
      state.data.expenses.push(...expenses);
      state.data.recurring.push(...rules);
    };
  }
  if (state.filterEnv === id) state.filterEnv = null;
  save();
  closeSheets();
  render();
  const toName = envById(to)?.nom;
  offerUndo(
    fate === "move" ? `Dépenses passées dans « ${toName} », enveloppe supprimée.`
      : fate === "archive" ? `« ${env.nom} » archivée.`
      : "Enveloppe supprimée.",
    restore
  );
}

$("#env-delete").addEventListener("click", (e) => {
  const id = state.editingEnv;
  const count = state.data.expenses.filter((t) => t.envelopeId === id).length;
  const recurringCount = state.data.recurring.filter((r) => r.envelopeId === id).length;
  // vide : la suppression directe suffit (et reste annulable)
  if (!count && !recurringCount) {
    return armDanger(e.currentTarget, "Confirmer la suppression ?", () => removeEnvelope(id, "delete", null));
  }
  const others = envelopes().filter((x) => x.id !== id);
  state.fate = others.length ? "move" : "archive";
  state.fateTo = others[0]?.id ?? null;
  const parts = [];
  if (count) parts.push(`${count} dépense${count > 1 ? "s" : ""}`);
  if (recurringCount) parts.push(`${recurringCount} règle${recurringCount > 1 ? "s" : ""} récurrente${recurringCount > 1 ? "s" : ""}`);
  $("#envdel-title").textContent = `Supprimer « ${envById(id).nom} »`;
  $("#envdel-note").textContent = `Elle contient ${parts.join(" et ")}. Que doivent-elles devenir ?`;
  renderEnvDelete();
  openSheet("#sheet-envdel");
});

function renderEnvDelete() {
  const others = envelopes().filter((x) => x.id !== state.editingEnv);
  for (const b of document.querySelectorAll("#envdel-choices [data-fate]")) {
    const on = b.dataset.fate === state.fate;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
    if (b.dataset.fate === "move") b.disabled = !others.length;
  }
  const picker = $("#envdel-picker");
  picker.hidden = state.fate !== "move";
  picker.replaceChildren();
  for (const env of others) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "radio";
    b.dataset.to = env.id;
    b.dataset.i = initialOf(env.nom);
    b.textContent = env.nom;
    b.style.setProperty("--c", env.couleur);
    b.style.setProperty("--on", onColor(env.couleur));
    b.classList.toggle("on", env.id === state.fateTo);
    b.setAttribute("aria-checked", String(env.id === state.fateTo));
    picker.append(b);
  }
  const confirm = $("#envdel-confirm");
  confirm.textContent = state.fate === "move" ? "Réaffecter et supprimer" : state.fate === "archive" ? "Archiver" : "Tout supprimer";
  confirm.dataset.idle = confirm.textContent;
  confirm.classList.toggle("btn-danger", state.fate === "delete");
}

$("#envdel-choices").addEventListener("click", (e) => {
  const fate = e.target.closest("[data-fate]");
  const to = e.target.closest("[data-to]");
  if (fate && !fate.disabled) state.fate = fate.dataset.fate;
  if (to) state.fateTo = to.dataset.to;
  if (fate || to) {
    disarmAll(); // le bouton change de texte avec le choix : une confirmation en attente serait périmée
    renderEnvDelete();
  }
});

$("#envdel-form").addEventListener("submit", (e) => {
  e.preventDefault();
  // « tout supprimer » reste en deux temps ; réaffecter et archiver sont réversibles d'un geste
  if (state.fate === "delete")
    return armDanger($("#envdel-confirm"), "Confirmer : tout supprimer ?", () => removeEnvelope(state.editingEnv, "delete", null));
  removeEnvelope(state.editingEnv, state.fate, state.fateTo);
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
  const jourValid = Number.isInteger(jour) && jour >= 1 && jour <= 31;
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
    evitable: type === "depense" && $("#recurring-evitable").checked,
  };

  /* Point de départ du rattrapage. Une règle qui sort de pause repart
     d'aujourd'hui : les mois passés en pause n'étaient pas dus, les tamponner
     rétroactivement inventerait des dépenses qui n'ont jamais eu lieu. */
  const thisMonth = todayIso().slice(0, 7);
  payload.debut = previous && previous.actif && payload.actif ? previous.debut : thisMonth;

  let restoreRule = null;
  let restoreStamp = null;
  if (editing) {
    restoreRule = snapshotOf(previous);
    Object.assign(previous, payload);
    restoreStamp = syncStamped(previous);
  } else state.data.recurring.push({ id: uid(), createdAt: Date.now(), skipped: [], ...payload });

  save();
  closeSheets();
  // un jour déjà passé ce mois-ci (création, réactivation, ou jour avancé) se rattrape tout de suite
  const { created } = generateRecurring();
  render();

  const label = type === "revenu" ? "Revenu récurrent" : "Dépense récurrente";
  if (editing)
    offerUndo(
      created ? "Modifié — le mois en cours est à jour." : `${label} modifié${type === "revenu" ? "" : "e"}.`,
      () => {
        restoreRule();
        restoreStamp();
      }
    );
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
    offerUndo(
      isRevenu
        ? "Revenu récurrent supprimé. Les montants déjà générés restent dans l'historique."
        : "Dépense récurrente supprimée. Les dépenses déjà générées restent dans l'historique.",
      () => {
        if (rule) state.data.recurring.push(rule);
      }
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
    const before = state.data;
    state.data = seed();
    state.filterEnv = null;
    state.managing = false;
    save();
    render();
    offerUndo("Tout a été effacé.", () => {
      state.data = before;
    });
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
  const norm = noAccent; // « evitable » tapé sans accent dans Raccourcis doit aussi trouver « Évitable »
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

/* ---------------------------------------------------------- premier lancement */

const needsOnboarding = () =>
  !state.data.settings.onboarded && !state.data.expenses.length && !state.data.incomes.length;

function obTotals() {
  const income = parseAmount($("#ob-income").value) ?? 0;
  let sum = 0;
  for (const row of document.querySelectorAll(".ob-row")) {
    if (row.querySelector("input[type=checkbox]").checked) sum += parseAmount(row.querySelector("input[type=text]").value) ?? 0;
  }
  const left = $("#ob-left");
  left.classList.toggle("is-over", income > 0 && sum > income);
  left.textContent = income
    ? sum > income
      ? `Tes budgets dépassent ton revenu de ${money(sum - income)}.`
      : `Reste à répartir : ${money(income - sum)}`
    : sum
      ? `Total des budgets : ${money(sum)}`
      : "";
}

function openOnboarding() {
  const box = $("#ob-envs");
  box.replaceChildren();
  DEFAULT_ENVELOPES.forEach((env, i) => {
    const row = document.createElement("div");
    row.className = "ob-row";
    const label = document.createElement("label");
    label.className = "check";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = i < 5;
    const name = document.createElement("span");
    name.textContent = env.nom;
    label.append(check, badge("env-dot", env.couleur, initialOf(env.nom)), name);
    const amount = document.createElement("input");
    amount.type = "text";
    amount.inputMode = "decimal";
    amount.autocomplete = "off";
    amount.placeholder = String(env.suggestion);
    amount.setAttribute("aria-label", `Budget mensuel ${env.nom}`);
    amount.disabled = !check.checked;
    check.addEventListener("change", () => {
      amount.disabled = !check.checked;
      obTotals();
    });
    row.append(label, amount);
    box.append(row);
  });
  $("#ob-income").value = "";
  $("#ob-day").value = "1";
  obTotals();
  $("#onboard").hidden = false;
  $(".app").inert = true;
  $("#onboard-title").tabIndex = -1;
  $("#onboard-title").focus({ preventScroll: true });
}

function closeOnboarding() {
  $("#onboard").hidden = true;
  $(".app").inert = false;
}

/** Ouvre l'accueil guidé quand il faut, le referme quand il ne faut plus (annulation d'un « Tout effacer »). */
function syncOnboarding() {
  const needed = needsOnboarding();
  if (needed && $("#onboard").hidden) openOnboarding();
  else if (!needed && !$("#onboard").hidden) closeOnboarding();
}

$("#ob-envs").addEventListener("input", obTotals);
$("#ob-income").addEventListener("input", obTotals);

$("#ob-skip").addEventListener("click", () => {
  state.data.settings.onboarded = true;
  save();
  closeOnboarding();
  render();
});

$("#ob-go").addEventListener("click", () => {
  const rows = [...document.querySelectorAll(".ob-row")];
  const chosen = rows
    .map((row, i) => ({ row, env: DEFAULT_ENVELOPES[i] }))
    .filter(({ row }) => row.querySelector("input[type=checkbox]").checked);
  if (!chosen.length) return toast("Garde au moins une enveloppe — tu pourras en créer d'autres ensuite.");

  state.data.envelopes = chosen.map(({ row, env }, i) => ({
    id: uid(),
    ordre: i,
    nom: env.nom,
    couleur: env.couleur,
    budget: parseAmount(row.querySelector("input[type=text]").value) ?? 0,
    budgetHistory: [],
    report: false,
    reportDepuis: null,
    archivee: false,
  }));

  const income = parseAmount($("#ob-income").value);
  const day = Math.min(31, Math.max(1, Number.parseInt($("#ob-day").value, 10) || 1));
  if (income) {
    state.data.recurring.push({
      id: uid(), type: "revenu", montant: income, libelle: "Salaire", jour: day, actif: true,
      icone: "salaire", envelopeId: null, evitable: false, skipped: [],
      debut: todayIso().slice(0, 7), createdAt: Date.now(),
    });
  }
  state.data.settings.onboarded = true;
  save();
  closeOnboarding();
  generateRecurring();
  render();
  toast(income ? "C'est parti : ton revenu revient chaque mois." : "C'est parti.");
});

/* ---------------------------------------------------------- démarrage */

/* Installée sur l'écran d'accueil, l'appli occupe tout l'écran ; ouverte
   dans Safari, la barre d'outils du navigateur mord sur le bas — la barre
   d'onglets doit alors remonter d'autant pour rester atteignable. */
function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches === true || navigator.standalone === true;
}
document.documentElement.dataset.standalone = isStandalone() ? "1" : "0";

/* Taille du texte réglée dans iOS (Réglages › Affichage › Taille du texte). Safari ne la
   transmet qu'à la police système `-apple-system-body` : on la mesure sur un témoin caché et
   on en tire un facteur (17 px = 1) qui agrandit toutes les tailles en rem. Ailleurs (Chrome,
   Tauri) la déclaration est refusée, le facteur reste à 1. */
function applyTextScale() {
  try {
    const probe = document.createElement("p");
    probe.style.cssText = "position:absolute;visibility:hidden;font:-apple-system-body";
    if (!probe.style.font) return;
    document.body.append(probe);
    const px = Number.parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    if (Number.isFinite(px)) document.documentElement.style.setProperty("--text-scale", String(Math.min(1.6, Math.max(1, px / 17))));
  } catch {
    /* garde l'échelle par défaut */
  }
}
applyTextScale();

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
else maybeRemindBackup();
requestPersistence();
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
  applyTextScale(); // le réglage a pu changer pendant que l'appli était en arrière-plan
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
