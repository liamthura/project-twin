'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Tags the docs chrome with which of the two roots is being read, so the
 * accent colour can differ between them -- blue for Using MyGist, orange for
 * Running MyGist. global.css hangs the token overrides off `data-docs-root`.
 *
 * It has to wrap DocsLayout rather than sit inside it: the sidebar is rendered
 * by the layout, so an element among `children` would be too deep to reach it.
 *
 * `usePathname` resolves during prerender for every statically generated
 * route, so the attribute is in the exported HTML. No script, and no flash of
 * the wrong accent before hydration.
 *
 * `display: contents` keeps the wrapper out of the layout entirely.
 */
export function DocsRootScope({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // usePathname excludes basePath, so these are "/run/..." not "/docs/run/...".
  const root = pathname.startsWith('/run') ? 'run' : 'use';

  return (
    <div data-docs-root={root} className="contents">
      {children}
    </div>
  );
}
