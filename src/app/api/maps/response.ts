const headers = {
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

export const mapsApiHeaders = headers;

export function mapTilerUpstreamInit(request?: Request): RequestInit {
  const origin = request ? new URL(request.url).origin : "";
  return {
    method: "GET",
    headers: origin ? { Referer: `${origin}/` } : undefined,
  };
}

export function mapsApiText(status: number, body: string) {
  return new Response(body, {
    status,
    headers: {
      ...headers,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
