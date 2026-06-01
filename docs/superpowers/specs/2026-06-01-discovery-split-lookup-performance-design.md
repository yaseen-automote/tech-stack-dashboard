# Discovery Split Lookup Performance Design

## Summary

Redesign the `Domain & Subdomain Discovery` lookup path so it no longer queries the heavy `bulk_hostname_serving` table for search results. Instead, discovery should read only from `bulk_apex_domain_lookup` and `bulk_subdomain_lookup_v2`, with both tables upgraded into search-oriented lookup indexes.

The target is to preserve the current UI behavior and filter semantics while making all supported scope modifiers faster:

1. `exact match`
2. `starts with`
3. `ends with`
4. `contains`

This design also assumes a one-time truncate-and-repopulate rebuild of the split lookup tables so existing April bulk data benefits from the new fast-search shape.

## Goals

- Route all domain and subdomain discovery searches through `bulk_apex_domain_lookup` and `bulk_subdomain_lookup_v2`.
- Remove result-query dependence on `bulk_hostname_serving` for `domains`, `subdomains`, and `both` discovery scopes.
- Preserve current filter semantics for:
  - include and exclude terms
  - `exact`, `contains`, `starts with`, and `ends with`
  - `addedSince`
  - pagination and sort order
- Improve performance for all scope modifiers by storing precomputed search-friendly values in the split lookup tables.
- Rebuild the current lookup tables cleanly so old and new search data are not mixed.

## Non-Goals

- No change to the request or response contract of `/api/subdomains`.
- No change to the user-facing filter model in the dashboard UI.
- No deletion of `bulk_hostname_serving` as part of this work.
- No redesign of reverse-IP, CNAME, or infrastructure-summary flows in this pass.
- No guarantee that `contains` becomes identical in cost to `exact` or prefix queries; the goal is materially faster and production-usable, not equal-cost search across all modifiers.

## Current State

The codebase already has split lookup tables and transform support for populating them:

- [bulk/transform/src/repository.ts](C:/Users/saymy/Automote%20projects/tech-stack-dashboard/bulk/transform/src/repository.ts)
- [lib/domain-splitter.ts](C:/Users/saymy/Automote%20projects/tech-stack-dashboard/lib/domain-splitter.ts)

The current problem is that the discovery path still depends on richer serving-table scans for result queries, which makes the `Domain & Subdomain Discovery` tab slower than it needs to be for large April-scale data.

The split lookup tables are currently useful as logical search boundaries, but they are not yet designed as full search indexes for all supported modifiers.

## Chosen Approach

Use the existing split-table architecture as the long-term query surface, but upgrade the tables into purpose-built discovery indexes.

This approach has four parts:

1. Add derived search columns to `bulk_apex_domain_lookup` and `bulk_subdomain_lookup_v2`.
2. Add ClickHouse-friendly indexing support for prefix, suffix, and substring search paths.
3. Truncate both split lookup tables before repopulating them from the authoritative bulk transform output.
4. Rewrite discovery queries so `domains`, `subdomains`, and `both` read only from the rebuilt split tables.

This gives the speed benefits of specialized search structures without adding an entirely new third search subsystem to maintain.

## Data Model Design

### Apex-Domain Lookup Table

`bulk_apex_domain_lookup` should continue representing apex-domain-only rows, but it should gain precomputed search-oriented values.

Required logical fields:

- canonical domain value
- normalized domain value for `exact` and `starts with`
- reversed normalized domain value for `ends with`
- a substring-search-friendly text value for `contains`
- existing liveness and update metadata

Recommended behavior:

- `domain` remains the canonical output value
- normalization is done at rebuild time, not per-query
- reversed text is stored once and queried with prefix logic rather than doing suffix scans against the original domain text

### Subdomain Lookup Table

`bulk_subdomain_lookup_v2` should continue representing subdomain rows split into `subdomain` and `parent_domain`, but it should also gain precomputed full-hostname search values.

Required logical fields:

- canonical `subdomain`
- canonical `parent_domain`
- normalized `subdomain`
- normalized `parent_domain`
- normalized full hostname such as `api.example.com`
- reversed normalized full hostname for `ends with`
- optional first-label-friendly value where useful for subdomain-specific matching
- existing liveness and update metadata

Recommended behavior:

- results continue returning the full hostname and apex domain
- normalization happens during rebuild
- query-time `concat(...)` should be minimized or removed from hot search paths where a stored full-hostname value can be used instead

### Search Indexing Strategy

The design should use precomputed values plus ClickHouse indexing where it helps:

- equality and prefix lookups should use the normalized plain-text columns
- suffix lookups should use the reversed-text columns
- substring lookups should use the normalized search text plus a text-oriented skip index such as `ngrambf_v1`

The design intentionally treats `contains` as the hardest path. The goal is to make it faster enough for production use while preserving semantics, not to pretend it is a cheap operation.

## Query Strategy

### Scope Routing

The discovery API should use only the split tables for result queries:

- `domains` scope reads only `tech_stack_bulk.bulk_apex_domain_lookup`
- `subdomains` scope reads only `tech_stack_bulk.bulk_subdomain_lookup_v2`
- `both` scope unions the two result sets with `UNION ALL`

Sorting and pagination should still happen on the final combined result shape.

### Modifier Routing

Each modifier should map to a deliberate search path:

- `exact`
  - equality against normalized domain/full-hostname values
- `starts with`
  - prefix search against normalized domain/full-hostname values
- `ends with`
  - prefix search against reversed normalized values
- `contains`
  - substring search against normalized full text with text-oriented index support

### Parent-Domain Optimization

Subdomain queries should preserve the useful existing optimization where a term that clearly expresses a registrable domain can also constrain `parent_domain` directly.

Examples:

- `example.com` with `ends with` in subdomain scope should narrow on `parent_domain = 'example.com'`
- `example.com` with `contains` in `both` scope can still use `parent_domain` as a narrowing hint for subdomain-side queries

This optimization should remain an accelerator, not a semantic change.

### Added-Since Semantics

`addedSince` should continue to behave as a lower-bound filter, but it should be evaluated against split-table timestamps or rebuild metadata rather than relying on `bulk_hostname_serving`.

The exact date field used in these tables must remain stable and test-covered so the existing filter meaning does not drift.

## Rebuild Strategy

The split lookup tables should be treated as rebuildable indexes, not irreplaceable source data.

### Why Truncate First

The current rows should be truncated before repopulation because keeping mixed old/new rows risks:

- duplicate matches
- inconsistent query behavior
- rows missing new derived search fields
- ambiguous migration state during verification

### Rebuild Source

The rebuild should come from the authoritative bulk transform output for the active bulk snapshot. The implementation may read from validated serving-stage data during rebuild, but the resulting discovery path should not keep depending on `bulk_hostname_serving` for live queries after the migration is complete.

### Operational Sequence

Recommended sequence:

1. Apply additive schema changes for the new search-oriented columns and indexes.
2. Truncate `bulk_apex_domain_lookup`.
3. Truncate `bulk_subdomain_lookup_v2`.
4. Repopulate both tables deterministically from the active bulk dataset.
5. Switch discovery queries fully to the rebuilt split tables.
6. Verify row counts, semantics, and performance before considering the migration complete.

## Testing Strategy

### Repository Query Tests

Update [bulk/api/src/repository.test.ts](C:/Users/saymy/Automote%20projects/tech-stack-dashboard/bulk/api/src/repository.test.ts) so tests prove:

- `domains` scope reads only the apex lookup table
- `subdomains` scope reads only the subdomain lookup table
- `both` scope uses `UNION ALL`
- `exact`, `contains`, `starts with`, and `ends with` all route through split-table-specific logic
- include and exclude terms still work
- `addedSince`, limit, and offset behavior is preserved
- query strings no longer use `bulk_hostname_serving` for discovery

### Transform/Rebuild Tests

Update transform-side tests so they prove:

- the split tables are repopulated with the new search-oriented fields
- truncation and repopulation happen in a controlled order
- generated rows preserve domain-splitting correctness
- suffix and substring helper values are populated deterministically

### Manual Verification

After implementation and rebuild, manual verification should compare:

- `exact match` on a known apex domain
- `starts with` on a common domain prefix
- `ends with` on a full domain suffix like `example.com`
- `contains` on a substring with broad match potential
- `both` scope pagination and sort order

Manual verification should confirm both correctness and noticeable latency improvement against the current behavior.

## Risks

### Rebuild Window

Truncating before repopulating creates a window where discovery data can be empty or incomplete if the rebuild is interrupted.

Mitigation:

- run the truncate-and-repopulate as one deliberate operational sequence
- verify completion before considering the tab healthy
- schedule the rebuild during a low-traffic window on shared or production-like hosts

### Contains Search Still Being the Most Expensive

Even with helper columns and skip indexes, substring search can remain more expensive than equality or prefix lookup.

Mitigation:

- optimize `contains` with normalized search text and text-oriented indexing
- preserve parent-domain narrowing where possible
- verify practical latency on real data rather than assuming theoretical performance

### Schema Drift Between Old and New Rows

If old rows remain in the split tables, search behavior can become inconsistent.

Mitigation:

- truncate before repopulating
- test row-shape assumptions explicitly

## Acceptance Criteria

- The `Domain & Subdomain Discovery` tab no longer uses `bulk_hostname_serving` for result queries.
- `domains`, `subdomains`, and `both` scopes query only `bulk_apex_domain_lookup` and `bulk_subdomain_lookup_v2`.
- The split lookup tables are rebuilt after truncation so existing April data benefits from the new search-oriented schema.
- `exact`, `starts with`, `ends with`, and `contains` all preserve current user-facing semantics.
- `ends with` uses reversed-value search logic rather than broad suffix scans on the original text.
- `contains` is materially faster than the current serving-table-based path on representative data.
- Existing filters for include/exclude, `addedSince`, sort order, limit, and offset remain intact.
- Automated tests prove discovery queries no longer read from `bulk_hostname_serving`.
