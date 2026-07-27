// Regenerates the pack fixtures from the backend manifests, so tests and
// stories stay bound to the real manifests rather than a hand-copied snapshot.
// Mirrors the shape backend/main.py serves at /api/settings.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packsDir = join(here, "..", "..", "backend", "section_packs");
const outFile = join(here, "..", "src", "__fixtures__", "packs.json");

const packs = readdirSync(packsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
  .map((e) => JSON.parse(readFileSync(join(packsDir, e.name, "manifest.json"), "utf8")))
  .map((m) => ({
    key: m.key,
    title: m.title,
    description: m.description,
    core: m.core ?? false,
    position: m.position ?? 999,
    enabled: true,
    entities: m.entities ?? {},
    ui: m.ui ?? {},
  }))
  .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(packs, null, 2) + "\n");
console.log(`wrote ${outFile}: ${packs.length} packs`);
