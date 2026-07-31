/**
 * API Client for MyGist Server
 * Handles authentication and server connection
 */
import { getJwt, forgetJwt, authFetch } from "./session.js";

// Default hosted API base (full URL including the /api prefix). The hosted
// instance serves the UI and the API from one origin, but this stays absolute:
// it is the "cloud" preset offered to self-hosters running the UI elsewhere,
// where a relative path would resolve against their own origin.
const CLOUD_API_URL = "https://mygist.thuradev.qzz.io/api";

// Get config from localStorage or use defaults
function getConfig() {
  const stored = localStorage.getItem("mygist_config");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}

function saveConfig(config) {
  localStorage.setItem("mygist_config", JSON.stringify(config));
}

function clearConfig() {
  localStorage.removeItem("mygist_config");
}

// Determine the API base URL
function getApiBase() {
  const config = getConfig();

  // If user configured a remote server, use it
  if (config?.serverUrl) {
    return config.serverUrl;
  }

  // In development, use proxy (relative URL)
  if (import.meta.env.DEV) {
    return "/api";
  }

  // In production, use environment variable or same-origin API
  return import.meta.env.VITE_API_URL || "/api";
}

// Get auth token
function getAuthToken() {
  const config = getConfig();
  return config?.token || import.meta.env.VITE_API_TOKEN || null;
}

/** The credential for an API call, and whether it came from the session.
 *
 * An explicitly configured token wins. That covers two cases that both have to
 * keep working: an account signed in before Better Auth existed, whose
 * thirty-day token is still in localStorage, and detached mode, where the UI
 * points at a remote instance and cookie auth cannot apply at all.
 *
 * Otherwise the Better Auth session provides a short-lived JWT. Returning
 * `fromSession` lets the caller know a 401 is worth one retry -- a stale
 * manual token is not, but an expired JWT is.
 */
async function resolveCredential() {
  const manual = getAuthToken();
  if (manual) return { credential: manual, fromSession: false };
  return { credential: await getJwt(), fromSession: true };
}

// API client with auth
async function api(endpoint, options = {}, { allowRetry = true } = {}) {
  const baseUrl = getApiBase();
  const { credential, fromSession } = await resolveCredential();

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  // Add auth header if token exists
  if (credential) {
    headers["Authorization"] = `Bearer ${credential}`;
  }

  const url = `${baseUrl}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    // A session JWT is short-lived by design, so the first 401 after it
    // expires is expected rather than exceptional. Drop it, derive a fresh one
    // from the cookie and try once more. Only once: a second 401 means the
    // session itself is gone, and retrying would loop.
    if (response.status === 401 && fromSession && allowRetry) {
      forgetJwt();
      return api(endpoint, options, { allowRetry: false });
    }

    if (response.status === 401 || response.status === 403) {
      // Prefer the server's own detail (e.g. "current password is
      // incorrect") over the generic fallback, so callers like
      // set-password can show the real reason.
      let detail = null;
      try {
        const body = await response.json();
        detail = body?.detail;
      } catch {
        // no JSON body; fall back below
      }
      const fallback =
        response.status === 401
          ? "Authentication failed. Check your API token."
          : "Access forbidden. Invalid API token.";
      // The status rides along on the Error so a caller that needs to tell
      // "this credential is bad" apart from "this credential is fine but
      // underscoped for this endpoint" can, instead of pattern-matching the
      // fallback string. See listTokens below for why that distinction
      // matters here specifically.
      const error = new Error(detail || fallback);
      error.status = response.status;
      throw error;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API Error ${response.status}: ${text}`);
    }

    return response.json();
  } catch (error) {
    if (error.name === "TypeError" && error.message.includes("fetch")) {
      throw new Error(`Cannot connect to server at ${baseUrl}. Is it running?`);
    }
    throw error;
  }
}

// Test connection to server
async function testConnection(serverUrl, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = serverUrl.endsWith("/") ? serverUrl.slice(0, -1) : serverUrl;
  const response = await fetch(`${url}/health`, { headers });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Invalid API token");
    }
    throw new Error(`Server returned ${response.status}`);
  }

  return response.json();
}

// Register a new account. `serverUrl` is the full API base including the
// /api prefix, matching the Server URL field / getApiBase(). `password` is
// optional (bare-username/token-only accounts remain supported).
async function registerAccount(serverUrl, username, password) {
  const url = serverUrl.endsWith("/") ? serverUrl.slice(0, -1) : serverUrl;
  const body = { username };
  if (password) body.password = password;
  const res = await fetch(`${url}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.detail || "Registration failed");
  }
  return res.json(); // { user_id, username, token }
}

// Sign in with username + password. `serverUrl` is the full API base
// including the /api prefix (same shape as registerAccount).
async function loginAccount(serverUrl, username, password) {
  const url = serverUrl.endsWith("/") ? serverUrl.slice(0, -1) : serverUrl;
  const res = await fetch(`${url}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.detail || "Sign in failed");
  }
  return res.json(); // { user_id, username, token }
}

// Identify the caller. With explicit (serverUrl, token) it checks those form
// values directly (used before Save); otherwise it uses the saved config.
async function whoami(serverUrl, token) {
  if (serverUrl) {
    const url = serverUrl.endsWith("/") ? serverUrl.slice(0, -1) : serverUrl;
    const res = await fetch(`${url}/auth/whoami`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`whoami failed: ${res.status}`);
    return res.json();
  }
  return api("/auth/whoami");
}

// Check if connected
function isConfigured() {
  const config = getConfig();
  return !!(config?.serverUrl || import.meta.env.DEV);
}

/**
 * What this instance is, before anyone has a credential.
 *
 * Read by the sign-up screen to learn whether an invite code is required. No
 * credential is sent or needed -- it decides what a stranger is shown, so a
 * stranger has to be able to read it.
 *
 * Falls back to "not invite-only" when unreachable. That is the right way to
 * be wrong: an instance that IS invite-only still refuses the sign-up itself,
 * so the worst case is a form that asks for no code and is then told it needed
 * one. Guessing the other way would put an invite gate in front of every
 * self-hosted instance the moment this call failed.
 */
async function getInstance() {
  try {
    const response = await fetch(`${getApiBase()}/instance`);
    if (!response.ok) return { invite_only: false };
    return await response.json();
  } catch {
    return { invite_only: false };
  }
}

// Export data as zip file download
async function exportData() {
  const baseUrl = getApiBase();
  const { credential: token } = await resolveCredential();

  const headers = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}/export`, { headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Export failed: ${text}`);
  }

  // Get filename from header or generate one
  const disposition = response.headers.get("content-disposition");
  let filename = "mygist_backup.zip";
  if (disposition) {
    const match = disposition.match(/filename=(.+)/);
    if (match) filename = match[1];
  }

  // Download the file
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);

  return { success: true, filename };
}

// Import data from zip file
// mode: "replace" (default) or "merge"
async function importData(file, mode = "replace") {
  const baseUrl = getApiBase();
  const { credential: token } = await resolveCredential();

  const formData = new FormData();
  formData.append("file", file);

  const headers = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}/import?mode=${mode}`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Import failed: ${response.status}`);
  }

  return response.json();
}

// Set (or change) the current user's password. `currentPassword` is only
// required when the account already has a password set.
async function setPassword(newPassword, currentPassword) {
  const body = { password: newPassword };
  if (currentPassword) body.current_password = currentPassword;
  return api("/auth/set-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// List the current user's API tokens (id, label, created_at, last_used_at,
// scopes). Account-management endpoints -- this one included -- require
// persona:write, so a read-scoped credential (an OAuth grant, or a token
// minted without the write toggle) gets a 403 here even though it works
// everywhere else. That is not a broken request, so it must not read like
// one: the generic 403 fallback ("Access forbidden. Invalid API token.")
// would tell someone with a perfectly valid token that it's invalid.
async function listTokens() {
  try {
    const result = await api("/auth/tokens");
    return result.tokens;
  } catch (err) {
    if (err.status === 403) {
      throw new Error(
        "This connection doesn't have permission to manage tokens -- it only has read access. Sign in on this device, or use a token with full access, to view or generate tokens.",
      );
    }
    throw err;
  }
}

// Create a new named API token, optionally scoped. `tokenScopes` omitted or
// null grants every scope, matching a token's historical default; passing an
// array limits it to exactly those (persona:read is always included
// server-side regardless -- see db.create_token). Returns { id, label, token }
// -- the plaintext token is only ever shown once, at creation time.
async function createToken(label, tokenScopes) {
  return api("/auth/tokens", {
    method: "POST",
    body: JSON.stringify({
      label,
      ...(tokenScopes ? { scopes: tokenScopes } : {}),
    }),
  });
}

// Revoke one of the current user's tokens.
async function revokeToken(id) {
  return api(`/auth/tokens/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Connected applications (OAuth grants)
// ---------------------------------------------------------------------------
//
// These talk to the auth service directly over authFetch, the same as
// Consent.jsx -- not through api()/getApiBase(), which point at the MyGist
// API and send a Bearer token rather than the session cookie Better Auth's
// /oauth2/* routes need.
//
// GET /oauth2/get-consents returns a bare array of consent rows -- confirmed
// by reading auth/node_modules/@better-auth/oauth-provider/dist/index.mjs's
// getConsentsEndpoint, which is a raw `adapter.findMany` with no join:
//   [{ id, clientId, userId, referenceId, scopes: string[], createdAt, updatedAt }]
// There is no client display name and no last-used time on the row itself --
// the display name comes from /oauth2/public-client?client_id=, the same
// public, session-gated endpoint Consent.jsx uses to name the client on the
// way in. Fetched once per distinct clientId rather than once per grant.

async function readAuthError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  return body?.error_description || body?.message || fallback;
}

// The connected apps a user has granted access to, with each client's
// display name resolved and merged in. Normalises to
// { id, clientId, clientName, scopes, createdAt } -- ConnectedApps.jsx
// consumes this shape directly.
async function listConnectedApps() {
  const res = await authFetch("/oauth2/get-consents");
  if (!res.ok) {
    throw new Error(await readAuthError(res, "Could not load connected applications."));
  }
  const consents = await res.json();

  const uniqueClientIds = [...new Set(consents.map((c) => c.clientId))];
  const names = await Promise.all(
    uniqueClientIds.map(async (clientId) => {
      try {
        const r = await authFetch(`/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`);
        if (!r.ok) return [clientId, clientId];
        const body = await r.json();
        return [clientId, body?.client_name || clientId];
      } catch {
        // A client that no longer resolves (deleted, say) still had a
        // consent granted to it -- fall back to the id rather than losing
        // the row, since the user still needs to be able to revoke it.
        return [clientId, clientId];
      }
    }),
  );
  const nameByClientId = Object.fromEntries(names);

  return consents.map((c) => ({
    id: c.id,
    clientId: c.clientId,
    clientName: nameByClientId[c.clientId] || c.clientId,
    scopes: c.scopes || [],
    createdAt: c.createdAt,
  }));
}

// Revoke a connected application's access, by consent id (not client id).
// Deletes the underlying oauthConsent row, which is what a refresh token's
// validity is checked against -- so this is what makes the refresh token
// stop working immediately. It does not, and cannot, reach into an access
// token already issued; see ConnectedApps.jsx for why that's stated in the
// UI rather than left implicit.
async function revokeConnectedApp(consentId) {
  const res = await authFetch("/oauth2/delete-consent", {
    method: "POST",
    body: JSON.stringify({ id: consentId }),
  });
  if (!res.ok) {
    throw new Error(await readAuthError(res, "Could not revoke that connection."));
  }
}

// Pending proposals of one kind. Listing marks them seen server-side, which
// is what protects a row from eviction -- so this is not a free read.
async function listProposals(kind) {
  const data = await api(`/proposals?kind=${encodeURIComponent(kind)}`);
  return data.proposals || [];
}

// How many proposals are waiting. Unlike listProposals this does not mark
// rows seen, which matters because the sidebar dot polls it from every tab.
async function proposalCount() {
  const data = await api("/proposals/count");
  return data?.total ?? 0;
}

// `data` overrides the proposal's own payload, for edit-then-approve.
async function approveProposal(id, data) {
  return api(`/proposals/${id}/approve`, {
    method: "POST",
    body: JSON.stringify(data ? { data } : {}),
  });
}

async function rejectProposal(id) {
  return api(`/proposals/${id}/reject`, { method: "POST" });
}

async function promoteProposal(id, entity, data) {
  return api(`/proposals/${id}/promote`, {
    method: "POST",
    body: JSON.stringify({ entity, data }),
  });
}

export {
  CLOUD_API_URL,
  api,
  listProposals,
  proposalCount,
  approveProposal,
  rejectProposal,
  promoteProposal,
  getConfig,
  saveConfig,
  clearConfig,
  getApiBase,
  getAuthToken,
  testConnection,
  registerAccount,
  loginAccount,
  whoami,
  isConfigured,
  getInstance,
  exportData,
  importData,
  setPassword,
  listTokens,
  createToken,
  revokeToken,
  listConnectedApps,
  revokeConnectedApp,
};
