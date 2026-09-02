/* Petit serveur statique pour tester web/ dans un navigateur — et depuis
   l'iPhone, en tapant l'adresse réseau affichée au démarrage.

     node tools/serve.mjs [port]
*/

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const PORT = Number(process.argv[2]) || 5173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""));

  try {
    const info = await stat(path);
    if (info.isDirectory()) path = join(path, "index.html");
    await stat(path);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Introuvable");
  }

  res.writeHead(200, {
    "Content-Type": TYPES[extname(path)] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(path).pipe(res);
}).listen(PORT, "0.0.0.0", () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);

  console.log(`\n  Mon Budget\n`);
  console.log(`  Ordinateur   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  iPhone       http://${ip}:${PORT}`);
  console.log(`\n  (même réseau Wi-Fi ; Ctrl+C pour arrêter)\n`);
});
