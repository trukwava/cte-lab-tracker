import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, seed, migrate } from '../src/db.ts';
import { createSession, getSession, provision, verifyCredentials, disableAccount } from '../src/auth.ts';

const withDatabase = (fn) => {
 const dir=mkdtempSync(join(tmpdir(),'cte-org-'));
 let db;
 try {db=openDatabase(join(dir,'organization.sqlite'));seed(db);return fn(db,join(dir,'organization.sqlite'))}
 finally {db?.close();rmSync(dir,{recursive:true,force:true})}
};
const password='synthetic-long-credential-for-testing-12345';
const orgRow=(db,id='riverton')=>db.prepare('SELECT organization_id FROM organization_labs WHERE lab_id=?').get(id);

test('each lab is isolated into a different organization by default; organization moves require review',()=>withDatabase(db=>{
 assert.equal(orgRow(db).organization_id,'org-riverton');
 db.prepare('INSERT INTO labs(id,name,demo) VALUES (?,?,1)').run('east-lab','Fictional East Lab');
 assert.equal(orgRow(db,'east-lab').organization_id,'org-east-lab');
 assert.notEqual(orgRow(db).organization_id,orgRow(db,'east-lab').organization_id);
 assert.throws(()=>db.prepare('UPDATE organization_labs SET organization_id=? WHERE lab_id=?').run('org-east-lab','riverton'),/Organization reassignment/);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
}));

test('organization-level permissions cap a lab role and change live sessions immediately',()=>withDatabase(db=>{
 provision(db,'pilotteacher','instructor',password);
 const user=verifyCredentials(db,'pilotteacher',password);
 assert.equal(user.role,'instructor');
 const cookie=createSession(db,user).token;
 const accountId=user.accountId;
 db.prepare("UPDATE organization_memberships SET role='viewer' WHERE account_id=? AND organization_id='org-riverton'").run(accountId);
 assert.equal(getSession(db,cookie).role,'viewer');
 assert.equal(verifyCredentials(db,'pilotteacher',password).role,'viewer');
 db.prepare("UPDATE organization_memberships SET role='staff' WHERE account_id=? AND organization_id='org-riverton'").run(accountId);
 assert.equal(getSession(db,cookie).role,'staff');
 db.prepare("UPDATE lab_memberships SET role='viewer' WHERE account_id=? AND lab_id='riverton'").run(accountId);
 assert.equal(getSession(db,cookie).role,'viewer');
 db.prepare("UPDATE organization_memberships SET enabled=0 WHERE account_id=? AND organization_id='org-riverton'").run(accountId);
 assert.equal(getSession(db,cookie),null);
 assert.equal(verifyCredentials(db,'pilotteacher',password),null);
 // Migration/backfill must never silently reactivate a revoked membership.
 migrate(db);
 assert.equal(getSession(db,cookie),null);
 assert.equal(db.prepare('SELECT enabled FROM organization_memberships WHERE account_id=?').get(accountId).enabled,0);
}));

test('another organization membership cannot grant access to a different lab through the account home lab',()=>withDatabase(db=>{
 db.prepare('INSERT INTO labs(id,name,demo) VALUES (?,?,1)').run('foreign-lab','Synthetic foreign lab');
 provision(db,'inspector','viewer',password);
 const actor=verifyCredentials(db,'inspector',password);
 db.prepare('INSERT INTO organization_memberships(account_id,organization_id,role,enabled,granted_at) VALUES (?,?,?,?,?)').run(actor.accountId,'org-foreign-lab','instructor',1,new Date().toISOString());
 db.prepare('INSERT INTO lab_memberships(account_id,lab_id,role,enabled,granted_at) VALUES (?,?,?,?,?)').run(actor.accountId,'foreign-lab','instructor',1,new Date().toISOString());
 // This deliberately does not make the local-only identity switchable by untrusted request data.
 assert.equal(verifyCredentials(db,'inspector',password).labId,'riverton');
 assert.equal(verifyCredentials(db,'inspector',password).role,'viewer');
 assert.throws(()=>db.prepare('UPDATE local_accounts SET lab_id=? WHERE id=?').run('foreign-lab',actor.accountId),/Account lab assignment is immutable/);
 db.prepare("UPDATE organization_memberships SET enabled=0 WHERE account_id=? AND organization_id='org-riverton'").run(actor.accountId);
 assert.equal(verifyCredentials(db,'inspector',password),null);
}));

test('additive migration backfills legacy org memberships but preserves revocation after restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cte-org-upgrade-'));const file=join(dir,'db.sqlite');
 let db=new DatabaseSync(file);
 try{
 db.exec("PRAGMA foreign_keys=ON; CREATE TABLE labs(id TEXT PRIMARY KEY,name TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 1); CREATE TABLE local_accounts(id TEXT PRIMARY KEY,lab_id TEXT NOT NULL REFERENCES labs(id),username TEXT NOT NULL UNIQUE COLLATE NOCASE,role TEXT NOT NULL CHECK(role IN ('instructor','staff','viewer')),salt TEXT NOT NULL,password_hash TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),created_at TEXT NOT NULL);");
 db.prepare('INSERT INTO labs VALUES (?,?,1)').run('riverton','Legacy Riverton');
 db.prepare('INSERT INTO local_accounts VALUES (?,?,?,?,?,?,?,?)').run('legacy-1','riverton','legacyteacher','staff','00','aa',0,'2026-01-01T00:00:00Z');
 db.close();db=openDatabase(file);
 assert.equal(orgRow(db).organization_id,'org-riverton');
 assert.deepEqual({...db.prepare('SELECT role,enabled FROM organization_memberships WHERE account_id=?').get('legacy-1')},{role:'staff',enabled:1});
 db.prepare('UPDATE organization_memberships SET enabled=0 WHERE account_id=?').run('legacy-1');
 db.close();db=openDatabase(file);
 assert.equal(db.prepare('SELECT enabled FROM organization_memberships WHERE account_id=?').get('legacy-1').enabled,0);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true})}
});
