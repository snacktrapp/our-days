import type { Metadata, Viewport } from "next";
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
  themeColor: "#f3eee4",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();

  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
