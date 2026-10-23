# Financial Data Audit — Multi-chart

วันที่ตรวจ: 2026-10-23  
ขอบเขต: ข้อมูลงบการเงิน, ราคา, ปันผล, สูตร, screener, valuation และ backtest ของเว็บ Multi-chart  
สภาพแวดล้อม: โค้ด local ที่พอร์ต 8788 (โค้ดใหม่) เทียบกับข้อมูลต้นทางจริง; deploy `https://multi-chart-desk.onrender.com` ได้รับ commit `6d14539` แล้ว (ตรวจ `/api/health` เมื่อ 2026-10-23 16:07: status ok, ready, annualHistory 109 symbols; uptime รีเซ็ตเป็น 25s แสดงว่าเป็น instance ใหม่) — route screener บน deploy ต้องยืนยันตัวตน จึงตรวจค่าจาก API สาธารณะไม่ได้; งาน low-yield guard/Graham number รอบนี้ยังเป็น local (ยังไม่ push)  
เกณฑ์: ความถูกต้องระดับเงินจริง — ไม่มีข้อมูลดีกว่าข้อมูลผิด, ห้ามแทนข้อมูลหายด้วย 0, ห้ามใช้ข้อมูลอนาคตในอดีต, ห้ามใช้สูตรเดียวกับทุกบริษัทโดยไม่ตรวจความเหมาะสม

> หมายเหตุ: ตัวเลขในรายงานนี้เป็นผลจากข้อมูล ณ วันที่ตรวจ ราคาและงบอาจเปลี่ยนหลังวันนี้ ค่าที่เป็น "ก่อนแก้" มาจากระบบเดิมที่บันทึกไว้ระหว่าง audit; ค่าที่เป็น "หลังแก้" มาจากเซิร์ฟเวอร์ 8788 ที่รันโค้ดใน working tree นี้

---

## 1. วิธีการตรวจ

1. **อ่านโค้ดเส้นทางเงินทั้งหมด**: `server/fin.js`, `screener.js`, `screener-run.js`, `backtest.js`, `finnomena.js`, `quotes.js`, `fundamentals.js`, `market.js`, `history.js`, `setindex.js`, `index.js` และ UI `public/js/dialogs/screener-dialog.js`
2. **เทียบแหล่งต้นทาง**: Yahoo Finance (quote, chart, annual/quarterly statements), Finnomena public market-info (annual history), SET index constituents, TradingView MCP sidecar, ตารางปันผลทางการของบริษัท (ADVANC)
3. **คำนวณอิสระ**: payout, yield, ROE, ROA, D/E, CAGR, DDM, MOS, forward return และ sensitivity ด้วยสูตรแยกจากโค้ด
4. **รันของจริง**: screen 8 หลักทรัพย์, income preset บน `set-large`/`SET100`/union, backtest `quality` 3 ปี, stock detail
5. **ทดสอบซ้ำหลังแก้**: `npm test`, `npm run check`, `node scripts/verify-screener.mjs` (รวม 13 audit regression tests), i18n parity

---

## 2. สรุปผู้บริหาร

| ระดับ | จำนวน | สถานะ |
|---|---:|---|
| P0 — ทำให้ตัวเลขกลับเครื่องหมาย/ผิดทั้งเส้น | 1 | แก้แล้ว |
| P1 — ตัวเลขเงินผิดหรือประเมินผิดอย่างมีนัย | 6 | แก้แล้ว 6; เหลือ RISK ด้าน DCF/Graham growth/sector |
| P2 — ความครบถ้วน/ความสอดคล้องของแหล่งข้อมูล | 7 | แก้แล้ว 5, เปิด 2 |
| P3 — การแสดงผล/ป้ายกำกับ | 1 | แก้แล้ว |

**ข้อสรุปสำคัญ**

- บั๊กที่ร้ายที่สุดคือ **BANPU**: ค่า FX ติดลบถูกนำไปคูณทั้งประวัติ ทำให้กำไร/ขาดทุนกลับเครื่องหมาย และระบบเดิมยังให้คะแนน/มูลค่าจากข้อมูลที่ขัดกันเอง ตอนนี้ระบบ **ไม่ให้คะแนน** และรายงาน `dataIssue = eps-sign-conflict`
- **Payout ratio เดิมผิดระบบ**: ใช้ปันผลรายปีหารด้วย EPS TTM (คนละงวด) ทำให้ PTT ถูกอ่าน 52.97% แทน 73.02%, CPF 65.78% แทน 40.06%, TVO 67.56% แทน 80.08% หลังแก้เป็น FY/FY ตัวเลขตรงกับแหล่งทางการ
- **Income preset เปลี่ยนสมาชิก** เพราะข้อมูลถูกแก้ ไม่ใช่เพราะเปลี่ยนเกณฑ์: union เดิม 6 ตัว → ใหม่ 5 ตัว (TVO 80.08% และ TACC 84.0% หลุด; KAMART 80.0% เข้า; MC 100% หลุด)
- **Valuation แก้ default/guard แล้ว แต่ยังมี model risk**: เดิม DDM ใช้ g1 = g2 = 5% ทำให้ two-stage ยุบเป็น Gordon growth; เปลี่ยน default เป็น g1 = 5% ระยะ 5 ปี และ g2 = 3% ระยะยาวแล้ว เพิ่ม payout guard (KCE 171.4%, MC 100%, BDMS 100%) และ low-yield guard (DELTA 0.26%) ให้คืน null แทน intrinsic/MOS ที่ไม่มีความหมาย; stock detail แสดง **scenario** สำหรับ payout ≥100% พร้อม warning (ไม่ใช้ใน preset) และมี Graham number เป็น cross-check — แต่ยังไม่มี DCF, Graham growth formula และ sector model
- **ข้อมูล long history ยังไม่ครบทุกจักรวาล**: เพิ่ม TVO และ JAS เข้า `data/annual-history.json` แล้ว (109 symbols); GST ยังดึงไม่ได้ (Finnomena ไม่มีข้อมูล) → growth ของ GST เป็น UNKNOWN ตามนโยบาย

---

## 3. Findings P0–P3

### P0-01 — FX ติดลบจาก EPS ที่ขัดกัน (BANPU)

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | `statementEps` 2.733 (Yahoo annual) กับ `quote.epsTtm` −0.35 ให้ ratio = −0.128; โค้ดเดิมเอา `fx` นี้ไปคูณ revenue/netIncome/equity/EPS ทุกปี |
| ผล | เครื่องหมายกำไร/ขาดทุนกลับทั้งประวัติ; `reconcileYears` ทิ้งปีหรืออ่านค่าผิด; ระบบเดิมให้คะแนน/DDM จากข้อมูลที่ขัดกัน |
| หลักฐาน | BANPU annual EPS 2.733 vs quote EPS −0.35; ratio −0.128; chart last close 2026-08-11; quote 2026-10-22 (halt 72 วัน); การควบรวม 31 ก.ค. 2026 NewCo 4,049,621,973 หุ้น par 10 |
| การแก้ | `convert()` รับ FX เฉพาะ `ratio > 0`; ratio ≤ 0 → `fxIssue = 'eps-sign-conflict'`; ไม่แปลงสกุลเงิน; `loadFinancials()` ส่ง `dataIssue`; `buildRow()` คืน `unknownRow` (score null, coverage 0, ไม่มี DDM/MOS) |
| ผลหลังแก้ | BANPU: score `null`, `failReason = unknown:data`, `dataIssue = eps-sign-conflict`, price 14.50 @ 2026-10-22, `priceSource = quote`, ไม่มี DDM/MOS ปลอม |
| สถานะ | **FIXED — PASS** |

### P1-01 — Payout ratio ใช้คนละงวด (FY dividend / TTM EPS)

| หัวข้อ | รายละเอียด |
|---|---|
| สูตรเดิม | `payout = dividend.d0 / ttmEps` |
| สูตรใหม่ | `payout = dividend.d0 / eps ของ fiscal year เดียวกับ dividend` |
| หลักฐาน | PTT 2.30/3.15 = 73.02%; SCB 11.28/14.10 = 80.00%; CPF 1.25/3.12 = 40.06%; TVO 1.97/2.46 = 80.08%; ADVANC regular 15.30/EPS 16.10 = 95.03% |
| ก่อน/หลัง | ดูตาราง §4.1 |
| ผลกระทบ | income preset เดิมเชื่อ TVO 67.56% (ผ่าน) แต่ของจริง 80.08% (เกิน ceiling 80%); TACC 84.0%; PTT ถูกมองข้ามโอกาส/ความเสี่ยงผิด |
| สถานะ | **FIXED — PASS** |

### P1-02 — Payout ใช้ปีล่าสุดที่ไม่ใช่ปีของปันผล (MC)

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | MC มีปี 2026 เป็น stub ที่ยังไม่มี EPS แต่ `last = years.at(-1)` ถูกใช้หารปันผล FY2025 (0.96) → payout null → `unknown:payoutCeiling` |
| ความจริง | FY2025 DPS 0.96 / EPS 0.96 = 100% → เกิน ceiling 80% อย่างชัดเจน |
| การแก้ | หาปีที่ `fiscalYear === dividend.fiscalYear` ก่อน; ถ้าไม่มีค่อย fallback `last` |
| ผลหลังแก้ | MC payout 100.0%, score 91, `requires:payoutCeiling` (ไม่ใช่ unknown) |
| สถานะ | **FIXED — PASS** |

### P1-03 — Growth ใช้ history แค่ 4 ปี

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | `buildRow` ส่ง `history: { years: trusted }` (Yahoo 4 ปี) ให้ `growthMetrics`; revenueGrowth ต้องใช้ 6 ปี, earningsStability ต้องใช้ 8 ปี → เป็น null ทุกบริษัท |
| การแก้ | `buildGrowthHistory()` ใช้ long history สำหรับ revenue/netIncome; ใช้เฉพาะ 4 ปี Yahoo สำหรับ EPS (เพราะไฟล์ EPS หลายตัว mix core/reported) |
| ผลหลังแก้ | ADVANC revenue 5.53%/EPS 22.54%/stability 10; PTT 10.50%/−0.52%/10; CPF −0.64%/22.67%/9; SCB 0.81%/8.24%/10; DELTA 25.67%/17.39%/10; TVO 2.17%/10.97%/10 |
| หมายเหตุ | AOT epsGrowth null เพราะปีฐาน 2022 ขาดทุน (known failure ไม่ใช่ missing); GST ยังไม่มี long history |
| สถานะ | **FIXED — PASS (ยกเว้น GST = BLOCKED)** |

### P1-04 — Special dividend ของ ADVANC ประเมินต่ำ

| หัวข้อ | รายละเอียด |
|---|---|
| ข้อมูลทางการ | FY2025 regular 15.30 = 6.89 (interim) + 8.41 (final); special 19.00; total 34.30 |
| ระบบเดิม | ใช้ 12.63 จาก cash-flow statement (เป็น final ปีก่อน + interim ปีนี้) → ต่ำกว่าของจริง |
| ระบบใหม่ | ประเมิน recurring จาก non-special instalment growth: prior 10.61 × (6.89/4.87) = 15.01 |
| ค่าคลาดเคลื่อน | −1.90% เทียบ regular 15.30; yield 4.47% vs 4.55% (−0.09 pp); payout 93.24% vs 95.03% (−1.80 pp) |
| ผล | `hasSpecial = true`; ยังถูกตัดจาก income เพราะ payout เกิน 80% (ถูกต้อง) |
| สถานะ | **FIXED — PASS (ประมาณการ, ไม่ใช่ exact)** |

### P1-05 — ราคา/วันที่/การหยุดซื้อขาย

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | ใช้ราคาจาก chart เป็นหลัก; chart อาจเก่ากว่า quote หลายสัปดาห์ (BANPU) และไม่มี `priceSource` |
| การแก้ | `quotes.js` เพิ่ม `priceTime` จาก `regularMarketTime`; `fin.js` เลือกราคา quote เมื่อใหม่กว่า/วันเดียวกัน; เก็บ `chartLastDate`, `staleDays`, `priceSource`; ถ้า chart เก่ากว่า quote > 30 วัน → `dataIssue = trading-halt` |
| ผล | BANPU price 14.50 @ 2026-10-22 (quote), chart last 2026-08-11, 72 วัน; normal rows มี `priceSource = quote` |
| สถานะ | **FIXED — PASS** |

### P1-06 — DDM default ยุบเป็น Gordon และใช้ g = 5% กับทุกบริษัท (แก้แล้ว)

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | UI ตั้ง `g1 = g2 = 5%`, `r = 9%`, `years = 5`; เมื่อ g1 = g2 สูตร two-stage เท่ากับ `d0 × (1+g)/(r−g)` ทุกกรณี |
| ผลก่อนแก้ | PTT intrinsic 60.38 (MOS +31.3%) แต่ถ้า g = 3% ได้ 39.48 (MOS −5.1%); ADVANC 394.04 vs 257.69 ที่ g = 3%; SCB 296.10 vs 193.64; TVO 51.71 vs 33.82 |
| ผลหลังแก้ default | g1 = 5% ระยะ 5 ปี, g2 = 3% ระยะยาว: PTT 43.05 (+3.6%), ADVANC 280.93 (−19.6%), SCB 211.11 (+28.2%), TVO 36.87 (+21.3%), CPF 23.39 (+14.5%), PTTEP 163.76 (+0.5%) |
| ความเหมาะสม | g_sustainable = ROE × (1−payout): PTT 2.35%, SCB 1.87%, CPF 3.06%, TVO 3.10%, ADVANC 2.64% — g2 = 3% ใกล้ sustainable มากกว่า 5% เดิม; g1 = 5% ยังเป็น near-term assumption ที่สูงกว่า sustainable ของ PTT/SCB/ADVANC |
| การแก้ | เปลี่ยน `DEFAULTS.g2` เป็น 3% และ UI default; เพิ่ม **payout guard** (`payout ≥ 100%` → `payout-not-funded`) และ **low-yield guard** (`yield < 1%` → `yield-too-low`) ใน `ddm()`; ส่ง `payout`/`yieldRate` จาก `buildRow()`/backtest; เพิ่ม **Graham number cross-check** ใน stock detail; เพิ่ม **unfunded-payout scenario** (`allowUnfunded`) ที่ติดป้ายชัดเจนและไม่เข้า preset; เพิ่ม i18n EN/TH และ regression tests |
| สถานะ | **FIXED — PASS (default/guards + Graham cross-check + labelled scenario); RISK คงเหลือ (DCF/Graham growth formula/sector)** |

### P2-01 — ROE ใช้กำไรรวมแทนกำไรที่เป็นของผู้ถือหุ้นแม่

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | `roe = netIncome / average(equity)`; `netIncome` รวม minority interest |
| หลักฐาน | CPF 2023 total −5.207B vs attributable −5.837B (~12%); CPF 2025 ROE 4.3%; PTT 0.9% (ตามรายงานเดิม) |
| การแก้ | เพิ่ม `annualNetIncomeCommonStockholders`; `roe = (netIncomeCommon ?? netIncome) / average(parent equity)` |
| สถานะ | **FIXED — PASS** |

### P2-02 — Equity ติดลบทำให้ D/E/ROE มีความหมายผิด

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | THAI 2020–2023 equity ติดลบ; D/E ติดลบ; กฎ `de <= 1.0` จะผ่าน erroneously |
| การแก้ | `equity <= 0` → `de = null`, `roe = null`, `negativeEquity = true`; backtest ทำเช่นกัน |
| ผล | THAI: D/E/ROE เป็น UNKNOWN; `debtLevel` ไม่ผ่าน/ไม่ให้คะแนน |
| สถานะ | **FIXED — PASS** |

### P2-03 — EPS ขัดกับ net income / จำนวนหุ้น

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | annual-history หลายปี mix reported NP กับ core EPS: AOT 2020, BCP 2024/2025, BTS 2024/2025, EGCO 2023, HANA 2024, PTTGC 2020/2022/2023, TU 2023 (NP −13.93B, EPS +1.2099), VGI 2022/2024, BANPU 2019 |
| อีกกลุ่ม | DELTA implied shares 2016 3.56B, 2020 4.16B, 2022 2.45B vs ปกติ ~12.5B |
| การแก้ | live/backtest: sign guard + magnitude guard (EPS × shares เทียบ NI เกิน 60% → `epsConflict`, EPS = null); file-level magnitude ของ DELTA ยัง OPEN |
| สถานะ | **FIXED (live/backtest) — PASS; file-level DELTA = OPEN (P2)** |

### P2-04 — Backtest headline เป็นการทบต้นช่วงที่ทับซ้อน

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | `totals.portfolio` = compound ของ 4 ช่วง 3 ปีที่เริ่มห่างกัน 1 ปี → ไม่ใช่ผลตอบแทน 3 ปี |
| หลักฐาน | quality 3y: portfolio 72.93%, universe 240.00%; mean 22.50% vs 49.56% |
| การแก้ | เพิ่ม `portfolioMean`, `universeMean`; UI แสดง "Average window" ใต้ summary; ยังคง compound ไว้พร้อมคำอธิบาย |
| สถานะ | **FIXED — PASS (แต่ compound ยังต้องอ่านด้วยความระวัง)** |

### P2-05 — Annual-history coverage ไม่ครบจักรวาล

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | ไฟล์ 107 symbols; TVO, JAS, GST ไม่อยู่ในไฟล์; growth ของ TVO/JAS/GST เป็น null ในตาราง แต่ detail (live) คำนวณได้ → ตารางกับ detail ไม่ตรงกัน |
| การแก้ | `scripts/refresh-annual-history.mjs` รวม `SET_LARGE_CAPS`; เพิ่ม TVO และ JAS เข้าไฟล์ (109 symbols) ด้วยข้อมูล Finnomena; GST ดึงไม่ได้ |
| ผล | TVO/JAS table = detail (score 85/41, growth ตรงกัน); GST ยัง UNKNOWN |
| สถานะ | **PARTIAL — PASS สำหรับ TVO/JAS; GST = BLOCKED** |

### P2-06 — Corporate actions / การควบรวม

| หัวข้อ | รายละเอียด |
|---|---|
| กรณี | BANPU amalgamation 31 ก.ค. 2026 (NewCo 4,049,621,973 หุ้น par 10); GULF/INTUCH merger restatement; BANPU/BPP |
| การแก้ | BANPU ถูก flag `eps-sign-conflict` + `trading-halt`; ไม่ให้คะแนน |
| คงเหลือ | GULF 2025 np 80.0B/equity 335.7B (merger restatement) ยังไม่ถูก flag; การเทียบ growth ข้ามปีอาจไม่ comparable |
| สถานะ | **PARTIAL — BANPU PASS; GULF/BPP OPEN (P2)** |

### P2-07 — TradingView กับ Yahoo ให้ค่า D/E/yield ต่างกัน

| หัวข้อ | รายละเอียด |
|---|---|
| ตัวอย่าง | P/E/PBV ตรงกันมาก (PTT 9.558 vs 9.559, PBV 0.9843; TVO 9.9455; DELTA 97.5 vs 97.78); yield ต่าง (PTT 5.542 vs 5.153; ADVANC 3.76 vs 5.10; CPF 6.25 vs 3.48; TVO 6.79 vs 7.14); D/E ต่าง (ADVANC 2.99 vs 5.28; PTT 0.9786 vs 0.8776; SCB 6.26 vs 0.82) |
| สาเหตุ | FY vs TTM, special dividend, นิยามหนี้ (total debt vs financial debt), งบรายปี vs รายไตรมาส |
| การแก้ | ระบบระบุแหล่ง/วันที่ (`priceSource`, `priceDate`); ใช้ FY/FY สำหรับ payout/yield; D/E ใช้ annual total debt; ไม่ blend แหล่งในสูตรเดียว |
| สถานะ | **PASS (อธิบายความต่างได้); ยังต้องแสดง provenance ใน UI** |

### P3-01 — UI แสดง `null`/เหตุผลไม่ชัด

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | score null แสดงเป็นตัวเลข/ช่องว่าง; `unknown:*` แสดงเป็น fail; BANPU detail ยังมี scorecard/calculator |
| การแก้ | score null → `—`; `rejectReason` รองรับ `unknown:*`; detail มี warning และข้าม scorecard/calculator/bands; เพิ่ม `priceAsOf`; backtest แสดง average window |
| สถานะ | **FIXED — PASS** |

---

## 4. ตารางหลักฐานตัวเลข

### 4.1 Payout: ก่อนแก้ vs หลังแก้ vs แหล่งทางการ

| Symbol | ก่อน (TTM EPS) | หลัง (FY/FY) | ทางการ | Error ก่อน (pp) | Error หลัง (pp) |
|---|---:|---:|---:|---:|---:|
| PTT | 52.97% | 73.02% | 73.02% | −20.05 | 0.00 |
| SCB | 87.29% | 80.00% | 80.00% | +7.29 | 0.00 |
| CPF | 65.78% | 40.06% | 40.06% | +25.72 | 0.00 |
| TVO | 67.56% | 80.08% | 80.08% | −12.52 | 0.00 |
| ADVANC | 70.16% | 93.24% | 95.03% | −24.87 | −1.80 |
| MC | n/a (null) | 100.00% | 100.00% | — | 0.00 |

> "ทางการ" ของ ADVANC ใช้ regular 15.30 / EPS 16.10; ระบบใช้ recurring estimate 15.01 จึงต่าง −1.90% ใน DPS และ −1.80 pp ใน payout

### 4.2 Dividend yield

| Symbol | ระบบ | ทางการ/แหล่ง | Error |
|---|---:|---:|---:|
| ADVANC | 4.4675% | 4.5536% (15.30/336) | −0.086 pp |
| PTT | 5.5422% | 5.5422% (2.30/41.5) | 0.000 pp |
| TVO | 6.7931% | 6.7931% (1.97/29) | 0.000 pp |
| CPF | 6.2500% | 6.2500% (1.25/20) | 0.000 pp |
| SCB | 7.4455% | 7.4455% (11.28/151.5) | 0.000 pp |

### 4.3 Income preset: สมาชิกก่อน/หลัง (เกณฑ์ไม่เปลี่ยน)

| จักรวาล | ก่อนแก้ | หลังแก้ | เหตุผล |
|---|---|---|---|
| union (SET100 ∪ SET_LARGE_CAPS) | TVO, TACC, TTW, PRM, PTTEP, MEGA (6) | KAMART, TTW, PRM, PTTEP, MEGA (5) | TVO 80.08%, TACC 84.0% เกิน ceiling; KAMART 80.0% ผ่าน |
| set-large | (แล้วแต่การรันเดิม) | KAMART, TTW, PTTEP, MEGA (4) | PRM ไม่อยู่ใน set-large |
| SET100 | (แล้วแต่การรันเดิม) | PRM, PTTEP, MEGA (3) | KAMART/TTW ไม่อยู่ใน SET100 |
| MC | อยู่ในข่ายคะแนนสูง | หลุด | payout 100% เกิน ceiling (ไม่ใช่ unknown) |

**จุดตัดสินใจสำหรับผู้ใช้**: TVO อยู่ที่ 80.08% ซึ่งเกิน ceiling 80% เพียง 0.08 pp หากต้องการให้ TVO อยู่ในพอร์ต "นอนหลับสบาย" ต้องแก้เกณฑ์เป็น ≥80.1% หรือเปลี่ยนนโยบาย — รายงานนี้ **ไม่แก้เกณฑ์ให้เอง** เพราะเป็นการเปลี่ยนคำนิยามความเสี่ยง

### 4.4 Screen 8 หลักทรัพย์ (หลังแก้)

| Symbol | Score | Yield | Payout | DDM intrinsic | MOS | หมายเหตุ |
|---|---:|---:|---:|---:|---:|---|
| BANPU | null | — | — | — | — | `dataIssue = eps-sign-conflict`; ไม่ให้คะแนน |
| PTT | 64 | 5.54% | 73.02% | 43.05 | +3.6% | payoutBand warn |
| ADVANC | 87 | 4.47% | 93.24% | 280.93 | −19.6% | special dividend; เกิน ceiling |
| CPF | 57 | 6.25% | 40.06% | 23.39 | +14.5% | ROA/ROE ต่ำ |
| SCB | 46 | 7.45% | 80.00% | 211.11 | +28.2% | bank; ROA < 7% |
| TVO | 85 | 6.79% | 80.08% | 36.87 | +21.3% | เกิน ceiling 0.08 pp |
| KCE | 53 | 1.70% | 171.43% | — | — | `payout-not-funded` (171.4%) |
| DELTA | 86 | 0.26% | 30.15% | — | — | `yield-too-low` (0.26%); Graham cross-check 21.36 |

> Graham number `sqrt(22.5 × EPS × BVPS)` แสดงใน stock detail เป็น cross-check ไม่ใช่ราคาเป้าหมาย; สำหรับ payout ≥100% stock detail แสดง DDM scenario พร้อม warning (ค่าฐานยังถูก guard); DCF และ Graham growth formula ยังไม่มี

---

## 5. ข้อจำกัดและความเสี่ยงคงเหลือ

1. **DDM อย่างเดียว**: ไม่มี DCF/Graham growth formula; DDM ใช้กับบริษัทที่จ่ายปันผล ≥1% และ payout <100% เท่านั้น; DELTA ถูก low-yield guard แล้ว; stock detail มี scenario สำหรับ payout ≥100% แต่ไม่ใช้ใน preset; มี Graham number เป็น cross-check แต่ธนาคาร/REIT ยังไม่มี sector model (ดู `VALUATION-VALIDATION.md`)
2. **Backtest ตัวอย่างเล็ก**: 4 ช่วง 3 ปี, n ประมาณ 1.8–2.0 ต่อช่วง; ช่วงทับซ้อน; survivorship/revision bias; ไม่ใช่หลักฐานผลตอบแทนอนาคต
3. **ข้อมูล long history**: 109 symbols; GST ยังขาด; หุ้นที่ไม่อยู่ในไฟล์จะได้ growth UNKNOWN (ปลอดภัยกว่าเดา)
4. **File EPS บางปี** ยัง mix core/reported; guard ฝั่ง live/backtest จับ sign/magnitude แต่ไม่ได้แก้ไฟล์ต้นทางทั้งหมด (DELTA shares)
5. **Corporate actions**: GULF/BPP ยังไม่ถูก flag; BANPU จัดการแล้ว
6. **ราคา/วันที่**: ใช้ quote เมื่อใหม่กว่า; กรณีตลาดปิด/หยุดยาวอาจต้องตรวจซ้ำก่อนตัดสินใจ
7. **เกณฑ์คัดไม่ใช่คำแนะนำซื้อ**: income/quality เป็น filter ตาม mandate ไม่ใช่การรับประกันผลตอบแทน

---

## 6. สถานะรวม

| Finding | ระดับ | สถานะ |
|---|---|---|
| FX/EPS sign conflict (BANPU) | P0 | PASS (fixed) |
| Payout FY/FY | P1 | PASS (fixed) |
| MC stub payout | P1 | PASS (fixed) |
| Growth long history | P1 | PASS (fixed; GST blocked) |
| ADVANC special dividend | P1 | PASS (estimate) |
| Price/date/halt | P1 | PASS (fixed) |
| DDM default/guard | P1 | **PASS (fixed)** |
| DDM low-yield guard (DELTA) | P1 | **PASS (fixed)** |
| Unfunded-payout scenario (BDMS) | P2 | **PASS (labelled; not preset)** |
| Graham number cross-check | P2 | **PASS (stock detail)** |
| DCF / Graham growth formula / sector model | RISK | **OPEN** |
| TVO payout 80.08% vs 80% ceiling | DECISION | **OPEN (ceiling unchanged)** |
| ROE attributable | P2 | PASS (fixed) |
| Negative equity | P2 | PASS (fixed) |
| EPS/NI conflicts | P2 | PASS live/backtest; DELTA file open |
| Backtest overlap | P2 | PASS (mean shown; compound caveat) |
| Annual-history coverage | P2 | PASS TVO/JAS; GST BLOCKED |
| Corporate actions | P2 | BANPU PASS; GULF/BPP open |
| Source differences | P2 | PASS (explained) |
| UI labels | P3 | PASS (fixed) |
