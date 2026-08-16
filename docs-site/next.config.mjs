import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// Where FastAPI mounts this site. Declared once and passed through `env` below,
// because Next rewrites the URLs it controls -- pages, next/image, next/link --
// and nothing else. A plain <img src="/screenshots/x.png"> is left alone, and
// on the real origin "/" is the SPA, so the image 404s. Anything reaching for a
// file in public/ has to add this prefix itself.
const basePath = '/docs';

/** @type {import('next').NextConfig} */
const config = {
  // A static export, copied into the API image and served by FastAPI. Next is
  // a BUILD-TIME dependency only -- no Next runtime ships, which is why
  // anything needing a server (ISR, image optimisation, middleware) is off the
  // table here rather than merely unused.
  output: 'export',

  // FastAPI mounts the export at /docs (backend/main.py, register_static_routes).
  // Without this, every asset URL and internal link would resolve against "/",
  // which is the SPA. The site's own pages sit at its root -- see lib/shared.ts
  // for why they are not under a second /docs.
  basePath,

  // The same value, readable from component code. One declaration, so the
  // prefix a <img> builds by hand cannot drift from the one Next serves under.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },

  // StaticFiles(html=True) resolves a directory to its index.html, so emitting
  // `page/index.html` rather than `page.html` is what makes /docs/page/ work
  // without a rewrite rule on the Python side.
  trailingSlash: true,

  // next/image's optimiser is a server. With `output: export` and no runtime,
  // images have to be passed through untouched.
  images: { unoptimized: true },

  // There are two lockfiles under this repo -- frontend/ and docs-site/ -- and
  // Turbopack infers its workspace root by walking up until it finds one. Left
  // to guess it warns and may pick the wrong tree; naming it removes the
  // ambiguity and keeps the docs build independent of the app's.
  turbopack: { root: import.meta.dirname },

  reactStrictMode: true,
};

export default withMDX(config);
