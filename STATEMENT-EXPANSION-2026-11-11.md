# Expanded historical statement audit — 2026-11-11

Numerical coverage: **7 issuers, 70 issuer-years (2016–2025)**. The register holds **86 reviewed snapshots**, including **16 later comparative snapshots**.

Original SEC archive workbooks were read without modifying them. Every model input was checked against its exact worksheet cell (including explicit unit multipliers and documented EBIT calculations). Issuer names, consolidated/current-year headers, THB versus USD columns, fiscal periods, file hashes and balance-sheet totals were checked. There are 828 model input checks across the 86 snapshots. Reported EPS remains excluded from scoring pending comparable share-basis verification.

| Issuer | Original current-year snapshots | Later comparative snapshots | SEC register |
|---|---:|---:|---|
| SET:ADVANC | 10 | 0 | [Official register](https://market.sec.or.th/public/idisc/en/ViewMore/fs-norm?uniqueIDReference=0000000807&searchSymbol=ADVANC&dateFrom=20150101&dateTo=20261111) |
| SET:BCP | 10 | 1 | [Official register](https://market.sec.or.th/public/idisc/en/ViewMore/fs-norm?uniqueIDReference=0000001385&searchSymbol=BCP&dateFrom=20150101&dateTo=20261111) |
| SET:HMPRO | 10 | 2 | [Official register](https://market.sec.or.th/public/idisc/en/ViewMore/fs-norm?uniqueIDReference=0000003191&searchSymbol=HMPRO&dateFrom=20150101&dateTo=20261111) |
| SET:KCE | 10 | 2 | [Official register](https://market.sec.or.th/public/idisc/en/ViewMore/fs-norm?uniqueIDReference=0000000065&searchSymbol=KCE&dateFrom=20150101&dateTo=20261111) |
| SET:MINT | 10 | 4 | [Official register](https://market.sec.or.th/public/idisc/en/ViewMore/fs-norm?uniqueIDReference=0000000530&searchSymbol=MINT&dateFrom=20150101&dateTo=20261111) |
| SET:PTT | 10 | 4 | [Official register](https://market.sec.or.th/public/idisc/en/ViewMore/fs-norm?uniqueIDReference=0000001074&searchSymbol=PTT&dateFrom=20150101&dateTo=20261111) |
| SET:PTTEP | 10 | 3 | [Official register](https://market.sec.or.th/public/idisc/en/ViewMore/fs-norm?uniqueIDReference=0000001153&searchSymbol=PTTEP&dateFrom=20150101&dateTo=20261111) |

## Confirmed findings

- PTT 2022: the provider history stores THB 122,099,666,052 as net profit. The original statement identifies that as total group profit, while parent-attributable profit is THB 91,174,857,528. The reviewed backtest uses the latter. [SEC original](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202302/23016208.zip), PL_Accum G27/G30.
- BCP 2019: original parent-attributable profit is THB 1,731,572,179; provider history stores total group profit of THB 2,488,492,891. [SEC original](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202002/20016555.zip), PL-10-11 E35/E32.
- BCP 2019 equity initially appeared to differ from the following comparative. Checking the captions showed a subtotal excluding subordinated perpetual debentures versus total parent equity including them. The common parent-equity basis is THB 51,603,929,397. This is **not counted as a revision event**. The ROE denominator includes this parent equity; it is not a claim to match an ordinary-equity-adjusted published ROE.
- HMPRO, KCE, MINT and PTTEP reported total revenue/income can differ from the provider's narrower sales/operating-revenue field. Those differences are recorded as differences of definition, not automatically classified as source errors. Model revenue basis is stored per snapshot; historical/live scoring equivalence remains a separate task.
- PTTEP statements contain both USD and THB. The THB column is selected explicitly; thousand-baht periods are multiplied by 1,000. Cash flow is read from the final net-operating-cash row, not an earlier cash-generated subtotal.

## Later comparative figures

A changed comparative is evidence that a later report presents a different figure. It can reflect restatement, reclassification, discontinued operations or another reporting change; it does not by itself establish an error or the earliest amendment date. Each changed period is retained in two snapshots with separate conservative availability bounds. Earlier rebalances cannot use the later snapshot.

| Issuer | Fiscal year affected | Found in report | Conservative usable date | Changed model fields |
|---|---:|---:|---|---|
| SET:PTT | 2023 | [2024](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202502/0646FIN200220251847550883E.zip) | 2025-03-14 | revenue |
| SET:PTT | 2021 | [2022](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202302/23016208.zip) | 2023-03-16 | assets, totalDebt |
| SET:PTT | 2019 | [2020](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202102/21016270.zip) | 2021-03-16 | assets, totalDebt |
| SET:PTT | 2018 | [2019](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202002/20016564.zip) | 2020-03-13 | netIncome, equity, assets, totalDebt, totalEquity, operatingCashFlow, ebit |
| SET:HMPRO | 2019 | [2020](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202102/21020842.zip) | 2021-03-18 | revenue, operatingCashFlow |
| SET:HMPRO | 2016 | [2017](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201802/18018860.zip) | 2018-04-03 | operatingCashFlow |
| SET:KCE | 2020 | [2021](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202202/22012701.zip) | 2022-03-23 | operatingCashFlow |
| SET:KCE | 2019 | [2020](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202102/21015303.zip) | 2021-03-26 | operatingCashFlow |
| SET:BCP | 2017 | [2018](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201902/19015289.zip) | 2019-03-13 | netIncome, equity, assets, totalEquity, ebit |
| SET:MINT | 2022 | [2023](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202402/0128FIN080220241016270143E.zip) | 2024-03-28 | revenue |
| SET:MINT | 2021 | [2022](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202302/23019944.zip) | 2023-03-24 | operatingCashFlow |
| SET:MINT | 2018 | [2019](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202002/20021496.zip) | 2020-04-16 | netIncome, revenue, equity, assets, totalDebt, totalEquity, ebit |
| SET:MINT | 2017 | [2018](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201902/19018800.zip) | 2019-03-23 | assets, totalDebt, totalEquity, operatingCashFlow |
| SET:PTTEP | 2022 | [2023](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202402/0355FIN120220241825320598E.zip) | 2024-03-02 | operatingCashFlow |
| SET:PTTEP | 2019 | [2020](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202102/21015148.zip) | 2021-03-10 | assets, totalDebt, operatingCashFlow |
| SET:PTTEP | 2018 | [2019](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202002/20015475.zip) | 2020-03-14 | equity, assets, totalDebt, totalEquity |

## Source and date handling

- SEC annual statement registers were checked for 41 issuers. Identity mismatches returned during concurrent queries were rejected; the final collection ran sequentially and had 0 request/identity errors. Two registers did not return consolidated annual records under the selected criteria; this is not a claim that those issuers have no statements.
- Multiple source links for a year are not labelled amendments merely because there is more than one link. XBRL/IPO and original archive formats can coexist.
- Conservative usable dates are the day after SEC annual-report receipt evidence. They do not certify the earliest release or earliest correction of a particular archived file. Earliest-version and earliest-amendment flags remain false.
- Later comparatives are applied from the later report's conservative usable date. Where the opening balance two years back is not provided, ROE/ROA requiring that denominator remains unknown rather than borrowing an unverified value.
- Runtime loading rechecks workbook hashes; a missing or altered workbook is excluded. Provider data cannot fill a gap in reviewed mode.
- A refresh can detect content changes at the same download URL. Old archive bytes and reviewed snapshots are retained. Changed bytes get a new content-addressed file and cannot be backdated before the day after the new observation. The observation date is explicitly not an asserted release date.
- Same-date conflicting snapshots are excluded; selection is independent of input ordering.

## Validation and remaining work

Checks passed for all original-cell inputs, source hashes and balance reconciliation, real and synthetic revision-date cutoffs, reverse-order version selection, conflicting same-date records, malformed dates, share-unit exclusion, provider contamination and missing/stale statements. The full application test suite and syntax/encoding checks also passed.

Numerical review is still limited to these seven issuers. Banks, other issuers, EPS/corporate-action adjustments, historical universe membership, original historical file-byte identity and exact first-publication/amendment timestamps remain unverified. Automatic universe-wide rule rankings remain unavailable below ten reviewed issuers. This threshold is a product guard, not statistical validation. Backtest results remain research estimates.
