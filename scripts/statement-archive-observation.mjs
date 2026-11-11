/** A changed download proves a change was observed now, not when it was released. */
export function archiveObservation(previous,sha256,observedAt) {
  if(previous?.sha256===sha256)return {
    retrievedAt:previous.retrievedAt,sourceContentChanged:previous.sourceContentChanged??false,
    notBefore:previous.notBefore??null,
  };
  if(!previous)return {retrievedAt:observedAt,sourceContentChanged:false,notBefore:null};
  return {retrievedAt:observedAt,sourceContentChanged:true,
    previousSha256:previous.sha256,
    notBefore:new Date(Date.parse(observedAt.slice(0,10))+86400000).toISOString().slice(0,10),
    earliestAmendmentDateVerified:false};
}
