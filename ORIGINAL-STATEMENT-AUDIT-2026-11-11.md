# Historical statement audit — 2026-11-11

This is the initial three-year pilot. See [the subsequent expansion](STATEMENT-EXPANSION-2026-11-11.md) for current coverage.

## What was checked

PTT consolidated audited annual statements for 2016, 2017 and 2018 were downloaded from SEC's statement register. Current-year columns were read from the original attached workbooks, keeping separate-company and comparative columns out of the current-year extraction. Units are baht. Assets reconcile to liabilities plus total equity for all three years.

| Fiscal year | Official statement archive | Original basic EPS | Existing provider EPS |
|---|---|---:|---:|
| 2016 | [SEC archive](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201702/17011197.zip) | 32.68 | 3.32 |
| 2017 | [SEC archive](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201802/18012989.zip) | 46.74 | 4.98 |
| 2018 | [SEC archive](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201902/19015405.zip) | 4.15 | 4.06 |

PTT's 2018 annual report, printed page 003 / PDF page 5, records the April 24, 2018 par change from THB 10 to THB 1 and presents prior-year per-share highlights on a split-adjusted basis. Raw original EPS across these years must therefore not be used directly as a comparable growth series. Even after dividing pre-split EPS by ten, the provider values do not exactly reconcile. The reason for the remaining EPS discrepancy is not established; it is not evidence by itself of a historical restatement.

Parent-attributable profit, total assets, parent equity and operating cash flow match the provider exactly in all three reviewed years. Sales differ by THB 39, THB 2,373 and THB 4,406 respectively, consistent with different rounding precision. Agreement in this sample does not certify other issuers or years. Published ROA and debt ratios also require a definition check: PTT's annual report uses interest-bearing debt for its highlighted D/E, whereas the SEC workbook provides total liabilities and total equity separately. Those definitions must not be substituted for one another.

## Implemented behavior

- Default backtest mode now reads only reviewed official statement snapshots. A provider row cannot fill a missing field or year in that mode.
- The snapshot register stores source URLs, SHA-256 workbook hashes, units, exact sheet/cell coordinates and conservative usable dates. A later known revision can only replace a fiscal-year snapshot once its own availability date is reached.
- Conservative availability uses the next day after the corresponding SEC annual-report receipt. This is not the earliest financial-results release date.
- Model ratios are derived from reviewed statement inputs. ROE uses parent profit and average parent equity; ROA uses EBIT and average total assets; D/E uses total liabilities and total equity. They are model ratios, not a claim to reproduce every published SET ratio.
- EPS is withheld from model scoring until a separately verified comparable share basis is available. It remains stored as a reported audit value.
- At least three consecutive recent fiscal years are required; the latest statement must not be more than 550 days old. If a newer annual report is known to be available but its values have not been reviewed, that observation is excluded. Missing later years do not permit indefinite replay of the sample.
- Provider history remains available in explicitly approximate modes. Automatic universe-wide rule rankings remain unavailable with fewer than ten reviewed issuers; this is a product guard, not a statistical validation threshold.

## Coverage and remaining limitations

Reviewed numerical statement coverage is **one issuer / three issuer-years**. This is distinct from the **41 issuers / 413 receipt dates** in the availability register. Other statement values are excluded in the reviewed mode until checked. The remaining symbols and years have not been numerically audited in this pass.

The archived SEC downloads were retrieved today. Their source and present file hashes are recorded; historical byte-for-byte identity and earliest filing-version status are not certified. Original audited attachment provenance does not establish that later corrections never occurred. Historical universe membership, corporate actions, per-share adjustment history and full live-SET scoring equivalence remain unverified. Backtest results remain research estimates.

## Validation

Regression checks cover source hashes, units, fiscal-year and date boundaries, future-revision exclusion, complete-snapshot selection without provider contamination, missing evidence, EPS exclusion and stale statement rejection. The full existing test suite and syntax/encoding checks passed.
