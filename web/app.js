/* ============================================================
   Mon Budget — logique de l'application
   Tout est stocké dans le localStorage de cet appareil.
   Les montants sont manipulés en centimes (entiers) pour
   éviter les erreurs d'arrondi des nombres à virgule.
   ============================================================ */

const STORE_KEY = "mon-budget/v1";
const APP_VERSION = "1.0.0";

const COLORS = [
  "#3F6DE0", "#E86A4E", "#23A26D", "#7B57D6",
  "#E8A61F", "#D6497E", "#1B9AAA", "#5C6B7A",
];

const DEFAULT_ENVELOPES = [
  { nom: "Logement", couleur: "#3F6DE0", budget: 80000 },
  { nom: "Courses", couleur: "#E86A4E", budget: 40000 },
  { nom: "Transports", couleur: "#23A26D", budget: 15000 },
  { nom: "Sorties", couleur: "#7B57D6", budget: 20000 },
  { nom: "Abonnements", couleur: "#E8A61F", budget: 6000 },
];

/* ---------------------------------------------------------- outils */

const $ = (sel) => document.querySelector(sel);
const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const money = (cents) => eur.format(cents / 100);

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** "12,50" | "12.5" | "12,50 €" -> 1250. Renvoie null si illisible. */
function parseAmount(raw) {
  const cleaned = String(raw).replace(/\s/g, "").replace(/[^\d.,-]/g, "").replace(",", ".");
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
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

function dayHeading(iso) {
  if (iso === todayIso()) return "Aujourd'hui";
  const d = new Date(iso + "T12:00:00");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (iso === isoDay(yesterday)) return "Hier";
  return capitalize(
    new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(d)
  );
}

/* ---------------------------------------------------------- données */

function seed() {
  return {
    version: 1,
    envelopes: DEFAULT_ENVELOPES.map((e, i) => ({ id: uid(), ordre: i, ...e })),
    expenses: [],
    settings: { theme: "auto" },
    updatedAt: Date.now(),
  };
}

function isSane(d) {
  return d && Array.isArray(d.envelopes) && Array.isArray(d.expenses);
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return seed();
    const data = JSON.parse(raw);
    if (!isSane(data)) return seed();
    data.settings = data.settings || { theme: "auto" };
    return data;
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
  managing: false,
  editingTx: null,
  editingEnv: null,
  draftColor: COLORS[0],
  draftEnv: null,
};

/* ---------------------------------------------------------- sélecteurs */

const envelopes = () => [...state.data.envelopes].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
const envById = (id) => state.data.envelopes.find((e) => e.id === id);
const expensesOf = (month) => state.data.expenses.filter((t) => monthOf(t.date) === month);

function spentByEnv(month) {
  const totals = Object.create(null);
  for (const t of expensesOf(month)) totals[t.envelopeId] = (totals[t.envelopeId] || 0) + t.montant;
  return totals;
}

const totalBudget = () => envelopes().reduce((sum, e) => sum + e.budget, 0);
const totalSpent = (month) => expensesOf(month).reduce((sum, t) => sum + t.montant, 0);

function daysLeft(month) {
  const now = new Date();
  if (month !== todayIso().slice(0, 7)) return null;
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate() - now.getDate();
}

/* ---------------------------------------------------------- rendu */

function render() {
  document.documentElement.dataset.theme = state.data.settings.theme;
  if (state.data.settings.theme === "auto") delete document.documentElement.dataset.theme;

  $("#month-name").textContent = monthName(state.month);
  $("#month-year").textContent = state.month.slice(0, 4);
  $("#topbar").hidden = state.view === "reglages";
  $("#fab").hidden = state.view === "reglages";

  for (const el of document.querySelectorAll(".view")) el.hidden = el.id !== `view-${state.view}`;
  for (const b of document.querySelectorAll(".tabbar button")) b.classList.toggle("on", b.dataset.view === state.view);

  if (state.view === "accueil") renderAccueil();
  if (state.view === "depenses") renderDepenses();
  if (state.view === "bilan") renderBilan();
  if (state.view === "reglages") renderReglages();
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
  for (const env of envelopes()) {
    const part = perEnv[env.id] || 0;
    if (part <= 0) continue;
    const bar = document.createElement("i");
    bar.style.width = `${(part / base) * 100}%`;
    bar.style.background = env.couleur;
    track.append(bar);
  }

  const rest = daysLeft(state.month);
  const parts = [`sur ${money(budget)}`];
  if (rest !== null) parts.push(rest === 0 ? "dernier jour du mois" : `${rest} jour${rest > 1 ? "s" : ""} restant${rest > 1 ? "s" : ""}`);
  $("#total-note").textContent = parts.join(" · ");

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

    const text = document.createElement("span");
    text.className = "env-t";
    const name = document.createElement("b");
    name.textContent = env.nom;
    const sub = document.createElement("span");
    sub.textContent = over
      ? `dépassé de ${money(spentHere - env.budget)}`
      : `${money(env.budget - spentHere)} restants sur ${money(env.budget)}`;
    text.append(name, sub);

    const badge = document.createElement("span");
    if (state.managing) {
      badge.className = "env-gear";
      badge.textContent = "✎";
    } else {
      badge.className = "env-ring";
      badge.style.setProperty("--p", `${Math.min(pct, 100)}%`);
      const val = document.createElement("b");
      val.textContent = pct;
      badge.append(val);
    }

    row.append(text, badge);
    row.setAttribute("aria-label", `${env.nom}, ${sub.textContent}`);
    list.append(row);
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

  let items = expensesOf(state.month);
  if (filter) items = items.filter((t) => t.envelopeId === filter.id);
  items.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)));

  if (!items.length) {
    list.append(
      emptyBlock(
        "Rien pour ce mois-ci",
        filter ? "Aucune dépense dans cette enveloppe." : "Touche le bouton + pour noter une dépense."
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
      head.textContent = dayHeading(tx.date);
      list.append(head);
    }

    const env = envById(tx.envelopeId);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tx";
    row.dataset.tx = tx.id;

    const dot = document.createElement("span");
    dot.className = "tx-dot";
    dot.style.setProperty("--c", env ? env.couleur : "#9AA0AC");

    const text = document.createElement("span");
    text.className = "tx-t";
    const label = document.createElement("b");
    label.textContent = tx.libelle || (env ? env.nom : "Dépense");
    const sub = document.createElement("span");
    sub.textContent = env ? env.nom : "Sans enveloppe";
    text.append(label, sub);

    const amount = document.createElement("span");
    amount.className = "tx-a";
    amount.textContent = `−${money(tx.montant)}`;

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

  const keys = [];
  for (let i = 5; i >= 0; i--) keys.push(shiftMonth(state.month, -i));
  const totals = keys.map((k) => totalSpent(k));
  const max = Math.max(...totals, 1);

  const hist = $("#hist");
  const labels = $("#hist-labels");
  hist.replaceChildren();
  labels.replaceChildren();
  keys.forEach((key, i) => {
    const bar = document.createElement("div");
    bar.style.height = `${Math.max((totals[i] / max) * 100, 3)}%`;
    if (key === state.month) bar.classList.add("on");
    bar.title = `${monthName(key)} : ${money(totals[i])}`;
    hist.append(bar);

    const tag = document.createElement("span");
    tag.textContent = monthName(key, "short").replace(".", "");
    labels.append(tag);
  });

  const rep = $("#repartition");
  rep.replaceChildren();
  const perEnv = spentByEnv(state.month);
  const rows = envelopes()
    .map((e) => ({ env: e, spent: perEnv[e.id] || 0 }))
    .filter((r) => r.spent > 0)
    .sort((a, b) => b.spent - a.spent);

  if (!rows.length) {
    rep.append(emptyBlock("Aucune dépense", "Le bilan se remplit dès la première dépense du mois."));
    return;
  }

  for (const { env, spent: value } of rows) {
    const block = document.createElement("div");
    const line = document.createElement("div");
    line.className = "rep-row";
    const name = document.createElement("span");
    name.className = "n";
    name.textContent = env.nom;
    const amount = document.createElement("span");
    amount.className = "v";
    amount.textContent = `${money(value)}  ·  ${Math.round((value / spent) * 100)} %`;
    line.append(name, amount);

    const bar = document.createElement("div");
    bar.className = "rep-bar";
    bar.style.setProperty("--c", env.couleur);
    const fill = document.createElement("i");
    fill.style.width = `${(value / rows[0].spent) * 100}%`;
    bar.append(fill);

    block.append(line, bar);
    rep.append(block);
  }
}

function renderReglages() {
  for (const b of document.querySelectorAll("[data-theme-set]")) {
    const on = b.dataset.themeSet === state.data.settings.theme;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
  const n = state.data.expenses.length;
  const e = state.data.envelopes.length;
  const when = state.data.updatedAt
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(state.data.updatedAt)
    : "jamais";
  $("#data-stat").textContent = `${n} dépense${n > 1 ? "s" : ""} · ${e} enveloppe${e > 1 ? "s" : ""} · modifié le ${when}`;
  $("#version").textContent = `Mon Budget ${APP_VERSION}`;
}

/* ---------------------------------------------------------- feuilles */

function openSheet(id) {
  $("#scrim").hidden = false;
  const sheet = $(id);
  sheet.hidden = false;
  requestAnimationFrame(() => {
    $("#scrim").classList.add("show");
    sheet.classList.add("show");
  });
}

function closeSheets() {
  $("#scrim").classList.remove("show");
  for (const sheet of document.querySelectorAll(".sheet")) {
    sheet.classList.remove("show");
    setTimeout(() => {
      sheet.hidden = true;
      $("#scrim").hidden = true;
    }, 280);
  }
  disarmAll();
}

function openTxSheet(tx) {
  state.editingTx = tx ? tx.id : null;
  const first = envelopes()[0];
  if (!first) return toast("Crée d'abord une enveloppe.");

  state.draftEnv = tx ? tx.envelopeId : first.id;
  $("#tx-title").textContent = tx ? "Modifier la dépense" : "Nouvelle dépense";
  $("#tx-amount").value = tx ? String(tx.montant / 100).replace(".", ",") : "";
  $("#tx-label").value = tx ? tx.libelle : "";
  $("#tx-date").value = tx ? tx.date : todayIso();
  $("#tx-amount-error").hidden = true;
  $("#tx-delete").hidden = !tx;

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

  openSheet("#sheet-tx");
  if (!tx) setTimeout(() => $("#tx-amount").focus(), 320);
}

function openEnvSheet(env) {
  state.editingEnv = env ? env.id : null;
  state.draftColor = env ? env.couleur : COLORS[state.data.envelopes.length % COLORS.length];

  $("#env-title").textContent = env ? "Modifier l'enveloppe" : "Nouvelle enveloppe";
  $("#env-name").value = env ? env.nom : "";
  $("#env-budget").value = env ? String(env.budget / 100).replace(".", ",") : "";
  $("#env-name-error").hidden = true;
  $("#env-delete").hidden = !env;

  const picker = $("#env-colors");
  picker.replaceChildren();
  for (const hex of COLORS) {
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
      data.settings = data.settings || { theme: "auto" };
      state.data = data;
      state.filterEnv = null;
      save();
      render();
      toast(`Importé : ${data.expenses.length} dépenses.`);
    } catch {
      toast("Fichier illisible : ce n'est pas une sauvegarde Mon Budget.");
    }
  };
  reader.onerror = () => toast("Lecture du fichier impossible.");
  reader.readAsText(file);
}

/* ---------------------------------------------------------- événements */

$("#prev-month").addEventListener("click", () => {
  state.month = shiftMonth(state.month, -1);
  render();
});
$("#next-month").addEventListener("click", () => {
  state.month = shiftMonth(state.month, 1);
  render();
});

$("#tabbar").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  state.view = btn.dataset.view;
  if (state.view !== "depenses") state.filterEnv = null;
  render();
});

$("#fab").addEventListener("click", () => openTxSheet(null));

$("#toggle-manage").addEventListener("click", () => {
  state.managing = !state.managing;
  render();
});

$("#env-list").addEventListener("click", (e) => {
  if (e.target.closest("#env-add")) return openEnvSheet(null);
  const row = e.target.closest("[data-env]");
  if (!row) return;
  const env = envById(row.dataset.env);
  if (!env) return;
  if (state.managing) return openEnvSheet(env);
  state.filterEnv = env.id;
  state.view = "depenses";
  render();
});

$("#tx-list").addEventListener("click", (e) => {
  const row = e.target.closest("[data-tx]");
  if (!row) return;
  const tx = state.data.expenses.find((t) => t.id === row.dataset.tx);
  if (tx) openTxSheet(tx);
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

  const payload = {
    envelopeId: state.draftEnv,
    montant: cents,
    libelle: $("#tx-label").value.trim(),
    date: $("#tx-date").value || todayIso(),
  };

  if (state.editingTx) {
    const tx = state.data.expenses.find((t) => t.id === state.editingTx);
    Object.assign(tx, payload);
    toast("Dépense modifiée.");
  } else {
    state.data.expenses.push({ id: uid(), createdAt: Date.now(), ...payload });
    toast(`${money(cents)} noté dans ${envById(payload.envelopeId)?.nom ?? "l'enveloppe"}.`);
  }

  state.month = monthOf(payload.date);
  save();
  closeSheets();
  render();
});

$("#tx-delete").addEventListener("click", (e) => {
  armDanger(e.currentTarget, "Confirmer la suppression ?", () => {
    state.data.expenses = state.data.expenses.filter((t) => t.id !== state.editingTx);
    save();
    closeSheets();
    render();
    toast("Dépense supprimée.");
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
  const question = count ? `Supprimer aussi ses ${count} dépenses ?` : "Confirmer la suppression ?";
  armDanger(e.currentTarget, question, () => {
    state.data.envelopes = state.data.envelopes.filter((x) => x.id !== state.editingEnv);
    state.data.expenses = state.data.expenses.filter((t) => t.envelopeId !== state.editingEnv);
    if (state.filterEnv === state.editingEnv) state.filterEnv = null;
    save();
    closeSheets();
    render();
    toast("Enveloppe supprimée.");
  });
});

for (const btn of document.querySelectorAll("[data-theme-set]")) {
  btn.addEventListener("click", () => {
    state.data.settings.theme = btn.dataset.themeSet;
    save();
    render();
  });
}

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

/* ---------------------------------------------------------- démarrage */

render();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* hors-ligne indisponible : l'appli fonctionne quand même */
    });
  });
}
