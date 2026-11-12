// FOREV EXT — сервер без зависимостей. Нужен Node.js 22.5+  (запуск: node server.js)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const DBP=process.env.DB_PATH||path.join(__dirname,'forev.db');
fs.mkdirSync(path.dirname(DBP),{recursive:true});
const db=new DatabaseSync(DBP);
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE,email TEXT UNIQUE COLLATE NOCASE,hash TEXT,salt TEXT,created INTEGER,sub_until INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER);
CREATE TABLE IF NOT EXISTS keys(code TEXT PRIMARY KEY,days INTEGER,used_by INTEGER);`);

// Генерация ключа подписки: node server.js genkey 30
if(process.argv[2]==='genkey'){
  const days=+process.argv[3]||30;
  const c=makeKey();
  db.prepare('INSERT INTO keys(code,days) VALUES(?,?)').run(c,days);
  console.log(c,'—',days,'дн.');process.exit();
}

const PUB=path.join(__dirname,'public');
const MIME={'.html':'text/html; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
const SEC=process.env.NODE_ENV==='production'?'; Secure':'';
function makeKey(){return 'FOREV-'+crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-')}
const hashPw=(pw,salt)=>crypto.scryptSync(pw,salt,64).toString('hex');
const tries=new Map();
const limited=ip=>{const n=Date.now(),a=(tries.get(ip)||[]).filter(t=>n-t<6e5);a.push(n);tries.set(ip,a);return a.length>20};
const send=(res,code,obj,h={})=>{res.writeHead(code,{'Content-Type':'application/json','X-Content-Type-Options':'nosniff',...h});res.end(JSON.stringify(obj))};
const body=req=>new Promise((ok,no)=>{let d='';req.on('data',c=>{d+=c;if(d.length>1e4){no();req.destroy()}});req.on('end',()=>{try{ok(JSON.parse(d||'{}'))}catch{no()}})});
const cookie=req=>Object.fromEntries((req.headers.cookie||'').split(/;\s*/).map(c=>c.split('=')));
const authUser=req=>{
  const t=cookie(req).sid;if(!t)return null;
  const s=db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(t,Date.now());
  return s?db.prepare('SELECT id,username,email,created,sub_until FROM users WHERE id=?').get(s.user_id):null;
};
const login=(res,uid)=>{
  const t=crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(t,uid,Date.now()+6048e5);
  return {'Set-Cookie':`sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${SEC}`};
};

http.createServer(async(req,res)=>{
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
    if(req.url==='/api/me'&&req.method==='GET'){
      const u=authUser(req);return u?send(res,200,u):send(res,401,{error:'Не авторизован'});
    }
    if(req.method!=='POST'||!req.url.startsWith('/api/'))return send(res,404,{error:'Не найдено'});
    if(limited(ip))return send(res,429,{error:'Слишком много попыток, подождите'});
    const b=await body(req);

    if(req.url==='/api/admin/genkey'){ // выдача ключей: заголовок x-admin-token = переменная ADMIN_TOKEN
      const t=process.env.ADMIN_TOKEN||'',h=String(req.headers['x-admin-token']||''),A=Buffer.from(t),B=Buffer.from(h);
      if(!t||A.length!==B.length||!crypto.timingSafeEqual(A,B))return send(res,403,{error:'Нет доступа'});
      const days=Math.min(Math.max(+b.days||30,1),3650),n=Math.min(Math.max(+b.count||1,1),50),keys=[];
      for(let i=0;i<n;i++){const c=makeKey();db.prepare('INSERT INTO keys(code,days) VALUES(?,?)').run(c,days);keys.push(c)}
      return send(res,200,{days,keys});
    }

    if(req.url==='/api/register'){
      const {username,email,password}=b;
      if(!/^[A-Za-z0-9_]{3,20}$/.test(username||''))return send(res,400,{error:'Ник: 3–20 символов (латиница, цифры, _)'});
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email||''))return send(res,400,{error:'Некорректный e-mail'});
      if(typeof password!=='string'||password.length<8)return send(res,400,{error:'Пароль минимум 8 символов'});
      if(db.prepare('SELECT 1 FROM users WHERE username=? OR email=?').get(username,email))return send(res,409,{error:'Ник или e-mail уже занят'});
      const salt=crypto.randomBytes(16).toString('hex');
      const r=db.prepare('INSERT INTO users(username,email,hash,salt,created) VALUES(?,?,?,?,?)').run(username,email,hashPw(password,salt),salt,Date.now());
      return send(res,200,{ok:true},login(res,Number(r.lastInsertRowid)));
    }
    if(req.url==='/api/login'){
      const u=db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(b.login||'',b.login||'');
      const bad=()=>send(res,401,{error:'Неверный логин или пароль'});
      if(!u||typeof b.password!=='string')return bad();
      const a=Buffer.from(hashPw(b.password,u.salt),'hex'),c=Buffer.from(u.hash,'hex');
      if(!crypto.timingSafeEqual(a,c))return bad();
      return send(res,200,{ok:true},login(res,u.id));
    }
    if(req.url==='/api/logout'){
      db.prepare('DELETE FROM sessions WHERE token=?').run(cookie(req).sid||'');
      return send(res,200,{ok:true},{'Set-Cookie':'sid=; Max-Age=0; Path=/'});
    }
    if(req.url==='/api/redeem'){
      const u=authUser(req);if(!u)return send(res,401,{error:'Не авторизован'});
      const k=db.prepare('SELECT * FROM keys WHERE code=? AND used_by IS NULL').get(String(b.key||'').trim().toUpperCase());
      if(!k)return send(res,400,{error:'Ключ недействителен или уже использован'});
      const until=Math.max(Date.now(),u.sub_until)+k.days*864e5;
      db.prepare('UPDATE keys SET used_by=? WHERE code=?').run(u.id,k.code);
      db.prepare('UPDATE users SET sub_until=? WHERE id=?').run(until,u.id);
      return send(res,200,{ok:true,sub_until:until});
    }
    send(res,404,{error:'Не найдено'});
  }catch(e){send(res,400,{error:'Ошибка запроса'})}
}).listen(process.env.PORT||3000,()=>console.log('FOREV EXT: http://localhost:'+(process.env.PORT||3000)));

require('./keepalive')(); // анти-сон, настраивается через PING_URL
