import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { openDatabase, seed } from '../src/db.ts';
import { provision, createSession } from '../src/auth.ts';
import { exportSqlite, verifyExport, TABLE_NAMES, OMITTED_AUTH_TABLES } from '../src/postgres-migration.ts';

const root=resolve(import.meta.dirname,'..');
const folder=()=>mkdtempSync(join(tmpdir(),'cte-pg-migrate-'));
const rows=(folder,name)=>readFileSync(join(folder,name+'.ndjson'),'utf8').split('\n').filter(Boolean).map(JSON.parse);

test('exports a consistent operational snapshot, preserves provenance and omits pilot credentials',async()=>{
 const dir=folder(),source=join(dir,'source.sqlite'),output=join(dir,'pg-export');
 try{
  const db=openDatabase(source);seed(db);
  provision(db,'testteacher','instructor','random-test-passphrase-123456789');
  const account=db.prepare("SELECT id FROM local_accounts WHERE username='testteacher'").get();
  createSession(db,{accountId:account.id,actor:'testteacher',role:'instructor',labId:'riverton'});
  db.prepare(`INSERT INTO import_batches (id,lab_id,created_by,created_at,raw_csv) VALUES (?,?,?,?,?)`).run('IMPORT-1','riverton','testteacher',new Date().toISOString(),'tag,name\nA,B');
  db.prepare(`INSERT INTO import_rows (batch_id,row_number,asset_id,original_json,normalized_json) VALUES (?,?,?,?,?)`).run('IMPORT-1',2,'AST-001',JSON.stringify({raw:' B '}),JSON.stringify({value:'B'}));
  const sourceCount=db.prepare('SELECT COUNT(*) n FROM assets').get().n;
  const result=await exportSqlite(source,output); // DB connection still open, including WAL
  assert.equal(result.table_count,19);assert.equal(result.excluded_auth_tables.length,4);
  assert.deepEqual(verifyExport(output),{status:'verified',table_count:19,total_rows:result.total_rows,format:'cte-lab-postgres-operational-v1',auth_excluded:true});
  assert.equal(rows(output,'assets').length,sourceCount);
  assert.equal(rows(output,'loans').filter(x=>x.returned_at===null).length,12);
  assert.equal(rows(output,'loans')[0].lab_id,'riverton');
  assert.equal(rows(output,'maintenance_plan_versions')[0].lab_id,'riverton');
  assert.equal(rows(output,'import_rows')[0].lab_id,'riverton');
  assert.deepEqual(rows(output,'import_rows')[0].original_json,{raw:' B '});
  assert.equal(rows(output,'import_batches')[0].raw_csv,'tag,name\nA,B');
  assert.equal(typeof rows(output,'audit_events')[0].details_json,'object');
  assert.equal(readdirSync(output).length,20);
  assert.ok(!readdirSync(output).some(f=>OMITTED_AUTH_TABLES.some(a=>f.startsWith(a))));
  assert.ok(!readFileSync(join(output,'manifest.json'),'utf8').includes('random-test-passphrase'));
  assert.equal(statSync(join(output,'manifest.json')).mode&0o777,0o600);
  assert.equal(statSync(output).mode&0o777,0o700);
  db.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('exports two fictional organizations without mixing lab-owned child rows',async()=>{
 const dir=folder(),source=join(dir,'source.sqlite'),output=join(dir,'export');
 try{
  const db=openDatabase(source);seed(db);
  db.prepare('INSERT INTO labs VALUES (?,?,?)').run('annex','Annex Fictional Lab',1);
  db.prepare('INSERT INTO locations VALUES (?,?,?)').run('annex-loc','annex','Annex cabinet');
  db.prepare('INSERT INTO borrower_refs VALUES (?,?,?)').run('annex-borrower','annex','Borrower');
  db.prepare('INSERT INTO assets(id,lab_id,tag,category,make_model,serial_ref,home_location_id,current_location_id,condition,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('annex-asset','annex','ANNEX-001','Power Tools','Drill',null,'annex-loc','annex-loc','good','on_loan',new Date().toISOString());
  db.prepare('INSERT INTO loans(asset_id,borrower_code,issued_at,due_at,checkout_condition,issued_by) VALUES (?,?,?,?,?,?)').run('annex-asset','annex-borrower',new Date().toISOString(),new Date().toISOString(),'good','annex-staff');
  await exportSqlite(source,output);
  const mappings=rows(output,'organization_labs');
  assert.equal(mappings.find(x=>x.lab_id==='annex').organization_id,'org-annex');
  const annex=rows(output,'loans').find(x=>x.asset_id==='annex-asset');
  assert.equal(annex.lab_id,'annex');
  assert.equal(rows(output,'assets').find(x=>x.id==='annex-asset').lab_id,'annex');
  assert.equal(rows(output,'loans').filter(x=>x.lab_id==='riverton').length,12);
  assert.equal(verifyExport(output).status,'verified');
  db.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('refuses cross-lab references inserted through bypassed SQLite triggers',async()=>{
 const dir=folder(),source=join(dir,'source.sqlite'),out=join(dir,'export');
 try{
  const db=openDatabase(source);seed(db);
  db.prepare('INSERT INTO labs VALUES (?,?,?)').run('annex','Annex Fictional Lab',1);
  db.prepare('INSERT INTO vendor_refs VALUES (?,?,?,?,?)').run('V-ANNEX','annex','Other lab supplier',null,'2026-11-01');
  db.exec('DROP TRIGGER purchase_refs_lab_insert');
  db.prepare(`INSERT INTO purchase_requests(lab_id,asset_id,item_name,quantity,reason,vendor_id,approval_status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run('riverton','AST-001','Replacement',1,'test','V-ANNEX','draft','TEST',new Date().toISOString());
  await assert.rejects(exportSqlite(source,out),/Cross-lab or orphan vendor_id/);
  assert.equal(existsSync(out),false);
  db.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('verify detects file mutation, missing manifest rows and unexpected files',async()=>{
 const dir=folder(),source=join(dir,'source.sqlite'),out=join(dir,'export');
 try{
  const db=openDatabase(source);seed(db);db.close();await exportSqlite(source,out);
  writeFileSync(join(out,'loans.ndjson'),'{}\n');
  assert.throws(()=>verifyExport(out),/byte size|Hash mismatch|Row count/);
  rmSync(out,{recursive:true,force:true});await exportSqlite(source,out);
  writeFileSync(join(out,'unsafe-extra.txt'),'unexpected');
  assert.throws(()=>verifyExport(out),/Unexpected file/);
  rmSync(join(out,'unsafe-extra.txt'));
  const manifestPath=join(out,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  manifest.excluded_auth_tables=[];writeFileSync(manifestPath,JSON.stringify(manifest));
  assert.throws(()=>verifyExport(out),/Auth exclusion list changed/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('export is create-only and refuses to put raw operational data inside the public repository',async()=>{
 const dir=folder(),source=join(dir,'source.sqlite'),out=join(dir,'export');
 try{
  const db=openDatabase(source);seed(db);db.close();
  await exportSqlite(source,out);
  await assert.rejects(exportSqlite(source,out),/Destination exists/);
  await assert.rejects(exportSqlite(source,join(root,'data','unsafe-export')),/inside the source repository/);
  assert.equal(TABLE_NAMES.length,19);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('PostgreSQL schema includes composite tenant foreign keys and partial loan/quarantine uniqueness',()=>{
 const sql=readFileSync(join(root,'migrations','postgres','001_operational.sql'),'utf8');
 assert.match(sql,/CREATE UNIQUE INDEX only_one_active_loan_per_asset ON loans\(asset_id\) WHERE returned_at IS NULL;/);
 assert.match(sql,/CREATE UNIQUE INDEX only_one_open_quarantine ON quarantines\(asset_id\) WHERE closed_at IS NULL;/);
 assert.match(sql,/FOREIGN KEY \(lab_id,borrower_code\) REFERENCES borrower_refs\(lab_id,code\)/);
 assert.match(sql,/FOREIGN KEY \(lab_id,asset_id,plan_version_id\) REFERENCES maintenance_plan_versions/);
 assert.match(sql,/DEFERRABLE INITIALLY DEFERRED/);
 for(const name of TABLE_NAMES)assert.match(sql,new RegExp('CREATE TABLE '+name+' \\('));
 assert.doesNotMatch(sql,/CREATE TABLE local_sessions|CREATE TABLE local_accounts/);
});
