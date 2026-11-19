/* FRV Forum — форум в стиле yougame.biz: разделы → темы → ответы, редактор с BB-кодами, вложения, лайки, модерация.
   Работает внутри #fmRoot (страница #forumPage). Роутинг через location.hash: #forum, #forum/c/<cat>/<page>, #forum/t/<id>/<page|last>, #forum/new/<cat>, #forum/s/<query> */
(function(){
if(window.__fxLoaded)return;window.__fxLoaded=1;

/* ---------- утилиты ---------- */
const R=()=>document.getElementById('fmRoot');
const E=s=>esc(String(s==null?'':s));
const U=u=>(typeof u==='string'&&u[0]==='/'&&window.API_BASE)?API_BASE+u:u;
const pad=n=>String(n).padStart(2,'0');
const dtf=ts=>{const d=new Date(ts),n=new Date(),t0=new Date(n.getFullYear(),n.getMonth(),n.getDate()).getTime(),hm=pad(d.getHours())+':'+pad(d.getMinutes());
 return ts>=t0?'Сегодня, '+hm:ts>=t0-864e5?'Вчера, '+hm:pad(d.getDate())+'.'+pad(d.getMonth()+1)+'.'+d.getFullYear()+', '+hm};
const ago=ts=>{const s=(Date.now()-ts)/1000;if(s<60)return'только что';if(s<3600)return Math.floor(s/60)+' мин. назад';if(s<86400)return Math.floor(s/3600)+' ч. назад';return dtf(ts)};
const fsize=n=>n<1024?n+' Б':n<1048576?(n/1024).toFixed(1)+' КБ':(n/1048576).toFixed(1)+' МБ';
const nfmt=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e4?Math.round(n/1e3)+'K':n>=1e3?(n/1e3).toFixed(1)+'K':String(n);
const plural=(n,a,b,c)=>{n=Math.abs(n)%100;const m=n%10;return n>10&&n<20?c:m>1&&m<5?b:m===1?a:c};

async function gj(u,n=0){
 let r;
 try{r=await fetch(API_BASE+u,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(15000)})}
 catch{if(n<2){await wait(500*(n+1));return gj(u,n+1)}throw new Error('Нет связи с сервером')}
 if([502,503,504].includes(r.status)&&n<2){await wait(1200);return gj(u,n+1)}
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(j.error||'Ошибка сервера ('+r.status+')');
 return j;
}
const post=(u,d)=>api(u,d||{});
const q=o=>Object.entries(o).filter(([,v])=>v!==''&&v!=null).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');

/* ---------- BB-коды → безопасный HTML ---------- */
const SAFE_COLOR=/^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]{3,20})$/i;
const SAFE_URL=/^(https?:\/\/|\/uploads\/)[^\s"'<>]*$/i;
const SIZES={1:11,2:13,3:15,4:18,5:22,6:28};
function bb(src){
 let t=E(src);
 const codes=[];
 t=t.replace(/\[code\]([\s\S]*?)\[\/code\]/gi,(m,c)=>{codes.push(c.replace(/^\n/,'').replace(/\n$/,''));return '\u0001'+(codes.length-1)+'\u0002'});
 for(let k=0;k<2;k++){
  for(const a of ['b','i','u','s'])t=t.replace(new RegExp('\\['+a+'\\]([\\s\\S]*?)\\[\\/'+a+'\\]','gi'),'<'+a+'>$1</'+a+'>');
  for(const a of ['left','center','right'])t=t.replace(new RegExp('\\['+a+'\\]([\\s\\S]*?)\\[\\/'+a+'\\]','gi'),'<div style="text-align:'+a+'">$1</div>');
  t=t.replace(/\[color=([#\w]+)\]([\s\S]*?)\[\/color\]/gi,(m,c,x)=>SAFE_COLOR.test(c)?'<span style="color:'+c+'">'+x+'</span>':x);
  t=t.replace(/\[size=([1-6])\]([\s\S]*?)\[\/size\]/gi,(m,n,x)=>'<span style="font-size:'+SIZES[n]+'px">'+x+'</span>');
 }
 t=t.replace(/\[url=([^\]\s]+)\]([\s\S]*?)\[\/url\]/gi,(m,u,x)=>SAFE_URL.test(u)?'<a href="'+U(u)+'" target="_blank" rel="noopener noreferrer nofollow">'+x+'</a>':x);
 t=t.replace(/\[url\]([^\s\[]+)\[\/url\]/gi,(m,u)=>SAFE_URL.test(u)?'<a href="'+U(u)+'" target="_blank" rel="noopener noreferrer nofollow">'+u+'</a>':u);
 t=t.replace(/\[img\]([^\s\[]+)\[\/img\]/gi,(m,u)=>SAFE_URL.test(u)?'<img class="fx-img" src="'+U(u)+'" alt="" loading="lazy" data-a="zoom" data-src="'+U(u)+'">':m);
 let g=0;const rq=/\[quote(?:=([^\]]*?))?\]((?:(?!\[quote)[\s\S])*?)\[\/quote\]/i;
 while(g++<8&&rq.test(t))t=t.replace(rq,(m,w,x)=>'<blockquote class="fx-q">'+(w?'<div class="fx-qh">'+w+' писал(а):</div>':'')+x.trim()+'</blockquote>');
 g=0;const rs=/\[spoiler(?:=([^\]]*?))?\]((?:(?!\[spoiler)[\s\S])*?)\[\/spoiler\]/i;
 while(g++<8&&rs.test(t))t=t.replace(rs,(m,w,x)=>'<details class="fx-sp"><summary>'+(w||'Спойлер')+'</summary><div>'+x.trim()+'</div></details>');
 t=t.replace(/\[list\]([\s\S]*?)\[\/list\]/gi,(m,x)=>{const it=x.split('[*]').slice(1).map(s=>'<li>'+s.trim()+'</li>').join('');return '<ul>'+it+'</ul>'});
 t=t.replace(/\[hr\]/gi,'<hr>');
 t=t.replace(/(^|[\s>])@([A-Za-z0-9_]{3,20})/g,'$1<span class="fx-mn">@$2</span>');
 t=t.replace(/(<\/blockquote>|<\/div>|<\/ul>|<hr>|<\/details>)\n/g,'$1').replace(/\n/g,'<br>');
 t=t.replace(/\u0001(\d+)\u0002/g,(m,i)=>'<pre class="fx-code">'+codes[i]+'</pre>');
 return t;
}

/* ---------- загрузка файлов ---------- */
function uploadFile(file,onProg){
 return new Promise((ok,no)=>{
  const x=new XMLHttpRequest();
  x.open('POST',API_BASE+'/api/forum/upload?n='+encodeURIComponent(file.name||'image.png'));
  x.withCredentials=true;x.setRequestHeader('Content-Type','application/octet-stream');
  x.upload.onprogress=e=>{if(e.lengthComputable&&onProg)onProg(Math.round(e.loaded/e.total*100))};
  x.onload=()=>{let j={};try{j=JSON.parse(x.responseText)}catch{}x.status>=200&&x.status<300&&j.url?ok(j):no(new Error(j.error||'Ошибка загрузки ('+x.status+')'))};
  x.onerror=()=>no(new Error('Нет связи с сервером'));
  x.send(file);
 });
}

/* ---------- стили ---------- */
const st=document.createElement('style');st.textContent=`
#fmRoot{--fx-bg:var(--card);--fx-bg2:var(--card2);--fx-ln:var(--bd);--fx-mu:var(--m);--fx-ac:var(--r)}
.fx a{color:var(--fx-ac)}
.fx-load,.fx-empty{padding:40px 10px;text-align:center;color:var(--fx-mu)}
.fx-err{padding:18px;border:1px solid rgba(255,107,138,.4);border-radius:12px;color:#ff6b8a;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.fx-bc{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:13px;color:var(--fx-mu);margin-bottom:14px}
.fx-bc a,.fx-bc button{background:none;border:0;padding:0;color:var(--fx-ac);cursor:pointer;font:inherit}
.fx-bc a:hover,.fx-bc button:hover{text-decoration:underline}
.fx-bc i{font-style:normal;opacity:.5}
.fx-bar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 14px}
.fx-bar h3{margin:0;font-size:clamp(18px,2.4vw,24px)}
.fx-bar small{display:block;color:var(--fx-mu);margin-top:3px;font-weight:400}
.fx-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.fx-in,.fx-sel{padding:9px 12px;border-radius:10px;border:1px solid var(--fx-ln);background:var(--fx-bg2);color:var(--fg);font:inherit;font-size:14px;min-width:0;outline:0}
.fx-in:focus,.fx-sel:focus,.fx-ta:focus{border-color:var(--fx-ac)}
.fx-b{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:10px;border:1px solid var(--fx-ac);background:var(--fx-ac);color:#fff;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer}
.fx-b:hover{filter:brightness(1.1)}.fx-b[disabled]{opacity:.55;cursor:wait}
.fx-b.g{background:transparent;color:var(--fg);border-color:var(--fx-ln)}.fx-b.g:hover{border-color:var(--fx-ac);color:var(--fx-ac)}
.fx-b.d{background:transparent;color:#ff6b8a;border-color:rgba(255,107,138,.45)}
.fx-b.sm{padding:6px 11px;font-size:12.5px}
.fx-grp{margin-bottom:22px;border:1px solid var(--fx-ln);border-radius:14px;overflow:hidden;background:var(--fx-bg)}
.fx-gh{padding:11px 16px;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;color:var(--fx-mu);background:var(--fx-bg2);border-bottom:1px solid var(--fx-ln);display:flex;justify-content:space-between;align-items:center}
.fx-cat,.fx-th{display:grid;gap:14px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--fx-ln);cursor:pointer;transition:background .15s}
.fx-cat:last-child,.fx-th:last-child{border-bottom:0}
.fx-cat:hover,.fx-th:hover{background:rgba(59,158,255,.06)}
.fx-cat{grid-template-columns:44px 1fr 80px 90px minmax(0,250px)}
.fx-ci{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-weight:800;font-size:18px;background:linear-gradient(135deg,rgba(59,158,255,.28),rgba(59,158,255,.06));color:var(--fx-ac)}
.fx-ci svg{display:block}
.fx-icons{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}.fx-mb .fx-ic{display:block;cursor:pointer}.fx-ic input{position:absolute;opacity:0;pointer-events:none}.fx-ic span{display:grid;place-items:center;height:38px;border:1px solid var(--fx-ln);border-radius:9px;background:var(--fx-bg2);color:var(--fx-mu)}.fx-ic input:checked+span{border-color:var(--fx-ac);color:var(--fx-ac);background:rgba(59,158,255,.14)}.fx-ic:hover span{border-color:var(--fx-ac)}
.fx-cm b,.fx-tm b{font-size:15px}.fx-cm small{display:block;color:var(--fx-mu);margin-top:2px}
.fx-cs{text-align:center}.fx-cs b{display:block;font-size:15px}.fx-cs small{color:var(--fx-mu);font-size:11.5px}
.fx-cl{font-size:12.5px;color:var(--fx-mu);min-width:0}.fx-cl a{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg);cursor:pointer}
.fx-cl a:hover{color:var(--fx-ac)}
.fx-tag{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.5px;padding:2px 7px;border-radius:6px;margin-left:6px;vertical-align:middle;text-transform:uppercase}
.fx-tag.st{background:rgba(245,158,11,.15);color:#f59e0b}.fx-tag.ro{background:rgba(138,138,154,.18);color:var(--fx-mu)}
.fx-th{grid-template-columns:42px 1fr 74px 84px 150px}
.fx-tm{min-width:0}.fx-tm b{display:inline;word-break:break-word}.fx-tm small{display:block;color:var(--fx-mu);margin-top:3px}
.fx-pfx{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;background:rgba(59,158,255,.15);color:var(--fx-ac);margin-right:7px}
.fx-pin{color:#f59e0b;margin-right:5px}.fx-lock{color:var(--fx-mu);margin-right:5px}
.fx-th.pinned{background:rgba(245,158,11,.05)}
.fx-ts{text-align:center}.fx-ts b{display:block}.fx-ts small{color:var(--fx-mu);font-size:11.5px}
.fx-tl{font-size:12.5px;color:var(--fx-mu);text-align:right}.fx-tl b{display:block;color:var(--fg);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fx-avw{flex:none;border-radius:50%;background:var(--fx-bg2);display:grid;place-items:center;overflow:hidden;font-weight:700;color:var(--fx-ac);border:1px solid var(--fx-ln)}
.fx-avw img{width:100%;height:100%;object-fit:cover}
.fx-pg{display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin:16px 0}
.fx-pg button{min-width:36px;height:36px;padding:0 10px;border-radius:9px;border:1px solid var(--fx-ln);background:var(--fx-bg);color:var(--fg);cursor:pointer;font:inherit}
.fx-pg button.on{background:var(--fx-ac);border-color:var(--fx-ac);color:#fff}.fx-pg button:hover:not(.on){border-color:var(--fx-ac)}
.fx-pg span{align-self:center;color:var(--fx-mu)}
.fx-stats{display:flex;gap:22px;flex-wrap:wrap;color:var(--fx-mu);font-size:13px;padding:6px 4px}.fx-stats b{color:var(--fg)}
.fx-h,.fx-bar h3{text-align:left;text-transform:none;letter-spacing:0;font-family:inherit}
.fx-h{margin:0 0 6px;font-size:clamp(19px,2.6vw,26px);line-height:1.25;word-break:break-word}
.fx-meta{color:var(--fx-mu);font-size:13px;margin-bottom:14px}
.fx-mod{display:flex;gap:6px;flex-wrap:wrap;padding:10px 12px;border:1px dashed rgba(245,158,11,.5);border-radius:12px;margin-bottom:14px;align-items:center;font-size:12.5px;color:#f59e0b}
.fx-p{display:grid;grid-template-columns:190px minmax(0,1fr);border:1px solid var(--fx-ln);border-radius:14px;background:var(--fx-bg);margin-bottom:12px;overflow:hidden}
.fx-pa{padding:18px 12px;text-align:center;background:var(--fx-bg2);border-right:1px solid var(--fx-ln);font-size:12.5px;color:var(--fx-mu)}
.fx-pa .fx-avw{margin:0 auto 10px}.fx-un{display:block;font-size:14.5px;font-weight:700;color:var(--fg);cursor:pointer;word-break:break-word}.fx-un:hover{color:var(--fx-ac)}
.fx-role{display:inline-block;margin:6px 0;padding:2px 9px;border-radius:6px;font-size:10.5px;font-weight:800;letter-spacing:.5px;background:rgba(59,158,255,.15);color:var(--fx-ac);text-transform:uppercase}
.fx-rank{font-size:11px;font-weight:700;margin-top:2px}
.fx-best{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;background:rgba(52,211,153,.2);color:#34d399}
.fx-best-post{border-color:rgba(52,211,153,.45)}
.fx-solved{color:#34d399;font-weight:700}
.fx-poll{margin:12px 0;padding:14px;border:1px solid var(--fx-ln);border-radius:12px;background:rgba(0,0,0,.15)}
.fx-poll-q{margin-bottom:10px}
.fx-poll-opt{display:flex;align-items:center;gap:10px;margin:6px 0;flex-wrap:wrap}
.fx-poll-bar{flex:1;min-width:80px;height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden}
.fx-poll-bar i{display:block;height:100%;background:var(--fx-ac);border-radius:4px}
.fx-poll-total{margin-top:8px;font-size:12px;color:var(--fx-mu)}

.fx-pc{padding:14px 18px;min-width:0;display:flex;flex-direction:column}
.fx-ph{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;color:var(--fx-mu);padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid var(--fx-ln)}
.fx-body{line-height:1.6;font-size:14.5px;word-break:break-word;overflow-wrap:anywhere;flex:1}
.fx-body a{text-decoration:underline}
.fx-body ul{margin:8px 0;padding-left:22px}.fx-body hr{border:0;border-top:1px solid var(--fx-ln);margin:12px 0}
.fx-img{max-width:100%;max-height:520px;border-radius:10px;cursor:zoom-in;margin:6px 0;display:block}
.fx-q{margin:10px 0;padding:10px 14px;border-left:3px solid var(--fx-ac);background:var(--fx-bg2);border-radius:0 10px 10px 0;font-size:13.5px;color:var(--fx-mu)}
.fx-qh{font-weight:700;color:var(--fx-ac);margin-bottom:4px;font-size:12.5px}
.fx-sp{margin:10px 0;border:1px solid var(--fx-ln);border-radius:10px;background:var(--fx-bg2)}.fx-sp summary{padding:9px 13px;cursor:pointer;font-weight:600}.fx-sp>div{padding:4px 13px 12px}
.fx-code{margin:10px 0;padding:12px 14px;background:#05070b;color:#d6e2f5;border:1px solid var(--fx-ln);border-radius:10px;overflow:auto;font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre}
.fx-mn{color:var(--fx-ac);font-weight:600}
.fx-at{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:12px;border-top:1px dashed var(--fx-ln)}
.fx-at a.f{display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--fx-ln);border-radius:10px;background:var(--fx-bg2);color:var(--fg);text-decoration:none;font-size:13px;max-width:100%}
.fx-at a.f:hover{border-color:var(--fx-ac)}.fx-at a.f span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fx-at a.f small{color:var(--fx-mu)}
.fx-at img{height:86px;border-radius:9px;border:1px solid var(--fx-ln);cursor:zoom-in}
.fx-edn{font-size:12px;color:var(--fx-mu);margin-top:10px;font-style:italic}
.fx-pf{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;align-items:center}
.fx-pf button{background:none;border:1px solid transparent;color:var(--fx-mu);padding:5px 10px;border-radius:8px;cursor:pointer;font:inherit;font-size:12.5px}
.fx-pf button:hover{color:var(--fx-ac);border-color:var(--fx-ln)}.fx-pf .lk.on{color:#ff5c8a;border-color:rgba(255,92,138,.4)}.fx-pf .sp{flex:1}
.fx-note{padding:14px 16px;border:1px solid var(--fx-ln);border-radius:12px;color:var(--fx-mu);background:var(--fx-bg);text-align:center}
/* редактор */
.fx-ed{border:1px solid var(--fx-ln);border-radius:12px;background:var(--fx-bg);overflow:hidden}
.fx-tb{display:flex;flex-wrap:wrap;gap:3px;padding:7px;background:var(--fx-bg2);border-bottom:1px solid var(--fx-ln);position:relative}
.fx-tb button,.fx-tb select,.fx-tb label{min-width:32px;height:32px;padding:0 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--fg);cursor:pointer;font:inherit;font-size:13px;display:inline-flex;align-items:center;justify-content:center}
.fx-tb button:hover,.fx-tb label:hover{background:rgba(59,158,255,.14);color:var(--fx-ac)}
.fx-tb select{background:var(--fx-bg2);border-color:var(--fx-ln)}.fx-tb input[type=color]{width:26px;height:26px;padding:0;border:0;background:none;cursor:pointer}
.fx-tb .sep{width:1px;background:var(--fx-ln);margin:3px 4px}
.fx-emo{position:absolute;top:44px;left:7px;z-index:5;display:none;grid-template-columns:repeat(8,1fr);gap:2px;padding:8px;border:1px solid var(--fx-ln);border-radius:12px;background:var(--fx-bg);box-shadow:0 12px 40px rgba(0,0,0,.5)}
.fx-emo.on{display:grid}.fx-emo button{font-size:19px;min-width:34px;height:34px;padding:0}
.fx-tabs{display:flex;gap:2px;padding:6px 7px 0;border-bottom:1px solid var(--fx-ln)}
.fx-tabs button{padding:7px 14px;border:0;border-radius:8px 8px 0 0;background:none;color:var(--fx-mu);cursor:pointer;font:inherit;font-size:13px}.fx-tabs button.on{background:var(--fx-bg2);color:var(--fg);font-weight:600}
.fx-ta{display:block;width:100%;min-height:170px;padding:13px 15px;border:0;background:transparent;color:var(--fg);font:inherit;font-size:14.5px;line-height:1.55;resize:vertical;outline:0;box-sizing:border-box}
.fx-prev{min-height:170px;padding:13px 15px}
.fx-atl{display:flex;flex-wrap:wrap;gap:8px;padding:0 12px 10px}
.fx-chip{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 10px;border:1px solid var(--fx-ln);border-radius:10px;background:var(--fx-bg2);font-size:12.5px;max-width:100%}
.fx-chip img{height:34px;border-radius:6px}.fx-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}
.fx-chip button{background:none;border:0;color:var(--fx-mu);cursor:pointer;font:inherit;font-size:12px;padding:3px 6px;border-radius:6px}.fx-chip button:hover{color:var(--fx-ac)}.fx-chip button.x:hover{color:#ff6b8a}
.fx-ef{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-top:1px solid var(--fx-ln);background:var(--fx-bg2);font-size:12px;color:var(--fx-mu)}
.fx-up{color:var(--fx-ac)}
.fx-form{display:grid;gap:10px;max-width:100%}
.fx-form .fx-in{width:100%;box-sizing:border-box}
.fx-ov{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.78);display:grid;place-items:center;padding:18px}
.fx-mb{width:min(460px,100%);background:var(--fx-bg);border:1px solid var(--fx-ln);border-radius:16px;padding:20px;display:grid;gap:11px;max-height:90vh;overflow:auto}
.fx-mb h4{margin:0 0 4px;font-size:17px}.fx-mb label{font-size:12.5px;color:var(--fx-mu);display:grid;gap:5px}.fx-mb .fx-in{width:100%;box-sizing:border-box}
.fx-chk{display:flex!important;grid-template-columns:none!important;flex-direction:row;align-items:center;gap:9px!important}
.fx-lb{position:fixed;inset:0;z-index:130;background:rgba(0,0,0,.9);display:grid;place-items:center;cursor:zoom-out;padding:20px}.fx-lb img{max-width:96vw;max-height:94vh;border-radius:8px}
@media(max-width:860px){
 .fx-cat{grid-template-columns:40px 1fr;gap:10px}.fx-cat .fx-cs,.fx-cat .fx-cl{display:none}
 .fx-th{grid-template-columns:36px 1fr;gap:10px}.fx-th .fx-ts,.fx-th .fx-tl{display:none}
 .fx-p{grid-template-columns:1fr}.fx-pa{display:flex;gap:10px;align-items:center;text-align:left;border-right:0;border-bottom:1px solid var(--fx-ln);padding:10px 14px}.fx-pa .fx-avw{margin:0}
 .fx-pa .xtra{display:none}.fx-pc{padding:12px 14px}
}`;
document.head.appendChild(st);

/* ---------- общие куски ---------- */
let CATS=null,ME=null,TOK=0;
const av=(a,s=40)=>`<span class="fx-avw" data-av="${E(a.avatar||'')}" data-u="${E(a.username)}" style="width:${s}px;height:${s}px;font-size:${Math.round(s*.4)}px"></span>`;
const hydrate=el=>el.querySelectorAll('[data-av]:not([data-ok])').forEach(n=>{n.dataset.ok=1;avFill(n,n.dataset.av?U(n.dataset.av):'',n.dataset.u)});
const roleOf=a=>a.is_admin?'Администратор':a.role==='moderator'?'Модератор':a.role==='support'?'Поддержка':'';
const nameHtml=a=>`${a.badge&&window.flBadge&&window.FLB&&FLB[a.badge]?`<span class="fl-bd">${flBadge(a.badge,14)}</span> `:''}<span${a.color?` style="color:${E(a.color)}"`:''}>${E(a.username)}</span>`;
const ICON_SVG={
 folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
 globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
 news:'<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
 update:'<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
 target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
 key:'<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
 code:'<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
 book:'<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 1h13v-3M8.5 7.5h7"/>',
 chat:'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
 shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
 tools:'<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
 bug:'<rect x="8" y="8" width="8" height="11" rx="4"/><path d="M9 5l1.5 2M15 5l-1.5 2M4 13h4M16 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2"/>',
 image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/>',
 download:'<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
 users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>'
};
const svgIcon=(n,z=22)=>`<svg viewBox="0 0 24 24" width="${z}" height="${z}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_SVG[n]||ICON_SVG.folder}</svg>`;

function pager(page,pages,tag){
 if(pages<=1)return '';
 const set=new Set([1,pages]);for(let i=page-2;i<=page+2;i++)if(i>=1&&i<=pages)set.add(i);
 const arr=[...set].sort((a,b)=>a-b);let h='<div class="fx-pg">';
 if(page>1)h+=`<button data-a="${tag}" data-p="${page-1}">‹</button>`;
 let prev=0;for(const p of arr){if(p-prev>1)h+='<span>…</span>';h+=`<button data-a="${tag}" data-p="${p}"${p===page?' class="on"':''}>${p}</button>`;prev=p}
 if(page<pages)h+=`<button data-a="${tag}" data-p="${page+1}">›</button>`;
 return h+'</div>';
}
const attsHtml=list=>{
 if(!list||!list.length)return '';
 return '<div class="fx-at">'+list.map(f=>f.img?`<img src="${E(U(f.url))}" alt="${E(f.name)}" title="${E(f.name)}" loading="lazy" data-a="zoom" data-src="${E(U(f.url))}">`
  :`<a class="f" href="${E(U(f.url))}" download="${E(f.name)}" target="_blank" rel="noopener"><span>📎 ${E(f.name)}</span><small>${fsize(f.size)}</small></a>`).join('')+'</div>';
};
function modal(html,onMount){
 const o=document.createElement('div');o.className='fx-ov';o.innerHTML='<div class="fx-mb">'+html+'</div>';
 o.addEventListener('mousedown',e=>{if(e.target===o)o.remove()});document.body.appendChild(o);
 if(onMount)onMount(o);return o;
}
function navTo(h){if(location.hash===h)route();else location.hash=h}
const bcHtml=parts=>'<div class="fx-bc">'+parts.map((p,i)=>(i?'<i>›</i>':'')+(p.h?`<a href="${p.h}">${E(p.t)}</a>`:`<span>${E(p.t)}</span>`)).join('')+'</div>';

/* ---------- редактор ---------- */
const EMOJI=['😀','😁','😂','🤣','😉','😊','😎','🤔','😮','😢','😡','👍','👎','🔥','❤️','💯','🎉','👀','🙏','💪','✅','❌','⚠️','⭐'];
function mkEditor(host,o){
 o=o||{};let atts=(o.atts||[]).slice();
 host.innerHTML=`<div class="fx-ed">
  <div class="fx-tb">
   <button type="button" data-t="b" title="Жирный"><b>B</b></button><button type="button" data-t="i" title="Курсив"><i>I</i></button>
   <button type="button" data-t="u" title="Подчёркнутый"><u>U</u></button><button type="button" data-t="s" title="Зачёркнутый"><s>S</s></button>
   <span class="sep"></span>
   <label title="Цвет текста">A<input type="color" data-t="color" value="#ff6b6b"></label>
   <select data-t="size" title="Размер"><option value="">Размер</option><option value="1">Мелкий</option><option value="3">Обычный</option><option value="4">Крупный</option><option value="5">Большой</option><option value="6">Огромный</option></select>
   <span class="sep"></span>
   <button type="button" data-t="left" title="По левому краю">⇤</button><button type="button" data-t="center" title="По центру">≡</button><button type="button" data-t="right" title="По правому краю">⇥</button>
   <span class="sep"></span>
   <button type="button" data-t="url" title="Ссылка">🔗</button><button type="button" data-t="img" title="Картинка по ссылке">🖼</button>
   <label title="Загрузить картинку в текст">⬆🖼<input type="file" data-t="upimg" accept="image/png,image/jpeg,image/gif,image/webp" hidden></label>
   <label title="Прикрепить файлы">📎<input type="file" data-t="attach" multiple hidden></label>
   <span class="sep"></span>
   <button type="button" data-t="quote" title="Цитата">❝</button><button type="button" data-t="code" title="Код">&lt;/&gt;</button>
   <button type="button" data-t="spoiler" title="Спойлер">👁</button><button type="button" data-t="list" title="Список">☰</button>
   <button type="button" data-t="hr" title="Разделитель">—</button><button type="button" data-t="emo" title="Смайлы">😊</button>
   <div class="fx-emo">${EMOJI.map(e=>`<button type="button" data-e="${e}">${e}</button>`).join('')}</div>
  </div>
  <div class="fx-tabs"><button type="button" data-v="e" class="on">Редактор</button><button type="button" data-v="p">Предпросмотр</button></div>
  <textarea class="fx-ta" placeholder="${E(o.placeholder||'Введите текст…')}" maxlength="20000"></textarea>
  <div class="fx-prev fx-body" hidden></div>
  <div class="fx-atl"></div>
  <div class="fx-ef"><span class="fx-hint">Ctrl+Enter — отправить · картинки можно вставлять из буфера и перетаскивать</span><span class="fx-row"><span class="fx-up"></span>${o.onCancel?'<button type="button" class="fx-b g sm" data-t="cancel">Отмена</button>':''}<button type="button" class="fx-b" data-t="send">${E(o.submitLabel||'Отправить')}</button></span></div>
 </div>`;
 const $q=s=>host.querySelector(s),ta=$q('.fx-ta'),prev=$q('.fx-prev'),upl=$q('.fx-up'),emo=$q('.fx-emo'),send=$q('[data-t=send]');
 ta.value=o.value||'';
 const dk=o.draftKey?'fx_draft_'+o.draftKey:null;
 if(dk&&!ta.value){try{ta.value=localStorage.getItem(dk)||''}catch{}}
 let dTimer;ta.addEventListener('input',()=>{if(!dk)return;clearTimeout(dTimer);dTimer=setTimeout(()=>{try{ta.value?localStorage.setItem(dk,ta.value):localStorage.removeItem(dk)}catch{}},400)});
 const wrap=(open,close,ph)=>{const s=ta.selectionStart,e=ta.selectionEnd,sel=ta.value.slice(s,e)||ph||'',v=ta.value;
  ta.value=v.slice(0,s)+open+sel+close+v.slice(e);ta.focus();const a=s+open.length;ta.setSelectionRange(a,a+sel.length);ta.dispatchEvent(new Event('input'))};
 const ins=txt=>{const s=ta.selectionStart,v=ta.value;ta.value=v.slice(0,s)+txt+v.slice(ta.selectionEnd);ta.focus();ta.setSelectionRange(s+txt.length,s+txt.length);ta.dispatchEvent(new Event('input'))};
 const renderAtts=()=>{
  $q('.fx-atl').innerHTML=atts.map((f,i)=>`<div class="fx-chip">${f.img?`<img src="${E(U(f.url))}" alt="">`:'📎'}<span title="${E(f.name)}">${E(f.name)}</span><small>${fsize(f.size)}</small>${f.img?`<button type="button" data-ai="${i}" title="Вставить в текст">в текст</button>`:''}<button type="button" class="x" data-ar="${i}" title="Убрать">✕</button></div>`).join('');
 };
 renderAtts();
 $q('.fx-atl').addEventListener('click',e=>{
  const r=e.target.closest('[data-ar]'),i=e.target.closest('[data-ai]');
  if(r){atts.splice(+r.dataset.ar,1);renderAtts()}
  if(i){const f=atts[+i.dataset.ai];if(f)ins('[img]'+f.url+'[/img]\n')}
 });
 async function doUpload(files,inline){
  for(const f of files){
   if(atts.length>=10&&!inline){toast('Максимум 10 вложений',1);break}
   try{
    upl.textContent='Загрузка '+f.name+'…';
    const r=await uploadFile(f,p=>upl.textContent='Загрузка '+f.name+' '+p+'%');
    if(inline&&r.img)ins('[img]'+r.url+'[/img]\n');else{atts.push({url:r.url,name:r.name,size:r.size,img:!!r.img});renderAtts()}
   }catch(e){toast(e.message,1)}
  }
  upl.textContent='';
 }
 host.querySelector('.fx-tb').addEventListener('click',e=>{
  const eb=e.target.closest('[data-e]');if(eb){ins(eb.dataset.e);emo.classList.remove('on');return}
  const b=e.target.closest('button[data-t]');if(!b)return;const t=b.dataset.t;
  if(['b','i','u','s','left','center','right'].includes(t))wrap('['+t+']','[/'+t+']',t==='b'||t==='i'||t==='u'||t==='s'?'текст':'текст');
  else if(t==='url'){const u=prompt('Адрес ссылки (https://…)');if(!u)return;if(!/^https?:\/\//i.test(u)){toast('Ссылка должна начинаться с http:// или https://',1);return}
   const sel=ta.value.slice(ta.selectionStart,ta.selectionEnd);wrap('[url='+u+']','[/url]',sel||u)}
  else if(t==='img'){const u=prompt('Адрес картинки (https://…)');if(u){if(!/^https?:\/\//i.test(u)){toast('Нужна ссылка http(s)://',1);return}ins('[img]'+u+'[/img]')}}
  else if(t==='quote')wrap('[quote]','[/quote]','цитата');else if(t==='code')wrap('[code]\n','\n[/code]','код');
  else if(t==='spoiler')wrap('[spoiler=Название]','[/spoiler]','скрытый текст');
  else if(t==='list')wrap('[list]\n[*]','\n[*]\n[/list]','пункт');else if(t==='hr')ins('\n[hr]\n');
  else if(t==='emo')emo.classList.toggle('on');
 });
 host.querySelector('.fx-tb').addEventListener('change',e=>{
  const t=e.target.dataset.t;
  if(t==='color')wrap('[color='+e.target.value+']','[/color]','текст');
  else if(t==='size'){if(e.target.value)wrap('[size='+e.target.value+']','[/size]','текст');e.target.value=''}
  else if(t==='upimg'){doUpload([...e.target.files],true);e.target.value=''}
  else if(t==='attach'){doUpload([...e.target.files],false);e.target.value=''}
 });
 host.querySelector('.fx-tabs').addEventListener('click',e=>{
  const b=e.target.closest('[data-v]');if(!b)return;
  host.querySelectorAll('.fx-tabs button').forEach(x=>x.classList.toggle('on',x===b));
  const p=b.dataset.v==='p';ta.hidden=p;prev.hidden=!p;if(p)prev.innerHTML=ta.value.trim()?bb(ta.value):'<small style="color:var(--m)">Нечего показывать</small>';
 });
 ta.addEventListener('paste',e=>{const fs=[...(e.clipboardData&&e.clipboardData.files||[])].filter(f=>f.type.startsWith('image/'));if(fs.length){e.preventDefault();doUpload(fs,true)}});
 ta.addEventListener('dragover',e=>e.preventDefault());
 ta.addEventListener('drop',e=>{const fs=[...(e.dataTransfer&&e.dataTransfer.files||[])];if(!fs.length)return;e.preventDefault();doUpload(fs.filter(f=>f.type.startsWith('image/')),true);doUpload(fs.filter(f=>!f.type.startsWith('image/')),false)});
 const submit=async()=>{
  const v=ta.value.trim();if(v.length<2){toast('Напишите сообщение',1);return}
  send.disabled=true;
  try{await o.onSubmit(v,atts);if(dk)try{localStorage.removeItem(dk)}catch{}}
  catch(e){toast(e.message||'Ошибка',1)}finally{send.disabled=false}
 };
 send.onclick=submit;
 ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();submit()}});
 const c=$q('[data-t=cancel]');if(c)c.onclick=o.onCancel;
 return {ta,ins,focus:()=>ta.focus(),quote:(who,text)=>{ta.value=(ta.value?ta.value.replace(/\s*$/,'\n\n'):'')+'[quote='+who+']'+text+'[/quote]\n';ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);ta.dispatchEvent(new Event('input'))}};
}

/* ---------- роутинг ---------- */
function parse(){
 const p=location.hash.replace(/^#/,'').split('/').map(decodeURIComponent);
 if(p[0]!=='forum')return {v:'home'};
 if(p[1]==='c'&&p[2])return {v:'cat',id:p[2],page:+p[3]||1};
 if(p[1]==='t'&&p[2])return {v:'thread',id:+p[2],page:p[3]||'1'};
 if(p[1]==='new'&&p[2])return {v:'new',cat:p[2]};
 if(p[1]==='s')return {v:'search',q:p.slice(2).join('/')};
 return {v:'home'};
}
let S={sort:'last',q:'',cat:''};
const shell=()=>{const r=R();if(r&&!r.classList.contains('fx')){r.classList.add('fx');bind(r)}return r};
const loading=()=>{shell().innerHTML='<div class="fx-load">Загрузка…</div>'};
const fail=e=>{shell().innerHTML=`<div class="fx-err"><span>${E(e.message||'Ошибка')}</span><button class="fx-b g sm" data-a="retry">Повторить</button><button class="fx-b g sm" data-a="home">На главную форума</button></div>`};
const top=()=>{const f=document.getElementById('forumPage');if(f)scrollTo({top:Math.max(0,f.offsetTop-10),behavior:'auto'})};

async function route(){
 const my=++TOK,r=shell();if(!r)return;
 const p=parse();
 try{
  if(p.v==='home')await vHome(my);
  else if(p.v==='cat')await vCat(my,p);
  else if(p.v==='thread')await vThread(my,p);
  else if(p.v==='new')await vNew(my,p);
  else if(p.v==='search')await vSearch(my,p);
 }catch(e){if(my===TOK)fail(e)}
}
window.loadForum=function(){
 if(!/^#forum/.test(location.hash))history.replaceState(null,'','#forum');
 route();
};
addEventListener('hashchange',()=>{
 if(!/^#forum/.test(location.hash))return;
 const fp=document.getElementById('forumPage');
 if(fp&&fp.style.display==='none'){if(typeof user!=='undefined'&&user&&typeof openForum==='function')openForum()}
 else route();
});
(function boot(){
 if(!/^#forum/.test(location.hash))return;
 let n=0;const t=setInterval(()=>{n++;if(typeof user!=='undefined'&&user){clearInterval(t);if(typeof openForum==='function')openForum()}else if(n>25)clearInterval(t)},300);
})();

const isStaffNow=()=>!!(ME&&ME.staff);
async function loadCats(force){
 if(CATS&&!force)return CATS;
 const j=await gj('/api/forum/cats');CATS=j;ME=Object.assign({},j.me,{staff:j.staff});return j;
}

/* ---------- главная ---------- */
async function vHome(my){
 loading();
 const j=await loadCats(true);if(my!==TOK)return;
 const groups=[];const map={};
 j.cats.forEach(c=>{if(!map[c.group]){map[c.group]=[];groups.push(c.group)}map[c.group].push(c)});
 let h=`<div class="fx-bar"><form class="fx-row" data-a="search" style="flex:1"><input class="fx-in" name="q" placeholder="Поиск по форуму…" style="flex:1;max-width:420px" minlength="2"><button class="fx-b g sm">Найти</button></form>
  ${j.staff?'<button class="fx-b sm" data-a="catnew">+ Раздел</button>':''}</div>`;
 if(!groups.length)h+='<div class="fx-empty">Разделов пока нет</div>';
 groups.forEach(g=>{
  h+=`<div class="fx-grp"><div class="fx-gh"><span>${E(g)}</span></div>`;
  map[g].forEach(c=>{
   h+=`<div class="fx-cat" data-a="cat" data-id="${E(c.id)}">
    <div class="fx-ci">${svgIcon(c.icon,24)}</div>
    <div class="fx-cm"><b>${E(c.name)}</b>${c.staff?'<span class="fx-tag ro">только чтение</span>':''}<small>${E(c.descr)}</small>
     ${j.staff?`<div class="fx-row" style="margin-top:6px"><button class="fx-b g sm" data-a="catedit" data-id="${E(c.id)}">Изменить</button><button class="fx-b d sm" data-a="catdel" data-id="${E(c.id)}">Удалить</button></div>`:''}</div>
    <div class="fx-cs"><b>${nfmt(c.threads)}</b><small>${plural(c.threads,'тема','темы','тем')}</small></div>
    <div class="fx-cs"><b>${nfmt(c.posts)}</b><small>${plural(c.posts,'сообщение','сообщения','сообщений')}</small></div>
    <div class="fx-cl">${c.last?`<a data-a="thread" data-id="${c.last.id}" data-p="last">${E(c.last.title)}</a>${E(c.last.username||'?')} · ${ago(c.last.ts)}`:'Нет тем'}</div>
   </div>`;
  });
  h+='</div>';
 });
 h+=`<div class="fx-stats"><span>Тем: <b>${j.stats.threads}</b></span><span>Сообщений: <b>${j.stats.posts}</b></span><span>Участников: <b>${j.stats.members}</b></span></div>
  <div class="fx-bar" style="margin-top:10px">
   <button class="fx-b g sm" data-a="mine">Мои темы / ответы / подписки</button>
   <button class="fx-b g sm" data-a="markread">Отметить подписки прочитанными</button>
  </div>`;
 shell().innerHTML=h;hydrate(R());top();
}

/* ---------- раздел (список тем) ---------- */
async function vCat(my,p){
 if(S.cat!==p.id){S.cat=p.id;S.q='';S.sort='last'}
 loading();
 const j=await gj('/api/forum/list?'+q({cat:p.id,page:p.page,sort:S.sort,q:S.q}));if(my!==TOK)return;
 const c=j.cat;
 let h=bcHtml([{t:'Форум',h:'#forum'},{t:c.group},{t:c.name}])+
 `<div class="fx-bar"><h3>${E(c.name)}${c.staff?' <span class="fx-tag ro">только чтение</span>':''}<small>${E(c.descr)}</small></h3>
   ${j.canCreate?`<button class="fx-b" data-a="newthread" data-id="${E(c.id)}">＋ Создать тему</button>`:'<span style="color:var(--m);font-size:13px">Темы здесь создают только администраторы</span>'}<button class="fx-b g sm" data-a="sub" data-k="cat" data-id="${E(c.id)}">${j.subbed?'★ Отписаться':'☆ Подписаться'}</button></div>
  <div class="fx-bar"><form class="fx-row" data-a="catfilter" style="flex:1"><input class="fx-in" name="q" value="${E(S.q)}" placeholder="Поиск по темам раздела…" style="flex:1;max-width:340px">
   <select class="fx-sel" name="sort"><option value="last"${S.sort==='last'?' selected':''}>Последняя активность</option><option value="new"${S.sort==='new'?' selected':''}>Новые темы</option><option value="replies"${S.sort==='replies'?' selected':''}>По ответам</option><option value="views"${S.sort==='views'?' selected':''}>По просмотрам</option><option value="unsolved"${S.sort==='unsolved'?' selected':''}>Нерешённые</option><option value="poll"${S.sort==='poll'?' selected':''}>С опросом</option></select>
   <button class="fx-b g sm">Применить</button></form><small style="color:var(--m)">${j.total} ${plural(j.total,'тема','темы','тем')}</small></div>`;
 if(!j.list.length)h+=`<div class="fx-empty">${S.q?'Ничего не найдено':'В этом разделе пока нет тем'}</div>`;
 else{
  h+='<div class="fx-grp">'+j.list.map(t=>`<div class="fx-th${t.pinned?' pinned':''}" data-a="thread" data-id="${t.id}">
   ${av(t.author,42)}
   <div class="fx-tm">${t.pinned?'<span class="fx-pin" title="Закреплено">📌</span>':''}${t.closed?'<span class="fx-lock" title="Закрыта">🔒</span>':''}${t.solved?'<span class="fx-solved" title="Решено">✓</span> ':''}${t.prefix?`<span class="fx-pfx">${E(t.prefix)}</span>`:''}<b>${E(t.title)}</b>
    <small>${E(t.author.username)} · ${dtf(t.ts)}</small></div>
   <div class="fx-ts"><b>${nfmt(t.replies)}</b><small>ответов</small></div><div class="fx-ts"><b>${nfmt(t.views)}</b><small>просмотров</small></div>
   <div class="fx-tl"><b>${E(t.last_name)}</b>${ago(t.last_ts)}</div></div>`).join('')+'</div>';
 }
 h+=pager(j.page,j.pages,'catpage');
 shell().innerHTML=h;hydrate(R());top();
}

/* ---------- поиск ---------- */
async function vSearch(my,p){
 loading();
 const j=await gj('/api/forum/search?q='+encodeURIComponent(p.q));if(my!==TOK)return;
 let h=bcHtml([{t:'Форум',h:'#forum'},{t:'Поиск: '+p.q}])+`<div class="fx-bar"><h3>Результаты поиска<small>«${E(p.q)}» — найдено ${j.list.length}</small></h3></div>`;
 h+=j.list.length?'<div class="fx-grp">'+j.list.map(t=>`<div class="fx-th" data-a="thread" data-id="${t.id}" style="grid-template-columns:42px 1fr 150px">
   ${av(t.author,42)}<div class="fx-tm">${t.prefix?`<span class="fx-pfx">${E(t.prefix)}</span>`:''}<b>${E(t.title)}</b><small>${E(t.cat_name)} · ${E(t.author.username)} · ${dtf(t.ts)}</small></div>
   <div class="fx-tl"><b>${t.replies} ${plural(t.replies,'ответ','ответа','ответов')}</b>${ago(t.last_ts)}</div></div>`).join('')+'</div>':'<div class="fx-empty">Ничего не найдено</div>';
 shell().innerHTML=h;hydrate(R());top();
}

/* ---------- тема ---------- */
const RAW={};
function postHtml(p,kind,n,staff,closedBlock){
 const a=p.author,key=kind+p.id;RAW[key]={who:a.username,body:p.body,title:p.title,prefix:p.prefix,atts:p.atts};
 const rankHtml=a.rank?`<div class="xtra fx-rank" style="color:${E(a.rank_color||'#9ca3af')}">${E(a.rank)}</div>`:'';
 const repHtml=typeof a.reputation==='number'?`<div class="xtra">Репутация: ${a.reputation}</div>`:'';
 const bestBadge=p.is_best?'<span class="fx-best">✓ Лучший ответ</span>':'';
 return `<article class="fx-p${p.is_best?' fx-best-post':''}" id="fp-${key}" data-key="${key}">
  <aside class="fx-pa">${av(a,64)}<div><span class="fx-un" data-a="profile" data-u="${E(a.username)}">${nameHtml(a)}</span>
   ${roleOf(a)?`<span class="fx-role">${roleOf(a)}</span>`:''}${rankHtml}
   <div class="xtra">Сообщений: ${a.msgs||0}</div>${repHtml}${a.since?`<div class="xtra">С нами с ${new Date(a.since).toLocaleDateString('ru-RU')}</div>`:''}</div></aside>
  <div class="fx-pc"><div class="fx-ph"><span>${dtf(p.ts)}</span><span>${kind==='p'?'Тема':'#'+n}</span>${bestBadge}</div>
   <div class="fx-body">${bb(p.body)}</div>${attsHtml(p.atts)}
   ${p.edited_ts?`<div class="fx-edn">Изменено ${dtf(p.edited_ts)}</div>`:''}
   <div class="fx-pf"><button class="lk${p.liked?' on':''}" data-a="like" data-k="${kind}" data-id="${p.id}">♥ <span>${p.likes||0}</span></button>
    ${closedBlock?'':`<button data-a="quote" data-key="${key}">❝ Цитировать</button>`}
    <button data-a="report" data-k="${kind}" data-id="${p.id}">⚑ Пожаловаться</button>
    ${kind==='r'&&CUR&&CUR.post&&CUR.post.can&&CUR.post.can.solve?`<button data-a="solve" data-pid="${CUR.post.id}" data-rid="${p.id}">✓ Решение</button>`:''}
    <span class="sp"></span>
    ${p.can&&p.can.edit?`<button data-a="edit" data-key="${key}" data-k="${kind}" data-id="${p.id}">✎ Изменить</button>`:''}
    ${p.can&&p.can.del?`<button data-a="del" data-k="${kind}" data-id="${p.id}">✕ Удалить</button>`:''}</div></div></article>`;
}
let REPLY=null,CUR=null,PENDING_SCROLL=false;
async function vThread(my,p){
 loading();
 const j=await gj('/api/forum/post?'+q({id:p.id,page:p.page}));if(my!==TOK)return;
 CUR=j;const t=j.post,c=j.cat;ME=Object.assign({},j.me,{staff:j.staff});
 let h=bcHtml([{t:'Форум',h:'#forum'},{t:c.group},{t:c.name,h:'#forum/c/'+encodeURIComponent(c.id)},{t:t.title.length>60?t.title.slice(0,60)+'…':t.title}])+
  `<h2 class="fx-h">${t.pinned?'📌 ':''}${t.closed?'🔒 ':''}${t.prefix?`<span class="fx-pfx">${E(t.prefix)}</span>`:''}${E(t.title)}</h2>
  <div class="fx-meta">${E(t.author.username)} · ${dtf(t.ts)} · ${nfmt(t.views)} ${plural(t.views,'просмотр','просмотра','просмотров')} · ${j.total} ${plural(j.total,'ответ','ответа','ответов')}${t.solved?' · <span class="fx-solved">✓ Решено</span>':''}</div>
  <div class="fx-actions" style="margin:8px 0;display:flex;gap:8px;flex-wrap:wrap">
   <button class="fx-b g sm" data-a="sub" data-k="post" data-id="${t.id}">${j.subbed?'★ Отписаться':'☆ Подписаться'}</button>
   ${t.can&&t.can.solve?`<button class="fx-b g sm" data-a="solve" data-pid="${t.id}" data-rid="0">${t.solved?'Снять «Решено»':'Отметить решённой'}</button>`:''}
  </div>`;
 // poll
 if(j.poll){const pl=j.poll;h+=`<div class="fx-poll"><div class="fx-poll-q"><b>📊 ${E(pl.question)}</b></div>`+
  pl.options.map(o=>`<div class="fx-poll-opt"><button class="fx-b g sm" data-a="pollvote" data-pid="${pl.id}" data-oid="${o.id}" ${pl.closed||pl.my.includes(o.id)?'disabled':''}>${E(o.text)}</button>
   <span class="fx-poll-bar"><i style="width:${o.pct}%"></i></span> <small>${o.votes} (${o.pct}%)</small></div>`).join('')+
  `<div class="fx-poll-total">Всего голосов: ${pl.total}${pl.closed?' · закрыт':''}</div></div>`}
 if(j.staff)h+=`<div class="fx-mod"><b>Модерация:</b>
  <button class="fx-b g sm" data-a="mod" data-m="${t.pinned?'unpin':'pin'}" data-id="${t.id}">${t.pinned?'Открепить':'Закрепить'}</button>
  <button class="fx-b g sm" data-a="mod" data-m="${t.closed?'open':'close'}" data-id="${t.id}">${t.closed?'Открыть тему':'Закрыть тему'}</button>
  <button class="fx-b g sm" data-a="move" data-id="${t.id}" data-cat="${E(c.id)}">Переместить</button>
  <button class="fx-b d sm" data-a="del" data-k="p" data-id="${t.id}">Удалить тему</button></div>`;
 const cb=!j.canReply;
 if(j.page===1)h+=postHtml(t,'p',0,j.staff,cb);
 h+=j.replies.map((r,i)=>postHtml(r,'r',(j.page-1)*j.per+i+1,j.staff,cb)).join('');
 h+=pager(j.page,j.pages,'tpage');
 h+='<div id="fxEnd"></div>';
 if(j.canReply)h+='<div style="margin-top:16px"><h4 style="margin:0 0 8px">Ответить в теме</h4><div id="fxReply"></div></div>';
 else h+=`<div class="fx-note">${t.closed?'🔒 Тема закрыта — отвечать нельзя':'Этот раздел только для чтения'}</div>`;
 shell().innerHTML=h;hydrate(R());
 if(j.canReply){
  REPLY=mkEditor($('fxReply'),{placeholder:'Ваш ответ…',draftKey:'r'+t.id,submitLabel:'Ответить',onSubmit:async(text,atts)=>{
   await post('/api/forum/reply',{post_id:t.id,body:text,atts});toast('Ответ опубликован');
   const l=Math.max(1,Math.ceil((j.total+1)/j.per));PENDING_SCROLL=true;
   if(j.page===l)await route();else location.hash='#forum/t/'+t.id+'/'+l;
  }});
 }else REPLY=null;
 if(PENDING_SCROLL){PENDING_SCROLL=false;const e=$('fxEnd');if(e)e.scrollIntoView({block:'center'})}else top();
}

/* ---------- новая тема ---------- */
async function vNew(my,p){
 loading();
 const j=await gj('/api/forum/list?'+q({cat:p.cat,page:1}));if(my!==TOK)return;
 const c=j.cat;
 if(!j.canCreate){shell().innerHTML=bcHtml([{t:'Форум',h:'#forum'},{t:c.name,h:'#forum/c/'+encodeURIComponent(c.id)}])+'<div class="fx-note">В этом разделе темы создают только администраторы</div>';return}
 shell().innerHTML=bcHtml([{t:'Форум',h:'#forum'},{t:c.group},{t:c.name,h:'#forum/c/'+encodeURIComponent(c.id)},{t:'Новая тема'}])+
  `<div class="fx-bar"><h3>Новая тема в «${E(c.name)}»</h3></div>
  <div class="fx-form"><div class="fx-row"><select class="fx-sel" id="fxPfx">${j.prefixes.map(x=>`<option value="${E(x)}">${x?E(x):'Без префикса'}</option>`).join('')}</select>
   <input class="fx-in" id="fxTitle" placeholder="Заголовок темы" maxlength="120" style="flex:1;min-width:200px"></div>
   <details class="fx-poll-create" style="margin:10px 0;padding:10px;border:1px solid var(--fx-ln);border-radius:10px">
    <summary style="cursor:pointer;font-weight:700">📊 Добавить опрос (необязательно)</summary>
    <input class="fx-in" id="fxPollQ" placeholder="Вопрос опроса" maxlength="200" style="width:100%;margin:8px 0">
    <div id="fxPollOpts">
     <input class="fx-in fx-po" placeholder="Вариант 1" maxlength="100" style="width:100%;margin:4px 0">
     <input class="fx-in fx-po" placeholder="Вариант 2" maxlength="100" style="width:100%;margin:4px 0">
    </div>
    <button type="button" class="fx-b g sm" id="fxPollAdd" style="margin:6px 0">+ Вариант</button>
    <label class="fx-chk" style="display:block;margin-top:6px"><input type="checkbox" id="fxPollMulti"> Можно выбрать несколько вариантов</label>
   </details>
   <div id="fxNew"></div></div>`;
 const addBtn=$('fxPollAdd');if(addBtn)addBtn.onclick=()=>{const box=$('fxPollOpts');if(!box||box.children.length>=10)return;const i=document.createElement('input');i.className='fx-in fx-po';i.placeholder='Вариант '+(box.children.length+1);i.maxLength=100;i.style.cssText='width:100%;margin:4px 0';box.appendChild(i)};
 mkEditor($('fxNew'),{placeholder:'Текст темы…',draftKey:'n'+c.id,submitLabel:'Создать тему',onSubmit:async(text,atts)=>{
  const title=$('fxTitle').value.trim();if(title.length<3){$('fxTitle').focus();throw new Error('Введите заголовок (минимум 3 символа)')}
  const payload={cat:c.id,title,prefix:$('fxPfx').value,body:text,atts};
  const pq=($('fxPollQ')&&$('fxPollQ').value||'').trim();
  if(pq){
   const opts=[...document.querySelectorAll('#fxPollOpts .fx-po')].map(el=>el.value.trim()).filter(Boolean);
   if(opts.length<2)throw new Error('Для опроса нужно минимум 2 варианта');
   payload.poll={question:pq,options:opts,multi:!!($('fxPollMulti')&&$('fxPollMulti').checked)};
  }
  const r=await post('/api/forum/create',payload);
  toast('Тема создана');location.replace('#forum/t/'+r.id);
 }});
 top();$('fxTitle').focus();
}

/* ---------- действия (делегирование) ---------- */
function startEdit(key,kind,id){
 const art=$('fp-'+key),raw=RAW[key];if(!art||!raw)return;
 const pc=art.querySelector('.fx-pc');
 pc.innerHTML=`<div class="fx-form">${kind==='p'?`<div class="fx-row"><select class="fx-sel" id="fxEP">${CUR.prefixes.map(x=>`<option value="${E(x)}"${x===raw.prefix?' selected':''}>${x?E(x):'Без префикса'}</option>`).join('')}</select><input class="fx-in" id="fxET" value="${E(raw.title)}" maxlength="120" style="flex:1"></div>`:''}<div id="fxEd"></div></div>`;
 mkEditor($('fxEd'),{value:raw.body,atts:raw.atts,submitLabel:'Сохранить',onCancel:()=>route(),onSubmit:async(text,atts)=>{
  await post('/api/forum/edit',{kind,id:+id,title:kind==='p'?$('fxET').value:undefined,prefix:kind==='p'?$('fxEP').value:undefined,body:text,atts});
  toast('Сохранено');await route();
 }});
}
const actions={
 retry:()=>route(),home:()=>navTo('#forum'),
 cat:d=>navTo('#forum/c/'+encodeURIComponent(d.id)),
 catpage:d=>navTo('#forum/c/'+encodeURIComponent(S.cat)+'/'+d.p),
 thread:d=>navTo('#forum/t/'+d.id+(d.p?'/'+d.p:'')),
 tpage:d=>{const p=parse();navTo('#forum/t/'+p.id+'/'+d.p)},
 newthread:d=>navTo('#forum/new/'+encodeURIComponent(d.id)),
 zoom:d=>{const o=document.createElement('div');o.className='fx-lb';o.innerHTML='<img src="'+E(d.src)+'" alt="">';o.onclick=()=>o.remove();document.body.appendChild(o)},
 profile:d=>{if(typeof openUserProfile==='function')openUserProfile(d.u)},
 quote:d=>{const r=RAW[d.key];if(!r||!REPLY)return;
  const txt=r.body.replace(/\[quote(?:=[^\]]*)?\][\s\S]*?\[\/quote\]/gi,'').trim().slice(0,600);REPLY.quote(r.who,txt);$('fxReply').scrollIntoView({block:'center',behavior:'smooth'})},
 edit:d=>startEdit(d.key,d.k,d.id),
 like:async(d,el)=>{try{const r=await post('/api/forum/like',{kind:d.k,id:+d.id});el.classList.toggle('on',r.liked);el.querySelector('span').textContent=r.likes}catch(e){toast(e.message,1)}},
 del:async d=>{
  if(!confirm(d.k==='p'?'Удалить тему целиком вместе со всеми ответами?':'Удалить это сообщение?'))return;
  try{if(d.k==='p'){const r=await post('/api/forum/del',{id:+d.id});toast('Тема удалена');navTo('#forum/c/'+encodeURIComponent(r.cat))}
   else{await post('/api/forum/del_reply',{id:+d.id});toast('Сообщение удалено');route()}}catch(e){toast(e.message,1)}
 },
 mod:async d=>{try{await post('/api/forum/mod',{id:+d.id,act:d.m});toast('Готово');route()}catch(e){toast(e.message,1)}},
 move:async d=>{
  const j=await loadCats(true);
  modal(`<h4>Переместить тему</h4><label>Раздел<select class="fx-sel" id="fxMv">${j.cats.map(c=>`<option value="${E(c.id)}"${c.id===d.cat?' selected':''}>${E(c.group)} › ${E(c.name)}</option>`).join('')}</select></label>
   <div class="fx-row"><button class="fx-b" id="fxMvOk">Переместить</button><button class="fx-b g" data-x>Отмена</button></div>`,o=>{
   o.querySelector('[data-x]').onclick=()=>o.remove();
   o.querySelector('#fxMvOk').onclick=async()=>{try{await post('/api/forum/mod',{id:+d.id,act:'move',cat:o.querySelector('#fxMv').value});o.remove();toast('Перемещено');route()}catch(e){toast(e.message,1)}};
  });
 },
 catnew:()=>catForm(null),
 catedit:d=>catForm(CATS&&CATS.cats.find(c=>c.id===d.id)),
 catdel:async d=>{
  if(!confirm('Удалить раздел? (возможно только если в нём нет тем)'))return;
  try{await post('/api/forum/cat_del',{id:d.id});toast('Раздел удалён');route()}catch(e){toast(e.message,1)}
 },
 report:async d=>{
  const reason=prompt('Причина жалобы (минимум 5 символов):');
  if(!reason||reason.trim().length<5)return;
  try{await post('/api/forum/report',{kind:d.k,id:+d.id,reason:reason.trim()});toast('Жалоба отправлена')}catch(e){toast(e.message,1)}
 },
 sub:async(d,el)=>{
  try{const r=await post('/api/forum/sub',{kind:d.k,id:d.id});
   if(el)el.textContent=r.subbed?'★ Отписаться':'☆ Подписаться';
   toast(r.subbed?'Подписка оформлена':'Подписка отменена')}catch(e){toast(e.message,1)}
 },
 solve:async d=>{
  try{await post('/api/forum/solve',{post_id:+d.pid,reply_id:+d.rid||0,solved:d.rid?1:undefined});toast('Готово');route()}catch(e){toast(e.message,1)}
 },
 pollvote:async d=>{
  try{await post('/api/forum/poll_vote',{poll_id:+d.pid,opt_id:+d.oid});toast('Голос учтён');route()}catch(e){toast(e.message,1)}
 },
 markread:async()=>{
  try{await gj('/api/forum/mark_read');if(typeof forumUnread!=='undefined')forumUnread=0;if(typeof menu==='function')menu();toast('Подписки отмечены прочитанными')}catch(e){toast(e.message,1)}
 },
 mine:async()=>{
  loading();
  try{
   const j=await gj('/api/forum/mine');
   let h=bcHtml([{t:'Форум',h:'#forum'},{t:'Моё'}])+'<h2 class="fx-h">Мои темы</h2><div class="fx-grp">';
   h+=(j.posts&&j.posts.length?j.posts.map(p=>`<div class="fx-th" data-a="thread" data-id="${p.id}"><div class="fx-tm"><b>${E(p.title)}</b><small>${dtf(p.ts)}${p.solved?' · ✓':''}</small></div></div>`).join(''):'<div class="fx-empty">Нет тем</div>');
   h+='</div><h2 class="fx-h">Мои ответы</h2><div class="fx-grp">';
   h+=(j.replies&&j.replies.length?j.replies.map(p=>`<div class="fx-th" data-a="thread" data-id="${p.id}"><div class="fx-tm"><b>${E(p.title)}</b><small>${dtf(p.ts)}</small></div></div>`).join(''):'<div class="fx-empty">Нет ответов</div>');
   h+='</div><h2 class="fx-h">Подписки</h2><div class="fx-grp">';
   h+=(j.subs&&j.subs.length?j.subs.map(p=>`<div class="fx-th" data-a="thread" data-id="${p.id}"><div class="fx-tm"><b>${E(p.title)}</b><small>${ago(p.last_ts)}</small></div></div>`).join(''):'<div class="fx-empty">Нет подписок</div>');
   h+='</div>';
   shell().innerHTML=h;hydrate(R());top();
  }catch(e){shell().innerHTML='<div class="fx-err">'+E(e.message)+'</div>'}
 }
};
function catForm(c){
 const groups=[...new Set((CATS?CATS.cats:[]).map(x=>x.group))];
 modal(`<h4>${c?'Изменить раздел':'Новый раздел'}</h4>
  <label>Название<input class="fx-in" id="fcN" maxlength="40" value="${E(c?c.name:'')}"></label>
  <label>Описание<input class="fx-in" id="fcD" maxlength="140" value="${E(c?c.descr:'')}"></label>
  <label>Группа<input class="fx-in" id="fcG" list="fcGl" maxlength="30" value="${E(c?c.group:'Community')}"><datalist id="fcGl">${groups.map(g=>`<option value="${E(g)}">`).join('')}</datalist></label>
  <label>Иконка<div class="fx-icons">${Object.keys(ICON_SVG).map(k=>`<label class="fx-ic"><input type="radio" name="fcI" value="${k}"${(c?c.icon:'folder')===k?' checked':''}><span title="${k}">${svgIcon(k,20)}</span></label>`).join('')}</div></label>
  <label>Порядок (меньше — выше)<input class="fx-in" id="fcS" type="number" value="${c?c.sort:100}"></label>
  <label class="fx-chk"><input type="checkbox" id="fcT"${c&&c.staff?' checked':''}> Только чтение: темы и ответы пишут только администраторы</label>
  <div class="fx-row"><button class="fx-b" id="fcOk">Сохранить</button><button class="fx-b g" data-x>Отмена</button></div>`,o=>{
  o.querySelector('[data-x]').onclick=()=>o.remove();
  o.querySelector('#fcOk').onclick=async()=>{try{
   await post('/api/forum/cat_save',{id:c?c.id:'',name:o.querySelector('#fcN').value,descr:o.querySelector('#fcD').value,group:o.querySelector('#fcG').value,sort:+o.querySelector('#fcS').value,icon:(o.querySelector('input[name=fcI]:checked')||{}).value||'folder',staff:o.querySelector('#fcT').checked});
   o.remove();toast('Сохранено');route()}catch(e){toast(e.message,1)}};
 });
}
function bind(r){
 r.addEventListener('click',e=>{
  if(e.target.closest('a[href]')&&!e.target.closest('[data-a]'))return;
  const t=e.target.closest('[data-a]');if(!t||!r.contains(t))return;
  const a=t.dataset.a;if(a==='search'||a==='catfilter')return;
  const fn=actions[a];if(!fn)return;
  if(t.tagName==='A'&&t.getAttribute('href')&&a!=='zoom')return;
  e.preventDefault();e.stopPropagation();fn(t.dataset,t);
 });
 r.addEventListener('submit',e=>{
  const f=e.target.closest('form[data-a]');if(!f)return;e.preventDefault();
  const v=new FormData(f);
  if(f.dataset.a==='search'){const s=String(v.get('q')||'').trim();if(s.length<2){toast('Минимум 2 символа',1);return}navTo('#forum/s/'+encodeURIComponent(s))}
  else if(f.dataset.a==='catfilter'){S.q=String(v.get('q')||'').trim();S.sort=String(v.get('sort')||'last');navTo('#forum/c/'+encodeURIComponent(S.cat))}
 });
}
})();
