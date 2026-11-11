# Bank statement and screening model audit — 2026-11-11

> Updated status: risk disclosures now cover 64 issuer-years, with 49 complete eligible input sets and 15 explicit incomplete sets. The original risk-unavailable section below describes the earlier audit stage; see [the completed historical risk review](BANK-RISK-HISTORY-2026-11-11.md) for current coverage and exclusions.


This describes the initial model. See [the subsequent FY2025 risk source review](BANK-RISK-SOURCES-2026-11-11.md) for the current capital/NPL/coverage inputs.

## Delivered coverage

The reviewed register now includes **64 original bank/group issuer-years**, plus **15 later comparative snapshots**, for KBANK, BBL, KTB, TTB, KKP, TISCO and SCB X. Combined with the industrial review, coverage is **134 original issuer-years across 14 issuers**, plus **31 comparative snapshots**, or **165 snapshots in total**.

| Issuer | Original fiscal years | Years |
|---|---|---:|
| KBANK | 2016–2025 | 10 |
| BBL | 2016–2025 | 10 |
| KTB | 2016–2025 | 10 |
| TTB / same-issuer TMB archives | 2016–2025 | 10 |
| KKP / same-issuer Kiatnakin archives | 2016–2025 | 10 |
| TISCO Financial Group | 2016–2025 | 10 |
| SCB X | 2022–2025 | 4 |

No standalone TISCO Bank history was substituted for TISCO Financial Group, and no pre-2022 predecessor SCB history was imported into SCB X. TTB mergers and other corporate restructurings remain relevant comparability limitations; same-issuer archival continuity does not imply unchanged business composition.

## Source review and definitions

All added numerical model inputs were re-read from original SEC XLS/XLSX attachments, with exact sheet/cell coordinates, original file hashes, issuer identity, consolidated/current-year headers, THB units and balance-sheet reconciliation. Most bank attachments report thousand baht; values are explicitly converted to baht. The independent workbook check passes **1,515 model inputs across all 165 snapshots**.

The model separates the two profit concepts:

- ROE uses parent-attributable profit / average parent equity.
- Bank ROA uses total consolidated profit after tax / average consolidated assets. It does not reuse SET's EBIT-based headline ROA.
- Operating income uses the labelled consolidated total operating income, after interest funding costs and including the reported non-interest income. It is not gross interest revenue or industrial sales.
- Industrial EBIT and operating-cash-flow model inputs are left null for banks. Deposit and loan cash movements are not treated as evidence of industrial free cash flow.

BOT's peer-group statistics explicitly describe ROA as net profit / average net assets: [official definition](https://app.bot.or.th/BTWS_STAT/statistics/BOTWEBSTAT.aspx?language=ENG&reportID=983). This supports the bank profitability basis; it does not certify that every consolidated holding-group ratio equals a bank-only regulatory ratio.

Live screener profitability checks use the reviewed bank statement series as well as the reviewed-mode backtest. Chart headline SET ratios retain their source and definition. The scorecard explains the difference.

## Screening assumptions

These are explicit product research assumptions, **not BOT regulatory requirements**:

| Test | Model assumption |
|---|---|
| Average ROE, three years | At least 10% |
| ROE consistency | At least three known years reaching 10% |
| Average net-profit ROA, three years | At least 1% |
| Total capital adequacy | At least 15% |
| Gross NPL ratio | At most 3% |
| NPL coverage | At least 150% |

Industrial NPM, D/E, interest coverage and cash-flow checks are not applicable to this bank model. EPS growth and revenue-growth tests are deferred until share units and merger/restructuring comparability are verified. Non-bank lenders such as AEONTS/KTC and insurers do not inherit this model just because their sector is financial.

## What remains unavailable

Verified same-period consolidated capital adequacy, gross NPL and NPL coverage have **not** been populated in this pass. They are unknown, carry no earned points and reduce data coverage. A bank cannot pass a preset or be selected into the backtest portfolio until those risk checks have verified evidence and pass. Bank observations can still appear in the historical universe/benchmark; that does not mean the bank qualified for selection.

Future risk inputs must be verified, match the fiscal year, have the consolidated basis and be usable by the valuation date. Bank-only, stale-year or future evidence is rejected. A group-wide bank holding-company statement must not silently receive a licensed bank's risk ratio or BOT's sector aggregate.

This is deliberately a partial bank assessment until risk disclosures are reviewed. The UI displays this status; it does not claim a complete credit-risk assessment. Scores under different sector models are not directly comparable, and historical rule comparisons are separated by model. Industrial rule-edge estimates are not attached to bank checks.

## Timing and revisions

The new bank comparative snapshots use the later report's conservative usable date, following the existing SEC annual-report receipt policy. They are not backdated to the original fiscal year. Exact first-publication dates, first-amendment dates, historical byte-for-byte file identity and corporate actions remain uncertified. Where a report explicitly supplies a third consolidated column for 1 January of the comparative year, that column is used as the comparative's opening balance, with its own cell evidence. Otherwise unknown opening balances stay unknown rather than borrowing a potentially unrevised denominator.

## Validation

All original-cell checks, file hashes and balance-sheet reconciliations passed. Automated tests cover bank versus industrial thresholds, missing/failed risk gates, period and consolidation-basis mismatches, future evidence, model-separated historical rule comparisons, exclusion of financial cash-flow tests, reviewed bank ROA inputs and the SCB X history boundary. The full application test suite and syntax/encoding checks passed.
