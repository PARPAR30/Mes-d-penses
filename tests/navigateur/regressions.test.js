/*
 * Regressions : chaque bug corrige dans Mon Budget a son test ici, plus les
 * parcours de base (ajouter, modifier, supprimer) qui ne doivent jamais casser.
 *
 * Tout tourne dans un vrai Chrome pilote par le protocole DevTools : jsdom ne
 * reproduit ni le cache canvas qui dimensionne le champ montant, ni la regle
 * [hidden]{display:none} de la feuille par defaut, ni la mise en page.
 *
 *   node tests/navigateur/regressions.test.js
 */
const path = require("path");
const { serve, launchChrome, newPage, evalOn, navigateAndWait } = require("./cdp.js");

const WEB = path.join(__dirname, "..", "..", "web");
const PORT = 8763;
const DBG = 9363;
const URL_APP = `http://127.0.0.1:${PORT}/index.html`;
const READY = 'document.documentElement.getAttribute("data-app-ready") === "1"';

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    failures.push(name + (detail !== undefined ? "  ->  " + JSON.stringify(detail) : ""));
    console.log("  FAIL  " + name + (detail !== undefined ? "  ->  " + JSON.stringify(detail) : ""));
  }
}

const HELPERS = `
window.q = (s) => document.querySelector(s);
window.qa = (s) => [...document.querySelectorAll(s)];
window.go = (v) => { const b = q('.tabbar [data-view="' + v + '"]'); if (b) b.click(); };
window.wait = (ms) => new Promise((r) => setTimeout(r, ms || 260));
window.stored = () => JSON.parse(localStorage.getItem("mon-budget/v1") || "null");
window.vis = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
};
window.pad = (n) => String(n).padStart(2, "0");
window.mkey = (delta) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + (delta || 0), 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
};
window.baseData = (over) => Object.assign({
  version: 1,
  envelopes: [
    { id: "e1", ordre: 0, nom: "Logement", couleur: "#3f6de0", budget: 80000 },
    { id: "e2", ordre: 1, nom: "Courses", couleur: "#e4634a", budget: 40000 },
    { id: "e3", ordre: 2, nom: "Transports", couleur: "#23a26d", budget: 15000 },
  ],
  expenses: [], incomes: [], recurring: [],
  settings: { theme: "auto", chart: "barre" }, updatedAt: Date.now(),
}, over || {});
`;

/** Recharge l'appli avec le jeu de donnees voulu. */
async function boot(page, dataExpr) {
  await evalOn(page, `localStorage.setItem("mon-budget/v1", JSON.stringify(${dataExpr})); return 1;`);
  await navigateAndWait(page, URL_APP, READY);
  await evalOn(page, "return 1;");
}

(async () => {
  const server = await serve(WEB, PORT);
  const { proc, browserWs } = await launchChrome(DBG, path.join(__dirname, ".tmp", "reg"));
  const { page, errors } = await newPage(browserWs, "about:blank", HELPERS);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await navigateAndWait(page, URL_APP, READY);

  // ---------------------------------------------------------------- montants
  console.log("\nLecture des montants");
  const amounts = await evalOn(page, `return {
    virgule: parseAmount("12,50"),
    point: parseAmount("12.50"),
    espace: parseAmount("1 234,56"),
    fr: parseAmount("1.234,56"),
    en: parseAmount("1,234.56"),
    devise: parseAmount("12,50 €"),
    zero: parseAmount("0"),
    vide: parseAmount(""),
    negatif: parseAmount("-4"),
  };`);
  check("12,50 -> 1250", amounts.virgule === 1250, amounts.virgule);
  check("12.50 -> 1250", amounts.point === 1250, amounts.point);
  check("1 234,56 -> 123456", amounts.espace === 123456, amounts.espace);
  check("1.234,56 (milliers a la francaise) -> 123456", amounts.fr === 123456, amounts.fr);
  check("1,234.56 (milliers a l'anglaise) -> 123456", amounts.en === 123456, amounts.en);
  check("12,50 € -> 1250", amounts.devise === 1250, amounts.devise);
  check("0 refuse", amounts.zero === null, amounts.zero);
  check("vide refuse", amounts.vide === null, amounts.vide);
  check("negatif refuse", amounts.negatif === null, amounts.negatif);

  // -------------------------------------------------- champ montant : gros nombre
  console.log("\nChamp montant");
  const big = await evalOn(page, `
    q("#fab").click(); await wait(340);
    const i = q("#tx-amount");
    const res = {};
    for (const v of ["12,50", "12345678,90"]) {
      i.value = v; i.dispatchEvent(new Event("input")); await wait(80);
      const cs = getComputedStyle(i);
      const c = document.createElement("canvas").getContext("2d");
      c.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
      res[v] = { taille: parseFloat(cs.fontSize), rogne: c.measureText(v).width > i.clientWidth + 1 };
    }
    q("#scrim").click(); await wait(320);
    return res;`);
  check("montant court : pas rogne", big["12,50"].rogne === false, big["12,50"]);
  check("montant long : pas rogne non plus", big["12345678,90"].rogne === false, big["12345678,90"]);
  check("montant long : la fonte a retreci", big["12345678,90"].taille < big["12,50"].taille, big);

  // ------------------------------------------------ bouton + sans enveloppe
  console.log("\nBouton + sans aucune enveloppe");
  await boot(page, `baseData({ envelopes: [] })`);
  const noEnv = await evalOn(page, `
    q("#fab").click(); await wait(360);
    return {
      tiroir: qa(".sheet").some((s) => s.classList.contains("show")),
      type: q('#tx-type button.on') ? q('#tx-type button.on').dataset.type : null,
      enveloppeMasquee: q("#tx-env-block").hidden,
      message: q("#toast").hidden ? null : q("#toast").textContent,
    };`);
  check("le tiroir s'ouvre quand meme", noEnv.tiroir === true, noEnv);
  check("il s'ouvre cote revenu", noEnv.type === "revenu", noEnv);
  check("le selecteur d'enveloppe est masque", noEnv.enveloppeMasquee === true, noEnv);
  check("un message explique pourquoi", Boolean(noEnv.message), noEnv);
  const savedIncome = await evalOn(page, `
    q("#tx-amount").value = "150"; q("#tx-label").value = "Prime";
    q("#tx-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await wait(320);
    const d = stored();
    return { revenus: d.incomes.length, montant: d.incomes[0] && d.incomes[0].montant, depenses: d.expenses.length };`);
  check("le revenu est bien enregistre sans enveloppe", savedIncome.revenus === 1 && savedIncome.montant === 15000, savedIncome);

  // ------------------------------------------------- recurrences : rattrapage
  console.log("\nRecurrences : mois manques");
  await boot(page, `baseData({ recurring: [
    { id: "r1", type: "depense", montant: 85000, libelle: "Loyer", jour: 3, actif: true, icone: null, envelopeId: "e1", debut: mkey(-3), createdAt: Date.now() },
  ] })`);
  const back = await evalOn(page, `
    const d = stored();
    return { dates: d.expenses.map((x) => x.date).sort(), mois: [...new Set(d.expenses.map((x) => x.date.slice(0, 7)))].sort() };`);
  check("les trois mois manques sont rattrapes, plus le mois en cours", back.mois.length === 4, back);
  check("le rattrapage ne remonte pas avant « debut »", back.mois[0] === (await evalOn(page, "return mkey(-3);")), back);
  check("aucun mois futur", back.mois[back.mois.length - 1] === (await evalOn(page, "return mkey(0);")), back);

  const idem = await evalOn(page, `location.reload(); return 1;`).then(async () => {
    await navigateAndWait(page, URL_APP, READY);
    return evalOn(page, "return stored().expenses.length;");
  });
  check("un second demarrage ne redouble rien", idem === 4, idem);

  await boot(page, `baseData({ recurring: [
    { id: "r1", type: "depense", montant: 1000, libelle: "Vieux", jour: 1, actif: true, icone: null, envelopeId: "e1", debut: mkey(-40), createdAt: Date.now() },
  ] })`);
  const capped = await evalOn(page, "return stored().expenses.length;");
  check("un « debut » tres ancien est plafonne a 12 mois + le mois courant", capped === 13, capped);

  await boot(page, `baseData({ recurring: [
    { id: "r1", type: "depense", montant: 1000, libelle: "En pause", jour: 1, actif: false, icone: null, envelopeId: "e1", debut: mkey(-3), createdAt: Date.now() },
  ] })`);
  const paused = await evalOn(page, "return stored().expenses.length;");
  check("une regle en pause ne genere rien", paused === 0, paused);
  const resumed = await evalOn(page, `
    go("recurrent"); await wait(220);
    q("[data-recurring]").click(); await wait(340);
    q('#recurring-state [data-active="1"]').click();
    q("#recurring-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await wait(340);
    const d = stored();
    return { nb: d.expenses.length, debut: d.recurring[0].debut, moisCourant: mkey(0) };`);
  check("la reactivation ne rattrape pas la pause", resumed.nb <= 1, resumed);
  check("elle repart du mois en cours", resumed.debut === resumed.moisCourant, resumed);

  // ------------------------------------------------ donnees abimees
  console.log("\nSauvegarde abimee");
  await boot(page, `({
    version: 1,
    envelopes: [
      { id: "e1", nom: "Sans budget", couleur: "#3f6de0" },
      { id: "e2", nom: "Budget texte", couleur: "#e4634a", budget: "beaucoup" },
      { nom: "", couleur: "#23a26d", budget: 100 },
    ],
    expenses: [
      { id: "x1", montant: "12,50", libelle: "montant texte", date: mkey(0) + "-05", envelopeId: "e1" },
      { id: "x2", montant: 1000, libelle: "SANS DATE", envelopeId: "e1" },
      { id: "x3", montant: 2000, libelle: "enveloppe fantome", date: mkey(0) + "-06", envelopeId: "zzz" },
    ],
    incomes: null,
    recurring: [{ id: "r1", libelle: "sans type", montant: 500, jour: 99, actif: true, envelopeId: "e1" }],
    settings: { theme: "violet", chart: "spirale" },
    updatedAt: Date.now(),
  })`);
  const repaired = await evalOn(page, `
    go("accueil"); await wait(220);
    const d = stored();
    return {
      rendu: qa("#env-list .env").length,
      total: q("#total-figure").textContent,
      enveloppes: d.envelopes.map((e) => [e.nom, e.budget]),
      depenses: d.expenses.map((x) => [x.libelle, x.montant, x.envelopeId]),
      incomes: Array.isArray(d.incomes),
      jour: d.recurring[0] && d.recurring[0].jour,
      theme: d.settings.theme, chart: d.settings.chart,
    };`);
  check("l'appli affiche encore ses enveloppes", repaired.rendu === 2, repaired);
  check("le total n'est pas NaN", !/NaN/.test(repaired.total), repaired.total);
  check("l'enveloppe sans budget vaut 0", repaired.enveloppes.some((e) => e[0] === "Sans budget" && e[1] === 0), repaired.enveloppes);
  check("un budget en toutes lettres retombe a 0", repaired.enveloppes.some((e) => e[0] === "Budget texte" && e[1] === 0), repaired.enveloppes);
  check("l'enveloppe sans nom est ecartee", repaired.enveloppes.length === 2, repaired.enveloppes);
  check("« 12,50 » en texte devient 1250 centimes", repaired.depenses.some((x) => x[0] === "montant texte" && x[1] === 1250), repaired.depenses);
  check("la depense SANS DATE est ecartee", !repaired.depenses.some((x) => x[0] === "SANS DATE"), repaired.depenses);
  check("la depense orpheline est gardee, sans enveloppe", repaired.depenses.some((x) => x[0] === "enveloppe fantome" && x[2] === null), repaired.depenses);
  check("incomes:null redevient un tableau", repaired.incomes === true, repaired.incomes);
  check("un jour 99 est ramene dans 1..28", repaired.jour === 28, repaired.jour);
  check("un theme inconnu retombe sur auto", repaired.theme === "auto", repaired.theme);
  check("un graphique inconnu retombe sur barre", repaired.chart === "barre", repaired.chart);

  const orphanShare = await evalOn(page, `
    go("bilan"); await wait(260);
    const parts = qa(".legend-p").map((e) => parseInt(e.textContent, 10));
    return { noms: qa(".legend-n").map((e) => e.textContent), somme: parts.reduce((a, b) => a + b, 0) };`);
  check("« Sans enveloppe » apparait dans la repartition", orphanShare.noms.includes("Sans enveloppe"), orphanShare);
  check("les parts font bien 100 %", Math.abs(orphanShare.somme - 100) <= 1, orphanShare);

  // ------------------------------------------------ bouton dangereux
  console.log("\nBouton dangereux");
  await boot(page, `baseData()`);
  const armed = await evalOn(page, `
    go("reglages"); await wait(220);
    q("#reset-btn").click(); await wait(120);
    const arme = q("#reset-btn").textContent;
    go("accueil"); await wait(200); go("reglages"); await wait(200);
    return { arme, apres: q("#reset-btn").textContent };`);
  check("« Tout effacer » demande confirmation", /\?/.test(armed.arme), armed);
  check("il se desarme si on quitte la vue", !/\?/.test(armed.apres), armed);

  // ------------------------------------------------ recherche
  console.log("\nRecherche");
  await boot(page, `baseData({ expenses: [
    { id: "x1", montant: 1000, libelle: "Boulangerie", date: mkey(0) + "-05", envelopeId: "e2", createdAt: 1 },
    { id: "x2", montant: 2000, libelle: "Boulangerie", date: mkey(-2) + "-05", envelopeId: "e2", createdAt: 2 },
    { id: "x3", montant: 500, libelle: "Metro", date: mkey(0) + "-06", envelopeId: "e3", createdAt: 3 },
  ] })`);
  const search = await evalOn(page, `
    go("depenses"); await wait(220);
    const s = q("#tx-search"); s.value = "boulangerie"; s.dispatchEvent(new Event("input")); await wait(220);
    const avecRecherche = { lignes: qa("#tx-list .tx").length, recap: q("#tx-sum").hidden ? null : q("#tx-sum").textContent };
    s.value = ""; s.dispatchEvent(new Event("input")); await wait(220);
    return { avecRecherche, sansRecherche: { lignes: qa("#tx-list .tx").length, recap: q("#tx-sum").hidden } };`);
  check("la recherche trouve aussi les autres mois", search.avecRecherche.lignes === 2, search);
  check("le recapitulatif donne le total trouve", /30,00/.test(search.avecRecherche.recap || ""), search.avecRecherche);
  check("sans recherche, on revient au mois affiche", search.sansRecherche.lignes === 2, search);
  check("et le recapitulatif disparait", search.sansRecherche.recap === true, search);

  // ------------------------------------------------ historique cliquable
  console.log("\nSix derniers mois");
  const hist = await evalOn(page, `
    go("bilan"); await wait(260);
    const bars = qa("#hist button");
    const avant = q("#month-name").textContent;
    const cible = Math.round(bars[3].getBoundingClientRect().height);
    bars[3].click(); await wait(260);
    return { nb: bars.length, balise: bars[0].tagName, avant, apres: q("#month-name").textContent, cible };`);
  check("les barres sont des boutons", hist.balise === "BUTTON" && hist.nb === 6, hist);
  check("toucher un mois y emmene", hist.avant !== hist.apres, hist);
  check("la cible fait toute la hauteur", hist.cible >= 60, hist);

  // ------------------------------------------------ ordre des enveloppes
  console.log("\nOrdre des enveloppes");
  await boot(page, `baseData()`);
  const order = await evalOn(page, `
    go("accueil"); await wait(200);
    q("#toggle-manage").click(); await wait(220);
    const avant = qa("#env-list .env-n").map((e) => e.textContent);
    const premiersBoutons = qa("#env-list .env-row")[0].querySelectorAll(".env-move");
    const monterDesactive = premiersBoutons[0].disabled;
    qa("#env-list .env-row")[2].querySelectorAll(".env-move")[0].click(); await wait(260);
    const apres = qa("#env-list .env-n").map((e) => e.textContent);
    return { avant, apres, monterDesactive, ordres: stored().envelopes.map((e) => [e.nom, e.ordre]) };`);
  check("« Monter » est desactive sur la premiere", order.monterDesactive === true, order);
  check("la troisieme enveloppe remonte", order.apres[1] === order.avant[2] && order.apres[2] === order.avant[1], order);
  check("le nouvel ordre est enregistre", order.ordres.every((o) => Number.isInteger(o[1])), order.ordres);

  // ------------------------------------------------ duplication
  console.log("\nDuplication d'un mouvement");
  await boot(page, `baseData({ expenses: [
    { id: "x1", montant: 4250, libelle: "Plein", date: mkey(-1) + "-08", envelopeId: "e3", createdAt: 1 },
  ] })`);
  const dup = await evalOn(page, `
    q("#prev-month").click(); await wait(220);
    go("depenses"); await wait(220);
    q("[data-tx]").click(); await wait(340);
    const visible = vis(q("#tx-duplicate"));
    q("#tx-duplicate").click(); await wait(340);
    const etat = { montant: q("#tx-amount").value, libelle: q("#tx-label").value, date: q("#tx-date").value,
                   titre: q("#tx-title").textContent, supprimerMasque: q("#tx-delete").hidden };
    const avant = stored().expenses.length;
    q("#tx-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    const d = stored();
    return { visible, etat, avant, apres: d.expenses.length,
             dates: d.expenses.map((x) => x.date), aujourdhui: (() => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); })() };`);
  check("« Dupliquer » apparait en modification", dup.visible === true, dup);
  check("le montant est repris", dup.etat.montant === "42,50", dup.etat);
  check("le libelle est repris", dup.etat.libelle === "Plein", dup.etat);
  check("la copie est datee d'aujourd'hui", dup.etat.date === dup.aujourdhui, dup.etat);
  check("le tiroir repasse en creation", /Nouvelle/.test(dup.etat.titre) && dup.etat.supprimerMasque === true, dup.etat);
  check("rien n'est ecrit avant validation", dup.avant === 1, dup);
  check("la validation cree bien la copie", dup.apres === 2, dup);

  // ------------------------------------------------ rythme du mois
  console.log("\nRythme du mois");
  await boot(page, `baseData({ expenses: [
    { id: "x1", montant: 120000, libelle: "Gros", date: mkey(0) + "-01", envelopeId: "e1", createdAt: 1 },
  ] })`);
  const paceNow = await evalOn(page, `
    go("accueil"); await wait(240);
    return { repere: qa("#total-track .total-mark").length, texte: q("#total-pace").hidden ? null : q("#total-pace").textContent,
             jour: new Date().getDate() };`);
  const paceOld = await evalOn(page, `
    q("#prev-month").click(); await wait(240);
    return { repere: qa("#total-track .total-mark").length, cache: q("#total-pace").hidden };`);
  check("le repere de rythme est pose sur le mois en cours", paceNow.repere === 1, paceNow);
  check("la projection s'affiche a partir du 7 du mois", paceNow.jour < 7 ? paceNow.texte === null : Boolean(paceNow.texte), paceNow);
  check("aucun repere sur un mois passe", paceOld.repere === 0 && paceOld.cache === true, paceOld);

  // ------------------------------------------------ parcours de base
  console.log("\nParcours de base");
  await boot(page, `baseData()`);
  const flow = await evalOn(page, `
    // creer une depense
    q("#fab").click(); await wait(340);
    q("#tx-amount").value = "23,40"; q("#tx-label").value = "Monoprix";
    q('#tx-env-picker [data-pick="e2"]').click();
    q("#tx-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    const cree = stored().expenses;
    // la modifier
    go("depenses"); await wait(240);
    q("[data-tx]").click(); await wait(340);
    q("#tx-amount").value = "30";
    q("#tx-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    const modifie = stored().expenses[0].montant;
    // la supprimer (confirmation en deux temps)
    go("depenses"); await wait(240);
    q("[data-tx]").click(); await wait(340);
    q("#tx-delete").click(); await wait(120);
    const question = q("#tx-delete").textContent;
    q("#tx-delete").click(); await wait(340);
    const restant = stored().expenses.length;
    // creer une enveloppe
    go("accueil"); await wait(220);
    q("#toggle-manage").click(); await wait(220);
    q("#env-add").click(); await wait(340);
    q("#env-name").value = "Sante"; q("#env-budget").value = "90";
    q("#env-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    const enveloppes = stored().envelopes.length;
    return { cree: cree.length, montant: cree[0] && cree[0].montant, enveloppe: cree[0] && cree[0].envelopeId,
             modifie, question, restant, enveloppes };`);
  check("une depense se cree", flow.cree === 1 && flow.montant === 2340 && flow.enveloppe === "e2", flow);
  check("elle se modifie", flow.modifie === 3000, flow);
  check("la suppression demande confirmation", /\?/.test(flow.question), flow);
  check("puis supprime", flow.restant === 0, flow);
  check("une enveloppe se cree", flow.enveloppes === 4, flow);

  // ------------------------------------------------ modeles de recurrence
  console.log("\nModeles (pastilles de marque) et libelle");
  await boot(page, `baseData()`);
  const icones = await evalOn(page, `
    go("recurrent"); await wait(240);
    q("#recurring-add").click(); await wait(360);
    const champ = q("#recurring-label");
    const pick = async (id) => { q('#recurring-icon-picker [data-icon="' + id + '"]').click(); await wait(200); };

    await pick("netflix");
    const premier = champ.value;
    await pick("spotify");
    const second = champ.value;
    await pick("edf");
    const troisieme = champ.value;

    // un libelle ecrit a la main ne doit plus bouger
    champ.value = "Abonnement de Marie";
    await pick("deezer");
    const ecritAlaMain = champ.value;

    // repartir d'un modele : le libelle recolle au modele
    champ.value = "";
    await pick("free");
    const repris = champ.value;

    const chip = q("#recurring-icon-picker button.on");
    return { premier, second, troisieme, ecritAlaMain, repris,
             pastilleActive: chip && chip.dataset.icon, mono: chip && chip.textContent };`);
  check("le premier modele remplit le libelle", icones.premier === "Netflix", icones);
  check("en changer met le libelle a jour", icones.second === "Spotify", icones);
  check("et encore au troisieme", icones.troisieme === "EDF", icones);
  check("un libelle ecrit a la main est respecte", icones.ecritAlaMain === "Abonnement de Marie", icones);
  check("un libelle vide se laisse remplir a nouveau", icones.repris === "Free", icones);
  check("la pastille choisie est bien celle affichee", icones.pastilleActive === "free" && icones.mono === "F", icones);

  const bascule = await evalOn(page, `
    const champ = q("#recurring-label");
    q('#recurring-icon-picker [data-icon="netflix"]').click(); await wait(200);
    const avant = champ.value;
    q('#recurring-type [data-type="revenu"]').click(); await wait(260);
    const apres = champ.value;
    const modeles = qa("#recurring-icon-picker [data-icon]").map((b) => b.dataset.icon);
    q('#recurring-icon-picker [data-icon="salaire"]').click(); await wait(200);
    const revenu = champ.value;
    return { avant, apres, modeles, revenu, aucunChoisi: !q("#recurring-icon-picker button.on").dataset.icon };`);
  check("passer en revenu vide le libelle venu d'un modele de depense", bascule.avant === "Netflix" && bascule.apres === "", bascule);
  check("les modeles proposes sont ceux du revenu", !bascule.modeles.includes("netflix") && bascule.modeles.includes("salaire"), bascule.modeles);
  check("un modele de revenu remplit le libelle", bascule.revenu === "Salaire", bascule);

  const garde = await evalOn(page, `
    const champ = q("#recurring-label");
    champ.value = "Mon salaire a moi";
    q('#recurring-type [data-type="depense"]').click(); await wait(260);
    return { apres: champ.value };`);
  check("un libelle ecrit a la main survit au changement de type", garde.apres === "Mon salaire a moi", garde);

  const enregistre = await evalOn(page, `
    q("#recurring-amount").value = "13,99";
    q('#recurring-icon-picker [data-icon="netflix"]').click(); await wait(200);
    q("#recurring-label").value = "Netflix";
    q("#recurring-day").value = "5";
    q("#recurring-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(360);
    const r = stored().recurring[0];
    return { icone: r && r.icone, libelle: r && r.libelle, chip: q("#recurring-list .chip") ? q("#recurring-list .chip").textContent : null };`);
  check("le modele choisi est enregistre avec la regle", enregistre.icone === "netflix" && enregistre.libelle === "Netflix", enregistre);
  check("la liste affiche sa pastille", enregistre.chip === "N", enregistre);

  // ------------------------------------------------ graphique et filtres
  console.log("\nBilan : forme du graphique, parts, filtre");
  await boot(page, `baseData({ expenses: [
    { id: "x1", montant: 30000, libelle: "Loyer", date: mkey(0) + "-02", envelopeId: "e1", createdAt: 1 },
    { id: "x2", montant: 10000, libelle: "Drive", date: mkey(0) + "-03", envelopeId: "e2", createdAt: 2 },
  ] })`);
  const chart = await evalOn(page, `
    go("bilan"); await wait(280);
    const depart = { barre: vis(q("#chart-bar")), camembert: vis(q("#chart-pie")) };
    q('[data-chart="camembert"]').click(); await wait(280);
    const bascule = { barre: vis(q("#chart-bar")), camembert: vis(q("#chart-pie")),
                      arcs: qa("#pie-svg circle").length, centre: q("#pie-value").textContent };
    q('[data-chart="barre"]').click(); await wait(280);
    const retour = { barre: vis(q("#chart-bar")), camembert: vis(q("#chart-pie")) };
    return { depart, bascule, retour, memoire: stored().settings.chart };`);
  check("le bilan s'ouvre en barre", chart.depart.barre && !chart.depart.camembert, chart.depart);
  check("« Camembert » bascule vraiment", !chart.bascule.barre && chart.bascule.camembert, chart.bascule);
  check("le camembert a un arc par part", chart.bascule.arcs === 2, chart.bascule);
  check("son centre porte le total", /400,00/.test(chart.bascule.centre || ""), chart.bascule);
  check("« Barre » revient en arriere", chart.retour.barre && !chart.retour.camembert, chart.retour);
  check("le choix est retenu", chart.memoire === "barre", chart.memoire);

  const slice = await evalOn(page, `
    const seg = qa("#chart-bar button")[0];
    seg.click(); await wait(260);
    const choisi = q("#chart-tip").textContent;
    qa("#chart-bar button")[0].click(); await wait(260);
    return { choisi, relache: q("#chart-tip").textContent };`);
  check("toucher une part affiche son detail", /Logement/.test(slice.choisi), slice);
  check("la retoucher relache la selection", /Touche/.test(slice.relache), slice);

  const filtre = await evalOn(page, `
    go("accueil"); await wait(240);
    qa("#env-list [data-env]")[1].click(); await wait(280);
    const apres = { vue: qa(".view:not([hidden])")[0].id, barre: q("#filter-bar").hidden ? null : q("#filter-label").textContent,
                    lignes: qa("#tx-list .tx").length };
    q("#clear-filter").click(); await wait(260);
    return { apres, sansFiltre: qa("#tx-list .tx").length, barreFermee: q("#filter-bar").hidden };`);
  check("toucher une enveloppe ouvre ses depenses", filtre.apres.vue === "view-depenses", filtre.apres);
  check("le filtre est nomme et n'y laisse qu'elle", /Courses/.test(filtre.apres.barre || "") && filtre.apres.lignes === 1, filtre.apres);
  check("on peut retirer le filtre", filtre.sansFiltre === 2 && filtre.barreFermee === true, filtre);

  // ------------------------------------------------ theme
  console.log("\nTheme");
  const theme = await evalOn(page, `
    go("reglages"); await wait(240);
    q('[data-theme-set="dark"]').click(); await wait(240);
    const sombre = { attr: document.documentElement.dataset.theme, fond: getComputedStyle(document.body).backgroundColor };
    q('[data-theme-set="light"]').click(); await wait(240);
    const clair = { attr: document.documentElement.dataset.theme, fond: getComputedStyle(document.body).backgroundColor };
    q('[data-theme-set="auto"]').click(); await wait(240);
    return { sombre, clair, auto: document.documentElement.dataset.theme, memoire: stored().settings.theme };`);
  check("le theme sombre s'applique", theme.sombre.attr === "dark" && theme.sombre.fond !== theme.clair.fond, theme);
  check("le theme clair s'applique", theme.clair.attr === "light", theme);
  check("« Auto » retire l'attribut", theme.auto === undefined, theme);
  check("le choix est retenu", theme.memoire === "auto", theme);

  // ------------------------------------------------ calendrier
  console.log("\nCalendrier des recurrences");
  await boot(page, `baseData({ recurring: [
    { id: "r1", type: "depense", montant: 85000, libelle: "Loyer", jour: 3, actif: true, icone: null, envelopeId: "e1", debut: mkey(0), createdAt: Date.now() },
    { id: "r2", type: "revenu", montant: 210000, libelle: "Salaire", jour: 3, actif: true, icone: "salaire", envelopeId: null, debut: mkey(0), createdAt: Date.now() },
  ] })`);
  const cal = await evalOn(page, `
    go("recurrent"); await wait(300);
    const jour3 = qa("#cal-grid [data-day]").find((c) => c.dataset.day.endsWith("-03"));
    const points = jour3.querySelectorAll(".cal-dot").length;
    const vide = q("#cal-day").textContent;
    jour3.click(); await wait(280);
    const ouvert = q("#cal-day").textContent;
    // le rendu a remplace les cases : re-chercher la meme, sinon on clique un noeud detache
    qa("#cal-grid [data-day]").find((c) => c.dataset.day.endsWith("-03")).click(); await wait(280);
    return { points, vide: /Aucun jour/.test(vide), ouvert, referme: /Aucun jour/.test(q("#cal-day").textContent),
             revenus: qa("#income-list .tx").length, depenses: qa("#recurring-list .tx").length };`);
  check("le jour porte un point par type", cal.points === 2, cal);
  check("aucun jour n'est choisi au depart", cal.vide === true, cal);
  check("toucher un jour montre ce qui y tombe", /Loyer/.test(cal.ouvert) && /Salaire/.test(cal.ouvert), cal.ouvert);
  check("le retoucher referme le detail", cal.referme === true, cal);
  check("revenus et depenses sont dans deux listes", cal.revenus === 1 && cal.depenses === 1, cal);

  // ------------------------------------------------ export
  console.log("\nExport");
  const exported = await evalOn(page, `
    let nom = null, contenu = null;
    const vraiClic = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { nom = this.download; contenu = this.href; return; }
      return vraiClic.call(this);
    };
    go("reglages"); await wait(240);
    q("#export-btn").click(); await wait(300);
    HTMLAnchorElement.prototype.click = vraiClic;
    const texte = contenu ? await (await fetch(contenu)).text() : "";
    let lu = null; try { lu = JSON.parse(texte); } catch (e) {}
    return { nom, enveloppes: lu && lu.envelopes.length, recurrences: lu && lu.recurring.length,
             message: q("#toast").hidden ? null : q("#toast").textContent };`);
  check("l'export propose un fichier date", /^mon-budget-\d{4}-\d{2}-\d{2}\.json$/.test(exported.nom || ""), exported.nom);
  check("il contient bien les donnees", exported.enveloppes === 3 && exported.recurrences === 2, exported);
  check("et le dit", /export/i.test(exported.message || ""), exported.message);

  // ------------------------------------------------ raccourci Apple
  console.log("\nRaccourci Apple");
  await evalOn(page, `localStorage.setItem("mon-budget/v1", JSON.stringify(baseData())); return 1;`);
  await navigateAndWait(page, URL_APP + "?ajouter=1&montant=12%2C50&env=Courses&libelle=Pain", READY);
  const shortcut = await evalOn(page, `await wait(300); return {
    tiroir: qa(".sheet").some((s) => s.classList.contains("show")),
    montant: q("#tx-amount").value,
    libelle: q("#tx-label").value,
    enveloppe: q("#tx-env-picker button.on") ? q("#tx-env-picker button.on").textContent : null,
    urlNettoyee: location.search === "",
    enregistre: stored().expenses.length,
  };`);
  check("le lien ouvre le tiroir prerempli", shortcut.tiroir && shortcut.montant === "12,50", shortcut);
  check("le libelle est repris", shortcut.libelle === "Pain", shortcut);
  check("l'enveloppe nommee est preselectionnee", shortcut.enveloppe === "Courses", shortcut);
  check("l'adresse est nettoyee", shortcut.urlNettoyee === true, shortcut);
  check("rien n'est enregistre sans validation", shortcut.enregistre === 0, shortcut);

  // ------------------------------------------------ aucune exception
  const real = [...new Set(errors)];
  check("aucune exception JavaScript", real.length === 0, real.slice(0, 3));

  console.log(`\n${pass} test(s) passes, ${failures.length} echec(s).`);
  if (failures.length) for (const f of failures) console.log("  - " + f);
  proc.kill();
  server.close();
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
