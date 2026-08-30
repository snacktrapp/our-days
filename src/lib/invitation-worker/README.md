# Invitation worker contract

This directory is decision-independent groundwork for the accepted invitation-bound email flow. It contains a pure worker contract, strict runtime validation, deterministic token derivation, and test-only in-memory fault-injection doubles. `index.ts` exports only the production-neutral contract; tests must import doubles directly from `test-support.ts` so they cannot be mistaken for production adapters.

Production adapters are deliberately unimplemented. In particular, this directory does not contain a database coordinator, Supabase Admin client, Auth-user provisioner, secret manager, email provider, action-link builder, queue runner, HTTP endpoint, Next.js import, deployment configuration, or privileged credential.

A production worker must be deployed separately from the web application. It must load work only by opaque durable job ID, keep versioned token keys outside the repository and web environment, enforce provider idempotency, and implement every coordinator authorization/compare operation atomically as documented in `contract.ts`. The pre-provider atomic coordinator read—not a separate directory lookup—must return the confirmed normalized recipient and an opaque recipient binding from the same authoritative snapshot. The binding must change whenever the address or confirmation authority changes, and completion must compare it exactly.

Every authorized coordinator seam must also prove that the target Auth user is not already active in the same circle. After materialization, loss of requester authority, recipient confirmation/binding, or target eligibility must atomically invalidate both the durable job and invitation; merely returning an error is insufficient because the bearer token must stop working.

`authorizationVersion` is an opaque database compare value. Adapters and workers must preserve its exact text, including valid microseconds or RFC3339 offsets, and must never parse, normalize, truncate, or re-emit it.

Email delivery cannot participate in the database authorization transaction. The contract therefore reauthorizes immediately before the provider call and again inside atomic completion. If revocation lands in that final network race, an email may already have been accepted, but completion must fail and the durable coordinator must have invalidated the invitation so the link grants nothing.
