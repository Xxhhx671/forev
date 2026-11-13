// FOREV EXT — сервер без зависимостей. Нужен Node.js 22.5+  (запуск: node server.js)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
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
for(const s of ['ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN inf INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN frozen INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN freeze_left INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN max_dev INTEGER DEFAULT 1','ALTER TABLE keys ADD COLUMN devices INTEGER DEFAULT 1','ALTER TABLE keys ADD COLUMN inf INTEGER DEFAULT 0','ALTER TABLE keys ADD COLUMN admin INTEGER DEFAULT 0','ALTER TABLE keys ADD COLUMN created INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN ban_reason TEXT DEFAULT \'\'','ALTER TABLE users ADD COLUMN ref_code TEXT','ALTER TABLE users ADD COLUMN referred_by INTEGER','ALTER TABLE users ADD COLUMN ref_paid INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN reg_ip TEXT','ALTER TABLE users ADD COLUMN frozen_at INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN last_unfreeze INTEGER DEFAULT 0'])try{db.exec(s)}catch{}
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
const logLogin=(uid,ip,kind,ok)=>db.prepare('INSERT INTO logins(user_id,ip,kind,ok,ts) VALUES(?,?,?,?,?)').run(uid,String(ip||'').slice(0,45),kind,ok?1:0,Date.now());
const MIME={'.html':'text/html; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
const SEC=process.env.NODE_ENV==='production'?'; Secure':'';
const makeKey=()=>'FOREV-'+crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');
const hashPw=(pw,salt)=>crypto.scryptSync(pw,salt,64).toString('hex');
const clamp=(v,a,b,d)=>Math.min(Math.max(Math.floor(+v)||d,a),b);
const active=u=>!u.frozen&&!!(u.inf||u.sub_until>Date.now());
function addKeys(days,devices,n,inf){const keys=[],st=db.prepare('INSERT INTO keys(code,days,devices,inf,created) VALUES(?,?,?,?,?)');for(let i=0;i<n;i++){const c=makeKey();st.run(c,days,devices,inf?1:0,Date.now());keys.push(c)}return keys}

// CLI: node server.js genkey 30 2   (дней, устройств)
if(process.argv[2]==='genkey'){
  const days=+process.argv[3]||30,dev=+process.argv[4]||1;
  console.log(addKeys(days,dev,1,false)[0],'—',days,'дн.,',dev,'устр.');process.exit();
}

const hits=new Map();
const rl=(k,max,ms=6e5)=>{const n=Date.now(),a=(hits.get(k)||[]).filter(t=>n-t<ms);a.push(n);hits.set(k,a);return a.length>max};
const send=(res,code,obj,h={})=>{res.writeHead(code,{'Content-Type':'application/json','X-Content-Type-Options':'nosniff',...h});res.end(JSON.stringify(obj))};
const body=req=>new Promise((ok,no)=>{let d='';req.on('data',c=>{d+=c;if(d.length>1e4){no();req.destroy()}});req.on('end',()=>{try{ok(JSON.parse(d||'{}'))}catch{no()}})});
const cookie=req=>Object.fromEntries((req.headers.cookie||'').split(/;\s*/).map(c=>c.split('=')));
const authUser=req=>{
  const t=cookie(req).sid;if(!t)return null;
  const s=db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(t,Date.now());
  const u=s?db.prepare('SELECT id,username,email,created,sub_until,is_admin,inf,frozen,freeze_left,max_dev,banned,ref_code,referred_by,ref_paid,frozen_at,last_unfreeze FROM users WHERE id=?').get(s.user_id):null;
  return u&&!u.banned?u:null;
};
const login=(res,uid)=>{
  const t=crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(t,uid,Date.now()+6048e5);
  return {'Set-Cookie':`sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${SEC}`};
};
const findU=l=>db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(l||'',l||'');
const pwOk=(u,pw)=>typeof pw==='string'&&crypto.timingSafeEqual(Buffer.from(hashPw(pw,u.salt),'hex'),Buffer.from(u.hash,'hex'));
const checkPw=(l,pw)=>{const u=findU(l);return u&&pwOk(u,pw)?u:null};
const tx=fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
// прибавить/убавить время: на заморозке двигается остаток, иначе дата окончания
const addTime=(u,ms)=>u.frozen
  ?db.prepare('UPDATE users SET freeze_left=MAX(0,freeze_left+?) WHERE id=?').run(ms,u.id)
  :db.prepare('UPDATE users SET sub_until=? WHERE id=?').run(Math.max(u.sub_until,Date.now())+ms,u.id);

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
    if(req.url==='/api/me'&&req.method==='GET'){
      const u=authUser(req);if(!u)return send(res,401,{error:'Не авторизован'});
      const c=q=>db.prepare(q).get(u.id).c,{ref_code,referred_by,ref_paid,...pu}=u;
      return send(res,200,{...pu,active:active(u),fz:{max:FZ_MAX,cool:FZ_COOL},cool_until:u.last_unfreeze?u.last_unfreeze+FZ_COOL*DAY:0,
        ref:{code:ref_code,invited:c('SELECT COUNT(*) c FROM users WHERE referred_by=?'),paid:c('SELECT COUNT(*) c FROM users WHERE referred_by=? AND ref_paid=1'),days:REF}});
    }
    if(req.method!=='POST'||!req.url.startsWith('/api/'))return send(res,404,{error:'Не найдено'});
    const url=req.url,strict=['/api/register','/api/login','/api/redeem','/api/client/auth','/api/admin/genkey','/api/password'].includes(url);
    if(strict?rl('a'+ip,20):rl('g'+ip,150))return send(res,429,{error:'Слишком много попыток, подождите'});
    const b=await body(req);
    const bad=(m,c=400)=>send(res,c,{error:m});
    const tokOk=()=>{const t=process.env.ADMIN_TOKEN||'',h=String(req.headers['x-admin-token']||''),A=Buffer.from(t),B=Buffer.from(h);return t&&A.length===B.length&&crypto.timingSafeEqual(A,B)};

    // ---------- админка (сессия админа; genkey ещё и по x-admin-token) ----------
    if(url.startsWith('/api/admin/')){
      const a=authUser(req);
      if(!(a&&a.is_admin)&&!(url==='/api/admin/genkey'&&tokOk()))return bad('Нет доступа',403);
      if(url==='/api/admin/genkey'){
        const inf=!!b.inf,days=inf?0:clamp(b.days,1,3650,30),dev=clamp(b.devices,1,99,1),n=clamp(b.count,1,50,1);
        return send(res,200,{days,devices:dev,inf,keys:addKeys(days,dev,n,inf)});
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
        const q='%'+String(b.q||'').replace(/[%_]/g,'')+'%';
        const users=db.prepare('SELECT id,username,email,created,sub_until,inf,frozen,freeze_left,max_dev,is_admin,banned FROM users WHERE username LIKE ? OR email LIKE ? ORDER BY id DESC LIMIT 30').all(q,q).map(u=>({...u,active:active(u)}));
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
        const n=Date.now(),c=(q,...a)=>db.prepare(q).get(...a).c;
        return send(res,200,{stats:{users:c('SELECT COUNT(*) c FROM users'),new7:c('SELECT COUNT(*) c FROM users WHERE created>?',n-7*DAY),active:c('SELECT COUNT(*) c FROM users WHERE frozen=0 AND banned=0 AND (inf=1 OR sub_until>?)',n),
          frozen:c('SELECT COUNT(*) c FROM users WHERE frozen=1'),banned:c('SELECT COUNT(*) c FROM users WHERE banned=1'),keys:c('SELECT COUNT(*) c FROM keys WHERE admin=0'),keys_used:c('SELECT COUNT(*) c FROM keys WHERE admin=0 AND used_by IS NOT NULL'),
          devices:c('SELECT COUNT(*) c FROM devices'),tickets:c("SELECT COUNT(*) c FROM tickets WHERE status!='closed'"),gifts:c('SELECT COUNT(*) c FROM gifts'),promo_uses:c('SELECT COUNT(*) c FROM promo_uses'),logins24:c('SELECT COUNT(*) c FROM logins WHERE ts>?',n-DAY)}});
      }
      return bad('Не найдено',404);
    }

    // ---------- клиент (лоадер): логин + пароль + HWID ----------
    if(url==='/api/client/auth'){
      const u=checkPw(b.login,b.password);if(!u)return bad('Неверный логин или пароль',401);
      if(u.banned)return bad('Аккаунт заблокирован',403);
      logLogin(u.id,ip,'client',1);
      if(!active(u))return bad(u.frozen?'Подписка заморожена':'Подписка не активна',403);
      const hw=String(b.hwid||'').slice(0,128);if(hw.length<8)return bad('Нет HWID');
      const d=db.prepare('SELECT id FROM devices WHERE user_id=? AND hwid=?').get(u.id,hw);
      if(d)db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(Date.now(),d.id);
      else{
        const n=db.prepare('SELECT COUNT(*) c FROM devices WHERE user_id=?').get(u.id).c;
        if(n>=u.max_dev)return bad('Лимит устройств ('+n+'/'+u.max_dev+')',403);
        db.prepare('INSERT INTO devices(user_id,hwid,name,first_seen,last_seen) VALUES(?,?,?,?,?)').run(u.id,hw,String(b.name||'Устройство').slice(0,40),Date.now(),Date.now());
      }
      return send(res,200,{ok:true,username:u.username,inf:!!u.inf,until:u.inf?0:u.sub_until});
    }

    if(url==='/api/register'){
      const {username,email,password}=b;
      if(!/^[A-Za-z0-9_]{3,20}$/.test(username||''))return bad('Ник: 3–20 символов (латиница, цифры, _)');
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email||''))return bad('Некорректный e-mail');
      if(typeof password!=='string'||password.length<8)return bad('Пароль минимум 8 символов');
      if(db.prepare('SELECT 1 FROM users WHERE username=? OR email=?').get(username,email))return bad('Ник или e-mail уже занят',409);
      const salt=crypto.randomBytes(16).toString('hex');
      const rf=db.prepare('SELECT id FROM users WHERE ref_code=? AND banned=0').get(String(b.ref||'').slice(0,16));
      const trial=TRIAL>0&&!db.prepare('SELECT 1 FROM users WHERE reg_ip=?').get(ip)?Date.now()+TRIAL*DAY:0; // пробный период — один раз на IP
      const r=db.prepare('INSERT INTO users(username,email,hash,salt,created,sub_until,ref_code,referred_by,reg_ip) VALUES(?,?,?,?,?,?,?,?,?)').run(username,email,hashPw(password,salt),salt,Date.now(),trial,crypto.randomBytes(4).toString('hex'),rf?rf.id:null,ip);
      logLogin(Number(r.lastInsertRowid),ip,'reg',1);
      return send(res,200,{ok:true},login(res,Number(r.lastInsertRowid)));
    }
    if(url==='/api/login'){
      const f=findU(b.login),u=f&&pwOk(f,b.password)?f:null;
      if(f)logLogin(f.id,ip,'web',!!u);
      if(!u)return bad('Неверный логин или пароль',401);
      if(u.banned)return bad('Аккаунт заблокирован'+(u.ban_reason?': '+u.ban_reason:''),403);
      return send(res,200,{ok:true},login(res,u.id));
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
      db.prepare('DELETE FROM devices WHERE id=? AND user_id=?').run(+b.id,u.id);
      return send(res,200,{ok:true});
    }
    bad('Не найдено',404);
  }catch(e){send(res,400,{error:'Ошибка запроса'})}
}).listen(process.env.PORT||3000,()=>console.log('FOREV EXT: http://localhost:'+(process.env.PORT||3000)));
// keep-alive дольше, чем у прокси Render (иначе первый запрос после простоя рвётся: «Load failed»)
srv.keepAliveTimeout=65e3;srv.headersTimeout=66e3;

require('./keepalive')(); // анти-сон, настраивается через PING_URL
