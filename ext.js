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

// ---- Кланы (расширенная система) ----
const CLAN_CREATE_COST=1500;
const CLAN_UPGRADES={
  slots:{name:'Слоты участников',desc:'+5 к максимуму участников',max:6,cost:l=>400+l*200,apply:(c,l)=>db.prepare('UPDATE clans SET max_members=? WHERE id=?').run(15+l*5,c.id)},
  bonus:{name:'Бонус FL',desc:'+% к ежедневному бонусу участников',max:5,cost:l=>500+l*300,apply:()=>{}},
  xpboost:{name:'Ускорение XP',desc:'+20% XP клана за вклады',max:5,cost:l=>350+l*250,apply:()=>{}},
  tax:{name:'Налог с заработков',desc:'% FL участников в казну (при входе)',max:5,cost:l=>200+l*150,apply:()=>{}},
  emblem:{name:'Эмблема',desc:'Кастомная эмблема клана',max:1,cost:()=>800,apply:()=>{}},
  prefix:{name:'Клановый префикс',desc:'Тег [TAG] у всех участников',max:1,cost:()=>600,apply:()=>{}}
};
db.exec(`CREATE TABLE IF NOT EXISTS clans(
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE COLLATE NOCASE,
  tag TEXT UNIQUE COLLATE NOCASE,
  descr TEXT DEFAULT '',
  color TEXT DEFAULT '#4aa8ff',
  emblem TEXT DEFAULT '',
  leader_id INTEGER NOT NULL,
  treasury INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  max_members INTEGER DEFAULT 15,
  open INTEGER DEFAULT 0,
  require_app INTEGER DEFAULT 1,
  season_pts INTEGER DEFAULT 0,
  war_wins INTEGER DEFAULT 0,
  war_losses INTEGER DEFAULT 0,
  alliance_id INTEGER DEFAULT 0,
  tax_pct INTEGER DEFAULT 0,
  inactive_days INTEGER DEFAULT 0,
  perms TEXT DEFAULT '{}',
  upgrades TEXT DEFAULT '{}',
  created INTEGER
);
CREATE TABLE IF NOT EXISTS clan_members(
  clan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member',
  joined INTEGER,
  contrib INTEGER DEFAULT 0,
  last_active INTEGER DEFAULT 0,
  quest_day TEXT DEFAULT '',
  quest_progress TEXT DEFAULT '{}',
  title TEXT DEFAULT '',
  PRIMARY KEY(clan_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS clan_members_user ON clan_members(user_id);
CREATE TABLE IF NOT EXISTS clan_invites(
  id INTEGER PRIMARY KEY,
  clan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  from_id INTEGER,
  ts INTEGER,
  UNIQUE(clan_id, user_id)
);
CREATE TABLE IF NOT EXISTS clan_apps(
  id INTEGER PRIMARY KEY,
  clan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  text TEXT DEFAULT '',
  ts INTEGER,
  UNIQUE(clan_id, user_id)
);
CREATE TABLE IF NOT EXISTS clan_log(
  id INTEGER PRIMARY KEY,
  clan_id INTEGER,
  user_id INTEGER,
  action TEXT,
  details TEXT,
  ts INTEGER
);
CREATE INDEX IF NOT EXISTS clan_log_c ON clan_log(clan_id,id);
CREATE TABLE IF NOT EXISTS clan_treasury_log(
  id INTEGER PRIMARY KEY,
  clan_id INTEGER,
  user_id INTEGER,
  delta INTEGER,
  reason TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS clan_blacklist(
  clan_id INTEGER,
  user_id INTEGER,
  by_id INTEGER,
  reason TEXT DEFAULT '',
  ts INTEGER,
  PRIMARY KEY(clan_id, user_id)
);
CREATE TABLE IF NOT EXISTS clan_wars(
  id INTEGER PRIMARY KEY,
  a_id INTEGER,
  b_id INTEGER,
  status TEXT DEFAULT 'pending',
  a_pts INTEGER DEFAULT 0,
  b_pts INTEGER DEFAULT 0,
  started INTEGER,
  ends INTEGER,
  winner_id INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS clan_alliances(
  id INTEGER PRIMARY KEY,
  name TEXT,
  tag TEXT,
  created INTEGER
);
CREATE TABLE IF NOT EXISTS clan_alliance_members(
  alliance_id INTEGER,
  clan_id INTEGER UNIQUE,
  joined INTEGER,
  PRIMARY KEY(alliance_id, clan_id)
);
CREATE TABLE IF NOT EXISTS clan_achievements(
  clan_id INTEGER,
  ach_id TEXT,
  ts INTEGER,
  PRIMARY KEY(clan_id, ach_id)
);
CREATE TABLE IF NOT EXISTS clan_quests_done(
  clan_id INTEGER,
  user_id INTEGER,
  quest_id TEXT,
  day TEXT,
  PRIMARY KEY(clan_id, user_id, quest_id, day)
);`);
// soft migrations for old DBs
for(const s of [
  "ALTER TABLE clans ADD COLUMN require_app INTEGER DEFAULT 1",
  "ALTER TABLE clans ADD COLUMN season_pts INTEGER DEFAULT 0",
  "ALTER TABLE clans ADD COLUMN war_wins INTEGER DEFAULT 0",
  "ALTER TABLE clans ADD COLUMN war_losses INTEGER DEFAULT 0",
  "ALTER TABLE clans ADD COLUMN alliance_id INTEGER DEFAULT 0",
  "ALTER TABLE clans ADD COLUMN tax_pct INTEGER DEFAULT 0",
  "ALTER TABLE clans ADD COLUMN inactive_days INTEGER DEFAULT 0",
  "ALTER TABLE clans ADD COLUMN perms TEXT DEFAULT '{}'",
  "ALTER TABLE clans ADD COLUMN upgrades TEXT DEFAULT '{}'",
  "ALTER TABLE clan_members ADD COLUMN last_active INTEGER DEFAULT 0",
  "ALTER TABLE clan_members ADD COLUMN quest_day TEXT DEFAULT ''",
  "ALTER TABLE clan_members ADD COLUMN quest_progress TEXT DEFAULT '{}'",
  "ALTER TABLE clan_members ADD COLUMN title TEXT DEFAULT ''"
])try{db.exec(s)}catch{}

const clanGet=id=>db.prepare('SELECT * FROM clans WHERE id=?').get(id);
const clanOf=uid=>{const m=db.prepare('SELECT * FROM clan_members WHERE user_id=?').get(uid);return m?{...m,clan:clanGet(m.clan_id)}:null};
const clanMemberCount=cid=>(db.prepare('SELECT COUNT(*) c FROM clan_members WHERE clan_id=?').get(cid)||{}).c||0;
const clanLog=(cid,uid,action,details)=>db.prepare('INSERT INTO clan_log(clan_id,user_id,action,details,ts) VALUES(?,?,?,?,?)').run(cid,uid,String(action).slice(0,40),String(details||'').slice(0,200),Date.now());
const clanTLog=(cid,uid,delta,reason)=>db.prepare('INSERT INTO clan_treasury_log(clan_id,user_id,delta,reason,ts) VALUES(?,?,?,?,?)').run(cid,uid,delta,String(reason).slice(0,120),Date.now());
const clanLevelMax=lv=>Math.min(50,10+lv*5);
const clanNeedXp=lv=>lv*lv*100;
const clanParse=(s,d)=>{try{return JSON.parse(s||'')||d}catch{return d}};
const clanUpgrades=c=>clanParse(c.upgrades,{});
const clanPerms=c=>{
  const d={invite:1,kick:1,apps:1,treasury:0,settings:0,war:0};
  return Object.assign(d,clanParse(c.perms,{}));
};
const clanCan=(m,perm)=>{
  if(!m||!m.clan)return false;
  if(m.role==='leader')return true;
  if(m.role!=='officer')return false;
  return !!clanPerms(m.clan)[perm];
};
const clanAddXp=(cid,n)=>{
  const c=clanGet(cid);if(!c||!n)return;
  const ups=clanUpgrades(c);
  if(ups.xpboost)n=Math.floor(n*(1+0.2*(ups.xpboost||0)));
  let xp=(c.xp||0)+n,lv=c.level||1,maxm=c.max_members||15;
  const baseSlots=15+(ups.slots||0)*5;
  while(xp>=clanNeedXp(lv)&&lv<20){xp-=clanNeedXp(lv);lv++;maxm=Math.max(baseSlots,clanLevelMax(lv))}
  maxm=Math.max(maxm,baseSlots);
  db.prepare('UPDATE clans SET xp=?,level=?,max_members=?,season_pts=season_pts+? WHERE id=?').run(xp,lv,maxm,n,cid);
  // achievements
  try{
    if(lv>=5)db.prepare('INSERT OR IGNORE INTO clan_achievements(clan_id,ach_id,ts) VALUES(?,?,?)').run(cid,'lvl5',Date.now());
    if(lv>=10)db.prepare('INSERT OR IGNORE INTO clan_achievements(clan_id,ach_id,ts) VALUES(?,?,?)').run(cid,'lvl10',Date.now());
    if((c.treasury||0)>=10000)db.prepare('INSERT OR IGNORE INTO clan_achievements(clan_id,ach_id,ts) VALUES(?,?,?)').run(cid,'rich',Date.now());
  }catch{}
};
const clanTouch=(cid,uid)=>db.prepare('UPDATE clan_members SET last_active=? WHERE clan_id=? AND user_id=?').run(Date.now(),cid,uid);
const CLAN_QUESTS=[
  {id:'chat10',name:'Общительный',desc:'10 сообщений в чате',goal:10,xp:30,fl:5},
  {id:'deposit50',name:'Меценат',desc:'Вложить 50 FL в казну',goal:50,xp:40,fl:0},
  {id:'forum3',name:'Форумчанин',desc:'3 сообщения на форуме',goal:3,xp:25,fl:5},
  {id:'login',name:'Присутствие',desc:'Зайти на сайт',goal:1,xp:15,fl:2}
];
const clanDay=()=>new Date().toISOString().slice(0,10);
const clanQuestProg=(m)=>{
  const day=clanDay();
  if(m.quest_day!==day)return {};
  return clanParse(m.quest_progress,{});
};
const clanQuestInc=(uid,qid,add=1)=>{
  const m=db.prepare('SELECT * FROM clan_members WHERE user_id=?').get(uid);if(!m)return;
  const day=clanDay();
  let prog=m.quest_day===day?clanParse(m.quest_progress,{}):{};
  prog[qid]=(prog[qid]||0)+add;
  db.prepare('UPDATE clan_members SET quest_day=?,quest_progress=?,last_active=? WHERE user_id=?').run(day,JSON.stringify(prog),Date.now(),uid);
  const q=CLAN_QUESTS.find(x=>x.id===qid);if(!q)return;
  if(prog[qid]>=q.goal&&!db.prepare('SELECT 1 FROM clan_quests_done WHERE clan_id=? AND user_id=? AND quest_id=? AND day=?').get(m.clan_id,uid,qid,day)){
    db.prepare('INSERT OR IGNORE INTO clan_quests_done(clan_id,user_id,quest_id,day) VALUES(?,?,?,?)').run(m.clan_id,uid,qid,day);
    clanAddXp(m.clan_id,q.xp);
    if(q.fl>0){flAdd(uid,q.fl,'Квест клана: '+q.name);notify(uid,'Квест «'+q.name+'»: +'+q.xp+' XP клану'+(q.fl?' · +'+q.fl+' FL':''))}
    else notify(uid,'Квест «'+q.name+'» выполнен: +'+q.xp+' XP клану');
  }
};
// hook login bonus tax into flBonus later via onLogin — tax applied when depositing is enough for now
const clanTagOf=uid=>{const m=clanOf(uid);if(!m||!m.clan)return null;const ups=clanUpgrades(m.clan);if(!ups.prefix&&m.role!=='leader')return null;return {tag:m.clan.tag,color:m.clan.color,name:m.clan.name,role:m.role}};

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
 let b=flCfg().bonus;if(b<=0)return;const now=Date.now(),u=db.prepare('SELECT fl_bonus_ts t FROM users WHERE id=?').get(uid);if(!u||now-(u.t||0)<DAY)return;
 if(flCfg().ip_limit&&ip&&db.prepare('SELECT 1 FROM fl_bonus_ip WHERE ip=? AND user_id!=? AND ts>? LIMIT 1').get(ip,uid,now-DAY))return;
 // clan FL bonus upgrade
 try{const cm=clanOf(uid);if(cm&&cm.clan){const ups=clanUpgrades(cm.clan);if(ups.bonus)b=Math.floor(b*(1+0.1*ups.bonus));
  // tax
  const tax=Math.min(20,cm.clan.tax_pct||0);if(tax>0){const cut=Math.floor(b*tax/100);if(cut>0){b-=cut;db.prepare('UPDATE clans SET treasury=treasury+? WHERE id=?').run(cut,cm.clan_id);clanTLog(cm.clan_id,uid,cut,'Налог с бонуса')}}
  clanTouch(cm.clan_id,uid);clanQuestInc(uid,'login',1);
 }}catch{}
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
  // clan channel access
  if((ch.kind==='clan'||String(channel).startsWith('clan_'))&&!mod){
    const cid=+String(channel).replace('clan_','');
    if(!db.prepare('SELECT 1 FROM clan_members WHERE clan_id=? AND user_id=?').get(cid,u.id))
      return C.send(res,403,{error:'Клан-чат только для участников'},NOCACHE),true;
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
  const mapped=rows.map(r=>{
    let ctag=null;try{ctag=clanTagOf(r.uid)}catch{}
    return {id:r.id,uid:r.uid,text:r.text,ts:r.ts,channel:r.channel||'general',atts:parseAtts(r.atts),
    username:r.username||'удалён',avatar:r.avatar||'',is_admin:!!r.is_admin,role:r.role||'',color:flHex(r.nick_color),badge:flBadgeId(r.badge),prefix:r.prefix||'',pcolor:flPx(r.prefix_color),
    clan_tag:ctag?ctag.tag:'',clan_color:ctag?ctag.color:'',
    to:r.to_user?r.to_name:'',reply:r.reply_to&&r.runame?{id:r.reply_to,username:r.runame,text:String(r.rtext||'').slice(0,80)}:null,
    reactions:reactMap[r.id]||[]}});
  const me=row(u.id);
  let channels=db.prepare('SELECT id,name,descr,kind,sort FROM chat_channels ORDER BY sort,id').all();
  // inject own clan channel if missing from list visibility
  try{const cm=clanOf(u.id);if(cm&&cm.clan){const cid='clan_'+cm.clan_id;if(!channels.some(x=>x.id===cid))channels=channels.concat([{id:cid,name:'Клан ['+cm.clan.tag+']',descr:'Приватный чат',kind:'clan',sort:50}])}}catch{}
  // hide other clan channels
  channels=channels.filter(ch=>{
    if(ch.kind!=='clan'&&!String(ch.id).startsWith('clan_'))return true;
    if(mod)return true;
    const cid=+String(ch.id).replace('clan_','');
    return !!db.prepare('SELECT 1 FROM clan_members WHERE clan_id=? AND user_id=?').get(cid,u.id);
  });
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
   let clanInfo=null;try{const cm=clanOf(t.id);if(cm&&cm.clan)clanInfo={id:cm.clan.id,name:cm.clan.name,tag:cm.clan.tag,color:cm.clan.color,role:cm.role}}catch{}
   return C.send(res,200,{user:{id:t.id,username:t.username,avatar:t.avatar||'',banner:t.banner||'',bio:t.bio||'',created:t.created,is_admin:!!t.is_admin,is_super:!!t.is_super,role:t.role||'',color:flHex(t.nick_color),badge:flBadgeId(t.badge),prefix:t.prefix||'',pcolor:flPx(t.prefix_color),fl:t.fl||0,clan:clanInfo},likes,dislikes,myVote:my?my.v:0,comments,me:u.id}),true;
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
  if((ch.kind==='clan'||String(channel).startsWith('clan_'))&&!mod){
    const cid=+String(channel).replace('clan_','');
    if(!db.prepare('SELECT 1 FROM clan_members WHERE clan_id=? AND user_id=?').get(cid,me.id))return bad('Клан-чат только для участников',403);
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
  try{clanQuestInc(me.id,'chat10',1)}catch{}
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

// ---- Кланы ----
if(url==='/api/clans/list'){
 const q=String(b.q||'').trim().toLowerCase();
 const sort=String(b.sort||'level');
 const order=sort==='season'?'c.season_pts DESC,c.level DESC':sort==='treasury'?'c.treasury DESC':sort==='members'?'members DESC':'c.level DESC,c.xp DESC,members DESC';
 let sql=`SELECT c.id,c.name,c.tag,c.color,c.emblem,c.level,c.xp,c.treasury,c.max_members,c.open,c.require_app,c.season_pts,c.war_wins,c.war_losses,c.created,
   (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id=c.id) members,
   u.username leader
   FROM clans c LEFT JOIN users u ON u.id=c.leader_id`;
 const params=[];
 if(q){sql+=' WHERE lower(c.name) LIKE ? OR lower(c.tag) LIKE ?';params.push('%'+q+'%','%'+q+'%')}
 sql+=' ORDER BY '+order+' LIMIT 50';
 const list=db.prepare(sql).all(...params);
 return ok({list,create_cost:CLAN_CREATE_COST,upgrades:Object.fromEntries(Object.entries(CLAN_UPGRADES).map(([k,v])=>[k,{name:v.name,desc:v.desc,max:v.max}]))});
}
if(url==='/api/clans/mine'){
 clanQuestInc(me.id,'login',1);
 const m=clanOf(me.id);
 if(!m||!m.clan){
  const inv=db.prepare(`SELECT i.id,i.clan_id,i.ts,c.name,c.tag,c.color,u.username from_name
   FROM clan_invites i JOIN clans c ON c.id=i.clan_id LEFT JOIN users u ON u.id=i.from_id
   WHERE i.user_id=? ORDER BY i.ts DESC LIMIT 20`).all(me.id);
  const apps=db.prepare(`SELECT a.id,a.clan_id,a.ts,a.text,c.name,c.tag,c.color FROM clan_apps a JOIN clans c ON c.id=a.clan_id WHERE a.user_id=? ORDER BY a.ts DESC LIMIT 20`).all(me.id);
  return ok({clan:null,invites:inv,my_apps:apps,create_cost:CLAN_CREATE_COST,fl:flBal(me.id),quests:CLAN_QUESTS});
 }
 const c=m.clan;
 clanTouch(c.id,me.id);
 const members=db.prepare(`SELECT cm.user_id id,cm.role,cm.joined,cm.contrib,cm.last_active,cm.title,u.username,u.avatar,u.nick_color,u.badge,u.fl
   FROM clan_members cm JOIN users u ON u.id=cm.user_id WHERE cm.clan_id=? ORDER BY
   CASE cm.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, cm.joined`).all(c.id);
 const log=db.prepare(`SELECT l.action,l.details,l.ts,u.username FROM clan_log l LEFT JOIN users u ON u.id=l.user_id
   WHERE l.clan_id=? ORDER BY l.id DESC LIMIT 25`).all(c.id);
 const tlog=db.prepare(`SELECT t.delta,t.reason,t.ts,u.username FROM clan_treasury_log t LEFT JOIN users u ON u.id=t.user_id
   WHERE t.clan_id=? ORDER BY t.id DESC LIMIT 20`).all(c.id);
 const invOut=db.prepare(`SELECT i.id,i.user_id,i.ts,u.username FROM clan_invites i JOIN users u ON u.id=i.user_id WHERE i.clan_id=? ORDER BY i.ts DESC LIMIT 30`).all(c.id);
 const appsIn=db.prepare(`SELECT a.id,a.user_id,a.text,a.ts,u.username FROM clan_apps a JOIN users u ON u.id=a.user_id WHERE a.clan_id=? ORDER BY a.ts DESC LIMIT 30`).all(c.id);
 const ach=db.prepare('SELECT ach_id id,ts FROM clan_achievements WHERE clan_id=?').all(c.id);
 const ups=clanUpgrades(c);
 const prog=clanQuestProg(m);
 const day=clanDay();
 const quests=CLAN_QUESTS.map(q=>({...q,progress:prog[q.id]||0,done:!!db.prepare('SELECT 1 FROM clan_quests_done WHERE clan_id=? AND user_id=? AND quest_id=? AND day=?').get(c.id,me.id,q.id,day)}));
 // active war
 let war=null;
 try{war=db.prepare(`SELECT w.*,ca.name a_name,ca.tag a_tag,cb.name b_name,cb.tag b_tag FROM clan_wars w
   LEFT JOIN clans ca ON ca.id=w.a_id LEFT JOIN clans cb ON cb.id=w.b_id
   WHERE (w.a_id=? OR w.b_id=?) AND w.status IN ('pending','active') ORDER BY w.id DESC LIMIT 1`).get(c.id,c.id)}catch{}
 let alliance=null;
 if(c.alliance_id){try{alliance=db.prepare('SELECT id,name,tag FROM clan_alliances WHERE id=?').get(c.alliance_id)}catch{}}
 return ok({clan:{id:c.id,name:c.name,tag:c.tag,descr:c.descr,color:c.color,emblem:c.emblem,leader_id:c.leader_id,
   treasury:c.treasury,level:c.level,xp:c.xp,xp_next:clanNeedXp(c.level),max_members:c.max_members,open:!!c.open,require_app:!!c.require_app,
   season_pts:c.season_pts||0,war_wins:c.war_wins||0,war_losses:c.war_losses||0,tax_pct:c.tax_pct||0,inactive_days:c.inactive_days||0,
   upgrades:ups,perms:clanPerms(c),created:c.created,members:members.length},
  role:m.role,contrib:m.contrib||0,title:m.title||'',members,log,tlog,invites_out:invOut,apps:appsIn,achievements:ach,
  quests,war,alliance,create_cost:CLAN_CREATE_COST,fl:flBal(me.id),
  can:{invite:clanCan(m,'invite'),kick:clanCan(m,'kick'),apps:clanCan(m,'apps'),treasury:clanCan(m,'treasury'),settings:clanCan(m,'settings'),war:clanCan(m,'war')}});
}
if(url==='/api/clans/view'){
 const id=+b.id||0;const c=clanGet(id);if(!c)return bad('Клан не найден',404);
 const members=db.prepare(`SELECT cm.role,cm.joined,cm.contrib,cm.title,u.username,u.avatar,u.nick_color,u.badge
   FROM clan_members cm JOIN users u ON u.id=cm.user_id WHERE cm.clan_id=? ORDER BY
   CASE cm.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, cm.joined`).all(c.id);
 const leader=(db.prepare('SELECT username FROM users WHERE id=?').get(c.leader_id)||{}).username||'?';
 const ach=db.prepare('SELECT ach_id id,ts FROM clan_achievements WHERE clan_id=?').all(c.id);
 return ok({clan:{id:c.id,name:c.name,tag:c.tag,descr:c.descr,color:c.color,emblem:c.emblem,level:c.level,xp:c.xp,treasury:c.treasury,
   max_members:c.max_members,open:!!c.open,require_app:!!c.require_app,season_pts:c.season_pts||0,war_wins:c.war_wins||0,war_losses:c.war_losses||0,
   created:c.created,leader,members:members.length,upgrades:clanUpgrades(c)},members,achievements:ach});
}
if(url==='/api/clans/create'){
 if(clanOf(me.id))return bad('Вы уже состоите в клане');
 const name=String(b.name||'').trim().slice(0,24);
 const tag=String(b.tag||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
 const descr=String(b.descr||'').trim().slice(0,300);
 const color=/^#[0-9a-fA-F]{6}$/.test(String(b.color||''))?String(b.color):'#4aa8ff';
 if(name.length<3)return bad('Название: минимум 3 символа');
 if(tag.length<2)return bad('Тег: 2–5 символов (A–Z, 0–9)');
 if(db.prepare('SELECT 1 FROM clans WHERE name=? OR tag=?').get(name,tag))return bad('Название или тег уже заняты');
 if(flBal(me.id)<CLAN_CREATE_COST)return bad('Нужно '+CLAN_CREATE_COST+' FL для создания клана');
 let cid;
 try{C.tx(()=>{
  if(!flSpend(me.id,CLAN_CREATE_COST,'Создание клана ['+tag+']'))throw new Error('FLBAL');
  const r=db.prepare('INSERT INTO clans(name,tag,descr,color,leader_id,created,require_app) VALUES(?,?,?,?,?,?,1)').run(name,tag,descr,color,me.id,Date.now());
  cid=r.lastInsertRowid;
  db.prepare('INSERT INTO clan_members(clan_id,user_id,role,joined,last_active) VALUES(?,?,?,?,?)').run(cid,me.id,'leader',Date.now(),Date.now());
  clanLog(cid,me.id,'create',name+' ['+tag+']');
  db.prepare('INSERT OR IGNORE INTO clan_achievements(clan_id,ach_id,ts) VALUES(?,?,?)').run(cid,'founded',Date.now());
 })}catch(e){if(e&&e.message==='FLBAL')return bad('Недостаточно FL: нужно '+CLAN_CREATE_COST);throw e}
 // create clan chat channel
 try{db.prepare("INSERT OR IGNORE INTO chat_channels(id,name,descr,kind,sort) VALUES(?,?,?,?,?)").run('clan_'+cid,'Клан ['+tag+']','Приватный чат клана','clan',50)}catch{}
 notify(me.id,'Клан «'+name+'» ['+tag+'] создан! −'+CLAN_CREATE_COST+' FL');
 return ok({ok:true,id:cid,fl:flBal(me.id)});
}
if(url==='/api/clans/join'){
 if(clanOf(me.id))return bad('Вы уже в клане');
 const id=+b.id||0;const c=clanGet(id);if(!c)return bad('Клан не найден');
 if(db.prepare('SELECT 1 FROM clan_blacklist WHERE clan_id=? AND user_id=?').get(c.id,me.id))return bad('Вы в чёрном списке этого клана');
 const cnt=clanMemberCount(c.id);
 if(cnt>=(c.max_members||15))return bad('Клан заполнен');
 const inv=db.prepare('SELECT id FROM clan_invites WHERE clan_id=? AND user_id=?').get(c.id,me.id);
 if(inv){
  db.prepare('INSERT INTO clan_members(clan_id,user_id,role,joined,last_active) VALUES(?,?,?,?,?)').run(c.id,me.id,'member',Date.now(),Date.now());
  db.prepare('DELETE FROM clan_invites WHERE clan_id=? AND user_id=?').run(c.id,me.id);
  db.prepare('DELETE FROM clan_invites WHERE user_id=?').run(me.id);
  db.prepare('DELETE FROM clan_apps WHERE user_id=?').run(me.id);
  clanLog(c.id,me.id,'join','по приглашению');clanAddXp(c.id,10);
  notify(c.leader_id,me.username+' вступил в клан ['+c.tag+']');
  return ok({ok:true});
 }
 if(c.require_app||!c.open){
  const text=String(b.text||'').trim().slice(0,200);
  if(db.prepare('SELECT 1 FROM clan_apps WHERE clan_id=? AND user_id=?').get(c.id,me.id))return bad('Заявка уже подана');
  db.prepare('INSERT INTO clan_apps(clan_id,user_id,text,ts) VALUES(?,?,?,?)').run(c.id,me.id,text,Date.now());
  notify(c.leader_id,'Заявка в клан ['+c.tag+'] от '+me.username);
  return ok({ok:true,applied:true});
 }
 db.prepare('INSERT INTO clan_members(clan_id,user_id,role,joined,last_active) VALUES(?,?,?,?,?)').run(c.id,me.id,'member',Date.now(),Date.now());
 db.prepare('DELETE FROM clan_invites WHERE user_id=?').run(me.id);
 db.prepare('DELETE FROM clan_apps WHERE user_id=?').run(me.id);
 clanLog(c.id,me.id,'join','');clanAddXp(c.id,10);
 notify(c.leader_id,me.username+' вступил в клан ['+c.tag+']');
 return ok({ok:true});
}
if(url==='/api/clans/app_action'){
 const m=clanOf(me.id);if(!m||!m.clan||!clanCan(m,'apps'))return bad('Нет прав');
 const app=db.prepare('SELECT * FROM clan_apps WHERE id=? AND clan_id=?').get(+b.id,m.clan_id);if(!app)return bad('Заявка не найдена');
 if(b.accept){
  if(clanOf(app.user_id)){db.prepare('DELETE FROM clan_apps WHERE id=?').run(app.id);return bad('Игрок уже в клане')}
  if(clanMemberCount(m.clan_id)>=(m.clan.max_members||15))return bad('Клан заполнен');
  if(db.prepare('SELECT 1 FROM clan_blacklist WHERE clan_id=? AND user_id=?').get(m.clan_id,app.user_id))return bad('В чёрном списке');
  db.prepare('INSERT INTO clan_members(clan_id,user_id,role,joined,last_active) VALUES(?,?,?,?,?)').run(m.clan_id,app.user_id,'member',Date.now(),Date.now());
  db.prepare('DELETE FROM clan_apps WHERE user_id=?').run(app.user_id);
  db.prepare('DELETE FROM clan_invites WHERE user_id=?').run(app.user_id);
  const uname=(db.prepare('SELECT username FROM users WHERE id=?').get(app.user_id)||{}).username||'?';
  clanLog(m.clan_id,me.id,'accept',uname);clanAddXp(m.clan_id,10);
  notify(app.user_id,'Вас приняли в клан ['+m.clan.tag+']');
 }else{
  db.prepare('DELETE FROM clan_apps WHERE id=?').run(app.id);
  notify(app.user_id,'Заявка в клан ['+m.clan.tag+'] отклонена');
 }
 return ok({ok:true});
}
if(url==='/api/clans/leave'){
 const m=clanOf(me.id);if(!m||!m.clan)return bad('Вы не в клане');
 if(m.role==='leader')return bad('Лидер не может выйти — передайте лидерство или распустите клан');
 db.prepare('DELETE FROM clan_members WHERE clan_id=? AND user_id=?').run(m.clan_id,me.id);
 clanLog(m.clan_id,me.id,'leave','');
 return ok({ok:true});
}
if(url==='/api/clans/invite'){
 const m=clanOf(me.id);if(!m||!m.clan||!clanCan(m,'invite'))return bad('Нет прав приглашать');
 const name=String(b.to||'').trim().replace(/^@/,'');
 const t=db.prepare('SELECT id,username,banned FROM users WHERE username=?').get(name);
 if(!t||t.banned)return bad('Пользователь не найден');
 if(clanOf(t.id))return bad('Игрок уже в клане');
 if(db.prepare('SELECT 1 FROM clan_blacklist WHERE clan_id=? AND user_id=?').get(m.clan_id,t.id))return bad('Игрок в чёрном списке');
 if(db.prepare('SELECT 1 FROM clan_invites WHERE clan_id=? AND user_id=?').get(m.clan_id,t.id))return bad('Уже приглашён');
 if(clanMemberCount(m.clan_id)>=(m.clan.max_members||15))return bad('Клан заполнен');
 db.prepare('INSERT OR REPLACE INTO clan_invites(clan_id,user_id,from_id,ts) VALUES(?,?,?,?)').run(m.clan_id,t.id,me.id,Date.now());
 clanLog(m.clan_id,me.id,'invite',t.username);
 notify(t.id,'Вас пригласили в клан «'+m.clan.name+'» ['+m.clan.tag+'] от '+me.username);
 return ok({ok:true});
}
if(url==='/api/clans/kick'){
 const m=clanOf(me.id);if(!m||!m.clan||!clanCan(m,'kick'))return bad('Нет прав');
 const tid=+b.user_id||0;
 const tm=db.prepare('SELECT * FROM clan_members WHERE clan_id=? AND user_id=?').get(m.clan_id,tid);
 if(!tm)return bad('Не в клане');
 if(tm.role==='leader')return bad('Нельзя кикнуть лидера');
 if(m.role==='officer'&&tm.role==='officer')return bad('Офицер не может кикнуть офицера');
 const uname=(db.prepare('SELECT username FROM users WHERE id=?').get(tid)||{}).username||'?';
 db.prepare('DELETE FROM clan_members WHERE clan_id=? AND user_id=?').run(m.clan_id,tid);
 clanLog(m.clan_id,me.id,'kick',uname);
 notify(tid,'Вас исключили из клана ['+m.clan.tag+']');
 return ok({ok:true});
}
if(url==='/api/clans/role'){
 const m=clanOf(me.id);if(!m||!m.clan||m.role!=='leader')return bad('Только лидер');
 const tid=+b.user_id||0,role=String(b.role||'');
 if(role!=='officer'&&role!=='member')return bad('Роль: officer или member');
 const tm=db.prepare('SELECT * FROM clan_members WHERE clan_id=? AND user_id=?').get(m.clan_id,tid);
 if(!tm||tm.role==='leader')return bad('Нельзя');
 db.prepare('UPDATE clan_members SET role=? WHERE clan_id=? AND user_id=?').run(role,m.clan_id,tid);
 const uname=(db.prepare('SELECT username FROM users WHERE id=?').get(tid)||{}).username||'?';
 clanLog(m.clan_id,me.id,'role',uname+' → '+role);
 notify(tid,'Вам выдана роль «'+(role==='officer'?'Офицер':'Участник')+'» в клане ['+m.clan.tag+']');
 return ok({ok:true});
}
if(url==='/api/clans/transfer'){
 const m=clanOf(me.id);if(!m||!m.clan||m.role!=='leader')return bad('Только лидер');
 const tid=+b.user_id||0;
 const tm=db.prepare('SELECT * FROM clan_members WHERE clan_id=? AND user_id=?').get(m.clan_id,tid);
 if(!tm)return bad('Игрок не в клане');
 C.tx(()=>{
  db.prepare('UPDATE clan_members SET role=? WHERE clan_id=? AND user_id=?').run('member',m.clan_id,me.id);
  db.prepare('UPDATE clan_members SET role=? WHERE clan_id=? AND user_id=?').run('leader',m.clan_id,tid);
  db.prepare('UPDATE clans SET leader_id=? WHERE id=?').run(tid,m.clan_id);
 });
 const uname=(db.prepare('SELECT username FROM users WHERE id=?').get(tid)||{}).username||'?';
 clanLog(m.clan_id,me.id,'transfer',uname);
 notify(tid,'Вы стали лидером клана ['+m.clan.tag+']');
 return ok({ok:true});
}
if(url==='/api/clans/deposit'){
 const m=clanOf(me.id);if(!m||!m.clan)return bad('Вы не в клане');
 const amt=Math.trunc(+b.amount);
 if(!(amt>=1&&amt<=1e6))return bad('Сумма: от 1 до 1 000 000');
 try{C.tx(()=>{
  if(!flSpend(me.id,amt,'Вклад в казну клана ['+m.clan.tag+']'))throw new Error('FLBAL');
  db.prepare('UPDATE clans SET treasury=treasury+? WHERE id=?').run(amt,m.clan_id);
  db.prepare('UPDATE clan_members SET contrib=contrib+? WHERE clan_id=? AND user_id=?').run(amt,m.clan_id,me.id);
  clanTLog(m.clan_id,me.id,amt,'Вклад');
  clanLog(m.clan_id,me.id,'deposit','+'+amt+' FL');
  clanAddXp(m.clan_id,Math.floor(amt/10));
  clanQuestInc(me.id,'deposit50',amt);
 })}catch(e){if(e&&e.message==='FLBAL')return bad('Недостаточно FL');throw e}
 return ok({ok:true,fl:flBal(me.id),treasury:(clanGet(m.clan_id)||{}).treasury||0});
}
if(url==='/api/clans/withdraw'){
 const m=clanOf(me.id);if(!m||!m.clan||!clanCan(m,'treasury'))return bad('Нет прав на казну');
 const amt=Math.trunc(+b.amount);
 if(!(amt>=1&&amt<=1e6))return bad('Сумма: от 1');
 const c=clanGet(m.clan_id);if((c.treasury||0)<amt)return bad('В казне недостаточно FL');
 const toId=b.to_user?+b.to_user:me.id;
 const tu=db.prepare('SELECT id,username FROM users WHERE id=?').get(toId);if(!tu)return bad('Пользователь не найден');
 if(!db.prepare('SELECT 1 FROM clan_members WHERE clan_id=? AND user_id=?').get(m.clan_id,toId))return bad('Получатель не в клане');
 C.tx(()=>{
  const r=db.prepare('UPDATE clans SET treasury=treasury-? WHERE id=? AND treasury>=?').run(amt,m.clan_id,amt);
  if(!r.changes)throw new Error('NOFUNDS');
  flAdd(toId,amt,'Из казны клана ['+m.clan.tag+']');
  clanTLog(m.clan_id,me.id,-amt,'Выдача → '+tu.username);
  clanLog(m.clan_id,me.id,'withdraw',amt+' → '+tu.username);
 });
 if(toId!==me.id)notify(toId,'+'+amt+' FL из казны клана ['+m.clan.tag+']');
 return ok({ok:true,treasury:(clanGet(m.clan_id)||{}).treasury||0});
}
if(url==='/api/clans/upgrade'){
 const m=clanOf(me.id);if(!m||!m.clan||m.role!=='leader')return bad('Только лидер');
 const key=String(b.key||'');
 const def=CLAN_UPGRADES[key];if(!def)return bad('Неизвестный апгрейд');
 const ups=clanUpgrades(m.clan);
 const cur=ups[key]||0;
 if(cur>=def.max)return bad('Максимальный уровень');
 const cost=def.cost(cur);
 if((m.clan.treasury||0)<cost)return bad('Нужно '+cost+' FL в казне');
 C.tx(()=>{
  const r=db.prepare('UPDATE clans SET treasury=treasury-? WHERE id=? AND treasury>=?').run(cost,m.clan_id,cost);
  if(!r.changes)throw new Error('NOFUNDS');
  ups[key]=cur+1;
  db.prepare('UPDATE clans SET upgrades=? WHERE id=?').run(JSON.stringify(ups),m.clan_id);
  def.apply(clanGet(m.clan_id),ups[key]);
  clanTLog(m.clan_id,me.id,-cost,'Апгрейд: '+def.name+' ур.'+ups[key]);
  clanLog(m.clan_id,me.id,'upgrade',def.name+' → '+ups[key]);
 });
 return ok({ok:true,upgrades:clanUpgrades(clanGet(m.clan_id)),treasury:(clanGet(m.clan_id)||{}).treasury||0});
}
if(url==='/api/clans/settings'){
 const m=clanOf(me.id);if(!m||!m.clan||(m.role!=='leader'&&!clanCan(m,'settings')))return bad('Нет прав');
 const c=m.clan;
 const descr=b.descr!==undefined?String(b.descr).trim().slice(0,300):c.descr;
 const color=/^#[0-9a-fA-F]{6}$/.test(String(b.color||''))?String(b.color):c.color;
 const open=b.open!==undefined?(b.open?1:0):c.open;
 const require_app=b.require_app!==undefined?(b.require_app?1:0):c.require_app;
 const tax_pct=b.tax_pct!==undefined?Math.min(20,Math.max(0,+b.tax_pct|0)):c.tax_pct;
 const inactive_days=b.inactive_days!==undefined?Math.min(90,Math.max(0,+b.inactive_days|0)):c.inactive_days;
 const emblem=b.emblem!==undefined?String(b.emblem).slice(0,500):c.emblem;
 let perms=c.perms;
 if(b.perms&&m.role==='leader'){const p=clanPerms(c);for(const k of Object.keys(p))if(b.perms[k]!==undefined)p[k]=b.perms[k]?1:0;perms=JSON.stringify(p)}
 db.prepare('UPDATE clans SET descr=?,color=?,open=?,require_app=?,tax_pct=?,inactive_days=?,emblem=?,perms=? WHERE id=?')
  .run(descr,color,open,require_app,tax_pct,inactive_days,emblem,typeof perms==='string'?perms:JSON.stringify(perms),m.clan_id);
 clanLog(m.clan_id,me.id,'settings','');
 return ok({ok:true});
}
if(url==='/api/clans/blacklist'){
 const m=clanOf(me.id);if(!m||!m.clan||m.role!=='leader')return bad('Только лидер');
 if(b.list)return ok({list:db.prepare(`SELECT b.user_id id,b.reason,b.ts,u.username FROM clan_blacklist b JOIN users u ON u.id=b.user_id WHERE b.clan_id=? ORDER BY b.ts DESC`).all(m.clan_id)});
 if(b.remove){db.prepare('DELETE FROM clan_blacklist WHERE clan_id=? AND user_id=?').run(m.clan_id,+b.user_id);return ok({ok:true})}
 const name=String(b.username||'').trim().replace(/^@/,'');
 const t=db.prepare('SELECT id,username FROM users WHERE username=?').get(name);if(!t)return bad('Не найден');
 db.prepare('INSERT OR REPLACE INTO clan_blacklist(clan_id,user_id,by_id,reason,ts) VALUES(?,?,?,?,?)').run(m.clan_id,t.id,me.id,String(b.reason||'').slice(0,100),Date.now());
 db.prepare('DELETE FROM clan_members WHERE clan_id=? AND user_id=?').run(m.clan_id,t.id);
 db.prepare('DELETE FROM clan_invites WHERE clan_id=? AND user_id=?').run(m.clan_id,t.id);
 db.prepare('DELETE FROM clan_apps WHERE clan_id=? AND user_id=?').run(m.clan_id,t.id);
 clanLog(m.clan_id,me.id,'blacklist',t.username);
 return ok({ok:true});
}
if(url==='/api/clans/title'){
 const m=clanOf(me.id);if(!m||!m.clan||m.role!=='leader')return bad('Только лидер');
 const tid=+b.user_id||0;const title=String(b.title||'').trim().slice(0,24);
 if(!db.prepare('SELECT 1 FROM clan_members WHERE clan_id=? AND user_id=?').get(m.clan_id,tid))return bad('Не в клане');
 db.prepare('UPDATE clan_members SET title=? WHERE clan_id=? AND user_id=?').run(title,m.clan_id,tid);
 return ok({ok:true});
}
if(url==='/api/clans/disband'){
 const m=clanOf(me.id);if(!m||!m.clan||m.role!=='leader')return bad('Только лидер');
 if(String(b.confirm||'')!==m.clan.tag)return bad('Введите тег клана для подтверждения');
 const refund=Math.floor(CLAN_CREATE_COST*0.3)+(m.clan.treasury||0);
 C.tx(()=>{
  const members=db.prepare('SELECT user_id FROM clan_members WHERE clan_id=?').all(m.clan_id);
  db.prepare('DELETE FROM clan_invites WHERE clan_id=?').run(m.clan_id);
  db.prepare('DELETE FROM clan_apps WHERE clan_id=?').run(m.clan_id);
  db.prepare('DELETE FROM clan_members WHERE clan_id=?').run(m.clan_id);
  db.prepare('DELETE FROM clan_log WHERE clan_id=?').run(m.clan_id);
  db.prepare('DELETE FROM clan_treasury_log WHERE clan_id=?').run(m.clan_id);
  db.prepare('DELETE FROM clan_blacklist WHERE clan_id=?').run(m.clan_id);
  db.prepare('DELETE FROM clan_achievements WHERE clan_id=?').run(m.clan_id);
  try{db.prepare('DELETE FROM chat_channels WHERE id=?').run('clan_'+m.clan_id)}catch{}
  db.prepare('DELETE FROM clans WHERE id=?').run(m.clan_id);
  if(refund>0)flAdd(me.id,refund,'Возврат за роспуск клана');
  for(const x of members)if(x.user_id!==me.id)notify(x.user_id,'Клан ['+m.clan.tag+'] распущен лидером');
 });
 notify(me.id,'Клан распущен. Возврат: '+refund+' FL');
 return ok({ok:true,fl:flBal(me.id),refund});
}
if(url==='/api/clans/decline_invite'){
 db.prepare('DELETE FROM clan_invites WHERE id=? AND user_id=?').run(+b.id,me.id);
 return ok({ok:true});
}
if(url==='/api/clans/war'){
 const m=clanOf(me.id);if(!m||!m.clan||!clanCan(m,'war'))return bad('Нет прав');
 if(b.action==='challenge'){
  const target=clanGet(+b.target_id);if(!target)return bad('Клан не найден');
  if(target.id===m.clan_id)return bad('Нельзя');
  const exists=db.prepare("SELECT 1 FROM clan_wars WHERE status IN ('pending','active') AND ((a_id=? AND b_id=?) OR (a_id=? AND b_id=?))").get(m.clan_id,target.id,target.id,m.clan_id);
  if(exists)return bad('Уже есть война/вызов');
  const ends=Date.now()+7*DAY;
  db.prepare('INSERT INTO clan_wars(a_id,b_id,status,started,ends) VALUES(?,?,?,?,?)').run(m.clan_id,target.id,'pending',Date.now(),ends);
  notify(target.leader_id,'Клан ['+m.clan.tag+'] вызывает вас на войну!');
  clanLog(m.clan_id,me.id,'war_challenge','→ ['+target.tag+']');
  return ok({ok:true});
 }
 if(b.action==='accept'||b.action==='decline'){
  const w=db.prepare("SELECT * FROM clan_wars WHERE id=? AND status='pending'").get(+b.id);if(!w)return bad('Вызов не найден');
  if(w.b_id!==m.clan_id)return bad('Не ваш вызов');
  if(b.action==='decline'){db.prepare("UPDATE clan_wars SET status='declined' WHERE id=?").run(w.id);notify((clanGet(w.a_id)||{}).leader_id,'Война отклонена кланом ['+m.clan.tag+']');return ok({ok:true})}
  db.prepare("UPDATE clan_wars SET status='active',started=?,ends=? WHERE id=?").run(Date.now(),Date.now()+7*DAY,w.id);
  notify((clanGet(w.a_id)||{}).leader_id,'Война с ['+m.clan.tag+'] началась!');
  clanLog(m.clan_id,me.id,'war_accept','');
  return ok({ok:true});
 }
 if(b.action==='score'){
  // add points to own side during active war
  const w=db.prepare("SELECT * FROM clan_wars WHERE status='active' AND (a_id=? OR b_id=?) ORDER BY id DESC LIMIT 1").get(m.clan_id,m.clan_id);
  if(!w)return bad('Нет активной войны');
  if(Date.now()>w.ends){
    // auto finish
    const aw=w.a_pts>=w.b_pts?w.a_id:w.b_id;
    const al=w.a_pts>=w.b_pts?w.b_id:w.a_id;
    db.prepare("UPDATE clan_wars SET status='finished',winner_id=? WHERE id=?").run(aw,w.id);
    db.prepare('UPDATE clans SET war_wins=war_wins+1,season_pts=season_pts+100 WHERE id=?').run(aw);
    db.prepare('UPDATE clans SET war_losses=war_losses+1 WHERE id=?').run(al);
    return ok({ok:true,finished:true,winner:aw});
  }
  const pts=Math.min(50,Math.max(1,+b.pts||1));
  if(w.a_id===m.clan_id)db.prepare('UPDATE clan_wars SET a_pts=a_pts+? WHERE id=?').run(pts,w.id);
  else db.prepare('UPDATE clan_wars SET b_pts=b_pts+? WHERE id=?').run(pts,w.id);
  clanAddXp(m.clan_id,pts);
  return ok({ok:true});
 }
 return bad('Неизвестное действие');
}
if(url==='/api/clans/alliance'){
 const m=clanOf(me.id);if(!m||!m.clan||m.role!=='leader')return bad('Только лидер');
 if(b.action==='create'){
  if(m.clan.alliance_id)return bad('Уже в альянсе');
  const name=String(b.name||'').trim().slice(0,24);const tag=String(b.tag||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
  if(name.length<3||tag.length<2)return bad('Имя и тег альянса');
  const r=db.prepare('INSERT INTO clan_alliances(name,tag,created) VALUES(?,?,?)').run(name,tag,Date.now());
  db.prepare('INSERT INTO clan_alliance_members(alliance_id,clan_id,joined) VALUES(?,?,?)').run(r.lastInsertRowid,m.clan_id,Date.now());
  db.prepare('UPDATE clans SET alliance_id=? WHERE id=?').run(r.lastInsertRowid,m.clan_id);
  return ok({ok:true,id:r.lastInsertRowid});
 }
 if(b.action==='leave'){
  if(!m.clan.alliance_id)return bad('Не в альянсе');
  db.prepare('DELETE FROM clan_alliance_members WHERE alliance_id=? AND clan_id=?').run(m.clan.alliance_id,m.clan_id);
  db.prepare('UPDATE clans SET alliance_id=0 WHERE id=?').run(m.clan_id);
  return ok({ok:true});
 }
 if(b.action==='invite'){
  if(!m.clan.alliance_id)return bad('Сначала создайте альянс');
  const tc=clanGet(+b.clan_id);if(!tc||tc.alliance_id)return bad('Клан недоступен');
  // simple: auto-join for now (invite accepted by target leader via join_alliance)
  notify(tc.leader_id,'Клан ['+m.clan.tag+'] приглашает в альянс. Примите через /api/clans/alliance join');
  return ok({ok:true,pending:true,alliance_id:m.clan.alliance_id});
 }
 if(b.action==='join'){
  const aid=+b.alliance_id;if(!aid)return bad('ID альянса');
  if(m.clan.alliance_id)return bad('Уже в альянсе');
  const a=db.prepare('SELECT * FROM clan_alliances WHERE id=?').get(aid);if(!a)return bad('Альянс не найден');
  const cnt=(db.prepare('SELECT COUNT(*) c FROM clan_alliance_members WHERE alliance_id=?').get(aid)||{}).c||0;
  if(cnt>=5)return bad('Альянс заполнен (макс 5)');
  db.prepare('INSERT INTO clan_alliance_members(alliance_id,clan_id,joined) VALUES(?,?,?)').run(aid,m.clan_id,Date.now());
  db.prepare('UPDATE clans SET alliance_id=? WHERE id=?').run(aid,m.clan_id);
  return ok({ok:true});
 }
 return bad('Неизвестное действие');
}
if(url==='/api/clans/autokick'){
 const m=clanOf(me.id);if(!m||!m.clan||m.role!=='leader')return bad('Только лидер');
 const days=m.clan.inactive_days||0;if(days<=0)return bad('Сначала задайте inactive_days в настройках');
 const cutoff=Date.now()-days*DAY;
 const old=db.prepare("SELECT user_id,username FROM clan_members cm JOIN users u ON u.id=cm.user_id WHERE cm.clan_id=? AND cm.role!='leader' AND (cm.last_active IS NULL OR cm.last_active<?)").all(m.clan_id,cutoff);
 let n=0;
 for(const x of old){db.prepare('DELETE FROM clan_members WHERE clan_id=? AND user_id=?').run(m.clan_id,x.user_id);clanLog(m.clan_id,me.id,'autokick',x.username);notify(x.user_id,'Исключены из ['+m.clan.tag+'] за неактивность');n++}
 return ok({ok:true,kicked:n});
}
if(url==='/api/clans/season_reset'){
 if(!admin)return bad('Только админ',403);
 const top=db.prepare('SELECT id,name,tag,season_pts FROM clans ORDER BY season_pts DESC LIMIT 3').all();
 for(const t of top){
  const prize=t===top[0]?2000:t===top[1]?1000:500;
  const leader=clanGet(t.id);
  if(leader){flAdd(leader.leader_id,prize,'Приз сезона кланов #'+(top.indexOf(t)+1));notify(leader.leader_id,'Ваш клан ['+t.tag+'] занял место '+(top.indexOf(t)+1)+'! +'+prize+' FL')}
 }
 db.prepare('UPDATE clans SET season_pts=0').run();
 return ok({ok:true,top});
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
  let clanInfo=null;try{const cm=clanOf(t.id);if(cm&&cm.clan)clanInfo={id:cm.clan.id,name:cm.clan.name,tag:cm.clan.tag,color:cm.clan.color,role:cm.role}}catch{}
  return ok({user:{id:t.id,username:t.username,avatar:t.avatar||'',banner:t.banner||'',bio:t.bio||'',created:t.created,is_admin:!!t.is_admin,is_super:!!t.is_super,role:t.role||'',color:flHex(t.nick_color),badge:flBadgeId(t.badge),prefix:t.prefix||'',pcolor:flPx(t.prefix_color),fl:t.fl||0,clan:clanInfo},likes,dislikes,myVote:my?my.v:0,comments,me:me.id});
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
