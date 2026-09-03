// Minimal Chrome DevTools Protocol driver + static server, reusable by the smoke tests.
// Node 24 has a global WebSocket, so no dependency is needed.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

// Emplacements habituels de Chrome / Edge ; CHROME_PATH a la priorité si elle est définie.
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((c) => fs.existsSync(c));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json"
};

function serve(rootDir, port) {
  // Normalisé : un chemin donné avec des « / » ne correspondait plus à ce que path.join
  // produit sous Windows (« \ »), et le garde-fou anti-évasion refusait tout en bloc.
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.resolve(root, "." + path.sep + p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

let launchCounter = 0;

// Efface les profils laissés par des campagnes précédentes, sans jamais faire échouer
// le lancement si l'un d'eux est encore verrouillé.
function sweepStaleProfiles(parentDir, prefix) {
  try {
    fs.readdirSync(parentDir)
      .filter((n) => n.indexOf(prefix + "-") === 0)
      .forEach((n) => {
        try {
          fs.rmSync(path.join(parentDir, n), { recursive: true, force: true });
        } catch (e) {
          /* encore utilisé */
        }
      });
  } catch (e) {
    /* le dossier parent n'existe pas encore */
  }
}

async function launchChrome(port, userDataDir) {
  if (!CHROME) {
    throw new Error(
      "Chrome introuvable. Installez Google Chrome, ou indiquez son chemin :\n" +
        "  CHROME_PATH=\"C:/chemin/vers/chrome.exe\" npm test"
    );
  }
  // Un profil par lancement. Réutiliser le même dossier échouait (EPERM sur rm) quand un
  // Chrome de la campagne précédente en tenait encore les fichiers : la suite s'arrêtait sur
  // une erreur qui n'avait rien à voir avec l'application.
  const dir = `${userDataDir}-${process.pid}-${++launchCounter}`;
  sweepStaleProfiles(path.dirname(dir), path.basename(userDataDir));
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    /* un reste verrouillé : le dossier unique ci-dessus évite le conflit */
  }
  fs.mkdirSync(dir, { recursive: true });
  const proc = spawn(
    CHROME,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1600,1000",
      "--user-data-dir=" + dir,
      "--remote-debugging-port=" + port,
      "about:blank"
    ],
    { stdio: "ignore", detached: false }
  );

  // Sous Windows, proc.kill() ne tue que le processus parent : Chrome laisse ses processus
  // enfants vivants, et ceux-ci gardent le dossier de profil verrouillé pour la suite
  // suivante. On tue l'arbre complet, puis on efface le profil au mieux.
  const parentKill = proc.kill.bind(proc);
  proc.kill = function () {
    let killed = false;
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: "ignore" });
        killed = true;
      } catch (e) {
        /* déjà arrêté */
      }
    }
    if (!killed) parentKill();
    setTimeout(() => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        /* sera balayé au prochain lancement */
      }
    }, 300).unref();
    return true;
  };
  // wait for the debugger endpoint
  for (let i = 0; i < 120; i++) {
    try {
      const info = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
      if (info.webSocketDebuggerUrl) return { proc, browserWs: info.webSocketDebuggerUrl };
    } catch (e) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Chrome n'a pas démarré");
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.listeners.forEach((fn) => fn(msg));
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("timeout: " + method));
        }
      }, 60000);
    });
  }
  on(fn) {
    this.listeners.push(fn);
    return fn;
  }
  off(fn) {
    const i = this.listeners.indexOf(fn);
    if (i !== -1) this.listeners.splice(i, 1);
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new Session(ws);
}

// Opens a fresh page and returns a session attached to it.
async function newPage(browserWs, url, initScript) {
  const browser = await connect(browserWs);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const targets = await fetch(browserWs.replace(/^ws:\/\/([^/]+).*$/, "http://$1/json/list")).then((r) => r.json());
  const target = targets.find((t) => t.id === targetId);
  const page = await connect(target.webSocketDebuggerUrl);
  const errors = [];
  page.on((msg) => {
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push(
        (d.exception && (d.exception.description || d.exception.value)) || d.text || "exception inconnue"
      );
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push("console.error: " + msg.params.args.map((a) => a.description || a.value).join(" "));
    }
  });
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Log.enable").catch(() => {});
  if (initScript) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: initScript });
  await page.send("Page.navigate", { url });
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 15000);
    page.on((m) => {
      if (m.method === "Page.loadEventFired") {
        clearTimeout(t);
        resolve();
      }
    });
  });
  await new Promise((r) => setTimeout(r, 400));
  return { page, browser, errors };
}

async function evalOn(page, expression) {
  const res = await page.send("Runtime.evaluate", {
    // async : les scénarios de test attendent parfois un export ou un FileReader
    expression: `(async function(){ ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error(
      "EVAL: " + ((d.exception && (d.exception.description || d.exception.value)) || d.text)
    );
  }
  return res.result.value;
}

// Navigue puis attend que l'application soit initialisée SUR LE NOUVEAU DOCUMENT.
// Sonder juste après Page.navigate interroge encore l'ancien document, toujours vivant
// quelques dizaines de millisecondes : les sondes réussissaient sur la page précédente et
// la préparation du test s'exécutait sur un document sur le point d'être détruit.
// Le marqueur posé avant la navigation ne survit pas au changement de document.
// Marqueur posé par app.js à la fin de init(). Se fier au HTML statique ne dit rien :
// « Zoom 100 % » est déjà écrit dans index.html, même si le script n'a jamais tourné.
const APP_READY = 'document.documentElement.getAttribute("data-app-ready") === "1"';

async function navigateAndWait(page, url, readyExpr) {
  // 1. marquer le document courant : il ne survivra pas à la navigation
  await evalOn(page, "window.__navMark = 1; return 1;").catch(() => {});
  // 2. attendre l'événement de chargement du protocole, qui fait autorité
  let loaded = false;
  const onLoad = page.on((m) => {
    if (m.method === "Page.loadEventFired") loaded = true;
  });
  try {
    await page.send("Page.navigate", { url });
    for (let i = 0; i < 200 && !loaded; i++) await new Promise((r) => setTimeout(r, 50));
    if (!loaded) throw new Error("la page ne s'est pas chargée : " + url);
  } finally {
    page.off(onLoad);
  }
  // 3. puis attendre que l'application elle-même soit initialisée sur ce nouveau document
  for (let i = 0; i < 120; i++) {
    const ok = await evalOn(page, `return !window.__navMark && (${readyExpr || APP_READY});`).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("l'application ne s'est jamais initialisée : " + url);
}

module.exports = { serve, launchChrome, connect, newPage, evalOn, navigateAndWait, APP_READY, CHROME };
