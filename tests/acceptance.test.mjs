import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const root=resolve(import.meta.dirname,'..'),tmp=mkdtempSync(join(tmpdir(),'riverton-test-')),file=join(tmp,'demo.sqlite');
const port=31000+Math.floor(Math.random()*15000),base=`http://127.0.0.1:${port}`;
let processHandle,teacher='',staff='',viewer='';
async function req(path,{method='GET',body,auth='',raw=false}={}){
 const response=await fetch(base+path,{method,headers:{...(auth?{Cookie:auth}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const result=raw?await response.text():await response.json();return {status:response.status,result,headers:response.headers};
}
const post=(path,body,auth=teacher)=>req(path,{method:'POST',body,auth});
async function reset(){const r=await post('/api/demo/reset',{});assert.equal(r.status,200,r.result.error)}
const future=()=>new Date(Date.now()+72*3600_000).toISOString();
before(async()=>{
 processHandle=spawn(process.execPath,['--no-warnings','--experimental-strip-types',join(root,'src/server.ts')],{cwd:root,env:{...process.env,DB_FILE:file,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 let output='';processHandle.stderr.on('data',c=>{output+=c});processHandle.stdout.on('data',c=>{output+=c});
 let ready=false;for(let i=0;i<80;i++){if(processHandle.exitCode!==null)break;try{const r=await req('/api/session');if(r.status===200){ready=true;break}}catch{}await sleep(100)}
 assert.equal(ready,true,'Server did not start: '+output);
 async function login(role){const r=await req('/api/demo/login',{method:'POST',body:{role}});assert.equal(r.status,200);return (r.headers.get('set-cookie')||'').split(';')[0]}
 teacher=await login('instructor');staff=await login('staff');viewer=await login('viewer');
});
after(async()=>{processHandle?.kill('SIGTERM');rmSync(tmp,{recursive:true,force:true})});

test('fixtures contain requested cardinalities and edge cases',async()=>{
 const d=await req('/api/dashboard',{auth:teacher});assert.equal(d.status,200);assert.equal(d.result.assets,60);assert.equal(d.result.onLoan,12);assert.equal(d.result.overdueCount,4);assert.equal(d.result.maintenanceDueCount,6);assert.equal(d.result.quarantinedCount,3);
 const v=await req('/api/vendors',{auth:teacher});assert.equal(v.result.length,5);
 const b=await req('/api/borrowers',{auth:teacher});assert.equal(b.result.length,10);
 const loc=await req('/api/locations',{auth:teacher});assert.equal(loc.result.length,5);
 const a=await req('/api/assets',{auth:teacher});assert.equal(new Set(a.result.map(x=>x.category)).size,6);
 assert(a.result.some(x=>!x.home_location_id));
 assert.equal(a.result.filter(x=>x.serial_ref==='SER-DUP-0006').length,2);
});
test('signed-out QR and API cannot disclose borrower details',async()=>{
 assert.equal((await req('/api/assets/AST-001')).status,401);
 assert.equal((await req('/api/loans')).status,401);
 assert.equal((await req('/api/labels?ids=AST-001')).status,401);
 const sheet=await req('/api/labels?ids=AST-001',{auth:viewer,raw:true});assert.equal(sheet.status,200);assert.match(sheet.result,/<svg/);assert.match(sheet.result,/AST-001/);assert.doesNotMatch(sheet.result,/BR-01/);
});
test('simultaneous checkout attempts create exactly one active loan',async()=>{
 await reset();const p={borrower_code:'BR-01',condition:'good',due_at:future()};
 const [a,b]=await Promise.all([post('/api/assets/AST-015/checkout',p),post('/api/assets/AST-015/checkout',{...p,borrower_code:'BR-02'},staff)]);
 assert.deepEqual([a.status,b.status].sort(),[200,409]);
 const loans=await req('/api/loans',{auth:teacher});assert.equal(loans.result.filter(x=>x.asset_id==='AST-015'&&!x.returned_at).length,1);
 assert.equal((await req('/api/assets/AST-015',{auth:teacher})).result.status,'on_loan');
 // Verify the invariant lives in SQLite, not only in the HTTP application.
 const conn=new DatabaseSync(file);assert.throws(()=>conn.prepare('INSERT INTO loans(asset_id,borrower_code,issued_at,due_at,checkout_condition,issued_by) VALUES (?,?,?,?,?,?)').run('AST-015','BR-02',new Date().toISOString(),future(),'good','ADVERSARIAL-TEST'),/UNIQUE constraint/);conn.close();
});
test('damaged saw return blocks reissue, preserves defect through service and requires instructor note',async()=>{
 await reset();const saw='AST-016';
 assert.equal((await post(`/api/assets/${saw}/checkout`,{borrower_code:'BR-03',due_at:future(),condition:'good'},staff)).status,200);
 const r=await post(`/api/assets/${saw}/return`,{condition:'damaged',location_id:'LOC-5',note:'Cracked guard noticed on return'},staff);assert.equal(r.status,200);assert.equal(r.result.status,'inspection_required');
 assert.equal((await post(`/api/assets/${saw}/checkout`,{borrower_code:'BR-03',due_at:future()})).status,409);
 const date=new Date().toISOString().slice(0,10);const service=await post(`/api/assets/${saw}/service`,{serviced_date:date,note:'Inspected blade cover',reference:'PHOTO-REF'});assert.equal(service.status,200);assert.equal(service.result.status,'inspection_required');
 assert.equal((await post(`/api/assets/${saw}/release`,{condition:'good',note:''})).status,400);
 assert.equal((await post(`/api/assets/${saw}/release`,{condition:'good',note:'Examined guard and authorized release'},staff)).status,403);
 const released=await post(`/api/assets/${saw}/release`,{condition:'good',note:'Examined guard; authorized operational release'});assert.equal(released.status,200);assert.equal(released.result.status,'available');
 const detail=await req(`/api/assets/${saw}`,{auth:teacher});assert.equal(detail.result.quarantines[0].closed_by,'DEMO-INSTRUCTOR');assert(detail.result.condition_events.some(e=>e.condition==='damaged'));
});
test('missing, quarantined and in-service statuses block issuance',async()=>{
 await reset();for(const id of ['AST-013','AST-031','AST-033']){const r=await post(`/api/assets/${id}/checkout`,{borrower_code:'BR-01',due_at:future()});assert.equal(r.status,409)}
 const flag=await post('/api/assets/AST-021/flag',{status:'in_service',note:'Sent for service'});assert.equal(flag.status,200);assert.equal((await post('/api/assets/AST-021/checkout',{borrower_code:'BR-01',due_at:future()})).status,409);
});
test('date-only maintenance due persists until logged service; policy history retained',async()=>{
 await reset();const beforeD=await req('/api/dashboard',{auth:teacher});assert(beforeD.result.maintenance.some(a=>a.id==='AST-014'));
 const asset=await req('/api/assets/AST-014',{auth:teacher});assert.equal(asset.result.plan_version,1);const original=asset.result.next_due_date;
 const policy=await post('/api/assets/AST-014/policy',{interval_days:45});assert.equal(policy.status,200);assert.equal(policy.result.plan_version,2);
 const detail=await req('/api/assets/AST-014',{auth:teacher});assert.equal(detail.result.plan_versions.length,2);assert.equal(detail.result.service_events[0].plan_version,1);assert.equal(detail.result.service_events[0].next_due_date,original);
 const srv=await post('/api/assets/AST-014/service',{serviced_date:new Date().toISOString().slice(0,10),note:'Routine maintenance documented'});assert.equal(srv.status,200);assert.equal(srv.result.plan_version,2);
 const afterD=await req('/api/dashboard',{auth:teacher});assert(!afterD.result.maintenance.some(a=>a.id==='AST-014'));
});
test('import corrects invalid rows without duplicating accepted assets',async()=>{
 await reset();const text='tag,category,make_model,serial_ref,home_location_id\nAST-NEW-01,Hand Tools,Test hammer,abc,LOC-1\nAST-001,Hand Tools,Duplicate,bcd,LOC-1\nAST-NEW-03,Power Tools,Test drill,cde,\n';
 const preview=await post('/api/import/preview',{csv:text});assert.equal(preview.status,200);assert.deepEqual(preview.result.rows.map(r=>r.errors.length===0),[true,false,false]);
 const rows=preview.result.rows.map(r=>({row_number:r.row_number,values:r.values}));const result=await post('/api/import/commit',{batch_id:preview.result.batch_id,rows});assert.equal(result.status,200);assert.equal(result.result.committed.length,1);assert.equal(result.result.invalid.length,2);
 rows[1].values.tag='AST-NEW-02';rows[2].values.home_location_id='LOC-2';const fixed=await post('/api/import/commit',{batch_id:preview.result.batch_id,rows});assert.equal(fixed.status,200);assert.equal(fixed.result.committed.length,3);assert.equal(fixed.result.invalid.length,0);assert.equal(fixed.result.committed.filter(r=>r.already_accepted).length,1);
 const a=await req('/api/assets',{auth:teacher});assert.equal(a.result.length,63);
 const repeated=await post('/api/import/commit',{batch_id:preview.result.batch_id,rows});assert.equal(repeated.result.committed.length,3);assert.equal((await req('/api/assets',{auth:teacher})).result.length,63);
});
test('purchase request is saved only as draft; actor and values survive reload',async()=>{
 await reset();const r=await post('/api/requests',{item_name:'Replacement saw blade',quantity:2,reason:'Reported defect',asset_id:'AST-031',vendor_id:'VEN-2',estimated_unit_price:'37.50'});assert.equal(r.status,201);assert.equal(r.result.approval_status,'draft');assert.equal(r.result.estimated_unit_price_cents,3750);
 const get=await req('/api/requests',{auth:teacher});assert.equal(get.result[0].created_by,'DEMO-INSTRUCTOR');
 const csv=await req('/api/export/requests',{auth:teacher,raw:true});assert.equal(csv.status,200);assert.match(csv.result,/Replacement saw blade/);
 const conn=new DatabaseSync(file,{readOnly:true});assert.equal(conn.prepare('SELECT COUNT(*) n FROM purchase_requests').get().n,1);conn.close();
});
test('server-side role authorization prevents unapproved release or purchasing',async()=>{
 await reset();assert.equal((await post('/api/requests',{item_name:'Something',quantity:1,reason:'Test'},viewer)).status,403);
 assert.equal((await post('/api/assets/AST-031/release',{condition:'good',note:'Review'},staff)).status,403);
 assert.equal((await post('/api/assets/AST-015/checkout',{borrower_code:'BR-01',due_at:future()},viewer)).status,403);
 assert.equal((await req('/api/assets/AST-031',{auth:viewer})).status,200);
});


test('asset edit retains tag, curated vendor and condition attribution; defect blocks issue',async()=>{
 await reset();const id='AST-023';
 const edited=await post(`/api/assets/${id}/edit`,{category:'Hand Tools',make_model:'Adjusted mallet',serial_ref:'SER-EDIT-23',home_location_id:'LOC-2',current_location_id:'LOC-3',condition:'damaged',vendor_id:'VEN-4',note:'Crack observed at handle'});
 assert.equal(edited.status,200);assert.equal(edited.result.tag,id);assert.equal(edited.result.status,'inspection_required');assert.equal(edited.result.current_location_id,'LOC-3');assert.equal(edited.result.vendor_names,'Cedar Safety Catalog');
 assert.equal((await post(`/api/assets/${id}/checkout`,{borrower_code:'BR-01',due_at:future()})).status,409);
 const detail=await req(`/api/assets/${id}`,{auth:teacher});assert.equal(detail.result.condition_events[0].notes,'Crack observed at handle');
 assert.equal((await post(`/api/assets/${id}/edit`,{category:'Hand Tools',make_model:'Edited',home_location_id:'LOC-1',current_location_id:'LOC-1',condition:'good',note:'Try bypass'})).status,409);
});
test('import stores both original and normalized source values for reconciliation',async()=>{
 await reset();const text='tag,category,make_model,serial_ref,home_location_id\nAST-NEW-55,Measuring,Angle gauge,XY-55,LOC-2\n';
 const preview=await post('/api/import/preview',{csv:text});const row=preview.result.rows[0];
 const result=await post('/api/import/commit',{batch_id:preview.result.batch_id,rows:[{row_number:row.row_number,values:row.values}]});assert.equal(result.result.committed.length,1);
 const conn=new DatabaseSync(file,{readOnly:true});const v=conn.prepare('SELECT original_json,normalized_json FROM import_rows WHERE batch_id=?').get(preview.result.batch_id);conn.close();
 assert.equal(JSON.parse(v.original_json).make_model,'Angle gauge');assert.equal(JSON.parse(v.normalized_json).tag,'AST-NEW-55');
});
