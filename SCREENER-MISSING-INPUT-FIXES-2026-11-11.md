# Missing-input fixes — 2026-11-11

Resolved the first two findings of the complete 110-symbol screening audit.

- Residual Income validates finite numeric book value, ROE, payout and discount
  rate before any conversion. Missing/null/empty/boolean inputs do not become
  zero. Missing payout is no longer implicitly assumed to be zero. An explicitly
  measured zero payout or ROE remains valid. Missing-input results have no fair
  value or MOS and list the missing inputs in the API.
- An empty usable scoring-year series produces an unknown row with score null,
  zero data coverage and `no-annual-statements`. It cannot pass any preset,
  including `all`. Quote/TTM/dividend data alone cannot produce a quality score.
  A business with usable statements can still legitimately receive score zero.
- Thai/English explanations describe missing annual statements and required
  Residual Income inputs. Existing screening thresholds were not changed.

Validation: syntax/encoding checks and all application test suites passed.
Regression tests cover missing RI inputs, explicit measured zeros, unchanged
known-input valuation, missing annual statements and preset rejection.

After restarting the local preview, all 110 symbols were rechecked through the
API with zero request errors. BANPU now has score null, pass false and
`no-annual-statements`. All seven banks with unavailable payout now have
Residual Income disabled; KKP also explicitly lists missing ROE. Scores for the
other 109 symbols were unchanged from the captured baseline. Evidence is in
`screener-missing-input-validation.json`; the original baseline is retained
locally in `screener-before-missing-input-fix.local`.

This correction does not supply missing financial statements or certify EPS
share bases. KKP opening balances, bank payout data and MC EPS growth remain
separate source-review work. It does not claim that every company's underlying
financial figures have been reconciled to official filings.
