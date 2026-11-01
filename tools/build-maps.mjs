// Builds the bundled sample maps from tools/maps/*.mjs into www/maps/*.json
// and validates each with the same validator the game and server use.
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateMap, mapSummary } from '../www/js/engine/mapformat.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, 'maps');
const outDir = join(here, '..', 'www', 'maps');
mkdirSync(outDir, { recursive: true });

const order = ['glacier-gate', 'rimecrest-run', 'ember-rift', 'last-light'];
const index = [];
let failed = false;
const files = readdirSync(srcDir).filter((f) => f.endsWith('.mjs'));
files.sort((a, b) => order.indexOf(a.replace('.mjs', '')) - order.indexOf(b.replace('.mjs', '')));
for (const f of files) {
  const map = (await import(pathToFileURL(join(srcDir, f)).href)).default;
  const res = validateMap(map);
  if (!res.ok) {
    failed = true;
    console.error(`✗ ${f}:\n  ${res.errors.join('\n  ')}`);
    continue;
  }
  const file = `${map.id}.json`;
  writeFileSync(join(outDir, file), JSON.stringify(map));
  index.push({ file, ...mapSummary(map) });
  console.log(`✓ ${f} -> www/maps/${file}`);
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));
if (failed) process.exit(1);
