# Browser security boundary

Date: 2026-08-29 (America/Los_Angeles)

Status: local security boundary implemented. Invitation auth and external Supabase/Vercel resources are not connected.

## Boundary

`src/proxy.ts` follows the current Next.js 16 nonce-CSP flow: it creates a cryptographically random nonce for every render request, overwrites any caller-supplied nonce or policy, passes both the nonce and policy upstream in request headers, and returns the same policy to the browser. The nonce is not exposed as its own response header. `src/app/layout.tsx` calls `connection()` so rendered pages are request-time rather than static/CDN artifacts; this is an intentional privacy-over-caching tradeoff and is compatible with the authenticated no-store architecture.

The enforced Production policy:

- permits scripts only through the per-request nonce and `strict-dynamic`;
- forbids inline event handlers, style attributes, frames, plugins, and a caller-controlled base URL;
- nonces framework scripts and styles automatically through Next;
- limits images, media, fonts, workers, manifests, forms, and connections by type;
- adds only the exact validated Supabase HTTP and websocket origins when that isolated project is configured—never a wildcard;
- allows no analytics, advertisements, reporting collector, or other third-party origin;
- upgrades insecure subresource requests.

Development alone permits `unsafe-eval`, inline styles, and websocket connections for React/Next debugging and hot reload. These escapes are absent from Production responses.

The proxy excludes only seven exact, contract-verified public files: the service worker and six installed/design-review images. The service worker is a reviewed public executable, but none of these paths renders HTML. Framework assets, image-optimizer requests, generated manifest/robots routes, missing favicon paths, near misses, and all unknown paths deliberately remain inside the nonce proxy so an HTML error response cannot escape CSP. Every path also receives the static `next.config.ts` baseline: MIME sniffing denial, clickjacking denial, no referrer, same-origin opener/resource isolation, and the narrow camera/location permissions policy. HSTS is emitted only under the exact Production environment identity, never by local or Preview responses.

## Executable evidence

The unit and contract suites verify:

- strict Production directives and development-only escapes;
- exact hosted and loopback Supabase origin derivation;
- rejection of malformed, credentialed, path-bearing, insecure remote origins and unsafe nonces;
- fresh random policies that ignore attacker-provided headers;
- exact proxy route matching and public-asset exclusions;
- shared static isolation headers and Production-only HSTS.

The browser suite verifies real production responses have fresh distinct nonces, all rendered script tags carry the matching nonce, no standalone nonce header escapes, locked redirects retain CSP, and public service-worker responses stay outside the nonce proxy. It also injects an inline event handler and proves Chromium blocks it. Custom class-based 404 and global-error boundaries prevent Next fallback UI from violating the enforced policy; the error boundary is also checked for narrow-screen reflow, keyboard focus, retry behavior, and serious/critical accessibility findings.

The first full enforcement run caught two genuine self-violations. Next's `Image` component emitted a style attribute for fill sizing, so the public design-preview renderer now retains Next's responsive optimizer URLs through `getImageProps` while discarding the generated style and applying dimensions through reviewed classes. The composer now locks body scrolling with a class instead of mutating `body.style`. A browser regression requires Family, Memories, and the open composer to contain no application-owned style attributes. The cached offline document also moved its CSS into the explicit public-shell allowlist; service-worker cache version 2 installs the HTML and stylesheet atomically and leaves version 1 active if installation fails.

## Latest local gate

- `npm run check`: 14 test files and 148 unit, component, proxy, environment, service-worker, workflow, and header-contract tests passed; formatting, ESLint, and TypeScript passed with no warnings.
- `npm run test:e2e`: the atomic webpack build and complete private-artifact scan passed, followed by 68 browser tests passed and 24 intentional project-specific skips with no failures.
- Covered projects: Chromium iPhone-sized, Chromium 320px short-screen, Firefox mobile, and pinned Chromium 430px visual. The expanded Family and Memories baselines were regenerated, individually inspected, and then passed without update in the final matrix.
- Browser execution is serialized through one worker. Fresh nonce rendering makes every protected document request-time; concurrent local browser workers intermittently saturated the single Next test server and stalled Firefox's first full-page load event. The serialized full matrix is deterministic while still covering every configured local project.

## Limits and later gates

CSP reduces the impact of script/style injection; it is not authorization and does not replace RLS, current membership checks, same-origin mutation validation, or dependency review. `strict-dynamic` intentionally lets nonce-trusted application code load a descendant script, so trusted code and dependencies remain security-sensitive. There is no third-party CSP reporting endpoint because family URLs or diagnostics must not leave the product by default; a future first-party redacting collector requires its own privacy review. Hosted headers, auth callbacks, session refresh, Server Actions, signed media delivery, account switching, and real Safari enforcement remain later phase/release checks.

References: [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy), [Next.js Proxy reference](https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
