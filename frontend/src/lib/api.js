/**
 * API Client for MyGist Server
 * Handles authentication and server connection
 */

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

    if (response.status === 401) {
      throw new Error("Authentication failed. Check your API token.");
    }

    if (response.status === 403) {
      throw new Error("Access forbidden. Invalid API token.");
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
async function importData(file) {
  const baseUrl = getApiBase();
  const token = getAuthToken();

  const formData = new FormData();
  formData.append("file", file);

  const headers = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}/import`, {
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

export {
  api,
  getConfig,
  saveConfig,
  clearConfig,
  getApiBase,
  getAuthToken,
  testConnection,
  isConfigured,
  exportData,
  importData,
};
