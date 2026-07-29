import { Inter } from 'next/font/google';
import type { Metadata } from 'next';
import { Provider } from '@/components/provider';
import { siteUrl } from '@/lib/shared';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
});

// Open Graph image URLs must be absolute. Without a metadataBase Next resolves
// them against http://localhost:3000 and every share card points at nothing.
// A static export cannot read the request host, so the canonical origin is
// configured rather than detected.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
