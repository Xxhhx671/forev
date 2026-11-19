// forum-api.js — форум в стиле yougame.biz: разделы → темы → ответы, редактор (BB-коды), вложения,
// лайки, закрепление/закрытие/перенос тем, управление разделами. Модерация и staff-разделы — только для staff (админов).
const fs=require('fs'),path=require('path'),crypto=require('crypto');

module.exports=function(db,H){
 // H: { isStaff(user)->bool, notify(uid,text), flHex(id), flBadgeId(id) }
 const run=s=>{try{db.exec(s)}catch{}};

 // ---------- схема ----------
 db.exec(`CREATE TABLE IF NOT EXISTS forum_cats(id TEXT PRIMARY KEY,name TEXT,descr TEXT DEFAULT '',grp TEXT DEFAULT 'Community',staff INTEGER DEFAULT 0,sort INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS forum_likes(user_id INTEGER,kind TEXT,target_id INTEGER,PRIMARY KEY(user_id,kind,target_id));
 CREATE TABLE IF NOT EXISTS forum_files(url TEXT PRIMARY KEY,user_id INTEGER,name TEXT,size INTEGER,img INTEGER DEFAULT 0,ts INTEGER);`);
 for(const c of ["views INTEGER DEFAULT 0","closed INTEGER DEFAULT 0","edited_ts INTEGER DEFAULT 0","last_ts INTEGER DEFAULT 0","last_uid INTEGER DEFAULT 0","prefix TEXT DEFAULT ''","atts TEXT DEFAULT '[]'"])run('ALTER TABLE forum_posts ADD COLUMN '+c);
 for(const c of ["edited_ts INTEGER DEFAULT 0","atts TEXT DEFAULT '[]'"])run('ALTER TABLE forum_replies ADD COLUMN '+c);
 run('UPDATE forum_posts SET last_ts=ts WHERE last_ts IS NULL OR last_ts=0');
 run('CREATE INDEX IF NOT EXISTS ix_fp_cat ON forum_posts(cat,pinned,last_ts)');
 run('CREATE INDEX IF NOT EXISTS ix_fr_post ON forum_replies(post_id)');
 if(!db.prepare('SELECT COUNT(*) c FROM forum_cats').get().c){
  const ins=db.prepare('INSERT INTO forum_cats(id,name,descr,grp,staff,sort) VALUES(?,?,?,?,?,?)');
  [['news','News','Новости проекта','Staff',1,10],['updates','Updates','Обновления и изменения','Staff',1,20],
   ['global','Global','Общие обсуждения','Community',0,30],['cheats','Cheats','Читы: обсуждение, вопросы, помощь','Community',0,40],
   ['crack','Crack','Crack-раздел','Community',0,50],['sources','Исходники читов','Исходники, наработки','Community',0,60],
   ['guides','Гайды','Инструкции и руководства','Community',0,70]].forEach(r=>ins.run(...r));
 }

 // ---------- утилиты ----------
 const PREFIXES=['','Вопрос','Обсуждение','Помощь','Релиз','Гайд','Баг','Идея'];
 const clean=s=>String(s==null?'':s).replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim();
 const oneLine=s=>clean(s).replace(/\s+/g,' ');
 const hits=new Map();
 const flood=(uid,key,max,ms)=>{const k=key+uid,n=Date.now(),a=(hits.get(k)||[]).filter(t=>n-t<ms);a.push(n);hits.set(k,a);return a.length>max};
 const viewSeen=new Map();
 const getCat=id=>db.prepare('SELECT * FROM forum_cats WHERE id=?').get(String(id||''));
 const catOut=c=>({id:c.id,name:c.name,descr:c.descr||'',group:c.grp||'Community',staff:!!c.staff,sort:c.sort||0});
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
 const author=r=>({uid:r.user_id,username:r.username||'удалён',avatar:r.avatar||'',is_admin:!!r.is_admin,role:r.role||'',color:H.flHex(r.nick_color),badge:H.flBadgeId(r.badge),since:r.ucreated||0,msgs:r.msgs||0});
 const likesFor=(kind,ids,uid)=>{
  const m={};if(!ids.length)return m;
  for(const r of db.prepare(`SELECT target_id t,COUNT(*) c,SUM(user_id=?) mine FROM forum_likes WHERE kind=? AND target_id IN (${ids.map(()=>'?').join(',')}) GROUP BY target_id`).all(uid,kind,...ids))m[r.t]={c:r.c,mine:!!r.mine};
  return m;
 };
 const mentions=(body,fromName,fromId,title,pid)=>{
  const names=[...new Set((body.match(/@([A-Za-z0-9_]{3,20})/g)||[]).map(s=>s.slice(1)))].slice(0,5);
  for(const n of names){const t=db.prepare('SELECT id FROM users WHERE username=?').get(n);if(t&&t.id!==fromId)try{H.notify(t.id,`${fromName} упомянул вас в теме «${title.slice(0,60)}»`)}catch{}}
 };
 const USER_COLS='u.username,u.avatar,u.is_admin,u.nick_color,u.badge,u.role';

 // ---------- GET ----------
 const get=(url,qs,u,req,res,C)=>{
  const send=(o,c=200)=>(C.send(res,c,o,{'Cache-Control':'no-store'}),true);
  const staff=H.isStaff(u);

  if(url==='/api/forum/cats'){
   const cnt=Object.fromEntries(db.prepare('SELECT cat,COUNT(*) t FROM forum_posts GROUP BY cat').all().map(r=>[r.cat,r.t]));
   const rep=Object.fromEntries(db.prepare('SELECT p.cat,COUNT(*) t FROM forum_replies r JOIN forum_posts p ON p.id=r.post_id GROUP BY p.cat').all().map(r=>[r.cat,r.t]));
   const cats=db.prepare('SELECT * FROM forum_cats ORDER BY sort,rowid').all().map(c=>{
    const last=db.prepare(`SELECT p.id,p.title,p.last_ts ts,(SELECT username FROM users WHERE id=COALESCE(NULLIF(p.last_uid,0),p.user_id)) username FROM forum_posts p WHERE p.cat=? ORDER BY p.last_ts DESC LIMIT 1`).get(c.id);
    return {...catOut(c),threads:cnt[c.id]||0,posts:(cnt[c.id]||0)+(rep[c.id]||0),last:last||null};
   });
   const tot=db.prepare('SELECT (SELECT COUNT(*) FROM forum_posts) t,(SELECT COUNT(*) FROM forum_replies) r,(SELECT COUNT(*) FROM users) u').get();
   return send({cats,staff,me:{id:u.id,username:u.username},stats:{threads:tot.t,posts:tot.t+tot.r,members:tot.u}});
  }

  if(url==='/api/forum/list'){
   const cat=getCat(qs.get('cat'));if(!cat)return send({error:'Раздел не найден'},404);
   const per=20,q=oneLine(qs.get('q')||'').slice(0,60),sort=String(qs.get('sort')||'last');
   const order={last:'p.last_ts DESC',new:'p.id DESC',views:'p.views DESC',replies:'replies DESC'}[sort]||'p.last_ts DESC';
   const where='p.cat=?'+(q?" AND p.title LIKE ? ESCAPE '\\'":''),args=q?[cat.id,like(q)]:[cat.id];
   const total=db.prepare('SELECT COUNT(*) c FROM forum_posts p WHERE '+where).get(...args).c;
   const pages=Math.max(1,Math.ceil(total/per)),page=Math.min(pages,Math.max(1,+qs.get('page')||1));
   const rows=db.prepare(`SELECT p.id,p.title,p.prefix,p.pinned,p.closed,p.ts,p.views,p.last_ts,p.user_id,${USER_COLS},
     (SELECT COUNT(*) FROM forum_replies r WHERE r.post_id=p.id) replies,
     (SELECT username FROM users WHERE id=COALESCE(NULLIF(p.last_uid,0),p.user_id)) last_name
     FROM forum_posts p LEFT JOIN users u ON u.id=p.user_id WHERE ${where} ORDER BY p.pinned DESC,${order} LIMIT ? OFFSET ?`).all(...args,per,(page-1)*per);
   return send({cat:catOut(cat),list:rows.map(r=>({id:r.id,title:r.title,prefix:r.prefix||'',pinned:!!r.pinned,closed:!!r.closed,ts:r.ts,views:r.views||0,replies:r.replies,last_ts:r.last_ts||r.ts,last_name:r.last_name||r.username||'?',author:author(r)})),
    page,pages,total,per,staff,canCreate:!cat.staff||staff,prefixes:PREFIXES});
  }

  if(url==='/api/forum/search'){
   const q=oneLine(qs.get('q')||'').slice(0,60);if(q.length<2)return send({error:'Минимум 2 символа'},400);
   const rows=db.prepare(`SELECT p.id,p.title,p.prefix,p.ts,p.last_ts,p.cat,c.name cat_name,p.user_id,${USER_COLS},(SELECT COUNT(*) FROM forum_replies r WHERE r.post_id=p.id) replies
     FROM forum_posts p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN forum_cats c ON c.id=p.cat
     WHERE p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\' ORDER BY p.last_ts DESC LIMIT 40`).all(like(q),like(q));
   return send({q,list:rows.map(r=>({id:r.id,title:r.title,prefix:r.prefix||'',ts:r.ts,last_ts:r.last_ts||r.ts,cat:r.cat,cat_name:r.cat_name||r.cat,replies:r.replies,author:author(r)}))});
  }

  if(url==='/api/forum/post'){
   const id=+qs.get('id')||0;
   const p=db.prepare(`SELECT p.*,${USER_COLS},u.created ucreated,(SELECT COUNT(*) FROM forum_posts x WHERE x.user_id=p.user_id)+(SELECT COUNT(*) FROM forum_replies y WHERE y.user_id=p.user_id) msgs
     FROM forum_posts p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=?`).get(id);
   if(!p)return send({error:'Тема не найдена'},404);
   const cat=getCat(p.cat)||{id:p.cat,name:p.cat,staff:0,grp:''};
   const vk=u.id+':'+id,now=Date.now();
   if(!viewSeen.has(vk)||now-viewSeen.get(vk)>18e5){viewSeen.set(vk,now);if(viewSeen.size>20000)viewSeen.clear();db.prepare('UPDATE forum_posts SET views=views+1 WHERE id=?').run(id);p.views=(p.views||0)+1}
   const per=15,total=db.prepare('SELECT COUNT(*) c FROM forum_replies WHERE post_id=?').get(id).c;
   const pages=Math.max(1,Math.ceil(total/per));
   const pg=String(qs.get('page')||'1'),page=pg==='last'?pages:Math.min(pages,Math.max(1,+pg||1));
   const reps=db.prepare(`SELECT r.*,${USER_COLS},u.created ucreated,(SELECT COUNT(*) FROM forum_posts x WHERE x.user_id=r.user_id)+(SELECT COUNT(*) FROM forum_replies y WHERE y.user_id=r.user_id) msgs
     FROM forum_replies r LEFT JOIN users u ON u.id=r.user_id WHERE r.post_id=? ORDER BY r.id LIMIT ? OFFSET ?`).all(id,per,(page-1)*per);
   const lp=likesFor('p',[id],u.id),lr=likesFor('r',reps.map(r=>r.id),u.id);
   const closed=!!p.closed,canWrite=!cat.staff||staff;
   return send({
    cat:catOut({...cat,grp:cat.grp}),staff,me:{id:u.id,username:u.username},prefixes:PREFIXES,
    post:{id:p.id,title:p.title,prefix:p.prefix||'',body:p.body,atts:parseAtts(p.atts),ts:p.ts,edited_ts:p.edited_ts||0,pinned:!!p.pinned,closed,views:p.views||0,
     likes:(lp[id]||{}).c||0,liked:!!(lp[id]||{}).mine,author:author(p),can:{edit:(p.user_id===u.id&&!closed&&canWrite)||staff,del:staff||(p.user_id===u.id&&total===0&&canWrite)}},
    replies:reps.map((r,i)=>({id:r.id,n:(page-1)*per+i+1,body:r.body,atts:parseAtts(r.atts),ts:r.ts,edited_ts:r.edited_ts||0,likes:(lr[r.id]||{}).c||0,liked:!!(lr[r.id]||{}).mine,author:author(r),
     can:{edit:(r.user_id===u.id&&!closed&&canWrite)||staff,del:staff||(r.user_id===u.id&&canWrite)}})),
    page,pages,total,per,canReply:canWrite&&(!closed||staff)
   });
  }
  return send({error:'Не найдено'},404);
 };

 // ---------- POST ----------
 const post=(url,b,me,req,res,C)=>{
  const bad=(m,c=400)=>(C.send(res,c,{error:m}),true),ok=o=>(C.send(res,200,o),true);
  const staff=H.isStaff(me);
  const bodyOf=(max=20000)=>{const t=clean(b.body);return t.length>max?t.slice(0,max):t};

  if(url==='/api/forum/create'){
   const cat=getCat(b.cat);if(!cat)return bad('Раздел не найден',404);
   if(cat.staff&&!staff)return bad('В этом разделе темы создают только администраторы',403);
   const title=oneLine(b.title).slice(0,120),body=bodyOf();
   if(title.length<3)return bad('Заголовок: минимум 3 символа');if(body.length<3)return bad('Сообщение слишком короткое');
   if(!staff&&flood(me.id,'t',5,6e5))return bad('Слишком часто создаёте темы, подождите',429);
   const prefix=PREFIXES.includes(b.prefix)?b.prefix:'',now=Date.now();
   const r=db.prepare('INSERT INTO forum_posts(cat,user_id,title,body,ts,pinned,last_ts,last_uid,prefix,atts) VALUES(?,?,?,?,?,0,?,?,?,?)').run(cat.id,me.id,title,body,now,now,me.id,prefix,resolveAtts(me.id,b.atts,staff));
   const id=Number(r.lastInsertRowid);mentions(body,me.username,me.id,title,id);
   return ok({ok:true,id});
  }

  if(url==='/api/forum/reply'){
   const p=db.prepare('SELECT id,cat,title,user_id,closed FROM forum_posts WHERE id=?').get(+b.post_id);if(!p)return bad('Тема не найдена',404);
   const cat=getCat(p.cat);
   if(cat&&cat.staff&&!staff)return bad('Этот раздел только для чтения',403);
   if(p.closed&&!staff)return bad('Тема закрыта',403);
   const body=bodyOf(10000);if(body.length<2)return bad('Сообщение слишком короткое');
   if(!staff&&flood(me.id,'r',12,12e4))return bad('Слишком часто, подождите немного',429);
   const now=Date.now();
   const r=db.prepare('INSERT INTO forum_replies(post_id,user_id,body,ts,atts) VALUES(?,?,?,?,?)').run(p.id,me.id,body,now,resolveAtts(me.id,b.atts,staff));
   db.prepare('UPDATE forum_posts SET last_ts=?,last_uid=? WHERE id=?').run(now,me.id,p.id);
   if(p.user_id!==me.id)try{H.notify(p.user_id,`${me.username} ответил в вашей теме «${p.title.slice(0,60)}»`)}catch{}
   mentions(body,me.username,me.id,p.title,p.id);
   return ok({ok:true,id:Number(r.lastInsertRowid)});
  }

  if(url==='/api/forum/edit'){
   const isP=b.kind==='p',id=+b.id;
   const row=isP?db.prepare('SELECT * FROM forum_posts WHERE id=?').get(id):db.prepare('SELECT r.*,p.closed,p.cat FROM forum_replies r JOIN forum_posts p ON p.id=r.post_id WHERE r.id=?').get(id);
   if(!row)return bad('Не найдено',404);
   const cat=getCat(row.cat);
   if(!staff){if(row.user_id!==me.id)return bad('Нет доступа',403);if(row.closed)return bad('Тема закрыта',403);if(cat&&cat.staff)return bad('Раздел только для чтения',403)}
   const body=bodyOf(isP?20000:10000);if(body.length<(isP?3:2))return bad('Сообщение слишком короткое');
   const atts=resolveAtts(row.user_id,b.atts,staff),now=Date.now();
   if(isP){
    const title=oneLine(b.title).slice(0,120);if(title.length<3)return bad('Заголовок: минимум 3 символа');
    const prefix=PREFIXES.includes(b.prefix)?b.prefix:'';
    db.prepare('UPDATE forum_posts SET title=?,prefix=?,body=?,atts=?,edited_ts=? WHERE id=?').run(title,prefix,body,atts,now,id);
   }else db.prepare('UPDATE forum_replies SET body=?,atts=?,edited_ts=? WHERE id=?').run(body,atts,now,id);
   return ok({ok:true});
  }

  if(url==='/api/forum/del'){
   const id=+b.id,p=db.prepare('SELECT * FROM forum_posts WHERE id=?').get(id);if(!p)return bad('Не найдено',404);
   const n=db.prepare('SELECT COUNT(*) c FROM forum_replies WHERE post_id=?').get(id).c;
   if(!staff&&!(p.user_id===me.id&&n===0))return bad('Нет доступа (автор может удалить тему только пока в ней нет ответов)',403);
   db.prepare("DELETE FROM forum_likes WHERE kind='r' AND target_id IN (SELECT id FROM forum_replies WHERE post_id=?)").run(id);
   db.prepare('DELETE FROM forum_replies WHERE post_id=?').run(id);
   db.prepare("DELETE FROM forum_likes WHERE kind='p' AND target_id=?").run(id);
   db.prepare('DELETE FROM forum_posts WHERE id=?').run(id);
   return ok({ok:true,cat:p.cat});
  }

  if(url==='/api/forum/del_reply'){
   const id=+b.id,r=db.prepare('SELECT * FROM forum_replies WHERE id=?').get(id);if(!r)return bad('Не найдено',404);
   if(r.user_id!==me.id&&!staff)return bad('Нет доступа',403);
   db.prepare('DELETE FROM forum_replies WHERE id=?').run(id);
   db.prepare("DELETE FROM forum_likes WHERE kind='r' AND target_id=?").run(id);
   const l=db.prepare('SELECT ts,user_id FROM forum_replies WHERE post_id=? ORDER BY id DESC LIMIT 1').get(r.post_id);
   const p=db.prepare('SELECT ts,user_id FROM forum_posts WHERE id=?').get(r.post_id);
   if(p)db.prepare('UPDATE forum_posts SET last_ts=?,last_uid=? WHERE id=?').run(l?l.ts:p.ts,l?l.user_id:p.user_id,r.post_id);
   return ok({ok:true});
  }

  if(url==='/api/forum/like'){
   const kind=b.kind==='r'?'r':'p',id=+b.id;
   const t=kind==='p'?db.prepare('SELECT id,user_id FROM forum_posts WHERE id=?').get(id):db.prepare('SELECT id,user_id FROM forum_replies WHERE id=?').get(id);
   if(!t)return bad('Не найдено',404);if(t.user_id===me.id)return bad('Нельзя лайкать своё сообщение');
   if(flood(me.id,'l',40,6e4))return bad('Слишком часто',429);
   const has=db.prepare('SELECT 1 FROM forum_likes WHERE user_id=? AND kind=? AND target_id=?').get(me.id,kind,id);
   if(has)db.prepare('DELETE FROM forum_likes WHERE user_id=? AND kind=? AND target_id=?').run(me.id,kind,id);
   else db.prepare('INSERT INTO forum_likes(user_id,kind,target_id) VALUES(?,?,?)').run(me.id,kind,id);
   return ok({ok:true,liked:!has,likes:db.prepare('SELECT COUNT(*) c FROM forum_likes WHERE kind=? AND target_id=?').get(kind,id).c});
  }

  // ----- модерация (staff) -----
  if(url==='/api/forum/mod'){
   if(!staff)return bad('Только для администраторов',403);
   const id=+b.id,p=db.prepare('SELECT id,cat FROM forum_posts WHERE id=?').get(id);if(!p)return bad('Не найдено',404);
   const a=String(b.act||'');
   if(a==='pin'||a==='unpin')db.prepare('UPDATE forum_posts SET pinned=? WHERE id=?').run(a==='pin'?1:0,id);
   else if(a==='close'||a==='open')db.prepare('UPDATE forum_posts SET closed=? WHERE id=?').run(a==='close'?1:0,id);
   else if(a==='move'){const c=getCat(b.cat);if(!c)return bad('Раздел не найден',404);db.prepare('UPDATE forum_posts SET cat=? WHERE id=?').run(c.id,id)}
   else return bad('Неизвестное действие');
   return ok({ok:true});
  }
  if(url==='/api/forum/cat_save'){
   if(!staff)return bad('Только для администраторов',403);
   const name=oneLine(b.name).slice(0,40);if(name.length<2)return bad('Название: минимум 2 символа');
   const descr=oneLine(b.descr).slice(0,140),grp=oneLine(b.group).slice(0,30)||'Community',st=b.staff?1:0,sort=Math.max(-9999,Math.min(9999,+b.sort||0));
   const ex=b.id?getCat(b.id):null;
   if(ex)db.prepare('UPDATE forum_cats SET name=?,descr=?,grp=?,staff=?,sort=? WHERE id=?').run(name,descr,grp,st,sort,ex.id);
   else{const id='c'+Date.now().toString(36)+crypto.randomBytes(2).toString('hex');db.prepare('INSERT INTO forum_cats(id,name,descr,grp,staff,sort) VALUES(?,?,?,?,?,?)').run(id,name,descr,grp,st,sort)}
   return ok({ok:true});
  }
  if(url==='/api/forum/cat_del'){
   if(!staff)return bad('Только для администраторов',403);
   const c=getCat(b.id);if(!c)return bad('Не найдено',404);
   if(db.prepare('SELECT COUNT(*) c FROM forum_posts WHERE cat=?').get(c.id).c)return bad('В разделе есть темы — сначала перенесите или удалите их');
   db.prepare('DELETE FROM forum_cats WHERE id=?').run(c.id);return ok({ok:true});
  }
  return bad('Не найдено',404);
 };

 // ---------- загрузка файлов (raw body, см. server.js) ----------
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
  try{fs.mkdirSync(UP_DIR,{recursive:true})}catch{}
  const fn='f'+u.id+'_'+Date.now()+'_'+crypto.randomBytes(4).toString('hex')+'.'+ext;
  try{fs.writeFileSync(path.join(UP_DIR,fn),buf)}catch(e){return send(500,{error:'Не удалось сохранить файл'})}
  const url='/uploads/'+fn;
  db.prepare('INSERT INTO forum_files(url,user_id,name,size,img,ts) VALUES(?,?,?,?,?,?)').run(url,u.id,name,buf.length,isImg?1:0,Date.now());
  return send(200,{ok:true,url,name,size:buf.length,img:isImg});
 };

 return {get,post,upload};
};
