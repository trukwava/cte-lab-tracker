import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const root=resolve(import.meta.dirname,'..'),temp=mkdtempSync(join(tmpdir(),'cte-pilot-'));
const file=join(temp,'pilot.sqlite'),port=31000+Math.floor(Math.random()*15000),base=`http://127.0.0.1:${port}`;
const env={...process.env,AUTH_MODE:'pilot',DB_FILE:file,HOST:'127.0.0.1',PORT:String(port)};
let child,stderr='',credentials={};
const account=(action,username,role)=>{
 const proc=spawnSync(process.execPath,['--no-warnings','--experimental-strip-types','src/account-cli.ts',action,username,...(role?[role]:[])],{cwd:root,env,encoding:'utf8'});
 assert.equal(proc.status,0,proc.stderr);return JSON.parse(proc.stdout);
};
async function runServer(){
 stderr='';child=spawn(process.execPath,['--no-warnings','--experimental-strip-types','src/server.ts'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',x=>stderr+=x.toString());let up=false;
 for(let i=0;i<70;i++){try{const res=await fetch(base+'/api/session');if(res.ok){up=true;break}}catch{}await sleep(75)}
 assert(up,'Server did not start '+stderr);
}
async function stopServer(){if(!child)return;const ch=child;child=null;ch.kill('SIGTERM');await new Promise(r=>ch.once('exit',r))}
async function request(path,{method='GET',body,token}={}){
 const r=await fetch(base+path,{method,headers:{...(token?{Cookie:token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
}
async function login(username,password){return request('/api/auth/login',{method:'POST',body:{username,password}})}
before(async()=>{
 credentials.teacher=account('create','teacher','instructor').temporary_password;
 credentials.staff=account('create','stockroom','staff').temporary_password;
 credentials.viewer=account('create','observer','viewer').temporary_password;
 await runServer();
});
after(async()=>{await stopServer();rmSync(temp,{recursive:true,force:true})});

test('pilot mode disables demo sign-in and protects signed-out records',async()=>{
 const d=await request('/api/demo/login',{method:'POST',body:{role:'instructor'}});
 assert.equal(d.status,404);
 const session=await request('/api/session');assert.deepEqual([session.data.authenticated,session.data.demo],[false,false]);
 assert.equal((await request('/api/assets')).status,401);
 assert.equal((await request('/api/demo/reset',{method:'POST',body:{}})).status,401);
});
test('pilot credentials authenticate with server-derived role and hashed stored session',async()=>{
 const bad=await login('teacher','wrong');assert.equal(bad.status,401);
 const valid=await login('teacher',credentials.teacher);assert.equal(valid.status,200);
 assert.equal(valid.data.role,'instructor');assert.equal(valid.data.demo,false);
 assert.match(valid.cookie,/^rv_session=[A-Za-z0-9_-]{43}$/);
 const session=await request('/api/session',{token:valid.cookie});assert.equal(session.data.actor,'teacher');assert.equal(session.data.lab_id,'riverton');
 const conn=new DatabaseSync(file,{readOnly:true});const hashed=conn.prepare('SELECT token_hash FROM local_sessions').get().token_hash;
 assert.equal(hashed.length,64);assert(!hashed.includes(valid.cookie.slice(11)));conn.close();
 assert.equal((await request('/api/demo/reset',{method:'POST',body:{},token:valid.cookie})).status,404);
 assert.equal((await request('/api/assets',{token:valid.cookie})).status,200);
});
test('local role gates protect instructor-only actions',async()=>{
 const viewer=await login('observer',credentials.viewer),staff=await login('stockroom',credentials.staff);
 assert.equal(viewer.status,200);assert.equal(staff.status,200);
 assert.equal((await request('/api/requests',{method:'POST',body:{item_name:'Test',quantity:1,reason:'Test'},token:viewer.cookie})).status,403);
 assert.equal((await request('/api/requests',{method:'POST',body:{item_name:'Test',quantity:1,reason:'Test'},token:staff.cookie})).status,403);
 assert.equal((await request('/api/assets',{token:viewer.cookie})).status,200);
});
test('pilot sessions survive restart, expire on sign-out, and revoke on credential rotation',async()=>{
 const teacher=await login('teacher',credentials.teacher);assert.equal(teacher.status,200);
 await stopServer();await runServer();
 assert.equal((await request('/api/session',{token:teacher.cookie})).data.authenticated,true);
 const loggedOut=await request('/api/auth/logout',{method:'POST',body:{},token:teacher.cookie});assert.equal(loggedOut.status,200);
 assert.equal((await request('/api/assets',{token:teacher.cookie})).status,401);
 const fresh=await login('teacher',credentials.teacher);assert.equal(fresh.status,200);
 const rotated=account('rotate','teacher','instructor');assert.equal(rotated.rotated,true);
 assert.equal((await request('/api/assets',{token:fresh.cookie})).status,401);
 assert.equal((await login('teacher',credentials.teacher)).status,401);
 credentials.teacher=rotated.temporary_password;
 const again=await login('teacher',credentials.teacher);assert.equal(again.status,200);
 account('disable','teacher');
 assert.equal((await request('/api/assets',{token:again.cookie})).status,401);
 assert.equal((await login('teacher',credentials.teacher)).status,401);
});
test('repeated invalid passwords hit the local rate limit',async()=>{
 // Reset earlier failures with a successful valid login.
 assert.equal((await login('observer',credentials.viewer)).status,200);
 for(let i=0;i<4;i++)assert.equal((await login('observer','not-the-password')).status,401);
 assert.equal((await login('observer','not-the-password')).status,401);
 assert.equal((await login('observer',credentials.viewer)).status,429);
});
