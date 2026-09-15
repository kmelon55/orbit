// Run after pnpm build. Uses only an isolated temporary vault and no mail accounts.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const directory=await mkdtemp(join(tmpdir(),'orbit-mail-runtime-'));
await mkdir(join(directory,'inbox'));await writeFile(join(directory,'inbox','runtime.md'),'---\nid: runtime-sqlite\ntitle: Orbit runtime SQLite fixture\n---\nMigration body\n');
const username='mail-smoke';const password=randomBytes(24).toString('hex');
const child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',ORBIT_VAULT_DIR:directory,ORBIT_MAIL_DIR:join(directory,'.orbit/mail'),ORBIT_AUTH_USERNAME:username,ORBIT_AUTH_PASSWORD:password,ORBIT_PUBLIC_URL:'https://orbit.example.com',ORBIT_GMAIL_CLIENT_ID:'',ORBIT_GMAIL_CLIENT_SECRET:''},stdio:['ignore','pipe','pipe']});
let logs='';let stderr='';child.stderr.on('data',d=>{stderr+=d;});
try {
 const base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Runtime startup timeout: '+stderr)),20000);child.stdout.on('data',d=>{logs+=d;const match=logs.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timeout);resolve(match[0]);}});child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Runtime exited '+code+' '+stderr));});});
 const unauth=await fetch(base+'/api/mail/status');if(unauth.status!==401){console.log(await unauth.text());console.log(stderr);}assert.equal(unauth.status,401);
 const payload=Buffer.from(JSON.stringify({sub:username,exp:Date.now()+60000,nonce:'smoke'})).toString('base64url');const key=createHash('sha256').update(`orbit-session\0${username}\0${password}`).digest();const signature=createHmac('sha256',key).update(payload).digest('base64url');const cookie=`orbit_session=${payload}.${signature}`;
 const status=await fetch(base+'/api/mail/status',{headers:{cookie}});assert.equal(status.status,200);assert.equal(status.headers.get('cache-control'),'no-store');const data=await status.json();assert.deepEqual(data.accounts,[]);assert.equal(data.notificationPreview,true);
 const mail=await fetch(base+'/mail',{headers:{cookie}});assert.equal(mail.status,200);assert.match(await mail.text(),/Mail|메일/);
 const inbox=await fetch(base+'/inbox',{headers:{cookie}});assert.equal(inbox.status,200);assert.match(await inbox.text(),/Orbit runtime SQLite fixture/);
 const cross=await fetch(base+'/api/mail/settings',{method:'POST',headers:{cookie,origin:'https://evil.example','content-type':'application/json'},body:'{}'});assert.equal(cross.status,400);
 console.log('Production runtime: unauthenticated 401, authenticated Mail/API 200, no-store, cross-origin write rejected. SQLite-migrated fixture renders in Inbox. Temporary vault only.');
}finally{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},3000).unref();});await rm(directory,{recursive:true,force:true});}
