import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { openDatabase, seed } from '../src/db.ts';
import { provision } from '../src/auth.ts';

const root=resolve(import.meta.dirname,'..');
const credential='synthetic-credential-012345678901234567';
test('live HTTP authorization responds to organization role downgrades and revocation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cte-org-http-'));
 const file=join(dir,'pilot.sqlite');const port=31000+Math.floor(Math.random()*15000);
 const base=`http://127.0.0.1:${port}`;
 let child, db, stderr='';
 try{
  db=openDatabase(file);seed(db);provision(db,'schoolmanager','instructor',credential);
  const account=db.prepare("SELECT id FROM local_accounts WHERE username='schoolmanager'").get();
  child=spawn(process.execPath,['--no-warnings','--experimental-strip-types','src/server.ts'],{cwd:root,env:{...process.env,AUTH_MODE:'pilot',DB_FILE:file,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',chunk=>stderr+=chunk.toString());
  let started=false;
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/session')).ok){started=true;break}}catch{}await sleep(75)}
  assert(started,stderr);
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'schoolmanager',password:credential})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const request=async(path,method='GET',body)=>{
   const response=await fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
   return {status:response.status,data:await response.json()};
  };
  assert.equal((await request('/api/session')).data.role,'instructor');
  assert.equal((await request('/api/requests','POST',{item_name:'Synthetic blade',quantity:1,reason:'Test before permission change'})).status,201);
  db.prepare("UPDATE organization_memberships SET role='viewer' WHERE account_id=? AND organization_id='org-riverton'").run(account.id);
  assert.equal((await request('/api/session')).data.role,'viewer');
  assert.equal((await request('/api/requests','POST',{item_name:'Blocked request',quantity:1,reason:'Unauthorized mutation'})).status,403);
  db.prepare("UPDATE organization_memberships SET enabled=0 WHERE account_id=? AND organization_id='org-riverton'").run(account.id);
  assert.equal((await request('/api/assets')).status,401);
  assert.equal((await request('/api/session')).data.authenticated,false);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM purchase_requests').get().count,1);
 }finally{
  if(child){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}
  db?.close();rmSync(dir,{recursive:true,force:true});
 }
});
