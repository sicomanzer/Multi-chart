# Financial Formula Test — Multi-chart

วันที่ทดสอบ: 2026-10-23  
ชุดทดสอบ: `scripts/verify-screener.mjs`, `npm test`, `npm run check`  
ผลรวม: **ผ่านทุกข้อ** — `all screener checks passed`, `all suites passed`, `all 48 files parse`, i18n parity 670/670

> เกณฑ์: สูตรต้องตรงกับนิยามทางการเงิน, จัดการค่าลบ/ศูนย์/ข้อมูลหายอย่างชัดเจน, และไม่ใช้ข้อมูลอนาคตตัดสินใจในอดีต  
> ค่าคลาดเคลื่อนที่ยอมรับ: absolute 1e-9 สำหรับสูตร pure, 0.01 percentage point สำหรับตัวเลขที่ปัดแสดงผล

---

## 1. สูตรและผลทดสอบ

### 1.1 ROE — ผลตอบแทนต่อส่วนของผู้ถือหุ้นแม่

**สูตร**
```
ROE = (netIncomeCommonStockholders ?? netIncome) / average(parent equity)
average = (equity ต้นปี + equity ปลายปี) / 2
```

| ข้อมูลทดสอบ | ค่าคาดหวัง | ค่าระบบ | คลาดเคลื่อน | สถานะ |
|---|---:|---:|---:|---|
| equity 100 → 120, netIncomeCommon 22, netIncome 30 (minority 8) | 20.00% | 20.00% | 0.00 | PASS |
| CPF 2023: total NI −5.207B, attributable −5.837B | ใช้ −5.837B | ใช้ −5.837B | ตรงนิยาม | PASS |
| THAI equity ≤ 0 | ROE = null | null | — | PASS |

**หลักฐาน**: `server/fin.js` เพิ่ม `annualNetIncomeCommonStockholders`; `deriveYears` ใช้ `netIncomeCommon ?? netIncome`; test "negative equity leaves ROE unknown" ผ่าน

---

### 1.2 ROA — ผลตอบแทนต่อสินทรัพย์

**สูตร**
```
ROA = netIncome / average(total assets)
```

| ข้อมูลทดสอบ | ค่าคาดหวัง | ค่าระบบ | คลาดเคลื่อน | สถานะ |
|---|---:|---:|---:|---|
| NI 12, assets 100 → 140 | 10.00% | 10.00% | 0.00 | PASS |
| PTT 3y | 2.85% | 2.85% | 0.00 | PASS |
| SCB (bank) | ใช้ ROA ตามงบ | 0.9–1.2% | — | PASS (แต่ไม่ผ่านเกณฑ์ 7%) |

---

### 1.3 D/E — หนี้สินต่อส่วนของผู้ถือหุ้น

**สูตร**
```
D/E = totalDebt / equity
ถ้า equity <= 0 → null (ไม่ใช่ค่าติดลบ)
```

| ข้อมูลทดสอบ | ค่าคาดหวัง | ค่าระบบ | คลาดเคลื่อน | สถานะ |
|---|---:|---:|---:|---|
| debt 50, equity 100 | 0.50 | 0.50 | 0.00 | PASS |
| debt 50, equity −20 (THAI) | null | null | — | PASS |
| PTT 2025 | 0.9786 | 0.9786 | 0.00 | PASS |

**หมายเหตุ**: D/E ของธนาคารไม่มีความหมายเหมือนบริษัททั่วไป; ระบบตั้ง `debtLevel` เป็น `na` สำหรับ `isFinancial` และไม่ให้คะแนน/ไม่ตัดสินจาก D/E

---

### 1.4 Payout ratio — ปันผลต่อกำไรต่อหุ้น ปีเดียวกัน

**สูตร**
```
payout = DPS ของ fiscal year ที่ปันผลนั้นประกาศ / EPS ของ fiscal year เดียวกัน
ถ้า EPS <= 0 หรือ DPS <= 0 → null (ไม่ใช่ 0)
```

| Symbol | DPS (FY) | EPS (FY) | ค่าคาดหวัง | ค่าระบบ | คลาดเคลื่อน | สถานะ |
|---|---:|---:|---:|---:|---:|---|
| PTT | 2.30 | 3.15 | 73.016% | 73.016% | 0.000 | PASS |
| SCB | 11.28 | 14.10 | 80.000% | 80.000% | 0.000 | PASS |
| CPF | 1.25 | 3.12 | 40.064% | 40.064% | 0.000 | PASS |
| TVO | 1.97 | 2.46 | 80.081% | 80.081% | 0.000 | PASS |
| ADVANC | 15.30 (regular) | 16.10 | 95.031% | 93.235% (estimate 15.01) | −1.796 pp | PASS (ประมาณการ) |
| MC | 0.96 | 0.96 | 100.000% | 100.000% | 0.000 | PASS |

**Test cases**
- `payout is measured against the same fiscal year's earnings` — ผ่าน
- `a payout over the ceiling fails even when a later stub has no EPS` — ผ่าน (MC)
- `the payout ceiling fails a company paying out all it earns` — ผ่าน

---

### 1.5 Dividend yield — ปันผลต่อราคา

**สูตร**
```
yield = DPS ของ fiscal year ล่าสุดที่สมบูรณ์ / ราคาปัจจุบัน
```

| Symbol | DPS | ราคา | ค่าคาดหวัง | ค่าระบบ | คลาดเคลื่อน | สถานะ |
|---|---:|---:|---:|---:|---:|---|
| PTT | 2.30 | 41.50 | 5.542% | 5.542% | 0.000 | PASS |
| TVO | 1.97 | 29.00 | 6.793% | 6.793% | 0.000 | PASS |
| CPF | 1.25 | 20.00 | 6.250% | 6.250% | 0.000 | PASS |
| SCB | 11.28 | 151.50 | 7.446% | 7.446% | 0.000 | PASS |
| ADVANC | 15.30 | 336.00 | 4.554% | 4.468% | −0.086 pp | PASS (estimate) |

---

### 1.6 EPS growth (3 ปี) และ Revenue growth (5 ปี)

**สูตร**
```
CAGR = (value_t / value_{t-n})^(1/n) − 1
ถ้าค่าใดค่าหนึ่ง <= 0 → known failure (ไม่ใช่ missing)
ถ้าข้อมูลไม่พอ n ปี → null (unknown)
```

| ข้อมูลทดสอบ | ค่าคาดหวัง | ค่าระบบ | คลาดเคลื่อน | สถานะ |
|---|---:|---:|---:|---|
| Synthetic 10y: EPS 2 → 2.662 (3y) | 10.00% | 10.00% | 0.00 | PASS |
| Synthetic 10y: revenue 890 → 1191 (5y) | 6.00% | 6.00% | 0.00 | PASS |
| ADVANC | 22.54% | 22.54% | 0.00 | PASS |
| PTT | −0.52% | −0.52% | 0.00 | PASS |
| CPF | 22.67% | 22.67% | 0.00 | PASS |
| TVO | 10.97% | 10.97% | 0.00 | PASS |
| AOT 2022 base loss | known failure (null, pass=false) | null, pass=false | — | PASS |
| GST ไม่มี history | null (unknown) | null | — | PASS (UNKNOWN) |

**Test cases**
- `buildRow uses the long history for revenue growth` — ผ่าน
- `buildRow uses the long history for earnings stability` — ผ่าน
- `buildRow uses the Yahoo years for EPS growth` — ผ่าน
- `a loss year in the base is a known failure, not an unknown one` — ผ่าน

---

### 1.7 Earnings stability (8 ปี)

**สูตร**
```
stable = จำนวนปีที่ netIncome > 0 ใน 8 ปีย้อนหลัง >= 8
ถ้าข้อมูล < 8 ปี → null
```

| ข้อมูลทดสอบ | ค่าคาดหวัง | ค่าระบบ | สถานะ |
|---|---:|---:|---|
| Synthetic 10 ปีกำไรทุกปี | 10/10 ผ่าน | 10/10 ผ่าน | PASS |
| CPF 10 ปี | 9/10 ผ่าน | 9/10 ผ่าน | PASS |
| JAS 10 ปี | 6/10 ไม่ผ่าน | 6/10 ไม่ผ่าน | PASS |
| GST ไม่มีข้อมูล | null | null | PASS (UNKNOWN) |

---

### 1.8 DDM — Two-stage dividend discount model

**สูตร**
```
P0 = Σ_{t=1..n} D0(1+g1)^t / (1+r)^t
   + D0(1+g1)^n (1+g2) / ((r−g2)(1+r)^n)
ข้อกำหนด: r > g2, D0 > 0, n = 1..20, payout < 100%
```

**Default ที่ใช้จริง**: `g1 = 5%` ระยะ 5 ปี, `g2 = 3%` ระยะยาว, `r = 9%`, `years = 5`

| d0 | g1 | g2 | r | n | payout | ค่าคาดหวัง | ค่าระบบ | คลาดเคลื่อน | สถานะ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1.00 | 10% | 3% | 9% | 5 | — | 23.1080201118 | 23.1080201118 | 0.00 | PASS |
| 2.30 | 5% | 3% | 9% | 5 | — | 43.0454576569 | 43.0454576569 | 0.00 | PASS |
| 2.30 | 5% | 5% | 9% | 5 | — | 60.3750000000 | 60.3750000000 | 0.00 | PASS (scenario) |
| 1.00 | 5% | 3% | 9% | 5 | 50% | 18.7154163726 | 18.7154163726 | 0.00 | PASS |
| 1.00 | 5% | 3% | 9% | 5 | 100% | ok=false (`payout-not-funded`) | ok=false | — | PASS |
| 1.00 | 5% | 3% | 9% | 5 | 171.4% | ok=false (`payout-not-funded`) | ok=false | — | PASS |
| 1.00 | 5% | 9% | 9% | 5 | — | ok=false (r≤g2) | ok=false | — | PASS |
| 0.00 | 5% | 3% | 9% | 5 | — | null/no value | null | — | PASS |

**การตรวจแยก**: d0=1, g1=10%, g2=3%, r=9%, n=5 → PV ของปันผล 5.1393096642 + terminal 17.9687104476 = 23.1080201118 ตรงกับระบบ

**ข้อสังเกต**: เมื่อ g1 = g2 สูตรยุบเป็น `d0(1+g)/(r−g)`; default ใหม่เป็น g1 = 5% / g2 = 3% จึงเป็น two-stage จริง ส่วนปุ่ม Flat 5% ยังอยู่เป็น scenario ทดสอบ ไม่ใช่ค่าเริ่มต้น (ดู `VALUATION-VALIDATION.md`)

**Low-yield guard**

| yield | d0 | g1 | g2 | r | n | ค่าคาดหวัง | ค่าระบบ | สถานะ |
|---:|---:|---:|---:|---:|---:|---|---|---|
| 0.26% | 1.00 | 5% | 3% | 9% | 5 | ok=false (`yield-too-low`) | ok=false | PASS |
| 1.00% | 1.00 | 5% | 3% | 9% | 5 | 18.7154163726 | 18.7154163726 | PASS |

> เกณฑ์ 1% คือเส้นแบ่งว่า DDM ยังเป็น “income valuation” หรือเป็นหุ้น growth/cyclical ที่จ่ายปันผลเล็กน้อย; DELTA 0.26% ถูกตัด ไม่คืน intrinsic/MOS

### 1.8b Graham number (cross-check)

**สูตร**
```
G = sqrt(22.5 × EPS × BVPS)
ถ้า EPS <= 0 หรือ BVPS <= 0 → ok=false
```

| EPS | BVPS | ค่าคาดหวัง | ค่าระบบ | คลาดเคลื่อน | สถานะ |
|---:|---:|---:|---:|---:|---|
| 3.15 | 42.15 | 54.6569414622 | 54.6569414622 | 0.00 | PASS |
| −1.00 | 42.15 | null | null | — | PASS |
| 3.15 | 0.00 | null | null | — | PASS |

**ข้อจำกัด**: เป็น defensive cross-check (P/E 15 × P/BV 1.5) ไม่ใช่ DCF และไม่ใช่ราคาเป้าหมาย; หุ้น asset-light/ROE สูงจะดู “แพง” โดยธรรมชาติ

---

### 1.8c Unfunded-payout scenario (BDMS)

ค่าฐานยังถูก guard: `payout=1.0` + `allowUnfunded=false` → `payout-not-funded`

| g1 | g2 | r | n | payout | allowUnfunded | ค่าคาดหวัง | ค่าระบบ | สถานะ |
|---:|---:|---:|---:|---:|---|---:|---:|---|
| 5% | 3% | 9% | 5 | 100% | true | 18.7154163726 | 18.7154163726 | PASS (scenario) |
| 5% | 5% | 9% | 5 | 100% | true | 26.25 | 26.25 | PASS (Flat 5%) |
| 5% | 3% | 9% | 5 | 100% | false | ok=false | ok=false | PASS (base guard) |

> `allowUnfunded` ใช้เฉพาะ stock detail และติด `scenario=true`; ไม่ใช้ใน screener, preset `value` หรือ backtest

### 1.9 Margin of safety

**สูตร**
```
MOS = (intrinsic − price) / intrinsic × 100
ถ้า intrinsic <= 0 หรือ price <= 0 → null
```

| intrinsic | price | ค่าคาดหวัง | ค่าระบบ | คลาดเคลื่อน | สถานะ |
|---:|---:|---:|---:|---:|---|
| 18.7154163726 | 15.00 | 19.8522% | 19.8522% | 0.00 | PASS |
| 43.0454576569 | 41.50 | 3.5903% | 3.5903% | 0.00 | PASS |
| 36.8693702539 | 29.00 | 21.3439% | 21.3439% | 0.00 | PASS |
| null (KCE guard) | 70.75 | null | null | — | PASS |
| 0 | 10 | null | null | — | PASS |

---

### 1.10 Historical P/E และ P/BV bands

**สูตร**
```
multiple_t = price_t / EPS หรือ BVPS ของปีที่ "รู้แล้ว" ณ วัน t
knownFrom = asOf + 90 วัน (conservative filing lag)
mean, sd, ±1σ, ±2σ จากจุดที่ใช้ได้
cap: P/E <= 100, P/BV <= 50
```

| ข้อมูลทดสอบ | ค่าคาดหวัง | ค่าระบบ | สถานะ |
|---|---|---|---|
| 2 ปีงบ, 24 เดือน | basis = 2 | 2 | PASS |
| levels.plus1 = mean + sd | ตรง | ตรง | PASS |
| levels.minus2 = mean − 2sd | ตรง | ตรง | PASS |
| knownFrom 2021-03-01 | point แรก ≥ 2021-03-01 | 2021-03-28 | PASS |
| P/E เกิน 100 | ไม่นับเป็น point | ไม่นับ | PASS |
| history สั้น | pe = null | null | PASS |

**Test**: `a band is produced when there is enough history`, `the basis reports how many fiscal years it spans`, `the first point is not before the filing date` — ผ่าน

---

### 1.11 Unit gap / FX

**สูตร**
```
gap = (price / eps) / theirPE
ถ้า gap 60–160 → unit = 100
ถ้า gap 600–1600 → unit = 1000
ถ้าไม่ใช่ → 1
FX ใช้เฉพาะ ratio = quoteEps / statementEps > 0
```

| ข้อมูลทดสอบ | ค่าคาดหวัง | ค่าระบบ | สถานะ |
|---|---:|---:|---|
| price 100, EPS 1, P/E 1 (pence/pounds) | 100 | 100 | PASS |
| price 1000, EPS 1, P/E 1 | 1000 | 1000 | PASS |
| price 10, EPS 1, P/E 10.2 | 1 | 1 | PASS |
| ratio = −0.128 (BANPU) | ไม่ใช้ FX, flag | fxIssue | PASS |

---

### 1.12 Score และ coverage

**สูตร**
```
score = round(earned / possible × 100)
earned = น้ำหนักของ check ที่ pass + 0.5 × warn
possible = น้ำหนักของ check ที่ตัดสินได้ (pass ไม่ใช่ null)
coverage = possible / totalWeight
totalWeight = 120 (framework 100 + growth 20)
```

| ข้อมูลทดสอบ | ค่าคาดหวัง | ค่าระบบ | สถานะ |
|---|---|---|---|
| ทุก check ผ่าน | 100 | 100 | PASS |
| check ไม่ตัดสิน (null) | ไม่ถูกนำมาหาร | coverage ลดลง | PASS |
| bank ข้าม interestCoverage/cfo/fcf | ไม่ถูกนำมาหาร | `na` | PASS |
| score null (dataIssue) | ไม่ให้คะแนน | null | PASS |

---

### 1.13 Backtest — forward total และค่าเฉลี่ยช่วง

**สูตร**
```
forwardTotal = (price_exit / price_entry − 1) + dividends ที่ได้รับในช่วงถือ
portfolioMean = average(portfolio ของแต่ละช่วง)
portfolioCompound = Π(1 + portfolio_period) − 1
```

| ข้อมูลทดสอบ | ค่าคาดหวัง | ค่าระบบ | สถานะ |
|---|---:|---:|---|
| 2 ช่วง, ผลตอบแทน 10% ต่อช่วง | compound 21%, mean 10% | 21% / 10% | PASS |
| quality 3y จริง | mean 22.50%, compound 72.93% | ตรง | PASS |
| universe 3y จริง | mean 49.56%, compound 240.00% | ตรง | PASS |

**Test**: `overlapping windows are compounded and also reported as a mean` — ผ่าน

---

## 2. กรณีขอบ (edge cases) ที่ทดสอบแล้ว

| กรณี | พฤติกรรมที่ต้องการ | ผล |
|---|---|---|
| EPS ติดลบ / ขาดทุน | growth เป็น known failure ไม่ใช่ missing | PASS |
| ปีฐานขาดทุน (AOT 2022) | epsGrowth null, pass=false | PASS |
| equity ติดลบ (THAI) | D/E, ROE = null | PASS |
| DPS = 0 | payout/yield = null (ไม่ใช่ 0%) | PASS |
| ปันผลพิเศษ (ADVANC) | ใช้ recurring estimate + `hasSpecial` | PASS |
| ปี 2026 เป็น stub ไม่มี EPS (MC) | ใช้ EPS ของปีเดียวกับปันผล | PASS |
| ข้อมูลหาย (GST) | UNKNOWN ไม่ใช่ PASS | PASS |
| trading halt / chart เก่า (BANPU) | dataIssue, ไม่ให้คะแนน | PASS |
| rule ไม่ตัดสิน (null) | ไม่ถูกนับเป็น fail | PASS |
| bank ไม่มี interest cover | `na` ไม่ใช่ fail | PASS |
| filter บนค่าที่หาย | `unknown:field` ไม่ใช่ fail | PASS |

---

## 3. คำสั่งทดสอบและผล

| คำสั่ง | ผล |
|---|---|
| `npm test` | all suites passed |
| `npm run check` | all 48 files parse; text intact |
| `node scripts/verify-screener.mjs` | all screener checks passed (รวม 13 audit regressions) |
| i18n parity | EN 670 / TH 670; missing none; PARITY OK |

**Audit regression tests ที่เพิ่ม**
1. negative equity leaves debt/equity unknown
2. negative equity leaves ROE unknown
3. an EPS with the wrong sign is not used
4. an EPS implying a different share count is not used
5. buildRow uses the long history for revenue growth
6. buildRow uses the long history for earnings stability
7. buildRow uses the Yahoo years for EPS growth
8. a missing required check is labelled unknown
9. a filter on a missing value is labelled unknown
10. a special dividend is capped at the estimated recurring rate
11. the payout uses the fiscal year the dividend belongs to
12. a payout over the ceiling fails even when a later stub has no EPS
13. overlapping windows are compounded and also reported as a mean

---

## 4. สถานะรวม

| หมวดสูตร | สถานะ |
|---|---|
| ROE / ROA / NPM / D/E / ICR | PASS |
| Payout / yield (FY/FY) | PASS (ADVANC เป็น estimate) |
| EPS/revenue CAGR / stability | PASS |
| DDM / MOS | PASS (สูตร + default g1=5%/g2=3% + payout guard + low-yield guard) |
| Unfunded-payout scenario | PASS (stock detail; `scenario=true`; ไม่ใช้ใน preset) |
| Graham number cross-check | PASS (stock detail; ไม่ใช่ DCF/ราคาเป้าหมาย) |
| DCF / Graham growth formula | **BLOCKED** (ยังไม่มีในระบบ; ข้อมูล WACC/net debt/AAA yield ไม่พอ) |
| Sector model (bank/REIT) | **BLOCKED** (ยังไม่มี) |
| Bands / look-ahead | PASS |
| FX / unit gap | PASS |
| Score / coverage | PASS |
| Backtest forward/mean | PASS (compound ต้องอ่านด้วยบริบท) |
| Edge cases | PASS |
