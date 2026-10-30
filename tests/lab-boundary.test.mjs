import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { openDatabase, seed } from '../src/db.ts';

const root=resolve(import.meta.dirname,'..');
const temp=mkdtempSync(join(tmpdir(),'cte-lab-boundary-'));
const file=join(temp,'test.sqlite');
const port=32000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${port}`;
const foreign='foreign-lab',foreignAsset='AST-FOREIGN-01';
let child,cookie='',stderr='';
const now=new Date().toISOString();
let db;
before(async()=>{
 db=openDatabase(file);seed(db);
 db.prepare('INSERT INTO labs(id,name,demo) VALUES (?,?,1)').run(foreign,'Synthetic other lab');
 db.prepare('INSERT INTO locations(id,lab_id,name) VALUES (?,?,?)').run('FOREIGN-LOC',foreign,'Private other lab location');
 db.prepare('INSERT INTO borrower_refs(code,lab_id,label) VALUES (?,?,?)').run('FOREIGN-BR',foreign,'Private other borrower');
 db.prepare('INSERT INTO vendor_refs(id,lab_id,name,last_checked) VALUES (?,?,?,?)').run('FOREIGN-VEN',foreign,'Private other vendor','2026-10-01');
 db.prepare(`INSERT INTO assets(id,lab_id,tag,category,make_model,home_location_id,condition,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(foreignAsset,foreign,foreignAsset,'Power Tools','Private other drill','FOREIGN-LOC','good','on_loan',now);
 db.prepare(`INSERT INTO loans(asset_id,borrower_code,issued_at,due_at,checkout_condition,issued_by) VALUES (?,?,?,?,?,?)`).run(foreignAsset,'FOREIGN-BR',now,'2020-01-01T00:00:00.000Z','good','OTHER-ACCOUNT');
 const p=db.prepare('INSERT INTO maintenance_plan_versions(asset_id,version,interval_days,effective_at,base_date,next_due_date) VALUES (?,?,?,?,?,?)').run(foreignAsset,1,90,now,'2020-01-01','2020-03-31');
 db.prepare('UPDATE assets SET current_plan_id=? WHERE id=?').run(p.lastInsertRowid,foreignAsset);
 db.prepare('INSERT INTO service_events(asset_id,plan_version_id,serviced_date,next_due_date,notes,actor,recorded_at) VALUES (?,?,?,?,?,?,?)').run(foreignAsset,p.lastInsertRowid,'2020-01-01','2020-03-31','Private foreign service note','OTHER-ACCOUNT',now);
 child=spawn(process.execPath,['--no-warnings','--experimental-strip-types','src/server.ts'],{cwd:root,env:{...process.env,AUTH_MODE:'demo',DB_FILE:file,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',chunk=>stderr+=chunk.toString());
 let started=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/api/session')).ok){started=true;break}}catch{}await sleep(75)}
 assert(started,'server startup: '+stderr);
 const response=await fetch(base+'/api/demo/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'instructor'})});
 assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];
});
after(async()=>{
 if(child){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}
 db?.close();rmSync(temp,{recursive:true,force:true});
});
async function get(path){const r=await fetch(base+path,{headers:{Cookie:cookie}});const contentType=r.headers.get('content-type')||'';return {status:r.status,data:contentType.includes('json')?await r.json():await r.text()}}
async function post(path,body={}){const r=await fetch(base+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}}

test('persistent relational rules reject cross-lab references even when bypassing HTTP',()=>{
 assert.throws(()=>db.prepare('UPDATE assets SET current_location_id=? WHERE id=?').run('FOREIGN-LOC','AST-014'),/Cross-lab asset location/);
 assert.throws(()=>db.prepare('INSERT INTO loans(asset_id,borrower_code,issued_at,due_at,checkout_condition,issued_by) VALUES (?,?,?,?,?,?)').run('AST-014','FOREIGN-BR',now,'2028-01-01T00:00:00.000Z','good','ATTACK'),/Cross-lab borrower loan/);
 assert.throws(()=>db.prepare('INSERT INTO asset_vendor_refs(asset_id,vendor_id) VALUES (?,?)').run('AST-014','FOREIGN-VEN'),/Cross-lab vendor association/);
 assert.throws(()=>db.prepare('UPDATE assets SET lab_id=? WHERE id=?').run(foreign,'AST-014'),/Asset lab assignment is immutable/);
 assert.throws(()=>db.prepare('UPDATE assets SET current_plan_id=? WHERE id=?').run(db.prepare('SELECT current_plan_id FROM assets WHERE id=?').get(foreignAsset).current_plan_id,'AST-014'),/Current plan does not belong to asset/);
 assert.throws(()=>db.prepare('INSERT INTO service_events(asset_id,plan_version_id,serviced_date,next_due_date,notes,actor,recorded_at) VALUES (?,?,?,?,?,?,?)').run('AST-014',db.prepare('SELECT current_plan_id FROM assets WHERE id=?').get(foreignAsset).current_plan_id,'2020-01-01','2020-03-31','Misbound service','ATTACK',now),/Service plan does not belong to asset/);
 assert.throws(()=>db.prepare('INSERT INTO purchase_requests(lab_id,asset_id,item_name,quantity,reason,approval_status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run('riverton',foreignAsset,'Bad draft',1,'Cross-lab attempt','draft','ATTACK',now),/Cross-lab purchase reference/);
 assert.throws(()=>db.prepare('INSERT INTO import_batches(id,lab_id,created_by,created_at) VALUES (?,?,?,?)').run('FOREIGN-BATCH',foreign,'OTHER',now) && db.prepare('INSERT INTO import_rows(batch_id,row_number,asset_id) VALUES (?,?,?)').run('FOREIGN-BATCH',2,'AST-014'),/Cross-lab import row/);
});
test('every list, dashboard and export excludes another lab records',async()=>{
 const dashboard=await get('/api/dashboard');assert.equal(dashboard.status,200);assert.equal(dashboard.data.onLoan,12);assert.equal(dashboard.data.overdueCount,4);assert(!dashboard.data.overdue.some(x=>x.asset_id===foreignAsset));
 for(const [url,key] of [['/api/assets','id'],['/api/loans','asset_id'],['/api/maintenance','asset_id']]){const response=await get(url);assert.equal(response.status,200);assert(!response.data.some(x=>x[key]===foreignAsset),url)}
 const vendors=await get('/api/vendors');assert(!vendors.data.some(x=>x.id==='FOREIGN-VEN'));
 const assetExport=await get('/api/export/assets');assert(!assetExport.data.includes(foreignAsset));
 assert.equal((await get('/api/assets/'+foreignAsset)).status,404);
 assert.equal((await get('/api/labels?ids='+foreignAsset)).status,404);
 assert.equal((await post('/api/requests',{item_name:'Some item',quantity:1,reason:'Cross lab',asset_id:foreignAsset})).status,404);
});
test('a demo reset cannot erase data in another lab',async()=>{
 const reset=await post('/api/demo/reset');assert.equal(reset.status,409);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM assets WHERE lab_id=?').get(foreign).n,1);
 assert.throws(()=>seed(db),/Refusing to seed/);
});
