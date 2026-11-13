// FOREV EXT — сервер без зависимостей. Нужен Node.js 22.5+  (запуск: node server.js)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const nodemailer=require('nodemailer');
const DBP=process.env.DB_PATH||path.join(__dirname,'forev.db');
fs.mkdirSync(path.dirname(DBP),{recursive:true});
const db=new DatabaseSync(DBP);
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE,email TEXT UNIQUE COLLATE NOCASE,hash TEXT,salt TEXT,created INTEGER,sub_until INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER);
CREATE TABLE IF NOT EXISTS keys(code TEXT PRIMARY KEY,days INTEGER,used_by INTEGER);
CREATE TABLE IF NOT EXISTS devices(id INTEGER PRIMARY KEY,user_id INTEGER,hwid TEXT,name TEXT,first_seen INTEGER,last_seen INTEGER,UNIQUE(user_id,hwid));
CREATE TABLE IF NOT EXISTS gifts(id INTEGER PRIMARY KEY,from_id INTEGER,to_id INTEGER,days INTEGER,ts INTEGER);
CREATE TABLE IF NOT EXISTS logins(id INTEGER PRIMARY KEY,user_id INTEGER,ip TEXT,kind TEXT,ok INTEGER,ts INTEGER);
CREATE TABLE IF NOT EXISTS promos(code TEXT PRIMARY KEY,days INTEGER,max_uses INTEGER,uses INTEGER DEFAULT 0,expires INTEGER DEFAULT 0,created INTEGER);
CREATE TABLE IF NOT EXISTS promo_uses(code TEXT,user_id INTEGER,PRIMARY KEY(code,user_id));
CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY,user_id INTEGER,subject TEXT,status TEXT,created INTEGER,updated INTEGER);
CREATE TABLE IF NOT EXISTS ticket_msgs(id INTEGER PRIMARY KEY,ticket_id INTEGER,admin INTEGER,text TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS news(id INTEGER PRIMARY KEY,title TEXT,text TEXT,ts INTEGER);`);
// миграции для баз старой версии
for(const s of ['ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN inf INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN frozen INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN freeze_left INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN max_dev INTEGER DEFAULT 1','ALTER TABLE keys ADD COLUMN devices INTEGER DEFAULT 1','ALTER TABLE keys ADD COLUMN inf INTEGER DEFAULT 0','ALTER TABLE keys ADD COLUMN admin INTEGER DEFAULT 0','ALTER TABLE keys ADD COLUMN created INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN ban_reason TEXT DEFAULT \'\'','ALTER TABLE users ADD COLUMN ref_code TEXT','ALTER TABLE users ADD COLUMN referred_by INTEGER','ALTER TABLE users ADD COLUMN ref_paid INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN reg_ip TEXT','ALTER TABLE users ADD COLUMN frozen_at INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN last_unfreeze INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN note TEXT DEFAULT \'\'','ALTER TABLE users ADD COLUMN is_reseller INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN reset_count INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN max_resets INTEGER DEFAULT 3','ALTER TABLE keys ADD COLUMN note TEXT DEFAULT \'\'','ALTER TABLE users ADD COLUMN reseller_keys INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN reseller_limit INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN trial_hwid TEXT DEFAULT \'\'','ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT \'\'','ALTER TABLE users ADD COLUMN theme TEXT DEFAULT \'dark\'','ALTER TABLE users ADD COLUMN suspicious INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN last_hwid_change INTEGER DEFAULT 0','ALTER TABLE audit ADD COLUMN ip TEXT','ALTER TABLE keys ADD COLUMN created_by INTEGER DEFAULT 0','ALTER TABLE logins ADD COLUMN proxy INTEGER DEFAULT 0','ALTER TABLE logins ADD COLUMN country TEXT DEFAULT \'\'','ALTER TABLE sessions ADD COLUMN ip TEXT DEFAULT \'\'','ALTER TABLE sessions ADD COLUMN ua TEXT DEFAULT \'\'','ALTER TABLE sessions ADD COLUMN created INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN notify_3d INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN notify_1d INTEGER DEFAULT 0'])try{db.exec(s)}catch{}
db.exec(`CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,admin_id INTEGER,action TEXT,target TEXT,details TEXT,ts INTEGER,ip TEXT);
CREATE TABLE IF NOT EXISTS coupons(code TEXT PRIMARY KEY,discount INTEGER,max_uses INTEGER,uses INTEGER DEFAULT 0,expires INTEGER DEFAULT 0,created INTEGER);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS sub_history(id INTEGER PRIMARY KEY,user_id INTEGER,days INTEGER,source TEXT,details TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY,user_id INTEGER,text TEXT,read INTEGER DEFAULT 0,ts INTEGER);
CREATE TABLE IF NOT EXISTS ip_list(ip TEXT PRIMARY KEY,type TEXT,reason TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS verify_codes(email TEXT PRIMARY KEY,code TEXT,type TEXT,expires INTEGER,data TEXT);
CREATE TABLE IF NOT EXISTS hwid_log(id INTEGER PRIMARY KEY,user_id INTEGER,hwid TEXT,name TEXT,ip TEXT,action TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS ip_cache(ip TEXT PRIMARY KEY,proxy INTEGER,hosting INTEGER,country TEXT,isp TEXT,checked INTEGER);
CREATE TABLE IF NOT EXISTS reseller_keys(id INTEGER PRIMARY KEY,reseller_id INTEGER,code TEXT,days INTEGER,devices INTEGER,inf INTEGER,created INTEGER);
CREATE TABLE IF NOT EXISTS failed_auth(ip TEXT,user_id INTEGER,ts INTEGER);
CREATE TABLE IF NOT EXISTS hwid_whitelist(id INTEGER PRIMARY KEY,user_id INTEGER,hwid TEXT,note TEXT,created INTEGER,UNIQUE(user_id,hwid));
CREATE TABLE IF NOT EXISTS sub_notices(user_id INTEGER,kind TEXT,ts INTEGER,PRIMARY KEY(user_id,kind));
INSERT OR IGNORE INTO settings(key,value) VALUES('killswitch','0'),('maintenance','0'),('status','online'),('status_text','Сервис работает');`);
db.exec("UPDATE users SET ref_code=lower(hex(randomblob(4))) WHERE ref_code IS NULL OR ref_code=''");
db.prepare('UPDATE users SET frozen_at=? WHERE frozen=1 AND frozen_at=0').run(Date.now());

// Мастер-ключ: админ-панель + бессрочная подписка. Лучше задать через env MASTER_KEY (чтобы не лежал в репозитории)
const MASTER=String(process.env.MASTER_KEY||'EmirDI1804').trim().toUpperCase();
db.prepare('INSERT OR IGNORE INTO keys(code,days,devices,inf,admin,created) VALUES(?,?,?,?,?,?)').run(MASTER,0,99,1,1,Date.now());

const DAY=864e5,PUB=path.join(__dirname,'public');
// настройки через env: пробный период (дн.), бонус за реферала (дн.), макс. длительность заморозки и пауза между заморозками (дн.)
const TRIAL=Number(process.env.TRIAL_DAYS??1),REF=Number(process.env.REF_DAYS??3),FZ_MAX=Number(process.env.FREEZE_MAX_DAYS??14),FZ_COOL=Number(process.env.FREEZE_COOLDOWN_DAYS??7),FZMS=FZ_MAX*DAY;
// авторазморозка: время паузы не больше FZ_MAX
const thaw=()=>db.prepare('UPDATE users SET sub_until=frozen_at+?+freeze_left,last_unfreeze=frozen_at+?,frozen=0,freeze_left=0 WHERE frozen=1 AND frozen_at>0 AND frozen_at<?').run(FZMS,FZMS,Date.now()-FZMS);
const logAudit=(adminId,action,target,details,ip='')=>db.prepare('INSERT INTO audit(admin_id,action,target,details,ts,ip) VALUES(?,?,?,?,?,?)').run(adminId||0,action,String(target||'').slice(0,100),String(details||'').slice(0,500),Date.now(),String(ip||'').slice(0,45));
// VPN/Proxy detection via ip-api.com (free, cached 7 days)
const ipCache=new Map();
async function checkIp(ip){
  if(!ip||ip==='127.0.0.1'||ip.startsWith('::')||ip.startsWith('10.')||ip.startsWith('192.168.'))return {proxy:0,hosting:0,country:'local',isp:'local'};
  const cached=db.prepare('SELECT * FROM ip_cache WHERE ip=? AND checked>?').get(ip,Date.now()-7*DAY);
  if(cached)return cached;
  if(ipCache.has(ip))return ipCache.get(ip);
  try{
    const ctrl=AbortSignal.timeout(2500);
    const r=await fetch('http://ip-api.com/json/'+encodeURIComponent(ip)+'?fields=status,proxy,hosting,country,isp,query',{signal:ctrl});
    const j=await r.json();
    const row={ip,proxy:j.proxy?1:0,hosting:j.hosting?1:0,country:String(j.country||'').slice(0,40),isp:String(j.isp||'').slice(0,80),checked:Date.now()};
    db.prepare('INSERT OR REPLACE INTO ip_cache(ip,proxy,hosting,country,isp,checked) VALUES(?,?,?,?,?,?)').run(row.ip,row.proxy,row.hosting,row.country,row.isp,row.checked);
    ipCache.set(ip,row);return row;
  }catch(e){const fallback={ip,proxy:0,hosting:0,country:'?',isp:'?',checked:Date.now()};ipCache.set(ip,fallback);return fallback;}
}
function logHwid(uid,hwid,name,ip,action){
  db.prepare('INSERT INTO hwid_log(user_id,hwid,name,ip,action,ts) VALUES(?,?,?,?,?,?)').run(uid,String(hwid).slice(0,128),String(name||'').slice(0,40),String(ip||'').slice(0,45),action,Date.now());
}
// автобан при подозрительной смене HWID
function checkSuspiciousHwid(uid){
  const since=Date.now()-24*3600*1000;
  const changes=db.prepare("SELECT COUNT(*) c FROM hwid_log WHERE user_id=? AND action IN ('new','reset') AND ts>?").get(uid,since).c;
  const distinct=db.prepare('SELECT COUNT(DISTINCT hwid) c FROM hwid_log WHERE user_id=? AND ts>?').get(uid,since).c;
  const maxChanges=Number(process.env.HWID_BAN_CHANGES||5);
  const maxDistinct=Number(process.env.HWID_BAN_DISTINCT||4);
  if(changes>=maxChanges||distinct>=maxDistinct){
    db.prepare("UPDATE users SET banned=1,ban_reason=?,suspicious=1 WHERE id=? AND is_admin=0").run('Автобан: подозрительная смена HWID ('+changes+' смен / '+distinct+' устр. за 24ч)',uid);
    addNotif(uid,'Аккаунт заблокирован: подозрительная активность устройств');
    logAudit(0,'autoban',uid,'hwid changes='+changes+' distinct='+distinct);
    return true;
  }
  // soft flag
  if(changes>=3||distinct>=3)db.prepare('UPDATE users SET suspicious=1 WHERE id=?').run(uid);
  return false;
}
function getSetting(k,d=''){const r=db.prepare('SELECT value FROM settings WHERE key=?').get(k);return r?r.value:d;}
function setSetting(k,v){db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k,String(v));}
const transporter=nodemailer.createTransport({
  service:'gmail',
  auth:{user:process.env.SMTP_USER||'',pass:process.env.SMTP_PASS||''}
});
const MAIL_FROM=process.env.SMTP_FROM||process.env.SMTP_USER||'noreply@forev.ext';
function mailHtml(title,bodyHtml){
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Segoe UI,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 12px"><tr><td align="center">
<table width="100%" style="max-width:480px;background:#141414;border-radius:16px;border:1px solid #222;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#ff1f3d,#b0001b);padding:20px 24px"><h1 style="margin:0;color:#fff;font-size:20px;letter-spacing:1px">FOREV EXT</h1></td></tr>
<tr><td style="padding:28px 24px;color:#e8e8e8">
<h2 style="margin:0 0 12px;color:#fff;font-size:18px">${title}</h2>
${bodyHtml}
<p style="margin:24px 0 0;font-size:12px;color:#777">Если вы не запрашивали это письмо — просто проигнорируйте его.</p>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #222;font-size:11px;color:#555;text-align:center">© FOREV EXT</td></tr>
</table></td></tr></table></body></html>`;
}
function sendMail(to,subject,html,text){
  if(!process.env.SMTP_USER||!process.env.SMTP_PASS){
    console.warn('SMTP not configured, skip mail to',to);
    return Promise.reject(new Error('SMTP not configured'));
  }
  return transporter.sendMail({from:`FOREV EXT <${MAIL_FROM}>`,to,subject,html,text:text||subject})
    .then(()=>console.log('Mail sent to',to)).catch(e=>{console.error('Mail error:',e.message);throw e});
}
function sendCode(email,code,type){
  const subject=type==='reg'?'Код подтверждения регистрации — FOREV EXT':'Код для входа — FOREV EXT';
  const title=type==='reg'?'Подтверждение регистрации':'Код для входа';
  const html=mailHtml(title,`<p style="margin:0 0 16px;line-height:1.5;color:#bbb">Ваш код подтверждения:</p>
<div style="background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:18px;text-align:center;letter-spacing:8px;font-size:28px;font-weight:700;color:#ff1f3d">${code}</div>
<p style="margin:16px 0 0;font-size:13px;color:#888">Код действителен <b style="color:#ccc">10 минут</b>.</p>`);
  return sendMail(email,subject,html,`Ваш код: ${code}\nДействителен 10 минут.`);
}
function sendExpiryMail(email,username,daysLeft,untilTs){
  const subject=daysLeft<=1?'Подписка истекает завтра — FOREV EXT':`Подписка истекает через ${daysLeft} дн. — FOREV EXT`;
  const when=untilTs?new Date(untilTs).toLocaleString('ru-RU'):'скоро';
  const html=mailHtml('Подписка заканчивается',`<p style="margin:0 0 12px;color:#bbb">Привет, <b style="color:#fff">${username}</b>!</p>
<p style="margin:0 0 16px;line-height:1.5;color:#bbb">Ваша подписка FOREV EXT истекает <b style="color:#ff1f3d">${daysLeft<=1?'завтра':`через ${daysLeft} дн.`}</b> (${when}).</p>
<p style="margin:0;font-size:13px;color:#888">Активируйте новый ключ в личном кабинете, чтобы не потерять доступ.</p>`);
  return sendMail(email,subject,html);
}
// Cloudflare Turnstile (optional)
// Своя капча (без Cloudflare): пример a±b, TTL 5 мин
const captchaStore=new Map(); // id -> {ans, exp, ip}
function makeCaptcha(ip){
  // чистим просроченные
  const now=Date.now();
  for(const [k,v] of captchaStore)if(v.exp<now)captchaStore.delete(k);
  const a=1+Math.floor(Math.random()*9), b=1+Math.floor(Math.random()*9);
  const op=Math.random()<0.5?'+':'-';
  const ans=op==='+'?a+b:a-b;
  const id=crypto.randomBytes(16).toString('hex');
  captchaStore.set(id,{ans:String(ans),exp:now+5*60*1000,ip:ip||''});
  // не больше 5к записей
  if(captchaStore.size>5000){const first=captchaStore.keys().next().value;captchaStore.delete(first)}
  return {id, question:`${a} ${op} ${b} = ?`};
}
function verifyCaptcha(id,answer,ip){
  if(!id||answer===undefined||answer===null)return false;
  const row=captchaStore.get(String(id));
  captchaStore.delete(String(id)); // one-time
  if(!row||row.exp<Date.now())return false;
  // мягкая привязка к IP (не жёсткая — мобильный/прокси могут менять)
  return String(answer).trim()===row.ans;
}
// expiry notices — run on traffic (throttled)
let lastNoticeScan=0;
async function scanExpiryNotices(){
  if(Date.now()-lastNoticeScan<6e5)return; // max once / 10 min
  lastNoticeScan=Date.now();
  const now=Date.now();
  try{
    // 3 days window: sub ends in 2.5–3.5 days
    const u3=db.prepare('SELECT id,username,email,sub_until FROM users WHERE banned=0 AND inf=0 AND frozen=0 AND sub_until>? AND sub_until<? AND id NOT IN (SELECT user_id FROM sub_notices WHERE kind=?)').all(now+2.5*DAY,now+3.5*DAY,'3d');
    for(const u of u3){
      try{await sendExpiryMail(u.email,u.username,3,u.sub_until);db.prepare('INSERT OR REPLACE INTO sub_notices(user_id,kind,ts) VALUES(?,?,?)').run(u.id,'3d',now);addNotif(u.id,'Подписка истекает через ~3 дня');}catch(e){console.error('notice3',e.message)}
    }
    const u1=db.prepare('SELECT id,username,email,sub_until FROM users WHERE banned=0 AND inf=0 AND frozen=0 AND sub_until>? AND sub_until<? AND id NOT IN (SELECT user_id FROM sub_notices WHERE kind=?)').all(now,now+1.5*DAY,'1d');
    for(const u of u1){
      try{await sendExpiryMail(u.email,u.username,1,u.sub_until);db.prepare('INSERT OR REPLACE INTO sub_notices(user_id,kind,ts) VALUES(?,?,?)').run(u.id,'1d',now);addNotif(u.id,'Подписка истекает завтра');}catch(e){console.error('notice1',e.message)}
    }
  }catch(e){console.error('scanExpiry',e.message)}
}

function genCode(){return String(Math.floor(100000+Math.random()*900000))}
const MIME={'.html':'text/html; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
const SEC=process.env.NODE_ENV==='production'?'; Secure':'';
const makeKey=()=>'FOREV-'+crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');
const hashPw=(pw,salt)=>crypto.scryptSync(pw,salt,64).toString('hex');
const clamp=(v,a,b,d)=>Math.min(Math.max(Math.floor(+v)||d,a),b);
const active=u=>!u.frozen&&!!(u.inf||u.sub_until>Date.now());
function addKeys(days,devices,n,inf,note='',prefix='FOREV'){const keys=[],st=db.prepare('INSERT INTO keys(code,days,devices,inf,created,note) VALUES(?,?,?,?,?,?)');for(let i=0;i<n;i++){const c=prefix+'-'+crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');st.run(c,days,devices,inf?1:0,Date.now(),note);keys.push(c)}return keys}
function addSubHistory(uid,days,source,details=''){db.prepare('INSERT INTO sub_history(user_id,days,source,details,ts) VALUES(?,?,?,?,?)').run(uid,days,source,details,Date.now())}
function addNotif(uid,text){db.prepare('INSERT INTO notifications(user_id,text,ts) VALUES(?,?,?)').run(uid,text.slice(0,300),Date.now())}
function isIpBanned(ip){return !!db.prepare("SELECT 1 FROM ip_list WHERE ip=? AND type='black'").get(ip)}
function isIpAllowed(ip){const white=db.prepare("SELECT 1 FROM ip_list WHERE type='white'").all();if(!white.length)return true;return !!db.prepare("SELECT 1 FROM ip_list WHERE ip=? AND type='white'").get(ip)}
function logLogin(uid,ip,kind,ok,ipInfo){
  try{
    if(ipInfo)db.prepare('INSERT INTO logins(user_id,ip,kind,ok,ts,proxy,country) VALUES(?,?,?,?,?,?,?)').run(uid,ip,kind,ok?1:0,Date.now(),ipInfo.proxy||0,ipInfo.country||'');
    else db.prepare('INSERT INTO logins(user_id,ip,kind,ok,ts) VALUES(?,?,?,?,?)').run(uid,ip,kind,ok?1:0,Date.now());
  }catch(e){db.prepare('INSERT INTO logins(user_id,ip,kind,ok,ts) VALUES(?,?,?,?,?)').run(uid,ip,kind,ok?1:0,Date.now());}
}

// CLI: node server.js genkey 30 2   (дней, устройств)
if(process.argv[2]==='genkey'){
  const days=+process.argv[3]||30,dev=+process.argv[4]||1;
  console.log(addKeys(days,dev,1,false)[0],'—',days,'дн.,',dev,'устр.');process.exit();
}

const hits=new Map();
const rl=(k,max,ms=6e5)=>{const n=Date.now(),a=(hits.get(k)||[]).filter(t=>n-t<ms);a.push(n);hits.set(k,a);if(a.length>max*3)hits.set(k,a.slice(-max));return a.length>max};
// прогрессивная блокировка после неудачных логинов
function recordFail(ip,uid=0){
  db.prepare('INSERT INTO failed_auth(ip,user_id,ts) VALUES(?,?,?)').run(ip,uid||0,Date.now());
  const fails=db.prepare('SELECT COUNT(*) c FROM failed_auth WHERE ip=? AND ts>?').get(ip,Date.now()-15*60*1000).c;
  if(fails>=10){db.prepare("INSERT OR REPLACE INTO ip_list(ip,type,reason,ts) VALUES(?,?,?,?)").run(ip,'black','auto: too many fails',Date.now());return true;}
  return false;
}
function clearFails(ip){db.prepare('DELETE FROM failed_auth WHERE ip=?').run(ip);}
const send=(res,code,obj,h={})=>{res.writeHead(code,{'Content-Type':'application/json','X-Content-Type-Options':'nosniff',...h});res.end(JSON.stringify(obj))};
const body=req=>new Promise((ok,no)=>{let d='';req.on('data',c=>{d+=c;if(d.length>1e4){no();req.destroy()}});req.on('end',()=>{try{ok(JSON.parse(d||'{}'))}catch{no()}})});
const cookie=req=>Object.fromEntries((req.headers.cookie||'').split(/;\s*/).map(c=>c.split('=')));
const authUser=req=>{
  const t=cookie(req).sid;if(!t)return null;
  const s=db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(t,Date.now());
  const u=s?db.prepare('SELECT id,username,email,created,sub_until,is_admin,inf,frozen,freeze_left,max_dev,banned,ref_code,referred_by,ref_paid,frozen_at,last_unfreeze,is_reseller,reseller_keys,reseller_limit,avatar,theme,suspicious,note FROM users WHERE id=?').get(s.user_id):null;
  return u&&!u.banned?u:null;
};
const login=(res,uid,req)=>{
  const t=crypto.randomBytes(32).toString('hex');
  const ip=req?(String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress):'';
  const ua=req?String(req.headers['user-agent']||'').slice(0,200):'';
  try{db.prepare('INSERT INTO sessions(token,user_id,expires,ip,ua,created) VALUES(?,?,?,?,?,?)').run(t,uid,Date.now()+6048e5,ip,ua,Date.now());}
  catch{db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(t,uid,Date.now()+6048e5);}
  return {'Set-Cookie':`sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${SEC}`};
};
const findU=l=>db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(l||'',l||'');
const pwOk=(u,pw)=>typeof pw==='string'&&crypto.timingSafeEqual(Buffer.from(hashPw(pw,u.salt),'hex'),Buffer.from(u.hash,'hex'));
const checkPw=(l,pw)=>{const u=findU(l);return u&&pwOk(u,pw)?u:null};
const tx=fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
// прибавить/убавить время: на заморозке двигается остаток, иначе дата окончания
const addTime=(u,ms,source='admin',details='')=>{
  const days=Math.round(ms/DAY);
  if(u.frozen)db.prepare('UPDATE users SET freeze_left=MAX(0,freeze_left+?) WHERE id=?').run(ms,u.id);
  else db.prepare('UPDATE users SET sub_until=? WHERE id=?').run(Math.max(u.sub_until,Date.now())+ms,u.id);
  if(days){addSubHistory(u.id,days,source,details);addNotif(u.id,days>0?`+${days} дней (${source})`:`${days} дней (${source})`);}
};

const srv=http.createServer(async(req,res)=>{
  try{
    const ip=String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress;
    if(req.method==='GET'&&!req.url.startsWith('/api/')){
      if(req.url==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok')}
      let p=req.url.split('?')[0];if(p==='/')p='/index.html';
      const f=path.join(PUB,path.normalize(p));
      if(f.startsWith(PUB+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile()){
        res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':path.extname(f)==='.html'?'no-cache':'public, max-age=86400'});
        return res.end(fs.readFileSync(f));
      }
      res.writeHead(404);return res.end('Not found');
    }
    if(req.url.startsWith('/api/'))thaw();
    if(req.url==='/api/status'&&req.method==='GET'){
      scanExpiryNotices(); // throttled
      return send(res,200,{status:getSetting('status'),text:getSetting('status_text'),maintenance:getSetting('maintenance')==='1',killswitch:getSetting('killswitch')==='1',captcha:true});
    }
    if(req.url==='/api/captcha'&&req.method==='GET'){
      if(rl('cap'+ip,30,6e4))return send(res,429,{error:'Слишком много запросов капчи'});
      return send(res,200,makeCaptcha(ip));
    }
    if(req.url==='/api/me'&&req.method==='GET'){
      const u=authUser(req);if(!u)return send(res,401,{error:'Не авторизован'});
      const cnt=q=>db.prepare(q).get(u.id).c,{ref_code,referred_by,ref_paid,...pu}=u;
      const activity=db.prepare("SELECT strftime('%Y-%m-%d',ts/1000,'unixepoch') d,COUNT(*) c FROM logins WHERE user_id=? AND ok=1 AND ts>? GROUP BY d ORDER BY d").all(u.id,Date.now()-90*DAY);
      return send(res,200,{...pu,active:active(u),fz:{max:FZ_MAX,cool:FZ_COOL},cool_until:u.last_unfreeze?u.last_unfreeze+FZ_COOL*DAY:0,
        ref:{code:ref_code,invited:cnt('SELECT COUNT(*) c FROM users WHERE referred_by=?'),paid:cnt('SELECT COUNT(*) c FROM users WHERE referred_by=? AND ref_paid=1'),days:REF},
        reseller:u.is_reseller?{keys:u.reseller_keys||0,limit:u.reseller_limit||0,left:Math.max(0,(u.reseller_limit||0)-(u.reseller_keys||0))}:null,
        activity});
    }
    if(req.method!=='POST'||!req.url.startsWith('/api/'))return send(res,404,{error:'Не найдено'});
    const url=req.url,strict=['/api/register','/api/login','/api/redeem','/api/client/auth','/api/admin/genkey','/api/password'].includes(url);
    if(strict?rl('a'+ip,12,3e5):rl('g'+ip,100,3e5))return send(res,429,{error:'Слишком много попыток, подождите'});
    const b=await body(req);
    const bad=(m,c=400)=>send(res,c,{error:m});
    const tokOk=()=>{const t=process.env.ADMIN_TOKEN||'',h=String(req.headers['x-admin-token']||''),A=Buffer.from(t),B=Buffer.from(h);return t&&A.length===B.length&&crypto.timingSafeEqual(A,B)};

    // ---------- админка (сессия админа; genkey ещё и по x-admin-token) ----------
    if(url.startsWith('/api/admin/')){
      const a=authUser(req);
      if(!(a&&a.is_admin)&&!(url==='/api/admin/genkey'&&tokOk()))return bad('Нет доступа',403);
      if(url==='/api/admin/genkey'){
        const inf=!!b.inf,days=inf?0:clamp(b.days,1,3650,30),dev=clamp(b.devices,1,99,1),n=clamp(b.count,1,50,1);
        const note=String(b.note||'').slice(0,200),prefix=String(b.prefix||'FOREV').replace(/[^A-Z0-9]/g,'').slice(0,12)||'FOREV';
        const keys=addKeys(days,dev,n,inf,note,prefix);
        logAudit(a?.id||0,'genkey',n,prefix+' '+days+'d');
        return send(res,200,{days,devices:dev,inf,keys});
      }
      if(url==='/api/admin/keys'){
        const keys=db.prepare('SELECT k.code,k.days,k.devices,k.inf,k.created,u.username used FROM keys k LEFT JOIN users u ON u.id=k.used_by WHERE k.admin=0 ORDER BY k.created DESC LIMIT 100').all();
        return send(res,200,{keys});
      }
      if(url==='/api/admin/delkey'){
        const r=db.prepare('DELETE FROM keys WHERE code=? AND used_by IS NULL AND admin=0').run(String(b.code||''));
        return r.changes?send(res,200,{ok:true}):bad('Ключ не найден или уже использован');
      }
      if(url==='/api/admin/users'){
        const q=String(b.q||'').replace(/[%_]/g,'').trim();
        const like='%'+q+'%';
        let users;
        if(q.length>=6 && !q.includes('@') && !q.includes(' ')){
          // search by HWID
          const byHw=db.prepare('SELECT DISTINCT user_id FROM devices WHERE hwid LIKE ? LIMIT 30').all(like).map(r=>r.user_id);
          // search by IP in logins
          const byIp=db.prepare('SELECT DISTINCT user_id FROM logins WHERE ip LIKE ? LIMIT 30').all(like).map(r=>r.user_id);
          const ids=[...new Set([...byHw,...byIp])].slice(0,30);
          if(ids.length){
            users=db.prepare(`SELECT id,username,email,created,sub_until,inf,frozen,freeze_left,max_dev,is_admin,banned,note,is_reseller,reset_count,max_resets,suspicious,reseller_keys,reseller_limit FROM users WHERE id IN (${ids.map(()=>'?').join(',')})`).all(...ids).map(u=>({...u,active:active(u)}));
          } else {
            users=db.prepare('SELECT id,username,email,created,sub_until,inf,frozen,freeze_left,max_dev,is_admin,banned,note,is_reseller,reset_count,max_resets,suspicious,reseller_keys,reseller_limit FROM users WHERE username LIKE ? OR email LIKE ? OR note LIKE ? ORDER BY id DESC LIMIT 30').all(like,like,like).map(u=>({...u,active:active(u)}));
          }
        } else {
          users=db.prepare('SELECT id,username,email,created,sub_until,inf,frozen,freeze_left,max_dev,is_admin,banned,note,is_reseller,reset_count,max_resets,suspicious,reseller_keys,reseller_limit FROM users WHERE username LIKE ? OR email LIKE ? OR note LIKE ? ORDER BY id DESC LIMIT 30').all(like,like,like).map(u=>({...u,active:active(u)}));
        }
        return send(res,200,{users});
      }
      if(url==='/api/admin/grant'){
        const t=db.prepare('SELECT * FROM users WHERE id=?').get(+b.id);if(!t)return bad('Пользователь не найден',404);
        const d=Math.trunc(+b.days)||0;if(Math.abs(d)>3650)return bad('Максимум ±3650 дней');
        tx(()=>{
          if(d)addTime(t,d*DAY);
          if(b.devices!==''&&b.devices!=null)db.prepare('UPDATE users SET max_dev=? WHERE id=?').run(clamp(b.devices,1,99,1),t.id);
        });
        return send(res,200,{ok:true});
      }
      if(url==='/api/admin/ban'){
        const t=db.prepare('SELECT * FROM users WHERE id=?').get(+b.id);if(!t)return bad('Пользователь не найден',404);
        if(t.is_admin)return bad('Админа банить нельзя');
        db.prepare('UPDATE users SET banned=1,ban_reason=? WHERE id=?').run(String(b.reason||'').slice(0,100),t.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id);return send(res,200,{ok:true});
      }
      if(url==='/api/admin/unban'){db.prepare("UPDATE users SET banned=0,ban_reason='' WHERE id=?").run(+b.id);return send(res,200,{ok:true})}
      if(url==='/api/admin/promo/add'){
        const code=String(b.code||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,24)||('P'+crypto.randomBytes(3).toString('hex').toUpperCase());
        if(db.prepare('SELECT 1 FROM promos WHERE code=?').get(code)||db.prepare('SELECT 1 FROM keys WHERE code=?').get(code))return bad('Такой код уже есть');
        const days=clamp(b.days,1,3650,3),uses=clamp(b.uses,1,1e6,100),exp=+b.exp>0?Date.now()+clamp(b.exp,1,3650,1)*DAY:0;
        db.prepare('INSERT INTO promos(code,days,max_uses,expires,created) VALUES(?,?,?,?,?)').run(code,days,uses,exp,Date.now());
        return send(res,200,{ok:true,code});
      }
      if(url==='/api/admin/promos')return send(res,200,{list:db.prepare('SELECT code,days,max_uses,uses,expires FROM promos ORDER BY created DESC LIMIT 100').all()});
      if(url==='/api/admin/promo/del'){db.prepare('DELETE FROM promos WHERE code=?').run(String(b.code||''));return send(res,200,{ok:true})}
      if(url==='/api/admin/news/add'){
        const t=String(b.title||'').trim().slice(0,80),x=String(b.text||'').trim().slice(0,1500);if(!t)return bad('Нужен заголовок');
        db.prepare('INSERT INTO news(title,text,ts) VALUES(?,?,?)').run(t,x,Date.now());return send(res,200,{ok:true});
      }
      if(url==='/api/admin/news/del'){db.prepare('DELETE FROM news WHERE id=?').run(+b.id);return send(res,200,{ok:true})}
      if(url==='/api/admin/stats'){
        const n=Date.now(),cq=(q,...a)=>db.prepare(q).get(...a).c;
        return send(res,200,{stats:{
          users:cq('SELECT COUNT(*) c FROM users'),
          new7:cq('SELECT COUNT(*) c FROM users WHERE created>?',n-7*DAY),
          new1:cq('SELECT COUNT(*) c FROM users WHERE created>?',n-DAY),
          active:cq('SELECT COUNT(*) c FROM users WHERE frozen=0 AND banned=0 AND (inf=1 OR sub_until>?)',n),
          frozen:cq('SELECT COUNT(*) c FROM users WHERE frozen=1'),
          banned:cq('SELECT COUNT(*) c FROM users WHERE banned=1'),
          suspicious:cq('SELECT COUNT(*) c FROM users WHERE suspicious=1'),
          keys:cq('SELECT COUNT(*) c FROM keys WHERE admin=0'),
          keys_used:cq('SELECT COUNT(*) c FROM keys WHERE admin=0 AND used_by IS NOT NULL'),
          keys_free:cq('SELECT COUNT(*) c FROM keys WHERE admin=0 AND used_by IS NULL'),
          devices:cq('SELECT COUNT(*) c FROM devices'),
          tickets:cq("SELECT COUNT(*) c FROM tickets WHERE status!='closed'"),
          gifts:cq('SELECT COUNT(*) c FROM gifts'),
          promo_uses:cq('SELECT COUNT(*) c FROM promo_uses'),
          logins24:cq('SELECT COUNT(*) c FROM logins WHERE ts>? AND ok=1',n-DAY),
          logins_fail24:cq('SELECT COUNT(*) c FROM logins WHERE ts>? AND ok=0',n-DAY),
          proxy24:cq('SELECT COUNT(*) c FROM logins WHERE ts>? AND proxy=1',n-DAY),
          resellers:cq('SELECT COUNT(*) c FROM users WHERE is_reseller=1'),
          hwid_events24:cq('SELECT COUNT(*) c FROM hwid_log WHERE ts>?',n-DAY)
        }});
      }
      if(url==='/api/admin/backup'){
        logAudit(a.id,'backup','db','');
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="forev-backup-'+Date.now()+'.db"'});
        return res.end(fs.readFileSync(DBP));
      }
      if(url==='/api/admin/audit'){
        const list=db.prepare('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.ts DESC LIMIT 100').all();
        return send(res,200,{list});
      }
      if(url==='/api/admin/settings'){
        if(b.action==='get')return send(res,200,{killswitch:getSetting('killswitch'),maintenance:getSetting('maintenance'),status:getSetting('status'),status_text:getSetting('status_text'),block_vpn:getSetting('block_vpn')});
        if(b.killswitch!=null){setSetting('killswitch',b.killswitch?'1':'0');logAudit(a.id,'killswitch','',b.killswitch?'on':'off',ip);}
        if(b.maintenance!=null){setSetting('maintenance',b.maintenance?'1':'0');logAudit(a.id,'maintenance','',b.maintenance?'on':'off',ip);}
        if(b.block_vpn!=null){setSetting('block_vpn',b.block_vpn?'1':'0');logAudit(a.id,'block_vpn','',b.block_vpn?'on':'off',ip);}
        if(b.status){setSetting('status',b.status);setSetting('status_text',b.status_text||'');logAudit(a.id,'status','',b.status,ip);}
        return send(res,200,{ok:true});
      }
      if(url==='/api/admin/note'){
        db.prepare('UPDATE users SET note=? WHERE id=?').run(String(b.note||'').slice(0,500),+b.id);
        logAudit(a.id,'note',b.id,b.note);
        return send(res,200,{ok:true});
      }
      if(url==='/api/admin/reseller'){
        db.prepare('UPDATE users SET is_reseller=? WHERE id=?').run(b.enable?1:0,+b.id);
        logAudit(a.id,'reseller',b.id,b.enable?'on':'off');
        return send(res,200,{ok:true});
      }
      if(url==='/api/admin/mass'){
        const ids=(b.ids||[]).map(Number).filter(Boolean);
        if(!ids.length)return bad('Нет пользователей');
        tx(()=>{
          if(b.action==='ban')db.prepare(`UPDATE users SET banned=1,ban_reason=? WHERE id IN (${ids.map(()=>'?').join(',')}) AND is_admin=0`).run(String(b.reason||'').slice(0,100),...ids);
          if(b.action==='grant'){const d=Math.trunc(+b.days)||0;if(Math.abs(d)>3650)throw new Error('too much');for(const id of ids){const t=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(t)addTime(t,d*DAY);}}
          if(b.action==='unban')db.prepare(`UPDATE users SET banned=0,ban_reason='' WHERE id IN (${ids.map(()=>'?').join(',')})`).run(...ids);
        });
        logAudit(a.id,'mass',b.action,ids.join(','));
        return send(res,200,{ok:true,count:ids.length});
      }
      if(url==='/api/admin/chart'){
        const days=clamp(b.days,7,90,30);
        const from=Date.now()-days*DAY;
        const regs=db.prepare(`SELECT strftime('%Y-%m-%d',created/1000,'unixepoch') d,COUNT(*) c FROM users WHERE created>? GROUP BY d ORDER BY d`).all(from);
        const acts=db.prepare(`SELECT strftime('%Y-%m-%d',created/1000,'unixepoch') d,COUNT(*) c FROM keys WHERE created>? AND used_by IS NOT NULL GROUP BY d ORDER BY d`).all(from);
        const logins=db.prepare(`SELECT strftime('%Y-%m-%d',ts/1000,'unixepoch') d,COUNT(*) c FROM logins WHERE ok=1 AND ts>? GROUP BY d ORDER BY d`).all(from);
        const bans=db.prepare(`SELECT strftime('%Y-%m-%d',ts/1000,'unixepoch') d,COUNT(*) c FROM audit WHERE action IN ('ban','autoban') AND ts>? GROUP BY d ORDER BY d`).all(from);
        return send(res,200,{regs,acts,logins,bans,days});
      }
      if(url==='/api/admin/toprefs'){
        const list=db.prepare('SELECT u.username,COUNT(r.id) invited,SUM(CASE WHEN r.ref_paid=1 THEN 1 ELSE 0 END) paid FROM users u JOIN users r ON r.referred_by=u.id GROUP BY u.id ORDER BY paid DESC,invited DESC LIMIT 20').all();
        return send(res,200,{list});
      }
      if(url==='/api/admin/coupon/add'){
        const code=String(b.code||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,24)||('C'+crypto.randomBytes(3).toString('hex').toUpperCase());
        const disc=clamp(b.discount,1,100,10),uses=clamp(b.uses,1,1e6,100),exp=+b.exp>0?Date.now()+clamp(b.exp,1,3650,30)*DAY:0;
        db.prepare('INSERT INTO coupons(code,discount,max_uses,expires,created) VALUES(?,?,?,?,?)').run(code,disc,uses,exp,Date.now());
        logAudit(a.id,'coupon',code,disc+'%');
        return send(res,200,{ok:true,code});
      }
      if(url==='/api/admin/coupons')return send(res,200,{list:db.prepare('SELECT * FROM coupons ORDER BY created DESC LIMIT 50').all()});
      if(url==='/api/admin/coupon/del'){db.prepare('DELETE FROM coupons WHERE code=?').run(String(b.code||''));return send(res,200,{ok:true})}
      if(url==='/api/admin/resetdevices'){
        const t=db.prepare('SELECT * FROM users WHERE id=?').get(+b.id);if(!t)return bad('Пользователь не найден',404);
        const n=db.prepare('DELETE FROM devices WHERE user_id=?').run(t.id).changes;
        db.prepare('UPDATE users SET reset_count=0 WHERE id=?').run(t.id);
        logAudit(a.id,'resetdevices',t.id,n+' devices');
        return send(res,200,{ok:true,removed:n});
      }
      if(url==='/api/admin/history'){
        const list=db.prepare('SELECT * FROM sub_history WHERE user_id=? ORDER BY ts DESC LIMIT 50').all(+b.id);
        return send(res,200,{list});
      }
      if(url==='/api/admin/export'){
        const users=db.prepare('SELECT id,username,email,created,sub_until,inf,banned,is_reseller,ref_code FROM users ORDER BY id').all();
        const csv='id,username,email,created,sub_until,inf,banned,reseller\n'+users.map(u=>[u.id,u.username,u.email,u.created,u.sub_until,u.inf,u.banned,u.is_reseller].join(',')).join('\n');
        res.writeHead(200,{'Content-Type':'text/csv','Content-Disposition':'attachment; filename="users.csv"'});
        return res.end(csv);
      }
      if(url==='/api/admin/iplist'){
        if(b.action==='add'){db.prepare('INSERT OR REPLACE INTO ip_list(ip,type,reason,ts) VALUES(?,?,?,?)').run(String(b.ip||'').slice(0,45),b.type==='white'?'white':'black',String(b.reason||'').slice(0,100),Date.now());logAudit(a.id,'iplist',b.ip,b.type);}
        if(b.action==='del')db.prepare('DELETE FROM ip_list WHERE ip=?').run(String(b.ip||''));
        return send(res,200,{list:db.prepare('SELECT * FROM ip_list ORDER BY ts DESC LIMIT 100').all()});
      }
      if(url==='/api/admin/resellerlimit'){
        db.prepare('UPDATE users SET reseller_limit=? WHERE id=?').run(clamp(b.limit,0,10000,0),+b.id);
        logAudit(a.id,'resellerlimit',b.id,String(b.limit),ip);
        return send(res,200,{ok:true});
      }
      if(url==='/api/admin/hwidlog'){
        const uid=+b.id||0;
        const list=uid
          ?db.prepare('SELECT h.*,u.username FROM hwid_log h LEFT JOIN users u ON u.id=h.user_id WHERE h.user_id=? ORDER BY h.ts DESC LIMIT 100').all(uid)
          :db.prepare('SELECT h.*,u.username FROM hwid_log h LEFT JOIN users u ON u.id=h.user_id ORDER BY h.ts DESC LIMIT 100').all();
        return send(res,200,{list});
      }
      if(url==='/api/admin/search'){
        // advanced search: hwid, ip, username, email
        const q=String(b.q||'').trim();
        if(q.length<3)return bad('Минимум 3 символа');
        const like='%'+q.replace(/[%_]/g,'')+'%';
        const byUser=db.prepare('SELECT id,username,email,banned,suspicious,is_reseller FROM users WHERE username LIKE ? OR email LIKE ? LIMIT 20').all(like,like);
        const byHw=db.prepare('SELECT d.hwid,d.name,d.user_id,d.last_seen,u.username FROM devices d JOIN users u ON u.id=d.user_id WHERE d.hwid LIKE ? LIMIT 20').all(like);
        const byIp=db.prepare('SELECT l.ip,l.user_id,l.ts,l.ok,l.kind,l.proxy,l.country,u.username FROM logins l JOIN users u ON u.id=l.user_id WHERE l.ip LIKE ? ORDER BY l.ts DESC LIMIT 30').all(like);
        return send(res,200,{users:byUser,devices:byHw,logins:byIp});
      }
      if(url==='/api/admin/userdetail'){
        const t=db.prepare('SELECT * FROM users WHERE id=?').get(+b.id);if(!t)return bad('Не найден',404);
        const devices=db.prepare('SELECT * FROM devices WHERE user_id=? ORDER BY last_seen DESC').all(t.id);
        const logins=db.prepare('SELECT ip,kind,ok,ts,proxy,country FROM logins WHERE user_id=? ORDER BY ts DESC LIMIT 30').all(t.id);
        const hwid=db.prepare('SELECT * FROM hwid_log WHERE user_id=? ORDER BY ts DESC LIMIT 30').all(t.id);
        const hist=db.prepare('SELECT * FROM sub_history WHERE user_id=? ORDER BY ts DESC LIMIT 20').all(t.id);
        return send(res,200,{user:t,devices,logins,hwid,hist});
      }
      if(url==='/api/admin/clearsuspicious'){
        db.prepare('UPDATE users SET suspicious=0 WHERE id=?').run(+b.id);
        logAudit(a.id,'clearsuspicious',b.id,'',ip);
        return send(res,200,{ok:true});
      }
      if(url==='/api/admin/setavatar'){
        // admin can clear avatar
        db.prepare('UPDATE users SET avatar=? WHERE id=?').run(String(b.avatar||'').slice(0,500),+b.id);
        return send(res,200,{ok:true});
      }
      if(url==='/api/admin/whitelist'){
        const uid=+b.id;
        if(!uid)return bad('Нет id');
        if(b.action==='list'){
          return send(res,200,{list:db.prepare('SELECT id,hwid,note,created FROM hwid_whitelist WHERE user_id=? ORDER BY created DESC').all(uid)});
        }
        if(b.action==='add'){
          const hw=String(b.hwid||'').slice(0,128);
          if(hw.length<8)return bad('HWID слишком короткий');
          db.prepare('INSERT OR IGNORE INTO hwid_whitelist(user_id,hwid,note,created) VALUES(?,?,?,?)').run(uid,hw,String(b.note||'').slice(0,100),Date.now());
          logAudit(a.id,'wl_add',uid,hw,ip);
          return send(res,200,{ok:true});
        }
        if(b.action==='del'){
          db.prepare('DELETE FROM hwid_whitelist WHERE id=? AND user_id=?').run(+b.wid,uid);
          logAudit(a.id,'wl_del',uid,b.wid,ip);
          return send(res,200,{ok:true});
        }
        return bad('action?');
      }
      return bad('Не найдено',404);
    }

    // ---------- клиент (лоадер): логин + пароль + HWID ----------
    if(url==='/api/client/auth'){
      if(getSetting('killswitch')==='1')return bad('Сервис временно отключён',503);
      if(getSetting('maintenance')==='1')return bad('Технические работы',503);
      if(isIpBanned(ip))return bad('IP заблокирован',403);
      if(!isIpAllowed(ip))return bad('IP не в белом списке',403);
      // VPN/proxy check
      const ipInfo=await checkIp(ip);
      const blockVpn=getSetting('block_vpn')==='1';
      if(blockVpn&&(ipInfo.proxy||ipInfo.hosting))return bad('VPN/Proxy/Hosting запрещены',403);
      const u=checkPw(b.login,b.password);
      if(!u){
        recordFail(ip);
        return bad('Неверный логин или пароль',401);
      }
      if(u.banned)return bad('Аккаунт заблокирован'+(u.ban_reason?': '+u.ban_reason:''),403);
      logLogin(u.id,ip,'client',1,ipInfo);
      clearFails(ip);
      if(!active(u))return bad(u.frozen?'Подписка заморожена':'Подписка не активна',403);
      const hw=String(b.hwid||'').slice(0,128);if(hw.length<8)return bad('Нет HWID');
      // whitelist mode: if user has entries, only those HWIDs allowed
      const wlCount=db.prepare('SELECT COUNT(*) c FROM hwid_whitelist WHERE user_id=?').get(u.id).c;
      if(wlCount>0){
        const ok=db.prepare('SELECT 1 FROM hwid_whitelist WHERE user_id=? AND hwid=?').get(u.id,hw);
        if(!ok){logHwid(u.id,hw,b.name,ip,'denied_wl');return bad('HWID не в белом списке',403);}
      }
      const d=db.prepare('SELECT id FROM devices WHERE user_id=? AND hwid=?').get(u.id,hw);
      if(d){
        db.prepare('UPDATE devices SET last_seen=?,name=? WHERE id=?').run(Date.now(),String(b.name||'Устройство').slice(0,40),d.id);
        logHwid(u.id,hw,b.name,ip,'seen');
      }else{
        const n=db.prepare('SELECT COUNT(*) c FROM devices WHERE user_id=?').get(u.id).c;
        if(n>=u.max_dev && wlCount===0){
          logHwid(u.id,hw,b.name,ip,'denied');
          if(checkSuspiciousHwid(u.id))return bad('Аккаунт заблокирован: подозрительная активность',403);
          return bad('Лимит устройств ('+n+'/'+u.max_dev+')',403);
        }
        // if whitelist mode and HWID is listed, allow even over limit
        if(n>=u.max_dev && wlCount>0){
          // still need to be on whitelist (already checked)
        } else if(n>=u.max_dev){
          logHwid(u.id,hw,b.name,ip,'denied');
          return bad('Лимит устройств ('+n+'/'+u.max_dev+')',403);
        }
        db.prepare('INSERT INTO devices(user_id,hwid,name,first_seen,last_seen) VALUES(?,?,?,?,?)').run(u.id,hw,String(b.name||'Устройство').slice(0,40),Date.now(),Date.now());
        logHwid(u.id,hw,b.name,ip,'new');
        db.prepare('UPDATE users SET last_hwid_change=? WHERE id=?').run(Date.now(),u.id);
        if(checkSuspiciousHwid(u.id))return bad('Аккаунт заблокирован: подозрительная активность',403);
      }
      return send(res,200,{ok:true,username:u.username,inf:!!u.inf,until:u.inf?0:u.sub_until});
    }

    if(url==='/api/register'){
      const {username,email,password,code}=b;
      if(!/^[A-Za-z0-9_]{3,20}$/.test(username||''))return bad('Ник: 3–20 символов (латиница, цифры, _)');
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email||''))return bad('Некорректный e-mail');
      if(typeof password!=='string'||password.length<8)return bad('Пароль минимум 8 символов');
      if(db.prepare('SELECT 1 FROM users WHERE username=? OR email=?').get(username,email))return bad('Ник или e-mail уже занят',409);
      if(!code){
        if(!verifyCaptcha(b.captcha_id,b.captcha,ip))return bad('Неверная или просроченная капча',400);
        const c=genCode();
        db.prepare('INSERT OR REPLACE INTO verify_codes(email,code,type,expires,data) VALUES(?,?,?,?,?)').run(email,c,'reg',Date.now()+600000,JSON.stringify({username,password,ref:b.ref,hwid:b.hwid}));
        try{await sendCode(email,c,'reg')}catch(e){
          console.error('SMTP FAIL:', e.message);
          // если почта не ушла — отдаём код в ответе, чтобы регистрация не ломалась
          return send(res,200,{need_code:true,debug_code:c,error:'Почта не отправилась, используйте код: '+c});
        }
        return send(res,200,{need_code:true});
      }
      const v=db.prepare('SELECT * FROM verify_codes WHERE email=? AND type="reg" AND expires>?').get(email,Date.now());
      if(!v||v.code!==String(code))return bad('Неверный или истёкший код');
      const data=JSON.parse(v.data||'{}');
      const salt=crypto.randomBytes(16).toString('hex');
      const rf=db.prepare('SELECT id FROM users WHERE ref_code=? AND banned=0').get(String(data.ref||'').slice(0,16));
      const hwid=String(data.hwid||'').slice(0,128);
      const trial=TRIAL>0&&!db.prepare('SELECT 1 FROM users WHERE reg_ip=? OR trial_hwid=?').get(ip,hwid)?Date.now()+TRIAL*DAY:0;
      const r=db.prepare('INSERT INTO users(username,email,hash,salt,created,sub_until,ref_code,referred_by,reg_ip,trial_hwid) VALUES(?,?,?,?,?,?,?,?,?,?)').run(data.username,email,hashPw(data.password,salt),salt,Date.now(),trial,crypto.randomBytes(4).toString('hex'),rf?rf.id:null,ip,hwid);
      db.prepare('DELETE FROM verify_codes WHERE email=?').run(email);
      logLogin(Number(r.lastInsertRowid),ip,'reg',1);
      return send(res,200,{ok:true},login(res,Number(r.lastInsertRowid,req)));
    }
    if(url==='/api/login'){
      if(isIpBanned(ip))return bad('IP заблокирован',403);
      const {login:loginName,password,code}=b;
      const f=findU(loginName);
      if(!f||!pwOk(f,password)){
        if(f)logLogin(f.id,ip,'web',0);
        if(recordFail(ip,f&&f.id))return bad('Слишком много попыток, IP заблокирован',429);
        return bad('Неверный логин или пароль',401);
      }
      if(f.banned)return bad('Аккаунт заблокирован'+(f.ban_reason?': '+f.ban_reason:''),403);
      if(!code){
        if(!verifyCaptcha(b.captcha_id,b.captcha,ip))return bad('Неверная или просроченная капча',400);
        const c=genCode();
        db.prepare('INSERT OR REPLACE INTO verify_codes(email,code,type,expires) VALUES(?,?,?,?,?)').run(f.email,c,'login',Date.now()+600000);
        try{await sendCode(f.email,c,'login')}catch(e){
          console.error('SMTP FAIL login:', e.message);
          return send(res,200,{need_code:true,email:f.email,debug_code:c,error:'Почта не отправилась, используйте код: '+c});
        }
        return send(res,200,{need_code:true,email:f.email});
      }
      const v=db.prepare('SELECT * FROM verify_codes WHERE email=? AND type="login" AND expires>?').get(f.email,Date.now());
      if(!v||v.code!==String(code))return bad('Неверный или истёкший код');
      db.prepare('DELETE FROM verify_codes WHERE email=?').run(f.email);
      logLogin(f.id,ip,'web',1);clearFails(ip);
      return send(res,200,{ok:true},login(res,f.id,req));
    }
    if(url==='/api/logout'){
      db.prepare('DELETE FROM sessions WHERE token=?').run(cookie(req).sid||'');
      return send(res,200,{ok:true},{'Set-Cookie':'sid=; Max-Age=0; Path=/'});
    }

    // ---------- всё ниже — только для авторизованных ----------
    const u=authUser(req);if(!u)return bad('Не авторизован',401);

    if(url==='/api/redeem'){
      const code=String(b.key||'').trim().toUpperCase();
      const k=db.prepare('SELECT * FROM keys WHERE code=? AND used_by IS NULL').get(code);
      if(k){
        tx(()=>{
          db.prepare('UPDATE keys SET used_by=? WHERE code=?').run(u.id,k.code);
          if(k.admin)db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(u.id);
          if(k.inf)db.prepare('UPDATE users SET inf=1 WHERE id=?').run(u.id);
          if(k.days>0)addTime(u,k.days*DAY);
          db.prepare('UPDATE users SET max_dev=MAX(max_dev,?) WHERE id=?').run(k.devices||1,u.id);
          // бонус пригласившему — за первый активированный ключ реферала
          if(!k.admin&&u.referred_by&&!u.ref_paid){
            const r=db.prepare('SELECT * FROM users WHERE id=? AND banned=0').get(u.referred_by);
            if(r&&REF>0)addTime(r,REF*DAY);
            db.prepare('UPDATE users SET ref_paid=1 WHERE id=?').run(u.id);
          }
        });
        return send(res,200,{ok:true});
      }
      const pr=db.prepare('SELECT * FROM promos WHERE code=?').get(code);
      if(!pr||pr.uses>=pr.max_uses||(pr.expires&&pr.expires<Date.now()))return bad('Ключ или промокод недействителен');
      if(db.prepare('SELECT 1 FROM promo_uses WHERE code=? AND user_id=?').get(code,u.id))return bad('Вы уже использовали этот промокод');
      tx(()=>{db.prepare('INSERT INTO promo_uses VALUES(?,?)').run(code,u.id);db.prepare('UPDATE promos SET uses=uses+1 WHERE code=?').run(code);addTime(u,pr.days*DAY)});
      return send(res,200,{ok:true,promo:true,days:pr.days});
    }
    if(url==='/api/freeze'){
      if(u.inf)return bad('Бессрочную подписку замораживать не нужно');
      if(u.frozen)return bad('Уже заморожена');
      if(u.sub_until<=Date.now())return bad('Нет активной подписки');
      const cd=u.last_unfreeze+FZ_COOL*DAY-Date.now();
      if(cd>0)return bad('Следующая заморозка через '+Math.ceil(cd/DAY)+' дн.');
      db.prepare('UPDATE users SET frozen=1,freeze_left=?,frozen_at=? WHERE id=?').run(u.sub_until-Date.now(),Date.now(),u.id);
      return send(res,200,{ok:true});
    }
    if(url==='/api/unfreeze'){
      if(!u.frozen)return bad('Подписка не заморожена');
      db.prepare('UPDATE users SET frozen=0,sub_until=?,freeze_left=0,last_unfreeze=? WHERE id=?').run(Date.now()+u.freeze_left,Date.now(),u.id);
      return send(res,200,{ok:true});
    }
    if(url==='/api/password'){
      const row=db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
      if(!pwOk(row,b.old))return bad('Текущий пароль неверный');
      if(typeof b.new!=='string'||b.new.length<8)return bad('Новый пароль минимум 8 символов');
      const salt=crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE users SET hash=?,salt=? WHERE id=?').run(hashPw(b.new,salt),salt,u.id);
      db.prepare('DELETE FROM sessions WHERE user_id=? AND token!=?').run(u.id,cookie(req).sid||'');
      return send(res,200,{ok:true});
    }
    if(url==='/api/logout_all'){
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      return send(res,200,{ok:true},{'Set-Cookie':'sid=; Max-Age=0; Path=/'});
    }
    if(url==='/api/sessions'){
      const cur=cookie(req).sid||'';
      const list=db.prepare('SELECT token,ip,ua,created,expires FROM sessions WHERE user_id=? AND expires>? ORDER BY created DESC LIMIT 20').all(u.id,Date.now())
        .map(s=>({id:s.token.slice(0,12),ip:s.ip,ua:s.ua,created:s.created||0,expires:s.expires,current:s.token===cur}));
      return send(res,200,{list});
    }
    if(url==='/api/session/del'){
      const id=String(b.id||'');
      if(!id)return bad('Нет id');
      // match by token prefix for safety (we only expose first 12 chars)
      const rows=db.prepare('SELECT token FROM sessions WHERE user_id=? AND expires>?').all(u.id,Date.now());
      const match=rows.find(r=>r.token.startsWith(id)||r.token===id);
      if(!match)return bad('Сессия не найдена',404);
      if(match.token===(cookie(req).sid||''))return bad('Нельзя завершить текущую сессию так — используйте «Выйти»');
      db.prepare('DELETE FROM sessions WHERE token=?').run(match.token);
      return send(res,200,{ok:true});
    }
    if(url==='/api/logins')return send(res,200,{list:db.prepare('SELECT ip,kind,ok,ts FROM logins WHERE user_id=? ORDER BY ts DESC LIMIT 8').all(u.id)});
    if(url==='/api/news')return send(res,200,{list:db.prepare('SELECT id,title,text,ts FROM news ORDER BY ts DESC LIMIT 6').all()});

    // ---------- тикеты (владелец или админ) ----------
    const tk=id=>{const t=db.prepare('SELECT t.*,x.username FROM tickets t JOIN users x ON x.id=t.user_id WHERE t.id=?').get(+id);return t&&(t.user_id===u.id||u.is_admin)?t:null};
    if(url==='/api/ticket/new'){
      const subj=String(b.subject||'').trim().slice(0,80),text=String(b.text||'').trim().slice(0,2000);
      if(!subj||!text)return bad('Заполните тему и сообщение');
      if(db.prepare("SELECT COUNT(*) c FROM tickets WHERE user_id=? AND status!='closed'").get(u.id).c>=5)return bad('Слишком много открытых тикетов (5)');
      const n=Date.now(),r=db.prepare('INSERT INTO tickets(user_id,subject,status,created,updated) VALUES(?,?,?,?,?)').run(u.id,subj,'open',n,n);
      db.prepare('INSERT INTO ticket_msgs(ticket_id,admin,text,ts) VALUES(?,?,?,?)').run(Number(r.lastInsertRowid),0,text,n);
      return send(res,200,{ok:true});
    }
    if(url==='/api/ticket/list'){
      const all=b.all&&u.is_admin;
      const list=db.prepare(`SELECT t.id,t.subject,t.status,t.updated,x.username FROM tickets t JOIN users x ON x.id=t.user_id ${all?'':'WHERE t.user_id=?'} ORDER BY (t.status='closed'),t.updated DESC LIMIT 50`).all(...(all?[]:[u.id]));
      return send(res,200,{list});
    }
    if(url==='/api/ticket/get'){
      const t=tk(b.id);if(!t)return bad('Тикет не найден',404);
      return send(res,200,{ticket:{id:t.id,subject:t.subject,status:t.status,username:t.username},msgs:db.prepare('SELECT admin,text,ts FROM ticket_msgs WHERE ticket_id=? ORDER BY id').all(t.id)});
    }
    if(url==='/api/ticket/reply'){
      const t=tk(b.id),text=String(b.text||'').trim().slice(0,2000);
      if(!t)return bad('Тикет не найден',404);if(t.status==='closed')return bad('Тикет закрыт');if(!text)return bad('Пустое сообщение');
      const adm=u.is_admin&&t.user_id!==u.id?1:0;
      db.prepare('INSERT INTO ticket_msgs(ticket_id,admin,text,ts) VALUES(?,?,?,?)').run(t.id,adm,text,Date.now());
      db.prepare('UPDATE tickets SET status=?,updated=? WHERE id=?').run(adm?'answered':'open',Date.now(),t.id);
      return send(res,200,{ok:true});
    }
    if(url==='/api/ticket/close'){
      const t=tk(b.id);if(!t)return bad('Тикет не найден',404);
      db.prepare("UPDATE tickets SET status='closed',updated=? WHERE id=?").run(Date.now(),t.id);return send(res,200,{ok:true});
    }
    if(url==='/api/users/search'){
      const q=String(b.q||'').replace(/[^A-Za-z0-9_]/g,'').slice(0,20);
      if(q.length<2)return send(res,200,{users:[]});
      const users=db.prepare('SELECT username FROM users WHERE username LIKE ? AND id!=? ORDER BY username LIMIT 6').all('%'+q+'%',u.id).map(x=>x.username);
      return send(res,200,{users});
    }
    if(url==='/api/gift'){
      const to=db.prepare('SELECT * FROM users WHERE username=?').get(String(b.to||'').trim());
      const d=Math.floor(+b.days);
      if(!to)return bad('Пользователь не найден');
      if(to.id===u.id)return bad('Нельзя дарить самому себе');
      if(!(d>=1&&d<=3650))return bad('Укажите количество дней (1–3650)');
      if(u.frozen)return bad('Сначала разморозьте подписку');
      if(!u.inf&&d*DAY>u.sub_until-Date.now())return bad('Недостаточно дней на подписке');
      if(to.inf)return bad('У получателя бессрочная подписка');
      tx(()=>{
        if(!u.inf)db.prepare('UPDATE users SET sub_until=sub_until-? WHERE id=?').run(d*DAY,u.id);
        addTime(to,d*DAY);
        db.prepare('INSERT INTO gifts(from_id,to_id,days,ts) VALUES(?,?,?,?)').run(u.id,to.id,d,Date.now());
      });
      return send(res,200,{ok:true,days:d,to:to.username});
    }
    if(url==='/api/gifts'){
      const list=db.prepare('SELECT g.days,g.ts,g.from_id,f.username fn,t.username tn FROM gifts g JOIN users f ON f.id=g.from_id JOIN users t ON t.id=g.to_id WHERE g.from_id=? OR g.to_id=? ORDER BY g.ts DESC LIMIT 8').all(u.id,u.id).map(g=>({days:g.days,ts:g.ts,fn:g.fn,tn:g.tn,out:g.from_id===u.id}));
      return send(res,200,{list});
    }
    if(url==='/api/devices'){
      return send(res,200,{max:u.max_dev,list:db.prepare('SELECT id,name,first_seen,last_seen FROM devices WHERE user_id=? ORDER BY last_seen DESC').all(u.id)});
    }
    if(url==='/api/device/del'){
      const usr=db.prepare('SELECT reset_count,max_resets FROM users WHERE id=?').get(u.id);
      if((usr.reset_count||0)>=(usr.max_resets||3))return bad('Достигнут лимит сбросов устройств ('+(usr.max_resets||3)+')');
      const dev=db.prepare('SELECT hwid,name FROM devices WHERE id=? AND user_id=?').get(+b.id,u.id);
      const r=db.prepare('DELETE FROM devices WHERE id=? AND user_id=?').run(+b.id,u.id);
      if(r.changes){
        db.prepare('UPDATE users SET reset_count=reset_count+1,last_hwid_change=? WHERE id=?').run(Date.now(),u.id);
        if(dev)logHwid(u.id,dev.hwid,dev.name,ip,'reset');
        checkSuspiciousHwid(u.id);
      }
      return send(res,200,{ok:true,resets:(usr.reset_count||0)+1,max:(usr.max_resets||3)});
    }
    if(url==='/api/nick'){
      const nick=String(b.username||'').trim();
      if(!/^[A-Za-z0-9_]{3,20}$/.test(nick))return bad('Ник: 3–20 символов (латиница, цифры, _)');
      if(db.prepare('SELECT 1 FROM users WHERE username=? AND id!=?').get(nick,u.id))return bad('Ник занят');
      db.prepare('UPDATE users SET username=? WHERE id=?').run(nick,u.id);
      return send(res,200,{ok:true,username:nick});
    }
    if(url==='/api/delete'){
      if(u.is_admin)return bad('Админа удалить нельзя');
      tx(()=>{
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
        db.prepare('DELETE FROM devices WHERE user_id=?').run(u.id);
        db.prepare('DELETE FROM users WHERE id=?').run(u.id);
      });
      return send(res,200,{ok:true},{'Set-Cookie':'sid=; Max-Age=0; Path=/'});
    }
    if(url==='/api/exchange'){
      const days=clamp(b.days,1,365,30);
      if(u.inf)return bad('Бессрочная подписка');
      if(u.frozen)return bad('Подписка заморожена');
      const left=Math.max(0,u.sub_until-Date.now());
      if(left<days*DAY)return bad('Недостаточно дней');
      const key=makeKey();
      tx(()=>{
        db.prepare('UPDATE users SET sub_until=sub_until-? WHERE id=?').run(days*DAY,u.id);
        db.prepare('INSERT INTO keys(code,days,devices,created) VALUES(?,?,?,?)').run(key,days,1,Date.now());
      });
      return send(res,200,{ok:true,key,days});
    }
    if(url==='/api/toprefs'){
      const list=db.prepare('SELECT u.username,COUNT(r.id) invited,SUM(CASE WHEN r.ref_paid=1 THEN 1 ELSE 0 END) paid FROM users u JOIN users r ON r.referred_by=u.id GROUP BY u.id ORDER BY paid DESC,invited DESC LIMIT 10').all();
      return send(res,200,{list});
    }
    if(url==='/api/notifs'){
      const list=db.prepare('SELECT id,text,read,ts FROM notifications WHERE user_id=? ORDER BY ts DESC LIMIT 20').all(u.id);
      return send(res,200,{list});
    }
    if(url==='/api/notifs/read'){
      db.prepare('UPDATE notifications SET read=1 WHERE user_id=? AND id=?').run(u.id,+b.id);
      return send(res,200,{ok:true});
    }
    if(url==='/api/history'){
      const list=db.prepare('SELECT * FROM sub_history WHERE user_id=? ORDER BY ts DESC LIMIT 30').all(u.id);
      return send(res,200,{list});
    }
    // ---- Reseller panel ----
    if(url==='/api/reseller/genkey'){
      if(!u.is_reseller)return bad('Нет доступа реселлера',403);
      const left=Math.max(0,(u.reseller_limit||0)-(u.reseller_keys||0));
      if(left<=0)return bad('Лимит ключей исчерпан');
      const days=clamp(b.days,1,365,30),dev=clamp(b.devices,1,5,1),n=clamp(b.count,1,Math.min(10,left),1);
      const keys=addKeys(days,dev,n,false,'reseller:'+u.username,'RSL');
      db.prepare('UPDATE users SET reseller_keys=reseller_keys+? WHERE id=?').run(n,u.id);
      for(const k of keys)db.prepare('INSERT INTO reseller_keys(reseller_id,code,days,devices,inf,created) VALUES(?,?,?,?,0,?)').run(u.id,k,days,dev,Date.now());
      logAudit(u.id,'reseller_genkey',n,days+'d/'+dev+'dev',ip);
      return send(res,200,{keys,left:left-n,days,devices:dev});
    }
    if(url==='/api/reseller/keys'){
      if(!u.is_reseller)return bad('Нет доступа',403);
      const list=db.prepare('SELECT rk.*,k.used_by,u2.username used FROM reseller_keys rk LEFT JOIN keys k ON k.code=rk.code LEFT JOIN users u2 ON u2.id=k.used_by WHERE rk.reseller_id=? ORDER BY rk.created DESC LIMIT 100').all(u.id);
      return send(res,200,{list,keys:u.reseller_keys||0,limit:u.reseller_limit||0,left:Math.max(0,(u.reseller_limit||0)-(u.reseller_keys||0))});
    }
    // ---- Profile / UX ----
    if(url==='/api/profile'){
      const avatar=String(b.avatar||'').slice(0,500);
      const theme=b.theme==='light'?'light':'dark';
      db.prepare('UPDATE users SET avatar=?,theme=? WHERE id=?').run(avatar,theme,u.id);
      return send(res,200,{ok:true,avatar,theme});
    }
    if(url==='/api/activity'){
      const days=clamp(b.days,7,90,30);
      const from=Date.now()-days*DAY;
      const list=db.prepare("SELECT strftime('%Y-%m-%d',ts/1000,'unixepoch') d,COUNT(*) c FROM logins WHERE user_id=? AND ok=1 AND ts>? GROUP BY d ORDER BY d").all(u.id,from);
      return send(res,200,{list,days});
    }
    bad('Не найдено',404);
  }catch(e){send(res,400,{error:'Ошибка запроса'})}
}).listen(process.env.PORT||3000,()=>console.log('FOREV EXT: http://localhost:'+(process.env.PORT||3000)));
// keep-alive дольше, чем у прокси Render (иначе первый запрос после простоя рвётся: «Load failed»)
srv.keepAliveTimeout=65e3;srv.headersTimeout=66e3;

require('./keepalive')(); // анти-сон, настраивается через PING_URL
