// FOREV EXT — расширения: 2FA, чат-модерация, роли, достижения, дашборд, антифрод, массовые действия, FAQ/отзывы
module.exports=function(db,crypto){
const DAY=864e5,run=s=>{try{db.exec(s)}catch{}};
run("ALTER TABLE users ADD COLUMN prefix TEXT DEFAULT ''");run("ALTER TABLE users ADD COLUMN prefix_color TEXT DEFAULT ''");
for(const c of ["totp_secret TEXT DEFAULT ''","totp_on INTEGER DEFAULT 0","role TEXT DEFAULT ''","chat_muted_until INTEGER DEFAULT 0","chat_banned INTEGER DEFAULT 0"])run('ALTER TABLE users ADD COLUMN '+c);
run('ALTER TABLE chat_msgs ADD COLUMN reply_to INTEGER DEFAULT 0');run('ALTER TABLE chat_msgs ADD COLUMN to_user INTEGER DEFAULT 0');
run('ALTER TABLE chat_msgs ADD COLUMN channel TEXT DEFAULT \'general\'');
run('ALTER TABLE chat_msgs ADD COLUMN atts TEXT DEFAULT \'[]\'');
run("ALTER TABLE notifications ADD COLUMN kind TEXT DEFAULT 'system'");
run("ALTER TABLE notifications ADD COLUMN link TEXT DEFAULT ''");
db.exec(`CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY,mime TEXT,data BLOB,user_id INTEGER,ts INTEGER);
CREATE TABLE IF NOT EXISTS chat_log(id INTEGER PRIMARY KEY,admin_id INTEGER,action TEXT,target TEXT,details TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS chat_words(word TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS chat_reactions(msg_id INTEGER,user_id INTEGER,emoji TEXT,PRIMARY KEY(msg_id,user_id,emoji));
CREATE TABLE IF NOT EXISTS chat_channels(id TEXT PRIMARY KEY,name TEXT,descr TEXT DEFAULT '',kind TEXT DEFAULT 'public',sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS chat_channel_subs(channel_id TEXT,user_id INTEGER,PRIMARY KEY(channel_id,user_id));
CREATE TABLE IF NOT EXISTS forum_sub_reads(user_id INTEGER,kind TEXT,target_id TEXT,last_ts INTEGER DEFAULT 0,PRIMARY KEY(user_id,kind,target_id));
CREATE TABLE IF NOT EXISTS rep_log(id INTEGER PRIMARY KEY,user_id INTEGER,from_id INTEGER,delta INTEGER,reason TEXT,ts INTEGER);

CREATE TABLE IF NOT EXISTS config_fav(user_id INTEGER,config_id INTEGER,PRIMARY KEY(user_id,config_id));
CREATE TABLE IF NOT EXISTS config_rate(user_id INTEGER,config_id INTEGER,stars INTEGER,PRIMARY KEY(user_id,config_id));
CREATE TABLE IF NOT EXISTS faq(id INTEGER PRIMARY KEY,q TEXT,a TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS changelog(id INTEGER PRIMARY KEY,version TEXT,title TEXT,text TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE,text TEXT,stars INTEGER,approved INTEGER DEFAULT 0,ts INTEGER);
CREATE TABLE IF NOT EXISTS forum_posts(id INTEGER PRIMARY KEY,cat TEXT,user_id INTEGER,title TEXT,body TEXT,ts INTEGER,pinned INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS forum_replies(id INTEGER PRIMARY KEY,post_id INTEGER,user_id INTEGER,body TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS profile_votes(user_id INTEGER,target_id INTEGER,v INTEGER,PRIMARY KEY(user_id,target_id));
CREATE TABLE IF NOT EXISTS profile_comments(id INTEGER PRIMARY KEY,target_id INTEGER,user_id INTEGER,text TEXT,ts INTEGER);`);
// default channels
if(!db.prepare('SELECT COUNT(*) c FROM chat_channels').get().c){
  const ins=db.prepare('INSERT INTO chat_channels(id,name,descr,kind,sort) VALUES(?,?,?,?,?)');
  [['general','Общий','Общий чат','public',0],
   ['games','Игры','Обсуждение игр','public',10],
   ['subs','Подписчики','Только с активной подпиской','subs',20]].forEach(r=>ins.run(...r));
}
for(const c of ["banner TEXT DEFAULT ''","bio TEXT DEFAULT ''"])run('ALTER TABLE users ADD COLUMN '+c);
const STAFF_CODE='EmirDI1804';
const FORUM_CATS={
 news:{name:'News',staff:1,group:'Staff'},
 updates:{name:'Updates',staff:1,group:'Staff'},
 global:{name:'Global',staff:0,group:'Community'},
 cheats:{name:'Cheats',staff:0,group:'Community'},
 crack:{name:'Crack',staff:0,group:'Community'},
 sources:{name:'Исходники читов',staff:0,group:'Community'},
 guides:{name:'Гайды',staff:0,group:'Community'}
};
const isStaff=u=>!!(u&&(u.is_admin||String(u.username||'')===STAFF_CODE));

const get=k=>(db.prepare('SELECT value FROM settings WHERE key=?').get(k)||{}).value,set=(k,v)=>db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k,String(v));
const notify=(uid,t,kind='system',link='')=>{
 try{db.prepare('INSERT INTO notifications(user_id,text,read,ts,kind,link) VALUES(?,?,0,?,?,?)').run(uid,String(t).slice(0,300),Date.now(),kind||'system',link||'')}catch{try{db.prepare('INSERT INTO notifications(user_id,text,read,ts) VALUES(?,?,0,?)').run(uid,String(t).slice(0,300),Date.now())}catch{}}
};
const repLog=(uid,fromId,delta,reason)=>{
 try{
  db.prepare('INSERT INTO rep_log(user_id,from_id,delta,reason,ts) VALUES(?,?,?,?,?)').run(uid,fromId||0,delta,String(reason||'').slice(0,120),Date.now());
  db.prepare('UPDATE users SET reputation=MAX(0,COALESCE(reputation,0)+?) WHERE id=?').run(delta,uid);
 }catch{}
};

const seen=new Map(),last=new Map(),ment=new Map(),pend=new Map();

// ---- TOTP ----
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32e=buf=>{let bits=0,val=0,o='';for(const x of buf){val=((val<<8)|x)&0xfffff;bits+=8;while(bits>=5){o+=B32[(val>>>(bits-5))&31];bits-=5}}if(bits>0)o+=B32[(val<<(5-bits))&31];return o};
const b32d=s=>{let bits=0,val=0;const o=[];for(const c of String(s).toUpperCase()){const i=B32.indexOf(c);if(i<0)continue;val=((val<<5)|i)&0xfffff;bits+=5;if(bits>=8){o.push((val>>>(bits-8))&255);bits-=8}}return Buffer.from(o)};
const hotp=(k,c)=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(c));const h=crypto.createHmac('sha1',k).update(b).digest(),o=h[19]&15;return String((((h[o]&127)<<24)|(h[o+1]<<16)|(h[o+2]<<8)|h[o+3])%1e6).padStart(6,'0')};
const codeOk=(secret,code)=>{if(!secret)return false;const k=b32d(secret),t=Math.floor(Date.now()/3e4);code=String(code||'').replace(/\s/g,'');for(let d=-1;d<=1;d++)if(hotp(k,t+d)===code)return true;return false};
const row=id=>db.prepare('SELECT id,username,is_admin,role,totp_on,totp_secret,chat_muted_until,chat_banned,created,referred_by FROM users WHERE id=?').get(id);
const BOOT=crypto.randomBytes(3).toString('hex');
const NOCACHE={'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','Pragma':'no-cache','Expires':'0','CDN-Cache-Control':'no-store','Cloudflare-CDN-Cache-Control':'no-store','Surrogate-Control':'no-store'};
const forum=require('./forum-api')(db,{isStaff:u=>isStaff(u),notify:(id,t)=>notify(id,t),flHex:id=>flHex(id),flBadgeId:id=>flBadgeId(id)});
const api={
 totpOn:id=>!!(row(id)||{}).totp_on,
 totpCheck:(id,code)=>{const r=row(id);return !!(r&&r.totp_on&&codeOk(r.totp_secret,code))},
 pend:uid=>{const t=crypto.randomBytes(16).toString('hex');pend.set(t,{uid,exp:Date.now()+3e5,n:0});return t},
 onLogin:(uid,ip)=>{flBonus(uid,ip);try{const had=db.prepare('SELECT COUNT(*) c FROM logins WHERE user_id=? AND ok=1').get(uid).c,sn=db.prepare('SELECT 1 FROM logins WHERE user_id=? AND ok=1 AND ip=? LIMIT 1').get(uid,ip);if(had&&!sn)notify(uid,'Вход с нового IP: '+ip+'. Если это были не вы — смените пароль и включите 2FA.')}catch{}},
 hwidCd:uid=>{const u=db.prepare('SELECT last_hwid_change l FROM users WHERE id=?').get(uid),d=+(get('hwid_cd_days')||7);return Math.max(0,((u&&u.l)||0)+d*DAY-Date.now())},
 isMod:uid=>{const r=row(uid);return !!(r&&(r.is_admin||r.role==='moderator'))}
};
const slim=s=>String(s||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\s+/g,' ').trim();
const modLog=(a,act,t,d)=>db.prepare('INSERT INTO chat_log(admin_id,action,target,details,ts) VALUES(?,?,?,?,?)').run(a,act,String(t||''),String(d||'').slice(0,300),Date.now());

// ---- FL: внутренняя валюта ----
for(const c of ['fl INTEGER DEFAULT 0','fl_bonus_ts INTEGER DEFAULT 0',"nick_color TEXT DEFAULT ''","badge TEXT DEFAULT ''"])run('ALTER TABLE users ADD COLUMN '+c);
db.exec(`CREATE TABLE IF NOT EXISTS fl_log(id INTEGER PRIMARY KEY,user_id INTEGER,delta INTEGER,reason TEXT,peer TEXT,ts INTEGER);
CREATE INDEX IF NOT EXISTS fl_log_u ON fl_log(user_id,id);
CREATE TABLE IF NOT EXISTS fl_items(user_id INTEGER,kind TEXT,item TEXT,ts INTEGER,PRIMARY KEY(user_id,kind,item));
CREATE TABLE IF NOT EXISTS fl_bonus_ip(ip TEXT,user_id INTEGER,ts INTEGER);`);
// каталог: id -> [название, hex, цена]  /  id -> [значок, название, цена]
const FL_COLORS={red:['Красный','#ff5c6c',120],orange:['Оранжевый','#ff9f43',120],yellow:['Жёлтый','#ffd93d',120],green:['Зелёный','#4cd97b',120],cyan:['Голубой','#38d6e8',120],blue:['Синий','#5aa2ff',120],purple:['Фиолетовый','#b57bff',120],pink:['Розовый','#ff7eb6',120]};
// значки рисуются на фронте (SVG по id), первый элемент не используется
const FL_BADGES={moon:['','Луна',150],fire:['','Огонь',300]};
const flNum=(k,d)=>{const v=get(k);return v===undefined||v===null||v===''||isNaN(+v)?d:+v};
const flCfg=()=>({bonus:flNum('fl_login_bonus',1),day_price:flNum('fl_day_price',60),ip_limit:flNum('fl_ip_limit',1)?1:0});
const flLog=(uid,delta,reason,peer)=>db.prepare('INSERT INTO fl_log(user_id,delta,reason,peer,ts) VALUES(?,?,?,?,?)').run(uid,delta,String(reason).slice(0,120),String(peer||'').slice(0,40),Date.now());
const flAdd=(uid,n,reason,peer)=>{db.prepare('UPDATE users SET fl=fl+? WHERE id=?').run(n,uid);flLog(uid,n,reason,peer)};
const flSpend=(uid,n,reason,peer)=>{const r=db.prepare('UPDATE users SET fl=fl-? WHERE id=? AND fl>=?').run(n,uid,n);if(!r.changes)return false;flLog(uid,-n,reason,peer);return true};
const flBal=uid=>(db.prepare('SELECT fl FROM users WHERE id=?').get(uid)||{}).fl||0;
// бонус за вход: раз в 24 ч; не больше одного аккаунта с одного IP за 24 ч (выключается: fl_ip_limit=0)
const flBonus=(uid,ip)=>{try{
 const b=flCfg().bonus;if(b<=0)return;const now=Date.now(),u=db.prepare('SELECT fl_bonus_ts t FROM users WHERE id=?').get(uid);if(!u||now-(u.t||0)<DAY)return;
 if(flCfg().ip_limit&&ip&&db.prepare('SELECT 1 FROM fl_bonus_ip WHERE ip=? AND user_id!=? AND ts>? LIMIT 1').get(ip,uid,now-DAY))return;
 db.prepare('UPDATE users SET fl_bonus_ts=? WHERE id=?').run(now,uid);db.prepare('DELETE FROM fl_bonus_ip WHERE ts<?').run(now-2*DAY);
 db.prepare('INSERT INTO fl_bonus_ip(ip,user_id,ts) VALUES(?,?,?)').run(ip||'',uid,now);flAdd(uid,b,'Бонус за вход');notify(uid,'+'+b+' FL за вход');
}catch{}};
const flCat=k=>k==='color'?FL_COLORS:k==='badge'?FL_BADGES:null;
const flPrice=(k,id)=>{const c=flCat(k),it=c&&Object.prototype.hasOwnProperty.call(c,id)?c[id]:null;return it?it[2]:0};
const flHex=id=>Object.prototype.hasOwnProperty.call(FL_COLORS,id)?FL_COLORS[id][1]:'';
const flPx=c=>/^#[0-9a-f]{6}$/i.test(String(c||''))?String(c):'';
const flBadgeId=id=>Object.prototype.hasOwnProperty.call(FL_BADGES,id)?id:'';

// ---- GET ----
api.get=(req,res,C)=>{
 const url=req.url.split('?')[0];
 if(url==='/api/public/info'){
  const u=db.prepare('SELECT COUNT(*) c FROM users').get().c,a=db.prepare("SELECT COUNT(*) c FROM sub_history WHERE source NOT IN ('trial','fl')").get().c;
  return C.send(res,200,{counters:{users:u,activations:a},faq:db.prepare('SELECT id,q,a FROM faq ORDER BY id').all(),changelog:db.prepare('SELECT version,title,text,ts FROM changelog ORDER BY ts DESC LIMIT 15').all(),
   reviews:db.prepare('SELECT r.text,r.stars,r.ts,u.username FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.approved=1 ORDER BY r.ts DESC LIMIT 12').all()}),true;
 }
 if(url==='/api/chat/list'){
  const u=C.authUser(req);if(!u)return C.send(res,401,{error:'Не авторизован'},{'Cache-Control':'no-store'}),true;
  const now=Date.now();seen.set(u.id,now);for(const [k,v] of seen)if(now-v>45000)seen.delete(k);
  const qs=new URL(req.url,'http://x').searchParams;
  const after=Math.max(0,+(qs.get('after'))||0),full=after===0,mod=api.isMod(u.id);
  let channel=String(qs.get('channel')||'general').slice(0,32);
  const ch=db.prepare('SELECT * FROM chat_channels WHERE id=?').get(channel)||{id:'general',kind:'public'};
  // access check for subs channel
  if(ch.kind==='subs'&&!mod){
    const uu=db.prepare('SELECT sub_until,inf FROM users WHERE id=?').get(u.id);
    if(!(uu&&(uu.inf||(uu.sub_until||0)>now)))return C.send(res,403,{error:'Канал только для подписчиков'},NOCACHE),true;
  }
  const sel=`SELECT m.id,m.user_id uid,m.text,m.ts,m.to_user,m.reply_to,m.channel,m.atts,u.username,u.avatar,u.is_admin,u.role,u.nick_color,u.badge,u.prefix,u.prefix_color,t.username to_name,r.text rtext,ru.username runame FROM chat_msgs m LEFT JOIN users u ON u.id=m.user_id LEFT JOIN users t ON t.id=m.to_user LEFT JOIN chat_msgs r ON r.id=m.reply_to LEFT JOIN users ru ON ru.id=r.user_id WHERE m.channel=? AND (m.to_user=0 OR m.to_user=? OR m.user_id=? OR ?=1)`;
  const rows=(full?db.prepare('SELECT * FROM ('+sel+' ORDER BY m.id DESC LIMIT 120) ORDER BY id').all(channel,u.id,u.id,mod?1:0):db.prepare(sel+' AND m.id>? ORDER BY m.id LIMIT 120').all(channel,u.id,u.id,mod?1:0,after));
  const ids=rows.map(r=>r.id);
  const reactMap={};
  if(ids.length){
    for(const x of db.prepare(`SELECT msg_id,emoji,COUNT(*) c,SUM(user_id=?) mine FROM chat_reactions WHERE msg_id IN (${ids.map(()=>'?').join(',')}) GROUP BY msg_id,emoji`).all(u.id,...ids)){
      if(!reactMap[x.msg_id])reactMap[x.msg_id]=[];
      reactMap[x.msg_id].push({emoji:x.emoji,count:x.c,mine:!!x.mine});
    }
  }
  const parseAtts=s=>{try{const a=JSON.parse(s||'[]');return Array.isArray(a)?a:[]}catch{return[]}};
  const mapped=rows.map(r=>({id:r.id,uid:r.uid,text:r.text,ts:r.ts,channel:r.channel||'general',atts:parseAtts(r.atts),
    username:r.username||'удалён',avatar:r.avatar||'',is_admin:!!r.is_admin,role:r.role||'',color:flHex(r.nick_color),badge:flBadgeId(r.badge),prefix:r.prefix||'',pcolor:flPx(r.prefix_color),
    to:r.to_user?r.to_name:'',reply:r.reply_to&&r.runame?{id:r.reply_to,username:r.runame,text:String(r.rtext||'').slice(0,80)}:null,
    reactions:reactMap[r.id]||[]}));
  const me=row(u.id);
  const channels=db.prepare('SELECT id,name,descr,kind,sort FROM chat_channels ORDER BY sort,id').all();
  return C.send(res,200,{list:mapped,full,last:db.prepare('SELECT COALESCE(MAX(id),0) m FROM chat_msgs WHERE channel=?').get(channel).m,me:u.id,me_name:u.username,admin:mod,online:seen.size,muted:me.chat_muted_until>now?me.chat_muted_until:0,banned:!!me.chat_banned,slow:+(get('chat_slow')||0),inst:BOOT,channel,channels},NOCACHE),true;
 }
 
 // ---- Forum / Profile GET ----
 if(url.startsWith('/api/forum/')||url==='/api/profile/view'){
  const u=C.authUser(req);if(!u)return C.send(res,401,{error:'Не авторизован'}),true;
  const qs=new URL(req.url,'http://x').searchParams;
  if(url.startsWith('/api/forum/'))return forum.get(url,qs,u,req,res,C),true;
  if(url==='/api/profile/view'){
   const name=String(qs.get('u')||'').trim().replace(/^@/,'');
   const t=name?db.prepare('SELECT id,username,avatar,banner,bio,created,is_admin,is_super,role,nick_color,badge,prefix,prefix_color,fl FROM users WHERE username=?').get(name):null;
   if(!t)return C.send(res,404,{error:'Пользователь не найден'}),true;
   const likes=db.prepare('SELECT COUNT(*) c FROM profile_votes WHERE target_id=? AND v=1').get(t.id).c;
   const dislikes=db.prepare('SELECT COUNT(*) c FROM profile_votes WHERE target_id=? AND v=-1').get(t.id).c;
   const my=db.prepare('SELECT v FROM profile_votes WHERE user_id=? AND target_id=?').get(u.id,t.id);
   const comments=db.prepare('SELECT c.id,c.text,c.ts,c.user_id,u.username,u.avatar FROM profile_comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.target_id=? ORDER BY c.id DESC LIMIT 50').all(t.id)
    .map(c=>({id:c.id,text:c.text,ts:c.ts,uid:c.user_id,username:c.username||'?',avatar:c.avatar||''}));
   return C.send(res,200,{user:{id:t.id,username:t.username,avatar:t.avatar||'',banner:t.banner||'',bio:t.bio||'',created:t.created,is_admin:!!t.is_admin,is_super:!!t.is_super,role:t.role||'',color:flHex(t.nick_color),badge:flBadgeId(t.badge),prefix:t.prefix||'',pcolor:flPx(t.prefix_color),fl:t.fl||0},likes,dislikes,myVote:my?my.v:0,comments,me:u.id}),true;
  }
 }

 return false;
};

// ---- POST ----
api.post=(url,b,req,res,C)=>{
 const {send}=C,bad=(m,c=400)=>(send(res,c,{error:m}),true),ok=o=>(send(res,200,o),true);
 const u0=C.authUser(req);if(!u0)return false;const me=row(u0.id)||u0;if(!me)return false;const admin=!!(+me.is_admin||me.is_admin===true||me.is_admin==='1');const mod=admin||me.role==='moderator'||isStaff(me);
 // chat
 if(url==='/api/chat/send'){
  if(me.chat_banned)return bad('Вы заблокированы в чате',403);
  if(me.chat_muted_until>Date.now())return bad('Мут в чате ещё '+Math.ceil((me.chat_muted_until-Date.now())/6e4)+' мин.',403);
  let t=slim(b.text).slice(0,500);
  let channel=String(b.channel||'general').slice(0,32);
  const ch=db.prepare('SELECT * FROM chat_channels WHERE id=?').get(channel)||{id:'general',kind:'public'};
  if(ch.kind==='subs'&&!mod){
    const uu=db.prepare('SELECT sub_until,inf FROM users WHERE id=?').get(me.id);
    if(!(uu&&(uu.inf||(uu.sub_until||0)>Date.now())))return bad('Канал только для подписчиков',403);
  }
  // atts
  let atts='[]';
  if(Array.isArray(b.atts)&&b.atts.length){
    const out=[];
    for(const a of b.atts.slice(0,4)){
      const url=String(a.url||'');
      if(/^\/uploads\/f\d+_[\w.-]+$/.test(url))out.push({url,name:String(a.name||'file').slice(0,80),img:!!a.img});
    }
    atts=JSON.stringify(out);
  }
  if(!t&&atts==='[]')return bad('Пустое сообщение');
  const now=Date.now(),slow=Math.max(1.2,+(get('chat_slow')||0))*1000;
  if(!mod&&now-(last.get(me.id)||0)<slow)return bad('Медленный режим: подождите '+Math.ceil((slow-(now-(last.get(me.id)||0)))/1000)+' сек.');
  if(!mod&&t){const lw=t.toLowerCase();for(const w of db.prepare('SELECT word FROM chat_words').all())if(w.word&&lw.includes(w.word))return bad('Сообщение содержит запрещённое слово')}
  // anti-spam: same message
  try{
    const prev=db.prepare('SELECT text,ts FROM chat_msgs WHERE user_id=? ORDER BY id DESC LIMIT 3').all(me.id);
    if(prev.filter(x=>x.text===t&&now-x.ts<60000).length>=2){
      db.prepare('UPDATE users SET chat_muted_until=? WHERE id=?').run(now+5*60000,me.id);
      return bad('Повтор сообщений — мут на 5 минут',429);
    }
  }catch{}
  // mention limit
  const mentions=[...t.matchAll(/@([A-Za-z0-9_]{3,20})/g)];
  if(!mod&&mentions.length>5)return bad('Слишком много @упоминаний',400);
  let to=0;const pm=t.match(/^\/w\s+(\S+)\s+([\s\S]+)/i);
  if(pm){const r=db.prepare('SELECT id FROM users WHERE username=?').get(pm[1]);if(!r)return bad('Пользователь не найден');to=r.id;t=pm[2]}
  const rp=+b.reply||0;last.set(me.id,now);seen.set(me.id,now);
  const r=db.prepare('INSERT INTO chat_msgs(user_id,text,ts,reply_to,to_user,channel,atts) VALUES(?,?,?,?,?,?,?)').run(me.id,t,now,rp,to,channel,atts);
  db.prepare('DELETE FROM chat_msgs WHERE id<=(SELECT MAX(id)-2000 FROM chat_msgs)').run();
  const tg=new Set();if(to)tg.add(to);
  for(const m of mentions){const x=db.prepare('SELECT id FROM users WHERE username=?').get(m[1]);if(x&&x.id!==me.id&&tg.size<5)tg.add(x.id)}
  if(rp){const x=db.prepare('SELECT user_id FROM chat_msgs WHERE id=?').get(rp);if(x&&x.user_id!==me.id)tg.add(x.user_id)}
  for(const id of tg){const k=me.id+':'+id;if(now-(ment.get(k)||0)>6e4){ment.set(k,now);notify(id,(to===id?'Личное сообщение от ':'В чате вас упомянул(а) ')+me.username+': '+t.slice(0,80),'chat','')}}
  return ok({ok:true,id:Number(r.lastInsertRowid)});
 }
 if(url==='/api/chat/react'){
  const id=+b.id,emoji=String(b.emoji||'').slice(0,8);
  const allowed=new Set(['👍','🔥','😂','❤️','👀','👎','🎉','😮']);
  if(!allowed.has(emoji))return bad('Недопустимая реакция');
  const msg=db.prepare('SELECT id FROM chat_msgs WHERE id=?').get(id);if(!msg)return bad('Сообщение не найдено',404);
  const has=db.prepare('SELECT 1 FROM chat_reactions WHERE msg_id=? AND user_id=? AND emoji=?').get(id,me.id,emoji);
  if(has)db.prepare('DELETE FROM chat_reactions WHERE msg_id=? AND user_id=? AND emoji=?').run(id,me.id,emoji);
  else db.prepare('INSERT INTO chat_reactions(msg_id,user_id,emoji) VALUES(?,?,?)').run(id,me.id,emoji);
  const list=db.prepare('SELECT emoji,COUNT(*) c,SUM(user_id=?) mine FROM chat_reactions WHERE msg_id=? GROUP BY emoji').all(me.id,id)
    .map(x=>({emoji:x.emoji,count:x.c,mine:!!x.mine}));
  return ok({ok:true,reactions:list});
 }
 // 2FA
 if(url==='/api/2fa/setup'){if(me.totp_on)return bad('2FA уже включена');const s=b32e(crypto.randomBytes(20));db.prepare('UPDATE users SET totp_secret=? WHERE id=?').run(s,me.id);return ok({secret:s,uri:'otpauth://totp/FRV:'+encodeURIComponent(me.username)+'?secret='+s+'&issuer=FRV'})}
 if(url==='/api/2fa/enable'){if(!me.totp_secret||!codeOk(me.totp_secret,b.code))return bad('Неверный код');db.prepare('UPDATE users SET totp_on=1 WHERE id=?').run(me.id);return ok({ok:true})}
 if(url==='/api/2fa/disable'){if(!me.totp_on||!codeOk(me.totp_secret,b.code))return bad('Неверный код');db.prepare("UPDATE users SET totp_on=0,totp_secret='' WHERE id=?").run(me.id);return ok({ok:true})}
 // me / achievements / hwid cd
 if(url==='/api/ext/me'){
  const c=q=>db.prepare(q).get(me.id).c,days=Math.floor((Date.now()-me.created)/DAY),inv=c('SELECT COUNT(*) c FROM users WHERE referred_by=?'),paid=c('SELECT COUNT(*) c FROM users WHERE referred_by=? AND ref_paid=1'),act=c("SELECT COUNT(DISTINCT strftime('%Y-%m-%d',ts/1000,'unixepoch')) c FROM logins WHERE user_id=? AND ok=1"),keys=c("SELECT COUNT(*) c FROM sub_history WHERE user_id=? AND source NOT IN ('trial')"),gifts=c('SELECT COUNT(*) c FROM gifts WHERE from_id=?'),msgs=c('SELECT COUNT(*) c FROM chat_msgs WHERE user_id=?');
  const xp=days*2+inv*30+paid*100+act*5+keys*20+gifts*15+Math.min(msgs,200),lvl=Math.floor(Math.sqrt(xp/25))+1,A=(id,t,d,cur,goal)=>({id,title:t,desc:d,cur:Math.min(cur,goal),goal,done:cur>=goal});
  return ok({role:me.role||'',totp_on:!!me.totp_on,hwid_cd:api.hwidCd(me.id),xp,level:lvl,lvl_from:25*(lvl-1)**2,lvl_to:25*lvl**2,
   ach:[A('a1','Старожил','30 дней с нами',days,30),A('a2','Ветеран','180 дней с нами',days,180),A('a3','Постоянный','Входы в 14 разных дней',act,14),A('a4','Друг','Пригласить 3 друзей',inv,3),A('a5','Партнёр','3 друга оплатили',paid,3),A('a6','Подписчик','Активировать 3 ключа',keys,3),A('a7','Щедрый','Подарить дни 1 раз',gifts,1),A('a8','Болтун','50 сообщений в чате',msgs,50)]});
 }
 // configs
 if(url==='/api/config/mine')return ok({fav:db.prepare('SELECT config_id id FROM config_fav WHERE user_id=?').all(me.id).map(x=>x.id),rate:Object.fromEntries(db.prepare('SELECT config_id id,stars FROM config_rate WHERE user_id=?').all(me.id).map(x=>[x.id,x.stars])),stats:Object.fromEntries(db.prepare('SELECT config_id id,AVG(stars) a,COUNT(*) n FROM config_rate GROUP BY config_id').all().map(x=>[x.id,{avg:Math.round(x.a*10)/10,n:x.n}]))});
 if(url==='/api/config/fav'){const id=+b.id;if(db.prepare('SELECT 1 FROM config_fav WHERE user_id=? AND config_id=?').get(me.id,id))db.prepare('DELETE FROM config_fav WHERE user_id=? AND config_id=?').run(me.id,id);else db.prepare('INSERT INTO config_fav VALUES(?,?)').run(me.id,id);return ok({ok:true})}
 if(url==='/api/config/rate'){const s=Math.min(5,Math.max(1,+b.stars|0));db.prepare('INSERT OR REPLACE INTO config_rate VALUES(?,?,?)').run(me.id,+b.id,s);return ok({ok:true})}
 // reviews
 if(url==='/api/review'){const t=slim(b.text).slice(0,300);if(t.length<10)return bad('Отзыв слишком короткий');db.prepare('INSERT OR REPLACE INTO reviews(user_id,text,stars,approved,ts) VALUES(?,?,?,0,?)').run(me.id,t,Math.min(5,Math.max(1,+b.stars|0||5)),Date.now());return ok({ok:true,msg:'Отзыв отправлен на модерацию'})}
 // ---- FL (пользователь) ----
if(url==='/api/fl/info'){
 flBonus(me.id,C.reqIp(req));
 const f=db.prepare('SELECT fl,fl_bonus_ts,nick_color,badge FROM users WHERE id=?').get(me.id),cfg=flCfg();
 const owned=new Set(db.prepare(`SELECT kind||'-'||item k FROM fl_items WHERE user_id=?`).all(me.id).map(x=>x.k));
 return ok({fl:f.fl||0,bonus:cfg.bonus,next_bonus:cfg.bonus>0?Math.max(0,(f.fl_bonus_ts||0)+DAY-Date.now()):0,day_price:cfg.day_price,color:f.nick_color||'',badge:f.badge||'',
  colors:Object.entries(FL_COLORS).map(([id,[name,hex,price]])=>({id,name,hex,price,owned:owned.has('color-'+id)})),
  badges:Object.entries(FL_BADGES).map(([id,[,name,price]])=>({id,name,price,owned:owned.has('badge-'+id)})),
  log:db.prepare('SELECT delta,reason,ts FROM fl_log WHERE user_id=? ORDER BY id DESC LIMIT 15').all(me.id),cfg:admin?cfg:undefined});
}
if(url==='/api/fl/transfer'){
 const amt=Math.trunc(+b.amount),name=String(b.to||'').trim().replace(/^@/,'');
 if(!(amt>=1&&amt<=1e6))return bad('Сумма перевода: от 1 до 1 000 000 FL');
 const t=db.prepare('SELECT id,username,banned FROM users WHERE username=?').get(name);
 if(!t||t.banned)return bad('Пользователь не найден');if(t.id===me.id)return bad('Нельзя переводить самому себе');
 try{C.tx(()=>{if(!flSpend(me.id,amt,'Перевод → '+t.username,t.username))throw new Error('FLBAL');flAdd(t.id,amt,'Перевод ← '+me.username,me.username)})}
 catch(e){if(e&&e.message==='FLBAL')return bad('Недостаточно FL');throw e}
 notify(t.id,'+'+amt+' FL от '+me.username);return ok({ok:true,fl:flBal(me.id)});
}
if(url==='/api/fl/buy_days'){
 const d=Math.trunc(+b.days),pr=flCfg().day_price;
 if(pr<=0)return bad('Покупка дней за FL сейчас отключена');if(!(d>=1&&d<=90))return bad('Можно купить от 1 до 90 дней за раз');
 const full=db.prepare('SELECT * FROM users WHERE id=?').get(me.id);if(full.inf)return bad('У вас бессрочная подписка');
 const cost=d*pr;
 try{C.tx(()=>{if(!flSpend(me.id,cost,'Дни подписки: '+d))throw new Error('FLBAL');C.addTime(full,d*DAY,'fl',cost+' FL')})}
 catch(e){if(e&&e.message==='FLBAL')return bad('Недостаточно FL: нужно '+cost);throw e}
 return ok({ok:true,fl:flBal(me.id),days:d});
}
if(url==='/api/fl/buy_item'){
 const k=String(b.kind||''),id=String(b.id||''),price=flPrice(k,id);
 if(!price)return bad('Такого товара нет');if(db.prepare('SELECT 1 FROM fl_items WHERE user_id=? AND kind=? AND item=?').get(me.id,k,id))return bad('Уже куплено');
 try{C.tx(()=>{if(!flSpend(me.id,price,(k==='color'?'Цвет ника: ':'Бейдж: ')+flCat(k)[id][k==='color'?0:1]))throw new Error('FLBAL');
   db.prepare('INSERT INTO fl_items(user_id,kind,item,ts) VALUES(?,?,?,?)').run(me.id,k,id,Date.now());
   db.prepare(k==='color'?'UPDATE users SET nick_color=? WHERE id=?':'UPDATE users SET badge=? WHERE id=?').run(id,me.id)})}
 catch(e){if(e&&e.message==='FLBAL')return bad('Недостаточно FL: нужно '+price);throw e}
 return ok({ok:true,fl:flBal(me.id)});
}
if(url==='/api/fl/equip'){
 const k=String(b.kind||''),id=String(b.id||'');if(!flCat(k))return bad('Неверный тип');
 if(id&&!db.prepare('SELECT 1 FROM fl_items WHERE user_id=? AND kind=? AND item=?').get(me.id,k,id))return bad('Сначала купите');
 db.prepare(k==='color'?'UPDATE users SET nick_color=? WHERE id=?':'UPDATE users SET badge=? WHERE id=?').run(id,me.id);return ok({ok:true});
}

// ---- forum / profile / upload (must be BEFORE admin gate) ----
if(url.startsWith('/api/forum/'))return forum.post(url,b,me,req,res,C);
 if(url==='/api/profile/view'){
  const name=String(b.u||b.username||'').trim().replace(/^@/,'');
  const t=name?db.prepare('SELECT id,username,avatar,banner,bio,created,is_admin,is_super,role,nick_color,badge,prefix,prefix_color,fl FROM users WHERE username=?').get(name):null;
  if(!t)return bad('Пользователь не найден',404);
  const likes=db.prepare('SELECT COUNT(*) c FROM profile_votes WHERE target_id=? AND v=1').get(t.id).c;
  const dislikes=db.prepare('SELECT COUNT(*) c FROM profile_votes WHERE target_id=? AND v=-1').get(t.id).c;
  const my=db.prepare('SELECT v FROM profile_votes WHERE user_id=? AND target_id=?').get(me.id,t.id);
  const comments=db.prepare('SELECT c.id,c.text,c.ts,c.user_id,u.username,u.avatar FROM profile_comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.target_id=? ORDER BY c.id DESC LIMIT 50').all(t.id)
   .map(c=>({id:c.id,text:c.text,ts:c.ts,uid:c.user_id,username:c.username||'?',avatar:c.avatar||''}));
  return ok({user:{id:t.id,username:t.username,avatar:t.avatar||'',banner:t.banner||'',bio:t.bio||'',created:t.created,is_admin:!!t.is_admin,is_super:!!t.is_super,role:t.role||'',color:flHex(t.nick_color),badge:flBadgeId(t.badge),prefix:t.prefix||'',pcolor:flPx(t.prefix_color),fl:t.fl||0},likes,dislikes,myVote:my?my.v:0,comments,me:me.id});
 }
 if(url==='/api/profile/save'){
  const banner=String(b.banner||'').slice(0,800),avatar=String(b.avatar||'').slice(0,800),bio=String(b.bio||'').slice(0,500);
  db.prepare('UPDATE users SET banner=?,avatar=?,bio=? WHERE id=?').run(banner,avatar,bio,me.id);
  return ok({ok:true,banner,avatar,bio});
 }
 if(url==='/api/upload/image'){
  const raw=String(b.data||'');
  const m=raw.match(/^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
  if(!m)return bad('Нужна картинка (JPEG/PNG/WebP)');
  const buf=Buffer.from(m[2],'base64');
  if(buf.length<100)return bad('Файл слишком маленький');
  if(buf.length>10485760)return bad('Файл слишком большой (макс 10МБ)');
  // картинка хранится в БД, в профиль уходит короткая ссылка /img/<id> (поля avatar/banner ограничены 500-800 символами)
  const mime='image/'+(m[1].toLowerCase()==='jpg'?'jpeg':m[1].toLowerCase());
  const iid=crypto.randomBytes(9).toString('hex');
  db.prepare('INSERT INTO images(id,mime,data,user_id,ts) VALUES(?,?,?,?,?)').run(iid,mime,buf,me.id,Date.now());
  return ok({ok:true,url:'/img/'+iid});
 }
 if(url==='/api/profile/vote'){
  const tid=+b.id;if(!tid||tid===me.id)return bad('Нельзя');
  const v=+b.v;if(v!==1&&v!==-1&&v!==0)return bad('Голос');
  if(v===0)db.prepare('DELETE FROM profile_votes WHERE user_id=? AND target_id=?').run(me.id,tid);
  else db.prepare('INSERT OR REPLACE INTO profile_votes(user_id,target_id,v) VALUES(?,?,?)').run(me.id,tid,v);
  const likes=db.prepare('SELECT COUNT(*) c FROM profile_votes WHERE target_id=? AND v=1').get(tid).c;
  const dislikes=db.prepare('SELECT COUNT(*) c FROM profile_votes WHERE target_id=? AND v=-1').get(tid).c;
  return ok({ok:true,likes,dislikes});
 }
 if(url==='/api/profile/comment'){
  const tid=+b.id;const text=slim(b.text).slice(0,500);if(!tid||!text)return bad('Пусто');
  if(!db.prepare('SELECT id FROM users WHERE id=?').get(tid))return bad('Нет пользователя',404);
  const r=db.prepare('INSERT INTO profile_comments(target_id,user_id,text,ts) VALUES(?,?,?,?)').run(tid,me.id,text,Date.now());
  return ok({ok:true,id:Number(r.lastInsertRowid)});
 }
 if(url==='/api/profile/del_comment'){
  const id=+b.id;const c=db.prepare('SELECT * FROM profile_comments WHERE id=?').get(id);if(!c)return bad('Нет',404);
  if(c.user_id!==me.id&&c.target_id!==me.id&&!admin)return bad('Нет доступа',403);
  db.prepare('DELETE FROM profile_comments WHERE id=?').run(id);return ok({ok:true});
 }

if(!url.startsWith('/api/admin/'))return false;

 // ---- чат-модерация (админ или модератор) ----
 if(url.startsWith('/api/admin/chat/')){
  if(!mod)return bad('Нет доступа',403);
  const tgt=()=>db.prepare('SELECT id,username,is_admin FROM users WHERE id=?').get(+b.id);
  if(url==='/api/admin/chat/del'){const m=db.prepare('SELECT m.text,u.username FROM chat_msgs m LEFT JOIN users u ON u.id=m.user_id WHERE m.id=?').get(+b.id);db.prepare('DELETE FROM chat_msgs WHERE id=?').run(+b.id);if(m)modLog(me.id,'del',m.username,m.text);return ok({ok:true})}
  if(url==='/api/admin/chat/clear'){if(!admin)return bad('Только админ',403);db.exec('DELETE FROM chat_msgs');modLog(me.id,'clear','','');return ok({ok:true})}
  if(url==='/api/admin/chat/mute'){const t=tgt();if(!t||t.is_admin)return bad('Нельзя');const m=Math.min(43200,Math.max(1,+b.minutes||10));db.prepare('UPDATE users SET chat_muted_until=? WHERE id=?').run(Date.now()+m*6e4,t.id);modLog(me.id,'mute',t.username,m+' мин '+(b.reason||''));return ok({ok:true})}
  if(url==='/api/admin/chat/unmute'){const t=tgt();if(!t)return bad('Нет');db.prepare('UPDATE users SET chat_muted_until=0,chat_banned=0 WHERE id=?').run(t.id);modLog(me.id,'unmute',t.username,'');return ok({ok:true})}
  if(url==='/api/admin/chat/ban'){const t=tgt();if(!t||t.is_admin)return bad('Нельзя');db.prepare('UPDATE users SET chat_banned=1 WHERE id=?').run(t.id);modLog(me.id,'ban',t.username,b.reason||'');return ok({ok:true})}
  if(url==='/api/admin/chat/state')return ok({slow:+(get('chat_slow')||0),words:db.prepare('SELECT word FROM chat_words ORDER BY word').all().map(x=>x.word),log:db.prepare('SELECT l.*,u.username adm FROM chat_log l LEFT JOIN users u ON u.id=l.admin_id ORDER BY l.id DESC LIMIT 60').all(),muted:db.prepare("SELECT id,username,chat_muted_until,chat_banned FROM users WHERE chat_banned=1 OR chat_muted_until>?").all(Date.now())});
  if(url==='/api/admin/chat/slow'){set('chat_slow',Math.min(300,Math.max(0,+b.sec||0)));modLog(me.id,'slow',b.sec,'');return ok({ok:true})}
  if(url==='/api/admin/chat/word_add'){const w=slim(b.word).toLowerCase().slice(0,40);if(w)db.prepare('INSERT OR IGNORE INTO chat_words VALUES(?)').run(w);return ok({ok:true})}
  if(url==='/api/admin/chat/word_del'){db.prepare('DELETE FROM chat_words WHERE word=?').run(String(b.word||''));return ok({ok:true})}
  return false;
 }

 // ---- Forum / Profile (любой авторизованный) ----


 if(!admin)return false;

 // ---- FL (админ) ----

 if(url==='/api/admin/fl/give'){
  if(!admin)return bad('Только админ',403);
  const amt=Math.trunc(+b.amount);if(!amt||Math.abs(amt)>1e7)return bad('Сумма: не 0 и |сумма| ≤ 10 000 000');
  try{db.prepare('SELECT fl FROM users LIMIT 1').get()}catch(e){try{db.exec('ALTER TABLE users ADD COLUMN fl INTEGER DEFAULT 0')}catch{}}
  if(b.all){
   const users=db.prepare('SELECT id,username,fl FROM users').all();
   let n=0;
   for(const u of users){try{if(amt<0&&(u.fl||0)+amt<0)continue;flAdd(u.id,amt,amt>0?'Выдано всем (админ)':'Списано у всех (админ)');n++}catch{}}
   try{C.logAudit&&C.logAudit(me.id,'fl_give_all','',String(amt)+' x'+n)}catch{}
   return ok({ok:true,count:n,amount:amt});
  }
  const name=String(b.to||'').trim().replace(/^@/,'');
  let t=null;
  if(!name||name==='me'||name==='self')t=db.prepare('SELECT id,username,fl FROM users WHERE id=?').get(me.id);
  else t=db.prepare('SELECT id,username,fl FROM users WHERE username=? COLLATE NOCASE').get(name);
  if(!t)return bad('Пользователь не найден',404);
  if(amt<0&&(t.fl||0)+amt<0)return bad('У пользователя только '+(t.fl||0)+' FL');
  flAdd(t.id,amt,amt>0?'Выдано админом':'Списано админом');
  try{notify(t.id,(amt>0?'+':'')+amt+' FL (админ)')}catch{}
  try{C.logAudit&&C.logAudit(me.id,'fl_give',t.username,String(amt))}catch{}
  return ok({ok:true,username:t.username,fl:flBal(t.id)});
 }
 if(url==='/api/admin/fl/config'){
  const n=(v,d,mx)=>{v=Math.trunc(+v);return isNaN(v)||v<0||v>mx?d:v};const c=flCfg();
  set('fl_login_bonus',n(b.bonus,c.bonus,100000));set('fl_day_price',n(b.day_price,c.day_price,1e6));set('fl_ip_limit',b.ip_limit?1:0);
  C.logAudit(me.id,'fl_config','',JSON.stringify(flCfg()));return ok({ok:true,cfg:flCfg()});
 }
 // ---- роли ----
 if(url==='/api/admin/role'){const r=['','moderator','support'].includes(b.role)?b.role:'';db.prepare('UPDATE users SET role=? WHERE id=? AND is_admin=0').run(r,+b.id);C.logAudit(me.id,'role',b.id,r);return ok({ok:true})}
 if(url==='/api/admin/roles')return ok({list:db.prepare("SELECT id,username,role,is_admin FROM users WHERE role!='' OR is_admin=1 ORDER BY is_admin DESC,id").all()});
 // ---- дашборд ----
 if(url==='/api/admin/dash'){
  const now=Date.now(),c=(q,...p)=>db.prepare(q).get(...p).c,d1=now-DAY,d2=now-2*DAY;
  const series=[];for(let h=23;h>=0;h--){const a=now-(h+1)*36e5,e=now-h*36e5;series.push([c('SELECT COUNT(*) c FROM users WHERE created>=? AND created<?',a,e),c("SELECT COUNT(*) c FROM sub_history WHERE source!='trial' AND ts>=? AND ts<?",a,e)])}
  const total=c('SELECT COUNT(*) c FROM users'),trial=c("SELECT COUNT(DISTINCT user_id) c FROM sub_history WHERE source='trial'"),paid=c("SELECT COUNT(DISTINCT user_id) c FROM sub_history WHERE source NOT IN ('trial','admin','admin_grant','fl')");
  const refd=c('SELECT COUNT(*) c FROM users WHERE referred_by IS NOT NULL AND referred_by>0'),refp=c('SELECT COUNT(*) c FROM users WHERE ref_paid=1');
  return ok({online:Math.max(seen.size,c('SELECT COUNT(DISTINCT user_id) c FROM logins WHERE ok=1 AND ts>?',now-9e5)),regs:c('SELECT COUNT(*) c FROM users WHERE created>?',d1),regs_prev:c('SELECT COUNT(*) c FROM users WHERE created>? AND created<=?',d2,d1),acts:c("SELECT COUNT(*) c FROM sub_history WHERE source!='trial' AND ts>?",d1),
   funnel:{total,trial,paid},ref:{invited:refd,paid:refp,conv:refd?Math.round(refp/refd*1000)/10:0},series,
   promos:db.prepare('SELECT code,uses,max_uses FROM promos ORDER BY uses DESC LIMIT 8').all(),active:c('SELECT COUNT(*) c FROM users WHERE sub_until>? OR inf=1',now)});
 }
 // ---- массовые действия ----
 if(url==='/api/admin/bulk'){
  const f=b.filter||{},now=Date.now(),w=['is_admin=0'],p=[];
  if(f.q){w.push('(username LIKE ? OR email LIKE ?)');p.push('%'+f.q+'%','%'+f.q+'%')}
  if(f.sub==='active'){w.push('(sub_until>? OR inf=1)');p.push(now)}else if(f.sub==='none'){w.push('(sub_until<=? AND inf=0)');p.push(now)}else if(f.sub==='expiring'){w.push('sub_until>? AND sub_until<? AND inf=0');p.push(now,now+(+f.days||3)*DAY)}
  if(f.banned==='1')w.push('banned=1');else if(f.banned==='0')w.push('banned=0');
  const W=' WHERE '+w.join(' AND '),ids=db.prepare('SELECT id FROM users'+W+' LIMIT 5000').all(...p).map(x=>x.id);
  if(b.action==='preview')return ok({count:ids.length,sample:db.prepare('SELECT id,username,email,sub_until FROM users'+W+' LIMIT 15').all(...p)});
  if(b.action==='csv'){const rows=db.prepare('SELECT id,username,email,created,sub_until,inf,banned FROM users'+W+' LIMIT 20000').all(...p),q=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="users.csv"'});res.end('\ufeffid,username,email,created,sub_until,inf,banned\n'+rows.map(r=>[r.id,r.username,r.email,new Date(r.created).toISOString(),r.sub_until?new Date(r.sub_until).toISOString():'',r.inf,r.banned].map(q).join(',')).join('\n'));return true}
  if(b.action==='grant'){const d=Math.trunc(+b.days)||0;if(!d||Math.abs(d)>3650)return bad('Дни: от -3650 до 3650');C.tx(()=>{for(const id of ids){const t=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(t)C.addTime(t,d*DAY,'admin_grant','Массовая выдача')}});C.logAudit(me.id,'bulk_grant',ids.length,d+'d');return ok({ok:true,count:ids.length})}
  if(b.action==='notify'){const t=slim(b.text).slice(0,300);if(!t)return bad('Пустой текст');C.tx(()=>{for(const id of ids)notify(id,t)});C.logAudit(me.id,'bulk_notify',ids.length,t);return ok({ok:true,count:ids.length})}
  return bad('Неизвестное действие');
 }
 // ---- антифрод ----
 if(url==='/api/admin/fraud'){
  const out=[],push=(kind,value,rows)=>{if(rows.length>1)out.push({kind,value:String(value).slice(0,60),users:rows})};
  const U='SELECT DISTINCT u.id,u.username,u.banned FROM users u WHERE u.id IN ';
  for(const r of db.prepare("SELECT value,kind,COUNT(DISTINCT user_id) n FROM identity_signals WHERE value!='' GROUP BY kind,value HAVING n>1 ORDER BY n DESC LIMIT 30").all())push(r.kind,r.value,db.prepare(U+'(SELECT user_id FROM identity_signals WHERE kind=? AND value=?)').all(r.kind,r.value));
  for(const r of db.prepare("SELECT hwid,COUNT(DISTINCT user_id) n FROM devices GROUP BY hwid HAVING n>1 ORDER BY n DESC LIMIT 30").all())push('hwid',r.hwid,db.prepare(U+'(SELECT user_id FROM devices WHERE hwid=?)').all(r.hwid));
  for(const r of db.prepare("SELECT ip,COUNT(DISTINCT user_id) n FROM logins WHERE ok=1 AND ip!='' GROUP BY ip HAVING n>2 ORDER BY n DESC LIMIT 30").all())push('ip',r.ip,db.prepare(U+'(SELECT user_id FROM logins WHERE ok=1 AND ip=?)').all(r.ip));
  return ok({list:out.sort((a,b2)=>b2.users.length-a.users.length).slice(0,60)});
 }
 if(url==='/api/admin/fraud/user'||url==='/api/admin/fraud/banlinked'){
  const id=+b.id,t=db.prepare('SELECT id,username,suspicious,banned FROM users WHERE id=?').get(id);if(!t)return bad('Не найден',404);
  const linked=db.prepare(`SELECT DISTINCT u.id,u.username,u.banned,u.is_admin FROM users u WHERE u.id!=? AND (u.id IN (SELECT d2.user_id FROM devices d2 WHERE d2.hwid IN (SELECT hwid FROM devices WHERE user_id=?)) OR u.id IN (SELECT s2.user_id FROM identity_signals s2 WHERE s2.value IN (SELECT value FROM identity_signals WHERE user_id=?) AND s2.value!='') OR u.id IN (SELECT l2.user_id FROM logins l2 WHERE l2.ok=1 AND l2.ip IN (SELECT ip FROM logins WHERE user_id=? AND ok=1) AND l2.ip!=''))`).all(id,id,id,id);
  if(url==='/api/admin/fraud/banlinked'){const x=linked.filter(l=>!l.is_admin&&!l.banned);C.tx(()=>{for(const l of x)db.prepare("UPDATE users SET banned=1,ban_reason='Связанные аккаунты (антифрод)' WHERE id=?").run(l.id)});C.logAudit(me.id,'ban_linked',id,x.length+' acc');return ok({ok:true,count:x.length})}
  const trials=db.prepare("SELECT COUNT(*) c FROM sub_history WHERE source='trial' AND user_id IN ("+[id,...linked.map(l=>l.id)].join(',')+")").get().c,bn=linked.filter(l=>l.banned).length;
  const score=Math.min(100,linked.length*12+bn*20+(trials>1?(trials-1)*15:0)+(t.suspicious?25:0));
  return ok({user:t,linked,trials,score,level:score>=60?'высокий':score>=30?'средний':'низкий'});
 }
 // ---- FAQ / changelog / отзывы ----
 if(url==='/api/admin/content'){return ok({faq:db.prepare('SELECT * FROM faq ORDER BY id').all(),changelog:db.prepare('SELECT * FROM changelog ORDER BY ts DESC').all(),reviews:db.prepare('SELECT r.*,u.username FROM reviews r JOIN users u ON u.id=r.user_id ORDER BY r.approved,r.ts DESC LIMIT 50').all()})}
 if(url==='/api/admin/faq/add'){db.prepare('INSERT INTO faq(q,a,ts) VALUES(?,?,?)').run(String(b.q||'').slice(0,200),String(b.a||'').slice(0,2000),Date.now());return ok({ok:true})}
 if(url==='/api/admin/faq/del'){db.prepare('DELETE FROM faq WHERE id=?').run(+b.id);return ok({ok:true})}
 if(url==='/api/admin/changelog/add'){db.prepare('INSERT INTO changelog(version,title,text,ts) VALUES(?,?,?,?)').run(String(b.version||'').slice(0,40),String(b.title||'').slice(0,120),String(b.text||'').slice(0,2000),Date.now());return ok({ok:true})}
 if(url==='/api/admin/changelog/del'){db.prepare('DELETE FROM changelog WHERE id=?').run(+b.id);return ok({ok:true})}
 if(url==='/api/admin/review'){if(b.del)db.prepare('DELETE FROM reviews WHERE id=?').run(+b.id);else db.prepare('UPDATE reviews SET approved=? WHERE id=?').run(b.approve?1:0,+b.id);return ok({ok:true})}
 return false;
};

// вход с 2FA (без сессии)
api.login2fa=(b,req,res,C)=>{
 const p=pend.get(String(b.pt||''));if(!p||p.exp<Date.now())return C.send(res,400,{error:'Время ввода кода истекло, войдите заново'}),true;
 if(++p.n>5){pend.delete(b.pt);return C.send(res,429,{error:'Слишком много попыток'}),true}
 const r=row(p.uid);if(!r||!codeOk(r.totp_secret,b.code))return C.send(res,401,{error:'Неверный код 2FA'}),true;
 pend.delete(b.pt);const ip=C.reqIp(req);api.onLogin(r.id,ip);C.logLogin(r.id,ip,'web',1);
 return C.send(res,200,{ok:true},C.login(res,r.id,req)),true;
};
api.forumUpload=forum.upload;
return api;
};
