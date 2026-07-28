import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Split from renderNode.test.jsx on purpose: proving renderNode threads
// `entities` and `packKey` down to ListRenderer needs mocking "./ListRenderer"
// itself, and vi.mock is hoisted for the whole module -- doing that in
// renderNode.test.jsx would silently swap the real ListRenderer under every
// other test there too, breaking their assertions against actually-rendered
// rows and fields. Isolating the mock in its own file keeps that suite
// exercising the real component while this one inspects what it was called
// with.
//
// Task 1 (wave 4) only widens ListRenderer's prop list -- nothing inside
// ListRenderer reads `entities` or `packKey` yet (Task 2 is what consumes
// them, to dispatch a child node against a resolved list item). That means
// there is no ListRenderer-internal behaviour -- no rendered control, no log
// line -- that can serve as an observable proxy for "packKey arrived" the way
// the brief's Step 1 hoped for. Asserting the actual props ListRenderer was
// invoked with is the strongest true statement available at this point in
// the wave; the entity-resolves-to-a-segmented-button proxy the brief also
// suggests is already covered by an existing renderNode.test.jsx case and
// does not depend on this task's change (renderNode has always resolved
// `entities?.[node.entity]` itself), so it is not repeated here.
vi.mock("./ListRenderer", () => ({ default: vi.fn(() => null) }));

import ListRenderer from "./ListRenderer";
import { renderNode } from "./renderNode";

describe("renderNode threading entities/packKey into ListRenderer", () => {
  const node = { kind: "list", path: ["items"], title_field: "name", entity: "thing" };

  // No global clearMocks -- clear this suite's own mock explicitly so a
  // second test's toHaveBeenCalledTimes(1) isn't counting the first test's
  // call too.
  beforeEach(() => {
    ListRenderer.mockClear();
  });

  it("passes the entities map and packKey through as their own props, alongside the existing resolved entity prop", () => {
    const entities = { thing: { valid_values: { stance: ["love", "like"] } } };

    render(
      <>
        {renderNode({
          node,
          value: [],
          onValue: vi.fn(),
          entities,
          packKey: "wave4-test-pack",
        })}
      </>
    );

    expect(ListRenderer).toHaveBeenCalledTimes(1);
    const props = ListRenderer.mock.calls[0][0];
    expect(props.entities).toBe(entities);
    expect(props.packKey).toBe("wave4-test-pack");
    // Backwards compatibility: the pre-resolved `entity` object is still
    // derived and passed too, exactly as before this task.
    expect(props.entity).toBe(entities.thing);
  });

  it("passes packKey through even when it is undefined, rather than dropping the prop", () => {
    render(<>{renderNode({ node, value: [], onValue: vi.fn(), entities: undefined })}</>);

    expect(ListRenderer).toHaveBeenCalledTimes(1);
    const props = ListRenderer.mock.calls[0][0];
    expect("packKey" in props).toBe(true);
    expect("entities" in props).toBe(true);
  });
});
