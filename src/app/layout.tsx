import type { Metadata, Viewport } from 'next';
import './globals.css';

function resolveMetadataBase() {
  const value = process.env.NEXT_PUBLIC_SITE_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const url = new URL(value);

  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('NEXT_PUBLIC_SITE_URL must be an origin without credentials, path, query, or hash.');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('NEXT_PUBLIC_SITE_URL must use HTTPS outside local development.');
  }

  return url;
}

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = {
  metadataBase,
  title: 'Our Days — Private Family Journal',
  description: 'A quiet, private place for a family to keep the story of its life.',
  robots: { index: false, follow: false },
  icons: {
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Our Days',
    description: 'A quiet, private family journal.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Our Days',
    description: 'A quiet, private family journal.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f3eee4',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
