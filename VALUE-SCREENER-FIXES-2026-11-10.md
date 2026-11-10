# Value screener fixes — 10 November 2026

- Thai-stock annual ROE, ROA, NPM and D/E used in scoring now come from SET annual financial-data rows matched by fiscal year. Missing official years remain unknown, without silently substituting a different provider's ratio.
- The 44-stock official snapshot includes annual ratios and statement types, so the same basis survives an upstream outage.
- Three-year average rules require all three values. ROE consistency requires at least three known years and three passing years. FCF consistency requires four known years, with three positive years. Margin trend requires all four values.
- SET headline dividend yield and the recurring yield used for DDM are displayed separately. Annual-scoring basis is explained in the scorecard.
- Current P/E/P/BV used for band summaries now use official SET multiples as well. Historical band series and valuation statement models remain model-derived.
- REITs identified by SET statement type are explicitly excluded from ordinary-stock scoring and DDM pending a dedicated adjusted-profit/distribution framework. This is not a judgement that distributions are unfunded.
- Data coverage is computed separately from rules that do not apply to financial businesses.

Validation: all repository suites pass, with new tests for short histories, exact SET annual overrides, missing years, SET multiples and REIT exclusion. Live eight-stock verification passed. Example PTT score: 64 → 69; MINT FY2025 D/E used in scoring: 4.41913 → 2.68436; CPNREIT score: 43 → not applicable.

Local API checks confirm PTT score 69 and three-year SET ROA 7.0765%, and CPNREIT returns `reit-framework-not-supported` with a null score and null DDM value.

Limitations: DDM remains an assumption-based model; Yahoo still supplies cash flows, EPS and payment history, and Finnomena supplies the older growth series. A specialised REIT valuation framework, actual historical publication dates and an updated ThaiBMA assumption have not been implemented. Historical backtest results have not been revalidated for the revised score rules. No deployment or GitHub push was performed in this change.
