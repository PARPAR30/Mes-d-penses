/*
 * Audit exploratoire : ouvre l'app dans un vrai Chrome à la taille d'un iPhone,
 *
 * Deux constats connus et acceptés, qu'il continuera de signaler :
 *   - les segments de la barre de répartition font 28 px de haut (la légende
 *     juste dessous offre la même action sur 44 px) ;
 *   - les cases du calendrier tombent à 34 px sur un écran de 320 px — sept
 *     colonnes dans 256 px utiles, c'est de la géométrie.
 * Le balayage « bouton inerte » est indicatif : il enchaîne les clics sans
 * remettre l'état à zéro, un contrôle peut donc être signalé parce qu'un clic
 * précédent l'avait déjà mis dans l'état visé. C'est regressions.test.js qui
 * fait foi sur le comportement.
 *
 * parcourt les cinq vues et chaque tiroir, et rapporte ce qui cloche —
 * débordement horizontal, texte coupé, cible tactile trop petite, chevauchement
 * avec la barre d'onglets, exception JavaScript.
 *
 *   node tests/navigateur/audit.js
 */
const path = require("path");
const { serve, launchChrome, newPage, evalOn } = require("./cdp.js");

const WEB = path.join(__dirname, "..", "..", "web");
const PORT = 8761;
const DBG = 9361;
const URL_APP = `http://127.0.0.1:${PORT}/index.html`;

const findings = [];
const note = (where, what) => {
  findings.push({ where, what });
  console.log(`  !  [${where}] ${what}`);
};

/* Jeu de données réaliste : plusieurs enveloppes, un dépassement, des revenus,
   des récurrences des deux types, et de quoi remplir six mois d'historique. */
const SEED = `
(function () {
  if (!location.protocol.startsWith("http") || location.search.indexOf("vide") !== -1) return;
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const M = (d) => { const x = new Date(now.getFullYear(), now.getMonth() + d, 5); return x.getFullYear() + "-" + pad(x.getMonth() + 1); };
  const id = (p) => p + Math.random().toString(16).slice(2, 8);
  const envs = [
    { id: "e1", ordre: 0, nom: "Logement", couleur: "#3F6DE0", budget: 80000 },
    { id: "e2", ordre: 1, nom: "Courses", couleur: "#E4634A", budget: 40000 },
    { id: "e3", ordre: 2, nom: "Transports", couleur: "#23A26D", budget: 15000 },
    { id: "e4", ordre: 3, nom: "Sorties", couleur: "#7B57D6", budget: 20000 },
    { id: "e5", ordre: 4, nom: "Abonnements", couleur: "#B8820A", budget: 6000 },
    { id: "e6", ordre: 5, nom: "Sante", couleur: "#D6497E", budget: 9000 },
    { id: "e7", ordre: 6, nom: "Cadeaux et imprevus divers", couleur: "#1B9AAA", budget: 12000 },
  ];
  const expenses = [];
  for (let m = 0; m >= -5; m--) {
    for (let i = 0; i < 9; i++) {
      const e = envs[i % envs.length];
      expenses.push({
        id: id("x"), montant: 1500 + i * 900 + (m === 0 ? 4000 : 0),
        libelle: ["Monoprix", "Essence", "Restaurant du coin", "Pharmacie", "Cinema", "Loyer", "Cadeau", "Train", "Cafe"][i],
        date: M(m) + "-" + pad(2 + i * 2), envelopeId: e.id, createdAt: Date.now() - i * 1000,
      });
    }
  }
  expenses.push({ id: id("x"), montant: 99000, libelle: "Loyer", date: M(0) + "-03", envelopeId: "e1", createdAt: Date.now() });
  const incomes = [
    { id: id("i"), montant: 210000, libelle: "Salaire", date: M(0) + "-02", createdAt: Date.now() },
    { id: id("i"), montant: 4500, libelle: "Remboursement mutuelle", date: M(0) + "-11", createdAt: Date.now() },
  ];
  const recurring = [
    { id: "r1", type: "depense", montant: 1399, libelle: "Netflix", jour: 5, actif: true, icone: "netflix", envelopeId: "e5", createdAt: Date.now() },
    { id: "r2", type: "depense", montant: 85000, libelle: "Loyer", jour: 3, actif: true, icone: null, envelopeId: "e1", createdAt: Date.now() },
    { id: "r3", type: "revenu", montant: 210000, libelle: "Salaire", jour: 2, actif: true, icone: "salaire", envelopeId: null, createdAt: Date.now() },
    { id: "r4", type: "depense", montant: 2999, libelle: "Salle de sport", jour: 15, actif: false, icone: "salle", envelopeId: "e4", createdAt: Date.now() },
  ];
  localStorage.setItem("mon-budget/v1", JSON.stringify({
    version: 1, envelopes: envs, expenses, incomes, recurring,
    settings: { theme: "auto", chart: "barre" }, updatedAt: Date.now(),
  }));
})();
`;

const HELPERS = String.raw`
window.q = (s) => document.querySelector(s);
window.qa = (s) => [...document.querySelectorAll(s)];
window.vis = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
};
window.go = (v) => { const b = q('.tabbar [data-view="' + v + '"]'); if (b) b.click(); };

/* Plusieurs controles gardent leur dessin compact et elargissent leur seule zone
   d'appui, par un ::before absolu en inset negatif. Il faut donc mesurer CE
   rectangle-la, pas celui du bouton, et ne pas prendre son depassement pour un
   defaut de mise en page. */
window.hitInset = (el) => {
  const st = getComputedStyle(el, "::before");
  if (st.content === "none" || st.position !== "absolute") return null;
  const px = (v) => (parseFloat(v) || 0);
  return { top: px(st.top), right: px(st.right), bottom: px(st.bottom), left: px(st.left) };
};
window.hitBox = (el) => {
  const r = el.getBoundingClientRect();
  const i = hitInset(el);
  if (!i) return { w: r.width, h: r.height };
  return { w: r.width - i.left - i.right, h: r.height - i.top - i.bottom };
};

window.path = (el) => {
  const bits = [];
  for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) {
    let s = n.tagName.toLowerCase();
    if (n.id) { bits.unshift("#" + n.id); break; }
    if (n.className && typeof n.className === "string") s += "." + n.className.trim().split(/\s+/).slice(0, 2).join(".");
    bits.unshift(s);
  }
  return bits.join(" > ");
};

/* Debordement horizontal du document, et de chaque bloc sur son parent. */
window.overflowReport = () => {
  const out = [];
  const doc = document.scrollingElement;
  if (doc.scrollWidth > doc.clientWidth + 1) out.push({ kind: "page", sel: "document", by: doc.scrollWidth - doc.clientWidth });
  for (const el of qa(q(".sheet.show") ? ".sheet.show *" : ".view:not([hidden]) *")) {
    if (!vis(el)) continue;
    const st = getComputedStyle(el);
    if (st.overflowX === "auto" || st.overflowX === "scroll") continue;
    if (st.textOverflow === "ellipsis") continue;
    if (el.classList.contains("sr-only")) continue;   // rogne expres, hors ecran pour les lecteurs
    if (hitInset(el)) continue;                       // zone d'appui volontairement debordante
    if (el.querySelector(":scope > .total-mark")) continue; // repere de rythme, pose en absolu
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      out.push({ kind: "bloc", sel: path(el), by: el.scrollWidth - el.clientWidth, text: (el.textContent || "").trim().slice(0, 40) });
    }
  }
  return out;
};

/* Texte tronque sans ellipsis declaree : le mot disparait sans que rien ne le dise. */
window.clippedText = () => {
  const out = [];
  for (const el of qa(q(".sheet.show") ? ".sheet.show *" : ".view:not([hidden]) *")) {
    if (!vis(el) || el.children.length) continue;
    if (el.classList.contains("sr-only") || hitInset(el)) continue;
    const st = getComputedStyle(el);
    const ell = st.textOverflow === "ellipsis";
    if (!ell && el.scrollWidth > el.clientWidth + 1) out.push({ sel: path(el), text: (el.textContent || "").trim().slice(0, 50) });
    if (el.scrollHeight > el.clientHeight + 2 && st.overflowY === "hidden") out.push({ sel: path(el), text: "(hauteur) " + (el.textContent || "").trim().slice(0, 40) });
  }
  return out;
};

/* Cibles tactiles : 44x44 est le minimum recommande par Apple. */
window.smallTargets = () => {
  const out = [];
  for (const el of qa(q(".sheet.show") ? ".sheet.show button, .sheet.show input" : ".view:not([hidden]) button, .view:not([hidden]) input, .topbar button, .tabbar button, .fab")) {
    if (!vis(el)) continue;
    const b = hitBox(el);
    if (b.h < 40 || b.w < 34) out.push({ sel: path(el), w: Math.round(b.w), h: Math.round(b.h), text: (el.textContent || el.ariaLabel || "").trim().slice(0, 24) });
  }
  return out;
};

/* Contenu cache sous la barre d'onglets flottante ou sous le bouton +. */
window.underChrome = () => {
  const doc = document.scrollingElement;
  if (doc.scrollHeight - doc.clientHeight - doc.scrollTop > 2) return [];  // pas encore en bas : le contenu peut encore defiler sous la barre
  const bar = q(".tabbar").getBoundingClientRect();
  const fab = vis(q(".fab")) ? q(".fab").getBoundingClientRect() : null;
  const out = [];
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  for (const el of qa(".view:not([hidden]) button, .view:not([hidden]) input, .view:not([hidden]) a, .view:not([hidden]) summary")) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    if (hit(r, bar)) out.push({ sel: path(el), over: "tabbar", text: (el.textContent || "").trim().slice(0, 24) });
    else if (fab && hit(r, fab)) out.push({ sel: path(el), over: "fab", text: (el.textContent || "").trim().slice(0, 24) });
  }
  return out;
};
`;

const VIEWS = ["accueil", "depenses", "bilan", "recurrent", "reglages"];

async function scan(page, label) {
  const over = await evalOn(page, "return overflowReport();");
  for (const o of over) note(label, `debordement ${o.kind} de ${o.by}px - ${o.sel}${o.text ? ` « ${o.text} »` : ""}`);
  const clip = await evalOn(page, "return clippedText();");
  for (const c of clip) note(label, `texte coupe sans ellipsis - ${c.sel} « ${c.text} »`);
  const small = await evalOn(page, "return smallTargets();");
  for (const s of small) note(label, `cible tactile ${s.w}x${s.h} (min 44) - ${s.sel} « ${s.text} »`);
  const under = await evalOn(page, "return underChrome();");
  for (const u of under) note(label, `masque par ${u.over} - ${u.sel} « ${u.text} »`);
}

(async () => {
  const server = await serve(WEB, PORT);
  const { proc, browserWs } = await launchChrome(DBG, path.join(__dirname, ".tmp", "profil"));
  const { page, errors } = await newPage(browserWs, "about:blank", SEED + HELPERS);

  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await page.send("Page.navigate", { url: URL_APP });
  await new Promise((r) => setTimeout(r, 1500));

  console.log("\n=== balayage des vues (iPhone 390x844) ===");
  for (const v of VIEWS) {
    await evalOn(page, `go("${v}"); return 1;`);
    await new Promise((r) => setTimeout(r, 250));
    await scan(page, v);
    await evalOn(page, "scrollTo(0, document.scrollingElement.scrollHeight); return 1;");
    await new Promise((r) => setTimeout(r, 250));
    await scan(page, v + " (bas)");
    await evalOn(page, "scrollTo(0,0); return 1;");
  }

  console.log("\n=== accueil en mode Gerer ===");
  await evalOn(page, `go("accueil"); await new Promise(r=>setTimeout(r,200)); if (!q("#toggle-manage").classList.contains("on")) q("#toggle-manage").click(); return 1;`);
  await new Promise((r) => setTimeout(r, 300));
  await scan(page, "gerer");
  await evalOn(page, "scrollTo(0, document.scrollingElement.scrollHeight); return 1;");
  await new Promise((r) => setTimeout(r, 250));
  await scan(page, "gerer (bas)");
  await evalOn(page, `scrollTo(0,0); q("#toggle-manage").click(); return 1;`);

  console.log("\n=== bandeau de mise a jour ===");
  await evalOn(page, `go("accueil"); q("#update-bar").hidden = false; q("#update-bar").classList.add("show"); return 1;`);
  await new Promise((r) => setTimeout(r, 300));
  await scan(page, "bandeau");
  await evalOn(page, `q("#update-dismiss").click(); return 1;`);

  console.log("\n=== tiroirs ===");
  const SHEETS = [
    { label: "tiroir depense", open: `q("#fab").click();` },
    { label: "tiroir revenu", open: `q("#fab").click(); await new Promise(r=>setTimeout(r,300)); q('#tx-type [data-type="revenu"]').click();` },
    { label: "tiroir enveloppe", open: `go("accueil"); q("#toggle-manage").click(); await new Promise(r=>setTimeout(r,150)); q("#env-add").click();` },
    { label: "tiroir enveloppe (edition)", open: `go("accueil"); if (!q("#toggle-manage").classList.contains("on")) q("#toggle-manage").click(); await new Promise(r=>setTimeout(r,150)); q('[data-env]').click();` },
    { label: "tiroir recurrent depense", open: `go("recurrent"); await new Promise(r=>setTimeout(r,200)); q("#recurring-add").click();` },
    { label: "tiroir recurrent revenu", open: `go("recurrent"); await new Promise(r=>setTimeout(r,200)); q("#income-add").click();` },
  ];
  for (const s of SHEETS) {
    await evalOn(page, `q("#scrim").click(); await new Promise(r=>setTimeout(r,350)); ${s.open} return 1;`);
    await new Promise((r) => setTimeout(r, 500));
    const shown = await evalOn(page, `const s = qa(".sheet").find(x => x.classList.contains("show")); return s ? { id: s.id, h: Math.round(s.getBoundingClientRect().height), top: Math.round(s.getBoundingClientRect().top) } : null;`);
    if (!shown) { note(s.label, "le tiroir ne s'ouvre pas"); continue; }
    console.log(`  . ${s.label} -> #${shown.id}, hauteur ${shown.h}px, haut a ${shown.top}px`);
    if (shown.top < 0) note(s.label, `le tiroir depasse en haut de l'ecran (top ${shown.top}px)`);
    await scan(page, s.label);
  }
  await evalOn(page, `q("#scrim").click(); return 1;`);

  console.log("\n=== balayage de tous les boutons (exception / inertie) ===");
  for (const v of VIEWS) {
    const list = await evalOn(page, `go("${v}"); await new Promise(r=>setTimeout(r,200));
      return qa(".view:not([hidden]) button").map((b, i) => ({ i, sel: path(b), vis: vis(b), text: (b.textContent||b.ariaLabel||"").trim().slice(0,30) })).filter(b => b.vis);`);
    for (const b of list) {
      const before = errors.length;
      const res = await evalOn(page, `go("${v}"); await new Promise(r=>setTimeout(r,150));
        const b = qa(".view:not([hidden]) button")[${b.i}];
        if (!b) return { skip: true };
        // ni un bouton deja dans l'etat qu'il choisit, ni un bouton desactive,
        // n'ont a changer quoi que ce soit : ce n'est pas de l'inertie
        if (b.classList.contains("on") || b.disabled) return { skip: true };
        const snap = document.body.innerHTML;
        b.click();
        await new Promise(r=>setTimeout(r,250));
        const sheet = qa(".sheet").some(s => s.classList.contains("show"));
        const toastOn = q("#toast") && !q("#toast").hidden;
        const changed = document.body.innerHTML !== snap;
        if (sheet) { q("#scrim").click(); await new Promise(r=>setTimeout(r,320)); }
        return { changed, sheet, toastOn };`).catch((e) => ({ err: String(e.message).slice(0, 120) }));
      if (res.err) note(v, `exception au clic sur « ${b.text} » (${b.sel}) : ${res.err}`);
      else if (errors.length > before) note(v, `erreur console au clic sur « ${b.text} » : ${errors[before]}`);
      else if (!res.skip && !res.changed && !res.sheet && !res.toastOn) note(v, `bouton inerte : « ${b.text} » (${b.sel}) - rien ne bouge, rien ne s'affiche`);
    }
  }

  console.log("\n=== theme sombre ===");
  await evalOn(page, `go("reglages"); await new Promise(r=>setTimeout(r,150)); q('[data-theme-set="dark"]').click(); return 1;`);
  for (const v of VIEWS) {
    await evalOn(page, `go("${v}"); return 1;`);
    await new Promise((r) => setTimeout(r, 200));
    await scan(page, "sombre/" + v);
  }
  await evalOn(page, `go("reglages"); q('[data-theme-set="auto"]').click(); return 1;`);

  console.log("\n=== petit ecran (320x568) ===");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 300));
  for (const v of VIEWS) {
    await evalOn(page, `go("${v}"); return 1;`);
    await new Promise((r) => setTimeout(r, 200));
    await scan(page, "320/" + v);
  }

  console.log("\n=== etat vide (aucune donnee) ===");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evalOn(page, `localStorage.clear(); localStorage.setItem("mon-budget/v1", JSON.stringify({version:1,envelopes:[],expenses:[],incomes:[],recurring:[],settings:{theme:"auto",chart:"barre"},updatedAt:Date.now()})); return 1;`);
  await page.send("Page.navigate", { url: URL_APP + "?vide=1" });
  await new Promise((r) => setTimeout(r, 1500));
  for (const v of VIEWS) {
    await evalOn(page, `go("${v}"); return 1;`);
    await new Promise((r) => setTimeout(r, 250));
    await scan(page, "vide/" + v);
  }
  const fabEmpty = await evalOn(page, `go("accueil"); q("#fab").click(); await new Promise(r=>setTimeout(r,350));
    return { sheet: qa(".sheet").some(s=>s.classList.contains("show")), toast: q("#toast").hidden ? null : q("#toast").textContent };`);
  console.log("  . + sans enveloppe ->", JSON.stringify(fabEmpty));

  if (errors.length) {
    console.log("\n=== exceptions relevees ===");
    for (const e of [...new Set(errors)]) console.log("  x " + e.slice(0, 200));
  }

  console.log(`\n${findings.length} anomalie(s).`);
  proc.kill();
  server.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
