/* ============================================================
   Écrans de lancement iPhone (apple-touch-startup-image).

     node tools/make-splash.mjs

   Sans eux, une appli posée sur l'écran d'accueil s'ouvre sur un écran blanc
   (ou noir) le temps du chargement. Chacun est un aplat de la couleur de fond de
   l'appli, avec la pièce de l'icône au centre — en clair et en sombre.
   Écrit dans web/splash/ et imprime les balises <link> (déjà collées dans index.html).
   ============================================================ */

import { deflateSync, inflateSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// [largeur px, hauteur px, facteur, largeur CSS, hauteur CSS]
const DEVICES = [
  [1320, 2868, 3, 440, 956], // 16 Pro Max
  [1206, 2622, 3, 402, 874], // 16 Pro
  [1290, 2796, 3, 430, 932], // 14/15 Pro Max, 15 Plus
  [1179, 2556, 3, 393, 852], // 14/15/16 Pro, 15, 16
  [1284, 2778, 3, 428, 926], // 12/13 Pro Max, 14 Plus
  [1170, 2532, 3, 390, 844], // 12/13/14
  [1125, 2436, 3, 375, 812], // X, XS, 11 Pro, 12/13 mini
  [1242, 2688, 3, 414, 896], // XS Max, 11 Pro Max
  [828, 1792, 2, 414, 896], //  XR, 11
  [1242, 2208, 3, 414, 736], // 8 Plus
  [750, 1334, 2, 375, 667], //  SE 2/3, 8
  [640, 1136, 2, 320, 568], //  SE 1
];
const THEMES = { light: [0xf4, 0xf5, 0xf7], dark: [0x10, 0x13, 0x18] };

/** Décode un PNG RGBA produit par make-icons (filtre « None » uniquement). */
function decodePng(buf) {
  let pos = 8, width = 0, height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (raw[y * (width * 4 + 1)] !== 0) throw new Error("filtre PNG non géré");
    raw.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  }
  return { width, height, rgba };
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodeRgb(rgb, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const icon = decodePng(await readFile(join(ROOT, "web/icons/icon-512.png")));

function splash(w, h, bg) {
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = bg[0]; rgb[i * 3 + 1] = bg[1]; rgb[i * 3 + 2] = bg[2]; }
  const size = Math.round(Math.min(w, h) * 0.26); // le logo occupe un quart de la largeur
  const x0 = Math.round((w - size) / 2), y0 = Math.round((h - size) / 2 - h * 0.03);
  const k = icon.width / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // échantillonnage par moyenne de la case source (réduction : pas de crénelage)
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const sx0 = Math.floor(x * k), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * k));
      const sy0 = Math.floor(y * k), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * k));
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        const o = (sy * icon.width + sx) * 4;
        r += icon.rgba[o]; g += icon.rgba[o + 1]; b += icon.rgba[o + 2]; a += icon.rgba[o + 3]; n++;
      }
      // angles arrondis comme l'icône de l'appli (rayon 22,5 %), bord adouci sur ~1 px
      const rad = size * 0.225;
      const cx = Math.min(Math.max(x + 0.5, rad), size - rad), cy = Math.min(Math.max(y + 0.5, rad), size - rad);
      const edge = rad - Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const alpha = (a / n / 255) * Math.min(1, Math.max(0, edge + 0.5));
      const o = ((y0 + y) * w + (x0 + x)) * 3;
      rgb[o] = Math.round((r / n) * alpha + rgb[o] * (1 - alpha));
      rgb[o + 1] = Math.round((g / n) * alpha + rgb[o + 1] * (1 - alpha));
      rgb[o + 2] = Math.round((b / n) * alpha + rgb[o + 2] * (1 - alpha));
    }
  }
  return encodeRgb(rgb, w, h);
}

await mkdir(join(ROOT, "web/splash"), { recursive: true });
const links = [];
for (const [w, h, dpr, cw, ch] of DEVICES) {
  for (const [theme, bg] of Object.entries(THEMES)) {
    const name = `splash-${w}x${h}-${theme}.png`;
    await writeFile(join(ROOT, "web/splash", name), splash(w, h, bg));
    links.push(`<link rel="apple-touch-startup-image" href="splash/${name}" media="(device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait) and (prefers-color-scheme: ${theme})">`);
  }
}
await writeFile(join(ROOT, "web/splash/links.html"), links.join("\n") + "\n");
console.log(`${links.length} écrans de lancement écrits dans web/splash/ `);
