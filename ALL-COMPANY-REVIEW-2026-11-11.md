# ตรวจทุกบริษัทใน screener — 11 พฤศจิกายน 2026

> อัปเดตภายหลัง: ยืนยัน KTB และจับคู่ประกาศปันผลเพิ่มเติมแล้ว สถานะรอแยกปันผลของโมเดลที่ใช้ปันผลลดจาก 100 เหลือ 38 ตัว ดู [ผลตรวจประกาศทุกบริษัท](ALL-DIVIDEND-REVIEW-2026-11-11.md) รายงานด้านล่างบันทึกผลก่อนตรวจประกาศเพิ่มเติม

## ขอบเขตและผลตรวจ

- ตรวจครบ 110 หลักทรัพย์ไม่ซ้ำ จาก SET100, กลุ่มเสริม, watchlists และบอร์ดที่ใช้อยู่ ไม่ใช่หุ้นทุกตัวที่จดทะเบียนในตลาด
- อ่านข้อมูล SET ทางการได้ครบ 110 ตัว ไม่มีข้อผิดพลาดในการขอข้อมูล
- P/E, P/BV และยีลด์: เทียบได้ 315 คู่ที่มีค่าและวันอ้างอิงตรงกัน ไม่พบความต่างเกิน 0.00000001 ค่าไม่มีข้อมูลหรือคนละวันไม่นับว่าผ่าน
- EPS ที่ใช้ Payout: เทียบได้ 93 คู่ที่ปีตรงกัน ไม่พบความต่างเกินความละเอียด EPS ที่พิมพ์ (0.005 บาท/หุ้น) หลังปรับฐานข้อมูล
- ตรวจความสอดคล้องอัตโนมัติครบ 110 ตัว ไม่พบข้อผิดพลาดระดับที่ต้องกันออกจากการคัดกรองในผลรอบนี้

## สิ่งที่แก้จากการตรวจทั้งกลุ่ม

พบ EPS ที่ใช้คำนวณ Payout ต่างจาก SET ใน BH, GLOBAL, DOHOME, GULF, GUNKUL และ TFG จึงเพิ่ม EPS รายปีจากงบรวม SET เป็นฐาน Payout ของหุ้นทั่วไปเมื่อมีปีตรงกัน กำกับแหล่งที่มาไว้ แยกจาก EPS growth ซึ่งยังไม่ถูกเขียนทับหรือรับรองการปรับจำนวนหุ้นย้อนหลัง ธนาคารทั้งเจ็ดยังคงใช้ EPS ที่ตรวจจากไฟล์งบทางการ

## การตรวจที่ทำงานทุกครั้ง

server/screener-audit.js ตรวจทุกแถวที่เข้ามาโดยไม่ผูกกับชื่อบริษัท: คะแนนโดยไม่มีงบ, ช่วงความครบถ้วน, ปีและสูตร Payout, เงินปันผลในคะแนนเทียบ DDM, อินพุตที่หายใน Residual Income และความสดของแหล่งข้อมูล ถ้าพบข้อผิดพลาดเชิงความสอดคล้องจะไม่ให้ผ่าน preset พร้อมเหตุผล การเพิ่มหุ้นใหม่ลง watchlist จึงได้รับการตรวจนี้อัตโนมัติด้วย

หน้า screener แสดงยอดตรวจและข้อค้างของทุกบริษัท ส่วนหน้ารายตัวมีผลตรวจข้อมูลและหลักฐานที่ยังค้าง การตรวจซอร์ส SET ออนไลน์ทำซ้ำด้วย scripts/audit-all-company-official.mjs; การตรวจทั้งกลุ่มผ่าน API ใช้ scripts/audit-screening-completeness.mjs ไม่ได้ติดตั้งงานตั้งเวลาหรือส่งข้อความอัตโนมัติ

## ข้อจำกัดที่ยังแสดงไว้ตรงไปตรงมา

- 100 ตัวที่ DDM ใช้เงินปันผล ยังไม่มีการยืนยันแยกปกติ/พิเศษจากประกาศบริษัท จึงแสดงสถานะรอตรวจ ไม่เรียกว่าตัวเลขจากประกาศที่รับรองแล้ว
- KTB ยืนยันยอดปันผลสามัญรวมปี 2025 ที่ 2.67 จากหมายเหตุงบได้ แต่ยังไม่มีไฟล์ประกาศต้นฉบับที่ตรวจรับรองการแยกส่วนพิเศษ จึงไม่เดาค่า 0.60 เพื่อเปลี่ยนปันผลประจำ หน้าดัชนีเอกสารภายนอกปฏิเสธการเข้าถึง (403) และหน้า SET ที่อ่านได้ไม่มีรายละเอียดการแยกใน HTML
- การจับคู่ปีปันผลส่วนใหญ่ยังอาศัยช่วงวันจ่าย ไม่ใช่การอ่านประกาศทุกงวด จึงยังไม่รับรอง corporate actions หรือการเปลี่ยนจำนวนหุ้น/นิติบุคคลของทุกบริษัท
- การเทียบ 315 คู่และ EPS 93 คู่ไม่ใช่การตรวจงบทุกบรรทัดย้อนหลังของ 110 บริษัท งานตรวจต้นฉบับเดิมยังจำกัด 14 บริษัท
- ธนาคาร KKP ยังขาด ROE บางงวด; TISCO ยังขาด ROA บางงวด และ MC ยังขาด EPS growth เกณฑ์เหล่านี้ไม่ได้ถูกผ่อนเพื่อให้เข้าอันดับ

## สถานะรายตัว

| หุ้น | ผลตรวจสูตร | EPS สำหรับ Payout | ปี | ยังไม่ยืนยันปันผลปกติ/พิเศษ | ข้อประเมินขาด |
|---|---|---|---:|---|---|
| SET:AAV | มีข้อรอตรวจ | set.or.th | 2025 | ไม่พบข้อรอในรายการนี้ | dividendYield, payoutBand, payoutCeiling |
| SET:ADVANC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:AEONTS | มีข้อรอตรวจ | set.or.th | 2026 | รอหลักฐาน | — |
| SET:AMATA | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:AOT | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:AP | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:AURA | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | revenueGrowth, earningsStability |
| SET:AWC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:BA | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:BAM | มีข้อรอตรวจ | provider-unverified | 2025 | รอหลักฐาน | — |
| SET:BANPU | มีข้อรอตรวจ | — | — | ไม่พบข้อรอในรายการนี้ | — |
| SET:BBL | มีข้อรอตรวจ | sec-reviewed-bank | 2025 | รอหลักฐาน | — |
| SET:BCH | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:BCP | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:BCPG | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:BDMS | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:BEM | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | interestCoverage |
| SET:BGRIM | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:BH | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:BJC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:BKIH | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | roeLevel, roeConsistency, roaLevel, npmLevel, npmTrend, epsGrowth, revenueGrowth, earningsStability, cfoPositive, cfoBeatsEarnings, fcfPositive |
| SET:BLA | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:BTG | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | earningsStability |
| SET:BTS | มีข้อรอตรวจ | — | — | ไม่พบข้อรอในรายการนี้ | dividendYield, payoutBand, payoutCeiling |
| SET:CBG | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:CCET | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:CENTEL | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:CHG | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:CK | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:COM7 | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:CPALL | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:CPF | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:CPN | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:CPNREIT | มีข้อรอตรวจ | — | — | ไม่พบข้อรอในรายการนี้ | — |
| SET:CRC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:DELTA | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:DOHOME | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:EA | มีข้อรอตรวจ | — | — | ไม่พบข้อรอในรายการนี้ | dividendYield, payoutBand, payoutCeiling |
| SET:EGCO | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:ERW | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:GFPT | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | npmPositive, cfoBeatsEarnings |
| SET:GLOBAL | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:GPSC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:GST | มีข้อรอตรวจ | set.or.th | 2025 | ไม่พบข้อรอในรายการนี้ | epsGrowth, revenueGrowth, earningsStability, dividendYield, payoutBand, payoutCeiling |
| SET:GULF | มีข้อรอตรวจ | set.or.th | 2024 | รอหลักฐาน | roeLevel, roeConsistency, roaLevel, npmLevel, npmTrend |
| SET:GUNKUL | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:HANA | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:HMPRO | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:HTC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:ICHI | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:INETREIT | มีข้อรอตรวจ | — | — | ไม่พบข้อรอในรายการนี้ | — |
| SET:IRPC | มีข้อรอตรวจ | — | — | รอหลักฐาน | payoutBand, payoutCeiling |
| SET:IVL | มีข้อรอตรวจ | — | — | รอหลักฐาน | payoutBand, payoutCeiling |
| SET:JAS | มีข้อรอตรวจ | — | — | ไม่พบข้อรอในรายการนี้ | dividendYield, payoutBand, payoutCeiling |
| SET:JMART | มีข้อรอตรวจ | — | — | รอหลักฐาน | payoutBand, payoutCeiling |
| SET:JMT | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:KAMART | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:KBANK | สอดคล้อง | sec-reviewed-bank | 2025 | ไม่พบข้อรอในรายการนี้ | — |
| SET:KCE | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:KKP | มีข้อรอตรวจ | sec-reviewed-bank | 2025 | รอหลักฐาน | roeLevel, roeConsistency, roaLevel |
| SET:KTB | มีข้อรอตรวจ | sec-reviewed-bank | 2025 | รอหลักฐาน | — |
| SET:KTC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:LH | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:M | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:MC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | epsGrowth |
| SET:MEGA | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:MINT | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:MOSHI | มีข้อรอตรวจ | provider-unverified | 2025 | รอหลักฐาน | revenueGrowth, earningsStability |
| SET:MRDIYT | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | roeLevel, roeConsistency, roaLevel, npmLevel, npmTrend, revenueGrowth, earningsStability, cfoPositive, cfoBeatsEarnings, fcfPositive |
| SET:MTC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:OR | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | earningsStability |
| SET:OSP | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:PLANB | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:PR9 | มีข้อรอตรวจ | provider-unverified | 2025 | รอหลักฐาน | — |
| SET:PRM | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:PTG | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:PTT | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:PTTEP | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:PTTGC | มีข้อรอตรวจ | — | — | รอหลักฐาน | payoutBand, payoutCeiling |
| SET:QH | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:RATCH | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:RCL | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:SAWAD | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:SCB | มีข้อรอตรวจ | sec-reviewed-bank | 2025 | รอหลักฐาน | earningsStability |
| SET:SCC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:SCGP | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:SIRI | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:SPALI | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:SPRC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:STA | มีข้อรอตรวจ | — | — | รอหลักฐาน | payoutBand, payoutCeiling |
| SET:STECON | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | roeLevel, roeConsistency, roaLevel, npmLevel, npmTrend, epsGrowth, revenueGrowth, earningsStability, fcfPositive |
| SET:STGT | มีข้อรอตรวจ | — | — | รอหลักฐาน | earningsStability, payoutBand, payoutCeiling |
| SET:TACC | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:TASCO | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:TCAP | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:TFG | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:THAI | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | roeLevel, roeConsistency |
| SET:TIDLOR | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | roeLevel, roeConsistency, roaLevel, npmLevel, npmTrend, npmPositive, epsGrowth, earningsStability, interestCoverage, cfoPositive, cfoBeatsEarnings, fcfPositive |
| SET:TISCO | มีข้อรอตรวจ | sec-reviewed-bank | 2025 | รอหลักฐาน | roaLevel |
| SET:TLI | มีข้อรอตรวจ | provider-unverified | 2025 | รอหลักฐาน | — |
| SET:TOA | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:TOP | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:TRUE | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | npmTrend |
| SET:TTB | มีข้อรอตรวจ | sec-reviewed-bank | 2025 | รอหลักฐาน | — |
| SET:TTW | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:TU | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:TVO | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:VGI | มีข้อรอตรวจ | — | — | ไม่พบข้อรอในรายการนี้ | dividendYield, payoutBand, payoutCeiling |
| SET:WHA | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |
| SET:WHAUP | มีข้อรอตรวจ | set.or.th | 2025 | รอหลักฐาน | — |

หลักฐาน: all-company-official-comparison.json (คำตอบ SET ดิบ), all-company-final-validation.json, all-company-review-queue.json และ screener-complete-audit.json
