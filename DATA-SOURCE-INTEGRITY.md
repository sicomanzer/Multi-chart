# Data Source Integrity — Multi-chart

วันที่ตรวจ: 2026-10-23  
ขอบเขต: แหล่งข้อมูล, ความสด, provenance, การเทียบข้ามแหล่ง, coverage, corporate actions และการป้องกัน look-ahead  
หลักการ: **ไม่มีข้อมูลดีกว่าข้อมูลผิด** — ค่าที่หายต้องเป็น `null`/`UNKNOWN` ไม่ใช่ 0; ค่าที่ขัดกันต้องถูก flag ไม่ใช่เลือกข้างเงียบ ๆ

---

## 1. แหล่งข้อมูลที่ใช้

| แหล่ง | ใช้ทำอะไร | ความสด | ข้อจำกัด |
|---|---|---|---|
| Yahoo Finance quote | ราคา, EPS TTM, BVPS, P/E, P/BV, dividend yield, market cap | real-time/ล่าช้าเล็กน้อย (`regularMarketTime`) | อาจ stale/ผิดสำหรับหุ้นที่มี corporate action |
| Yahoo Finance chart | OHLC/close รายวัน, dividends, splits | รายวัน | chart อาจหยุดก่อน quote (halt) |
| Yahoo Finance statements | annual/quarterly revenue, NI, equity, assets, debt, CFO, EPS | รายปี/รายไตรมาส | annual EPS บางปี mix core/reported |
| Finnomena market-info | long annual history 10 ปี (revenue, NI, EPS, ROE, ROA, D/E, CFO, debt, equity, assets, dividend yield, close) | ไฟล์ `data/annual-history.json` (annual) | bot filter; บาง symbol ไม่มีข้อมูล |
| SET index (set.or.th) | SET100 constituents | รายรอบ | composition เปลี่ยน; survivorship |
| TradingView MCP sidecar | P/E, P/BV, yield, D/E, ROE ใช้ **cross-check** | real-time | นิยาม/งวดต่างจากระบบ |
| ตารางปันผลทางการของบริษัท | ตรวจ ADVANC special/regular | ตามประกาศ | ต้องดึงเอง; ไม่ได้ integrate อัตโนมัติ |

**ลำดับความเชื่อ (สำหรับ audit นี้)**: ประกาศทางการของบริษัท > งบ Yahoo (same source as live) > Finnomena long history > TradingView (cross-check only)  
ระบบไม่ได้ blend แหล่งในสูตรเดียว: live ใช้ Yahoo; long history ใช้ Finnomena; TradingView ใช้ตรวจ ไม่ได้แทนค่า

---

## 2. Provenance ที่ระบบเก็บ

| Field | ความหมาย | ตัวอย่าง |
|---|---|---|
| `priceSource` | ราคามาจาก quote หรือ chart | `quote` |
| `priceDate` | วันที่ของราคาที่ใช้ | `2026-10-22` |
| `chartLastDate` | วัน close ล่าสุดของ chart | `2026-08-11` (BANPU) |
| `staleDays` | จำนวนวันระหว่าง chart กับ quote | `72` |
| `dataIssue` | ปัญหาข้อมูลที่ทำให้ไม่ควรให้คะแนน | `eps-sign-conflict`, `trading-halt` |
| `fxIssue` | ปัญหาการแปลงสกุลเงิน | `eps-sign-conflict` |
| `epsConflict` | EPS ขัดกับ net income/จำนวนหุ้น | `true` |
| `negativeEquity` | equity ≤ 0 | `true` |
| `hasSpecial` | ปันผลมี special | `true` (ADVANC) |
| `knownFrom` | วันที่งบ "รู้แล้ว" (asOf + 90 วัน) | `2021-03-01` |
| `epsBasis` | TTM/quarterly | `trailing` |

---

## 3. การเทียบข้ามแหล่ง (Yahoo vs TradingView)

> ความต่างไม่ใช่ "บั๊ก" โดยอัตโนมัติ — ต้องดูนิยาม/งวด/สกุลเงิน

### 3.1 P/E และ P/BV

| Symbol | Yahoo P/E | TV P/E | Error | Yahoo P/BV | TV P/BV | Error |
|---|---:|---:|---:|---:|---:|---:|
| PTT | 9.558 | 9.559 | +0.01% | 0.9843 | 0.9843 | 0.00% |
| TVO | 9.9455 | 9.9455 | 0.00% | 2.129 | — | — |
| DELTA | 97.50 | 97.78 | +0.29% | 27.69 | — | — |
| ADVANC | 18.67 | 19.12 | +2.41% | 19.12 | — | — |
| AOT | 45.71 | 45.7 | −0.02% | 6.36 | — | — |

**สรุป**: P/E ตรงกันมาก (0–2.4%); P/BV ที่มีทั้งคู่ตรงกันเกือบสมบูรณ์ → ราคา/หุ้น/กำไรไม่ได้ผิดหน่วย  
**หมายเหตุ ADVANC**: P/E 19.12 (TradingView) กับ P/BV 19.12 (Yahoo) เป็นค่าคนละตัวแต่บังเอิญเท่ากัน; อย่าอ่านเป็นค่าเดียวกัน

### 3.2 Dividend yield

| Symbol | ระบบ (FY/FY) | แหล่งอื่น (Yahoo/TV) | ต่าง | คำอธิบาย |
|---|---:|---:|---:|---|
| PTT | 5.542% | 5.153% | −0.389 pp | TV อาจใช้ TTM/คนละวัน |
| ADVANC | 4.468% (FY/FY) | 3.76% (Yahoo quote) / 5.10% (TV) | −0.708 / +0.632 pp | Yahoo/TV ใช้ TTM/คนละการรวม special; ระบบใช้ recurring estimate |
| CPF | 6.250% | 3.48% | −2.77 pp | FY 1.25 vs TTM ต่ำกว่า; คนละงวด |
| TVO | 6.793% | 7.14% | +0.347 pp | TV อาจใช้ DPS/ราคาต่าง |
| BANPU | — (dataIssue) | 5.14% | — | ระบบไม่ให้คะแนนเพราะ EPS/สกุลเงินขัดกัน |

**สรุป**: yield ต่างเพราะ **งวด/การรวม special**; ระบบใช้ FY/FY ซึ่งตรงกับ payout ทางการ (ดู §4)

### 3.3 D/E

| Symbol | ระบบ (annual total debt/equity) | TradingView | ต่าง |
|---|---:|---:|---:|
| PTT | 0.9786 | 0.8776 | −0.101 |
| ADVANC | 2.99 | 5.28 | +2.29 |
| SCB | 6.26 | 0.82 | −5.44 |

**สรุป**: ADVANC/SCB ต่างเพราะนิยามหนี้ (total debt vs financial debt/liabilities) และ annual vs quarterly; SCB เป็นธนาคาร ระบบตั้ง `debtLevel = na` ไม่ใช้ D/E ตัดสิน

### 3.4 ROE

ระบบใช้ **ROE เฉลี่ย 3 ปี** (attributable NI / average parent equity); TradingView มักใช้ **latest/TTM**  
ตัวอย่าง: CPF 2025 ROE ~4.3% แต่ 3y average 5.11%; PTT 2025 ~0.9% แต่ 3y average 8.70%  
→ ตัวเลขต่างได้เพราะงวด; ต้องดูป้าย "3y average" ไม่ใช่ error

### 3.5 BANPU — source conflict ที่ร้ายแรง

| รายการ | ระบบ/Yahoo | TradingView | หมายเหตุ |
|---|---:|---:|---|
| P/BV | 1.168 | 0.47 | สกุลเงิน/equity คนละชุด |
| Yield | 0.0 (ไม่ให้) | 5.14% | ระบบ flag |
| EPS annual vs quote | 2.733 vs −0.35 | — | ratio −0.128 |
| Chart last vs quote | 2026-08-11 vs 2026-10-22 | — | halt 72 วัน |

**การจัดการ**: `fxIssue = eps-sign-conflict`; `dataIssue`; score null; ไม่มี DDM/MOS; UI แสดง warning

---

## 4. ตรวจกับแหล่งทางการ (payout/yield)

| Symbol | ทางการ | ระบบ | Error | สถานะ |
|---|---:|---:|---:|---|
| PTT | 73.016% | 73.016% | 0.000 pp | PASS |
| SCB | 80.000% | 80.000% | 0.000 pp | PASS |
| CPF | 40.064% | 40.064% | 0.000 pp | PASS |
| TVO | 80.081% | 80.081% | 0.000 pp | PASS |
| ADVANC | 95.031% | 93.235% | −1.796 pp | PASS (estimate) |
| MC | 100.000% | 100.000% | 0.000 pp | PASS |

**ADVANC**: regular 15.30 = 6.89 + 8.41; special 19.00; ระบบ estimate 15.0109 จาก prior 10.61 × (6.89/4.87) → −1.89% ใน DPS

---

## 5. Coverage ของ long history

| รายการ | ค่า |
|---|---|
| ไฟล์ | `data/annual-history.json` |
| จำนวน symbols | **109** (เดิม 107 + TVO + JAS) |
| ความยาว | 10 ปี (2016–2025) |
| latest | 2025 |
| generatedAt | `2026-10-23T08:39:10.135Z` |
| source | Finnomena public market-info API |
| backup | `data/annual-history.json.bak-audit` |

### 5.1 ช่องว่างที่ยังเหลือ

| Symbol | สถานะ | ผล |
|---|---|---|
| GST | Finnomena ไม่มีข้อมูล (live คืน null) | growth/stability = UNKNOWN |
| BKIH | 3 ปี | growth 5y/stability 8y = null |
| MRDIYT | 2 ปี | growth = null |
| INETREIT, MOSHI | 5 ปี | stability 8y = null |
| OR, STGT, TIDLOR | 7 ปี | stability 8y = null |
| DOHOME | 9 ปี | stability 8y = null (เกือบครบ) |
| TVO, JAS | เพิ่มแล้ว | table/detail ตรงกัน (score 85/41) |

**หลักการ**: ช่องว่าง → UNKNOWN ไม่ใช่ PASS; ไม่เติม 0

---

## 6. Corporate actions

| กรณี | รายละเอียด | การจัดการ |
|---|---|---|
| BANPU amalgamation | 31 ก.ค. 2026; NewCo 4,049,621,973 หุ้น par 10; chart last 2026-08-11, quote 2026-10-22 | `eps-sign-conflict` + `trading-halt`; ไม่ให้คะแนน |
| GULF/INTUCH merger | 2025 np 80.0B, equity 335.7B (restatement) | **ยังไม่ flag**; growth ข้ามปีอาจไม่ comparable (OPEN) |
| BANPU/BPP | โครงสร้างกลุ่ม/การควบรวม | **ยังไม่ flag** (OPEN) |
| ADVANC special dividend | 19.00 special | `hasSpecial`, recurring estimate, UI `*` |
| Stock splits | Yahoo chart/close split-adjusted; EPS split-adjusted | ใช้ close สำหรับ return; ไม่ปรับซ้ำ |

---

## 7. Look-ahead bias

| จุดเสี่ยง | การป้องกัน | ผลทดสอบ |
|---|---|---|
| ใช้งบก่อนประกาศ | `knownFrom = asOf + 90 วัน`; `publishedOn` | band point แรก ≥ knownFrom (2021-03-28 ≥ 2021-03-01) |
| ใช้ปันผลก่อน ex-date | `dividendStreak`/yield ใช้เฉพาะ ex-date ≤ asOf | ผ่าน |
| ใช้ราคาอนาคตใน score | score ใช้ข้อมูล ณ วัน rebalance; ราคาอนาคตใช้เฉพาะ forward return | ผ่าน |
| ใช้ SET100 ปัจจุบันย้อนหลัง | ระบุ survivorship bias | รายงานแล้ว |
| ใช้ข้อมูลที่ถูก revise | ระบุ revision bias | รายงานแล้ว |

**หมายเหตุ**: backtest `forwardTotal` ใช้ราคา/ปันผลในอนาคตเพื่อวัด **ผลลัพธ์** ซึ่งถูกต้อง; ห้ามใช้เป็น input ของการคัดเลือก

---

## 8. Freshness และ cache

| Cache | สถานะ | หมายเหตุ |
|---|---|---|
| Quotes | real-time; `priceTime` | ใช้ `regularMarketTime` |
| Annual history | 2026-10-23; 109 symbols | อัปเดต TVO/JAS; GST ขาด |
| SET100 | refresh จาก set.or.th | composition อาจเปลี่ยน |
| Rule edges | **refresh แล้ว** 2026-10-23 | 15 edges; payoutCeiling 242/54, edge 0.3885; ครบ 5 presets |
| Edge max age | 24h + ต้องครบ `EDGE_PRESETS` | `edgesFresh` ตรวจทั้งสองเงื่อนไข |

**ก่อนแก้**: rule-edges cache เป็นของข้อมูลเก่า (payout TTM) → preset rank อาจผิด  
**หลังแก้**: เรียก `ruleEdges(SET100, {maxAgeMs: 0})` รีเฟรชแล้ว; ไฟล์ `data/rule-edges.json` อัปเดต

---

## 9. Failure modes และการ fallback

| กรณี | พฤติกรรม |
|---|---|
| Finnomena ถูก bot filter | ใช้ไฟล์ `annual-history.json`; ถ้าไม่มี symbol → UNKNOWN |
| Yahoo quote ล่ม | ใช้ chart price; `priceSource = chart`; ถ้า chart เก่า >30 วัน → `trading-halt` |
| Yahoo annual ขาดบางปี | `reconcileYears` ตัดปีที่ขัด; coverage ลด |
| TradingView ขาด | ไม่ใช้เป็นแหล่งหลัก; ไม่กระทบ score |
| FX rate ผิด/ติดลบ | ไม่แปลง; `fxIssue`; ไม่ให้คะแนน |
| EPS ขัด NI/หุ้น | `epsConflict`; EPS = null; growth unknown |
| Equity ติดลบ | D/E/ROE = null; `negativeEquity` |
| ข้อมูลหาย | `null`/`unknown:*`; **ไม่แทน 0** |
| ปีล่าสุดเป็น stub | payout ใช้ปีเดียวกับปันผล; ถ้าไม่มี EPS → null |

---

## 10. สถานะรวม

| หมวด | สถานะ |
|---|---|
| แหล่งข้อมูลหลัก/รองชัดเจน | PASS |
| Provenance (price/date/source) | PASS |
| P/E/PBV cross-check | PASS |
| Yield/payout cross-check | PASS (อธิบายงวด/special) |
| D/E/ROE cross-check | PASS (นิยามต่าง; ระบุ) |
| Coverage 109 symbols | PASS; GST BLOCKED |
| Corporate actions BANPU | PASS |
| Corporate actions GULF/BPP | **OPEN** |
| Look-ahead controls | PASS |
| Cache freshness | PASS (refreshed) |
| No-zero-substitution | PASS |
