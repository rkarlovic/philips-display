// Fails if the hr and en admin translations differ in keys,
// or if the admin source uses a literal t('key') that is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const i18nDir = path.join(root, 'apps', 'admin', 'src', 'i18n');
const srcDir = path.join(root, 'apps', 'admin', 'src');
const locales = ['hr', 'en'];

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const keys = Object.fromEntries(
  locales.map((l) => [
    l,
    new Set(flatten(JSON.parse(fs.readFileSync(path.join(i18nDir, `${l}.json`), 'utf8')))),
  ]),
);

const problems = [];
for (const a of locales) {
  for (const b of locales) {
    if (a === b) continue;
    for (const k of keys[a])
      if (!keys[b].has(k)) problems.push(`"${k}" is in ${a}.json but missing in ${b}.json`);
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(e.name) ? [p] : [];
  });
}
const used = /\bt\(\s*'([^'`$]+)'/g;
for (const file of walk(srcDir)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(used)) {
    if (!keys.hr.has(m[1]))
      problems.push(`"${m[1]}" used in ${path.relative(root, file)} but missing`);
  }
}

if (problems.length) {
  console.error(`i18n check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n OK (${keys.hr.size} keys in ${locales.join(', ')})`);
