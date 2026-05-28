// Generate PNG icons from the amber design.
//
// Run from inside the project directory:
//   node generate-icons.mjs
// Requires the `canvas` npm module to be installed in a reachable node_modules.

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, 'icons');

// Ensure target directory exists before writing (first-run safety).
fs.mkdirSync(iconsDir, { recursive: true });

const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Amber circle
  ctx.clearRect(0, 0, size, size);
  const r = size * 0.42;
  const cx = size / 2, cy = size / 2;

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#d4a017';
  ctx.fill();

  // Inner glow
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = '#f0c040';
  ctx.fill();

  // Core
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#b8920f';
  ctx.fill();

  const buf = canvas.toBuffer('image/png');
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath} (${buf.length} bytes)`);
}

console.log('Done.');
