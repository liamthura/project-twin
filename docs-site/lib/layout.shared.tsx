import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/logo';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2">
          <Logo className="size-5 text-fd-brand" />
          <span className="font-semibold">{appName}</span>
          {/* The site lives at /docs on the app's own origin, so the wordmark
              alone would not say which of the two you are looking at. */}
          <span className="text-fd-muted-foreground font-normal">docs</span>
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
