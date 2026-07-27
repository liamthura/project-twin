// Regenerates the pack fixtures from the backend manifests, so tests and
// stories stay bound to the real manifests rather than a hand-copied snapshot.
// Mirrors the shape backend/main.py serves at /api/settings.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packsDir = join(here, "..", "..", "backend", "section_packs");
const outFile = join(here, "..", "src", "__fixtures__", "packs.json");

// This fixture represents the all-enabled state: `enabled` is hardcoded to
// true for every pack. A later task that needs a disabled-pack case must
// construct it by hand rather than assuming this fixture covers it.
const packs = readdirSync(packsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
  // Mirrors backend/pack_loader.py's load_packs: a directory with no
  // manifest.json is skipped with a warning, not a hard failure -- it is not
  // a pack the backend would ever serve at /api/settings.
  .filter((e) => {
    if (existsSync(join(packsDir, e.name, "manifest.json"))) return true;
    console.warn(`section pack ${e.name}: no manifest.json -- skipped`);
    return false;
  })
  .map((e) => {
    const manifest = JSON.parse(readFileSync(join(packsDir, e.name, "manifest.json"), "utf8"));
    // pack_loader.load_packs raises PackError on this mismatch (a packaging
    // bug, not user data) -- fail loudly here too rather than silently
    // emitting a fixture keyed differently from the directory it came from.
    if (manifest.key !== e.name) {
      throw new Error(
        `section pack ${e.name}: manifest key "${manifest.key}" does not match directory name`
      );
    }
    return manifest;
  })
  .map((m) => ({
    key: m.key,
    title: m.title,
    description: m.description,
    core: m.core ?? false,
    default_enabled: m.default_enabled ?? true,
    enabled: true,
    entities: m.entities ?? {},
    ui: m.ui ?? {},
    __position: m.position ?? 999,
  }))
  .sort((a, b) => a.__position - b.__position || a.key.localeCompare(b.key))
  .map(({ __position, ...pack }) => pack);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(packs, null, 2) + "\n");
console.log(`wrote ${outFile}: ${packs.length} packs`);
