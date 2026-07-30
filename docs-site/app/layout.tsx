import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import type { Metadata } from 'next';
import { Provider } from '@/components/provider';
import { siteUrl } from '@/lib/shared';
import './global.css';

// Geist and Geist Mono, matching the app (frontend/tailwind.config.js).
//
// The `geist` package ships the font files, so they are bundled from
// node_modules rather than fetched from Google at build time -- the docs stage
// of the Dockerfile then needs no network beyond `npm ci`. The app itself still
// loads them from Google Fonts via a <link>; both end up rendering the same
// faces.
//
// The `.variable` classes publish --font-geist-sans / --font-geist-mono, which
// global.css maps onto Tailwind's --font-sans / --font-mono.

// Open Graph image URLs must be absolute. Without a metadataBase Next resolves
// them against http://localhost:3000 and every share card points at nothing.
// A static export cannot read the request host, so the canonical origin is
// configured rather than detected.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
