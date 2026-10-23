# Valuation Validation — Multi-chart

วันที่ตรวจ: 2026-10-23 (รอบที่ 2 หลังแก้ default/guard)  
ขอบเขต: intrinsic value, margin of safety, DDM, historical P/E–P/BV bands และ sensitivity  
ข้อสรุปสั้น: **สูตร DDM ถูกต้อง (PASS)**; **default เปลี่ยนเป็น g1 = 5% / g2 = 3% แล้ว (PASS)**; **KCE/MC ถูก guard ไม่ให้ DDM ประเมิน (PASS)**; แต่ **DCF/Graham ยังไม่มี (BLOCKED)** และ **DELTA/ธนาคารยังเป็น model-fit risk**

> ระบบนี้ไม่มี DCF และไม่มี Graham formula ในโค้ด — มีเพียง two-stage DDM, MOS และ historical bands  
> รายงานนี้จึงไม่ถือว่า DCF/Graham “ผ่าน”; ระบุเป็น BLOCKED ตามความเป็นจริง

---

## 1. สิ่งที่มีในระบบ

| เครื่องมือ | สถานะ | ใช้ที่ไหน |
|---|---|---|
| Two-stage DDM | มี | ตาราง screener, stock detail, calculator |
| Margin of safety (MOS) | มี | ตาราง, preset `value` |
| Historical P/E band | มี | stock detail |
| Historical P/BV band | มี | stock detail |
| Sensitivity sliders (r, g1, g2, years) | มี (manual) | calculator |
| DCF | **ไม่มี** | — |
| Graham formula | **ไม่มี** | — |
| Sector-specific model (bank/REIT) | **ไม่มี** | — |

---

## 2. DDM — สูตรและการตรวจ

### 2.1 สูตร

```
P0 = Σ_{t=1..n} D0(1+g1)^t / (1+r)^t
   + D0(1+g1)^n (1+g2) / ((r−g2)(1+r)^n)
```

เงื่อนไข: `D0 > 0`, `r > g2`, `n = 1..20`, และ **payout < 100%**  
ค่า default: `g1 = 5%`, `g2 = 3%`, `r = 9%`, `years = 5`  
ค่า default ของฟังก์ชัน `ddm()`: `g2 = 3%` (ตรงกับ `DEFAULTS` แล้ว)

### 2.2 ผลทดสอบสูตร

| d0 | g1 | g2 | r | n | payout | ค่าคาดหวัง | ค่าระบบ | คลาดเคลื่อน | สถานะ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1.00 | 10% | 3% | 9% | 5 | — | 23.1080201118 | 23.1080201118 | 0.00 | PASS |
| 2.30 | 5% | 3% | 9% | 5 | — | 43.0454576569 | 43.0454576569 | 0.00 | PASS |
| 1.00 | 5% | 3% | 9% | 5 | 50% | 18.7154163726 | 18.7154163726 | 0.00 | PASS |
| 1.00 | 5% | 3% | 9% | 5 | 100% | ok=false (`payout-not-funded`) | ok=false | — | PASS |
| 1.00 | 5% | 3% | 9% | 5 | 171.4% | ok=false (`payout-not-funded`) | ok=false | — | PASS |
| 1.00 | 5% | 9% | 9% | 5 | — | ok=false (`r-not-above-g2`) | ok=false | — | PASS |
| 0.00 | 5% | 3% | 9% | 5 | — | ok=false (`no-dividend`) | ok=false | — | PASS |

**ตรวจแยก**: d0=1, g1=5%, g2=3%, r=9%, n=5 → PV ปันผล 4.4757445629 + terminal 14.2396718097 = 18.7154163726

### 2.3 ค่า intrinsic จริง (default g1 = 5%, g2 = 3%)

| Symbol | d0 | ราคา | Intrinsic | MOS | หมายเหตุ |
|---|---:|---:|---:|---:|---|
| PTT | 2.30 | 41.50 | 43.05 | **+3.6%** | payout 73.0% |
| ADVANC | 15.01 | 336.00 | 280.93 | **−19.6%** | special; official regular 15.30 |
| TVO | 1.97 | 29.00 | 36.87 | **+21.3%** | payout 80.08% |
| CPF | 1.25 | 20.00 | 23.39 | **+14.5%** | payout 40.06% |
| SCB | 11.28 | 151.50 | 211.11 | **+28.2%** | bank |
| KCE | 1.20 | 70.75 | **null** | **null** | `payout-not-funded` (171.4%) |
| DELTA | 0.60 | 234.00 | 11.23 | −1983.8% | DDM ไม่เหมาะกับ growth/cyclical |
| MC | 0.96 | 11.40 | **null** | **null** | `payout-not-funded` (100%) |
| PTTEP | 8.75 | 163.00 | 163.76 | +0.5% | payout 57.6% |
| MEGA | 1.60 | 34.50 | 29.94 | −15.2% | payout 73.1% |
| TTW | 0.60 | 9.95 | 11.23 | +11.4% | payout 73.2% |
| KAMART | 0.44 | 7.05 | 8.23 | +14.4% | payout 80.0% |
| PRM | 0.50 | 8.75 | 9.36 | +6.5% | payout 52.1% |

**เทียบก่อน/หลังแก้ default**

| Symbol | MOS เดิม (g1=g2=5%) | MOS ใหม่ (g1=5%, g2=3%) | เปลี่ยน |
|---|---:|---:|---:|
| PTT | +31.3% | +3.6% | −27.7 pp |
| ADVANC | +14.7% | −19.6% | −34.3 pp |
| TVO | +43.9% | +21.3% | −22.6 pp |
| CPF | +39.0% | +14.5% | −24.5 pp |
| SCB | +48.8% | +28.2% | −20.6 pp |
| PTTEP | +29.0% | +0.5% | −28.5 pp |
| MEGA | +17.9% | −15.2% | −33.1 pp |
| KAMART | +39.0% | +14.4% | −24.6 pp |
| PRM | +33.3% | +6.5% | −26.8 pp |

> การแก้ default ทำให้ DDM เป็น two-stage จริง (g1 ≠ g2) และลด overvaluation ของกลุ่ม payout สูง/ROE ต่ำลงอย่างมีนัย

---

## 3. Sensitivity — ช่วงของมูลค่า

### 3.1 PTT (d0 = 2.30, price = 41.50, g1 = 5%)

| r \\ g2 | 2% | 3% (default) | 4% |
|---|---:|---:|---:|
| 8% | 44.54 (+6.8%) | 51.73 (+19.8%) | 62.52 (+33.6%) |
| 9% | 38.09 (−8.9%) | **43.05 (+3.6%)** | 49.98 (+17.0%) |
| 10% | 33.26 (−24.8%) | 36.84 (−12.6%) | 41.62 (+0.3%) |

### 3.2 ADVANC (d0 = 15.0109, price = 336, g1 = 5%)

| r \\ g2 | 2% | 3% (default) | 4% |
|---|---:|---:|---:|
| 8% | 290.68 (−15.6%) | 337.62 (+0.5%) | 408.03 (+17.7%) |
| 9% | 248.62 (−35.1%) | **280.93 (−19.6%)** | 326.17 (−3.0%) |
| 10% | 217.09 (−54.8%) | 240.46 (−39.7%) | 271.61 (−23.7%) |

### 3.3 SCB (d0 = 11.28, price = 151.50, g1 = 5%)

| r \\ g2 | 2% | 3% (default) | 4% |
|---|---:|---:|---:|
| 8% | 218.44 (+30.6%) | 253.71 (+40.3%) | 306.62 (+50.6%) |
| 9% | 186.83 (+18.9%) | **211.11 (+28.2%)** | 245.11 (+38.2%) |
| 10% | 163.13 (+7.1%) | 180.69 (+16.2%) | 204.10 (+25.8%) |

### 3.4 TVO (d0 = 1.97, price = 29, g1 = 5%)

| r \\ g2 | 2% | 3% (default) | 4% |
|---|---:|---:|---:|
| 8% | 38.15 (+24.0%) | 44.31 (+34.6%) | 53.55 (+45.8%) |
| 9% | 32.63 (+11.1%) | **36.87 (+21.3%)** | 42.81 (+32.3%) |
| 10% | 28.49 (−1.8%) | 31.56 (+8.1%) | 35.65 (+18.6%) |

**ข้อสรุป sensitivity**: แม้ default ใหม่จะสมเหตุสมผลขึ้น แต่ MOS ยังแกว่งมากตาม r/g2  
→ **ห้ามใช้ point estimate เป็น “มูลค่าที่ควรเป็น” โดยไม่ดูช่วง**; ระบบมี sliders แต่ยังไม่มี sensitivity matrix อัตโนมัติ

---

## 4. ความเหมาะสมของโมเดล (model fit)

### 4.1 Sustainable growth = ROE × (1 − payout)

| Symbol | ROE 3y | Payout | g_sustainable | g1 (5y) | g2 (terminal) | สรุป |
|---|---:|---:|---:|---:|---:|---|
| PTT | 8.70% | 73.02% | 2.35% | 5% | 3% | g1 สูงกว่า sustainable; g2 ใกล้เคียง |
| SCB | 9.34% | 80.00% | 1.87% | 5% | 3% | g2 สูงกว่า sustainable |
| CPF | 5.11% | 40.06% | 3.06% | 5% | 3% | g2 ใกล้เคียง |
| TVO | 15.56% | 80.08% | 3.10% | 5% | 3% | g2 ใกล้เคียง |
| ADVANC | 39.07% | 93.24% | 2.64% | 5% | 3% | g2 สูงกว่า sustainable เล็กน้อย |
| PTTEP | 14.06% | 57.64% | 5.96% | 5% | 3% | อนุรักษ์นิยม |
| MEGA | 20.69% | 73.06% | 5.57% | 5% | 3% | อนุรักษ์นิยม |
| TTW | 19.28% | 73.17% | 5.17% | 5% | 3% | อนุรักษ์นิยม |
| KAMART | 23.30% | 80.00% | 4.66% | 5% | 3% | ใกล้เคียง |
| PRM | 18.91% | 52.08% | 9.06% | 5% | 3% | อนุรักษ์นิยม |
| KCE | 10.30% | 171.43% | −7.36% | — | — | **DDM ถูก guard** |
| MC | 19.48% | 100.00% | 0.00% | — | — | **DDM ถูก guard** |
| DELTA | 27.97% | 30.15% | 19.54% | 5% | 3% | **DDM ไม่เหมาะ** (growth/cyclical) |

### 4.2 ข้อค้นพบด้านความเหมาะสม

1. **default ใหม่เป็น two-stage จริง**: g1 = 5% ระยะ 5 ปี, g2 = 3% ระยะยาว; ไม่ยุบเป็น Gordon แล้ว
2. **g2 = 3% ใกล้ long-run inflation/GDP** และใกล้ sustainable growth ของ PTT/CPF/TVO มากกว่า 5% เดิม
3. **g1 = 5% ยังเป็น near-term assumption** ที่สูงกว่า sustainable ของ PTT/SCB/ADVANC; เป็นความเสี่ยงของ stage-one
4. **KCE/MC ถูก guard** ด้วย `payout-not-funded` (payout ≥ 100%) → ไม่มี intrinsic/MOS ที่สร้างจากปันผลเกินกำไร; หลักเดียวกันนี้ครอบทุกตัวที่ payout ≥ 100% (เช่น ICHI 107.8%, BDMS 100%)
5. **DELTA ยังไม่ถูก guard**: yield 0.26% และ payout 30% ทำให้ DDM ให้ 11.23 vs ราคา 234 (MOS −1983.8%) — ตัวเลขถูกตามสูตรแต่ไม่เหมาะกับธุรกิจ growth/cyclical; ควรใช้ DCF/relative valuation แทน
6. **ไม่มี DCF/Graham**: บริษัทไม่จ่ายปันผลหรือปันผลต่ำยังไม่มีมูลค่าที่เหมาะสมจากระบบ
7. **ไม่มี sector model**: ธนาคาร/REIT/cyclical ใช้ DDM เดียวกัน; DDM ของ SCB ไม่ได้สะท้อน capital adequacy/credit cycle
8. **ไม่มี sensitivity อัตโนมัติ**: ผู้ใช้ต้องเลื่อน slider เอง; ยังไม่มี range/ตารางใน UI

---

## 5. เทียบกับแหล่งทางการ (ADVANC)

| รายการ | ทางการ | ระบบ | คลาดเคลื่อน |
|---|---:|---:|---:|
| FY2025 regular DPS | 15.30 (6.89 + 8.41) | 15.0109 (estimate) | −1.89% |
| Special DPS | 19.00 | 19.00 (ใน total; cap ออก) | 0% |
| Total DPS | 34.30 | 34.30 (ก่อน cap) | 0% |
| Yield (regular) | 4.554% | 4.468% | −0.086 pp |
| Payout (regular) | 95.031% | 93.235% | −1.796 pp |
| Intrinsic (g1=5%, g2=3%, r=9%) | 286.35 | 280.93 | −1.89% |
| MOS | −17.34% | −19.60% | −2.26 pp |

**สรุป**: การประมาณ recurring dividend ของ ADVANC ใกล้เคียงทางการ (ต่ำกว่า 1.9%) และดีกว่าเดิม (12.63) มาก แต่ยังเป็น **estimate** ไม่ใช่ exact; UI ต้องแสดง `hasSpecial`

---

## 6. Historical bands และ look-ahead

| การตรวจ | ค่าคาดหวัง | ผล | สถานะ |
|---|---|---|---|
| ใช้ EPS/BVPS ของปีที่ "รู้แล้ว" ณ วันนั้น | point แรก ≥ knownFrom | 2021-03-28 ≥ 2021-03-01 | PASS |
| `knownFrom = asOf + 90 วัน` | ไม่ใช้ข้อมูลก่อนประกาศ | ตรง | PASS |
| P/E cap 100 | ค่ามากกว่าไม่ถูกนับ | ตรง | PASS |
| P/BV cap 50 | ค่ามากกว่าไม่ถูกนับ | ตรง | PASS |
| history สั้น | ไม่สร้าง band | pe = null | PASS |
| basis | จำนวนปีที่ใช้ | 2 | PASS |

**ข้อจำกัด**: band เป็น historical multiple ไม่ใช่ intrinsic; บริษัทที่กำไรใกล้ศูนย์ทำให้ P/E ไม่มีความหมาย (cap/กัน noise แล้ว)

---

## 7. ข้อเสนอที่ทำแล้ว / ยังเหลือ

### ทำแล้ว
- เปลี่ยน default `g2` เป็น **3%** ทั้ง server (`DEFAULTS`) และ UI; `g1` ยัง 5% ระยะ 5 ปี
- เพิ่ม **payout guard**: `payout ≥ 100%` → `ok:false`, `reason='payout-not-funded'`, ไม่มี intrinsic/MOS
- เพิ่มข้อความ EN/TH ใน calculator และเทสต์ regression
- คงปุ่ม **Flat 5% scenario** ไว้เป็นกรณีทดสอบ ไม่ใช่ค่าเริ่มต้น

### ยังเหลือ (ต้องตัดสินใจ)
1. เพิ่ม **DCF** สำหรับบริษัทไม่จ่ายปันผล/ปันผลต่ำ และ **Graham** เป็น cross-check
2. เพิ่ม **sensitivity matrix** (r × g2) ใน UI แทน slider เดี่ยว
3. แยกโมเดล **bank/REIT** (capital, NAV, distribution yield) แทน DDM กลาง
4. พิจารณา **low-yield guard** สำหรับ DELTA (yield 0.26%) หรือแสดง warning ว่า DDM ไม่เหมาะ
5. แสดง **range** (bear/base/bull) ไม่ใช่ point estimate

---

## 8. สถานะรวม

| หมวด | สถานะ |
|---|---|
| DDM formula | PASS |
| MOS formula | PASS |
| Historical bands / look-ahead | PASS |
| ADVANC special estimate | PASS (estimate; −1.9%) |
| DDM default g1=5%, g2=3% | **PASS (แก้แล้ว)** |
| DDM กับ KCE/MC | **PASS (guard แล้ว)** |
| DDM กับ DELTA | **RISK (ยังไม่เหมาะ)** |
| DCF | **BLOCKED** (ไม่มีในระบบ) |
| Graham | **BLOCKED** (ไม่มีในระบบ) |
| Sensitivity matrix | **PARTIAL** (มี slider, ไม่มี matrix) |
| Sector model | **BLOCKED** (ไม่มี) |
