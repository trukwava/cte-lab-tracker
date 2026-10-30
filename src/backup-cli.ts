// Local-only SQLite snapshot and conservative restore utility. No cloud services.
// Run with Node >=22.16, which includes the built-in SQLite backup API.
import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, chmodSync, copyFileSync, constants, existsSync, linkSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.ts';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const source=resolve(process.env.DB_FILE||join(root,'data',process.env.AUTH_MODE==='pilot'?'riverton-pilot.sqlite':'riverton-demo.sqlite'));
const [action,p1,p2]=process.argv.slice(2);
const fail=(message:string):never=>{throw Error(message)};
const assertFile=(path:string)=>{
 if(!existsSync(path)||!statSync(path).isFile())fail('Database file does not exist: '+path);
};
const newDestination=(path:string)=>{
 if(path===source)fail('Destination cannot equal the live database');
 if(existsSync(path))fail('Refusing to overwrite existing file: '+path);
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
};
const dbSummary=(path:string)=>{
 assertFile(path);
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  const result=db.prepare('PRAGMA quick_check').all() as {quick_check:string}[];
  if(result.length!==1||result[0].quick_check!=='ok')fail('SQLite quick_check failed');
  if((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length)fail('SQLite foreign_key_check found invalid references');
  const labs=Number((db.prepare('SELECT COUNT(*) count FROM labs').get() as any).count);
  const assets=Number((db.prepare('SELECT COUNT(*) count FROM assets').get() as any).count);
  const activeLoans=Number((db.prepare('SELECT COUNT(*) count FROM loans WHERE returned_at IS NULL').get() as any).count);
  const auditEvents=Number((db.prepare('SELECT COUNT(*) count FROM audit_events').get() as any).count);
  return {labs,assets,activeLoans,auditEvents};
 }finally{db.close()}
};
async function sha256(path:string){const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);return digest.digest('hex')}
async function run(){
 process.umask(0o077);
 if(action==='verify'){
  if(!p1||p2)fail('Usage: backup-cli.ts verify BACKUP_PATH');
  const path=resolve(p1),counts=dbSummary(path);
  console.log(JSON.stringify({status:'verified',file:path,sha256:await sha256(path),...counts}));return;
 }
 if(action==='backup'){
  if(!p1||p2)fail('Usage: backup-cli.ts backup DESTINATION.sqlite');
  assertFile(source);
  const destination=resolve(p1);newDestination(destination);
  const temporary=destination+'.partial-'+randomUUID();
  const sourceDb=new DatabaseSync(source,{readOnly:true});
  try{
   await backup(sourceDb,temporary);
   chmodSync(temporary,0o600);
   const counts=dbSummary(temporary);const checksum=await sha256(temporary);
   // Atomic create-only publication: a concurrent destination cannot be overwritten.
   linkSync(temporary,destination);
   console.log(JSON.stringify({status:'backed_up',file:destination,sha256:checksum,...counts}));
  }finally{sourceDb.close();if(existsSync(temporary))unlinkSync(temporary)}
  return;
 }
 if(action==='restore'){
  if(!p1||!p2)fail('Usage: backup-cli.ts restore BACKUP_PATH NEW_DATABASE_PATH');
  const original=resolve(p1),destination=resolve(p2);if(original===destination)fail('Restore destination must be a new path');
  const before=dbSummary(original);newDestination(destination);
  try{
   copyFileSync(original,destination,constants.COPYFILE_EXCL);chmodSync(destination,0o600);
   // An archived cookie must never become an active session after a restore.
   const restored=openDatabase(destination);
   try{restored.prepare('DELETE FROM local_sessions').run()}finally{restored.close()}
   const counts=dbSummary(destination);
   if(counts.assets!==before.assets||counts.activeLoans!==before.activeLoans||counts.auditEvents!==before.auditEvents)fail('Restore content mismatch');
   console.log(JSON.stringify({status:'restored',file:destination,sha256:await sha256(destination),sessionsRevoked:true,...counts}));
  }catch(error){if(existsSync(destination))unlinkSync(destination);throw error}
  return;
 }
 fail('Usage: backup-cli.ts backup DESTINATION.sqlite | verify BACKUP_PATH | restore BACKUP_PATH NEW_DATABASE_PATH');
}
run().catch(error=>{console.error('Database recovery error:',error?.message||String(error));process.exitCode=1});
