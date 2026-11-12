import assert from 'node:assert/strict';
import {api} from '../public/js/api.js';
const original=globalThis.fetch;
try {
  globalThis.fetch=async()=>new Response('Bad gateway',{status:502,statusText:''});
  await assert.rejects(api.screenerRun({universe:'set100'}),e=>e.status===502&&e.message==='HTTP 502');
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'UNAUTHORIZED',message:'password required'}}),{status:401});
  await assert.rejects(api.screenerRun({}),e=>e.code==='UNAUTHORIZED'&&e.message==='password required');
  globalThis.fetch=async()=>new Response('<html>Restarting</html>',{status:200});
  await assert.rejects(api.screenerRun({}),e=>e.code==='INVALID_RESPONSE');
  globalThis.fetch=async()=>Response.json({rows:[],matched:0});
  assert.equal((await api.screenerRun({})).matched,0);
} finally { globalThis.fetch=original; }
console.log('API errors retain HTTP status, authentication detail and reject proxy HTML');
