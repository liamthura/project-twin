import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api.js", () => ({
  deleteAccount: vi.fn(async () => ({ status: "deleted" })),
  exportData: vi.fn(async () => ({ filename: "mygist_backup.zip" })),
  clearConfig: vi.fn(),
}));
vi.mock("@/lib/session.js", () => ({ signOut: vi.fn(async () => {}) }));

import { deleteAccount, exportData } from "@/lib/api.js";
import { signOut } from "@/lib/session.js";
import { DeleteAccount } from "./DeleteAccount";

const assign = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign } });
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

async function open(user) {
  render(<DeleteAccount username="maya" />);
  await user.click(screen.getByRole("button", { name: "Delete account" }));
  return screen.findByRole("dialog", { name: "Delete your account?" });
}

describe("DeleteAccount", () => {
  it("stays locked until the username is typed exactly", async () => {
    const user = userEvent.setup();
    const dialog = await open(user);
    const confirm = () => within(dialog).getByRole("button", { name: "Delete account" });
    const field = screen.getByLabelText(/type maya to confirm/i);

    expect(confirm()).toBeDisabled();
    await user.type(field, "Maya");
    expect(confirm()).toBeDisabled();
    await user.clear(field);
    await user.type(field, "maya");
    expect(confirm()).toBeEnabled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes, signs out, and lands where it says so", async () => {
    const user = userEvent.setup();
    const dialog = await open(user);
    await user.type(screen.getByLabelText(/type maya to confirm/i), "maya");
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/app/?deleted=1"));
    expect(deleteAccount).toHaveBeenCalledWith("maya");
    expect(signOut).toHaveBeenCalled();
  });

  it("says why when the server refuses, and signs nobody out", async () => {
    const refused = Object.assign(new Error("sign in to MyGist in a browser to delete your account"), { status: 403 });
    deleteAccount.mockRejectedValueOnce(refused);
    const user = userEvent.setup();
    const dialog = await open(user);
    await user.type(screen.getByLabelText(/type maya to confirm/i), "maya");
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sign in to MyGist in a browser to delete your account.",
    );
    expect(signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("offers a copy first, from the same dialog", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole("button", { name: "Download a copy" }));
    expect(exportData).toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
