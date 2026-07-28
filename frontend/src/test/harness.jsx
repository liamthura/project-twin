import { useState } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SectionRenderer from "@/renderers/SectionRenderer";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/**
 * Renders a section with real state, so typing behaves as it does in the app.
 *
 * SectionRenderer is controlled: it reads values from `data` and reports
 * changes upward. Rendering it with a static prop makes every keystroke appear
 * to do nothing, so tests need a stateful owner exactly as App.jsx provides.
 */
export function renderSection({ pack, initial, onShowConfirmation }) {
  // The component gets its own copy, and the caller gets a pristine one. Sharing
  // a reference here would let a renderer that mutates `data` in place corrupt
  // the very object the assertion compares against -- and pass.
  const start = deepFreeze(structuredClone(initial));
  let seen = start;

  function Harness() {
    const [data, setData] = useState(start);
    return (
      <SectionRenderer
        pack={pack}
        data={data}
        onChange={(next) => {
          seen = next;
          setData(next);
        }}
        onShowConfirmation={onShowConfirmation}
      />
    );
  }

  const result = render(<Harness />);
  return { ...result, user: userEvent.setup(), latest: () => seen, initial: structuredClone(initial) };
}
