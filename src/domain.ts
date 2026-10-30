/** Domain constants and deterministic calendar-date logic. */
export const CATEGORIES = ['Power Tools', 'Hand Tools', 'Measuring', 'Safety', 'Stationary', 'Accessories'] as const;
export const CONDITIONS = ['good','worn','damaged','unknown'] as const;
export const BLOCKED = ['missing','quarantined','inspection_required','in_service'] as const;
export const STATUSES = ['available','on_loan',...BLOCKED] as const;
export type AssetStatus = (typeof STATUSES)[number];
export type Condition = (typeof CONDITIONS)[number];
export const isoNow = () => new Date().toISOString();
export function datePlus(days:number, d=new Date()) {const date=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}
export function dateAfter(base:string, days:number) {if(!/^\d{4}-\d{2}-\d{2}$/.test(base))throw new Error('Expected YYYY-MM-DD date');const d=new Date(base+'T00:00:00.000Z');if(Number.isNaN(d.valueOf()))throw new Error('Invalid date');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
export function dateOnly(d:string) {return d.slice(0,10)}
export const isIso = (s:unknown) => typeof s==='string' && /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s));
export const validateDate = (s:unknown) => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T00:00:00Z'));
export function csvEscape(value:unknown) {let v=String(value??'');if(/^[\s]*[=+@-]/.test(v))v="'"+v;return /[",\n\r]/.test(v)?'"'+v.replaceAll('"','""')+'"':v;}
export function csv(rows:Record<string,unknown>[], keys:string[]) {return [keys.join(','),...rows.map(r=>keys.map(k=>csvEscape(r[k])).join(','))].join('\r\n')+'\r\n';}
/** RFC4180-compatible small-input CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text:string,preserveValues=false) {
  const rows:string[][]=[];let row:string[]=[];let field='';let quote=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quote=false;else field+=c;}else if(c==='"'){if(field!=='')throw new Error('Unexpected quote in CSV field');quote=true;}else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);field='';row=[];}else field+=c;}
  if(quote)throw new Error('Unterminated quoted CSV field');if(field!==''||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  if(rows.length===0)return [];
  const [hdr,...data]=rows; const heads=hdr.map((h,i)=>(i===0?h.replace(/^\uFEFF/,''):h).trim());
  if(heads.some(h=>!h)||new Set(heads).size!==heads.length)throw new Error('Invalid or duplicate CSV header');
  return data.filter(r=>r.some(v=>v.trim()!=='')).map((r,i)=>{if(r.length!==heads.length)throw new Error('CSV row '+(i+2)+' has incorrect column count');return Object.fromEntries(heads.map((h,j)=>[h,preserveValues?r[j]:r[j].trim()]));});
}
export function safeText(s:unknown,max=500) {if(typeof s!=='string')throw new Error('Expected text');const v=s.trim();if(v.length>max)throw new Error('Text exceeds '+max+' characters');return v;}
