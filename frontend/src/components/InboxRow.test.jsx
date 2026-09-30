// Tidying a suggested entry whose name is a sentence: offered, never done
// for the reader, and only where an assistant put a note in the name field.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api", () => ({ fillFields: vi.fn() }));

import { fillFields } from "@/lib/api";
import InboxRow, { fromDraft, tidyChanges } from "./InboxRow";

const HOBBY = {
  entity: "hobby", title: "Hobbies & activities", fields: [
    { key: "name", label: "Name", type: "text", required: true, identifier: true, values: null },
    { key: "notes", label: "Notes", type: "longtext", required: false, identifier: false, values: null },
    { key: "skill_level", label: "Skill level", type: "enum", required: false, identifier: false, values: ["beginner", "expert"] },
    { key: "status", label: "Status", type: "enum", required: false, identifier: false, values: ["active", "paused"] },
  ],
};
const PACKS = [{
  key: "lifestyle", title: "Lifestyle", promotable: [HOBBY],
  entities: { hobby: { identifier: "name", actions: ["add"] } }, sections: [],
}];
const SENTENCE = "Picked up bouldering again after a year off, still a beginner";
const ROW = {
  id: "p7", kind: "entity", action: "add", entity: "hobby",
  data: { name: SENTENCE, status: "paused" }, rationale: "r", evidence: "e", proposed_by: "Claude",
};

describe("tidyChanges", () => {
  const fill = { values: { name: "bouldering", notes: SENTENCE, skill_level: "beginner", status: "active" } };

  it("offers the shorter name, the sentence as notes, and what the assistant left empty", () => {
    // Status came from the assistant, so it is kept rather than replaced.
    expect(tidyChanges(ROW.data, HOBBY, fill)).toEqual({ name: "bouldering", notes: SENTENCE, skill_level: "beginner" });
  });

  it("offers nothing when filling found no shorter name", () => {
    expect(tidyChanges(ROW.data, HOBBY, { values: { skill_level: "beginner" } })).toBeNull();
    expect(tidyChanges({ name: "Bouldering" }, HOBBY, { values: { name: "Bouldering" } })).toBeNull();
  });
});

describe("fromDraft", () => {
  it("sends a field a tidy added, and not one left blank", () => {
    expect(fromDraft({ name: "x" }, { name: "bouldering", notes: "Picked up again", skill_level: " " }))
      .toEqual({ name: "bouldering", notes: "Picked up again" });
  });
});

describe("Edit before approving", () => {
  it("offers to tidy a sentence-long name, and approves what it was tidied to", async () => {
    fillFields.mockResolvedValueOnce({
      enabled: true, values: { name: "bouldering", notes: SENTENCE, skill_level: "beginner" }, confidence: {},
    });
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<InboxRow row={ROW} packs={PACKS} onApprove={onApprove} onReject={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^details for /i }));
    await user.click(screen.getByRole("button", { name: "Edit before approving" }));

    const offer = await screen.findByRole("status");
    expect(fillFields).toHaveBeenCalledWith("p7", "lifestyle", "hobby");
    expect(offer).toHaveTextContent("Name “bouldering”, the sentence in Notes and Skill level “beginner”");
    await user.click(screen.getByRole("button", { name: "Tidy" }));

    expect(screen.getByLabelText("Name")).toHaveValue("bouldering");
    expect(screen.getByLabelText("Notes")).toHaveValue(SENTENCE);
    await user.click(screen.getByRole("button", { name: "Approve with changes" }));
    expect(onApprove).toHaveBeenCalledWith({ name: "bouldering", status: "paused", notes: SENTENCE, skill_level: "beginner" });
  });

  it("does not ask about an update, or a name that is already short", async () => {
    fillFields.mockClear();
    const user = userEvent.setup();
    const { unmount } = render(
      <InboxRow row={{ ...ROW, action: "update" }} packs={PACKS} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /^details for /i }));
    await user.click(screen.getByRole("button", { name: "Edit before approving" }));
    unmount();
    render(<InboxRow row={{ ...ROW, data: { name: "Bouldering" } }} packs={PACKS} onApprove={vi.fn()} onReject={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^details for /i }));
    await user.click(screen.getByRole("button", { name: "Edit before approving" }));
    await waitFor(() => expect(fillFields).not.toHaveBeenCalled());
  });
});
