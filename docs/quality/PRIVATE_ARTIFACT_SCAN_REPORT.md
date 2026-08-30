# Private artifact scan contract

Date: 2026-08-30 (America/Los_Angeles)

Status: local release gate implemented. No Supabase, GitHub, or Vercel resource has been created or connected.

## Boundary

The repository's default and webpack production-build scripts run `npm run verify:artifacts` immediately after compilation. The scanner examines every tracked plus untracked non-ignored source file and the complete `.next` tree, including root manifests, server/client output, source maps, traces, cache metadata, and any standalone output. This closes the pre-commit gap where a newly created source file could otherwise evade the gate. Findings report only a rule, sanitized repository-relative path, and line; the matched value is never printed. Unexpected command/filesystem errors are generic so a credential-bearing filename cannot enter diagnostics.

The credential rules currently recognize:

- current Supabase secret keys;
- Supabase management access tokens;
- legacy Supabase JWTs whose decoded role is `service_role`;
- credentialed Postgres connection URLs;
- PEM private keys;
- prefixed GitHub access tokens.

The browser-deliverable scan also rejects 14 canaries from the local design fixture: all five preview family names, four earlier distinctive values, and all five synthetic private note bodies. Sam and June are composer-only canaries, preventing a future client hardcode of the extended roster from bypassing the gate. That scope covers `public/**`, `.next/static`, standalone copies of either directory, App Router prerendered `.html`, `.rsc`, `.body`, `.meta`, `.txt`, and `.xml` output, and Pages Router `server/pages/**/*.json` data. The values may exist in the server-only JavaScript fixture bundle and its server source maps for local design review, but not in a browser-deliverable payload. The checked-in `public/sample-family.jpg` is documented non-personal stock imagery; its filename is safe, while serialization of its path into a client payload still trips the canary.

The scanner fails closed when the build root, build ID, or a source/build leaf is a symlink or non-regular file; when a path escapes the repository, exceeds 64 MiB, or cannot be read; or when `.next/BUILD_ID` is absent. The cap accommodates current Next compiler caches while preventing an unexpected artifact from consuming unbounded memory. It is deterministic and honors `.gitignore`, so a legitimate ignored `.env.local` does not make the repository check unusable. Startup validation separately rejects privileged values in the ordinary web process.

## Executable evidence

`tests/contracts/private-artifact-scan.test.ts` proves:

- each supported credential class is found;
- public publishable-key and detector-source text is allowed;
- decoded legacy `service_role` JWTs are found;
- private fixture canaries are rejected only in browser-deliverable scope;
- path ordering and line reporting are stable;
- credential patterns in contents and filenames are both detected;
- neither structured findings, credential-bearing filenames, control characters, nor command errors expose the detected value;
- public files, prerendered RSC, root manifests, and standalone client output are covered;
- untracked non-ignored source and the composer-only roster canaries are covered;
- a deliberately deleted tracked path does not abort or weaken the source scan;
- leaf and build-root symlink inputs fail closed.

`tests/contracts/ci-workflow.test.ts` requires all three independent CI builds—quality, functional browser, and visual—to use the atomic scanned build script. It also locks the default and webpack build-script composition and requires the browser jobs to build/scan immediately before Playwright. The workflow does not upload build or browser artifacts.

This checkpoint passed 178 Vitest checks across 15 files, an atomic local webpack production build plus artifact scan, and the current browser matrix with 96 passes and 41 intentional project-specific skips. The default Turbopack build reached its known restricted-environment worker-port limitation locally; its managed CI path passed in the preceding environment-isolation checkpoint and remains required in every hosted CI job.

## Limits and later gates

Pattern matching cannot prove that every possible credential format is absent. The scanner inspects byte content as UTF-8 text; it does not semantically decode compressed, encrypted, image/video, UTF-16, or novel binary formats. Novel opaque tokens, credentials assembled only at runtime, external platform logs, and deployment-provider build records require separate controls. Before a hosted release, environment inspection must confirm that the ordinary web deployment contains no bypass credential, and an authenticated browser/data review must prove that no family payload enters static assets, source maps, traces, logs, or public caches. Future worker artifacts require their own allowlisted credential boundary and scan rather than an exception to this web gate.
