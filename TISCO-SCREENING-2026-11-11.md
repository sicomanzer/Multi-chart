# TISCO screening explanation — 2026-11-11

TISCO's 100 score is the fraction of weighted checks that can be evaluated,
not a declaration that every mandatory preset check passed.

The FY2024 reviewed workbook `data/statement-evidence/TISCO-2024-c1969ba0e602.xls`
contains consolidated changes in equity, sheet `conso`, row 15 labelled
`Balance as at 1 January 2023`. Headers W11:W14 identify parent-attributable
equity; W15 is 42,787,386 thousand THB. This supplies opening parent equity
for the FY2023 later-comparative snapshot, from that snapshot's existing usable
date (2025-03-22). Its evidence cell and scale are retained in statement-versions.
The same workbook does not supply a third consolidated balance-sheet column
for opening FY2023 assets. No opening assets are borrowed from an older version.

Local API after the correction reports TISCO three-year ROE 16.2297911795%,
score 100 and applicable data coverage 85.7142857143%. Quality and income
presets remain excluded with `unknown:roaLevel`; the dividend preset remains
excluded with `unknown:payoutBand`. Mandatory criteria were not relaxed.

The screener table now displays data coverage next to scores, identifies the
bank model and prints the rejection reason in the stock row. Excluded rows
retain sufficient contrast for the reason to be read without hovering.

Validation: full application tests, syntax/encoding checks, 165 snapshots and
1,516 original workbook input checks passed. A regression verifies the new
TISCO opening equity/ROE while retaining unknown opening assets/ROA.
