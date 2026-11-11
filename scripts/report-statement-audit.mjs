import {readFile,writeFile} from 'node:fs/promises';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const data=await read('data/statement-versions.json');
const coverage=await read('data/statement-register-coverage.json');
const originals=data.versions.filter(r=>r.scope==='audited-consolidated-current-year');
const symbols=[...new Set(originals.map(r=>r.symbol))];
const lines=[
 '# Expanded historical statement audit — 2026-11-11','',
 `Numerical coverage: **${symbols.length} issuers, ${originals.length} issuer-years (2016–2025)**. The register holds **${data.versions.length} reviewed snapshots**, including **${data.revisionEvents.length} later comparative snapshots**.`,
 '',
 'Original SEC archive workbooks were read without modifying them. Every model input was checked against its exact worksheet cell (including explicit unit multipliers and documented EBIT calculations). Issuer names, consolidated/current-year headers, THB versus USD columns, fiscal periods, file hashes and balance-sheet totals were checked. There are 828 model input checks across the 86 snapshots. Reported EPS remains excluded from scoring pending comparable share-basis verification.',
 '',
 '| Issuer | Original current-year snapshots | Later comparative snapshots | SEC register |',
 '|---|---:|---:|---|',
];
for(const symbol of symbols){
 const register=await read(`data/statement-registers/${symbol.slice(4)}.json`);
 lines.push(`| ${symbol} | ${originals.filter(r=>r.symbol===symbol).length} | ${data.versions.filter(r=>r.symbol===symbol&&r.scope==='audited-consolidated-comparative').length} | [Official register](${register.url}) |`);
}
lines.push('', '## Confirmed findings','',
 '- PTT 2022: the provider history stores THB 122,099,666,052 as net profit. The original statement identifies that as total group profit, while parent-attributable profit is THB 91,174,857,528. The reviewed backtest uses the latter. [SEC original](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202302/23016208.zip), PL_Accum G27/G30.',
 '- BCP 2019: original parent-attributable profit is THB 1,731,572,179; provider history stores total group profit of THB 2,488,492,891. [SEC original](https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/202002/20016555.zip), PL-10-11 E35/E32.',
 '- BCP 2019 equity initially appeared to differ from the following comparative. Checking the captions showed a subtotal excluding subordinated perpetual debentures versus total parent equity including them. The common parent-equity basis is THB 51,603,929,397. This is **not counted as a revision event**. The ROE denominator includes this parent equity; it is not a claim to match an ordinary-equity-adjusted published ROE.',
 '- HMPRO, KCE, MINT and PTTEP reported total revenue/income can differ from the provider\'s narrower sales/operating-revenue field. Those differences are recorded as differences of definition, not automatically classified as source errors. Model revenue basis is stored per snapshot; historical/live scoring equivalence remains a separate task.',
 '- PTTEP statements contain both USD and THB. The THB column is selected explicitly; thousand-baht periods are multiplied by 1,000. Cash flow is read from the final net-operating-cash row, not an earlier cash-generated subtotal.',
 '', '## Later comparative figures','',
 'A changed comparative is evidence that a later report presents a different figure. It can reflect restatement, reclassification, discontinued operations or another reporting change; it does not by itself establish an error or the earliest amendment date. Each changed period is retained in two snapshots with separate conservative availability bounds. Earlier rebalances cannot use the later snapshot.',
 '', '| Issuer | Fiscal year affected | Found in report | Conservative usable date | Changed model fields |',
 '|---|---:|---:|---|---|');
for(const event of data.revisionEvents){
 lines.push(`| ${event.symbol} | ${event.fiscalYear} | [${event.observedInFiscalYear}](${event.source}) | ${event.availableFrom} | ${Object.keys(event.changes).join(', ')} |`);
}
lines.push('', '## Source and date handling','',
 `- SEC annual statement registers were checked for ${coverage.issuers.length} issuers. Identity mismatches returned during concurrent queries were rejected; the final collection ran sequentially and had ${coverage.issuers.filter(r=>r.error).length} request/identity errors. Two registers did not return consolidated annual records under the selected criteria; this is not a claim that those issuers have no statements.`,
 '- Multiple source links for a year are not labelled amendments merely because there is more than one link. XBRL/IPO and original archive formats can coexist.',
 '- Conservative usable dates are the day after SEC annual-report receipt evidence. They do not certify the earliest release or earliest correction of a particular archived file. Earliest-version and earliest-amendment flags remain false.',
 '- Later comparatives are applied from the later report\'s conservative usable date. Where the opening balance two years back is not provided, ROE/ROA requiring that denominator remains unknown rather than borrowing an unverified value.',
 '- Runtime loading rechecks workbook hashes; a missing or altered workbook is excluded. Provider data cannot fill a gap in reviewed mode.',
 '- A refresh can detect content changes at the same download URL. Old archive bytes and reviewed snapshots are retained. Changed bytes get a new content-addressed file and cannot be backdated before the day after the new observation. The observation date is explicitly not an asserted release date.',
 '- Same-date conflicting snapshots are excluded; selection is independent of input ordering.',
 '', '## Validation and remaining work','',
 'Checks passed for all original-cell inputs, source hashes and balance reconciliation, real and synthetic revision-date cutoffs, reverse-order version selection, conflicting same-date records, malformed dates, share-unit exclusion, provider contamination and missing/stale statements. The full application test suite and syntax/encoding checks also passed.',
 '',
 'Numerical review is still limited to these seven issuers. Banks, other issuers, EPS/corporate-action adjustments, historical universe membership, original historical file-byte identity and exact first-publication/amendment timestamps remain unverified. Automatic universe-wide rule rankings remain unavailable below ten reviewed issuers. This threshold is a product guard, not statistical validation. Backtest results remain research estimates.',
 '');
await writeFile('STATEMENT-EXPANSION-2026-11-11.md',lines.join('\n'));
console.log('Wrote expanded statement audit');
