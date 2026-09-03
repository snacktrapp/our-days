import type { NextConfig } from "next";
import {
  environmentForNextConfig,
  validateOurDaysEnvironment,
} from "./config/our-days-environment";
import { httpSecurityHeaders } from "./config/http-security";

const resolvedEnvironment = environmentForNextConfig(process.env);
if (resolvedEnvironment.NEXT_PUBLIC_SITE_URL) {
  process.env.NEXT_PUBLIC_SITE_URL = resolvedEnvironment.NEXT_PUBLIC_SITE_URL;
}
const environment = validateOurDaysEnvironment(resolvedEnvironment);

const privateRoutes = [
  "/",
  "/sign-in",
  "/auth/:path*",
  "/invite",
  "/invite/:path*",
  "/access-unavailable",
  "/api/auth/:path*",
  "/api/media/:path*",
  "/journal",
  "/family",
  "/trash",
  "/people",
  "/people/:path*",
  "/settings/:path*",
  "/memories/:path*",
  "/quality/:path*",
];
const privateHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["sharp"],
  outputFileTracingIncludes: {
    "/api/photos/process": [
      "./node_modules/sharp/**/*",
      "./node_modules/@img/sharp-linux*/**/*",
      "./node_modules/@img/sharp-libvips-linux*/**/*",
    ],
  },
  images: {
    qualities: [75],
    maximumRedirects: 0,
  },
  async headers() {
    return [
      ...privateRoutes.map((source) => ({ source, headers: privateHeaders })),
      {
        source: "/(.*)",
        headers: httpSecurityHeaders(environment.identity),
      },
    ];
  },
};

export default nextConfig;
