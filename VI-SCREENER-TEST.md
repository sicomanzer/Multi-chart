# VI Screener Test — Multi-chart

วันที่ทดสอบ: 2026-10-23  
จักรวาลที่ทดสอบ: `set-large` (SET Large Caps), `SET100`, union ของทั้งสอง, และรายชื่อเฉพาะ  
เป้าหมาย: ตรวจว่าเงื่อนไขหลายข้อทำงานถูก, ข้อมูลไม่พอเป็น UNKNOWN ไม่ใช่ PASS, และ preset ไม่ให้ผลลัพธ์ที่ทำให้เข้าใจผิด

> **สำคัญ**: screener เป็น "ตัวกรองตาม mandate" ไม่ใช่คำแนะนำซื้อ และไม่รับประกันผลตอบแทน  
> คะแนนสูงไม่ได้แปลว่าราคาถูก; คะแนนต่ำไม่ได้แปลว่าบริษัทแย่ — ต้องดู valuation และความเสี่ยงประกอบ

---

## 1. Preset และเงื่อนไข

### 1.1 ตาราง preset

| Preset | เงื่อนไขบังคับ (requires) | minScore | sort | หมายเหตุ |
|---|---|---:|---|---|
| `moat` | dividendYield, roeLevel, dividendStreak, cfoPositive | 65 | score | ต้องมีปันผล + ROE 3y ≥15% + ปันผลต่อเนื่อง + CFO บวก |
| `quality` | roeLevel, roaLevel, fcfPositive | 60 | score | คุณภาพกิจการ |
| `dividend` | dividendYield, dividendStreak, payoutBand | 55 | yield | สายปันผลทั่วไป |
| `income` | dividendYield, roeConsistency, roaLevel, cfoPositive, payoutCeiling | 70 | yield | "นอนหลับสบาย": ปันผล ≥4%, ROE 3/4 ปี ≥15%, ROA ≥7%, CFO บวก, payout ≤80% |
| `value` | — | 50 | mos | ต้องมี MOS ≥ 0 |
| `all` | — | 0 | score | ไม่กรอง |

### 1.2 เงื่อนไข `income` ทีละข้อ

| Check | เงื่อนไข | น้ำหนัก | ค่าที่ใช้ |
|---|---|---:|---|
| `dividendYield` | FY DPS / ราคา ≥ 4% | 7 | 7 คะแนน |
| `roeConsistency` | ROE ≥15% อย่างน้อย 3 ใน 4 ปีล่าสุด | 8 | 3 of 4 |
| `roaLevel` | ROA เฉลี่ย 3 ปี ≥7% | 6 | 7% |
| `cfoPositive` | CFO บวก 3/3 ปี (ธนาคาร = NA) | 8 | 3 of 3 |
| `payoutCeiling` | payout ≤80% | 0 (gate) | 80% |
| `minScore` | คะแนนรวม ≥70 | — | 70 |

**หลักการ**: `payoutCeiling` เป็น gate ไม่ใช่น้ำหนัก เพราะ payout ถูกให้คะแนนแล้วใน `payoutBand`; การให้คะแนนซ้ำจะ double-count

---

## 2. การทดสอบเงื่อนไขหลายข้อ

### 2.1 ตรรกะที่ต้องการ

1. ทุกเงื่อนไขบังคับต้องผ่าน → จึงเข้า preset
2. เงื่อนไขที่ **ไม่มีข้อมูล** → UNKNOWN (ไม่ผ่าน แต่ไม่ใช่ fail)
3. เงื่อนไขที่ **ไม่เกี่ยวกับธุรกิจ** (interest cover/CFO ของธนาคาร) → `na` และข้าม
4. ตัวกรองของผู้ใช้ (filters) ที่ไม่มีค่า → `unknown:field`
5. แถวที่ข้อมูลเสีย (`dataIssue`) → ไม่ให้คะแนน และไม่ถูกตีความเป็น 0

### 2.2 ผลทดสอบ

| กรณี | ค่าคาดหวัง | ผลระบบ | สถานะ |
|---|---|---|---|
| ทุก check ผ่าน + score ≥70 | pass | pass | PASS |
| check หนึ่งเป็น null (payout) | `unknown:payoutCeiling` | `unknown:payoutCeiling` | PASS |
| check หนึ่ง fail | `requires:<id>` | `requires:<id>` | PASS |
| filter บน P/E ที่มีค่า | pass/fail ตามเงื่อนไข | ตรง | PASS |
| filter บน P/E ที่ null | `unknown:pe` | `unknown:pe` | PASS |
| bank ไม่มี interest cover | `na` ไม่ใช่ fail | `na` | PASS |
| dataIssue (BANPU) | `unknown:data`, score null | ตรง | PASS |
| score null | ไม่แสดงเป็น 0 | `—` | PASS |

**Test cases**: `a missing required check is labelled unknown`, `a filter on a missing value is labelled unknown`, `a bank is not failed for missing interest cover`, `an unevaluated rule still leaves the rest of the score intact`

---

## 3. ผล screen จริง

### 3.1 แปดหลักทรัพย์ (หลังแก้)

| Symbol | Score | Yield | Payout | P/E | P/BV | DDM | MOS | จุดสำคัญ |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| BANPU | null | — | — | — | — | — | — | `dataIssue=eps-sign-conflict`; ไม่ให้คะแนน |
| PTT | 64 | 5.54% | 73.02% | 9.56 | 0.98 | 43.05 | +3.6% | ROE 8.7%, ROA 2.85% → income ไม่ผ่าน |
| ADVANC | 87 | 4.47% | 93.24% | 18.67 | 19.12 | 280.93 | −19.6% | special dividend; payout เกิน 80% |
| CPF | 57 | 6.25% | 40.06% | 10.52 | 0.73 | 23.39 | +14.5% | ROE/ROA ต่ำ; income score <70 |
| SCB | 46 | 7.45% | 80.00% | 11.72 | 1.05 | 211.11 | +28.2% | bank; ROA < 7% |
| TVO | 85 | 6.79% | 80.08% | 9.95 | 2.13 | 36.87 | +21.3% | payout เกิน 0.08 pp |
| KCE | 53 | 1.70% | 171.43% | 89.84 | 6.45 | — | — | `payout-not-funded`; yield ต่ำ |
| DELTA | 86 | 0.26% | 30.15% | 97.50 | 27.69 | 11.23 | −1983.8% | DDM ไม่เหมาะกับ growth/cyclical |

> BANPU เป็น `—` ทุกช่องเพราะ `dataIssue`; ค่าที่เหลือมาจาก stock detail ณ วันเดียวกับราคา  
> DDM ใช้ default g1 = 5% ระยะ 5 ปี, g2 = 3% ระยะยาว, r = 9%; MC (payout 100%) และ ICHI (107.8%)/BDMS (100%) ก็ถูก guard เป็น `—` เช่นกัน

### 3.2 Income preset — สมาชิกที่ผ่าน

| Symbol | Score | Yield | Payout | DPS | FY | หมายเหตุ |
|---|---:|---:|---:|---:|---:|---|
| KAMART | 93 | 6.24% | 80.00% | 0.44 | 2025 | ผ่านแบบ exact ที่ 80.0% |
| TTW | 86 | 6.03% | 73.17% | 0.60 | 2025 | ผ่าน |
| PRM | 90 | 5.71% | 52.08% | 0.50 | 2025 | ผ่าน (SET100) |
| PTTEP | 83 | 5.37% | 57.64% | 8.75 | 2025 | ผ่าน |
| MEGA | 83 | 4.64% | 73.06% | 1.60 | 2025 | ผ่าน |

### 3.3 Income preset — ใกล้ผ่านแต่ถูกตัด

| Symbol | Score | Yield | Payout | เหตุผล |
|---|---:|---:|---:|---|
| MC | 91 | 8.42% | 100.00% | `requires:payoutCeiling` (ไม่ใช่ unknown) |
| ICHI | 95 | 7.97% | 107.80% | `requires:payoutCeiling` |
| TVO | 85 | 6.79% | 80.08% | `requires:payoutCeiling` (เกิน 0.08 pp) |
| TACC | 80 | 6.56% | 84.00% | `requires:payoutCeiling` |
| BDMS | 88 | 5.15% | 100.00% | `requires:payoutCeiling` |
| ADVANC | 87 | 4.47% | 93.24% | `requires:payoutCeiling` |
| BH | 94 | 2.52% | 57.70% | `requires:dividendYield` |
| OSP | 83 | 4.44% | 65.60% | `requires:roeConsistency` |
| TFG | 83 | 7.55% | 56.30% | `requires:roaLevel` |

### 3.4 สมาชิกก่อน/หลังตามจักรวาล

| จักรวาล | ก่อนแก้ | หลังแก้ |
|---|---|---|
| union (SET100 ∪ SET_LARGE_CAPS) | TVO, TACC, TTW, PRM, PTTEP, MEGA (6) | KAMART, TTW, PRM, PTTEP, MEGA (5) |
| set-large | — | KAMART, TTW, PTTEP, MEGA (4) |
| SET100 | — | PRM, PTTEP, MEGA (3) |

**สาเหตุที่เปลี่ยน**: ข้อมูล payout ถูกแก้จาก TTM เป็น FY/FY; TVO 67.56→80.08%, TACC 84.0%, MC 100%; KAMART 80.0% ผ่าน; **ไม่ได้เปลี่ยน threshold ของ preset**

**จุดตัดสินใจ**: TVO เกิน ceiling 0.08 pp — ถ้าผู้ใช้ต้องการให้ TVO อยู่ในพอร์ต ต้องตัดสินใจเปลี่ยนเกณฑ์เป็น ≥80.1% หรือคงเกณฑ์เดิม; รายงานนี้ไม่เปลี่ยนแทน

---

## 4. กรณีขอบที่ทดสอบกับ screener

| กรณี | ตัวอย่าง | ผลที่ต้องการ | ผลระบบ |
|---|---|---|---|
| ข้อมูลเสีย/หยุดซื้อขาย | BANPU | ไม่ให้คะแนน, `unknown:data` | ตรง |
| ปีล่าสุดเป็น stub | MC | payout ใช้ปีเดียวกับปันผล → 100% fail | ตรง |
| ปันผลพิเศษ | ADVANC | recurring estimate + `hasSpecial` | ตรง |
| ขาดทุนปีฐาน | AOT 2022 | epsGrowth null, pass=false | ตรง |
| equity ติดลบ | THAI | D/E/ROE null | ตรง |
| EPS ขัด NI | TU 2023 | EPS null (sign guard) | ตรง |
| ข้อมูล long history ไม่พอ | GST | growth null (UNKNOWN) | ตรง |
| bank | SCB/BBL/KBANK | interestCover/CFO/FCF = na; ROA ยังต้องผ่าน | ตรง |
| ปันผล = 0 | DELTA | yield/payout null; ไม่ใช่ 0% | ตรง |
| score null | BANPU | แสดง `—` | ตรง |

---

## 5. ข้อจำกัดของ screener

1. **ไม่ใช่คำแนะนำซื้อ**: เป็น filter ตาม mandate; ต้องดูราคา/valuation/ความเสี่ยง
2. **จักรวาลเปลี่ยนผล**: income ให้ 4 ตัวบน set-large, 3 ตัวบน SET100, 5 ตัวบน union — ไม่มี "พอร์ตตายตัว"
3. **แบงก์**: ROA <7% ทำให้แบงก์ส่วนใหญ่ไม่ผ่าน income; นี่เป็นข้อจำกัดของเกณฑ์ ไม่ใช่ bug
4. **Survivorship/revision bias**: SET100 ปัจจุบันย้อนหลัง; ข้อมูลงบอาจถูก revise
5. **Backtest ตัวอย่างเล็ก**: 4 ช่วง 3 ปี, n 1.8–2.0 ต่อช่วง; ดู `FINANCIAL-DATA-AUDIT.md`
6. **DDM อย่างเดียว**: ไม่มี DCF/Graham; `value` preset ใช้ MOS จาก DDM; default ใหม่ g1=5%/g2=3% และ KCE/MC ถูก guard แต่ DELTA/ธนาคารยังเป็น model-fit risk
7. **ข้อมูล long history**: 109 symbols; GST ยังขาด; หุ้นนอกไฟล์ได้ growth UNKNOWN

---

## 6. สถานะรวม

| หมวด | สถานะ |
|---|---|
| เงื่อนไขหลายข้อ / requires | PASS |
| UNKNOWN vs FAIL | PASS |
| NA สำหรับธนาคาร | PASS |
| Filters | PASS |
| Income preset (ข้อมูลแก้แล้ว) | PASS — สมาชิกเปลี่ยนตามข้อมูล |
| BANPU dataIssue | PASS |
| MC stub payout | PASS |
| DDM default g1=5%/g2=3% | PASS |
| DDM payout guard (KCE/MC) | PASS |
| DDM model fit (DELTA/DCF/sector) | RISK (OPEN) |
| Special dividend | PASS (estimate) |
| Coverage/universe | PARTIAL (GST BLOCKED) |
| Backtest/valuation caveats | PASS (รายงานแล้ว) |
