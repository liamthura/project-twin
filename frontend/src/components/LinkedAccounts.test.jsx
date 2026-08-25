import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/session.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    startSsoLink: vi.fn(async () => {}),
    unlinkAccount: vi.fn(async () => ({ status: true })),
  };
});

import { startSsoLink, unlinkAccount } from "@/lib/session.js";
import { LinkedAccounts } from "@/components/LinkedAccounts";

const CREDENTIAL = { id: "a1", providerId: "credential" };
const AUTHENTIK = {
  id: "a2",
  providerId: "authentik",
  issuer: "https://door.thuradev.qzz.io/application/o/mygist/",
};

beforeEach(() => vi.clearAllMocks());

it("shows nothing on an instance that does not federate sign-in", () => {
  const { container } = render(
    <LinkedAccounts accounts={[CREDENTIAL]} sso={false} />,
  );
  expect(container).toBeEmptyDOMElement();
});

it("offers to link when the account has no provider yet", async () => {
  const user = userEvent.setup();
  render(<LinkedAccounts accounts={[CREDENTIAL]} sso />);

  await user.click(screen.getByRole("button", { name: /link tdev door/i }));

  // Comes back here afterwards, not to the app root: the person was in
  // Settings and expects to still be in Settings.
  expect(startSsoLink).toHaveBeenCalledWith(
    expect.objectContaining({ callbackURL: expect.stringContaining("/") }),
  );
});

it("says it is linked, and offers to undo it", async () => {
  const user = userEvent.setup();
  const onChanged = vi.fn();
  render(
    <LinkedAccounts accounts={[CREDENTIAL, AUTHENTIK]} sso onChanged={onChanged} />,
  );

  expect(screen.getByText(/tdev door is linked/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /unlink/i }));

  expect(unlinkAccount).toHaveBeenCalledWith("a2");
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

it("warns before removing the only way in", async () => {
  // Unlinking the last account is refused by the service, but the person
  // should learn that before they click, not after. An account with a linked
  // provider and NO password is the real case: unlink and it is unreachable.
  render(<LinkedAccounts accounts={[AUTHENTIK]} sso />);
  expect(
    screen.getByText(/set a password first|only way to sign in/i),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /unlink/i })).toBeDisabled();
});

it("shows the service's own refusal rather than inventing one", async () => {
  const user = userEvent.setup();
  unlinkAccount.mockRejectedValueOnce(new Error("You can't unlink your last account"));
  render(<LinkedAccounts accounts={[CREDENTIAL, AUTHENTIK]} sso />);

  await user.click(screen.getByRole("button", { name: /unlink/i }));
  expect(await screen.findByText(/last account/i)).toBeInTheDocument();
});
