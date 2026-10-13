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
window.go = (v) => { const b = q('[data-view="' + v + '"]'); if (b) b.click(); };
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
  settings: { theme: "auto", chart: "barre", evitable: true }, updatedAt: Date.now(),
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
    for (const v of ["12,50", "123456789012,90"]) {
      i.value = v; i.dispatchEvent(new Event("input")); await wait(80);
      const cs = getComputedStyle(i);
      const c = document.createElement("canvas").getContext("2d");
      c.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
      res[v] = { taille: parseFloat(cs.fontSize), rogne: c.measureText(v).width > i.clientWidth + 1 };
    }
    q("#scrim").click(); await wait(320);
    return res;`);
  check("montant court : pas rogne", big["12,50"].rogne === false, big["12,50"]);
  check("montant long : pas rogne non plus", big["123456789012,90"].rogne === false, big["123456789012,90"]);
  check("montant long : la fonte a retreci", big["123456789012,90"].taille < big["12,50"].taille, big);

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
    settings: { theme: "violet", chart: "spirale", evitable: true },
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
  check("un jour 99 est ramene dans 1..31", repaired.jour === 31, repaired.jour);
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

  // ------------------------------------------------ « Évitable » : une étiquette
  console.log("\nÉtiquette Évitable");
  // une ancienne sauvegarde ne reçoit plus d'enveloppe « Évitable » d'office
  await boot(page, `baseData({ settings: { theme: "auto", chart: "barre" } })`);
  const sansAjout = await evalOn(page, `await wait(200); return stored().envelopes.map((e) => e.nom);`);
  check("plus d'enveloppe « Évitable » ajoutée d'office", sansAjout.length === 3 && !sansAjout.includes("Évitable"), sansAjout);

  // l'étiquette se pose dans le tiroir, se retrouve en liste, au bilan et au filtre
  await boot(page, `baseData({ expenses: [
      { id: "a1", montant: 7500, libelle: "Pain", date: mkey(0) + "-02", envelopeId: "e2", createdAt: 1 },
      { id: "a2", montant: 2500, libelle: "Sushi", date: mkey(0) + "-03", envelopeId: "e2", createdAt: 2, evitable: true } ] })`);
  const etiquette = await evalOn(page, `go("bilan"); await wait(240);
    const bilan = q("#bilan-evitable").hidden ? null : q("#bilan-evitable").textContent;
    go("depenses"); await wait(220);
    const marque = qa("#tx-list .tx").map((r) => r.textContent).filter((t) => /évitable/.test(t)).length;
    q("#filters-toggle").click(); await wait(100); q("#filter-avoidable").click(); await wait(150);
    const filtre = qa("#tx-list .tx").length;
    q("#filters-reset").click(); await wait(100);
    qa("#tx-list .tx")[0].click(); await wait(340);
    const coche = q("#tx-evitable").checked;
    q("#tx-evitable").click(); q("#tx-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    return { bilan, marque, filtre, coche, retire: stored().expenses.some((t) => t.evitable) };`);
  check("le bilan chiffre la part évitable (25 %)", /25,00/.test(etiquette.bilan || "") && /25 %/.test(etiquette.bilan || ""), etiquette);
  check("la liste marque la dépense évitable", etiquette.marque === 1, etiquette);
  check("« Évitables seulement » filtre", etiquette.filtre === 1, etiquette);
  check("l'étiquette se décoche dans le tiroir", etiquette.coche === true && etiquette.retire === false, etiquette);

  // ------------------------------------------------ v1.10 : sélection, filtres, annulation
  console.log("\nSélection, filtres, annulation");
  const depenses10 = `baseData({
    expenses: [
      { id: "a1", montant: 1000, libelle: "Pain", date: mkey(0) + "-02", envelopeId: "e2", createdAt: 1 },
      { id: "a2", montant: 5000, libelle: "Essence", date: mkey(0) + "-03", envelopeId: "e3", createdAt: 2 },
      { id: "a3", montant: 9000, libelle: "Resto", date: mkey(0) + "-04", envelopeId: "e2", createdAt: 3 },
      { id: "a4", montant: 20000, libelle: "Vieux", date: mkey(-2) + "-10", envelopeId: "e1", createdAt: 4 },
    ] })`;
  await boot(page, depenses10);

  // le + vit dans la barre d'onglets
  const barre = await evalOn(page, `go("accueil"); await wait(200);
    return { dansBarre: Boolean(q("#fab").closest(".tabbar")), reglagesHaut: Boolean(q(".topbar [data-view=reglages]")),
             reglagesBas: Boolean(q(".tabbar [data-view=reglages]")), onglets: qa(".tabbar [data-view]").length };`);
  check("le + est dans la barre d'onglets", barre.dansBarre, barre);
  check("Réglages est dans la barre du haut", barre.reglagesHaut && !barre.reglagesBas && barre.onglets === 4, barre);

  // pastilles à initiale
  const pastilles = await evalOn(page, `go("depenses"); await wait(220);
    return qa("#tx-list .tx-dot").map((d) => d.textContent);`);
  check("chaque ligne porte l'initiale de son enveloppe", pastilles.join("") === "CTC", pastilles);

  // filtre par montant
  const montant = await evalOn(page, `q("#filters-toggle").click(); await wait(120);
    const min = q("#amount-min"); min.value = "40"; min.dispatchEvent(new Event("input", { bubbles: true })); await wait(120);
    const avecMin = qa("#tx-list .tx").length;
    const max = q("#amount-max"); max.value = "60"; max.dispatchEvent(new Event("input", { bubbles: true })); await wait(120);
    const fenetre = qa("#tx-list .tx").length;
    const recap = q("#tx-sum").hidden ? null : q("#tx-sum").textContent;
    const compte = q("#filters-count").textContent;
    q("#filters-reset").click(); await wait(120);
    return { avecMin, fenetre, recap, compte, apres: qa("#tx-list .tx").length, min: q("#amount-min").value };`);
  check("un montant minimum filtre", montant.avecMin === 2, montant);
  check("min + max bornent la fenêtre", montant.fenetre === 1, montant);
  check("le récapitulatif suit les filtres", /1 mouvement/.test(montant.recap || "") && /50,00/.test(montant.recap || ""), montant);
  check("le bouton compte les filtres actifs", montant.compte === "2", montant);
  check("Réinitialiser remet tout à plat", montant.apres === 3 && montant.min === "", montant);

  // filtre par période
  const periode = await evalOn(page, `q('[data-period="tout"]').click(); await wait(150);
    const tout = qa("#tx-list .tx").length;
    q('[data-period="3m"]').click(); await wait(150);
    const troisMois = qa("#tx-list .tx").length;
    q('[data-period="30j"]').click(); await wait(150);
    const trente = qa("#tx-list .tx").length;
    q("#filters-reset").click(); await wait(120);
    return { tout, troisMois, trente };`);
  check("« Tout » remonte l'historique", periode.tout === 4, periode);
  check("« 3 mois » inclut le mois d'il y a 2 mois", periode.troisMois === 4, periode);
  check("« 30 jours » ne garde que le récent", periode.trente >= 1 && periode.trente <= 3, periode);

  // sélection + modification groupée
  const groupe = await evalOn(page, `q("#filters-toggle").click(); await wait(100);
    q("#select-toggle").click(); await wait(200);
    const barreVisible = vis(q("#bulkbar")) && !vis(q("#tabbar"));
    const lignes = qa("#tx-list .tx"); lignes[0].click(); await wait(80); qa("#tx-list .tx")[1].click(); await wait(80);
    const compte = q("#bulk-count").textContent;
    q("#bulk-edit").click(); await wait(340);
    const feuille = q("#sheet-bulk").classList.contains("show");
    q('#bulk-env-picker [data-pick="e1"]').click(); await wait(80);
    q("#bulk-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    const apres = stored().expenses.filter((t) => t.envelopeId === "e1").length;
    return { barreVisible, compte, feuille, apres, quitte: !q("#bulkbar").hidden === false && vis(q("#tabbar")) };`);
  check("la sélection remplace la barre d'onglets", groupe.barreVisible, groupe);
  check("le compteur dit 2 sélectionnés", /2 sélectionné/.test(groupe.compte), groupe);
  check("Modifier ouvre le tiroir groupé", groupe.feuille === true, groupe);
  check("l'enveloppe est changée sur toute la sélection", groupe.apres === 3, groupe);
  check("on sort du mode sélection", groupe.quitte, groupe);

  // annuler la modification, puis suppression groupée annulable
  const annule = await evalOn(page, `q(".toast-action").click(); await wait(150);
    const revenu = stored().expenses.filter((t) => t.envelopeId === "e1").length;
    q("#select-toggle").click(); await wait(150);
    q("#bulk-all").click(); await wait(100);
    const tous = q("#bulk-count").textContent;
    const del = q("#bulk-delete"); del.click(); await wait(80);
    const question = del.textContent; del.click(); await wait(260);
    const restant = stored().expenses.length;
    const offre = q(".toast-action") ? q(".toast-action").textContent : null;
    q(".toast-action").click(); await wait(200);
    return { revenu, tous, question, restant, offre, rendu: stored().expenses.length };`);
  check("Annuler remet les enveloppes d'origine", annule.revenu === 1, annule);
  check("« Tout sélectionner » prend les 3 lignes du mois", /3 sélectionné/.test(annule.tous), annule);
  check("la suppression groupée demande confirmation", /\?/.test(annule.question), annule);
  check("elle supprime…", annule.restant === 1, annule);
  check("…en proposant Annuler", annule.offre === "Annuler", annule);
  check("Annuler rend les 3 mouvements", annule.rendu === 4, annule);

  // annuler une suppression simple
  const simple = await evalOn(page, `go("depenses"); await wait(200);
    q('#tx-list .tx').click(); await wait(340);
    const del = q("#tx-delete"); del.click(); await wait(60); del.click(); await wait(340);
    const apres = stored().expenses.length;
    q(".toast-action").click(); await wait(200);
    return { apres, retour: stored().expenses.length };`);
  check("supprimer une dépense propose Annuler", simple.apres === 3, simple);
  check("Annuler la rend", simple.retour === 4, simple);

  // tri « plus entamées »
  await boot(page, `baseData({ expenses: [
      { id: "b1", montant: 2000, libelle: "x", date: mkey(0) + "-02", envelopeId: "e3", createdAt: 1 },
      { id: "b2", montant: 1000, libelle: "y", date: mkey(0) + "-03", envelopeId: "e1", createdAt: 2 } ] })`);
  const tri = await evalOn(page, `go("accueil"); await wait(200);
    const avant = qa("#env-list .env-n").map((e) => e.textContent);
    q("#toggle-sort").click(); await wait(150);
    const apres = qa("#env-list .env-n").map((e) => e.textContent);
    return { avant, apres, memoire: stored().settings.envSort };`);
  check("l'ordre de départ est le sien", tri.avant[0] === "Logement", tri);
  check("« Plus entamées » remonte Transports (13 %) devant Logement (1 %)", tri.apres[0] === "Transports", tri);
  check("le choix est retenu", tri.memoire === "entame", tri);

  // graphique des mois : un total par barre
  const mois = await evalOn(page, `go("bilan"); await wait(240);
    return qa("#hist .hist-v").map((e) => e.textContent);`);
  check("chaque mois affiche son total (ou un tiret)", mois.length === 6 && mois[5] !== "–" && mois[0] === "–", mois);

  // ------------------------------------------------ v2 : budgets par mois, report, jour 31
  console.log("\nBudgets par mois, report, jour d'échéance");
  await boot(page, `baseData({ expenses: [
      { id: "m1", montant: 30000, libelle: "Courses passées", date: mkey(-1) + "-10", envelopeId: "e2", createdAt: 1 } ] })`);
  const budgets = await evalOn(page, `go("accueil"); await wait(200);
    q("#toggle-manage").click(); await wait(150);
    q('.env[data-env="e2"]').click(); await wait(340);
    q("#env-budget").value = "500"; q("#env-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    const e2 = stored().envelopes.find((e) => e.id === "e2");
    const apres = { passe: budgetFor(e2, mkey(-1)), courant: budgetFor(e2, mkey(0)), futur: budgetFor(e2, mkey(2)), base: e2.budget };
    q('.env[data-env="e2"]').click(); await wait(340);
    q("#env-budget").value = "600"; q("#env-budget-past").click();
    q("#env-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    const e2b = stored().envelopes.find((e) => e.id === "e2");
    return { apres, partout: [budgetFor(e2b, mkey(-1)), budgetFor(e2b, mkey(0))] };`);
  check("changer un budget ne touche pas les mois passés", budgets.apres.passe === 40000 && budgets.apres.courant === 50000, budgets);
  check("il vaut pour les mois suivants", budgets.apres.futur === 50000 && budgets.apres.base === 50000, budgets);
  check("« aussi les mois passés » réécrit tout", budgets.partout[0] === 60000 && budgets.partout[1] === 60000, budgets);

  const report = await evalOn(page, `
    const env = { id: "r", ordre: 9, nom: "Report", couleur: "#3f6de0", budget: 10000, budgetHistory: [], report: true, reportDepuis: mkey(-2) };
    state.data.envelopes.push(env);
    state.data.expenses.push({ id: "r1", montant: 4000, date: mkey(-2) + "-05", envelopeId: "r", createdAt: 1, libelle: "a" },
                             { id: "r2", montant: 12000, date: mkey(-1) + "-05", envelopeId: "r", createdAt: 2, libelle: "b" });
    save();
    return { m1: carryIn(env, mkey(-1)), m0: carryIn(env, mkey(0)), dispo: budgetOf(env, mkey(0)), depart: carryIn(env, mkey(-2)) };`);
  check("le reste d'un mois s'ajoute au suivant", report.m1 === 6000, report);
  check("un dépassement ne devient pas une dette", report.m0 === 4000 && report.dispo === 14000, report);
  check("rien n'est reporté avant l'activation", report.depart === 0, report);

  const jours = await evalOn(page, `return [effDay({ jour: 31 }, "2026-02"), effDay({ jour: 31 }, "2026-04"), effDay({ jour: 15 }, "2026-04"), effDay({ jour: 30 }, "2028-02")];`);
  check("le 31 devient le dernier jour du mois court", jours.join(",") === "28,30,15,29", jours);

  // ------------------------------------------------ v2 : supprimer une enveloppe
  console.log("\nSupprimer une enveloppe");
  const enveloppeAvec = `baseData({ expenses: [
      { id: "d1", montant: 1000, libelle: "A", date: mkey(0) + "-02", envelopeId: "e3", createdAt: 1 },
      { id: "d2", montant: 2000, libelle: "B", date: mkey(0) + "-03", envelopeId: "e3", createdAt: 2 } ],
    recurring: [{ id: "rr", type: "depense", montant: 500, libelle: "Pass", jour: 5, actif: true, icone: null, envelopeId: "e3", debut: mkey(0), createdAt: 1 }] })`;
  await boot(page, enveloppeAvec);
  const reaffecte = await evalOn(page, `go("accueil"); await wait(200);
    q("#toggle-manage").click(); await wait(150);
    q('.env[data-env="e3"]').click(); await wait(340);
    const avant = stored().expenses.filter((t) => t.envelopeId === "e3").length;
    q("#env-delete").click(); await wait(400);
    const ouvert = q("#sheet-envdel").classList.contains("show");
    const choix = qa("#envdel-choices [data-fate]").map((b) => b.dataset.fate + ":" + b.classList.contains("on"));
    q('#envdel-picker [data-to="e2"]').click(); await wait(60);
    q("#envdel-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    const d = stored();
    const res = { avant, ouvert, choix, restantes: d.envelopes.length, versE2: d.expenses.filter((t) => t.envelopeId === "e2").length,
                  regle: d.recurring[0].envelopeId, offre: Boolean(q(".toast-action")) };
    q(".toast-action").click(); await wait(250);
    res.apres = { env: stored().envelopes.length, e3: stored().expenses.filter((t) => t.envelopeId === "e3").length, regle: stored().recurring[0].envelopeId };
    return res;`);
  check("une enveloppe pleine propose le sort de ses dépenses", reaffecte.ouvert && reaffecte.choix[0] === "move:true", reaffecte);
  check("réaffecter déplace dépenses et règles", reaffecte.restantes === 2 && reaffecte.versE2 === reaffecte.avant && reaffecte.regle === "e2", reaffecte);
  check("…et Annuler remet tout en place", reaffecte.apres.env === 3 && reaffecte.apres.e3 === reaffecte.avant && reaffecte.apres.regle === "e3", reaffecte);

  await boot(page, enveloppeAvec);
  const archive = await evalOn(page, `go("accueil"); await wait(200);
    q("#toggle-manage").click(); await wait(150);
    q('.env[data-env="e3"]').click(); await wait(340);
    q("#env-delete").click(); await wait(400);
    q('#envdel-choices [data-fate="archive"]').click(); await wait(60);
    q("#envdel-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    const d = stored(); const e3 = d.envelopes.find((e) => e.id === "e3");
    const res = { archivee: e3 && e3.archivee, depenses: d.expenses.length, regleActive: d.recurring[0].actif,
                  saisie: !q('.env[data-env="e3"]') };
    res.restaurable = Boolean(q('[data-restore="e3"]'));
    q('[data-restore="e3"]').click(); await wait(200);
    res.revenue = !stored().envelopes.find((e) => e.id === "e3").archivee;
    return res;`);
  check("archiver garde l'historique et ferme la saisie", archive.archivee === true && archive.depenses >= 2, archive);
  check("ses règles récurrentes sont mises en pause", archive.regleActive === false, archive);
  check("une archivée se restaure", archive.restaurable && archive.revenue, archive);

  // ------------------------------------------------ v2 : suggestion d'enveloppe
  console.log("\nSuggestion d'enveloppe");
  await boot(page, `baseData({ expenses: [
      { id: "s1", montant: 1200, libelle: "Monoprix", date: mkey(0) + "-02", envelopeId: "e2", createdAt: 1 },
      { id: "s2", montant: 800, libelle: "Monoprix", date: mkey(0) + "-03", envelopeId: "e2", createdAt: 2 },
      { id: "s3", montant: 3000, libelle: "Monoprix", date: mkey(0) + "-04", envelopeId: "e1", createdAt: 3 },
      { id: "s4", montant: 900, libelle: "Sushi", date: mkey(0) + "-05", envelopeId: "e1", createdAt: 4, evitable: true } ] })`);
  const suggest = await evalOn(page, `q("#fab").click(); await wait(400);
    const label = q("#tx-label");
    label.value = "Mono"; label.dispatchEvent(new Event("input", { bubbles: true })); await wait(80);
    const choisie = q("#tx-env-picker button.on").textContent;
    const hint = q("#env-suggest-hint").hidden ? null : q("#env-suggest-hint").textContent;
    const puces = qa("#label-suggest button").map((b) => b.textContent);
    // un choix manuel stoppe la suggestion
    q('#tx-env-picker [data-pick="e3"]').click(); await wait(40);
    label.value = "Monoprix"; label.dispatchEvent(new Event("input", { bubbles: true })); await wait(80);
    const apresManuel = q("#tx-env-picker button.on").textContent;
    // une étiquette « évitable » majoritaire se coche
    q("#sheet-tx .sheet-close").click(); await wait(400);
    q("#fab").click(); await wait(400);
    q("#tx-label").value = "Sushi"; q("#tx-label").dispatchEvent(new Event("input", { bubbles: true })); await wait(80);
    return { choisie, hint, puces, apresManuel, evitable: q("#tx-evitable").checked, envSushi: q("#tx-env-picker button.on").textContent };`);
  check("le libellé connu présélectionne son enveloppe usuelle", suggest.choisie === "Courses", suggest);
  check("la suggestion est expliquée", /Courses/.test(suggest.hint || "") && /3 fois/.test(suggest.hint || ""), suggest);
  check("le libellé complet est proposé en un geste", suggest.puces.includes("Monoprix"), suggest);
  check("un choix manuel n'est plus écrasé", suggest.apresManuel === "Transports", suggest);
  check("l'étiquette évitable suit l'habitude", suggest.evitable === true && suggest.envSushi === "Logement", suggest);

  // ------------------------------------------------ v2 : premier lancement
  console.log("\nPremier lancement");
  await evalOn(page, `localStorage.clear(); return 1;`);
  await navigateAndWait(page, URL_APP, READY);
  const accueilGuide = await evalOn(page, `await wait(300);
    const visible = vis(q("#onboard"));
    const lignes = qa("#ob-envs .ob-row").length;
    const inert = q(".app").inert;
    q("#ob-income").value = "2000"; q("#ob-income").dispatchEvent(new Event("input", { bubbles: true }));
    const rows = qa("#ob-envs .ob-row");
    rows[0].querySelector("input[type=text]").value = "800"; rows[0].querySelector("input[type=text]").dispatchEvent(new Event("input", { bubbles: true }));
    rows[1].querySelector("input[type=text]").value = "300"; rows[1].querySelector("input[type=text]").dispatchEvent(new Event("input", { bubbles: true }));
    const reste = q("#ob-left").textContent;
    rows[4].querySelector("input[type=checkbox]").click();
    q("#ob-go").click(); await wait(400);
    const d = stored();
    return { visible, lignes, inert, reste, ferme: q("#onboard").hidden, inertApres: q(".app").inert, noms: d.envelopes.map((e) => e.nom),
             budgets: d.envelopes.map((e) => e.budget), regle: d.recurring.map((r) => [r.type, r.montant, r.jour]), onboarded: d.settings.onboarded };`);
  check("un premier lancement montre l'accueil guidé", accueilGuide.visible && accueilGuide.lignes === 7 && accueilGuide.inert, accueilGuide);
  check("il dit ce qui reste à répartir", /900/.test(accueilGuide.reste), accueilGuide);
  check("il crée les enveloppes cochées avec leurs budgets", accueilGuide.noms.length === 4 && accueilGuide.budgets[0] === 80000 && accueilGuide.budgets[1] === 30000, accueilGuide);
  check("et le revenu récurrent", accueilGuide.regle.length === 1 && accueilGuide.regle[0][0] === "revenu" && accueilGuide.regle[0][1] === 200000, accueilGuide);
  check("puis se referme pour de bon", accueilGuide.ferme && !accueilGuide.inertApres && accueilGuide.onboarded === true, accueilGuide);
  await navigateAndWait(page, URL_APP, READY);
  const pasDeuxFois = await evalOn(page, `await wait(200); return q("#onboard").hidden;`);
  check("il ne revient pas à la réouverture", pasDeuxFois === true, pasDeuxFois);

  // ------------------------------------------------ v2 : reste / solde, modification annulable, mois en cours
  console.log("\nReste, solde, modifications");
  await boot(page, `baseData({ envelopes: [
      { id: "e1", ordre: 0, nom: "Logement", couleur: "#3f6de0", budget: 150000 },
      { id: "e2", ordre: 1, nom: "Courses", couleur: "#e4634a", budget: 100000 } ],
    incomes: [{ id: "i1", montant: 200000, libelle: "Salaire", date: mkey(0) + "-01", createdAt: 1 }],
    expenses: [{ id: "x1", montant: 5000, libelle: "Pain", date: mkey(0) + "-02", envelopeId: "e2", createdAt: 1 }] })`);
  const resteSolde = await evalOn(page, `go("accueil"); await wait(240);
    return { alerte: q("#total-warn").hidden ? null : q("#total-warn").textContent, solde: q("#flow-net-k").textContent };`);
  check("des budgets supérieurs aux revenus sont signalés", /dépassent tes revenus/.test(resteSolde.alerte || "") && /500,00/.test(resteSolde.alerte || ""), resteSolde);
  check("le solde positif s'appelle « Épargné »", resteSolde.solde === "Épargné", resteSolde);

  const modif = await evalOn(page, `go("depenses"); await wait(220);
    qa("#tx-list .tx")[0].click(); await wait(340);
    q("#tx-amount").value = "99"; q("#tx-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    const apres = stored().expenses[0].montant;
    const offre = q(".toast-action") ? q(".toast-action").textContent : null;
    q(".toast-action").click(); await wait(250);
    return { apres, offre, retour: stored().expenses[0].montant };`);
  check("une modification propose Annuler", modif.apres === 9900 && modif.offre === "Annuler", modif);
  check("Annuler remet l'ancien montant", modif.retour === 5000, modif);

  await boot(page, `baseData({ recurring: [{ id: "rl", type: "depense", montant: 50000, libelle: "Loyer", jour: 1, actif: true, icone: null, envelopeId: "e1", debut: mkey(0), createdAt: 1 }] })`);
  const regleMaj = await evalOn(page, `await wait(300);
    const avant = stored().expenses.filter((t) => t.recurringId === "rl").map((t) => t.montant);
    go("recurrent"); await wait(220);
    q('#recurring-list [data-recurring="rl"]').click(); await wait(340);
    q("#recurring-amount").value = "520"; q("#recurring-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    return { avant, apres: stored().expenses.filter((t) => t.recurringId === "rl").map((t) => t.montant), total: stored().expenses.length };`);
  check("corriger une règle met à jour le mois en cours", regleMaj.avant.join() === "50000" && regleMaj.apres.join() === "52000" && regleMaj.total === 1, regleMaj);

  // ------------------------------------------------ v2 : à venir, objectifs
  console.log("\nÀ venir et objectifs d'épargne");
  await boot(page, `baseData({ recurring: [
      { id: "u1", type: "depense", montant: 1500, libelle: "Salle", jour: 1, actif: true, icone: null, envelopeId: "e1", debut: mkey(0), createdAt: 1 },
      { id: "u2", type: "revenu", montant: 200000, libelle: "Salaire", jour: 1, actif: true, icone: "salaire", envelopeId: null, debut: mkey(0), createdAt: 2 },
      { id: "u3", type: "depense", montant: 3000, libelle: "Demain", jour: ((new Date().getDate()) % 28) + 1, actif: true, icone: null, envelopeId: "e1", debut: mkey(0), createdAt: 3 } ] })`);
  const avenir = await evalOn(page, `await wait(300); go("recurrent"); await wait(240);
    return { lignes: qa("#upcoming-list .up-row").map((r) => r.textContent), fixe: qa("#fixed-sum .flow-v").map((e) => e.textContent) };`);
  check("« à venir » liste ce qui tombe d'ici 7 jours", avenir.lignes.some((l) => /Demain|Dans|Aujourd/.test(l) && /Demain/.test(l)), avenir);
  check("une échéance déjà tombée n'y figure plus", !avenir.lignes.some((l) => /Salle|Salaire/.test(l)) || new Date().getDate() === 1, avenir);
  check("charges fixes, revenus fixes, reste libre", avenir.fixe.length === 3 && /45,00/.test(avenir.fixe[0]) && /2\s?000,00/.test(avenir.fixe[1]), avenir);

  await boot(page, `baseData()`);
  const objectif = await evalOn(page, `go("accueil"); await wait(220);
    const vide = Boolean(q("#goal-list .empty"));
    q("#goal-add").click(); await wait(360);
    q("#goal-name").value = "Vacances"; q("#goal-target").value = "1000"; q("#goal-saved").value = "250";
    const d = new Date(); d.setMonth(d.getMonth() + 4);
    q("#goal-date").value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    q("#goal-target").dispatchEvent(new Event("input", { bubbles: true }));
    const rythme = q("#goal-pace").hidden ? null : q("#goal-pace").textContent;
    q("#goal-form").dispatchEvent(new Event("submit", { cancelable: true })); await wait(340);
    const g = stored().goals[0];
    q('#goal-list [data-goal]').click(); await wait(360);
    q("#goal-deposit").value = "100"; q("#goal-deposit-btn").click(); await wait(340);
    const apresVersement = stored().goals[0].epargne;
    q(".toast-action").click(); await wait(250);
    const annule = stored().goals[0].epargne;
    return { vide, rythme, nom: g && g.nom, cible: g && g.cible, epargne: g && g.epargne, apresVersement, annule,
             ligne: q("#goal-list .goal").textContent };`);
  check("sans objectif, un écran vide propose d'en créer un", objectif.vide === true, objectif);
  check("un objectif se crée avec montant et avance", objectif.nom === "Vacances" && objectif.cible === 100000 && objectif.epargne === 25000, objectif);
  check("il calcule la somme à mettre de côté par mois", /150,00/.test(objectif.rythme || ""), objectif);
  check("un versement s'ajoute, et s'annule", objectif.apresVersement === 35000 && objectif.annule === 25000, objectif);

  // ------------------------------------------------ v2 : bilan sur 12 mois / année, par enveloppe
  console.log("\nBilan détaillé");
  await boot(page, `baseData({ expenses: [
      { id: "t1", montant: 10000, libelle: "a", date: mkey(0) + "-02", envelopeId: "e2", createdAt: 1 },
      { id: "t2", montant: 20000, libelle: "b", date: mkey(-1) + "-02", envelopeId: "e2", createdAt: 2 },
      { id: "t3", montant: 5000, libelle: "c", date: mkey(-1) + "-03", envelopeId: "e3", createdAt: 3 } ] })`);
  const detail = await evalOn(page, `go("bilan"); await wait(240);
    const six = qa("#hist button").length;
    q('[data-hist="12"]').click(); await wait(200);
    const douze = { barres: qa("#hist button").length, note: q("#hist-note").hidden ? null : q("#hist-note").textContent, titre: q("#hist-title").textContent };
    q('[data-hist="annee"]').click(); await wait(200);
    const annee = { barres: qa("#hist button").length, titre: q("#hist-title").textContent };
    q('[data-hist="6"]').click(); await wait(200);
    const lignes = qa("#env-trend .trend").map((r) => r.querySelector(".trend-t b").textContent + "|" + r.querySelector(".trend-a").textContent);
    qa("#env-trend .trend")[0].click(); await wait(250);
    return { six, douze, annee, lignes, vue: qa(".view:not([hidden])")[0].id, filtre: q("#filter-label").textContent, nb: qa("#tx-list .tx").length, memoire: stored().settings.histMode };`);
  check("12 mois = 12 barres, avec le montant du mois choisi au-dessus", detail.douze.barres === 12 && /€/.test(detail.douze.note || "") && /12 derniers/.test(detail.douze.titre), detail);
  check("« Année » = janvier à décembre", detail.annee.barres === 12 && /Année/.test(detail.annee.titre), detail);
  check("par enveloppe : classées par total", detail.lignes[0].startsWith("Courses") && detail.lignes[1].startsWith("Transports"), detail);
  check("toucher une enveloppe ouvre ses dépenses sur la période", detail.vue === "view-depenses" && /Courses/.test(detail.filtre) && detail.nb === 2, detail);

  // ------------------------------------------------ v2 : listes longues, balayage, mois, tiroirs
  console.log("\nListes longues, gestes, tiroirs");
  await boot(page, `baseData({ expenses: Array.from({ length: 130 }, (_, i) => ({ id: "p" + i, montant: 100 + i, libelle: "L" + i, date: mkey(0) + "-" + String(1 + (i % 27)).padStart(2, "0"), envelopeId: "e2", createdAt: i })) })`);
  const pages = await evalOn(page, `go("depenses"); await wait(260);
    const premiere = qa("#tx-list .tx").length;
    const bouton = q("#tx-more") ? q("#tx-more").textContent : null;
    q("#tx-more").click(); await wait(160);
    const seconde = qa("#tx-list .tx").length;
    q("#select-toggle").click(); await wait(150); q("#bulk-all").click(); await wait(150);
    return { premiere, bouton, seconde, tout: q("#bulk-count").textContent };`);
  check("la liste monte 60 lignes à la fois", pages.premiere === 60 && /70/.test(pages.bouton || ""), pages);
  check("« Afficher plus » en ajoute 60", pages.seconde === 120, pages);
  check("« Tout sélectionner » prend tout, pas seulement l'affiché", /130 sélectionn/.test(pages.tout), pages);

  await boot(page, `baseData({ expenses: [
      { id: "g1", montant: 1000, libelle: "A balayer", date: mkey(0) + "-02", envelopeId: "e2", createdAt: 1 },
      { id: "g2", montant: 2000, libelle: "B reste", date: mkey(0) + "-01", envelopeId: "e2", createdAt: 0 } ] })`);
  const balayage = await evalOn(page, `go("depenses"); await wait(250);
    const ev = (t, x) => new PointerEvent(t, { bubbles: true, clientX: x, clientY: 300, pointerId: 7 });
    const ligne = () => qa("#tx-list .tx")[0];
    // un petit balayage ne supprime rien
    let r = ligne(); r.dispatchEvent(ev("pointerdown", 300)); r.dispatchEvent(ev("pointermove", 270)); r.dispatchEvent(ev("pointermove", 250)); r.dispatchEvent(ev("pointerup", 250)); await wait(500);
    const apresPetit = stored().expenses.length;
    // un grand balayage supprime, et offre Annuler
    r = ligne(); r.dispatchEvent(ev("pointerdown", 300)); r.dispatchEvent(ev("pointermove", 250)); r.dispatchEvent(ev("pointermove", 120)); r.dispatchEvent(ev("pointerup", 120)); await wait(600);
    const apresGrand = stored().expenses.map((t) => t.id);
    const offre = q(".toast-action") ? q(".toast-action").textContent : null;
    const tiroirOuvert = qa(".sheet").some((x) => x.classList.contains("show"));
    q(".toast-action").click(); await wait(250);
    return { apresPetit, apresGrand, offre, tiroirOuvert, rendu: stored().expenses.length };`);
  check("un petit balayage ne supprime rien", balayage.apresPetit === 2, balayage);
  check("un grand balayage supprime la ligne", balayage.apresGrand.length === 1 && balayage.apresGrand[0] === "g2", balayage);
  check("…sans ouvrir de tiroir, avec Annuler", balayage.tiroirOuvert === false && balayage.offre === "Annuler", balayage);
  check("Annuler la rend", balayage.rendu === 2, balayage);

  const selecteur = await evalOn(page, `go("accueil"); await wait(200);
    q("#month-label").click(); await wait(380);
    const ouvert = q("#sheet-month").classList.contains("show");
    const cases = qa("#month-grid button").length;
    const courant = q("#month-grid .on").dataset.pickMonth;
    q("#year-prev").click(); await wait(80);
    const annee = q("#year-label").textContent;
    q("#month-grid button").click(); await wait(420);
    const choisi = q("#month-name").textContent;
    const inert = q(".app").inert;
    return { ouvert, cases, courant: courant === mkey(0), annee, choisi, inert };`);
  check("le titre du mois ouvre un sélecteur de 12 mois", selecteur.ouvert && selecteur.cases === 12 && selecteur.courant, selecteur);
  check("on y change d'année et de mois", Number(selecteur.annee) === new Date().getFullYear() - 1 && selecteur.choisi === "Janvier", selecteur);
  check("fermé, il rend la main à l'appli", selecteur.inert === false, selecteur);

  const tiroirs = await evalOn(page, `go("accueil"); await wait(200);
    q("#fab").focus();
    q("#fab").click(); await wait(420);
    const inertOuvert = q(".app").inert;
    const focusDans = q("#sheet-tx").contains(document.activeElement);
    const sheet = q("#sheet-tx");
    const grip = sheet.querySelector(".sheet-grip");
    const pev = (t, y) => new PointerEvent(t, { bubbles: true, clientX: 100, clientY: y, pointerId: 3 });
    grip.dispatchEvent(pev("pointerdown", 100)); document.dispatchEvent(pev("pointermove", 260)); document.dispatchEvent(pev("pointerup", 260)); await wait(450);
    const ferme = !sheet.classList.contains("show");
    const retour = document.activeElement === q("#fab");
    // un petit glissé revient
    q("#fab").click(); await wait(420);
    grip.dispatchEvent(pev("pointerdown", 100)); document.dispatchEvent(pev("pointermove", 120)); document.dispatchEvent(pev("pointerup", 120)); await wait(450);
    const reste = sheet.classList.contains("show");
    q("#sheet-tx .sheet-close").click(); await wait(420);
    return { inertOuvert, focusDans, ferme, retour, reste, inertFerme: q(".app").inert };`);
  check("tiroir ouvert : le reste de l'appli est inerte, le focus entre dedans", tiroirs.inertOuvert && tiroirs.focusDans, tiroirs);
  check("glisser la poignée vers le bas ferme le tiroir", tiroirs.ferme, tiroirs);
  check("le focus retourne au bouton d'origine", tiroirs.retour, tiroirs);
  check("un petit glissé ne ferme pas", tiroirs.reste, tiroirs);
  check("la fermeture rend l'appli utilisable", tiroirs.inertFerme === false, tiroirs);

  const clavier = await evalOn(page, `q("#fab").click(); await wait(420);
    const bouton = q('#tx-type [data-type="depense"]');
    bouton.focus();
    bouton.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await wait(120);
    const type = q("#tx-type button.on").dataset.type;
    q('#tx-date-quick [data-ago="1"]').click();
    const hier = new Date(); hier.setDate(hier.getDate() - 1);
    const attendu = hier.getFullYear() + "-" + String(hier.getMonth() + 1).padStart(2, "0") + "-" + String(hier.getDate()).padStart(2, "0");
    const date = q("#tx-date").value;
    q("#sheet-tx .sheet-close").click(); await wait(420);
    return { type, date, attendu };`);
  check("les flèches parcourent un groupe radio", clavier.type === "revenu", clavier);
  check("« Hier » règle la date", clavier.date === clavier.attendu, clavier);

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
