import type { MetadataRoute } from "next";
import { terminalBackground } from "@/features/shell/terminal-accent";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Our Days Mono",
    short_name: "Our Days Mono",
    description: "A quiet, private journal.",
    start_url: "/family",
    scope: "/",
    display: "standalone",
    background_color: terminalBackground,
    theme_color: terminalBackground,
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
