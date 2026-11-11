# ผลตรวจ Value screener ทั้งกลุ่ม — 11 พฤศจิกายน 2026

> รายงานด้านล่างบันทึกข้อค้นพบก่อนแก้ไข ข้อ 1 และ 2 แก้แล้วและตรวจซ้ำครบ 110 ตัว ดู [ผลแก้ไขและทดสอบ](SCREENER-MISSING-INPUT-FIXES-2026-11-11.md) ข้อมูล API ปัจจุบันใน screener-complete-audit.json เป็นผลหลังแก้ ส่วนชุดก่อนแก้เก็บไว้ที่ screener-before-missing-input-fix.local

ขอบเขต: หลักทรัพย์ไม่ซ้ำ 110 ตัวจาก SET100, SET large caps, watchlists และบอร์ดที่ใช้อยู่ ตรวจผ่าน API พรีวิว ไม่มีข้อผิดพลาดในการเรียกทั้ง 110 ตัว ไม่ได้หมายถึงหุ้นทุกตัวในตลาดหลักทรัพย์ และไม่ได้รับรองตัวเลขงบทุกปีของทั้ง 110 บริษัทกับเอกสารทางการในรอบนี้

## ข้อค้นพบ

1. **BANPU: คะแนนตัวเลขทั้งที่ไม่มีงบรายปีในข้อมูลที่ระบบใช้** — yearCount และ scoringYearCount เท่ากับ 0 แต่ score เป็น 0, dataCoverage 11.7% และผ่านโหมดแสดงทั้งหมด จึงอาจถูกเข้าใจว่าเป็นผลประเมินว่าธุรกิจได้ศูนย์คะแนน แทนสถานะข้อมูลไม่พอ ควรตรวจต้นทางและแสดงคะแนนเป็นไม่มีข้อมูลจนกว่าจะมีงบใช้ได้

2. **Residual Income ใช้ข้อมูลขาดเป็นศูนย์** — BBL, KBANK, KTB, KKP, SCB, TISCO และ TTB มี payout=null แต่ residualIncome.ok=true และ used payout=0; KKP มี roe3=null แต่ใช้ ROE=0 ด้วย ตรวจโค้ดพบ Number(null) ให้ 0 ใน server/screener.js ก่อนตรวจ finite จึงควรหยุดคำนวณเมื่ออินพุตจำเป็นขาด การแก้นี้เป็นเรื่องมูลค่า ไม่ใช่การลดเกณฑ์คะแนน

3. **คะแนนสูงแต่ข้อมูลไม่ครบ** — KTB 90 / 93%, TISCO 100 / 86%, MC 91 / 93% ค่าหลังคือความครบถ้วนของเกณฑ์ที่เกี่ยวข้อง คะแนนสูงไม่เท่ากับผ่านทุก preset; ข้อที่ขาดยังต้องกันออก

4. **ข้อมูลขาดเป็นกลุ่ม** — 32 ตัวมีข้อประเมินที่เกี่ยวข้องอย่างน้อยหนึ่งข้อยังไม่ทราบค่า มี 20 ตัวที่ Payout ประเมินไม่ได้ สาเหตุไม่ได้เหมือนกันทั้งหมด: อาจเป็น EPS ที่ยังไม่ยืนยัน กำไรไม่เป็นบวก หรือไม่มีปันผลที่ใช้เป็นตัวตั้ง ไม่ควรเติมค่าเดียวกันให้ทั้งกลุ่ม

5. **งบเปรียบเทียบของธนาคาร** — พบ 12 snapshots ที่ยังขาดยอดต้นงวดอย่างน้อยหนึ่งรายการ ในหลายไฟล์มีตารางเปลี่ยนแปลงส่วนผู้ถือหุ้นที่อาจใช้ตรวจยอดต้นปีได้ โดย KKP FY2023–2024 กระทบ ROE/ROA ที่ใช้งานปัจจุบัน ส่วนสินทรัพย์ต้นปีต้องมีหลักฐานแยก ไม่ยืมจากงบเก่าโดยอัตโนมัติ ดู screener-opening-evidence-audit.json ซึ่งเป็นรายการเบาะแส ไม่ใช่ค่าที่อนุมัตินำเข้าแล้ว

6. **REIT สองตัว** — CPNREIT และ INETREIT ถูกกันออกจากโมเดลหุ้นทั่วไป พร้อม score=null ตามที่ออกแบบไว้ ไม่ใช่การให้ศูนย์คะแนน

## การจัดอันดับและข้อจำกัด

ตรวจผลเงื่อนไขทั้งหก preset ของทั้ง 110 ตัว คะแนนและการผ่าน preset เป็นคนละเงื่อนไข เกณฑ์ที่จำเป็นยังไม่ทราบค่าจะไม่ผ่าน เกณฑ์เงินกองทุน/NPL/Coverage ของธนาคารใช้เพิ่มต่างหาก การเรียงอันดับบาง preset ใช้ yield หรือ MOS แทนคะแนน จึงไม่ควรตีความว่าแถวบนต้องมีคะแนนสูงสุดเสมอ

รายงานนี้อ่านโค้ดและข้อมูลปัจจุบันเท่านั้น ยังไม่ได้แก้สูตร คะแนน เงื่อนไข หรือข้อมูลบริษัท ความพร้อมของเอกสารทางการที่ตรวจตัวเลขเดิมมีเพียง 14 บริษัท ไม่ใช่ครบ 110 บริษัท

## รายตัว

เหตุผลในช่อง preset เป็นรหัส API; unknown หมายถึงข้อมูลไม่พอ, requires หมายถึงไม่ผ่านเกณฑ์, MOS หมายถึงส่วนเผื่อความปลอดภัยของมูลค่า

| หุ้น | โมเดล | คะแนน | ข้อมูลครบ | ข้อที่ยังไม่ทราบค่า | คุณภาพ | ปันผล | รายได้ | คูเมือง | มูลค่า |
|---|---|---:|---:|---|---|---|---|---|---|
| SET:AAV | general | 49 | 89% | dividendYield, Payout ratio, เพดาน Payout | score-too-low | unknown:dividendYield | unknown:dividendYield | unknown:dividendYield | no-mos |
| SET:ADVANC | general | 87 | 100% | — | ผ่าน | requires:payoutBand | requires:payoutCeiling | ผ่าน | mos-too-low |
| SET:AEONTS | general | 45 | 100% | — | requires:roeLevel | score-too-low | requires:roeConsistency | requires:roeLevel | score-too-low |
| SET:AMATA | general | 70 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:AOT | general | 65 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:AP | general | 47 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | score-too-low |
| SET:AURA | general | 60 | 90% | รายได้เติบโต, กำไรย้อนหลัง | requires:fcfPositive | requires:dividendStreak | requires:cfoPositive | requires:dividendStreak | mos-too-low |
| SET:AWC | general | 50 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:BA | general | 72 | 100% | — | ผ่าน | requires:dividendStreak | ผ่าน | requires:dividendStreak | ผ่าน |
| SET:BAM | general | 38 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | score-too-low |
| SET:BANPU | general | 0 | 12% | ROE 3 ปี, ROE สม่ำเสมอ, ROA 3 ปี, npmLevel, npmTrend, npmPositive, EPS เติบโต, รายได้เติบโต, กำไรย้อนหลัง, debtLevel, interestCoverage, cfoPositive, cfoBeatsEarnings, fcfPositive, Payout ratio, เพดาน Payout | unknown:roeLevel | unknown:payoutBand | unknown:roeConsistency | unknown:roeLevel | mos-too-low |
| SET:BBL | bank | 67 | 93% | Payout ratio, เพดาน Payout | requires:roeLevel | unknown:payoutBand | requires:roeConsistency | requires:roeLevel | ผ่าน |
| SET:BCH | general | 68 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | mos-too-low |
| SET:BCP | general | 41 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:BCPG | general | 46 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | no-mos |
| SET:BDMS | general | 88 | 100% | — | ผ่าน | requires:payoutBand | requires:payoutCeiling | ผ่าน | no-mos |
| SET:BEM | general | 43 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:BGRIM | general | 34 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | no-mos |
| SET:BH | general | 94 | 100% | — | ผ่าน | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:BJC | general | 36 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:BKIH | general | 66 | 37% | ROE 3 ปี, ROE สม่ำเสมอ, ROA 3 ปี, npmLevel, npmTrend, EPS เติบโต, รายได้เติบโต, กำไรย้อนหลัง, cfoPositive, cfoBeatsEarnings, fcfPositive | unknown:roeLevel | requires:dividendStreak | unknown:roeConsistency | unknown:roeLevel | ผ่าน |
| SET:BLA | general | 44 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:BTG | general | 47 | 95% | กำไรย้อนหลัง | requires:roeLevel | requires:dividendStreak | requires:roeConsistency | requires:roeLevel | score-too-low |
| SET:BTS | general | 6 | 89% | dividendYield, Payout ratio, เพดาน Payout | requires:roeLevel | unknown:dividendYield | unknown:dividendYield | unknown:dividendYield | no-mos |
| SET:CBG | general | 84 | 100% | — | ผ่าน | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:CCET | general | 57 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:CENTEL | general | 53 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:CHG | general | 68 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | mos-too-low |
| SET:CK | general | 34 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:COM7 | general | 73 | 100% | — | ผ่าน | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:CPALL | general | 76 | 100% | — | requires:roaLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:CPF | general | 57 | 100% | — | requires:roeLevel | ผ่าน | requires:roeConsistency | requires:roeLevel | ผ่าน |
| SET:CPN | general | 86 | 100% | — | ผ่าน | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:CPNREIT | ไม่ให้คะแนน | — | — | — | unknown:data | unknown:data | unknown:data | unknown:data | unknown:data |
| SET:CRC | general | 45 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | no-mos |
| SET:DELTA | general | 86 | 100% | — | ผ่าน | requires:dividendYield | requires:dividendYield | requires:dividendYield | no-mos |
| SET:DOHOME | general | 31 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | no-mos |
| SET:EA | general | 6 | 89% | dividendYield, Payout ratio, เพดาน Payout | requires:roeLevel | unknown:dividendYield | unknown:dividendYield | unknown:dividendYield | no-mos |
| SET:EGCO | general | 45 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | mos-too-low |
| SET:ERW | general | 38 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:GFPT | general | 66 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:GLOBAL | general | 57 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:GPSC | general | 50 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:GST | general | 32 | 73% | EPS เติบโต, รายได้เติบโต, กำไรย้อนหลัง, dividendYield, Payout ratio, เพดาน Payout | requires:roeLevel | unknown:dividendYield | unknown:dividendYield | unknown:dividendYield | no-mos |
| SET:GULF | general | 76 | 70% | ROE 3 ปี, ROE สม่ำเสมอ, ROA 3 ปี, npmLevel, npmTrend | unknown:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:GUNKUL | general | 58 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:HANA | general | 44 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | no-mos |
| SET:HMPRO | general | 67 | 100% | — | ผ่าน | requires:payoutBand | requires:payoutCeiling | ผ่าน | ผ่าน |
| SET:HTC | general | 69 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | ผ่าน |
| SET:ICHI | general | 95 | 100% | — | ผ่าน | requires:payoutBand | requires:payoutCeiling | ผ่าน | no-mos |
| SET:INETREIT | ไม่ให้คะแนน | — | — | — | unknown:data | unknown:data | unknown:data | unknown:data | unknown:data |
| SET:IRPC | general | 27 | 95% | Payout ratio, เพดาน Payout | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | no-mos |
| SET:IVL | general | 24 | 95% | Payout ratio, เพดาน Payout | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:JAS | general | 41 | 89% | dividendYield, Payout ratio, เพดาน Payout | score-too-low | unknown:dividendYield | unknown:dividendYield | unknown:dividendYield | no-mos |
| SET:JMART | general | 20 | 95% | Payout ratio, เพดาน Payout | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:JMT | general | 52 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | ผ่าน |
| SET:KAMART | general | 93 | 100% | — | ผ่าน | requires:payoutBand | ผ่าน | ผ่าน | ผ่าน |
| SET:KBANK | bank | 62 | 93% | Payout ratio, เพดาน Payout | requires:bankNpl | requires:bankNpl | requires:bankNpl | requires:bankNpl | requires:bankNpl |
| SET:KCE | general | 53 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | no-mos |
| SET:KKP | bank | 69 | 62% | ROE 3 ปี, ROE สม่ำเสมอ, ROA 3 ปี, Payout ratio, เพดาน Payout | requires:bankNpl | requires:bankNpl | requires:bankNpl | requires:bankNpl | requires:bankNpl |
| SET:KTB | bank | 90 | 93% | Payout ratio, เพดาน Payout | ผ่าน | unknown:payoutBand | requires:roeConsistency | ผ่าน | ผ่าน |
| SET:KTC | general | 78 | 100% | — | ผ่าน | ผ่าน | ผ่าน | ผ่าน | mos-too-low |
| SET:LH | general | 25 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | score-too-low |
| SET:M | general | 58 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | no-mos |
| SET:MC | general | 91 | 93% | EPS เติบโต | ผ่าน | requires:payoutBand | requires:payoutCeiling | ผ่าน | no-mos |
| SET:MEGA | general | 83 | 100% | — | ผ่าน | requires:payoutBand | ผ่าน | ผ่าน | mos-too-low |
| SET:MINT | general | 45 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:MOSHI | general | 87 | 90% | รายได้เติบโต, กำไรย้อนหลัง | ผ่าน | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:MRDIYT | general | 62 | 43% | ROE 3 ปี, ROE สม่ำเสมอ, ROA 3 ปี, npmLevel, npmTrend, รายได้เติบโต, กำไรย้อนหลัง, cfoPositive, cfoBeatsEarnings, fcfPositive | unknown:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:MTC | general | 69 | 100% | — | ผ่าน | requires:dividendYield | requires:dividendYield | requires:dividendYield | no-mos |
| SET:OR | general | 65 | 95% | กำไรย้อนหลัง | requires:roeLevel | ผ่าน | requires:roeConsistency | requires:roeLevel | mos-too-low |
| SET:OSP | general | 88 | 100% | — | ผ่าน | ผ่าน | requires:roeConsistency | ผ่าน | mos-too-low |
| SET:PLANB | general | 73 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:PR9 | general | 78 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:PRM | general | 90 | 100% | — | ผ่าน | ผ่าน | ผ่าน | ผ่าน | ผ่าน |
| SET:PTG | general | 47 | 100% | — | requires:roeLevel | score-too-low | requires:roeConsistency | requires:roeLevel | mos-too-low |
| SET:PTT | general | 69 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | ผ่าน |
| SET:PTTEP | general | 80 | 100% | — | requires:roeLevel | ผ่าน | ผ่าน | requires:roeLevel | ผ่าน |
| SET:PTTGC | general | 28 | 95% | Payout ratio, เพดาน Payout | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:QH | general | 58 | 100% | — | requires:roeLevel | ผ่าน | requires:roeConsistency | requires:roeLevel | ผ่าน |
| SET:RATCH | general | 54 | 100% | — | requires:roeLevel | score-too-low | requires:roeConsistency | requires:roeLevel | mos-too-low |
| SET:RCL | general | 65 | 100% | — | requires:roeLevel | requires:payoutBand | score-too-low | requires:roeLevel | ผ่าน |
| SET:SAWAD | general | 69 | 100% | — | ผ่าน | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:SCB | bank | 58 | 86% | กำไรย้อนหลัง, Payout ratio, เพดาน Payout | requires:bankNpl | requires:bankNpl | requires:bankNpl | requires:bankNpl | requires:bankNpl |
| SET:SCC | general | 40 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:SCGP | general | 57 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:SIRI | general | 53 | 100% | — | requires:roeLevel | score-too-low | requires:roeConsistency | requires:roeLevel | ผ่าน |
| SET:SPALI | general | 52 | 100% | — | requires:roeLevel | score-too-low | requires:roeConsistency | requires:roeLevel | ผ่าน |
| SET:SPRC | general | 47 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:STA | general | 20 | 95% | Payout ratio, เพดาน Payout | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:STECON | general | 28 | 48% | ROE 3 ปี, ROE สม่ำเสมอ, ROA 3 ปี, npmLevel, npmTrend, EPS เติบโต, รายได้เติบโต, กำไรย้อนหลัง, fcfPositive | unknown:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:STGT | general | 35 | 90% | กำไรย้อนหลัง, Payout ratio, เพดาน Payout | requires:roeLevel | unknown:payoutBand | requires:roeConsistency | requires:roeLevel | score-too-low |
| SET:TACC | general | 80 | 100% | — | ผ่าน | requires:payoutBand | requires:payoutCeiling | ผ่าน | ผ่าน |
| SET:TASCO | general | 58 | 100% | — | requires:roeLevel | requires:payoutBand | requires:roeConsistency | requires:roeLevel | no-mos |
| SET:TCAP | general | 60 | 100% | — | requires:roeLevel | ผ่าน | requires:roeConsistency | requires:roeLevel | mos-too-low |
| SET:TFG | general | 88 | 100% | — | ผ่าน | ผ่าน | ผ่าน | ผ่าน | ผ่าน |
| SET:THAI | general | 53 | 83% | ROE 3 ปี, ROE สม่ำเสมอ | unknown:roeLevel | requires:dividendStreak | unknown:roeConsistency | unknown:roeLevel | mos-too-low |
| SET:TIDLOR | general | 17 | 30% | ROE 3 ปี, ROE สม่ำเสมอ, ROA 3 ปี, npmLevel, npmTrend, npmPositive, EPS เติบโต, กำไรย้อนหลัง, interestCoverage, cfoPositive, cfoBeatsEarnings, fcfPositive | unknown:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:TISCO | bank | 100 | 86% | ROA 3 ปี, Payout ratio, เพดาน Payout | unknown:roaLevel | unknown:payoutBand | unknown:roaLevel | ผ่าน | ผ่าน |
| SET:TLI | general | 41 | 100% | — | requires:roeLevel | requires:dividendStreak | requires:roeConsistency | requires:roeLevel | mos-too-low |
| SET:TOA | general | 93 | 100% | — | ผ่าน | ผ่าน | requires:roeConsistency | ผ่าน | mos-too-low |
| SET:TOP | general | 48 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:TRUE | general | 15 | 97% | npmTrend | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |
| SET:TTB | bank | 74 | 93% | Payout ratio, เพดาน Payout | requires:roeLevel | unknown:payoutBand | requires:roeConsistency | requires:roeLevel | mos-too-low |
| SET:TTW | general | 86 | 100% | — | ผ่าน | requires:payoutBand | ผ่าน | ผ่าน | ผ่าน |
| SET:TU | general | 42 | 100% | — | requires:roeLevel | score-too-low | requires:roeConsistency | requires:roeLevel | mos-too-low |
| SET:TVO | general | 85 | 100% | — | ผ่าน | requires:payoutBand | requires:payoutCeiling | ผ่าน | ผ่าน |
| SET:VGI | general | 15 | 89% | dividendYield, Payout ratio, เพดาน Payout | requires:roeLevel | unknown:dividendYield | unknown:dividendYield | unknown:dividendYield | no-mos |
| SET:WHA | general | 68 | 100% | — | requires:roeLevel | ผ่าน | requires:roeConsistency | requires:roeLevel | mos-too-low |
| SET:WHAUP | general | 58 | 100% | — | requires:roeLevel | requires:dividendYield | requires:dividendYield | requires:dividendYield | mos-too-low |

หลักฐาน: screener-complete-audit.json, screener-complete-audit-summary.json, screener-opening-evidence-audit.json สคริปต์ตรวจซ้ำ: scripts/audit-screening-completeness.mjs
