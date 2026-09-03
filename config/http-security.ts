export type HttpSecurityEnvironment = "local" | "preview" | "production";

const sharedSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(self)",
  },
] as const;

export function httpSecurityHeaders(
  identity: HttpSecurityEnvironment,
  options: Readonly<{ allowSameOriginFrame?: boolean }> = {},
) {
  return [
    ...sharedSecurityHeaders.map((header) =>
      header.key === "X-Frame-Options" && options.allowSameOriginFrame
        ? { key: "X-Frame-Options", value: "SAMEORIGIN" }
        : header,
    ),
    ...(identity === "production"
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ]
      : []),
  ];
}
