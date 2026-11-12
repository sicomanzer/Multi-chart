# Stable business classification and model eligibility

The local/Render KTC discrepancy was caused by runtime Yahoo profile availability.
The same statements produced scores 78 and 69 because the industrial debt and
cash-flow rules were excluded on only one server. Income preset minimum: 70.

SET stock identities now come from `data/business-classification.json`: 110
dated records captured from SET company-highlight trading statistics on
2026-11-11, including all 100 symbols in the bundled SET100 universe. Each
record retains its source URL, sector, industry, trading date and observation
time. This is a reviewed snapshot, not a promise that corporate classifications
never change. Updating it requires review and a deployment to both environments.

The issuer's overview and SET factsheet independently confirm KTC as Finance &
Securities, operating credit card/personal lending:

- https://www.ktc.co.th/en/overviews
- https://www.set.or.th/en/market/product/stock/quote/ktc/factsheet

Policy:

- Seven explicitly supported commercial-bank groups retain the existing bank
  model and verified capital/NPL gates.
- Other BANK-sector entities (e.g. TCAP), FIN companies and INSUR companies do
  not inherit the commercial-bank model or receive an industrial-company score.
  Their score and valuations remain unavailable with the reason
  `financial-framework-not-supported`. A dedicated validated model is still
  required. This intentionally withdraws the earlier unvalidated KTC score 78;
  it does not certify Render's score 69 or tune the cutoff to admit KTC.
- Reviewed ordinary companies use the existing general model.
- REITs retain the unsupported-framework status.
- Unreviewed SET symbols remain unknown instead of becoming nonfinancial when
  an upstream request fails.
- Runtime Yahoo sector flags and SET account-form hints cannot override the
  reviewed identity. Live prices and financial periods may still legitimately
  differ; determinism assumes the same code, snapshot and input data.

The detail view shows identity/source/date and the table explains unsupported
models. `verify-business-classification.mjs` checks all 110 identities, SET100
coverage, distinct financial groups, and identical KTC rows for provider flags
true/false/missing. All normal suites also run. Production is unchanged until
the fix is published and deployed; local verification alone does not certify
that Render has loaded the new snapshot.
