import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import { connection } from "next/server";
import { resolveMetadataBase } from "@/lib/metadata-base.server";
import { ServiceWorkerCleanup } from "./service-worker-registration";
import "./globals.css";

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = {
  metadataBase,
  title: "Our Days — Private Family Journal",
  description:
    "A quiet, private place for a family to keep the story of its life.",
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
    description: "A quiet, private family journal.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Our Days",
    description: "A quiet, private family journal.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Safari paints theme-color in the toolbar / home-indicator gap. Dark
  // matches the journal canvas. Photo fullscreen sets it to #000 via
  // lockOverlayChrome. New moment keeps these idle colors so frost can
  // sample the grid.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3eee4" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1712" },
  ],
};

const themeBootstrap = `
  try {
    var savedTheme = window.localStorage.getItem("our-days-theme");
    var theme = savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = theme;
  } catch (_) {
    document.documentElement.dataset.theme = "dark";
  }
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
        <Script
          id="our-days-theme"
          strategy="beforeInteractive"
          nonce={nonce || undefined}
        >
          {themeBootstrap}
        </Script>
        {children}
        <ServiceWorkerCleanup />
      </body>
    </html>
  );
}
