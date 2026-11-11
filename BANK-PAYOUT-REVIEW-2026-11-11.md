# Bank payout review — 2026-11-11

> Subsequent SET declaration review confirms KTB regular DPS 2.07 and special 0.60. Its model payout is now 60%. The earlier 77.39% total-DPS calculation below is superseded. See [all-company declaration review](ALL-DIVIDEND-REVIEW-2026-11-11.md).

## Implemented scope

Reviewed FY2025 consolidated basic EPS for seven banks against exact original workbook cells. Values are in THB/share with scale 1, not the thousand-THB scale of the income statement. The new payoutEps field is separate from EPS growth: historical split-adjusted/per-share flags remain unverified. Missing other years remain unknown. No TTM or different-year EPS can fill a fiscal-year payout gap.

The displayed payout is a **model calculation: model DPS / published basic EPS**. It is not labelled the issuer’s reported total cash dividend/net-profit payout. Differences can arise from rounded EPS, buybacks, preference shares and different profit bases. No ratios are forced to equal a published percentage.

| Symbol | FY | DPS used | Basic EPS | Model payout | RI computable |
|---|---:|---:|---:|---:|---|
| SET:BBL | 2025 | 10.000 | 24.1018 | 41.49% | yes |
| SET:KBANK | 2025 | 12.000 | 20.6300 | 58.17% | yes |
| SET:KKP | 2025 | 5.700 | 7.1700 | 79.50% | no — missing ROE |
| SET:KTB | 2025 | 2.670 | 3.4500 | 77.39% | yes |
| SET:SCB | 2025 | 11.280 | 14.1035 | 79.98% | yes |
| SET:TISCO | 2025 | 7.750 | 8.3200 | 93.15% | yes |
| SET:TTB | 2025 | 0.134 | 0.2200 | 60.91% | yes |

## Source and basis boundaries

- KBANK annual report p.4 separately reports regular DPS 12.00 and total 14.00 including 2.00 special. The captured PDF hash is checked at runtime. Live use begins 2026-11-11; historical use begins 2026-11-12. This applies to both quality payout and DDM so they use the same regular DPS. The report itself publishes regular cash payout 57.81% and total 67.43%; the model regular DPS/basic-EPS ratio is 58.17%. These are different denominators, not silently equated. [Official One Report](https://www.kasikornbank.com/en/IR/FinanInfoReports/financialReports/y2025-onereport-en.pdf#page=4).
- KTB fiscal-2025 ordinary DPS 2.67 is corroborated by the FY2025 audited archive notes, section 9.41. Preference dividend 2.8245 is not substituted for ordinary DPS. Special/regular classification of the 2.67 has not been confirmed from an independently captured primary declaration; this row continues to use total fiscal DPS, not a certified recurring dividend. Do not interpret it as a verified sustainable 77.39% cash payout. Further classification review remains required.
- KKP official IR lists FY2025 EPS 7.17 and DPS 5.70 together. [Issuer source](https://ir.kkpfg.com/en/shareholder-information/earnings-per-share-and-dividend-payment).
- TISCO AGM notice reports FY2025 DPS 7.75 and consolidated payout rounded to 93.2%; the model 7.75/8.32 is 93.15%. [Official AGM notice](https://www.tisco.co.th/wp-content/uploads/2026-group-notice-en.pdf).
- SCBX issuer IR reports FY2025 DPS 11.28 and cash payout 80.00%; the workbook basic-EPS model gives 79.98%. [Issuer source](https://investor.scbx.com/en/shareholder-info/dividend-policy-and-payments).
- BBL and TTB retain their existing fiscal-year DPS inputs; the new review verifies the consolidated EPS denominator, not every dividend payment announcement. BBL bank-only payout must not be compared as if it were consolidated. TTB printed EPS 0.22 is rounded, so the model percentage differs from an issuer ratio based on unrounded earnings.

## Validation

Full application tests and syntax/encoding checks passed. Tests cover all seven EPS/payout pairs, no TTM fallback, unchanged EPS-growth exclusion, exact source hashes and explicit KBANK special handling. The local API returns payout evidence (fiscal year, DPS, EPS, source) for all seven banks. RI becomes computable for six; KKP remains excluded from RI because its three-year ROE is unknown. Preset conditions are unchanged. TISCO still fails the payout band; a known high payout is not a data gap.

Reproduction: scripts/verify-bank-payout-eps.py, scripts/verify-statement-cells.py and npm test. Evidence: bank-payout-validation.json.
