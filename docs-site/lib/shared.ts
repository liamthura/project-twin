// Route constants for the docs site.
//
// `docsRoute` is "/" and not "/docs": FastAPI serves this site's exported
// output AT /docs (backend/main.py register_static_routes), and next.config
// sets basePath to match. Keeping the scaffold's internal /docs route on top
// of that would publish every page at /docs/docs/... . MyGist's SPA owns "/"
// on the real origin, so this site has no landing page of its own -- the
// scaffold's was deleted rather than left as an unreachable "Hello World".
export const appName = 'MyGist';

// The canonical public origin, used for absolute URLs a static export cannot
// derive at request time (Open Graph images, canonical links).
export const siteUrl = 'https://mygist.thuradev.qzz.io';
export const docsRoute = '/';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: 'liamthura',
  repo: 'project-twin',
  branch: 'main',
};
