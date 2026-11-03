/**
 * Offline SQLite -> PostgreSQL operational-data migration preparation.
 * This command does NOT connect to PostgreSQL or change the running server.
 * Export an online-consistent SQLite snapshot as deterministic NDJSON and a
 * SHA-256 manifest. Local accounts, password hashes and sessions are excluded.
 */
import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, openSync, writeSync, closeSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const pgSchema=join(root,'migrations','postgres','001_operational.sql');
const FORMAT='cte-lab-postgres-operational-v1';
const MAX_FILE_BYTES=128*1024*1024;
const tables=[
 ['organizations','id'],['labs','id'],['organization_labs','lab_id'],
 ['locations','id'],['borrower_refs','code'],['vendor_refs','id'],
 ['assets','id'],['asset_tags','id'],['maintenance_plan_versions','id'],
 ['asset_vendor_refs','asset_id,vendor_id'],['loans','id'],
 ['condition_events','id'],['quarantines','id'],['service_events','id'],
 ['purchase_requests','id'],['approvals','id'],['audit_events','id'],
 ['import_batches','id'],['import_rows','batch_id,row_number']
] as const;
export const TABLE_NAMES=tables.map(([name])=>name);
export const OMITTED_AUTH_TABLES=['local_accounts','local_sessions','lab_memberships','organization_memberships'] as const;
type Row=Record<string,unknown>;
type ManifestTable={name:string,rows:number,sha256:string,bytes:number};
type Manifest={format:string,created_at:string,schema_sha256:string,content_type:string,
 tables:ManifestTable[],excluded_auth_tables:string[],total_rows:number,notes:string[]};
const hash=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');
const fail=(m:string):never=>{throw Error('PostgreSQL export: '+m)};
const assertPlain=(p:string)=>{const r=relative(root,p);if(r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!r.startsWith(sep)))fail('Refusing export inside the source repository; use a private directory outside it')};
const tableMap=(db:DatabaseSync,name:string,key:string):Map<string,Row>=>new Map((db.prepare(`SELECT * FROM ${name}`).all() as Row[]).map(r=>[String(r[key]),r]));
function scopeIndex(db:DatabaseSync){
 const labs=tableMap(db,'labs','id'),orgs=tableMap(db,'organizations','id');
 const orgLabs=tableMap(db,'organization_labs','lab_id');
 const assets=tableMap(db,'assets','id'),locations=tableMap(db,'locations','id');
 const borrowers=tableMap(db,'borrower_refs','code'),vendors=tableMap(db,'vendor_refs','id');
 const plans=tableMap(db,'maintenance_plan_versions','id'),loans=tableMap(db,'loans','id');
 const batches=tableMap(db,'import_batches','id');
 for(const [lab,row] of labs){
  const mapping=orgLabs.get(lab);
  if(!mapping||!orgs.has(String(mapping.organization_id)))fail('Missing organization mapping for lab '+lab);
 }
 return {labs,orgs,orgLabs,assets,locations,borrowers,vendors,plans,loans,batches};
}
type Index=ReturnType<typeof scopeIndex>;
function assertRef(idx:Index,source:Row,table:keyof Index,idField:string,lab:string){
 const id=source[idField];if(id===null||id===undefined)return;
 const parent=idx[table].get(String(id));
 if(!parent||String(parent.lab_id)!==lab)fail(`Cross-lab or orphan ${idField} on exported ${String(source.id??source.asset_id??source.batch_id)}`);
}
function project(name:string,source:Row,idx:Index):Row{
 const r={...source};
 const assetDerived=new Set(['asset_tags','maintenance_plan_versions','asset_vendor_refs','loans','condition_events','quarantines','service_events']);
 if(assetDerived.has(name)){
  const asset=idx.assets.get(String(r.asset_id));if(!asset)fail(`Missing asset for ${name}`);
  r.lab_id=asset.lab_id;
 }
 if(name==='import_rows'){
  const batch=idx.batches.get(String(r.batch_id));if(!batch)fail('Missing import batch');
  r.lab_id=batch.lab_id;
 }
 const lab=String(r.lab_id??'');
 if(name==='organization_labs'){
  if(!idx.labs.has(String(r.lab_id))||!idx.orgs.has(String(r.organization_id)))fail('Invalid organization/lab reference');
 }
 if(name==='assets'){
  assertRef(idx,r,'locations','home_location_id',lab);
  assertRef(idx,r,'locations','current_location_id',lab);
  if(r.current_plan_id!=null){const plan=idx.plans.get(String(r.current_plan_id));if(!plan||plan.asset_id!==r.id)fail('Current maintenance plan belongs to another asset');}
 }
 if(name==='asset_vendor_refs')assertRef(idx,r,'vendors','vendor_id',lab);
 if(name==='loans'){
  assertRef(idx,r,'borrowers','borrower_code',lab);
  assertRef(idx,r,'locations','return_location_id',lab);
 }
 if(name==='condition_events'&&r.loan_id!=null){
  const loan=idx.loans.get(String(r.loan_id));if(!loan||loan.asset_id!==r.asset_id)fail('Condition event refers to another asset loan');
 }
 if(name==='service_events'){
  const plan=idx.plans.get(String(r.plan_version_id));if(!plan||plan.asset_id!==r.asset_id)fail('Service event refers to another asset plan');
 }
 if(name==='purchase_requests'||name==='approvals')assertRef(idx,r,'assets','asset_id',lab);
 if(name==='purchase_requests')assertRef(idx,r,'vendors','vendor_id',lab);
 if(name==='import_rows')assertRef(idx,r,'assets','asset_id',lab);
 if(name==='locations'||name==='borrower_refs'||name==='vendor_refs'||name==='assets'||name==='purchase_requests'||name==='approvals'||name==='audit_events'||name==='import_batches'){
  if(!idx.labs.has(lab))fail('Row references unknown lab '+lab);
 }
 for(const field of ['details_json','original_json','normalized_json']){
  if(name==='audit_events'&&field==='details_json'||name==='import_rows'&&field!=='details_json'){
   if(r[field]!=null){try{r[field]=JSON.parse(String(r[field]))}catch{fail(`Invalid ${field} JSON`);}}
  }
 }
 return r;
}
function ensureHealthy(db:DatabaseSync){
 const checks=db.prepare('PRAGMA quick_check').all() as {quick_check:string}[];
 if(checks.length!==1||checks[0].quick_check!=='ok')fail('SQLite integrity check failed');
 if(db.prepare('PRAGMA foreign_key_check').all().length)fail('SQLite foreign-key check failed');
 const duplicates=db.prepare('SELECT asset_id FROM loans WHERE returned_at IS NULL GROUP BY asset_id HAVING COUNT(*)>1 LIMIT 1').get();
 if(duplicates)fail('Duplicate active loans detected');
}
function makeRows(db:DatabaseSync,outDir:string){
 const idx=scopeIndex(db),items:ManifestTable[]=[];
 let total=0;
 for(const [name,columns] of tables){
  const filename=join(outDir,name+'.ndjson'),fd=openSync(filename,'wx',0o600),digest=createHash('sha256');let rows=0,bytes=0;
  try{
   const sql=`SELECT * FROM ${name} ORDER BY ${columns}`;
   for(const entry of db.prepare(sql).iterate() as Iterable<Row>){
    const projected=project(name,entry,idx),line=JSON.stringify(projected)+'\n';
    const buffer=Buffer.from(line);bytes+=buffer.length;
    if(bytes>MAX_FILE_BYTES)fail(`File-size limit exceeded for ${name}; use an approved streaming migration`);
    writeSync(fd,buffer);digest.update(buffer);rows++;
   }
  }finally{closeSync(fd)}
  items.push({name,rows,sha256:digest.digest('hex'),bytes});total+=rows;
 }
 return {items,total};
}
export async function exportSqlite(source:string,destination:string){
 const dbFile=resolve(source),target=resolve(destination);process.umask(0o077);
 if(!existsSync(dbFile)||!statSync(dbFile).isFile())fail('Source SQLite file not found');
 assertPlain(target);
 if(existsSync(target))fail('Destination exists; exports are create-only');
 const tmp=mkdtempSync(join(tmpdir(),'cte-pg-snapshot-'));
 let created=false;
 try{
  const live=new DatabaseSync(dbFile,{readOnly:true});
  try{await backup(live,join(tmp,'snapshot.sqlite'))}finally{live.close()}
  const snapshot=new DatabaseSync(join(tmp,'snapshot.sqlite'),{readOnly:true});
  try{
   ensureHealthy(snapshot);scopeIndex(snapshot);
   mkdirSync(target,{mode:0o700});created=true;
   const {items,total}=makeRows(snapshot,target);
   const manifest:Manifest={format:FORMAT,created_at:new Date().toISOString(),
    schema_sha256:hash(readFileSync(pgSchema)),content_type:'application/x-ndjson',
    tables:items,excluded_auth_tables:[...OMITTED_AUTH_TABLES],total_rows:total,
    notes:['Synthetic/demo data only; not approved for live records',
     'Original import CSV, audit actor names and notes may be sensitive: store this directory privately',
     'Accounts, password hashes, memberships and sessions deliberately excluded; re-provision identities separately',
     'PostgreSQL is not running and no data has been imported; this is an offline handoff']};
   writeFileSync(join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
   return {directory:target,total_rows:total,table_count:items.length,excluded_auth_tables:manifest.excluded_auth_tables};
  }finally{snapshot.close()}
 }catch(e){if(created)rmSync(target,{recursive:true,force:true});throw e}
 finally{rmSync(tmp,{recursive:true,force:true})}
}
export function verifyExport(directory:string){
 const target=resolve(directory),manifest=JSON.parse(readFileSync(join(target,'manifest.json'),'utf8')) as Manifest;
 if(manifest.format!==FORMAT)fail('Unexpected manifest format');
 if(manifest.schema_sha256!==hash(readFileSync(pgSchema)))fail('Schema digest mismatch');
 if(JSON.stringify(manifest.excluded_auth_tables)!==JSON.stringify(OMITTED_AUTH_TABLES))fail('Auth exclusion list changed');
 if(manifest.tables.length!==tables.length||manifest.tables.some((t,i)=>t.name!==tables[i][0]))fail('Table manifest is incomplete or out of order');
 const allowed=new Set(['manifest.json',...TABLE_NAMES.map(t=>t+'.ndjson')]);
 if(readdirSync(target).some(name=>!allowed.has(name)))fail('Unexpected file in export directory');
 let count=0;
 for(const entry of manifest.tables){
  const file=join(target,entry.name+'.ndjson');if(statSync(file).size!==entry.bytes||entry.bytes>MAX_FILE_BYTES)fail('Unexpected byte size for '+entry.name);
  const data=readFileSync(file);if(hash(data)!==entry.sha256)fail('Hash mismatch for '+entry.name);
  const rows=data.length===0?[]:data.toString('utf8').trimEnd().split('\n').map(s=>JSON.parse(s));
  if(rows.length!==entry.rows)fail('Row count mismatch for '+entry.name);
  if(rows.some(r=>typeof r!=='object'||r===null||Array.isArray(r)))fail('Invalid NDJSON row in '+entry.name);
  count+=rows.length;
 }
 if(count!==manifest.total_rows)fail('Manifest total count mismatch');
 return {status:'verified',table_count:manifest.tables.length,total_rows:count,format:FORMAT,auth_excluded:true};
}
async function cli(){
 const [command,...args]=process.argv.slice(2);
 if(command==='export'&&args.length===2){console.log(JSON.stringify(await exportSqlite(args[0],args[1])));return}
 if(command==='verify'&&args.length===1){console.log(JSON.stringify(verifyExport(args[0])));return}
 fail('Usage: npm run pg:migrate -- export SOURCE.sqlite NEW_DIRECTORY | verify EXPORT_DIRECTORY');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 cli().catch(e=>{console.error(e?.message||String(e));process.exitCode=1});
}
