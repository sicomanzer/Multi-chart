# Free fundamental sources

The screener does not require a new subscription or API key. This fallback does
not claim to replace a licensed real-time market-data feed.

## Selection policy

1. Prefer the SET-published snapshot. Retain original trading and financial
   dates. A failed refresh may use the existing cache for up to seven calendar
   days from the trading date, explicitly marked as cached/stale.
2. If that snapshot is absent or older, prefer locally reviewed SEC/issuer
   statement versions for quality scoring. Only versions published by the
   screening date are eligible. The latest financial period must be no older
   than 550 days; older eligible periods remain available for history checks.
   The existing loader verifies evidence hashes before selecting versions.
3. Otherwise retain provider statement calculations with alternative-source
   labels. These are not independently certified issuer figures.

Headline fallback P/E and P/BV use provider TTM EPS and latest book value per
share with known financial dates no older than 550 days. Missing, nonpositive
or future-dated inputs produce no multiple. Negative/missing TTM EPS is never
replaced with an older profitable annual EPS. Calculation inputs and their
dates are returned in `ratioInputs`. Yield uses the model's recurring dividend
divided by price, explicitly distinct from the SET-published dividend yield.
Headline D/E stays unavailable: provider interest-bearing debt must not be
substituted for the SET liabilities/equity definition.

## Provenance and limits

The table marks fallback rows; the detail view identifies ratio source, scoring
source, dates and reviewed document links. The all-company consistency audit
records `alternative-source` as a review issue, not a fabricated data error.

Existing feeds remain in place: Yahoo for price/history and provider statements,
Finnomena for secondary historical context, SET public pages when accessible,
and captured SEC/issuer evidence. Current reviewed statement coverage is fourteen
issuers; this change does not certify every listed company or automatically
fetch a complete SEC financial dataset. Public endpoints may be delayed, rate
limited or changed. No API entitlement or redistribution licence is implied.

The existing SET cache is in memory with a bundled seed snapshot; it is not a
durable full-universe cache across restarts. Original dates are never advanced
to make an old record appear current.

## Validation

`scripts/verify-free-data-fallback.mjs` covers SET priority, expiry, future
dates, publication cutoff, reviewed-source selection, missing dates, negative
EPS and consistent current-multiple calculations. It runs in `npm test`.
The fallback is simulated without changing live providers or user watchlists.
