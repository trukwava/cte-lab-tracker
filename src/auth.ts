// Local-only pilot identity adapter. Production hosting requires an independently
// reviewed identity provider, TLS, durable shared session storage and tenant scoping.
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { DB } from './db.ts';
export type Role='instructor'|'staff'|'viewer';
export type Identity={actor:string,role:Role,labId:'riverton',expires:number};
const PASSWORD_BYTES=64;
const DUMMY_SALT='f2b9923c3dcd9cf2ee63a447da5b94b0';
const DUMMY_HASH=scryptSync('invalid-login-dummy',Buffer.from(DUMMY_SALT,'hex'),PASSWORD_BYTES);
const tokenDigest=(token:string)=>createHash('sha256').update(token).digest('hex');
const usernameOf=(name:unknown)=>typeof name==='string'?name.trim().toLowerCase():'';
export function validUsername(name:string){return /^[a-z][a-z0-9_.-]{2,30}$/.test(name)}
export function generateCredential(){return randomBytes(24).toString('base64url')}
export function provision(db:DB,usernameRaw:string,role:Role,password:string){
 const username=usernameOf(usernameRaw);
 if(!validUsername(username))throw Error('Username must be 3–31 lowercase letters, numbers, dot, dash or underscore, starting with a letter');
 if(!['instructor','staff','viewer'].includes(role))throw Error('Invalid role');
 if(password.length<20||password.length>200)throw Error('Invalid credential length');
 if(!db.prepare('SELECT id FROM labs WHERE id=?').get('riverton'))throw Error('Initialize the fictional lab before creating accounts');
 const salt=randomBytes(16).toString('hex');const hash=scryptSync(password,Buffer.from(salt,'hex'),PASSWORD_BYTES).toString('hex');
 const existing=db.prepare('SELECT id FROM local_accounts WHERE username=?').get(username) as any;
 if(existing){
  db.prepare('UPDATE local_accounts SET role=?,salt=?,password_hash=?,disabled=0 WHERE id=?').run(role,salt,hash,existing.id);
  db.prepare(`INSERT INTO lab_memberships(account_id,lab_id,role,enabled,granted_at) VALUES (?,?,?,?,?) ON CONFLICT(account_id,lab_id) DO UPDATE SET role=excluded.role,enabled=1`).run(existing.id,'riverton',role,1,new Date().toISOString());
  db.prepare('DELETE FROM local_sessions WHERE account_id=?').run(existing.id);
  return {username,role,rotated:true};
 }
 const accountId=randomUUID();const now=new Date().toISOString();
 db.prepare('INSERT INTO local_accounts(id,lab_id,username,role,salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)').run(accountId,'riverton',username,role,salt,hash,now);
 db.prepare('INSERT INTO lab_memberships(account_id,lab_id,role,enabled,granted_at) VALUES (?,?,?,?,?)').run(accountId,'riverton',role,1,now);
 return {username,role,rotated:false};
}
export function disableAccount(db:DB,usernameRaw:string){
 const username=usernameOf(usernameRaw);const found=db.prepare('SELECT id FROM local_accounts WHERE username=?').get(username) as any;
 if(!found)throw Error('Account not found');
 db.prepare('UPDATE local_accounts SET disabled=1 WHERE id=?').run(found.id);
 db.prepare('UPDATE lab_memberships SET enabled=0 WHERE account_id=?').run(found.id);
 db.prepare('DELETE FROM local_sessions WHERE account_id=?').run(found.id);
 return {username,disabled:true};
}
export function verifyCredentials(db:DB,usernameRaw:unknown,passwordRaw:unknown){
 const username=usernameOf(usernameRaw);const password=typeof passwordRaw==='string'?passwordRaw:'';
 // Equivalent scrypt cost for unknown users avoids a cheap account-enumeration oracle.
 const account=validUsername(username)?db.prepare(`SELECT a.*,m.role membership_role,m.enabled membership_enabled FROM local_accounts a LEFT JOIN lab_memberships m ON m.account_id=a.id AND m.lab_id=a.lab_id WHERE a.username=?`).get(username) as any:null;
 const salt=account?Buffer.from(account.salt,'hex'):Buffer.from(DUMMY_SALT,'hex');
 const reference=account?Buffer.from(account.password_hash,'hex'):DUMMY_HASH;
 const supplied=scryptSync(password.slice(0,200),salt,PASSWORD_BYTES);
 if(!account||account.disabled||account.membership_enabled!==1||password.length>200||!timingSafeEqual(reference,supplied))return null;
 return {accountId:account.id,actor:account.username,role:account.membership_role as Role,labId:'riverton' as const};
}
export function createSession(db:DB,user:{accountId:string,actor:string,role:Role,labId:'riverton'}){
 const token=randomBytes(32).toString('base64url'),expires=Date.now()+8*3600_000;
 db.prepare('DELETE FROM local_sessions WHERE expires_at<=?').run(Date.now());
 db.prepare('INSERT INTO local_sessions(token_hash,account_id,expires_at,created_at) VALUES (?,?,?,?)').run(tokenDigest(token),user.accountId,expires,new Date().toISOString());
 return {token,expires};
}
export function getSession(db:DB,token:string):Identity|null{
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
 const record=db.prepare(`SELECT a.username actor,m.role,a.lab_id labId,s.expires_at expires FROM local_sessions s JOIN local_accounts a ON a.id=s.account_id JOIN lab_memberships m ON m.account_id=a.id AND m.lab_id=a.lab_id AND m.enabled=1 WHERE s.token_hash=? AND s.expires_at>? AND a.disabled=0`).get(tokenDigest(token),Date.now()) as any;
 if(!record||record.labId!=='riverton')return null;
 return {actor:record.actor,role:record.role,labId:'riverton',expires:record.expires};
}
export function revokeSession(db:DB,token:string){if(token)db.prepare('DELETE FROM local_sessions WHERE token_hash=?').run(tokenDigest(token))}
