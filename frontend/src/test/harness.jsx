import { useState } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GenericSectionEditor from "@/components/GenericSectionEditor";

/**
 * Renders a section with real state, so typing behaves as it does in the app.
 *
 * GenericSectionEditor is controlled: it reads values from `data` and reports
 * changes upward. Rendering it with a static prop makes every keystroke appear
 * to do nothing, so tests need a stateful owner exactly as App.jsx provides.
 */
export function renderSection({ pack, initial }) {
  let seen = initial;

  function Harness() {
    const [data, setData] = useState(initial);
    return (
      <GenericSectionEditor
        pack={pack}
        data={data}
        onChange={(next) => {
          seen = next;
          setData(next);
        }}
      />
    );
  }

  const result = render(<Harness />);
  return { ...result, user: userEvent.setup(), latest: () => seen };
}
