/**
 * API Client for MyGist Server
 * Handles authentication and server connection
 */

// Default hosted API base (full URL including the /api prefix).
const CLOUD_API_URL = "https://mygist-api.thuradev.qzz.io/api";

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

// API client with auth
async function api(endpoint, options = {}) {
  const baseUrl = getApiBase();
  const token = getAuthToken();

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  // Add auth header if token exists
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${baseUrl}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

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
      throw new Error(detail || fallback);
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

// Export data as zip file download
async function exportData() {
  const baseUrl = getApiBase();
  const token = getAuthToken();

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
  const token = getAuthToken();

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

// List the current user's API tokens (id, label, created_at, last_used_at).
async function listTokens() {
  return api("/auth/tokens");
}

// Create a new named API token. Returns { id, label, token } -- the
// plaintext token is only ever shown once, at creation time.
async function createToken(label) {
  return api("/auth/tokens", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

// Revoke one of the current user's tokens.
async function revokeToken(id) {
  return api(`/auth/tokens/${id}`, { method: "DELETE" });
}

export {
  CLOUD_API_URL,
  api,
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
  exportData,
  importData,
  setPassword,
  listTokens,
  createToken,
  revokeToken,
};
