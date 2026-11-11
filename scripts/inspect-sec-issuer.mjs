for(const symbol of ['TISCO','BKIH']){
 const url=`https://market.sec.or.th/public/idisc/en/CompanyProfile/Listed/${symbol}`;
 const html=await(await fetch(url)).text();
 console.log(symbol,[...new Set([...html.matchAll(/FinancialReport\/[^"'<>\s]+/gi)].map(m=>m[0]))]);
 const id=html.match(/FinancialReport\/(?:ALLMIXED|AllMixed|ALL|All)-(\d+)/i)?.[1];
 if(id){const url=`https://market.sec.or.th/public/idisc/en/ViewMore/fs-r562?uniqueIDReference=${id}&searchSymbol=${symbol}&dateFrom=20150101&dateTo=20261111`; const s=await(await fetch(url)).text();console.log('PAGE',id,s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(-4500));}
}
