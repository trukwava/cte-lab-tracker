import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase,seed } from '../src/db.ts';

test('SQLite constraints reject cross-lab return locations, approvals and loan observations even with direct writes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cte-db-boundary-'));
 const db=openDatabase(join(dir,'test.sqlite'));
 try{
  seed(db);
  db.prepare('INSERT INTO labs(id,name,demo) VALUES (?,?,1)').run('outside','Fictional other lab');
  db.prepare('INSERT INTO locations(id,lab_id,name) VALUES (?,?,?)').run('LOC-OUTSIDE','outside','Outside crib');
  db.prepare('INSERT INTO borrower_refs(code,lab_id,label) VALUES (?,?,?)').run('BR-OUTSIDE','outside','Outside borrower');
  db.prepare('INSERT INTO assets(id,lab_id,tag,category,make_model,home_location_id,current_location_id,condition,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('AST-OUTSIDE','outside','AST-OUTSIDE','Power tools','Outside saw','LOC-OUTSIDE','LOC-OUTSIDE','good','on_loan',new Date().toISOString());
  const outside=db.prepare('INSERT INTO loans(asset_id,borrower_code,issued_at,due_at,checkout_condition,issued_by) VALUES (?,?,?,?,?,?)').run('AST-OUTSIDE','BR-OUTSIDE',new Date().toISOString(),new Date(Date.now()+3600000).toISOString(),'good','OAK-TEACHER').lastInsertRowid;
  const local=db.prepare("SELECT id FROM loans WHERE asset_id='AST-001'").get().id;
  assert.throws(()=>db.prepare('UPDATE loans SET return_location_id=? WHERE id=?').run('LOC-OUTSIDE',local),/Cross-lab loan return location/);
  assert.throws(()=>db.prepare('UPDATE loans SET return_location_id=? WHERE id=?').run('LOC-1',outside),/Cross-lab loan return location/);
  assert.throws(()=>db.prepare('INSERT INTO condition_events(asset_id,loan_id,condition,actor,recorded_at) VALUES (?,?,?,?,?)').run('AST-OUTSIDE',local,'good','TEST',new Date().toISOString()),/Condition observation belongs to another asset loan/);
  assert.throws(()=>db.prepare('INSERT INTO approvals(lab_id,asset_id,action,note,actor,created_at) VALUES (?,?,?,?,?,?)').run('riverton','AST-OUTSIDE','instructor_release','Untrusted','TEST',new Date().toISOString()),/Cross-lab approval reference/);
  db.prepare('INSERT INTO approvals(lab_id,asset_id,action,note,actor,created_at) VALUES (?,?,?,?,?,?)').run('outside','AST-OUTSIDE','review','Fictional','TEST',new Date().toISOString());
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});
