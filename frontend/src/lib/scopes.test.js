// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  READ,
  PROPOSE,
  WRITE,
  PERSONA_SCOPES,
  SCOPE_LABELS,
  summariseScopes,
} from "./scopes.js";

describe("the wire values", () => {
  it("are what auth/src/oauth.js stores", () => {
    // These are checked by the auth service, not displayed. A typo here is a
    // grant that silently does nothing.
    expect(READ).toBe("persona:read");
    expect(PROPOSE).toBe("persona:propose");
    expect(WRITE).toBe("persona:write");
    expect(PERSONA_SCOPES).toEqual([
      "persona:read",
      "persona:propose",
      "persona:write",
    ]);
  });
});

describe("SCOPE_LABELS", () => {
  it("has a row for propose and write, and not for read", () => {
    // Read is the floor for every grant, so a caller lists it unconditionally
    // rather than checking for it.
    expect(SCOPE_LABELS).toEqual([
      ["persona:propose", "Suggest changes for your approval"],
      ["persona:write", "Change your persona directly"],
    ]);
  });
});

describe("summariseScopes", () => {
  it.each([
    [["persona:read"], "Read only"],
    [["persona:read", "persona:propose"], "Read and propose"],
    [
      ["persona:read", "persona:propose", "persona:write"],
      "Read, propose and change directly",
    ],
    // Possible through POST /api/auth/tokens directly, which does not enforce
    // the implication the mint form does. Reporting this as the full three
    // would claim a permission the token does not carry.
    [["persona:read", "persona:write"], "Read and change directly"],
  ])("%s -> %s", (scopes, expected) => {
    expect(summariseScopes(scopes)).toBe(expected);
  });

  it("says nothing rather than guessing, for an empty or missing list", () => {
    expect(summariseScopes([])).toBe("No access");
    expect(summariseScopes(undefined)).toBe("No access");
  });

  it("ignores a scope it does not know", () => {
    // offline_access and openid ride along on an OAuth grant. They are the
    // client's business, not something to describe to the reader here.
    expect(summariseScopes(["persona:read", "offline_access"])).toBe("Read only");
  });
});
