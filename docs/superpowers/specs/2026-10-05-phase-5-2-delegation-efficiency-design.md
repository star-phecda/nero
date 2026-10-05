# Phase 5.2 — Delegation Efficiency

## Goal

Prevent Nero from paying for the same worker research again during Phase 4 recovery.

Phase 5.2 keeps delegation request-scoped. Worker evidence is reusable only while the original task fingerprint and the worker's relevant dependency fingerprints remain valid.

## Runtime model

User request
→ task fingerprint
→ bounded delegation
→ worker evidence
→ temporary Delegation Artifact
→ synthesis
→ Phase 4 verification
→ recovery
→ selectively invalidate stale workers
→ reuse valid evidence
→ synthesize again

The artifact is never written to long-term memory, SQLite, Airtable, or an external cache.

## Artifact

src/core/neroDelegationArtifact.js owns:

- requestId
- task fingerprint
- delegation-plan fingerprint
- worker entries
- worker result/evidence fingerprints
- dependency fingerprints
- creation time
- reusable/invalidation state

SHA-256 fingerprints use Node's built-in node:crypto; this keeps the mechanism dependency-free and deterministic for the small in-memory values involved.

## Reuse rules

A worker result is reusable only when:

1. the task fingerprint matches;
2. the worker specification fingerprint matches;
3. the stored worker result completed successfully;
4. the entry is still marked reusable;
5. no relevant dependency was invalidated.

Failed/skipped worker results are never reused as successful evidence.

A new request creates a new task fingerprint and therefore cannot reuse the previous request's artifact.

## Dependency invalidation

Current worker dependencies are explicit:

- web researcher → web
- analyst/critic → context

Recovery actions are candidates for invalidation, not automatic rerun commands.

For refresh_web, Nero compares the new web evidence fingerprint with the artifact's stored web fingerprint. If the evidence did not change, the workers remain reusable. If it changed, only workers depending on web are invalidated.

For force_memory or expand_history, workers depending on context are invalidated.

Explicit worker invalidation is also supported for future contradiction/dependency classifiers.

## Phase 4 integration

Phase 4 remains the final authority. Its verifier and recovery semantics are unchanged.

The artifact is threaded through the existing recovery recursion. askGemini keeps it in the request-local phase4 state, so a recovery attempt can reuse the previous delegation without creating a global cache.

The delegator reports:

- reused worker count
- executed worker count
- normal delegation budget
- the updated request-scoped artifact

## Safety and budget constraints

Phase 5.2 does not:

- increase the worker ceiling;
- increase the delegation token budget;
- create permanent memory;
- create cross-request caching;
- change verifier authority;
- add new worker types;
- blindly reuse failed evidence.

Only missing or invalid workers are sent through the existing bounded worker pool.

## Verification

tests/phase5_2-delegation-efficiency.test.mjs covers:

- first execution;
- complete reuse on the same request;
- refresh-web with unchanged evidence (reuse);
- refresh-web with changed evidence (selective rerun);
- new-request fingerprint mismatch (no reuse);
- failed worker retry.

The focused Phase 5.2 gate passes after syntax checks.
