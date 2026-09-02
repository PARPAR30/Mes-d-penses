/* ============================================================
   Génère toutes les icônes de Mon Budget à partir d'une seule
   définition vectorielle : une enveloppe blanche sur fond bleu.

     node tools/make-icons.mjs

   Sorties :
     web/icons/        icônes PWA + apple-touch-icon (carrées, pleine page)
     src-tauri/icons/  PNG, icon.ico (Windows) et icon.icns (macOS)
   ============================================================ */

import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const BG = [0x3f, 0x6d, 0xe0]; // bleu « Logement » de la charte
const PAPER = [0xff, 0xff, 0xff];

/* ---------------------------------------------------------- géométrie */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Couleur du point normalisé (x, y) dans [0,1]². */
function sample(x, y, rounded) {
  if (rounded && !insideRoundRect(x, y, 0, 0, 1, 1, 0.225)) return null;

  // corps de l'enveloppe
  if (insideRoundRect(x, y, 0.155, 0.285, 0.845, 0.715, 0.055)) {
    // rabat : un « V » creusé dans le papier
    const half = 0.028;
    const left = distToSegment(x, y, 0.185, 0.315, 0.5, 0.55);
    const right = distToSegment(x, y, 0.5, 0.55, 0.815, 0.315);
    if (Math.min(left, right) < half) return BG;
    return PAPER;
  }
  return BG;
}

/** Rend une icône RGBA de `size` px, anticrénelée par suréchantillonnage. */
function render(size, rounded) {
  const ss = size >= 512 ? 2 : 4; // sous-échantillons par axe
  const px = Buffer.alloc(size * size * 4);
  const step = 1 / (size * ss);

  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (pxi * ss + sx + 0.5) * step;
          const y = (py * ss + sy + 0.5) * step;
          const c = sample(x, y, rounded);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      }
      const n = ss * ss;
      const o = (py * size + pxi) * 4;
      const alpha = a / n;
      // pré-multiplication inverse : on garde la couleur moyenne des échantillons opaques
      const opaque = a / 255 || 1;
      px[o] = Math.round(r / opaque);
      px[o + 1] = Math.round(g / opaque);
      px[o + 2] = Math.round(b / opaque);
      px[o + 3] = Math.round(alpha);
    }
  }
  return px;
}

/* ---------------------------------------------------------- encodage PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtre « None »
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------- .ico Windows */

function bmpEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + masque AND
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = ((size - 1 - y) * size + x) * 4; // bas vers haut
      xor[dst] = rgba[src + 2];
      xor[dst + 1] = rgba[src + 1];
      xor[dst + 2] = rgba[src];
      xor[dst + 3] = rgba[src + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, xor, Buffer.alloc(maskRow * size)]);
}

function toIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  const blobs = [];
  let offset = 6 + images.length * 16;

  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

/* ---------------------------------------------------------- .icns macOS */

function toIcns(parts) {
  const chunks = parts.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, 4, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/* ---------------------------------------------------------- exécution */

const png = (size, rounded) => toPng(render(size, rounded), size);

const webDir = join(ROOT, "web", "icons");
const tauriDir = join(ROOT, "src-tauri", "icons");
await mkdir(webDir, { recursive: true });
await mkdir(tauriDir, { recursive: true });

const written = [];
const put = async (dir, name, buf) => {
  await writeFile(join(dir, name), buf);
  written.push(`${dir.slice(ROOT.length + 1).replace(/\\/g, "/")}/${name}  ${(buf.length / 1024).toFixed(1)} Ko`);
};

// PWA : carrées pleine page (iOS et Android appliquent leur propre masque)
for (const size of [192, 512]) await put(webDir, `icon-${size}.png`, png(size, false));
await put(webDir, "apple-touch-icon.png", png(180, false));

// Desktop : coins arrondis
for (const size of [32, 64, 128, 256, 512]) await put(tauriDir, `${size}x${size}.png`, png(size, true));
await put(tauriDir, "128x128@2x.png", png(256, true));
await put(tauriDir, "icon.png", png(512, true));

const icoSizes = [16, 24, 32, 48, 64, 128];
await put(
  tauriDir,
  "icon.ico",
  toIco([
    ...icoSizes.map((size) => ({ size, data: bmpEntry(render(size, true), size) })),
    { size: 256, data: png(256, true) },
  ])
);

await put(
  tauriDir,
  "icon.icns",
  toIcns([
    { type: "ic11", data: png(32, true) },
    { type: "ic12", data: png(64, true) },
    { type: "ic07", data: png(128, true) },
    { type: "ic13", data: png(256, true) },
    { type: "ic09", data: png(512, true) },
    { type: "ic10", data: png(1024, true) },
  ])
);

console.log(written.join("\n"));
console.log(`\n${written.length} fichiers générés.`);
