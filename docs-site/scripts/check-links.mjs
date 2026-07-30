#!/usr/bin/env node
/**
 * Verify every internal link and anchor in the exported docs resolves.
 *
 * Run after `next build`, against `out/`. Two classes of breakage this exists
 * to catch, both of which have already happened once:
 *
 *  - `basePath` auto-prefixes `/docs`, so an author writing `/docs/use/...` by
 *    hand produces `/docs/docs/use/...`. Every internal link in the site was
 *    wrong this way at one point, and nothing failed -- the pages built fine
 *    and the links simply 404'd.
 *  - A page renamed or removed without its inbound links being updated, and
 *    heading anchors that drift when a heading is reworded.
 *
 * The export has no `/docs` prefix on disk (basePath affects emitted URLs, not
 * the output tree), so hrefs are compared with the prefix stripped.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import config from '../next.config.mjs';

const OUT = resolve(import.meta.dirname, '..', 'out');
const BASE = config.basePath ?? '';

/** Assets and generated endpoints are not pages; they have no index.html. */
const SKIP = [/\/api\/search/, /\/llms/, /\/og\//];
const HAS_EXTENSION = /\.[a-z0-9]{2,5}$/i;

function walk(dir, onFile) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

/** "out/use/writing/index.html" -> "/use/writing/" */
function routeOf(file) {
  const rel = relative(OUT, file).replace(/\\/g, '/').replace(/index\.html$/, '');
  return '/' + rel;
}

const pages = new Map(); // route -> Set of element ids on that page

walk(OUT, (file) => {
  if (!file.endsWith('index.html')) return;
  const html = readFileSync(file, 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  pages.set(routeOf(file), ids);
});

if (pages.size === 0) {
  console.error(`No pages found in ${OUT}. Run \`npm run build\` first.`);
  process.exit(1);
}

const failures = [];
let links = 0;
let anchors = 0;

walk(OUT, (file) => {
  if (!file.endsWith('.html')) return;
  const html = readFileSync(file, 'utf8');
  const from = relative(OUT, file);

  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];

    // Same-page fragment.
    if (href.startsWith('#')) {
      anchors++;
      const ids = pages.get(routeOf(file));
      if (ids && !ids.has(href.slice(1))) {
        failures.push(`${from}: anchor ${href} has no matching id on this page`);
      }
      continue;
    }

    if (!href.startsWith(BASE + '/') && href !== BASE) continue;
    if (SKIP.some((re) => re.test(href))) continue;

    const [path, fragment] = href.split('#');
    if (HAS_EXTENSION.test(path)) continue;

    let route = path.slice(BASE.length) || '/';
    if (!route.endsWith('/')) route += '/';

    if (fragment === undefined) {
      links++;
      if (!pages.has(route)) failures.push(`${from}: ${href} -> no such page`);
    } else {
      anchors++;
      const ids = pages.get(route);
      if (!ids) failures.push(`${from}: ${href} -> no such page`);
      else if (!ids.has(fragment)) failures.push(`${from}: ${href} -> no such anchor`);
    }
  }
});

// Same link is usually repeated across every page by the sidebar; report each
// distinct problem once rather than once per page that happens to render it.
const distinct = [...new Set(failures)];

console.log(
  `${pages.size} pages, ${links} internal links, ${anchors} anchors checked.`,
);

if (distinct.length > 0) {
  console.error(`\n${distinct.length} broken:`);
  for (const f of distinct) console.error(`  ${f}`);
  process.exit(1);
}

console.log('All internal links and anchors resolve.');
