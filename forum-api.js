// forum-api.js — расширенный форум: репутация/звания, подписки, жалобы, предупреждения/бан,
// опросы, лучший ответ, история правок, корзина, модерация.
const fs=require('fs'),path=require('path'),crypto=require('crypto');

module.exports=function(db,H){
 // H: { isStaff(user)->bool, notify(uid,text), flHex(id), flBadgeId(id) }
 const run=s=>{try{db.exec(s)}catch{}};

 // ---------- схема ----------
 db.exec(`CREATE TABLE IF NOT EXISTS forum_cats(id TEXT PRIMARY KEY,name TEXT,descr TEXT DEFAULT '',grp TEXT DEFAULT 'Community',staff INTEGER DEFAULT 0,sort INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS forum_likes(user_id INTEGER,kind TEXT,target_id INTEGER,PRIMARY KEY(user_id,kind,target_id));
 CREATE TABLE IF NOT EXISTS forum_files(url TEXT PRIMARY KEY,user_id INTEGER,name TEXT,size INTEGER,img INTEGER DEFAULT 0,ts INTEGER);`);

 run("ALTER TABLE forum_cats ADD COLUMN icon TEXT DEFAULT ''");
 for(const c of [
  "views INTEGER DEFAULT 0","closed INTEGER DEFAULT 0","edited_ts INTEGER DEFAULT 0",
  "last_ts INTEGER DEFAULT 0","last_uid INTEGER DEFAULT 0","prefix TEXT DEFAULT ''",
  "atts TEXT DEFAULT '[]'","solved INTEGER DEFAULT 0","best_reply_id INTEGER DEFAULT 0",
  "poll_id INTEGER DEFAULT 0","deleted INTEGER DEFAULT 0","deleted_ts INTEGER DEFAULT 0","deleted_by INTEGER DEFAULT 0"
 ])run('ALTER TABLE forum_posts ADD COLUMN '+c);
 for(const c of [
  "edited_ts INTEGER DEFAULT 0","atts TEXT DEFAULT '[]'","deleted INTEGER DEFAULT 0",
  "deleted_ts INTEGER DEFAULT 0","deleted_by INTEGER DEFAULT 0","is_best INTEGER DEFAULT 0"
 ])run('ALTER TABLE forum_replies ADD COLUMN '+c);

 // Репутация, баны, предупреждения на форуме
 for(const c of [
  "reputation INTEGER DEFAULT 0","forum_warns INTEGER DEFAULT 0",
  "forum_ban_until INTEGER DEFAULT 0","forum_ban_reason TEXT DEFAULT ''",
  "last_online INTEGER DEFAULT 0","post_count INTEGER DEFAULT 0","like_received INTEGER DEFAULT 0"
 ])run('ALTER TABLE users ADD COLUMN '+c);

 // Подписки
 db.exec(`CREATE TABLE IF NOT EXISTS forum_subs(
  user_id INTEGER, kind TEXT, target_id TEXT,
  PRIMARY KEY(user_id,kind,target_id)
 );`);

 // Жалобы
 db.exec(`CREATE TABLE IF NOT EXISTS forum_reports(
  id INTEGER PRIMARY KEY, reporter_id INTEGER, kind TEXT, target_id INTEGER,
  reason TEXT, status TEXT DEFAULT 'open', ts INTEGER,
  handled_by INTEGER DEFAULT 0, handled_ts INTEGER DEFAULT 0, note TEXT DEFAULT ''
 );`);

 // История предупреждений
 db.exec(`CREATE TABLE IF NOT EXISTS forum_warn_log(
  id INTEGER PRIMARY KEY, user_id INTEGER, admin_id INTEGER, reason TEXT, ts INTEGER
 );`);

 // Опросы
 db.exec(`CREATE TABLE IF NOT EXISTS forum_polls(
  id INTEGER PRIMARY KEY, post_id INTEGER UNIQUE, question TEXT, multi INTEGER DEFAULT 0,
  closed INTEGER DEFAULT 0, created INTEGER
 );
 CREATE TABLE IF NOT EXISTS forum_poll_opts(
  id INTEGER PRIMARY KEY, poll_id INTEGER, text TEXT, sort INTEGER DEFAULT 0
 );
 CREATE TABLE IF NOT EXISTS forum_poll_votes(
  poll_id INTEGER, user_id INTEGER, opt_id INTEGER,
  PRIMARY KEY(poll_id,user_id,opt_id)
 );`);

 // История правок
 db.exec(`CREATE TABLE IF NOT EXISTS forum_edits(
  id INTEGER PRIMARY KEY, kind TEXT, target_id INTEGER, user_id INTEGER,
  old_body TEXT, old_title TEXT DEFAULT '', ts INTEGER
 );`);

 // Корзина (soft-delete уже через deleted-флаги, но для быстрого доступа)
 db.exec(`CREATE TABLE IF NOT EXISTS forum_trash(
  id INTEGER PRIMARY KEY, kind TEXT, target_id INTEGER, data TEXT, deleted_by INTEGER, ts INTEGER
 );`);

 // Журнал действий модераторов
 db.exec(`CREATE TABLE IF NOT EXISTS forum_modlog(
  id INTEGER PRIMARY KEY, admin_id INTEGER, action TEXT, target_kind TEXT,
  target_id INTEGER, details TEXT, ts INTEGER
 );`);

 // Достижения
 db.exec(`CREATE TABLE IF NOT EXISTS forum_words(word TEXT PRIMARY KEY);`);
 db.exec(`CREATE TABLE IF NOT EXISTS forum_achievements(
  user_id INTEGER, code TEXT, ts INTEGER,
  PRIMARY KEY(user_id,code)
 );`);

 run('UPDATE forum_posts SET last_ts=ts WHERE last_ts IS NULL OR last_ts=0');
 run('CREATE INDEX IF NOT EXISTS ix_fp_cat ON forum_posts(cat,pinned,last_ts)');
 run('CREATE INDEX IF NOT EXISTS ix_fr_post ON forum_replies(post_id)');
 run('CREATE INDEX IF NOT EXISTS ix_fr_deleted ON forum_posts(deleted)');
 run('CREATE INDEX IF NOT EXISTS ix_rep_status ON forum_reports(status)');

 const ICONS=['folder','globe','news','update','target','key','code','book','chat','shield','tools','help','bug','image','download','users'];
 const DEF_ICON={news:'news',updates:'update',global:'globe',cheats:'target',crack:'key',sources:'code',guides:'book'};
 if(!db.prepare('SELECT COUNT(*) c FROM forum_cats').get().c){
  const ins=db.prepare('INSERT INTO forum_cats(id,name,descr,grp,staff,sort) VALUES(?,?,?,?,?,?)');
  [['news','News','Новости проекта','Staff',1,10],['updates','Updates','Обновления и изменения','Staff',1,20],
   ['global','Global','Общие обсуждения','Community',0,30],['cheats','Cheats','Читы: обсуждение, вопросы, помощь','Community',0,40],
   ['crack','Crack','Crack-раздел','Community',0,50],['sources','Исходники читов','Исходники, наработки','Community',0,60],
   ['guides','Гайды','Инструкции и руководства','Community',0,70]].forEach(r=>ins.run(...r));
 }
 for(const [id,ic] of Object.entries(DEF_ICON))run("UPDATE forum_cats SET icon='"+ic+"' WHERE id='"+id+"' AND (icon IS NULL OR icon='')");

 // ---------- звания ----------
 const RANKS=[
  {min:0,  name:'Новичок',     color:'#9ca3af'},
  {min:10, name:'Участник',    color:'#60a5fa'},
  {min:50, name:'Активный',    color:'#34d399'},
  {min:150,name:'Опытный',     color:'#a78bfa'},
  {min:400,name:'Ветеран',     color:'#f59e0b'},
  {min:1000,name:'Легенда',    color:'#ef4444'},
  {min:2500,name:'Мастер',     color:'#ec4899'},
 ];
 const rankOf=(msgs,rep)=>{
  const score=(msgs||0)+Math.floor((rep||0)/2);
  let r=RANKS[0];
  for(const x of RANKS)if(score>=x.min)r=x;
  return r;
 };

 // ---------- утилиты ----------
 const PREFIXES=['','Вопрос','Обсуждение','Помощь','Релиз','Гайд','Баг','Идея'];
 const clean=s=>String(s==null?'':s).replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim();
 const oneLine=s=>clean(s).replace(/\s+/g,' ');
 const hits=new Map();
 const flood=(uid,key,max,ms)=>{const k=key+uid,n=Date.now(),a=(hits.get(k)||[]).filter(t=>n-t<ms);a.push(n);hits.set(k,a);return a.length>max};
 const viewSeen=new Map();
 const getCat=id=>db.prepare('SELECT * FROM forum_cats WHERE id=?').get(String(id||''));
 const catOut=c=>({id:c.id,name:c.name,descr:c.descr||'',group:c.grp||'Community',staff:!!c.staff,sort:c.sort||0,icon:ICONS.includes(c.icon)?c.icon:'folder'});
 const like=s=>'%'+String(s).replace(/[\\%_]/g,m=>'\\'+m)+'%';
 const parseAtts=s=>{try{const a=JSON.parse(s||'[]');return Array.isArray(a)?a:[]}catch{return[]}};
 const resolveAtts=(uid,list,staff)=>{
  if(!Array.isArray(list))return'[]';
  const out=[],seen=new Set();
  for(const x of list.slice(0,10)){
   const url=String((x&&x.url)||x||'');
   if(seen.has(url)||!/^\/uploads\/f\d+_[\w.-]+$/.test(url))continue;seen.add(url);
   const f=db.prepare('SELECT url,name,size,img,user_id FROM forum_files WHERE url=?').get(url);
   if(!f||(f.user_id!==uid&&!staff))continue;
   out.push({url:f.url,name:f.name,size:f.size,img:!!f.img});
  }
  return JSON.stringify(out);
 };

 const getUserStats=uid=>{
  const u=db.prepare('SELECT reputation,post_count,like_received,forum_warns,forum_ban_until,forum_ban_reason,last_online,created FROM users WHERE id=?').get(uid)||{};
  const msgs=u.post_count||db.prepare('SELECT (SELECT COUNT(*) FROM forum_posts WHERE user_id=? AND deleted=0)+(SELECT COUNT(*) FROM forum_replies WHERE user_id=? AND deleted=0) c').get(uid,uid).c||0;
  const rank=rankOf(msgs,u.reputation||0);
  return {reputation:u.reputation||0,msgs,likes:u.like_received||0,warns:u.forum_warns||0,
   ban_until:u.forum_ban_until||0,ban_reason:u.forum_ban_reason||'',last_online:u.last_online||0,
   since:u.created||0,rank:rank.name,rank_color:rank.color};
 };

 const author=r=>{
  const st=getUserStats(r.user_id);
  return {
   uid:r.user_id,username:r.username||'удалён',avatar:r.avatar||'',
   is_admin:!!r.is_admin,role:r.role||'',color:H.flHex(r.nick_color),badge:H.flBadgeId(r.badge),prefix:r.prefix||'',pcolor:/^#[0-9a-f]{6}$/i.test(r.prefix_color||'')?r.prefix_color:'',
   since:r.ucreated||st.since||0,msgs:st.msgs,
   reputation:st.reputation,rank:st.rank,rank_color:st.rank_color,
   warns:st.warns,banned:st.ban_until>Date.now()
  };
 };

 const likesFor=(kind,ids,uid)=>{
  const m={};if(!ids.length)return m;
  for(const r of db.prepare(`SELECT target_id t,COUNT(*) c,SUM(user_id=?) mine FROM forum_likes WHERE kind=? AND target_id IN (${ids.map(()=>'?').join(',')}) GROUP BY target_id`).all(uid,kind,...ids))m[r.t]={c:r.c,mine:!!r.mine};
  return m;
 };

 const mentions=(body,fromName,fromId,title,pid)=>{
  const names=[...new Set((body.match(/@([A-Za-z0-9_]{3,20})/g)||[]).map(s=>s.slice(1)))].slice(0,5);
  for(const n of names){const t=db.prepare('SELECT id FROM users WHERE username=?').get(n);if(t&&t.id!==fromId)try{H.notify(t.id,`${fromName} упомянул вас в теме «${title.slice(0,60)}»`)}catch{}}
 };

 const notifySubs=(kind,targetId,exceptUid,text,link='')=>{
  try{
   const rows=db.prepare('SELECT user_id FROM forum_subs WHERE kind=? AND target_id=?').all(kind,String(targetId));
   for(const r of rows)if(r.user_id!==exceptUid)try{H.notify(r.user_id,text,'forum',link)}catch{}
  }catch{}
 };
 const markSubRead=(uid,kind,targetId,ts)=>{
  try{db.prepare('INSERT INTO forum_sub_reads(user_id,kind,target_id,last_ts) VALUES(?,?,?,?) ON CONFLICT(user_id,kind,target_id) DO UPDATE SET last_ts=excluded.last_ts').run(uid,kind,String(targetId),ts||Date.now())}catch{}
 };
 const unreadCount=uid=>{
  try{
   // posts subscribed where last_ts > last read
   const n=db.prepare(`SELECT COUNT(*) c FROM forum_subs s
     JOIN forum_posts p ON p.id=CAST(s.target_id AS INTEGER)
     LEFT JOIN forum_sub_reads r ON r.user_id=s.user_id AND r.kind=s.kind AND r.target_id=s.target_id
     WHERE s.user_id=? AND s.kind='post' AND p.deleted=0 AND p.last_ts>COALESCE(r.last_ts,0)`).get(uid).c;
   return n||0;
  }catch{return 0}
 };


 const modlog=(adminId,action,tKind,tId,details='')=>{
  try{db.prepare('INSERT INTO forum_modlog(admin_id,action,target_kind,target_id,details,ts) VALUES(?,?,?,?,?,?)')
   .run(adminId,action,tKind,tId,String(details).slice(0,300),Date.now())}catch{}
 };

 const checkForumBan=u=>{
  if(!u)return null;
  const until=u.forum_ban_until||0;
  if(until>Date.now())return {until,reason:u.forum_ban_reason||'Нарушение правил'};
  return null;
 };

 const getSet=(k,def)=>{try{const v=db.prepare('SELECT value FROM settings WHERE key=?').get(k);return v?v.value:def}catch{return def}};
 const setSet=(k,v)=>{try{db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k,String(v))}catch{}};
 const isNewbie=u=>{
  if(!u||!u.created)return false;
  const h=Math.max(0,Math.min(168,+(getSet('forum_newbie_hours','24')||24)));
  return (Date.now()-(u.created||0))<h*3600*1000;
 };
 const hasStopWord=s=>{
  try{
   const lw=String(s||'').toLowerCase();
   for(const w of db.prepare('SELECT word FROM forum_words').all())if(w.word&&lw.includes(w.word))return w.word;
  }catch{}
  return null;
 };

 const hasLinks=s=>/https?:\/\/|www\.|\[url/i.test(s||'');

 const USER_COLS='u.username,u.avatar,u.is_admin,u.nick_color,u.badge,u.prefix,u.prefix_color,u.role';

 // Пересчёт счётчиков пользователя
 const recalcUser=uid=>{
  try{
   const posts=db.prepare('SELECT COUNT(*) c FROM forum_posts WHERE user_id=? AND deleted=0').get(uid).c;
   const replies=db.prepare('SELECT COUNT(*) c FROM forum_replies WHERE user_id=? AND deleted=0').get(uid).c;
   const likes=db.prepare(`SELECT COUNT(*) c FROM forum_likes WHERE (kind='p' AND target_id IN (SELECT id FROM forum_posts WHERE user_id=?)) OR (kind='r' AND target_id IN (SELECT id FROM forum_replies WHERE user_id=?))`).get(uid,uid).c;
   db.prepare('UPDATE users SET post_count=?,like_received=? WHERE id=?').run(posts+replies,likes,uid);
  }catch{}
 };

 // Достижения
 const ACHIEVEMENTS={
  first_post:{title:'Первая тема',desc:'Создал первую тему'},
  first_reply:{title:'Первый ответ',desc:'Написал первый ответ'},
  posts_10:{title:'10 сообщений',desc:'Написал 10 сообщений'},
  posts_100:{title:'100 сообщений',desc:'Написал 100 сообщений'},
  posts_500:{title:'500 сообщений',desc:'Написал 500 сообщений'},
  likes_10:{title:'10 лайков',desc:'Получил 10 лайков'},
  likes_50:{title:'50 лайков',desc:'Получил 50 лайков'},
  solved:{title:'Решатель',desc:'Ответ отмечен решением'},
 };
 const grantAch=(uid,code)=>{
  try{
   const ex=db.prepare('SELECT 1 FROM forum_achievements WHERE user_id=? AND code=?').get(uid,code);
   if(ex)return;
   db.prepare('INSERT INTO forum_achievements(user_id,code,ts) VALUES(?,?,?)').run(uid,code,Date.now());
   const a=ACHIEVEMENTS[code];
   if(a)try{H.notify(uid,`Достижение: ${a.title}`)}catch{}
  }catch{}
 };
 const checkAchs=uid=>{
  const st=getUserStats(uid);
  if(st.msgs>=1)grantAch(uid,'first_reply');
  if(st.msgs>=10)grantAch(uid,'posts_10');
  if(st.msgs>=100)grantAch(uid,'posts_100');
  if(st.msgs>=500)grantAch(uid,'posts_500');
  if(st.likes>=10)grantAch(uid,'likes_10');
  if(st.likes>=50)grantAch(uid,'likes_50');
 };

 // ---------- GET ----------
 const get=(url,qs,u,req,res,C)=>{
  const send=(o,code=200)=>C.send(res,code,o);
  const staff=H.isStaff(u);
  try{db.prepare('UPDATE users SET last_online=? WHERE id=?').run(Date.now(),u.id)}catch{}

  if(url==='/api/forum/home'||url==='/api/forum/'||url==='/api/forum/cats'){
   const cnt=Object.fromEntries(db.prepare('SELECT cat,COUNT(*) t FROM forum_posts WHERE deleted=0 GROUP BY cat').all().map(r=>[r.cat,r.t]));
   const rep=Object.fromEntries(db.prepare('SELECT p.cat,COUNT(*) t FROM forum_replies r JOIN forum_posts p ON p.id=r.post_id WHERE r.deleted=0 AND p.deleted=0 GROUP BY p.cat').all().map(r=>[r.cat,r.t]));
   const cats=db.prepare('SELECT * FROM forum_cats ORDER BY sort,rowid').all().map(c=>{
    const last=db.prepare(`SELECT p.id,p.title,p.last_ts ts,(SELECT username FROM users WHERE id=COALESCE(NULLIF(p.last_uid,0),p.user_id)) username FROM forum_posts p WHERE p.cat=? AND p.deleted=0 ORDER BY p.last_ts DESC LIMIT 1`).get(c.id);
    return {...catOut(c),threads:cnt[c.id]||0,posts:(cnt[c.id]||0)+(rep[c.id]||0),last:last||null};
   });
   const tot=db.prepare('SELECT (SELECT COUNT(*) FROM forum_posts WHERE deleted=0) t,(SELECT COUNT(*) FROM forum_replies WHERE deleted=0) r,(SELECT COUNT(*) FROM users) u').get();
   return send({cats,staff,me:{id:u.id,username:u.username},stats:{threads:tot.t,posts:tot.t+tot.r,members:tot.u}});
  }

  if(url==='/api/forum/list'){
   const cat=getCat(qs.get('cat'));if(!cat)return send({error:'Раздел не найден'},404);
   const per=20,q=oneLine(qs.get('q')||'').slice(0,60),sort=String(qs.get('sort')||'last');
   const order={last:'p.last_ts DESC',new:'p.id DESC',views:'p.views DESC',replies:'replies DESC',unsolved:'p.solved ASC,p.last_ts DESC'}[sort]||'p.last_ts DESC';
   const where='p.cat=? AND p.deleted=0'+(sort==='unsolved'?' AND p.solved=0':'')+(sort==='poll'?' AND p.poll_id>0':'')+(q?" AND p.title LIKE ? ESCAPE '\\'":''),args=q?[cat.id,like(q)]:[cat.id];
   const total=db.prepare('SELECT COUNT(*) c FROM forum_posts p WHERE '+where).get(...args).c;
   const pages=Math.max(1,Math.ceil(total/per)),page=Math.min(pages,Math.max(1,+qs.get('page')||1));
   const rows=db.prepare(`SELECT p.id,p.title,p.prefix,p.pinned,p.closed,p.solved,p.ts,p.views,p.last_ts,p.user_id,${USER_COLS},
     (SELECT COUNT(*) FROM forum_replies r WHERE r.post_id=p.id AND r.deleted=0) replies,
     (SELECT username FROM users WHERE id=COALESCE(NULLIF(p.last_uid,0),p.user_id)) last_name
     FROM forum_posts p LEFT JOIN users u ON u.id=p.user_id WHERE ${where} ORDER BY p.pinned DESC,${order} LIMIT ? OFFSET ?`).all(...args,per,(page-1)*per);
   const subbed=!!db.prepare('SELECT 1 FROM forum_subs WHERE user_id=? AND kind=? AND target_id=?').get(u.id,'cat',cat.id);
   return send({cat:catOut(cat),list:rows.map(r=>({id:r.id,title:r.title,prefix:r.prefix||'',pinned:!!r.pinned,closed:!!r.closed,solved:!!r.solved,ts:r.ts,views:r.views||0,replies:r.replies,last_ts:r.last_ts||r.ts,last_name:r.last_name||r.username||'?',author:author(r)})),
    page,pages,total,per,staff,canCreate:!cat.staff||staff,prefixes:PREFIXES,subbed});
  }

  if(url==='/api/forum/search'){
   const q=oneLine(qs.get('q')||'').slice(0,60);if(q.length<2)return send({error:'Минимум 2 символа'},400);
   const rows=db.prepare(`SELECT p.id,p.title,p.prefix,p.ts,p.last_ts,p.cat,c.name cat_name,p.user_id,${USER_COLS},(SELECT COUNT(*) FROM forum_replies r WHERE r.post_id=p.id AND r.deleted=0) replies
     FROM forum_posts p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN forum_cats c ON c.id=p.cat
     WHERE p.deleted=0 AND (p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\') ORDER BY p.last_ts DESC LIMIT 30`).all(like(q),like(q));
   const replyHits=db.prepare(`SELECT r.id rid,r.post_id id,r.body,r.ts,p.title,p.cat,c.name cat_name,r.user_id,${USER_COLS}
     FROM forum_replies r JOIN forum_posts p ON p.id=r.post_id LEFT JOIN users u ON u.id=r.user_id LEFT JOIN forum_cats c ON c.id=p.cat
     WHERE r.deleted=0 AND p.deleted=0 AND r.body LIKE ? ESCAPE '\\' ORDER BY r.ts DESC LIMIT 20`).all(like(q));
   return send({q,
    list:rows.map(r=>({id:r.id,title:r.title,prefix:r.prefix||'',ts:r.ts,last_ts:r.last_ts||r.ts,cat:r.cat,cat_name:r.cat_name||r.cat,replies:r.replies,author:author(r),type:'topic'})),
    replies:replyHits.map(r=>({id:r.id,rid:r.rid,title:r.title,snippet:String(r.body||'').slice(0,120),ts:r.ts,cat:r.cat,cat_name:r.cat_name||r.cat,author:author(r),type:'reply'}))
   });
  }

  if(url==='/api/forum/post'){
   const id=+qs.get('id')||0;
   const p=db.prepare(`SELECT p.*,${USER_COLS},u.created ucreated FROM forum_posts p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.deleted=0`).get(id);
   if(!p)return send({error:'Тема не найдена'},404);
   const cat=getCat(p.cat)||{id:p.cat,name:p.cat,staff:0,grp:''};
   const vk=u.id+':'+id,now=Date.now();
   if(!viewSeen.has(vk)||now-viewSeen.get(vk)>18e5){viewSeen.set(vk,now);if(viewSeen.size>20000)viewSeen.clear();db.prepare('UPDATE forum_posts SET views=views+1 WHERE id=?').run(id);p.views=(p.views||0)+1}
   const per=15,total=db.prepare('SELECT COUNT(*) c FROM forum_replies WHERE post_id=? AND deleted=0').get(id).c;
   const pages=Math.max(1,Math.ceil(total/per));
   const pg=String(qs.get('page')||'1'),page=pg==='last'?pages:Math.min(pages,Math.max(1,+pg||1));
   const reps=db.prepare(`SELECT r.*,${USER_COLS},u.created ucreated FROM forum_replies r LEFT JOIN users u ON u.id=r.user_id WHERE r.post_id=? AND r.deleted=0 ORDER BY r.id LIMIT ? OFFSET ?`).all(id,per,(page-1)*per);
   const lp=likesFor('p',[id],u.id),lr=likesFor('r',reps.map(r=>r.id),u.id);
   const closed=!!p.closed,canWrite=!cat.staff||staff;
   const subbed=!!db.prepare('SELECT 1 FROM forum_subs WHERE user_id=? AND kind=? AND target_id=?').get(u.id,'post',String(id));
   try{markSubRead(u.id,'post',id,p.last_ts||Date.now())}catch{}

   // опрос
   let poll=null;
   if(p.poll_id){
    const pl=db.prepare('SELECT * FROM forum_polls WHERE id=?').get(p.poll_id);
    if(pl){
     const opts=db.prepare('SELECT * FROM forum_poll_opts WHERE poll_id=? ORDER BY sort,id').all(pl.id);
     const votes=db.prepare('SELECT opt_id,COUNT(*) c FROM forum_poll_votes WHERE poll_id=? GROUP BY opt_id').all(pl.id);
     const myVotes=db.prepare('SELECT opt_id FROM forum_poll_votes WHERE poll_id=? AND user_id=?').all(pl.id,u.id).map(x=>x.opt_id);
     const totalV=votes.reduce((s,v)=>s+v.c,0);
     const vmap=Object.fromEntries(votes.map(v=>[v.opt_id,v.c]));
     poll={id:pl.id,question:pl.question,multi:!!pl.multi,closed:!!pl.closed,
      options:opts.map(o=>({id:o.id,text:o.text,votes:vmap[o.id]||0,pct:totalV?Math.round(100*(vmap[o.id]||0)/totalV):0})),
      total:totalV,my:myVotes};
    }
   }

   // история правок для staff
   let edits=[];
   if(staff){
    edits=db.prepare('SELECT id,kind,target_id,user_id,old_title,ts,(SELECT username FROM users WHERE id=user_id) username FROM forum_edits WHERE (kind=? AND target_id=?) OR (kind=? AND target_id IN (SELECT id FROM forum_replies WHERE post_id=?)) ORDER BY ts DESC LIMIT 30')
     .all('p',id,'r',id);
   }

   return send({
    cat:catOut({...cat,grp:cat.grp}),staff,me:{id:u.id,username:u.username},prefixes:PREFIXES,subbed,poll,edits,
    post:{id:p.id,title:p.title,prefix:p.prefix||'',body:p.body,atts:parseAtts(p.atts),ts:p.ts,edited_ts:p.edited_ts||0,
     pinned:!!p.pinned,closed,solved:!!p.solved,best_reply_id:p.best_reply_id||0,views:p.views||0,
     likes:(lp[id]||{}).c||0,liked:!!(lp[id]||{}).mine,author:author(p),
     can:{edit:(p.user_id===u.id&&!closed&&canWrite)||staff,del:staff||(p.user_id===u.id&&total===0&&canWrite),
      solve:p.user_id===u.id||staff,mod:staff}},
    replies:reps.map(r=>({id:r.id,body:r.body,atts:parseAtts(r.atts),ts:r.ts,edited_ts:r.edited_ts||0,
     likes:(lr[r.id]||{}).c||0,liked:!!(lr[r.id]||{}).mine,is_best:!!r.is_best||r.id===p.best_reply_id,
     author:author(r),can:{edit:(r.user_id===u.id&&!closed&&canWrite)||staff,del:staff||r.user_id===u.id}})),
    page,pages,total,per,canReply:canWrite&&!closed
   });
  }

  // Подписки пользователя
  if(url==='/api/forum/my_subs'){
   const posts=db.prepare(`SELECT s.target_id id,p.title,p.last_ts,p.cat FROM forum_subs s JOIN forum_posts p ON p.id=CAST(s.target_id AS INTEGER) WHERE s.user_id=? AND s.kind='post' AND p.deleted=0 ORDER BY p.last_ts DESC LIMIT 50`).all(u.id);
   const cats=db.prepare(`SELECT s.target_id id,c.name FROM forum_subs s JOIN forum_cats c ON c.id=s.target_id WHERE s.user_id=? AND s.kind='cat'`).all(u.id);
   return send({posts,cats});
  }

  // Жалобы (staff)
  if(url==='/api/forum/reports'){
   if(!staff)return send({error:'Нет доступа'},403);
   const status=qs.get('status')||'open';
   const rows=db.prepare(`SELECT r.*,u.username reporter_name FROM forum_reports r LEFT JOIN users u ON u.id=r.reporter_id WHERE r.status=? ORDER BY r.ts DESC LIMIT 100`).all(status);
   return send({list:rows,status});
  }

  // Корзина (staff)
  if(url==='/api/forum/trash'){
   if(!staff)return send({error:'Нет доступа'},403);
   const posts=db.prepare(`SELECT p.id,p.title,p.deleted_ts ts,p.deleted_by,u.username del_by_name,p.cat FROM forum_posts p LEFT JOIN users u ON u.id=p.deleted_by WHERE p.deleted=1 ORDER BY p.deleted_ts DESC LIMIT 50`).all();
   const replies=db.prepare(`SELECT r.id,r.body,r.deleted_ts ts,r.deleted_by,u.username del_by_name,r.post_id FROM forum_replies r LEFT JOIN users u ON u.id=r.deleted_by WHERE r.deleted=1 ORDER BY r.deleted_ts DESC LIMIT 50`).all();
   return send({posts,replies});
  }

  // Журнал модерации
  if(url==='/api/forum/modlog'){
   if(!staff)return send({error:'Нет доступа'},403);
   const rows=db.prepare(`SELECT m.*,u.username admin_name FROM forum_modlog m LEFT JOIN users u ON u.id=m.admin_id ORDER BY m.ts DESC LIMIT 100`).all();
   return send({list:rows});
  }

  // Топы
  if(url==='/api/forum/tops'){
   const byRep=db.prepare(`SELECT id,username,avatar,reputation,post_count FROM users WHERE reputation>0 ORDER BY reputation DESC LIMIT 20`).all();
   const byPosts=db.prepare(`SELECT id,username,avatar,post_count,reputation FROM users WHERE post_count>0 ORDER BY post_count DESC LIMIT 20`).all();
   return send({reputation:byRep.map(u=>({...u,rank:rankOf(u.post_count,u.reputation).name})),
    posts:byPosts.map(u=>({...u,rank:rankOf(u.post_count,u.reputation).name}))});
  }

  // Публичный профиль (расширенный)
  if(url==='/api/forum/user'){
   const id=+qs.get('id')||0;
   const t=db.prepare('SELECT id,username,avatar,banner,bio,created,is_admin,role,nick_color,badge,prefix,prefix_color,reputation,post_count,like_received,forum_warns,last_online FROM users WHERE id=?').get(id);
   if(!t)return send({error:'Пользователь не найден'},404);
   const st=getUserStats(id);
   const recentPosts=db.prepare(`SELECT id,title,ts,cat,views FROM forum_posts WHERE user_id=? AND deleted=0 ORDER BY ts DESC LIMIT 10`).all(id);
   const recentReplies=db.prepare(`SELECT r.id,r.ts,r.post_id,p.title FROM forum_replies r JOIN forum_posts p ON p.id=r.post_id WHERE r.user_id=? AND r.deleted=0 AND p.deleted=0 ORDER BY r.ts DESC LIMIT 10`).all(id);
   const achs=db.prepare('SELECT code,ts FROM forum_achievements WHERE user_id=? ORDER BY ts').all(id)
    .map(a=>({code:a.code,ts:a.ts,...(ACHIEVEMENTS[a.code]||{title:a.code,desc:''})}));
   return send({
    user:{id:t.id,username:t.username,avatar:t.avatar||'',banner:t.banner||'',bio:t.bio||'',
     created:t.created,is_admin:!!t.is_admin,role:t.role||'',color:H.flHex(t.nick_color),badge:H.flBadgeId(t.badge),prefix:t.prefix||'',pcolor:/^#[0-9a-f]{6}$/i.test(t.prefix_color||'')?t.prefix_color:'',
     reputation:st.reputation,msgs:st.msgs,likes:st.likes,warns:st.warns,last_online:st.last_online,
     rank:st.rank,rank_color:st.rank_color},
    recentPosts,recentReplies,achievements:achs
   });
  }

  if(url==='/api/forum/unread'){
   return send({count:unreadCount(u.id)});
  }
  if(url==='/api/forum/mark_read'){
   // handled in post too; GET convenience: mark all
   try{
    const rows=db.prepare(`SELECT s.target_id,p.last_ts FROM forum_subs s JOIN forum_posts p ON p.id=CAST(s.target_id AS INTEGER) WHERE s.user_id=? AND s.kind='post'`).all(u.id);
    for(const r of rows)markSubRead(u.id,'post',r.target_id,r.last_ts||Date.now());
   }catch{}
   return send({ok:true,count:0});
  }
  if(url==='/api/forum/mine'){
   const posts=db.prepare(`SELECT id,title,ts,cat,views,solved FROM forum_posts WHERE user_id=? AND deleted=0 ORDER BY ts DESC LIMIT 30`).all(u.id);
   const replies=db.prepare(`SELECT r.id,r.ts,r.post_id,p.title FROM forum_replies r JOIN forum_posts p ON p.id=r.post_id WHERE r.user_id=? AND r.deleted=0 AND p.deleted=0 ORDER BY r.ts DESC LIMIT 30`).all(u.id);
   const subs=db.prepare(`SELECT s.target_id id,p.title,p.last_ts,p.cat FROM forum_subs s JOIN forum_posts p ON p.id=CAST(s.target_id AS INTEGER) WHERE s.user_id=? AND s.kind='post' AND p.deleted=0 ORDER BY p.last_ts DESC LIMIT 50`).all(u.id);
   return send({posts,replies,subs});
  }
  if(url==='/api/forum/rep_log'){
   const id=+qs.get('id')||u.id;
   const rows=db.prepare('SELECT delta,reason,ts,from_id,(SELECT username FROM users WHERE id=from_id) from_name FROM rep_log WHERE user_id=? ORDER BY ts DESC LIMIT 50').all(id);
   return send({list:rows});
  }
  if(url==='/api/forum/words'){
   if(!staff)return send({error:'Нет доступа'},403);
   return send({words:db.prepare('SELECT word FROM forum_words ORDER BY word').all().map(x=>x.word)});
  }
  if(url==='/api/forum/settings'){
   if(!staff)return send({error:'Нет доступа'},403);
   return send({newbie_hours:+(getSet('forum_newbie_hours','24')||24),like_hour_limit:+(getSet('forum_like_hour','15')||15)});
  }
  // История правок конкретного сообщения
  if(url==='/api/forum/edits'){
   if(!staff)return send({error:'Нет доступа'},403);
   const kind=qs.get('kind')==='r'?'r':'p',id=+qs.get('id')||0;
   const rows=db.prepare('SELECT e.*,u.username FROM forum_edits e LEFT JOIN users u ON u.id=e.user_id WHERE e.kind=? AND e.target_id=? ORDER BY e.ts DESC LIMIT 50').all(kind,id);
   return send({list:rows});
  }

  return send({error:'Не найдено'},404);
 };

 // ---------- POST ----------
 const post=(url,b,me,req,res,C)=>{
  const send=(o,code=200)=>C.send(res,code,o);
  const ok=o=>send(o),bad=(m,c=400)=>send({error:m},c);
  const staff=H.isStaff(me);
  const bodyOf=(max=20000)=>clean(b.body||b.text||'').slice(0,max);

  // Проверка бана на форуме
  const ban=checkForumBan(me);
  if(ban&&!staff&&!['/api/forum/like','/api/forum/sub','/api/forum/report'].includes(url)){
   return bad(`Вы заблокированы на форуме до ${new Date(ban.until).toLocaleString('ru')}. Причина: ${ban.reason}`,403);
  }

  // Создание темы
  if(url==='/api/forum/new'||url==='/api/forum/create'){
   const cat=getCat(b.cat);if(!cat)return bad('Раздел не найден',404);
   if(cat.staff&&!staff)return bad('В этом разделе темы создают только администраторы',403);
   const title=oneLine(b.title).slice(0,120),body=bodyOf();
   if(title.length<3)return bad('Заголовок: минимум 3 символа');if(body.length<3)return bad('Сообщение слишком короткое');
   if(!staff&&isNewbie(me)&&hasLinks(body+title))return bad('Новичкам нельзя публиковать ссылки в первые часы',403);
   const sw=hasStopWord(title+' '+body);if(sw&&!staff)return bad('Сообщение содержит запрещённое слово',400);
   if(!staff&&flood(me.id,'t',5,6e5))return bad('Слишком часто создаёте темы, подождите',429);
   const prefix=PREFIXES.includes(b.prefix)?b.prefix:'',now=Date.now();
   const r=db.prepare('INSERT INTO forum_posts(cat,user_id,title,body,ts,pinned,last_ts,last_uid,prefix,atts) VALUES(?,?,?,?,?,0,?,?,?,?)')
    .run(cat.id,me.id,title,body,now,now,me.id,prefix,resolveAtts(me.id,b.atts,staff));
   const id=Number(r.lastInsertRowid);
   mentions(body,me.username,me.id,title,id);
   notifySubs('cat',cat.id,me.id,`Новая тема в «${cat.name}»: ${title.slice(0,60)}`,'#forum/t/'+id);
   recalcUser(me.id);grantAch(me.id,'first_post');checkAchs(me.id);
   // опрос при создании
   if(b.poll&&b.poll.question&&Array.isArray(b.poll.options)&&b.poll.options.length>=2){
    const q=oneLine(b.poll.question).slice(0,200);
    const opts=b.poll.options.map(o=>oneLine(o).slice(0,100)).filter(Boolean).slice(0,10);
    if(opts.length>=2){
     const pr=db.prepare('INSERT INTO forum_polls(post_id,question,multi,created) VALUES(?,?,?,?)').run(id,q,b.poll.multi?1:0,now);
     const pid=Number(pr.lastInsertRowid);
     const ins=db.prepare('INSERT INTO forum_poll_opts(poll_id,text,sort) VALUES(?,?,?)');
     opts.forEach((t,i)=>ins.run(pid,t,i));
     db.prepare('UPDATE forum_posts SET poll_id=? WHERE id=?').run(pid,id);
    }
   }
   return ok({ok:true,id});
  }

  // Ответ
  if(url==='/api/forum/reply'){
   const p=db.prepare('SELECT id,cat,title,user_id,closed FROM forum_posts WHERE id=? AND deleted=0').get(+b.post_id);if(!p)return bad('Тема не найдена',404);
   const cat=getCat(p.cat);
   if(cat&&cat.staff&&!staff)return bad('Этот раздел только для чтения',403);
   if(p.closed&&!staff)return bad('Тема закрыта',403);
   const body=bodyOf(10000);if(body.length<2)return bad('Сообщение слишком короткое');
   if(!staff&&isNewbie(me)&&hasLinks(body))return bad('Новичкам нельзя публиковать ссылки в первые часы',403);
   const sw2=hasStopWord(body);if(sw2&&!staff)return bad('Сообщение содержит запрещённое слово',400);
   if(!staff&&flood(me.id,'r',12,12e4))return bad('Слишком часто, подождите немного',429);
   const now=Date.now();
   const r=db.prepare('INSERT INTO forum_replies(post_id,user_id,body,ts,atts) VALUES(?,?,?,?,?)')
    .run(p.id,me.id,body,now,resolveAtts(me.id,b.atts,staff));
   db.prepare('UPDATE forum_posts SET last_ts=?,last_uid=? WHERE id=?').run(now,me.id,p.id);
   if(p.user_id!==me.id)try{H.notify(p.user_id,`${me.username} ответил в вашей теме «${p.title.slice(0,60)}»`)}catch{}
   mentions(body,me.username,me.id,p.title,p.id);
   notifySubs('post',p.id,me.id,`Новый ответ в «${p.title.slice(0,50)}» от ${me.username}`,'#forum/t/'+p.id);
   recalcUser(me.id);checkAchs(me.id);
   return ok({ok:true,id:Number(r.lastInsertRowid)});
  }

  // Редактирование
  if(url==='/api/forum/edit'){
   const isP=b.kind==='p',id=+b.id;
   const row=isP?db.prepare('SELECT * FROM forum_posts WHERE id=? AND deleted=0').get(id)
    :db.prepare('SELECT r.*,p.closed,p.cat FROM forum_replies r JOIN forum_posts p ON p.id=r.post_id WHERE r.id=? AND r.deleted=0').get(id);
   if(!row)return bad('Не найдено',404);
   const cat=getCat(row.cat);
   if(!staff){if(row.user_id!==me.id)return bad('Нет доступа',403);if(row.closed)return bad('Тема закрыта',403);if(cat&&cat.staff)return bad('Раздел только для чтения',403)}
   const body=bodyOf(isP?20000:10000);if(body.length<(isP?3:2))return bad('Сообщение слишком короткое');
   // сохраняем историю
   try{db.prepare('INSERT INTO forum_edits(kind,target_id,user_id,old_body,old_title,ts) VALUES(?,?,?,?,?,?)')
    .run(isP?'p':'r',id,me.id,row.body||'',isP?(row.title||''):'',Date.now())}catch{}
   const atts=resolveAtts(me.id,b.atts,staff);
   if(isP){
    const title=oneLine(b.title||row.title).slice(0,120);
    if(title.length<3)return bad('Заголовок: минимум 3 символа');
    const prefix=PREFIXES.includes(b.prefix)?b.prefix:(row.prefix||'');
    db.prepare('UPDATE forum_posts SET title=?,body=?,prefix=?,atts=?,edited_ts=? WHERE id=?').run(title,body,prefix,atts,Date.now(),id);
   }else{
    db.prepare('UPDATE forum_replies SET body=?,atts=?,edited_ts=? WHERE id=?').run(body,atts,Date.now(),id);
   }
   modlog(me.id,'edit',isP?'post':'reply',id,'');
   return ok({ok:true});
  }

  // Удаление темы (soft)
  if(url==='/api/forum/del'){
   const id=+b.id,p=db.prepare('SELECT * FROM forum_posts WHERE id=? AND deleted=0').get(id);if(!p)return bad('Не найдено',404);
   const n=db.prepare('SELECT COUNT(*) c FROM forum_replies WHERE post_id=? AND deleted=0').get(id).c;
   if(!staff&&!(p.user_id===me.id&&n===0))return bad('Нет доступа (автор может удалить тему только пока в ней нет ответов)',403);
   const now=Date.now();
   db.prepare('UPDATE forum_posts SET deleted=1,deleted_ts=?,deleted_by=? WHERE id=?').run(now,me.id,id);
   db.prepare('UPDATE forum_replies SET deleted=1,deleted_ts=?,deleted_by=? WHERE post_id=? AND deleted=0').run(now,me.id,id);
   modlog(me.id,'del_post','post',id,p.title);
   recalcUser(p.user_id);
   return ok({ok:true,cat:p.cat});
  }

  // Удаление ответа (soft)
  if(url==='/api/forum/del_reply'){
   const id=+b.id,r=db.prepare('SELECT * FROM forum_replies WHERE id=? AND deleted=0').get(id);if(!r)return bad('Не найдено',404);
   if(r.user_id!==me.id&&!staff)return bad('Нет доступа',403);
   db.prepare('UPDATE forum_replies SET deleted=1,deleted_ts=?,deleted_by=? WHERE id=?').run(Date.now(),me.id,id);
   const l=db.prepare('SELECT ts,user_id FROM forum_replies WHERE post_id=? AND deleted=0 ORDER BY id DESC LIMIT 1').get(r.post_id);
   const p=db.prepare('SELECT ts,user_id FROM forum_posts WHERE id=?').get(r.post_id);
   if(p)db.prepare('UPDATE forum_posts SET last_ts=?,last_uid=? WHERE id=?').run(l?l.ts:p.ts,l?l.user_id:p.user_id,r.post_id);
   modlog(me.id,'del_reply','reply',id,'');
   recalcUser(r.user_id);
   return ok({ok:true});
  }

  // Восстановление из корзины
  if(url==='/api/forum/restore'){
   if(!staff)return bad('Только для администраторов',403);
   const kind=b.kind==='r'?'r':'p',id=+b.id;
   if(kind==='p'){
    const p=db.prepare('SELECT * FROM forum_posts WHERE id=? AND deleted=1').get(id);if(!p)return bad('Не найдено',404);
    db.prepare('UPDATE forum_posts SET deleted=0,deleted_ts=0,deleted_by=0 WHERE id=?').run(id);
    db.prepare('UPDATE forum_replies SET deleted=0,deleted_ts=0,deleted_by=0 WHERE post_id=?').run(id);
    modlog(me.id,'restore','post',id,p.title);
    recalcUser(p.user_id);
   }else{
    const r=db.prepare('SELECT * FROM forum_replies WHERE id=? AND deleted=1').get(id);if(!r)return bad('Не найдено',404);
    db.prepare('UPDATE forum_replies SET deleted=0,deleted_ts=0,deleted_by=0 WHERE id=?').run(id);
    modlog(me.id,'restore','reply',id,'');
    recalcUser(r.user_id);
   }
   return ok({ok:true});
  }

  // Лайк + репутация
  if(url==='/api/forum/like'){
   const kind=b.kind==='r'?'r':'p',id=+b.id;
   const t=kind==='p'?db.prepare('SELECT id,user_id FROM forum_posts WHERE id=? AND deleted=0').get(id)
    :db.prepare('SELECT id,user_id FROM forum_replies WHERE id=? AND deleted=0').get(id);
   if(!t)return bad('Не найдено',404);if(t.user_id===me.id)return bad('Нельзя лайкать своё сообщение');
   if(flood(me.id,'l',40,6e4))return bad('Слишком часто',429);
   // защита от накрутки: не больше 30 лайков в час одному пользователю
   const hourLikes=db.prepare(`SELECT COUNT(*) c FROM forum_likes WHERE user_id=? AND target_id IN (
     SELECT id FROM forum_posts WHERE user_id=? UNION SELECT id FROM forum_replies WHERE user_id=?)`).get(me.id,t.user_id,t.user_id).c;
   // упрощённо — проверяем общее
   const has=db.prepare('SELECT 1 FROM forum_likes WHERE user_id=? AND kind=? AND target_id=?').get(me.id,kind,id);
   if(has){
    db.prepare('DELETE FROM forum_likes WHERE user_id=? AND kind=? AND target_id=?').run(me.id,kind,id);
    db.prepare('UPDATE users SET reputation=MAX(0,reputation-1),like_received=MAX(0,like_received-1) WHERE id=?').run(t.user_id);
    try{db.prepare('INSERT INTO rep_log(user_id,from_id,delta,reason,ts) VALUES(?,?,?,?,?)').run(t.user_id,me.id,-1,'unlike',Date.now())}catch{}
   }else{
    // анти-накрутка: лимит 15 лайков в час от одного пользователя
    const likeLim=Math.max(5,Math.min(100,+(getSet('forum_like_hour','15')||15)));
    if(flood(me.id,'like_hour',likeLim,36e5))return bad('Слишком много лайков за короткое время',429);
    // лимит лайков одному автору в сутки
    const dayToAuthor=db.prepare(`SELECT COUNT(*) c FROM forum_likes fl WHERE fl.user_id=? AND fl.kind=? AND fl.target_id IN (
      SELECT id FROM forum_posts WHERE user_id=? UNION SELECT id FROM forum_replies WHERE user_id=?)`).get(me.id,kind,t.user_id,t.user_id).c;
    if(dayToAuthor>=20)return bad('Слишком много лайков этому пользователю',429);
    db.prepare('INSERT INTO forum_likes(user_id,kind,target_id) VALUES(?,?,?)').run(me.id,kind,id);
    db.prepare('UPDATE users SET reputation=reputation+1,like_received=like_received+1 WHERE id=?').run(t.user_id);
    try{db.prepare('INSERT INTO rep_log(user_id,from_id,delta,reason,ts) VALUES(?,?,?,?,?)').run(t.user_id,me.id,1,'like',Date.now())}catch{}
    checkAchs(t.user_id);
   }
   return ok({ok:true,liked:!has,likes:db.prepare('SELECT COUNT(*) c FROM forum_likes WHERE kind=? AND target_id=?').get(kind,id).c});
  }

  // Подписка / отписка
  if(url==='/api/forum/sub'){
   const kind=b.kind==='cat'?'cat':'post';
   const target=String(b.id||'');
   if(!target)return bad('Не указана цель');
   if(kind==='post'){const p=db.prepare('SELECT id FROM forum_posts WHERE id=? AND deleted=0').get(+target);if(!p)return bad('Тема не найдена',404)}
   if(kind==='cat'){const c=getCat(target);if(!c)return bad('Раздел не найден',404)}
   const has=db.prepare('SELECT 1 FROM forum_subs WHERE user_id=? AND kind=? AND target_id=?').get(me.id,kind,target);
   if(has)db.prepare('DELETE FROM forum_subs WHERE user_id=? AND kind=? AND target_id=?').run(me.id,kind,target);
   else db.prepare('INSERT INTO forum_subs(user_id,kind,target_id) VALUES(?,?,?)').run(me.id,kind,target);
   return ok({ok:true,subbed:!has});
  }

  // Жалоба
  if(url==='/api/forum/report'){
   const kind=b.kind==='r'?'r':'p',id=+b.id;
   const reason=oneLine(b.reason||'').slice(0,300);
   if(reason.length<5)return bad('Опишите причину (минимум 5 символов)');
   const t=kind==='p'?db.prepare('SELECT id,user_id FROM forum_posts WHERE id=? AND deleted=0').get(id)
    :db.prepare('SELECT id,user_id FROM forum_replies WHERE id=? AND deleted=0').get(id);
   if(!t)return bad('Не найдено',404);
   if(t.user_id===me.id)return bad('Нельзя жаловаться на своё сообщение');
   if(flood(me.id,'report',5,36e5))return bad('Слишком много жалоб',429);
   const exists=db.prepare('SELECT 1 FROM forum_reports WHERE reporter_id=? AND kind=? AND target_id=? AND status=?').get(me.id,kind,id,'open');
   if(exists)return bad('Вы уже пожаловались на это сообщение');
   db.prepare('INSERT INTO forum_reports(reporter_id,kind,target_id,reason,ts) VALUES(?,?,?,?,?)').run(me.id,kind,id,reason,Date.now());
   return ok({ok:true});
  }

  // Обработка жалобы (staff)
  if(url==='/api/forum/report_handle'){
   if(!staff)return bad('Только для администраторов',403);
   const id=+b.id,rep=db.prepare('SELECT * FROM forum_reports WHERE id=?').get(id);if(!rep)return bad('Не найдено',404);
   const act=String(b.act||'');
   if(act==='dismiss'){
    db.prepare('UPDATE forum_reports SET status=?,handled_by=?,handled_ts=?,note=? WHERE id=?')
     .run('dismissed',me.id,Date.now(),oneLine(b.note||'').slice(0,200),id);
    modlog(me.id,'report_dismiss','report',id,'');
    return ok({ok:true});
   }
   if(act==='delete_warn'){
    // удаляем сообщение + выдаём предупреждение автору
    let authorId=0;
    if(rep.kind==='p'){
     const p=db.prepare('SELECT * FROM forum_posts WHERE id=?').get(rep.target_id);
     if(p){authorId=p.user_id;db.prepare('UPDATE forum_posts SET deleted=1,deleted_ts=?,deleted_by=? WHERE id=?').run(Date.now(),me.id,p.id);
      db.prepare('UPDATE forum_replies SET deleted=1,deleted_ts=?,deleted_by=? WHERE post_id=? AND deleted=0').run(Date.now(),me.id,p.id)}
    }else{
     const r=db.prepare('SELECT * FROM forum_replies WHERE id=?').get(rep.target_id);
     if(r){authorId=r.user_id;db.prepare('UPDATE forum_replies SET deleted=1,deleted_ts=?,deleted_by=? WHERE id=?').run(Date.now(),me.id,r.id)}
    }
    if(authorId){
     db.prepare('UPDATE users SET forum_warns=forum_warns+1 WHERE id=?').run(authorId);
     db.prepare('INSERT INTO forum_warn_log(user_id,admin_id,reason,ts) VALUES(?,?,?,?)')
      .run(authorId,me.id,oneLine(b.note||rep.reason).slice(0,300),Date.now());
     try{H.notify(authorId,`Вы получили предупреждение на форуме: ${(b.note||rep.reason||'').slice(0,100)}`)}catch{}
    }
    db.prepare('UPDATE forum_reports SET status=?,handled_by=?,handled_ts=?,note=? WHERE id=?')
     .run('handled',me.id,Date.now(),oneLine(b.note||'').slice(0,200),id);
    modlog(me.id,'report_delete_warn','report',id,`author=${authorId}`);
    return ok({ok:true});
   }
   return bad('Неизвестное действие');
  }

  // Предупреждение / бан на форуме (staff)
  if(url==='/api/forum/user_mod'){
   if(!staff)return bad('Только для администраторов',403);
   const uid=+b.user_id;if(!uid)return bad('Не указан пользователь');
   const t=db.prepare('SELECT id,username,is_admin FROM users WHERE id=?').get(uid);if(!t)return bad('Пользователь не найден',404);
   if(t.is_admin&&!me.is_super)return bad('Нельзя модерировать администратора',403);
   const act=String(b.act||'');
   if(act==='warn'){
    const reason=oneLine(b.reason||'').slice(0,300)||'Нарушение правил';
    db.prepare('UPDATE users SET forum_warns=forum_warns+1 WHERE id=?').run(uid);
    db.prepare('INSERT INTO forum_warn_log(user_id,admin_id,reason,ts) VALUES(?,?,?,?)').run(uid,me.id,reason,Date.now());
    try{H.notify(uid,`Предупреждение на форуме: ${reason}`)}catch{}
    modlog(me.id,'warn','user',uid,reason);
    return ok({ok:true,warns:(db.prepare('SELECT forum_warns FROM users WHERE id=?').get(uid)||{}).forum_warns});
   }
   if(act==='ban'){
    const days=Math.max(0,Math.min(365,+b.days||0));
    const until=days===0?0:Date.now()+days*864e5; // 0 = снять бан
    const reason=oneLine(b.reason||'').slice(0,300);
    db.prepare('UPDATE users SET forum_ban_until=?,forum_ban_reason=? WHERE id=?').run(until,reason,uid);
    if(until)try{H.notify(uid,`Вы заблокированы на форуме${days?` на ${days} дн.`:''}. Причина: ${reason}`)}catch{}
    else try{H.notify(uid,'Бан на форуме снят')}catch{}
    modlog(me.id,until?'ban':'unban','user',uid,`${days}d: ${reason}`);
    return ok({ok:true,ban_until:until});
   }
   if(act==='clear_warns'){
    db.prepare('UPDATE users SET forum_warns=0 WHERE id=?').run(uid);
    modlog(me.id,'clear_warns','user',uid,'');
    return ok({ok:true});
   }
   return bad('Неизвестное действие');
  }

  // Лучший ответ / Решено
  if(url==='/api/forum/solve'){
   const postId=+b.post_id,replyId=+b.reply_id||0;
   const p=db.prepare('SELECT * FROM forum_posts WHERE id=? AND deleted=0').get(postId);if(!p)return bad('Тема не найдена',404);
   if(p.user_id!==me.id&&!staff)return bad('Только автор темы или модератор',403);
   if(replyId){
    const r=db.prepare('SELECT * FROM forum_replies WHERE id=? AND post_id=? AND deleted=0').get(replyId,postId);
    if(!r)return bad('Ответ не найден',404);
    db.prepare('UPDATE forum_replies SET is_best=0 WHERE post_id=?').run(postId);
    db.prepare('UPDATE forum_replies SET is_best=1 WHERE id=?').run(replyId);
    db.prepare('UPDATE forum_posts SET solved=1,best_reply_id=? WHERE id=?').run(replyId,postId);
    // бонус репутации автору ответа
    if(r.user_id!==p.user_id){
     db.prepare('UPDATE users SET reputation=reputation+5 WHERE id=?').run(r.user_id);
     try{H.notify(r.user_id,`Ваш ответ отмечен решением в теме «${p.title.slice(0,50)}» (+5 репутации)`)}catch{}
     grantAch(r.user_id,'solved');
    }
   }else{
    // просто пометить решено / снять
    const solved=b.solved===false||b.solved===0?0:1;
    db.prepare('UPDATE forum_posts SET solved=?,best_reply_id=? WHERE id=?').run(solved,solved?p.best_reply_id:0,postId);
    if(!solved)db.prepare('UPDATE forum_replies SET is_best=0 WHERE post_id=?').run(postId);
   }
   modlog(me.id,'solve','post',postId,`reply=${replyId}`);
   return ok({ok:true});
  }

  // Голосование в опросе
  if(url==='/api/forum/poll_vote'){
   const pollId=+b.poll_id,optIds=Array.isArray(b.opts)?b.opts.map(Number):[+b.opt_id].filter(Boolean);
   const pl=db.prepare('SELECT * FROM forum_polls WHERE id=?').get(pollId);if(!pl)return bad('Опрос не найден',404);
   if(pl.closed)return bad('Опрос закрыт',403);
   if(!optIds.length)return bad('Выберите вариант');
   const valid=db.prepare('SELECT id FROM forum_poll_opts WHERE poll_id=?').all(pollId).map(o=>o.id);
   const chosen=optIds.filter(id=>valid.includes(id));
   if(!chosen.length)return bad('Некорректные варианты');
   if(!pl.multi&&chosen.length>1)return bad('Можно выбрать только один вариант');
   // удаляем старые голоса
   db.prepare('DELETE FROM forum_poll_votes WHERE poll_id=? AND user_id=?').run(pollId,me.id);
   const ins=db.prepare('INSERT INTO forum_poll_votes(poll_id,user_id,opt_id) VALUES(?,?,?)');
   for(const oid of (pl.multi?chosen:[chosen[0]]))ins.run(pollId,me.id,oid);
   return ok({ok:true});
  }

  // Модерация тем (pin/close/move)
  if(url==='/api/forum/mod'){
   if(!staff)return bad('Только для администраторов',403);
   const id=+b.id,p=db.prepare('SELECT id,cat,title FROM forum_posts WHERE id=? AND deleted=0').get(id);if(!p)return bad('Не найдено',404);
   const a=String(b.act||'');
   if(a==='pin'||a==='unpin'){db.prepare('UPDATE forum_posts SET pinned=? WHERE id=?').run(a==='pin'?1:0,id);modlog(me.id,a,'post',id,'')}
   else if(a==='close'||a==='open'){db.prepare('UPDATE forum_posts SET closed=? WHERE id=?').run(a==='close'?1:0,id);modlog(me.id,a,'post',id,'')}
   else if(a==='move'){const c=getCat(b.cat);if(!c)return bad('Раздел не найден',404);db.prepare('UPDATE forum_posts SET cat=? WHERE id=?').run(c.id,id);modlog(me.id,'move','post',id,c.id)}
   else return bad('Неизвестное действие');
   return ok({ok:true});
  }

  // Управление разделами
  if(url==='/api/forum/cat_save'){
   if(!staff)return bad('Только для администраторов',403);
   const name=oneLine(b.name).slice(0,40);if(name.length<2)return bad('Название: минимум 2 символа');
   const descr=oneLine(b.descr).slice(0,140),grp=oneLine(b.group).slice(0,30)||'Community',st=b.staff?1:0,sort=Math.max(-9999,Math.min(9999,+b.sort||0));
   const icon=ICONS.includes(b.icon)?b.icon:'folder',ex=b.id?getCat(b.id):null;
   if(ex)db.prepare('UPDATE forum_cats SET name=?,descr=?,grp=?,staff=?,sort=?,icon=? WHERE id=?').run(name,descr,grp,st,sort,icon,ex.id);
   else{const id='c'+Date.now().toString(36)+crypto.randomBytes(2).toString('hex');db.prepare('INSERT INTO forum_cats(id,name,descr,grp,staff,sort,icon) VALUES(?,?,?,?,?,?,?)').run(id,name,descr,grp,st,sort,icon)}
   return ok({ok:true});
  }
  if(url==='/api/forum/word_add'){
   if(!staff)return bad('Только для администраторов',403);
   const w=oneLine(b.word).toLowerCase().slice(0,40);if(w.length<2)return bad('Слишком короткое');
   db.prepare('INSERT OR IGNORE INTO forum_words(word) VALUES(?)').run(w);return ok({ok:true});
  }
  if(url==='/api/forum/word_del'){
   if(!staff)return bad('Только для администраторов',403);
   db.prepare('DELETE FROM forum_words WHERE word=?').run(String(b.word||''));return ok({ok:true});
  }
  if(url==='/api/forum/settings'){
   if(!staff)return bad('Только для администраторов',403);
   if(b.newbie_hours!=null)setSet('forum_newbie_hours',Math.max(0,Math.min(168,+b.newbie_hours||0)));
   if(b.like_hour_limit!=null)setSet('forum_like_hour',Math.max(5,Math.min(100,+b.like_hour_limit||15)));
   return ok({ok:true});
  }
  if(url==='/api/forum/cat_del'){
   if(!staff)return bad('Только для администраторов',403);
   const c=getCat(b.id);if(!c)return bad('Не найдено',404);
   if(db.prepare('SELECT COUNT(*) c FROM forum_posts WHERE cat=? AND deleted=0').get(c.id).c)return bad('В разделе есть темы — сначала перенесите или удалите их');
   db.prepare('DELETE FROM forum_cats WHERE id=?').run(c.id);return ok({ok:true});
  }

  return bad('Не найдено',404);
 };

 // ---------- загрузка файлов ----------
 const IMG_MAGIC={png:b=>b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47,jpg:b=>b[0]===0xff&&b[1]===0xd8&&b[2]===0xff,gif:b=>b[0]===0x47&&b[1]===0x49&&b[2]===0x46,
  webp:b=>b.length>12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'};
 IMG_MAGIC.jpeg=IMG_MAGIC.jpg;
 const FILE_EXT=new Set(['zip','rar','7z','gz','tar','txt','pdf','cfg','json','lua','ini','log','md','csv','doc','docx','xls','xlsx','ppt','pptx']);
 const MAX_IMG=8*1024*1024,MAX_FILE=30*1024*1024;
 const UP_DIR=path.join(__dirname,'public','uploads');
 const upload=async(req,res,C,u)=>{
  const send=(c,o)=>C.send(res,c,o);
  const drain=()=>{try{req.resume()}catch{}};
  if(flood(u.id,'u',20,6e5)){drain();return send(429,{error:'Слишком много загрузок, подождите'})}
  // новички — без файлов первые 24ч
  if(isNewbie(u)&&!H.isStaff(u)){drain();return send(403,{error:'Новичкам нельзя загружать файлы первые 24 часа'})}
  const qs=new URL(req.url,'http://x').searchParams;
  let name=path.basename(String(qs.get('n')||'file')).replace(/[\u0000-\u001f<>:"\/\\|?*]/g,'_').slice(-80)||'file';
  const ext=(name.split('.').pop()||'').toLowerCase();
  const isImg=Object.prototype.hasOwnProperty.call(IMG_MAGIC,ext);
  if(!isImg&&!FILE_EXT.has(ext)){drain();return send(400,{error:'Тип файла не разрешён. Разрешены: картинки (png, jpg, gif, webp) и архивы/документы (zip, rar, 7z, txt, pdf, cfg, json, lua…)'})}
  const MAX=isImg?MAX_IMG:MAX_FILE,len=+req.headers['content-length']||0;
  if(len>MAX){drain();return send(413,{error:'Файл слишком большой (макс. '+(MAX>>20)+' МБ)'})}
  const chunks=[];let got=0,over=false;
  await new Promise(ok=>{req.on('data',c=>{got+=c.length;if(got>MAX){over=true;return}if(!over)chunks.push(c)});req.on('end',ok);req.on('error',ok);req.on('aborted',ok)});
  if(over)return send(413,{error:'Файл слишком большой (макс. '+(MAX>>20)+' МБ)'});
  const buf=Buffer.concat(chunks);
  if(buf.length<16)return send(400,{error:'Файл пустой'});
  if(isImg&&!IMG_MAGIC[ext](buf))return send(400,{error:'Файл не является картинкой выбранного формата'});
  // Простая проверка на исполняемые (PE/ELF)
  if(buf[0]===0x4d&&buf[1]===0x5a)return send(400,{error:'Исполняемые файлы запрещены'});
  if(buf[0]===0x7f&&buf[1]===0x45&&buf[2]===0x4c&&buf[3]===0x46)return send(400,{error:'Исполняемые файлы запрещены'});
  try{fs.mkdirSync(UP_DIR,{recursive:true})}catch{}
  const fn='f'+u.id+'_'+Date.now()+'_'+crypto.randomBytes(4).toString('hex')+'.'+ext;
  try{fs.writeFileSync(path.join(UP_DIR,fn),buf)}catch(e){return send(500,{error:'Не удалось сохранить файл'})}
  const url='/uploads/'+fn;
  db.prepare('INSERT INTO forum_files(url,user_id,name,size,img,ts) VALUES(?,?,?,?,?,?)').run(url,u.id,name,buf.length,isImg?1:0,Date.now());
  return send(200,{ok:true,url,name,size:buf.length,img:isImg});
 };

 return {get,post,upload};
};
