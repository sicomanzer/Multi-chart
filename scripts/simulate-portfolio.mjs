/**
 * What the reader would have made, and how.
 *
 * The back test in the app asks whether the rules work. This asks the question
 * the reader actually has: five million baht, the five names the screen picked
 * first, and the three ways a person might have put the money in — all at once,
 * a slice every month, or only when the price came down to something worth
 * paying.
 *
 *   node scripts/simulate-portfolio.mjs [--hold 5] [--capital 5000000]
 *                                        [--monthly 25000] [--top 5]
 *
 * The names are the same ones the app screens — the SET100 as published by the
 * exchange — and the statements and the closes are the same ones the screen
 * reads, so the answer here is the answer there.
 */
import { runBacktest } from '../server/backtest.js';
import { SET100 } from '../server/screener-run.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
};

const holdYears = Number(arg('hold', 5));
const capital = Number(arg('capital', 5_000_000));
const monthly = Number(arg('monthly', 25_000));
const tops = String(arg('tops', arg('top', 5))).split(',').map((n) => Number(n.trim())).filter(Boolean);
const waitMode = String(arg('wait', 'value'));
const waitDrop = Number(arg('drop', 0.1));

const PRESETS = [
  { id: 'moat', label: 'ปันผลสูง + คูเมือง' },
  { id: 'quality', label: 'เติบโตและมีคุณภาพ' },
  { id: 'dividend', label: 'เน้นรายได้ปันผล' },
  { id: 'value', label: 'ถูกกว่ามูลค่าชัดเจน' },
];

const baht = (v) => (v == null ? '—' : `${Math.round(v).toLocaleString('th-TH')} ฿`);
const pct = (v, digits = 1) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);

console.log(`\nจำลองพอร์ต — ถือ ${holdYears} ปี · เงิน ${baht(capital)} · DCA ${baht(monthly)}/หุ้น/เดือน`);
console.log('='.repeat(96));

// One pass over the data, several shortlists: the statements and the closes
// are fetched once and the answers are worked out from the same cache.
const results = new Map();
for (const preset of PRESETS) {
  process.stdout.write(`\nกำลังคำนวณ "${preset.label}" ... `);
  const result = await runBacktest({
    symbols: SET100,
    preset: preset.id,
    holdYears,
    simulation: { capital, monthly, topN: tops, waitMode, waitDrop },
  });
  console.log('เสร็จ');
  results.set(preset.id, result);
}

for (const topN of tops) {
  console.log(`\n\nผลรวมทุกช่วงเวลา (เฉลี่ย) — ซื้อ ${topN} ตัวแรก`);
  console.log('='.repeat(96));
  console.log(
    'หัวข้อ'.padEnd(26)
    + 'ซื้อครั้งเดียว'.padEnd(16)
    + 'DCA ทุกเดือน'.padEnd(16)
    + 'รอราคาถูก'.padEnd(16)
    + 'ตลาด (SET100 เฉลี่ย)',
  );
  console.log('-'.repeat(96));

  const ranked = [];
  for (const preset of PRESETS) {
    const result = results.get(preset.id);
    const run = (result.simulation?.byTopN ?? []).find((b) => b.topN === topN)
      ?? result.simulation;
    const a = run?.averages ?? {};
    const line = preset.label.padEnd(24)
      + pct(a.lump).padEnd(16)
      + pct(a.dca).padEnd(16)
      + pct(a.wait).padEnd(16)
      + pct(run?.universe);
    console.log(line);
    ranked.push({
      label: preset.label,
      ...a,
      universe: run?.universe ?? null,
      best: Math.max(a.lump ?? -Infinity, a.dca ?? -Infinity, a.wait ?? -Infinity),
    });
  }

  console.log('\nสรุป: หัวข้อที่ทำกำไรได้ดีที่สุด');
  console.log('-'.repeat(96));
  ranked.sort((a, b) => (b.best ?? -Infinity) - (a.best ?? -Infinity));
  for (const [i, r] of ranked.entries()) {
    const beat = r.universe != null ? r.best - r.universe : null;
    console.log(`${i + 1}. ${r.label.padEnd(24)} ดีที่สุด ${pct(r.best).padEnd(9)} (เทียบตลาด ${beat == null ? '—' : pct(beat)})`);
  }
}

// ── The detail, for the first shortlist ────────────────────────────────────
const detailTop = tops[0];
console.log(`\n\nรายละเอียดรายช่วงเวลา — ซื้อ ${detailTop} ตัวแรก`);
for (const preset of PRESETS) {
  const result = results.get(preset.id);
  console.log(`\n── ${preset.label} ──`);
  for (const p of result.simulation?.periods ?? []) {
    const r = p.result;
    const names = p.picks.slice(0, detailTop).map((x) => x.symbol.replace('SET:', '')).join(', ');
    console.log(`\n  ${p.date} → ${p.to}`);
    console.log(`  หุ้นที่คัดได้ (${Math.min(detailTop, p.picks.length)}): ${names || '—'}`);
    if (!r) { console.log('  ไม่มีหุ้นที่ผ่านเกณฑ์ในช่วงนี้'); continue; }
    console.log(`  ซื้อครั้งเดียว   ${baht(r.lump.value)}  ${pct(r.lump.return)}`);
    console.log(`  DCA ทุกเดือน   ${baht(r.dca.value)}  ${pct(r.dca.return)}  (ลงจริง ${baht(r.dca.deployed)}, เงินสดค้าง ${baht(r.dca.cash)})`);
    console.log(`  รอราคาถูก      ${baht(r.wait.value)}  ${pct(r.wait.return)}  (ลงจริง ${baht(r.wait.deployed)}, เงินสดค้าง ${baht(r.wait.cash)})`);
    console.log(`  ตลาดเฉลี่ย     ${pct(p.universe)}`);
  }
}
console.log('');

