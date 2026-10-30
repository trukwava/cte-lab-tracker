import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { openDatabase, seed } from '../src/db.ts';
import { provision, createSession } from '../src/auth.ts';

const root=resolve(import.meta.dirname,'..');
const exec=(file,args,dbFile)=>spawnSync(process.execPath,['--no-warnings','--experimental-strip-types',file,...args],{cwd:root,env:{...process.env,AUTH_MODE:'pilot',DB_FILE:dbFile},encoding:'utf8'});

test('online SQLite snapshot verifies and restores to a new file, revoking sessions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cte-backup-'));const source=join(dir,'source.sqlite'),snapshot=join(dir,'snapshot.sqlite'),restored=join(dir,'restored.sqlite');
 try{
  const db=openDatabase(source);seed(db);
  const account=provision(db,'backupteacher','instructor','test-only-random-passphrase-2026');
  const id=db.prepare('SELECT id FROM local_accounts WHERE username=?').get(account.username).id;
  createSession(db,{accountId:id,actor:'backupteacher',role:'instructor',labId:'riverton'});
  db.prepare('INSERT INTO audit_events(lab_id,entity,entity_id,action,actor,details_json,created_at) VALUES (?,?,?,?,?,?,?)').run('riverton','backup','test','backup_probe','TEST','{}',new Date().toISOString());
  // Leave a writer connection open; online backup must include WAL state.
  const backup=exec('src/backup-cli.ts',['backup',snapshot],source);assert.equal(backup.status,0,backup.stderr);const b=JSON.parse(backup.stdout);db.close();assert.equal(b.status,'backed_up');assert.equal(b.assets,60);assert.equal(b.activeLoans,12);assert.equal(b.sha256.length,64);
  const verify=exec('src/backup-cli.ts',['verify',snapshot],source);assert.equal(verify.status,0,verify.stderr);assert.equal(JSON.parse(verify.stdout).sha256,b.sha256);
  const overwrite=exec('src/backup-cli.ts',['backup',snapshot],source);assert.notEqual(overwrite.status,0);assert.match(overwrite.stderr,/Refusing to overwrite/);
  const restore=exec('src/backup-cli.ts',['restore',snapshot,restored],source);assert.equal(restore.status,0,restore.stderr);const r=JSON.parse(restore.stdout);assert.equal(r.status,'restored');assert.equal(r.sessionsRevoked,true);assert.equal(r.auditEvents,b.auditEvents);
  const db2=new DatabaseSync(restored,{readOnly:true});assert.equal(db2.prepare('SELECT COUNT(*) n FROM local_sessions').get().n,0);assert.equal(db2.prepare('SELECT COUNT(*) n FROM local_accounts').get().n,1);db2.close();
  const second=exec('src/backup-cli.ts',['restore',snapshot,restored],source);assert.notEqual(second.status,0);assert.match(second.stderr,/Refusing to overwrite/);
  writeFileSync(join(dir,'broken.sqlite'),'not a database');const broken=exec('src/backup-cli.ts',['verify',join(dir,'broken.sqlite')],source);assert.notEqual(broken.status,0);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
