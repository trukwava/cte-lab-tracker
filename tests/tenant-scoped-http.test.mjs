import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { openDatabase, seed } from '../src/db.ts';
import { provision } from '../src/auth.ts';

const root = resolve(import.meta.dirname, '..');
const password = 'not-a-real-user-secret-0123456789';

test('two fictional organizations are isolated across HTTP reads, actions, imports, exports, and audits', async () => {
 const dir=mkdtempSync(join(tmpdir(),'cte-tenant-http-'));
 const file=join(dir,'isolated.sqlite'),port=31000+Math.floor(Math.random()*15000),base=`http://127.0.0.1:${port}`;
 let db, child, stderr='';
 try {
  db=openDatabase(file);seed(db);provision(db,'rivertonadmin','instructor',password);
  const now=new Date().toISOString();
  db.prepare('INSERT INTO labs(id,name,demo) VALUES (?,?,1)').run('oak-lab','Oak Laboratory (fictional)');
  db.prepare('INSERT INTO locations VALUES (?,?,?)').run('LOC-OAK','oak-lab','Oak tool crib');
  db.prepare('INSERT INTO borrower_refs VALUES (?,?,?)').run('BR-OAK','oak-lab','Fictional Oak borrower');
  db.prepare('INSERT INTO vendor_refs VALUES (?,?,?,?,?)').run('VEN-OAK','oak-lab','Fictional Oak vendor','O-01','2026-09-01');
  db.prepare('INSERT INTO assets(id,lab_id,tag,category,make_model,serial_ref,home_location_id,current_location_id,condition,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('AST-OAK-001','oak-lab','AST-OAK-001','Power Tools','Oak drill','O-001','LOC-OAK','LOC-OAK','good','available',now);
  const plan=db.prepare('INSERT INTO maintenance_plan_versions(asset_id,version,interval_days,effective_at,base_date,next_due_date) VALUES (?,?,?,?,?,?)').run('AST-OAK-001',1,60,now,'2026-01-01','2026-03-02');
  db.prepare('UPDATE assets SET current_plan_id=? WHERE id=?').run(plan.lastInsertRowid,'AST-OAK-001');
  db.prepare('INSERT INTO service_events(asset_id,plan_version_id,serviced_date,next_due_date,notes,actor,recorded_at) VALUES (?,?,?,?,?,?,?)').run('AST-OAK-001',plan.lastInsertRowid,'2026-02-01','2026-04-02','Fictional service','OAK-TECH',now);
  db.prepare('INSERT INTO purchase_requests(lab_id,item_name,quantity,reason,approval_status,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run('oak-lab','Oak-only bit',1,'Replenishment','draft','OAK-TECH',now);
  db.prepare('INSERT INTO audit_events(lab_id,entity,entity_id,action,actor,details_json,created_at) VALUES (?,?,?,?,?,?,?)').run('oak-lab','asset','AST-OAK-001','created','OAK-TECH','{}',now);
  const salt='1133557799aabbccddeeff0011223344',accountId=randomUUID();
  db.prepare('INSERT INTO local_accounts(id,lab_id,username,role,salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)').run(accountId,'oak-lab','oakteacher','instructor',salt,scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex'),now);
  db.prepare('INSERT INTO lab_memberships(account_id,lab_id,role,enabled,granted_at) VALUES (?,?,?,?,?)').run(accountId,'oak-lab','instructor',1,now);
  db.prepare('INSERT INTO organization_memberships(account_id,organization_id,role,enabled,granted_at) VALUES (?,?,?,?,?)').run(accountId,'org-oak-lab','instructor',1,now);
  child=spawn(process.execPath,['--no-warnings','--experimental-strip-types','src/server.ts'],{cwd:root,env:{...process.env,AUTH_MODE:'pilot',DB_FILE:file,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',data=>stderr+=data.toString());
  let started=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/api/session')).ok){started=true;break}}catch{}await sleep(75)}
  assert(started,stderr);
  const send=async (path,{cookie='',method='GET',body,raw=false}={})=>{
   const response=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
   return {status:response.status,data:raw?await response.text():await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const oakLogin=await send('/api/auth/login',{method:'POST',body:{username:'oakteacher',password}});
  const rivLogin=await send('/api/auth/login',{method:'POST',body:{username:'rivertonadmin',password}});
  assert.equal(oakLogin.status,200);assert.equal(rivLogin.status,200);
  const oak=oakLogin.cookie,riv=rivLogin.cookie;
  assert.deepEqual([(await send('/api/session',{cookie:oak})).data.lab_id,(await send('/api/session',{cookie:oak})).data.organization_id],['oak-lab','org-oak-lab']);
  for(const [path,field,expected] of [
   ['/api/assets','tag','AST-OAK-001'],['/api/locations','id','LOC-OAK'],['/api/borrowers','code','BR-OAK'],
   ['/api/vendors','id','VEN-OAK'],['/api/requests','item_name','Oak-only bit'],
   ['/api/maintenance','asset_id','AST-OAK-001'],['/api/audit','entity_id','AST-OAK-001']
  ]){
   const o=await send(path,{cookie:oak}),r=await send(path,{cookie:riv});
   assert.equal(o.status,200,path);assert.equal(r.status,200,path);
   assert(o.data.some(x=>x[field]===expected),`Oak missing ${path}`);
   assert(!r.data.some(x=>x[field]===expected),`Riverton leaked ${path}`);
  }
  const oakDash=(await send('/api/dashboard',{cookie:oak})).data;
  assert.equal(oakDash.assets,1);assert.equal(oakDash.maintenanceDueCount,1);
  assert.equal((await send('/api/assets/AST-001',{cookie:oak})).status,404);
  assert.equal((await send('/api/assets/AST-OAK-001',{cookie:riv})).status,404);
  assert.equal((await send('/api/assets/AST-OAK-001/flag',{cookie:riv,method:'POST',body:{status:'missing',note:'Untrusted cross-lab action'}})).status,404);
  for(const [path,secret] of [['/api/export/assets','AST-OAK-001'],['/api/export/requests','Oak-only bit']]) {
   const r=await send(path,{cookie:riv,raw:true}),o=await send(path,{cookie:oak,raw:true});
   assert.equal(r.status,200);assert.equal(o.status,200);assert(!r.data.includes(secret));assert(o.data.includes(secret));
  }
  assert.equal((await send('/api/requests',{cookie:oak,method:'POST',body:{item_name:'Reject foreign asset',asset_id:'AST-001',quantity:1,reason:'Untrusted reference'}})).status,404);
  assert.equal((await send('/api/requests',{cookie:oak,method:'POST',body:{item_name:'Reject foreign vendor',vendor_id:'VEN-1',quantity:1,reason:'Untrusted reference'}})).status,400);
  assert.equal((await send('/api/assets',{cookie:oak,method:'POST',body:{tag:'AST-OAK-NEW',category:'Power Tools',make_model:'Sample',home_location_id:'LOC-1',interval_days:90}})).status,400);
  assert.equal((await send('/api/labels?ids=AST-001',{cookie:oak,raw:true})).status,404);
  const importCsv='tag,category,make_model,serial_ref,home_location_id\nAST-OAK-NEW,Power Tools,Imported Oak saw,OAK-SERIAL-002,LOC-OAK';
  const preview=await send('/api/import/preview',{cookie:oak,method:'POST',body:{csv:importCsv,lab_id:'riverton'}});
  assert.equal(preview.status,200);
  assert.deepEqual(preview.data.rows[0].errors,[]);
  const deniedBatch=await send('/api/import/commit',{cookie:riv,method:'POST',body:{batch_id:preview.data.batch_id,rows:[preview.data.rows[0]]}});
  assert.equal(deniedBatch.status,404);
  const imported=await send('/api/import/commit',{cookie:oak,method:'POST',body:{batch_id:preview.data.batch_id,rows:[preview.data.rows[0]]}});
  assert.equal(imported.status,200);
  assert.equal(imported.data.committed[0].asset_id,'AST-OAK-NEW');
  assert.equal(db.prepare("SELECT lab_id FROM assets WHERE id='AST-OAK-NEW'").get().lab_id,'oak-lab');
  assert.equal((await send('/api/assets/AST-OAK-NEW',{cookie:riv})).status,404);

  // A second-lab checkout is permitted only for the holder of that lab membership.
  const due=new Date(Date.now()+2*86400_000).toISOString();
  assert.equal((await send('/api/assets/AST-OAK-001/checkout',{cookie:oak,method:'POST',body:{borrower_code:'BR-OAK',due_at:due,condition:'good'}})).status,200);
  assert.equal((await send('/api/assets/AST-OAK-001/checkout',{cookie:oak,method:'POST',body:{borrower_code:'BR-OAK',due_at:due}})).status,409);
  assert.equal((await send('/api/assets/AST-OAK-001/return',{cookie:oak,method:'POST',body:{condition:'damaged',location_id:'LOC-OAK',note:'Reported damage'}})).status,200);
  assert.equal((await send('/api/assets/AST-OAK-001',{cookie:oak})).data.status,'inspection_required');
  assert.equal((await send('/api/requests',{cookie:oak,method:'POST',body:{item_name:'Oak replacement',vendor_id:'VEN-OAK',asset_id:'AST-OAK-001',quantity:1,reason:'Damage'}})).status,201);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE lab_id='oak-lab' AND actor='oakteacher'").get().n,4);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE lab_id='riverton' AND actor='oakteacher'").get().n,0);
  db.prepare("UPDATE organization_memberships SET enabled=0 WHERE account_id=? AND organization_id='org-oak-lab'").run(accountId);
  assert.equal((await send('/api/assets',{cookie:oak})).status,401);
  assert.equal((await send('/api/assets',{cookie:riv})).status,200);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 } finally {
  if(child){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}
  db?.close();rmSync(dir,{recursive:true,force:true});
 }
});
