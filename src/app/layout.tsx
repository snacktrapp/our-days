import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { themeBootstrapScript } from "@/features/shell/retro-theme";
import { journalPromoPrepaintScript } from "@/features/timeline/journal-promo-config";
import { resolveMetadataBase } from "@/lib/metadata-base.server";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import "./globals.css";
import "./retro.css";

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = {
  metadataBase,
  title: "Our Days — Private Journal",
  description:
    "A private journal for your life and the people you share it with.",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: {
      url: "/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png",
    },
  },
  appleWebApp: {
    capable: true,
    title: "Our Days",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Our Days",
    description: "A quiet, private journal.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Our Days",
    description: "A quiet, private journal.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Safari paints theme-color in the toolbar / home-indicator gap. Dark
  // matches the journal canvas. Activity and New moment sheets set it to
  // #000 via lockOverlayChrome.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edf0f4" },
    { media: "(prefers-color-scheme: dark)", color: "#101216" },
  ],
};

const themeBootstrap = `
  ${themeBootstrapScript()}
  ${journalPromoPrepaintScript()}
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? "";

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Runs as the document parses, before the journal shell paints. */}
        <script
          id="our-days-theme"
          nonce={nonce || undefined}
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
        />
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
