import { describe, it, expect } from "vitest";
import { connectionStatus } from "./connectionStatus";

const token = (over = {}) => ({
  id: "t1",
  label: "Claude Desktop",
  created_at: "2026-08-01T00:00:00Z",
  last_used_at: null,
  scopes: ["persona:read", "persona:propose"],
  ...over,
});

const grant = (over = {}) => ({
  id: "g1",
  clientId: "c1",
  clientName: "Claude",
  scopes: ["persona:read"],
  createdAt: "2026-08-01T00:00:00Z",
  ...over,
});

describe("connectionStatus", () => {
  it("reports nothing connected when there is nothing", () => {
    expect(connectionStatus([], [])).toEqual({
      state: "none",
      name: null,
      canPropose: false,
    });
  });

  it("waits on a token that has never been used", () => {
    expect(connectionStatus([token()], [])).toEqual({
      state: "waiting",
      name: "Claude Desktop",
      canPropose: true,
    });
  });

  it("confirms a token once it has actually been used", () => {
    // last_used_at is touched only by db.resolve_token, so a non-null value is
    // genuine evidence a client called.
    const used = token({ last_used_at: "2026-08-12T09:00:00Z" });
    expect(connectionStatus([used], [])).toEqual({
      state: "connected",
      name: "Claude Desktop",
      canPropose: true,
    });
  });

  it("never says a grant is waiting, because it cannot know", () => {
    // OAuth clients authenticate as JWTs through db.resolve_user_by_id, which
    // the web app itself uses. Nothing distinguishes a client call from the
    // reader browsing their own persona.
    expect(connectionStatus([], [grant()])).toEqual({
      state: "connected",
      name: "Claude",
      canPropose: false,
    });
  });

  it("reports propose when any one connection has it", () => {
    const readOnly = token({ scopes: ["persona:read"] });
    const proposer = grant({ id: "g2", scopes: ["persona:write"] });
    expect(connectionStatus([readOnly], [proposer]).canPropose).toBe(true);
  });

  it("counts write as carrying propose, matching the scope hierarchy", () => {
    const writer = token({ scopes: ["persona:write"] });
    expect(connectionStatus([writer], []).canPropose).toBe(true);
  });

  it("prefers a used token's name over an unused one", () => {
    const unused = token({ id: "t1", label: "Old" });
    const used = token({ id: "t2", label: "New", last_used_at: "2026-08-12T09:00:00Z" });
    expect(connectionStatus([unused, used], [])).toEqual({
      state: "connected",
      name: "New",
      canPropose: true,
    });
  });

  it("survives nulls, which is what a failed fetch leaves behind", () => {
    expect(connectionStatus(null, null)).toEqual({
      state: "none",
      name: null,
      canPropose: false,
    });
  });
});
