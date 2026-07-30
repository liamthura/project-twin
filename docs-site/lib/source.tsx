import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { BookOpen, Server } from 'lucide-react';
import type { ReactNode } from 'react';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';

// Icons named by `"icon"` in a meta.json. Kept to an explicit map rather than a
// dynamic lookup over all of lucide: two roots need one each, and a map means a
// typo is a missing icon at build time instead of a silent undefined.
const icons: Record<string, ReactNode> = {
  BookOpen: <BookOpen />,
  Server: <Server />,
};

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [],
  icon(name) {
    return name ? icons[name] : undefined;
  },
});

export function getPageImageUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: '/' + [page.locale, ...docsImageRoute.split('/'), ...segments].filter(Boolean).join('/'),
  };
}

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md'];

  return {
    segments,
    url: '/' + [page.locale, ...docsContentRoute.split('/'), ...segments].filter(Boolean).join('/'),
  };
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
