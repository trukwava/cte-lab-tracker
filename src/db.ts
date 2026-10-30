import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isoNow,datePlus,dateAfter,CATEGORIES } from './domain.ts';
export type DB = DatabaseSync;
export function openDatabase(file:string):DB {
  mkdirSync(dirname(file),{recursive:true});const db=new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  migrate(db);return db;
}
export function migrate(db:DB){db.exec(`
CREATE TABLE IF NOT EXISTS labs (id TEXT PRIMARY KEY,name TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY,lab_id TEXT NOT NULL REFERENCES labs(id),name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS borrower_refs (code TEXT PRIMARY KEY,lab_id TEXT NOT NULL REFERENCES labs(id),label TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vendor_refs (id TEXT PRIMARY KEY,lab_id TEXT NOT NULL REFERENCES labs(id),name TEXT NOT NULL,catalog_ref TEXT,last_checked TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS asset_vendor_refs (asset_id TEXT NOT NULL REFERENCES assets(id),vendor_id TEXT NOT NULL REFERENCES vendor_refs(id),PRIMARY KEY(asset_id,vendor_id));
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY,lab_id TEXT NOT NULL REFERENCES labs(id),tag TEXT NOT NULL UNIQUE,category TEXT NOT NULL,make_model TEXT NOT NULL,serial_ref TEXT,home_location_id TEXT REFERENCES locations(id),current_location_id TEXT REFERENCES locations(id),condition TEXT NOT NULL CHECK(condition IN ('good','worn','damaged','unknown')),status TEXT NOT NULL CHECK(status IN ('available','on_loan','missing','quarantined','inspection_required','in_service')),current_plan_id INTEGER,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS asset_tags (id INTEGER PRIMARY KEY AUTOINCREMENT,asset_id TEXT NOT NULL REFERENCES assets(id),identifier TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS maintenance_plan_versions (id INTEGER PRIMARY KEY AUTOINCREMENT,asset_id TEXT NOT NULL REFERENCES assets(id),version INTEGER NOT NULL,interval_days INTEGER NOT NULL CHECK(interval_days>=1 AND interval_days<=3650),effective_at TEXT NOT NULL,base_date TEXT NOT NULL,next_due_date TEXT NOT NULL,UNIQUE(asset_id,version));
CREATE TABLE IF NOT EXISTS loans (id INTEGER PRIMARY KEY AUTOINCREMENT,asset_id TEXT NOT NULL REFERENCES assets(id),borrower_code TEXT NOT NULL REFERENCES borrower_refs(code),issued_at TEXT NOT NULL,due_at TEXT NOT NULL,returned_at TEXT,checkout_condition TEXT NOT NULL,return_condition TEXT,return_location_id TEXT REFERENCES locations(id),issued_by TEXT NOT NULL,returned_by TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS only_one_active_loan_per_asset ON loans(asset_id) WHERE returned_at IS NULL;
CREATE TABLE IF NOT EXISTS condition_events (id INTEGER PRIMARY KEY AUTOINCREMENT,asset_id TEXT NOT NULL REFERENCES assets(id),loan_id INTEGER REFERENCES loans(id),condition TEXT NOT NULL,notes TEXT,actor TEXT NOT NULL,recorded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quarantines (id INTEGER PRIMARY KEY AUTOINCREMENT,asset_id TEXT NOT NULL REFERENCES assets(id),reason TEXT NOT NULL,opened_at TEXT NOT NULL,opened_by TEXT NOT NULL,closed_at TEXT,closed_by TEXT,release_note TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS only_one_open_quarantine ON quarantines(asset_id) WHERE closed_at IS NULL;
CREATE TABLE IF NOT EXISTS service_events (id INTEGER PRIMARY KEY AUTOINCREMENT,asset_id TEXT NOT NULL REFERENCES assets(id),plan_version_id INTEGER NOT NULL REFERENCES maintenance_plan_versions(id),serviced_date TEXT NOT NULL,next_due_date TEXT NOT NULL,notes TEXT NOT NULL,reference TEXT,actor TEXT NOT NULL,recorded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS purchase_requests (id INTEGER PRIMARY KEY AUTOINCREMENT,lab_id TEXT NOT NULL REFERENCES labs(id),asset_id TEXT REFERENCES assets(id),item_name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),reason TEXT NOT NULL,vendor_id TEXT REFERENCES vendor_refs(id),estimated_unit_price_cents INTEGER,approval_status TEXT NOT NULL CHECK(approval_status IN ('draft','sent_for_review','externally_approved','declined')),created_by TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (id INTEGER PRIMARY KEY AUTOINCREMENT,lab_id TEXT NOT NULL REFERENCES labs(id),asset_id TEXT REFERENCES assets(id),action TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT,lab_id TEXT NOT NULL REFERENCES labs(id),entity TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS import_batches (id TEXT PRIMARY KEY,lab_id TEXT NOT NULL REFERENCES labs(id),created_by TEXT NOT NULL,created_at TEXT NOT NULL,raw_csv TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS import_rows (batch_id TEXT NOT NULL REFERENCES import_batches(id),row_number INTEGER NOT NULL,asset_id TEXT NOT NULL REFERENCES assets(id),original_json TEXT,normalized_json TEXT,PRIMARY KEY(batch_id,row_number));
`);
 // Additive schema upgrades preserve existing SQLite demo records.
 for(const [table,col,definition] of [['import_batches','raw_csv',"TEXT NOT NULL DEFAULT ''"],['import_rows','original_json','TEXT'],['import_rows','normalized_json','TEXT']]){
   const cols=db.prepare('PRAGMA table_info('+table+')').all() as any[];
   if(!cols.some(c=>c.name===col))db.exec('ALTER TABLE '+table+' ADD COLUMN '+col+' '+definition);
 }
}
export function transaction<T>(db:DB,fn:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
export function audit(db:DB,entity:string,id:string,action:string,actor:string,details:unknown={}){db.prepare('INSERT INTO audit_events(lab_id,entity,entity_id,action,actor,details_json,created_at) VALUES (?,?,?,?,?,?,?)').run('riverton',entity,id,action,actor,JSON.stringify(details),isoNow())}
export function isSeeded(db:DB){return Number(db.prepare('SELECT COUNT(*) n FROM assets').get().n)>0}
export function seed(db:DB) {transaction(db,()=>{
  for(const table of ['import_rows','import_batches','audit_events','approvals','purchase_requests','service_events','quarantines','condition_events','loans','maintenance_plan_versions','asset_tags','asset_vendor_refs','assets','vendor_refs','borrower_refs','locations','labs'])db.exec('DELETE FROM '+table);
  db.prepare('INSERT INTO labs(id,name,demo) VALUES (?,?,1)').run('riverton','Riverton Technical School · Carpentry Lab');
  const locs=['Tool Crib','Workbench A','Workbench B','Machine Bay','Inspection Shelf'];
  locs.forEach((name,i)=>db.prepare('INSERT INTO locations VALUES (?,?,?)').run('LOC-'+(i+1),'riverton',name));
  for(let i=1;i<=10;i++)db.prepare('INSERT INTO borrower_refs VALUES (?,?,?)').run('BR-'+String(i).padStart(2,'0'),'riverton','Fictional borrower '+String(i).padStart(2,'0'));
  const vendors=['Northline Industrial','Harbor Workshop Supply','Keystone Tools','Cedar Safety Catalog','Eastern Shop Parts'];
  vendors.forEach((name,i)=>db.prepare('INSERT INTO vendor_refs VALUES (?,?,?,?,?)').run('VEN-'+(i+1),'riverton',name,'CAT-'+(i+101),datePlus(-15-i)));
  const models=[['Cordless drill','18V driver','Circular saw','Jigsaw','Orbital sander','Impact driver','Router','Reciprocating saw','Bench grinder','Belt sander'],['Claw hammer','Chisel set','Hand saw','Mallet','Block plane','Clamp set','Socket wrench','Utility knife','Pliers','Screwdriver set'],['Tape measure','Digital caliper','Combination square','Spirit level','Angle gauge','Laser measure','Try square','Marking gauge','Depth gauge','Moisture meter'],['Safety goggles','Ear defenders','Face shield','Dust extractor','Safety harness','First aid case','Respirator kit','Push stick','Fire blanket','Apron'],['Table saw','Band saw','Drill press','Miter saw','Scroll saw','Planer','Jointer','Lathe','Disc sander','Mortiser'],['Bit set','Blade kit','Extension reel','Vacuum hose','Saw guide','Battery pack','Charger','Toolbox','Dust filter','Router template']];
  const createAsset=db.prepare('INSERT INTO assets(id,lab_id,tag,category,make_model,serial_ref,home_location_id,current_location_id,condition,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const tagStmt=db.prepare('INSERT INTO asset_tags(asset_id,identifier,created_at) VALUES (?,?,?)');
  const planStmt=db.prepare('INSERT INTO maintenance_plan_versions(asset_id,version,interval_days,effective_at,base_date,next_due_date) VALUES (?,?,?,?,?,?)');
  const planSet=db.prepare('UPDATE assets SET current_plan_id=? WHERE id=?');
  for(let i=0;i<60;i++){
    const n=i+1,id='AST-'+String(n).padStart(3,'0'),category=CATEGORIES[Math.floor(i/10)],model=models[Math.floor(i/10)][i%10];
    const home=i===20?null:'LOC-'+((i%4)+1), status=[12,23].includes(i)?'missing':([30,31,32].includes(i)?'quarantined':(i<12?'on_loan':'available'));
    const cond=i===31?'damaged':i%9===0?'worn':'good';
    // Seed 2 assets with duplicate serial references as an import/reconciliation edge case.
    const serial=i===6?'SER-DUP-0006':i===7?'SER-DUP-0006':'SER-'+String(n).padStart(4,'0');
    createAsset.run(id,'riverton',id,category,model,serial,home,status==='missing'?null:status==='quarantined'?'LOC-5':home,cond,status,isoNow());tagStmt.run(id,id,isoNow());
    const reviewDue=(i>=13&&i<19);const interval=reviewDue?90:180;const base=datePlus(reviewDue?-110:-40);const next=dateAfter(base,interval);
    const p=planStmt.run(id,1,interval,isoNow(),base,next);planSet.run(p.lastInsertRowid,id);
  }
  for(let i=1;i<=12;i++){
    const id='AST-'+String(i).padStart(3,'0'), due=new Date(Date.now()+(i<=4?-2:3+i)*86400_000).toISOString(),issued=new Date(Date.now()-5*86400_000).toISOString();
    const stmt=db.prepare('INSERT INTO loans(asset_id,borrower_code,issued_at,due_at,checkout_condition,issued_by) VALUES (?,?,?,?,?,?)');stmt.run(id,'BR-'+String(((i-1)%10)+1).padStart(2,'0'),issued,due,'good','DEMO-INSTRUCTOR');
  }
  for(let i=14;i<=19;i++){
    const id='AST-'+String(i).padStart(3,'0');const plan=db.prepare('SELECT id,base_date,next_due_date FROM maintenance_plan_versions WHERE asset_id=?').get(id);
    db.prepare('INSERT INTO service_events(asset_id,plan_version_id,serviced_date,next_due_date,notes,reference,actor,recorded_at) VALUES (?,?,?,?,?,?,?,?)').run(id,plan.id,plan.base_date,plan.next_due_date,'Routine service logged; no safety certification','SRV-FIXTURE-'+(i-13),'DEMO-INSTRUCTOR',isoNow());
  }
  for(let i=31;i<=33;i++){const id='AST-'+String(i).padStart(3,'0');db.prepare('INSERT INTO quarantines(asset_id,reason,opened_at,opened_by) VALUES (?,?,?,?)').run(id,i===32?'Reported defect':'Inspection required',isoNow(),'DEMO-INSTRUCTOR');}
  db.prepare('INSERT INTO condition_events(asset_id,condition,notes,actor,recorded_at) VALUES (?,?,?,?,?)').run('AST-032','damaged','Damaged return observed during previous lab session','DEMO-INSTRUCTOR',isoNow());
  audit(db,'lab','riverton','demo_seed','SYSTEM',{assets:60,activeLoans:12,overdue:4,serviceEvents:6,quarantined:3});
})}
