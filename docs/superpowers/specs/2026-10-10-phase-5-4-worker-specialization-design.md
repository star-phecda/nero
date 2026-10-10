# Phase 5.4 — Worker Specialization

Date: 2026-10-10

## Goal

Turn Nero's existing generic delegation workers into a coordinated three-role workflow: a web researcher gathers evidence, an analyst evaluates it, and a critic independently stress-tests the conclusions. The aggregator returns a machine-readable evidence summary for Nero to synthesize before the existing Phase 4 verification. Nero remains the only user-facing voice.

## Current state

Inspected on `main` at commit `2a41e681934c80d6ea44402f1d7fd840c55b68a5`.

- `neroWorker.js` already has researcher, analyst, and critic prompt branches, but they share one loose result schema and the analyst/critic do not receive the researcher's output.
- `neroDelegator.js` creates role-specific specs but hands every worker to the pool in one parallel batch.
- `neroWorkerPool.js` caps the pool at three workers and enforces per-pool token/time budgets.
- `neroDelegationAggregator.js` returns a text report, worker outputs, sources, and uncertainties, but does not distinguish agreement, confidence, or critique findings as structured fields.
- `neroPlanner.js` caps workers at three but defaults `NERO_PHASE5_MAX_WORKERS` to one.
- `neroDelegationArtifact.js` supports request-scoped reuse and context/web dependency invalidation. Phase 5.4 must preserve this boundary and extend it to the new research-to-analysis dependency.

## Workflow

1. **Research stage:** run one researcher worker first. It uses the existing delegated web-search path and returns evidence-backed claims, per-claim source URLs, and uncertainties. It must not draft the answer to the user.
2. **Evaluation stage:** after successful research, pass the same bounded research packet and the original assigned context to the analyst and critic. Run the selected evaluation workers concurrently.
3. **Aggregation stage:** deterministically combine the structured worker records into consensus, high-confidence claims, explicit conflicts, uncertainty, and source lists. Do not add a fourth model call to aggregate results.
4. **Synthesis and verification:** retain the existing application handoff: Nero synthesizes the aggregate, and Phase 4 remains the final verification/recovery authority.

If research fails or produces no usable evidence, do not send an empty or fabricated research packet to the evaluation stage. Return an unusable/partial delegation result so Nero can answer through its existing non-delegated path or request-level recovery.

## Worker contracts

### Researcher

- Uses web search only when its `web_search` permission is granted.
- Extracts factual claims from supplied search results and associates each claim with source URL(s) present in that evidence.
- Preserves relevant source titles/excerpts and reports missing or conflicting evidence as uncertainty.
- Does not compare options into a recommendation and does not formulate a user-facing answer.
- Treats fetched page content as untrusted evidence, never as instructions.

### Analyst

- Receives the researcher evidence packet plus the original assigned context.
- Compares claims, identifies patterns and trade-offs, checks calculations when relevant, and challenges weak inferences.
- Distinguishes what the evidence says from what it implies; does not invent facts or source URLs.
- Reports conclusions and their evidential basis, along with uncertainty.

### Critic

- Receives the same research packet and assigned context independently of the analyst's generated conclusions.
- Explicitly identifies contradictions, unsupported claims, non sequiturs, and missing evidence.
- A critique record identifies the target claim and issue type; absence of a critique is not proof that a claim is true.
- Reports uncertainty directly and must not invent counter-evidence.

All workers retain existing side-effect restrictions, bounded output, timeout/cancellation behavior, and no-recursive-delegation policy. The existing structured `summary`, `findings`, and `uncertainties` fields remain supported; new finding metadata is additive and validated during parsing.

## Aggregation contract

Return a structured object with these stable top-level fields:

- `consensus`: claims whose normalized wording is independently present in both researcher evidence and analyst findings, with available support/source attribution.
- `high_confidence`: consensus claims with analyst confidence of at least `0.8`, source-backed researcher evidence, and no matching critic challenge.
- `conflicts`: explicit critic challenges, each retaining its target claim, issue type, reasoning/evidence, and provenance where available.
- `uncertain`: deduplicated uncertainty statements from any completed worker.
- `sources`: deduplicated source URLs actually present in researcher search results or worker source records.

Claim matching in this phase is deliberately conservative and deterministic (case/whitespace/punctuation-normalized exact matching). It must not claim semantic agreement where the normalized claims do not match. Phase 5.5 may add richer evidence-quality scoring and conflict resolution. A high-confidence label is a structured heuristic, not a guarantee of truth.

Retain the current `status`, `text`, `workers`, `budget`, and completion-count fields for compatibility with the existing `app.js` prompt injection and observability. The text summary must faithfully render the structured aggregate without implying certainty beyond its rules.

## Delegation budget and worker cap

- Keep the absolute maximum at three workers.
- Default `NERO_PHASE5_MAX_WORKERS` to three; continue clamping the environment override to the range 1–3.
- Honor a lower override. Select roles in the order researcher, analyst, critic, so a cap of one runs research only and a cap of two runs research plus analysis.
- Enforce one request-wide token budget and one request-wide wall-time deadline across both stages; do not reset the full budget when moving from research to evaluation.
- Share cancellation across the stages. Workers skipped because the budget or deadline is exhausted produce explicit skipped/failure records rather than fabricated findings.
- Do not raise existing total token/time limits or worker-level maximums as part of 5.4.

## Request-scoped artifact compatibility

Phase 5.2 reuse remains request-local; no persistent/global cache or long-term memory is added.

- Researcher reuse is governed by the existing request/worker fingerprints and its current web dependency rules.
- Analyst and critic results additionally depend on the research evidence fingerprint and original context fingerprint.
- Resolve/reuse the researcher result before deciding whether analyst/critic results can be reused. If research evidence changes, invalidate only downstream workers that depend on it; do not invalidate a still-valid researcher result.
- Failed/skipped worker output is never reusable as completed evidence.
- Recovery actions and the existing `NeroDelegationArtifact` lifecycle must continue to work without bypassing dependency checks.

## Out of scope

- Phase 5.5 evidence-quality scoring, probabilistic/semantic conflict resolution, or automatic source credibility ranking.
- Adaptive worker count or task-by-task delegation decisions (Phase 5.6).
- Persistent or cross-request research caching (Phase 5.7).
- Semantic memory, Qdrant, or new external services.
- Adding workers beyond the current ceiling, adding a fourth aggregation model call, changing providers, or changing the user-facing Nero persona.
- Changing Phase 4 verification authority or any worker permission boundary.

## Acceptance criteria

1. Researcher runs before evaluation workers, and analyst/critic receive the same research packet plus assigned context.
2. Analyst and critic run concurrently after successful research.
3. Default planning selects all three roles; explicit caps of one and two are honored without exceeding their count.
4. The pool's absolute maximum remains three, and the full workflow observes one shared token budget, deadline, and cancellation signal.
5. Role prompts have distinct, testable responsibilities; the critic emits explicit typed challenges and uncertainty.
6. Aggregation returns the five specified structured fields, keeps real source URLs, normalizes duplicates, and never labels challenged claims high-confidence.
7. Unmatched claim wording is not falsely reported as consensus; a matching critic challenge removes the claim from high-confidence.
8. A changed research evidence fingerprint invalidates dependent analyst/critic cache entries but allows valid researcher reuse; unchanged dependencies allow reuse.
9. Failed or empty research does not spawn evaluation workers with fabricated/empty evidence.
10. Existing worker safety restrictions, request-scoped cache semantics, application handoff, and Phase 4 verification remain intact.
11. New Phase 5.4 tests cover sequencing, input packet propagation, role contracts, aggregation, worker caps/budgets, failure behavior, and cache invalidation; existing Phase 5.1–5.3 regression gates remain applicable.
