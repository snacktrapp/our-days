import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import { connection } from "next/server";
import { journalPromoPrepaintScript } from "@/features/timeline/journal-promo-config";
import {
  terminalBackground,
  terminalThemeBootstrap,
} from "@/features/shell/terminal-accent";
import { resolveMetadataBase } from "@/lib/metadata-base.server";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import "./globals.css";
import "./terminal-mono.css";

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = {
  metadataBase,
  title: "Our Days — Private Journal",
  description:
    "A private journal for your life and the people you share it with.",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/favicon.ico" },
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
  // Dark only. Safari paints theme-color in the toolbar / home-indicator gap.
  // Activity and New moment sheets set it to black via lockOverlayChrome.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: terminalBackground },
    { media: "(prefers-color-scheme: dark)", color: terminalBackground },
  ],
};

const themeBootstrap = `${terminalThemeBootstrap()}
  ${journalPromoPrepaintScript()}`;

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
        <Script
          id="our-days-theme"
          strategy="beforeInteractive"
          nonce={nonce || undefined}
        >
          {themeBootstrap}
        </Script>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
