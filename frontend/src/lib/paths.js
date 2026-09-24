/**
 * Where the app lives.
 *
 * `/` is the landing page for everyone; the app, its sign-in screens and the
 * OAuth screens live under `/app`. The same bundle serves both -- main.jsx
 * picks which one to render from the path.
 */
export const APP_PATH = "/app";

export function isAppPath(pathname) {
  return pathname === APP_PATH || pathname.startsWith(`${APP_PATH}/`);
}

// What the old root URL carried that meant "the app", not "the landing page".
// ?invite, ?reset, ?verified and ?onboarding arrive from emails, invite links
// and auth redirects sent before the move; a #/ route is a bookmark.
const APP_PARAMS = ["invite", "reset", "verified", "onboarding"];

/**
 * Where a link should go now, or null to stay put: a bare /app gets its
 * slash, and old links at the root move under /app/. The server cannot see a
 * #fragment, so an old
 * `/#/profile` bookmark reaches the landing page and has to be sent on from
 * the browser.
 */
export function legacyForward({ pathname, search, hash }) {
  // /app/ is canonical, so routes read /app/#/profile. The server redirects a
  // bare /app too; this covers the dev server and anything else in front.
  if (pathname === APP_PATH) return `${APP_PATH}/${search}${hash}`;
  if (pathname !== "/") return null;
  const params = new URLSearchParams(search);
  const carriesApp = hash.startsWith("#/") || APP_PARAMS.some((p) => params.has(p));
  return carriesApp ? `${APP_PATH}/${search}${hash}` : null;
}
