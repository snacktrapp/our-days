import type { NextConfig } from "next";

const privateRoutes = [
  "/",
  "/sign-in",
  "/journal",
  "/family",
  "/people",
  "/people/:path*",
  "/memories",
];
const privateHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    qualities: [75],
    maximumRedirects: 0,
  },
  async headers() {
    return [
      ...privateRoutes.map((source) => ({ source, headers: privateHeaders })),
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
