/** Parse only structured common-share cash declarations in SET's <pre> body. */
const months={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
const date=s=>{const m=s?.match(/^(\d{2})-([A-Z][a-z]{2})-(\d{4})$/);return m&&months[m[2]]?`${m[3]}-${String(months[m[2]]).padStart(2,'0')}-${m[1]}`:null;};
export function parseCashDeclarations(html){
 const pre=html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1];if(!pre)return [];
 const text=pre.replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&');const out=[];
 for(const block of text.split(/Subject\s*:\s*Cash dividend payment\s*(?:\r?\n)/i).slice(1)){
  const section=block.split(/_{10,}/)[0];
  if(!/Type of dividend payment\s*:\s*Cash dividend payment\s*(?:\r?\n)/i.test(section))continue;
  const common=section.match(/Payment for\s*:\s*Common shareholders\s*\r?\n([\s\S]*?)(?=Payment for\s*:|Par value\s*:|$)/i)?.[1];if(!common)continue;
  const cash=common.match(/Cash dividend payment \(baht per share\)\s*:\s*(\d+(?:\.\d+)?)/i);
  const special=common.match(/Special dividend \(baht per share\)\s*:\s*(\d+(?:\.\d+)?)/i);
  if(!cash||(!special&&/special dividend/i.test(section)))continue;
  const paid=section.match(/Payment date\s*:\s*(\d{2}-[A-Za-z]{3}-\d{4})/i);
  const period=section.match(/Operating period from\s+(\d{2}-[A-Za-z]{3}-\d{4})\s+to\s+(\d{2}-[A-Za-z]{3}-\d{4})/i);
  if(!paid||!period)continue;
  const paymentDate=date(paid[1]),beginOperation=date(period[1]),endOperation=date(period[2]);if(!paymentDate||!beginOperation||!endOperation)continue;
  const regularDps=Number(cash[1]),specialDps=special?Number(special[1]):0;
  out.push({regularDps,specialDps,totalDps:regularDps+specialDps,paymentDate,beginOperation,endOperation,
   classificationBasis:special?'explicit cash and special fields':'structured common cash field, explicit operating period; not a guarantee of recurrence',
   anchors:[cash[0],paid[0],period[0],...(special?[special[0]]:[])]});
 }
 return out;
}
