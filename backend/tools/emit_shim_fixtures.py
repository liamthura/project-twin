"""Emit the frozen fixture the shim's parity test compares.

The shim (`frontend/src/renderers/v2Node.js`) claims that a v2 node, passed
through `v1Shape`, is indistinguishable from the v1 node the renderers read
today. That claim is only checkable if both shapes are available to the same
test -- and the converter is Python while the shim is JS. So this writes both
sides out once, per pack:

    v1        the `ui.sections` exactly as shipped before conversion
    v2        the same trees through `convert`
    entities  the v1 entity block, because two of v1's node keys were
              overrides of it and the comparison has to resolve them

FROZEN. Regenerating it after Task 6 rewrites the manifests would compare the
shim against itself. Deleted in Task 9 with the shim.

Run from `backend/`:  PYTHONPATH=. python3 tools/emit_shim_fixtures.py
"""
import json
from pathlib import Path

import pack_loader
from tools.manifest_v1_to_v2 import convert

OUT = Path(__file__).resolve().parents[2] / "frontend/src/__fixtures__/shim-parity.json"


def main():
    packs = {}
    for d in sorted(p for p in Path(pack_loader.PACKS_DIR).iterdir() if p.is_dir()):
        manifest = json.loads((d / "manifest.json").read_text())
        packs[manifest["key"]] = {
            "v1": manifest["ui"]["sections"],
            "entities": manifest["entities"],
            "v2": convert(manifest)["sections"],
        }
    OUT.write_text(json.dumps(packs, indent=1) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
