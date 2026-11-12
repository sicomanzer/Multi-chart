# DDM scenario values in the screener table — 2026-11-11

The user selected showing labelled DDM assumptions for dividend payers whose
base DDM is blocked. The table now displays the scenario value and scenario
margin of safety, with a persistent “Scenario only” label and the blocking
reason. Both the table and detail use the current dividend and DDM assumptions.

Scenarios require explicit opt-in to bypass the payout-at/above-earnings and
sub-1% yield guards. They cannot bypass missing dividends, invalid inputs or
a discount rate that does not exceed terminal growth. If both guards are
bypassed, both reasons are retained. Non-computable rows display a reason
instead of an unexplained dash.

`ddm.intrinsic` and `ddm.mos` remain null for blocked base valuations. Scenarios
are kept in `ddmScenario`; preset requirements, MOS filters, value ranking,
buy-plan logic and backtest selection continue to use the base fields.
The detail explanation no longer incorrectly claims that every preset excludes
a company merely because its DDM is unavailable.

Validation: all application tests and syntax/encoding checks passed. Tests
cover explicit scenario opt-in, unchanged DDM arithmetic, both guard reasons,
missing dividends, divergent terminal value and preserving preset exclusion
despite a favourable scenario MOS. Local API review covered all 110 symbols:
15 paying companies blocked by payout/yield now have scenario values, while
their base value and base MOS remain null. Examples include MC, KCE and DELTA.
Evidence: `ddm-scenario-table-validation.json`.

UI verification in this run used source/syntax checks and API validation;
no new browser screenshot was captured. Deployment status is tracked separately
from this local/API validation report.
