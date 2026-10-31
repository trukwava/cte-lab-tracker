import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase,seed } from '../src/db.ts';
import { provision,verifyCredentials,createSession,getSession,disableAccount } from '../src/auth.ts';

test('legacy pilot accounts migrate to explicitly enabled lab memberships',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lab-members-'));const path=join(dir,'db.sqlite');
 try{
 const db=openDatabase(path);seed(db);
 provision(db,'instructorone','instructor','a-long-test-password-0123456789');
 const a=db.prepare("SELECT id FROM local_accounts WHERE username='instructorone'").get();
 db.exec('DROP TABLE lab_memberships');db.close();
 const migrated=openDatabase(path);
 const m=migrated.prepare('SELECT lab_id,role,enabled FROM lab_memberships WHERE account_id=?').get(a.id);
 assert.deepEqual({...m},{lab_id:'riverton',role:'instructor',enabled:1});
 assert.equal(verifyCredentials(migrated,'instructorone','a-long-test-password-0123456789').role,'instructor');
 migrated.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('membership revocation invalidates existing sessions and cannot be bypassed by account role',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lab-members-'));const db=openDatabase(join(dir,'db.sqlite'));seed(db);
 try{
 const password='another-strong-test-password-012345';
 provision(db,'operatorone','instructor',password);
 const identity=verifyCredentials(db,'operatorone',password);
 const {token}=createSession(db,identity);
 assert.equal(getSession(db,token).role,'instructor');
 db.prepare("UPDATE lab_memberships SET role='viewer' WHERE account_id=? AND lab_id='riverton'").run(identity.accountId);
 assert.equal(getSession(db,token).role,'viewer');
 db.prepare("UPDATE lab_memberships SET enabled=0 WHERE account_id=? AND lab_id='riverton'").run(identity.accountId);
 assert.equal(getSession(db,token),null);
 assert.equal(verifyCredentials(db,'operatorone',password),null);
 provision(db,'operatorone','staff','replacement-password-0123456789');
 assert.equal(getSession(db,token),null);
 assert.equal(verifyCredentials(db,'operatorone','replacement-password-0123456789').role,'staff');
 disableAccount(db,'operatorone');
 assert.equal(verifyCredentials(db,'operatorone','replacement-password-0123456789'),null);
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});
