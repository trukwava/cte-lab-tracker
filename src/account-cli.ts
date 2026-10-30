// Generate a one-time credential locally; never pass passwords on the command line.
import { openDatabase, isSeeded, seed } from './db.ts';
import { generateCredential, provision, disableAccount, type Role } from './auth.ts';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const [action,username,role]=process.argv.slice(2);
if(!['create','rotate','disable'].includes(action||'')||!username||(action!=='disable'&&!['instructor','staff','viewer'].includes(role||''))){
 console.error('Usage: node --experimental-strip-types src/account-cli.ts create|rotate USERNAME instructor|staff|viewer');
 console.error('       node --experimental-strip-types src/account-cli.ts disable USERNAME');
 process.exit(2);
}
if(process.env.AUTH_MODE!=='pilot'){console.error('Set AUTH_MODE=pilot to manage local pilot accounts');process.exit(2)}
const db=openDatabase(process.env.DB_FILE||join(root,'data','riverton-pilot.sqlite'));
try{
 if(!isSeeded(db))seed(db);
 if(action==='disable'){console.log(JSON.stringify(disableAccount(db,username)))}
 else{
  const password=generateCredential();const result=provision(db,username,role as Role,password);
  console.log(JSON.stringify({...result,temporary_password:password}));
  console.error('Credential displayed once. Store it in a password manager; rotating revokes all sessions.');
 }
}finally{db.close()}
