import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { connection } from "next/server";
import { resolveMetadataBase } from "@/lib/metadata-base.server";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import "./globals.css";

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = {
  metadataBase,
  title: "Our Days — Private Family Journal",
  description:
    "A quiet, private place for a family to keep the story of its life.",
  robots: { index: false, follow: false },
  icons: {
    apple: "/apple-touch-icon.png",
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3eee4" },
    { media: "(prefers-color-scheme: dark)", color: "#07110d" },
  ],
};

const themeBootstrap = `
  try {
    var savedTheme = window.localStorage.getItem("our-days-theme");
    var theme = savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (_) {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  }
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="our-days-theme" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
