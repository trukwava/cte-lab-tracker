import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { openDatabase, seed, isSeeded, transaction, audit, type DB } from './db.ts';
import { CATEGORIES, CONDITIONS, BLOCKED, dateAfter, dateOnly, datePlus, isoNow, isIso, validateDate, safeText, parseCsv, csv } from './domain.ts';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const PORT=Number(process.env.PORT||4173),HOST=process.env.HOST||'127.0.0.1';
// This project uses selectable DEMO roles, not a real identity provider. Never
// listen on a network interface; a future deployment needs genuine auth first.
const LOOPBACK_HOSTS=new Set(['127.0.0.1','localhost']);
if(!LOOPBACK_HOSTS.has(HOST))throw new Error('Unsafe demo exposure refused: HOST must be 127.0.0.1 or localhost. Implement real authentication before network deployment.');
if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error('Invalid PORT: expected 1–65535');
const DB_FILE=process.env.DB_FILE||join(ROOT,'data','riverton-demo.sqlite');
const db=openDatabase(DB_FILE);if(!isSeeded(db))seed(db);
const sessions=new Map<string,{actor:string,role:'instructor'|'staff'|'viewer',expires:number}>();
class AppError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status}}
const fail=(code:number,message:string):never=>{throw new AppError(code,message)};
const fetchAsset=(id:string)=>db.prepare(`SELECT a.*,l.name home_location,c.name current_location,p.interval_days,p.next_due_date,p.version plan_version,(SELECT group_concat(v.name, ', ') FROM asset_vendor_refs av JOIN vendor_refs v ON v.id=av.vendor_id WHERE av.asset_id=a.id) vendor_names,(SELECT group_concat(av.vendor_id, ',') FROM asset_vendor_refs av WHERE av.asset_id=a.id) vendor_ids,(SELECT borrower_code FROM loans WHERE asset_id=a.id AND returned_at IS NULL) borrower_code,(SELECT due_at FROM loans WHERE asset_id=a.id AND returned_at IS NULL) loan_due_at FROM assets a LEFT JOIN locations l ON a.home_location_id=l.id LEFT JOIN locations c ON a.current_location_id=c.id LEFT JOIN maintenance_plan_versions p ON a.current_plan_id=p.id WHERE a.id=? AND a.lab_id='riverton'`).get(id) as any;
const needAsset=(id:string)=>{const asset=fetchAsset(id);if(!asset)fail(404,'Asset not found');return asset};
const locationExists=(id:string)=>!!db.prepare('SELECT 1 FROM locations WHERE id=? AND lab_id=?').get(id,'riverton');
const borrowerExists=(code:string)=>!!db.prepare('SELECT 1 FROM borrower_refs WHERE code=? AND lab_id=?').get(code,'riverton');
const vendorExists=(id:string)=>!!db.prepare('SELECT 1 FROM vendor_refs WHERE id=? AND lab_id=?').get(id,'riverton');
const logCondition=(id:string,condition:string,note:string,actor:string,loanId:number|null=null)=>db.prepare('INSERT INTO condition_events(asset_id,loan_id,condition,notes,actor,recorded_at) VALUES (?,?,?,?,?,?)').run(id,loanId,condition,note,actor,isoNow());
const openQuarantine=(id:string,reason:string,actor:string)=>{if(!db.prepare('SELECT id FROM quarantines WHERE asset_id=? AND closed_at IS NULL').get(id))db.prepare('INSERT INTO quarantines(asset_id,reason,opened_at,opened_by) VALUES (?,?,?,?)').run(id,reason,isoNow(),actor)};
const roleAllowed=(r:string,roles:string[])=>{if(!roles.includes(r))fail(403,'Your demo role cannot perform this action')};
function requestBoundary(req:IncomingMessage){
 // Reject DNS rebinding and misconfigured reverse proxies even when bound to
 // loopback. The Host/Origin checks are safeguards, not production auth.
 const host=req.headers.host;
 if(typeof host!=='string')fail(403,'Untrusted request host');
 let authority:URL;
 try{authority=new URL('http://'+host)}catch{fail(403,'Untrusted request host')}
 if(!LOOPBACK_HOSTS.has(authority.hostname)||authority.port!==String(PORT)||authority.pathname!=='/'||authority.username||authority.password)fail(403,'Untrusted request host');
 const origin=req.headers.origin;
 if(typeof origin==='string'&&origin!==authority.origin)fail(403,'Cross-origin requests are not permitted');
 if(req.headers['sec-fetch-site']==='cross-site')fail(403,'Cross-site requests are not permitted');
 if(req.method==='POST'&&req.headers['content-type']?.split(';')[0]?.trim().toLowerCase()!=='application/json')fail(415,'Expected application/json');
}
const APP_CSP="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
function setSecurityHeaders(res:ServerResponse){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 res.setHeader('Cross-Origin-Resource-Policy','same-origin');
 res.setHeader('Content-Security-Policy',APP_CSP);
 res.setHeader('Cache-Control','no-store');
}
function session(req:IncomingMessage){const cookie=(req.headers.cookie||'').match(/(?:^|;\s*)rv_session=([^;]+)/)?.[1];const value=cookie?sessions.get(cookie):undefined;if(value&&value.expires>Date.now())return value;return null}
function json(res:ServerResponse,data:unknown,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
function html(res:ServerResponse,body:string){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body)}
function csvResponse(res:ServerResponse,text:string,file:string){res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${file}"`,'Cache-Control':'no-store'});res.end(text)}
function readBody(req:IncomingMessage):Promise<any>{return new Promise((resolve,reject)=>{
 const chunks:Buffer[]=[];let bytes=0,oversized=false;
 req.on('data',(chunk:Buffer)=>{if(oversized)return;bytes+=chunk.byteLength;
   if(bytes>300_000){oversized=true;chunks.length=0;reject(new AppError(413,'Request too large'));return}
   chunks.push(chunk);
 });
 req.on('end',()=>{if(oversized)return;try{const data=Buffer.concat(chunks).toString('utf8');resolve(data?JSON.parse(data):{})}catch{reject(new AppError(400,'Malformed JSON'))}});
 req.on('error',reject);
})}
function parsePath(req:IncomingMessage){return new URL(req.url||'/',`http://${HOST}:${PORT}`)}
function asPositiveInt(v:unknown,max=100000){const n=Number(v);if(!Number.isSafeInteger(n)||n<=0||n>max)fail(400,`Expected positive integer up to ${max}`);return n}
const requiredText=(v:unknown,max=500)=>{const s=safeText(v,max);if(!s)fail(400,'Required text is missing');return s};
function assetRows(){return db.prepare(`SELECT a.*,l.name home_location,c.name current_location,p.interval_days,p.next_due_date,p.version plan_version,(SELECT group_concat(v.name, ', ') FROM asset_vendor_refs av JOIN vendor_refs v ON v.id=av.vendor_id WHERE av.asset_id=a.id) vendor_names,(SELECT group_concat(av.vendor_id, ',') FROM asset_vendor_refs av WHERE av.asset_id=a.id) vendor_ids,(SELECT borrower_code FROM loans WHERE asset_id=a.id AND returned_at IS NULL) borrower_code,(SELECT due_at FROM loans WHERE asset_id=a.id AND returned_at IS NULL) loan_due_at FROM assets a LEFT JOIN locations l ON a.home_location_id=l.id LEFT JOIN locations c ON a.current_location_id=c.id LEFT JOIN maintenance_plan_versions p ON a.current_plan_id=p.id WHERE a.lab_id='riverton' ORDER BY a.tag`).all() as any[]}
function today(){const assets=assetRows(),today=datePlus(0),now=isoNow();const loans=db.prepare(`SELECT x.*,a.tag,a.make_model,b.label borrower_label FROM loans x JOIN assets a ON x.asset_id=a.id JOIN borrower_refs b ON x.borrower_code=b.code WHERE x.returned_at IS NULL ORDER BY x.due_at`).all() as any[];
  const overdue=loans.filter(l=>l.due_at<now),maintenance=assets.filter(a=>a.next_due_date&&a.next_due_date<=today);
  return {date:today,assets:assets.length,onLoan:loans.length,overdueCount:overdue.length,missingCount:assets.filter(a=>a.status==='missing').length,quarantinedCount:assets.filter(a=>['quarantined','inspection_required'].includes(a.status)).length,maintenanceDueCount:maintenance.length,availableCount:assets.filter(a=>a.status==='available').length,overdue,maintenance,blocked:assets.filter(a=>BLOCKED.includes(a.status as any)),recent:db.prepare(`SELECT * FROM audit_events WHERE lab_id='riverton' ORDER BY id DESC LIMIT 8`).all()};}
function validateImport(row:any,index:number,batchId:string){const errors:string[]=[];const tag=String(row.tag??'').trim().toUpperCase(),category=String(row.category??'').trim(),make_model=String(row.make_model??'').trim();const home=String(row.home_location_id??'').trim();
 if(!/^AST-[A-Z0-9-]{2,20}$/.test(tag))errors.push('Tag must be AST- followed by an identifier');
 if(!CATEGORIES.includes(category as any))errors.push('Unknown category');if(!make_model||make_model.length>120)errors.push('Model is required (max 120 characters)');
 if(!locationExists(home))errors.push('Valid home_location_id required');
 if(tag&&db.prepare('SELECT id FROM assets WHERE tag=?').get(tag))errors.push('Asset tag already exists');
 if(tag&&db.prepare('SELECT 1 FROM asset_tags WHERE identifier=?').get(tag))errors.push('Tag identifier already exists');
 const serial=String(row.serial_ref??'').trim();if(serial.length>100)errors.push('Serial reference too long');
 const warnings:string[]=[];if(serial&&db.prepare('SELECT 1 FROM assets WHERE serial_ref=?').get(serial))warnings.push('Serial reference appears on another asset; verify identity');
 return {batch_id:batchId,row_number:index+2,source_values:row,values:{tag,category,make_model,serial_ref:serial,home_location_id:home},errors,warnings};
}
function createAsset(input:any,actor:string,fromImport?:{batch:string;row:number;source?:unknown}) {
 const tag=requiredText(input.tag,32).toUpperCase(), category=requiredText(input.category,40),model=requiredText(input.make_model,120),serial=String(input.serial_ref||'').trim();
 if(!/^AST-[A-Z0-9-]{2,20}$/.test(tag))fail(400,'Tag must begin AST- and contain 2–20 identifier characters');
 if(!CATEGORIES.includes(category as any))fail(400,'Unknown category');if(serial.length>100)fail(400,'Serial reference too long');
 const home=requiredText(input.home_location_id,30);if(!locationExists(home))fail(400,'Unknown home location');
 const current=input.current_location_id||home;if(!locationExists(current))fail(400,'Unknown current location');
 const condition=input.condition||'unknown';if(!CONDITIONS.includes(condition))fail(400,'Invalid condition');
 const vendor=input.vendor_id||null;if(vendor&&!vendorExists(vendor))fail(400,'Unknown vendor reference');
 if(db.prepare('SELECT 1 FROM assets WHERE tag=?').get(tag))fail(409,'Asset tag already exists');
 const interval=asPositiveInt(input.interval_days||180,3650),id=tag;
 db.prepare('INSERT INTO assets(id,lab_id,tag,category,make_model,serial_ref,home_location_id,current_location_id,condition,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,'riverton',tag,category,model,serial||null,home,current,condition,condition==='damaged'?'inspection_required':'available',isoNow());
 db.prepare('INSERT INTO asset_tags(asset_id,identifier,created_at) VALUES (?,?,?)').run(id,tag,isoNow());
 if(vendor)db.prepare('INSERT INTO asset_vendor_refs(asset_id,vendor_id) VALUES (?,?)').run(id,vendor);
 if(condition==='damaged')openQuarantine(id,'Asset entered with reported damage',actor);
 logCondition(id,condition,'Initial condition observation',actor);
 const base=datePlus(0),due=dateAfter(base,interval);const p=db.prepare('INSERT INTO maintenance_plan_versions(asset_id,version,interval_days,effective_at,base_date,next_due_date) VALUES (?,?,?,?,?,?)').run(id,1,interval,isoNow(),base,due);
 db.prepare('UPDATE assets SET current_plan_id=? WHERE id=?').run(p.lastInsertRowid,id);
 if(fromImport)db.prepare('INSERT INTO import_rows(batch_id,row_number,asset_id,original_json,normalized_json) VALUES (?,?,?,?,?)').run(fromImport.batch,fromImport.row,id,JSON.stringify(fromImport.source??{}),JSON.stringify({tag,category,make_model:model,serial_ref:serial,home_location_id:home}));
 audit(db,'asset',id,'created',actor,{tag,fromImport});return fetchAsset(id);
}
function editAsset(id:string,b:any,actor:string){return transaction(db,()=>{
 const a=needAsset(id);if(a.status!=='available')fail(409,'Only available assets can have metadata changed; resolve existing loan or block first');
 const category=requiredText(b.category,40),model=requiredText(b.make_model,120),serial=safeText(b.serial_ref||'',100),home=requiredText(b.home_location_id,30),current=requiredText(b.current_location_id,30);
 if(!CATEGORIES.includes(category as any))fail(400,'Unknown category');if(!locationExists(home)||!locationExists(current))fail(400,'Unknown location');
 const condition=requiredText(b.condition,20);if(!CONDITIONS.includes(condition as any))fail(400,'Unknown condition');
 const note=requiredText(b.note,500),vendor=b.vendor_id||null;if(vendor&&!vendorExists(vendor))fail(400,'Unknown vendor reference');
 db.prepare('UPDATE assets SET category=?,make_model=?,serial_ref=?,home_location_id=?,current_location_id=?,condition=?,status=? WHERE id=?').run(category,model,serial||null,home,current,condition,condition==='damaged'?'inspection_required':'available',id);
 db.prepare('DELETE FROM asset_vendor_refs WHERE asset_id=?').run(id);if(vendor)db.prepare('INSERT INTO asset_vendor_refs(asset_id,vendor_id) VALUES (?,?)').run(id,vendor);
 if(condition==='damaged')openQuarantine(id,note,actor);
 logCondition(id,condition,note,actor);audit(db,'asset',id,'metadata_revised',actor,{note,old:{home:a.home_location_id,current:a.current_location_id,condition:a.condition,serial:a.serial_ref},new:{home,current,condition,serial,vendor}});
 return fetchAsset(id);
})}
function checkout(id:string,b:any,actor:string){return transaction(db,()=>{
 const a=needAsset(id);if(a.status!=='available')fail(409,`Cannot issue asset: status is ${a.status}`);
 const borrower=requiredText(b.borrower_code,25);if(!borrowerExists(borrower))fail(400,'Unknown borrower code');
 if(!isIso(b.due_at)||Date.parse(b.due_at)<=Date.now())fail(400,'Due time must be an exact future ISO instant');
 const cond=b.condition||a.condition;if(!CONDITIONS.includes(cond))fail(400,'Invalid condition');
 const now=isoNow();const loan=db.prepare('INSERT INTO loans(asset_id,borrower_code,issued_at,due_at,checkout_condition,issued_by) VALUES (?,?,?,?,?,?)').run(id,borrower,now,b.due_at,cond,actor);
 db.prepare(`UPDATE assets SET status='on_loan',current_location_id=NULL WHERE id=?`).run(id);
 logCondition(id,cond,'Observed at checkout',actor,Number(loan.lastInsertRowid));audit(db,'loan',String(loan.lastInsertRowid),'checkout',actor,{asset_id:id,borrower_code:borrower,due_at:b.due_at});return fetchAsset(id);
})}
function returnLoan(id:string,b:any,actor:string){return transaction(db,()=>{
 const a=needAsset(id);const loan=db.prepare('SELECT * FROM loans WHERE asset_id=? AND returned_at IS NULL').get(id) as any;if(!loan)fail(409,'This asset has no active loan');
 const condition=requiredText(b.condition,20);if(!CONDITIONS.includes(condition as any))fail(400,'Invalid condition');
 const destination=requiredText(b.location_id,25);if(!locationExists(destination))fail(400,'Unknown return location');const note=safeText(b.note||'',500);
 const blocked=condition==='damaged'||a.status==='inspection_required'||a.status==='quarantined';
 db.prepare('UPDATE loans SET returned_at=?,return_condition=?,return_location_id=?,returned_by=? WHERE id=?').run(isoNow(),condition,destination,actor,loan.id);
 db.prepare('UPDATE assets SET status=?,condition=?,current_location_id=? WHERE id=?').run(blocked?'inspection_required':'available',condition,destination,id);
 logCondition(id,condition,note||'Return observation',actor,loan.id);if(blocked)openQuarantine(id,note||'Defect reported on return; instructor inspection required',actor);
 audit(db,'loan',String(loan.id),'return',actor,{asset_id:id,condition,destination,blocked});return fetchAsset(id);
})}
function flag(id:string,b:any,actor:string){return transaction(db,()=>{
 const a=needAsset(id);const status=requiredText(b.status,30),note=requiredText(b.note,500);
 if(!['missing','quarantined','inspection_required','in_service'].includes(status))fail(400,'Unknown blocked status');
 if(a.status==='on_loan')fail(409,'Return or reconcile an active loan before changing asset status');
 if(a.status==='quarantined'||a.status==='inspection_required')fail(409,'Release the current quarantine before replacing it');
 db.prepare('UPDATE assets SET status=?,condition=?,current_location_id=? WHERE id=?').run(status,status==='inspection_required'?'damaged':a.condition,status==='missing'?null:a.current_location_id,id);
 if(status==='quarantined'||status==='inspection_required')openQuarantine(id,note,actor);
 audit(db,'asset',id,'flagged',actor,{status,note});return fetchAsset(id);
})}
function release(id:string,b:any,actor:string){return transaction(db,()=>{
 const a=needAsset(id),note=requiredText(b.note,500);if(!['inspection_required','quarantined','in_service','missing'].includes(a.status))fail(409,'Asset is not blocked');
 if(!a.current_location_id){const location=requiredText(b.location_id,30);if(!locationExists(location))fail(400,'Releasing a missing asset requires a confirmed location');db.prepare('UPDATE assets SET current_location_id=? WHERE id=?').run(location,id)}
 const condition=requiredText(b.condition||a.condition,20);if(!['good','worn','unknown'].includes(condition))fail(400,'Instructor must record a non-damaged condition observation');
 db.prepare('UPDATE assets SET status=?,condition=? WHERE id=?').run('available',condition,id);
 db.prepare('UPDATE quarantines SET closed_at=?,closed_by=?,release_note=? WHERE asset_id=? AND closed_at IS NULL').run(isoNow(),actor,note,id);
 db.prepare('INSERT INTO approvals(lab_id,asset_id,action,note,actor,created_at) VALUES (?,?,?,?,?,?)').run('riverton',id,'instructor_release',note,actor,isoNow());
 logCondition(id,condition,note,actor);audit(db,'asset',id,'instructor_release',actor,{note,condition,prior_status:a.status,disclaimer:'Recorded operational decision; not a safety certification'});return fetchAsset(id);
})}
function service(id:string,b:any,actor:string){return transaction(db,()=>{
 const a=needAsset(id);if(a.status==='on_loan')fail(409,'Return asset before recording service');const serviced=requiredText(b.serviced_date,20);if(!validateDate(serviced))fail(400,'Service date must be YYYY-MM-DD');if(serviced>datePlus(0))fail(400,'Service date cannot be in the future');
 const note=requiredText(b.note,500),ref=safeText(b.reference||'',200);
 const next=dateAfter(serviced,Number(a.interval_days));db.prepare('INSERT INTO service_events(asset_id,plan_version_id,serviced_date,next_due_date,notes,reference,actor,recorded_at) VALUES (?,?,?,?,?,?,?,?)').run(id,a.current_plan_id,serviced,next,note,ref||null,actor,isoNow());
 db.prepare('UPDATE maintenance_plan_versions SET base_date=?,next_due_date=? WHERE id=?').run(serviced,next,a.current_plan_id);
 audit(db,'asset',id,'service_recorded',actor,{serviced_date:serviced,next_due_date:next,plan_version:a.plan_version,disclaimer:'Not a safety certification'});return fetchAsset(id);
})}
function maintenancePolicy(id:string,b:any,actor:string){return transaction(db,()=>{
 const a=needAsset(id),interval=asPositiveInt(b.interval_days,3650),version=Number(a.plan_version)+1;
 const base=String(a.next_due_date?db.prepare('SELECT base_date FROM maintenance_plan_versions WHERE id=?').get(a.current_plan_id).base_date:datePlus(0));
 const due=dateAfter(base,interval);const p=db.prepare('INSERT INTO maintenance_plan_versions(asset_id,version,interval_days,effective_at,base_date,next_due_date) VALUES (?,?,?,?,?,?)').run(id,version,interval,isoNow(),base,due);
 db.prepare('UPDATE assets SET current_plan_id=? WHERE id=?').run(p.lastInsertRowid,id);audit(db,'asset',id,'maintenance_policy_revised',actor,{version,interval_days:interval,base_date:base,next_due_date:due});return fetchAsset(id);
})}
function purchaseDraft(b:any,actor:string){return transaction(db,()=>{
 const item=requiredText(b.item_name,120),qty=asPositiveInt(b.quantity,10000),reason=requiredText(b.reason,500);const vendor=b.vendor_id||null,asset=b.asset_id||null;
 if(vendor&&!vendorExists(vendor))fail(400,'Unknown vendor reference');if(asset)needAsset(asset);
 let cents=null;if(b.estimated_unit_price!==undefined&&b.estimated_unit_price!==null&&b.estimated_unit_price!==''){const price=Number(b.estimated_unit_price);if(!Number.isFinite(price)||price<0||price>1e7)fail(400,'Invalid estimated price');cents=Math.round(price*100)}
 const result=db.prepare('INSERT INTO purchase_requests(lab_id,asset_id,item_name,quantity,reason,vendor_id,estimated_unit_price_cents,approval_status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('riverton',asset,item,qty,reason,vendor,cents,'draft',actor,isoNow());
 audit(db,'purchase_request',String(result.lastInsertRowid),'draft_created',actor,{item_name:item,quantity:qty});return db.prepare('SELECT * FROM purchase_requests WHERE id=?').get(result.lastInsertRowid);
})}
const esc=(s:any)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
function labels(ids:string[],req:IncomingMessage,res:ServerResponse){if(!ids.length||ids.length>24)fail(400,'Select 1–24 assets per print sheet');const assets=ids.map(needAsset);const base=(process.env.PUBLIC_BASE_URL||('http://'+HOST+':'+PORT)).replace(/\/$/,'');const baseUrl=new URL(base);if(!['http:','https:'].includes(baseUrl.protocol)||baseUrl.username||baseUrl.password)fail(500,'Invalid label URL configuration');
 const urls=assets.map(a=>base+'/?asset='+encodeURIComponent(a.id));
 const python=join(ROOT,'src','make_qr.py');const svgs=JSON.parse(execFileSync('python',[python],{input:JSON.stringify(urls),encoding:'utf8',maxBuffer:4_000_000,timeout:10000}));
 res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'");
 html(res,`<!doctype html><html><head><meta charset="utf-8"><title>Asset labels · Riverton demo</title><style>body{font-family:system-ui;margin:24px;color:#182b31}.sheet{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.label{border:1px dashed #8c9a9c;padding:14px;min-height:175px;display:flex;gap:10px;align-items:center;break-inside:avoid}.label svg{width:105px;height:105px}.meta{font-size:12px}.meta strong{display:block;font-size:16px;margin-bottom:6px}.print{padding:10px 18px;background:#153e42;color:white;border:0;border-radius:6px;margin-bottom:20px}@media print{.print,.note{display:none}.label{border:1px solid #aaa}body{margin:0}}</style></head><body><p class="note">Use your browser Print command (Ctrl/⌘ + P). QR encodes a non-sensitive asset URL. Authentication is still required to see asset records.</p><div class="sheet">${assets.map((a,i)=>`<div class="label">${svgs[i]}<div class="meta"><strong>${esc(a.tag)}</strong>${esc(a.category)}<p>${esc(a.make_model)}</p><small>Riverton demo lab</small></div></div>`).join('')}</div></body></html>`);
}
function serveFile(path:string,res:ServerResponse){const map:{[k:string]:string}={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/client.js':'client.js'};const target=map[path];if(!target)fail(404,'Page not found');const filepath=join(ROOT,'web',target);if(!existsSync(filepath))fail(404,'Static asset unavailable');res.writeHead(200,{'Content-Type':extname(target)==='.css'?'text/css; charset=utf-8':extname(target)==='.js'?'application/javascript; charset=utf-8':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(readFileSync(filepath));}
export async function handle(req:IncomingMessage,res:ServerResponse){try{
 setSecurityHeaders(res);requestBoundary(req);
 const url=parsePath(req),path=url.pathname,method=req.method||'GET';
 if(!path.startsWith('/api/')){if(method!=='GET')fail(405,'Method not allowed');return serveFile(path,res)}
 if(method==='POST'&&path==='/api/demo/login'){
   const b=await readBody(req),role=b.role;if(!['instructor','staff','viewer'].includes(role))fail(400,'Unknown demo role');const actor=role==='instructor'?'DEMO-INSTRUCTOR':role==='staff'?'DEMO-STAFF':'DEMO-VIEWER';const token=randomUUID();sessions.set(token,{actor,role,expires:Date.now()+86400_000});res.setHeader('Set-Cookie',`rv_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);return json(res,{actor,role,demo:true});
 }
 const user=session(req);if(method==='GET'&&path==='/api/session')return json(res,{authenticated:!!user,actor:user?.actor||null,role:user?.role||null,demo:true});
 if(!user)fail(401,'Sign in to the demo to view lab records');
 if(method==='POST'&&path==='/api/demo/logout'){const cookie=(req.headers.cookie||'').match(/rv_session=([^;]+)/)?.[1];if(cookie)sessions.delete(cookie);res.setHeader('Set-Cookie','rv_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return json(res,{ok:true})}
 if(method==='POST'&&path==='/api/demo/reset'){roleAllowed(user.role,['instructor']);seed(db);return json(res,{ok:true,dashboard:today()})}
 if(method==='GET'&&path==='/api/dashboard')return json(res,today());
 if(method==='GET'&&path==='/api/locations')return json(res,db.prepare("SELECT * FROM locations WHERE lab_id='riverton' ORDER BY id").all());
 if(method==='GET'&&path==='/api/borrowers')return json(res,db.prepare("SELECT * FROM borrower_refs WHERE lab_id='riverton' ORDER BY code").all());
 if(method==='GET'&&path==='/api/vendors')return json(res,db.prepare("SELECT * FROM vendor_refs WHERE lab_id='riverton' ORDER BY id").all());
 if(method==='GET'&&path==='/api/assets'){let records=assetRows();const q=(url.searchParams.get('q')||'').toLowerCase(),status=url.searchParams.get('status'),cat=url.searchParams.get('category');if(q)records=records.filter(a=>[a.tag,a.category,a.make_model,a.serial_ref,a.current_location].some(v=>String(v||'').toLowerCase().includes(q)));if(status)records=records.filter(a=>a.status===status);if(cat)records=records.filter(a=>a.category===cat);return json(res,records)}
 if(method==='GET'&&path==='/api/loans')return json(res,db.prepare(`SELECT x.*,a.tag,a.make_model,b.label borrower_label FROM loans x JOIN assets a ON x.asset_id=a.id JOIN borrower_refs b ON x.borrower_code=b.code ORDER BY x.issued_at DESC,x.id DESC LIMIT 200`).all());
 if(method==='GET'&&path==='/api/maintenance')return json(res,db.prepare(`SELECT s.*,a.tag,a.make_model,p.version plan_version FROM service_events s JOIN assets a ON s.asset_id=a.id JOIN maintenance_plan_versions p ON s.plan_version_id=p.id ORDER BY s.id DESC`).all());
 if(method==='GET'&&path==='/api/requests')return json(res,db.prepare(`SELECT p.*,v.name vendor_name FROM purchase_requests p LEFT JOIN vendor_refs v ON p.vendor_id=v.id WHERE p.lab_id='riverton' ORDER BY p.id DESC`).all());
 if(method==='GET'&&path==='/api/audit')return json(res,db.prepare(`SELECT * FROM audit_events WHERE lab_id='riverton' ORDER BY id DESC LIMIT 200`).all());
 if(method==='GET'&&path==='/api/labels')return labels((url.searchParams.get('ids')||'').split(',').filter(Boolean),req,res);
 if(method==='GET'&&path.startsWith('/api/export/')){
   const what=path.slice('/api/export/'.length);if(what==='assets'){const keys=['tag','category','make_model','serial_ref','home_location','current_location','condition','status','next_due_date'];return csvResponse(res,csv(assetRows(),keys),`riverton-assets-${datePlus(0)}.csv`)}
   if(what==='requests'){const keys=['id','item_name','quantity','reason','vendor_id','estimated_unit_price_cents','approval_status','created_at'];const rows=db.prepare("SELECT * FROM purchase_requests WHERE lab_id='riverton'").all() as any[];return csvResponse(res,csv(rows,keys),`riverton-purchase-drafts-${datePlus(0)}.csv`)}
   fail(404,'Unknown export');
 }
 const assetMatch=path.match(/^\/api\/assets\/(AST-[A-Z0-9-]{2,20})(?:\/(checkout|return|flag|release|service|policy|edit))?$/);
 if(assetMatch){const [,id,action]=assetMatch;
   if(method==='GET'&&!action){const asset=needAsset(id);return json(res,{...asset,loans:db.prepare('SELECT * FROM loans WHERE asset_id=? ORDER BY id DESC').all(id),condition_events:db.prepare('SELECT * FROM condition_events WHERE asset_id=? ORDER BY id DESC').all(id),service_events:db.prepare('SELECT s.*,p.version plan_version FROM service_events s JOIN maintenance_plan_versions p ON s.plan_version_id=p.id WHERE s.asset_id=? ORDER BY s.id DESC').all(id),plan_versions:db.prepare('SELECT * FROM maintenance_plan_versions WHERE asset_id=? ORDER BY version DESC').all(id),quarantines:db.prepare('SELECT * FROM quarantines WHERE asset_id=? ORDER BY id DESC').all(id)});}
   if(method==='POST'){const b=await readBody(req);if(action==='edit'){roleAllowed(user.role,['instructor','staff']);return json(res,editAsset(id,b,user.actor));}if(action==='checkout'){roleAllowed(user.role,['instructor','staff']);return json(res,checkout(id,b,user.actor));}if(action==='return'){roleAllowed(user.role,['instructor','staff']);return json(res,returnLoan(id,b,user.actor));}if(action==='flag'){roleAllowed(user.role,['instructor','staff']);return json(res,flag(id,b,user.actor));}if(action==='release'){roleAllowed(user.role,['instructor']);return json(res,release(id,b,user.actor));}if(action==='service'){roleAllowed(user.role,['instructor']);return json(res,service(id,b,user.actor));}if(action==='policy'){roleAllowed(user.role,['instructor']);return json(res,maintenancePolicy(id,b,user.actor));}}
 }
 if(method==='POST'&&path==='/api/assets'){roleAllowed(user.role,['instructor','staff']);const b=await readBody(req);return json(res,transaction(db,()=>createAsset(b,user.actor)),201)}
 if(method==='POST'&&path==='/api/requests'){roleAllowed(user.role,['instructor']);return json(res,purchaseDraft(await readBody(req),user.actor),201)}
 if(method==='POST'&&path==='/api/import/preview'){roleAllowed(user.role,['instructor','staff']);const b=await readBody(req);const text=requiredText(b.csv,200000);const rows=parseCsv(text);if(rows.length>300)fail(413,'Import limited to 300 rows');const id=randomUUID();transaction(db,()=>db.prepare('INSERT INTO import_batches(id,lab_id,created_by,created_at,raw_csv) VALUES (?,?,?,?,?)').run(id,'riverton',user.actor,isoNow(),text));return json(res,{batch_id:id,rows:rows.map((r,i)=>validateImport(r,i,id))})}
 if(method==='POST'&&path==='/api/import/commit'){roleAllowed(user.role,['instructor','staff']);const b=await readBody(req),batch=requiredText(b.batch_id,100);const originalBatch=db.prepare('SELECT raw_csv FROM import_batches WHERE id=? AND lab_id=?').get(batch,'riverton') as any;if(!originalBatch)fail(404,'Import batch not found');const originalRows=parseCsv(originalBatch.raw_csv,true);if(!Array.isArray(b.rows)||b.rows.length>300)fail(400,'Provide up to 300 rows');
   const committed:any[]=[],invalid:any[]=[];for(const row of b.rows){const rowNo=asPositiveInt(row.row_number,10000);if(rowNo<2||rowNo>originalRows.length+1)fail(400,'Row number is outside the previewed import batch');const existing=db.prepare('SELECT asset_id FROM import_rows WHERE batch_id=? AND row_number=?').get(batch,rowNo) as any;if(existing){committed.push({row_number:rowNo,asset_id:existing.asset_id,already_accepted:true});continue;}
     const checked=validateImport(row.values||{},rowNo-2,batch);if(checked.errors.length){invalid.push(checked);continue;}
     try{const asset=transaction(db,()=>createAsset({...checked.values,interval_days:180},user.actor,{batch,row:rowNo,source:originalRows[rowNo-2]}));committed.push({row_number:rowNo,asset_id:asset.id,already_accepted:false})}catch(e:any){invalid.push({...checked,errors:[e.message]})}
   }return json(res,{committed,invalid});
 }
 fail(404,'API route not found');
 }catch(err:any){const status=err instanceof AppError?err.status:((err?.code==='SQLITE_CONSTRAINT_UNIQUE'||err?.message||'').includes('UNIQUE constraint')?409:500);if(status===500)console.error('[server error]',err);json(res,{error:status===500?'Unexpected server error':err.message},status)}
}
export function startServer(port=PORT,host=HOST){const server=createServer(handle);server.listen(port,host,()=>console.log(`Riverton CTE Lab Tracker on http://${host}:${(server.address() as any).port}`));return server}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])startServer();
