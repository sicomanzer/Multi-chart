# Bank risk history review — 2026-11-11

Reviewed 64 issuer-years: six issuers FY2016–2025 and SCBX FY2022–2025. The 110-document source manifest retains initial and later releases. Only the latest captured annual release for each historical issuer-year was numerically reviewed and promoted; earlier unreviewed releases are not assumed equivalent.

## Coverage

| Issuer | Reviewed issuer-years | Complete eligible input sets* |
|---|---:|---:|
| SET:KBANK | 10 | 10 |
| SET:BBL | 10 | 10 |
| SET:KTB | 10 | 10 |
| SET:TTB | 10 | 4 |
| SET:KKP | 10 | 6 |
| SET:TISCO | 10 | 5 |
| SET:SCB | 4 | 4 |

*Completeness describes source/scope/status eligibility, not a passed financial threshold. This inventory uses a cutoff of 2026-12-01 to include TISCO FY2025 capital after its preserved 2026-11-12 historical availability date; the running backtest always applies its actual entry date.

Verified 190 reported values against original PDF bytes, page anchors, percentage units and fiscal periods. 49 issuer-years have all three eligible inputs; 15 have at least one blocked or absent input. 13 reported values are excluded and 2 values remain absent.

## Explicit exclusions

- TTB FY2016–2019 capital: the source tables explicitly state bank-only. The FY2019 consolidated estimate is not substituted for an actual consolidated value.
- KKP FY2016–2019 capital: reported regulatory scope is not sufficiently reconciled to group capital. The disclosed numbers remain visible as evidence, but cannot pass the group-capital check.
- TISCO FY2016–2019 capital: bank-only ratios are excluded. FY2020–2023 Financial Group BIS ratios were checked against rendered tables and are eligible. FY2024 explicitly marks the capital table as projected, so it is excluded.
- TTB FY2020–2021 coverage: the reviewed MD&A contains ECL and NPL amounts but no explicitly reported consolidated coverage ratio was verified. The system does not silently derive a replacement ratio.

## Date and model rules

- Each historical value comes from the current-year column of its own annual report. No FY2025 value fills an older year, and no later comparative is silently backdated.
- A captured SEC register row binds each PDF URL to its publication date. Usage begins the next calendar day. Latest reviewed releases are conservative bounds, not certified earliest release dates.
- Captured files can have changed before collection. Hashes certify the retained bytes, not their byte-for-byte existence on the historical announcement day. Backtest results remain research estimates.
- TFRS9 adoption in 2020 and mergers change some definitions. KKP uses its explicitly labelled banking-portfolio profile and retains separate POCI definitions; it is not labelled a uniform consolidated IFRS credit-risk ratio.
- Missing, bank-only, unresolved, projected, future and conflicting inputs cannot qualify for a bank preset. Known values above/below thresholds fail rather than becoming unknown.

## Reviewed source inventory

CAR / NPL / coverage in percentage points. Exclusions are shown even though their reported source values are retained.

| Issuer | FY | CAR | NPL | Coverage | Usable from (MD&A) | Blocked inputs | Source |
|---|---:|---:|---:|---:|---|---|---|
| SET:BBL | 2016 | 18.32 | 3.2 | 173.6 | 2017-02-24 | — | [PDF p.6](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201702/17014168.pdf#page=6) |
| SET:BBL | 2017 | 18.17 | 3.9 | 160.2 | 2018-02-23 | — | [PDF p.6](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201802/18014616.pdf#page=6) |
| SET:BBL | 2018 | 17.96 | 3.4 | 190.9 | 2019-02-23 | — | [PDF p.6](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201902/19015978.pdf#page=6) |
| SET:BBL | 2019 | 20.04 | 3.4 | 220.2 | 2020-02-28 | — | [PDF p.8](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202002/20022453.pdf#page=8) |
| SET:BBL | 2020 | 18.34 | 3.9 | 186.8 | 2021-02-24 | — | [PDF p.7](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202102/21019289.pdf#page=7) |
| SET:BBL | 2021 | 19.57 | 3.2 | 225.8 | 2022-02-25 | — | [PDF p.7](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202202/22021947.pdf#page=7) |
| SET:BBL | 2022 | 19.13 | 3.1 | 260.8 | 2023-02-24 | — | [PDF p.8](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202302/23020938.pdf#page=8) |
| SET:BBL | 2023 | 19.57 | 2.7 | 314.7 | 2024-02-23 | — | [PDF p.8](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202402/0001NWS220220241909130126E.pdf#page=8) |
| SET:BBL | 2024 | 20.35 | 2.7 | 334.3 | 2025-02-21 | — | [PDF p.7](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202502/0001NWS200220251729230821E.pdf#page=7) |
| SET:BBL | 2025 | 21.78 | 3.0 | 324.1 | 2026-02-27 | — | [PDF p.16](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202602/0001NWS260220261714037810E.pdf#page=16) |
| SET:KBANK | 2016 | 18.84 | 3.32 | 130.92 | 2017-02-24 | — | [PDF p.37](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201702/17013553.pdf#page=37) |
| SET:KBANK | 2017 | 17.96 | 3.30 | 148.45 | 2018-02-23 | — | [PDF p.42](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201802/18014597.pdf#page=42) |
| SET:KBANK | 2018 | 18.32 | 3.34 | 160.60 | 2019-03-01 | — | [PDF p.40](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201902/19021674.pdf#page=40) |
| SET:KBANK | 2019 | 19.62 | 3.65 | 148.60 | 2020-02-28 | — | [PDF p.43](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202002/20022107.pdf#page=43) |
| SET:KBANK | 2020 | 18.80 | 3.93 | 149.19 | 2021-02-26 | — | [PDF p.53](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202102/21022357.pdf#page=53) |
| SET:KBANK | 2021 | 18.77 | 3.76 | 159.08 | 2022-02-25 | — | [PDF p.51](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202202/22021592.pdf#page=51) |
| SET:KBANK | 2022 | 18.81 | 3.19 | 154.26 | 2023-02-24 | — | [PDF p.57](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202302/23021196.pdf#page=57) |
| SET:KBANK | 2023 | 19.41 | 3.19 | 152.23 | 2024-03-01 | — | [PDF p.62](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202402/0016NWS290220242127560440E.pdf#page=62) |
| SET:KBANK | 2024 | 20.25 | 3.18 | 153.27 | 2025-02-28 | — | [PDF p.47](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202502/0016NWS270220251904570320E.pdf#page=47) |
| SET:KBANK | 2025 | 20.35 | 3.20 | 162.75 | 2026-02-27 | — | [PDF p.48](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202602/0016NWS260220262106107970E.pdf#page=48) |
| SET:KKP | 2016 | 18.53 | 5.6 | 110.1 | 2017-02-24 | capitalAdequacy: scope-unresolved | [PDF p.2](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201702/17013412.pdf#page=2) |
| SET:KKP | 2017 | 16.45 | 5.0 | 109.8 | 2018-02-23 | capitalAdequacy: scope-unresolved | [PDF p.2](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201802/18014463.pdf#page=2) |
| SET:KKP | 2018 | 16.29 | 4.1 | 114.8 | 2019-02-22 | capitalAdequacy: scope-unresolved | [PDF p.14](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201902/19014878.pdf#page=14) |
| SET:KKP | 2019 | 16.60 | 4.0 | 111.2 | 2020-02-28 | capitalAdequacy: scope-unresolved | [PDF p.13](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202002/20021590.pdf#page=13) |
| SET:KKP | 2020 | 18.28 | 3.2 | 170.9 | 2021-02-26 | — | [PDF p.15](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202102/21021750.pdf#page=15) |
| SET:KKP | 2021 | 17.35 | 3.3 | 175.1 | 2022-02-25 | — | [PDF p.13](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202202/22021227.pdf#page=13) |
| SET:KKP | 2022 | 16.63 | 3.4 | 154.4 | 2023-02-24 | — | [PDF p.13](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202302/23020208.pdf#page=13) |
| SET:KKP | 2023 | 16.61 | 3.3 | 164.6 | 2024-02-23 | — | [PDF p.14](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202402/0121NWS220220241237110481E.pdf#page=14) |
| SET:KKP | 2024 | 17.35 | 4.3 | 134.2 | 2025-02-21 | — | [PDF p.13](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202502/0121NWS200220251236320381E.pdf#page=13) |
| SET:KKP | 2025 | 17.36 | 4.4 | 137.2 | 2026-02-25 | — | [PDF p.12](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202602/0121NWS240220261247230190E.pdf#page=12) |
| SET:KTB | 2016 | 16.60 | 3.97 | 121.57 | 2017-03-01 | — | [PDF p.12](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201702/17018435.pdf#page=12) |
| SET:KTB | 2017 | 17.20 | 4.19 | 121.71 | 2018-03-01 | — | [PDF p.13](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201802/18020771.pdf#page=13) |
| SET:KTB | 2018 | 18.21 | 4.53 | 125.74 | 2019-03-01 | — | [PDF p.12](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201902/19021796.pdf#page=12) |
| SET:KTB | 2019 | 19.01 | 4.33 | 131.76 | 2020-02-29 | — | [PDF p.13](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202002/20023514.pdf#page=13) |
| SET:KTB | 2020 | 19.11 | 3.81 | 147.3 | 2021-03-02 | — | [PDF p.14](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202103/21024588.pdf#page=14) |
| SET:KTB | 2021 | 20.12 | 3.50 | 168.8 | 2022-02-26 | — | [PDF p.13](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202202/22023331.pdf#page=13) |
| SET:KTB | 2022 | 19.80 | 3.26 | 179.7 | 2023-02-23 | — | [PDF p.15](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202302/23019654.pdf#page=15) |
| SET:KTB | 2023 | 20.71 | 3.08 | 181.3 | 2024-03-01 | — | [PDF p.15](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202402/0150NWS290220241245580463E.pdf#page=15) |
| SET:KTB | 2024 | 21.42 | 2.99 | 188.6 | 2025-02-22 | — | [PDF p.16](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202502/0150NWS210220251730360695E.pdf#page=16) |
| SET:KTB | 2025 | 22.12 | 2.90 | 203.6 | 2026-02-26 | — | [PDF p.14](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202602/0150NWS250220261953089120E.pdf#page=14) |
| SET:SCB | 2022 | 18.9 | 3.34 | 159.7 | 2023-02-22 | — | [PDF p.20](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202302/23018820.pdf#page=20) |
| SET:SCB | 2023 | 18.8 | 3.44 | 159.9 | 2024-02-21 | — | [PDF p.21](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202402/1706NWS200220241758280204E.pdf#page=21) |
| SET:SCB | 2024 | 18.9 | 3.37 | 158.0 | 2025-02-20 | — | [PDF p.23](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202502/1706NWS190220251231570495E.pdf#page=23) |
| SET:SCB | 2025 | 18.9 | 3.29 | 160.8 | 2026-02-20 | — | [PDF p.20](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202602/1706NWS190220261240326960E.pdf#page=20) |
| SET:TISCO | 2016 | 19.59 | 2.54 | 139.8 | 2017-02-24 | capitalAdequacy: scope-unresolved | [PDF p.5](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201702/17013386.pdf#page=5) |
| SET:TISCO | 2017 | 20.72 | 2.32 | 196.5 | 2018-02-23 | capitalAdequacy: scope-unresolved | [PDF p.6](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201802/18014585.pdf#page=6) |
| SET:TISCO | 2018 | 22.91 | 2.86 | 169.8 | 2019-02-26 | capitalAdequacy: scope-unresolved | [PDF p.9](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201902/19017388.pdf#page=9) |
| SET:TISCO | 2019 | 22.10 | 2.40 | 183.7 | 2020-02-21 | capitalAdequacy: scope-unresolved | [PDF p.9](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202002/20016409.pdf#page=9) |
| SET:TISCO | 2020 | 21.9 | 2.50 | 210.5 | 2021-02-20 | — | [PDF p.11](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202102/21016908.pdf#page=11) |
| SET:TISCO | 2021 | 23.2 | 2.4 | 236.8 | 2022-02-22 | — | [PDF p.11](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202202/22017899.pdf#page=11) |
| SET:TISCO | 2022 | 20.6 | 2.09 | 258.8 | 2023-02-24 | — | [PDF p.10](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202302/23020178.pdf#page=10) |
| SET:TISCO | 2023 | 19.51 | 2.22 | 189.9 | 2024-02-29 | — | [PDF p.11](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202402/0999NWS280220241705250884E.pdf#page=11) |
| SET:TISCO | 2024 | 18.6 | 2.35 | 155.3 | 2025-02-28 | capitalAdequacy: status-not-eligible | [PDF p.12](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202502/0999NWS270220250819030723E.pdf#page=12) |
| SET:TISCO | 2025 | 18.97 | 2.28 | 172.1 | 2026-02-28 | — | [PDF p.12](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202602/0999NWS270220261232398740E.pdf#page=12) |
| SET:TTB | 2016 | 18.1 | 2.53 | 143 | 2017-02-16 | capitalAdequacy: scope-unresolved | [PDF p.11](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201702/17010509.pdf#page=11) |
| SET:TTB | 2017 | 17.3 | 2.35 | 143 | 2018-02-17 | capitalAdequacy: scope-unresolved | [PDF p.10](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201802/18012265.pdf#page=10) |
| SET:TTB | 2018 | 17.5 | 2.76 | 152 | 2019-02-15 | capitalAdequacy: scope-unresolved | [PDF p.12](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/201902/19012652.pdf#page=12) |
| SET:TTB | 2019 | 29.7 | 2.30 | 120 | 2020-01-21 | capitalAdequacy: scope-unresolved | [PDF p.15](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202001/20005494.pdf#page=15) |
| SET:TTB | 2020 | 19.6 | 2.50 | — | 2021-02-25 | nplCoverage: not-reported | [PDF p.14](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202102/21020813.pdf#page=14) |
| SET:TTB | 2021 | 19.3 | 2.81 | — | 2022-02-24 | nplCoverage: not-reported | [PDF p.17](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202202/22020140.pdf#page=17) |
| SET:TTB | 2022 | 20.0 | 2.73 | 138 | 2023-02-22 | — | [PDF p.16](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202302/23018433.pdf#page=16) |
| SET:TTB | 2023 | 20.7 | 2.62 | 155 | 2024-02-21 | — | [PDF p.17](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202402/0068NWS200220241713480403E.pdf#page=17) |
| SET:TTB | 2024 | 19.3 | 2.59 | 151 | 2025-02-20 | — | [PDF p.19](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202502/0068NWS190220251832370635E.pdf#page=19) |
| SET:TTB | 2025 | 19.5 | 2.87 | 152 | 2026-02-18 | — | [PDF p.19](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202602/0068NWS170220261747581720E.pdf#page=19) |

## Validation

- Original PDF verification: 190 metrics passed.
- Tests exercise all 64 issuer-years, announcement-day exclusion, missing-year handling, bank-only and projected exclusions, tampered evidence and a real reviewed TISCO FY2020 statement/risk replay with synthetic prices. Removing FY2020 risk from that replay makes risk checks unknown; FY2025 cannot fill the gap.
- Full application tests and syntax/encoding checks passed.
- Local preview API confirmed version `2026-11-11-bank-risk-history-v8` in original-statement mode. A TISCO/TTB request returned 20 reviewed risk issuer-years across FY2016–2025 and seven historical observations, of which five had incomplete eligible risk inputs. These observations are not a certification of historical investment performance.
