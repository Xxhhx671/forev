/* FRV ext: 2FA, чат (ответы/@/ЛС/мут/модерация), история, достижения, HWID-кулдаун, конфиги, админ-вкладки, FAQ/отзывы */
(function(){
const $$=(s,r=document)=>r.querySelector(s),H=h=>{const d=document.createElement('div');d.innerHTML=h.trim();return d.firstChild};
const post=(u,d)=>api(u,d||{});
const st=document.createElement('style');st.textContent=`
.xbar{height:6px;border-radius:9px;background:#1a2030;overflow:hidden;margin:6px 0}.xbar i{display:block;height:100%;background:var(--r);border-radius:9px}
.xach{display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--bd);font-size:13px}.xach.off{opacity:.45}.xach b{display:block;font-size:13.5px}.xach small{color:var(--m)}
.xach .xb{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#141b27;color:var(--r);font-weight:800;font-size:12px}.xach.ok .xb{background:var(--r);color:#04101f}
.xtl{border-left:2px solid var(--bd);margin-left:6px;padding-left:14px}.xtl>div{position:relative;padding:7px 0;font-size:13px}.xtl>div::before{content:"";position:absolute;left:-20px;top:13px;width:8px;height:8px;border-radius:50%;background:var(--r)}.xtl small{display:block;color:var(--m)}
.xsec{max-width:1000px;margin:0 auto;padding:60px 5vw}.xsec h2{font-size:clamp(22px,3vw,32px);margin:0 0 20px;text-align:left}
.xcnt{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--bd);border:1px solid var(--bd);border-radius:16px;overflow:hidden;margin-bottom:34px}.xcnt div{background:#0b0f16;padding:22px;text-align:center}.xcnt b{display:block;font-family:var(--fd);font-size:clamp(26px,4vw,40px)}.xcnt span{font-size:13px;color:var(--m)}
.xfaq input{width:100%;padding:13px 15px;border-radius:12px;border:1px solid var(--bd);background:#0b0f16;color:#fff;font:inherit;margin-bottom:10px}
.xfaq details{border:1px solid var(--bd);border-radius:12px;padding:14px 16px;margin-bottom:8px;background:#0b0f16}.xfaq summary{cursor:pointer;font-weight:600}.xfaq p{color:var(--m);margin:10px 0 0;font-size:14px;line-height:1.55}
.xrv{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}.xrv>div{border:1px solid var(--bd);border-radius:14px;padding:16px;background:#0b0f16;font-size:14px;color:#c5cddb}.xrv small{display:block;margin-top:8px;color:var(--m)}
.ch-rp{display:none;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-top:1px solid var(--c-ln);background:var(--c-bg);font-size:12.5px;color:var(--c-mu)}.ch-rp::before{content:"";align-self:stretch;width:2px;border-radius:2px;background:var(--c-me)}.ch-rp b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.ch-rp button{width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--c-mu);cursor:pointer}.ch-rp button:hover{background:var(--c-bg2);color:var(--c-tx)}
.xrv .ic,.xrow .ic,.xtab .ic{color:#f5b942}.xach .xb .ic{color:inherit}
.xgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px}
.xrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0}.xrow input,.xrow select{padding:9px 11px;border-radius:10px;border:1px solid var(--bd);background:var(--card2);color:var(--fg);font:inherit;min-width:0}
.xtab{width:100%;border-collapse:collapse;font-size:13px}.xtab td,.xtab th{padding:7px 6px;border-bottom:1px solid var(--bd);text-align:left}
`;document.head.appendChild(st);
const dt=t=>new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});

/* ===== 2FA на входе ===== */
// перехват ответа логина: оборачиваем fetch к /api/login
const _fetch=window.fetch;
window.fetch=async function(u,o){
 const r=await _fetch.apply(this,arguments);
 try{if(typeof u==='string'&&u.endsWith('/api/login')&&r.ok){const j=await r.clone().json();if(j&&j.need_2fa){
   for(let i=0;i<5;i++){const code=prompt('Код из приложения-аутентификатора (6 цифр):');if(!code)break;
    const r2=await _fetch(u+'/2fa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pt:j.pt,code}),credentials:'include'});
    if(r2.ok)return r2;const e=await r2.clone().json().catch(()=>({}));alert(e.error||'Ошибка');if(r2.status!==401)break}
   return new Response(JSON.stringify({error:'Вход отменён: нужен код 2FA'}),{status:401,headers:{'Content-Type':'application/json'}})}}}catch{}
 return r};
window.chpw=async function(){$('pe').textContent='';try{let code;if(window.__x&&window.__x.totp_on){code=prompt('Код 2FA:');if(!code)return}
 await post('/api/password',{old:$('op').value,new:$('np').value,code});$('op').value=$('np').value='';toast('Пароль изменён, остальные сессии закрыты')}catch(e){$('pe').textContent=e.message}};

/* ===== FL: анимированные SVG-бейджи ===== */
const flst=document.createElement('style');flst.textContent=".fl-ic{display:inline-block;vertical-align:-3px;overflow:visible;flex:none}\n.fl-ic *{transform-box:fill-box;transform-origin:50% 50%}\n.fa-spark{animation:flSpark 2.6s ease-in-out infinite}\n.fa-tw{animation:flTw 2.6s ease-in-out infinite}.fa-tw2{animation:flTw 2.6s ease-in-out 1.3s infinite}\n.fa-rock{animation:flRock 3.6s ease-in-out infinite;transform-origin:50% 60%}\n.fa-shake{animation:flShake 2.8s linear infinite}.fa-flash{animation:flFlash 2.8s linear infinite;opacity:0}\n.fa-flame{animation:flFlame 1.5s ease-in-out infinite;transform-origin:50% 100%}.fa-flame2{animation:flFlame 1.1s ease-in-out .3s infinite;transform-origin:50% 100%}\n.fa-sweep{animation:flSweep 3.4s ease-in-out infinite}\n.fa-jw{animation:flPulse 2s ease-in-out infinite}.fa-jw2{animation:flPulse 2s ease-in-out 1s infinite}\n@keyframes flSpark{0%,100%{transform:scale(.88) rotate(0)}50%{transform:scale(1.04) rotate(12deg)}}\n@keyframes flTw{0%,100%{opacity:.1;transform:scale(.4)}50%{opacity:1;transform:scale(1)}}\n@keyframes flRock{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}\n@keyframes flShake{0%,84%,100%{transform:none}88%{transform:translate(.5px,-.3px)}92%{transform:translate(-.5px,.3px)}96%{transform:translate(.3px,0)}}\n@keyframes flFlash{0%,84%,100%{opacity:0}88%{opacity:.9}91%{opacity:.1}94%{opacity:.75}}\n@keyframes flFlame{0%,100%{transform:scale(1,1) skewX(0)}35%{transform:scale(.95,1.07) skewX(-3deg)}70%{transform:scale(1.04,.96) skewX(3deg)}}\n@keyframes flSweep{0%,45%{transform:translateX(-9px)}100%{transform:translateX(34px)}}\n@keyframes flPulse{0%,100%{opacity:.55}50%{opacity:1}}\n@media (prefers-reduced-motion:reduce){.fl-ic *{animation:none!important}}"+`.fl-bd{display:inline-flex;align-items:center;line-height:1}`;document.head.appendChild(flst);
document.body.insertAdjacentHTML('beforeend','<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>'+"<linearGradient id=\"flg-gold\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff3a8\"/><stop offset=\".5\" stop-color=\"#ffc02e\"/><stop offset=\"1\" stop-color=\"#e5800a\"/></linearGradient>\n<linearGradient id=\"flg-gold2\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe98f\"/><stop offset=\".55\" stop-color=\"#f5a912\"/><stop offset=\"1\" stop-color=\"#b9650a\"/></linearGradient>\n<linearGradient id=\"flg-moon\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d9ccff\"/><stop offset=\".55\" stop-color=\"#8b86ff\"/><stop offset=\"1\" stop-color=\"#4a5de0\"/></linearGradient>\n<linearGradient id=\"flg-bolt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbc2\"/><stop offset=\".5\" stop-color=\"#ffd23a\"/><stop offset=\"1\" stop-color=\"#ff9a0a\"/></linearGradient>\n<linearGradient id=\"flg-fo\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff6a3d\"/><stop offset=\".6\" stop-color=\"#f03a3a\"/><stop offset=\"1\" stop-color=\"#c41f4a\"/></linearGradient>\n<linearGradient id=\"flg-fi\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff3a0\"/><stop offset=\"1\" stop-color=\"#ffa21a\"/></linearGradient>\n<linearGradient id=\"flg-shine\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#fff\" stop-opacity=\"0\"/><stop offset=\".5\" stop-color=\"#fff\" stop-opacity=\".85\"/><stop offset=\"1\" stop-color=\"#fff\" stop-opacity=\"0\"/></linearGradient>\n<clipPath id=\"flg-cp-gem\"><path d=\"M7 3H17L22 9L12 21.5L2 9Z\"/></clipPath>\n<clipPath id=\"flg-cp-crown\"><path d=\"M3 8L7.5 12L12 4L16.5 12L21 8L19 19H5Z\"/></clipPath>"+'</defs></svg>');
const FLB={"star": "<path class=\"fa-spark\" d=\"M11 2C11.9 7.6 15.4 11.1 21 12C15.4 12.9 11.9 16.4 11 22C10.1 16.4 6.6 12.9 1 12C6.6 11.1 10.1 7.6 11 2Z\" fill=\"url(#flg-gold)\"/><path class=\"fa-tw\" d=\"M19.5 2.5C19.7 4 20.1 4.4 21.5 4.6C20.1 4.8 19.7 5.2 19.5 6.7C19.3 5.2 18.9 4.8 17.5 4.6C18.9 4.4 19.3 4 19.5 2.5Z\" fill=\"#fff6c8\"/>", "moon": "<path class=\"fa-rock\" d=\"M21 12.8A9 9 0 1 1 11.2 3A7 7 0 0 0 21 12.8Z\" fill=\"url(#flg-moon)\"/><circle class=\"fa-tw\" cx=\"18.4\" cy=\"5.2\" r=\"1.3\" fill=\"#e9e4ff\"/><circle class=\"fa-tw2\" cx=\"14.6\" cy=\"2.6\" r=\".8\" fill=\"#e9e4ff\"/>", "bolt": "<g class=\"fa-shake\"><path d=\"M13.6 1.5L4.6 13.4H10.6L9.6 22.5L19.4 9.6H13Z\" fill=\"url(#flg-bolt)\" stroke=\"#ff9a0a\" stroke-width=\".6\" stroke-linejoin=\"round\"/><path class=\"fa-flash\" d=\"M13.6 1.5L4.6 13.4H10.6L9.6 22.5L19.4 9.6H13Z\" fill=\"#fff\"/></g>", "fire": "<path class=\"fa-flame\" d=\"M12 2.2C13.2 5.6 18.6 8.4 18.6 14.4C18.6 18.4 15.7 21.8 12 21.8C8.3 21.8 5.4 18.4 5.4 14.4C5.4 11.8 6.7 10 8 8.6C8.3 10.4 9.2 11.4 10.2 11.8C9.6 8.2 10.4 4.6 12 2.2Z\" fill=\"url(#flg-fo)\"/><path class=\"fa-flame2\" d=\"M12 11.6C12.9 13.6 15.4 14.8 15.4 17.4C15.4 19.4 13.9 20.8 12 20.8C10.1 20.8 8.6 19.4 8.6 17.4C8.6 15.4 10.6 14.2 12 11.6Z\" fill=\"url(#flg-fi)\"/>", "gem": "<g><polygon points=\"7,3 17,3 15,9 9,9\" fill=\"#b5efff\"/><polygon points=\"7,3 9,9 2,9\" fill=\"#7fd6ff\"/><polygon points=\"17,3 22,9 15,9\" fill=\"#5cc3fb\"/><polygon points=\"2,9 9,9 12,21.5\" fill=\"#3a9be8\"/><polygon points=\"9,9 15,9 12,21.5\" fill=\"#5fb6f7\"/><polygon points=\"15,9 22,9 12,21.5\" fill=\"#2a74cf\"/><path d=\"M7 3H17L22 9L12 21.5L2 9Z\" fill=\"none\" stroke=\"#e8f9ff\" stroke-opacity=\".55\" stroke-width=\".6\" stroke-linejoin=\"round\"/></g><g clip-path=\"url(#flg-cp-gem)\"><polygon class=\"fa-sweep\" points=\"0,0 6,0 2,24 -4,24\" fill=\"url(#flg-shine)\"/></g>", "crown": "<path d=\"M3 8L7.5 12L12 4L16.5 12L21 8L19 19H5Z\" fill=\"url(#flg-gold2)\" stroke=\"#b9650a\" stroke-width=\".5\" stroke-linejoin=\"round\"/><rect x=\"5\" y=\"19.6\" width=\"14\" height=\"2.2\" rx=\"1.1\" fill=\"#c9770d\"/><circle class=\"fa-jw\" cx=\"3\" cy=\"7\" r=\"1.5\" fill=\"#ff5c8a\"/><circle class=\"fa-jw2\" cx=\"12\" cy=\"3.4\" r=\"1.6\" fill=\"#5fd8ff\"/><circle class=\"fa-jw\" cx=\"21\" cy=\"7\" r=\"1.5\" fill=\"#ff5c8a\"/><circle cx=\"12\" cy=\"15.4\" r=\"1.5\" fill=\"#fff3d0\" fill-opacity=\".9\"/><g clip-path=\"url(#flg-cp-crown)\"><polygon class=\"fa-sweep\" points=\"0,0 6,0 2,24 -4,24\" fill=\"url(#flg-shine)\"/></g>"};
const flBadge=(id,s)=>FLB[id]?`<svg class="fl-ic" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${FLB[id]}</svg>`:'';

/* ===== Чат ===== */
let rpl=0;const muted=()=>{try{return JSON.parse(localStorage.ch_mute||'[]')}catch{return[]}};
window.chatHide=n=>{const m=muted();if(!m.includes(n)){m.push(n);localStorage.ch_mute=JSON.stringify(m)}document.querySelectorAll('#chList .ch-m').forEach(e=>{if(e.dataset.u===n)e.remove()});toast('Скрыто: '+n+' (у вас)')};
window.chatUnhideAll=()=>{localStorage.ch_mute='[]';toast('Скрытые показаны после обновления')};
window.chatReply=(id,name,txt)=>{rpl=id;const b=$('chRp');b.style.display='flex';b.querySelector('b').textContent='Ответ '+name+': '+txt;$('chIn').focus()};
window.chatModAct=async(a,id,uid,name)=>{try{if(a==='mute'){const m=prompt('Мут '+name+' на сколько минут?','10');if(!m)return;await post('/api/admin/chat/mute',{id:uid,minutes:+m})}
 else if(a==='ban'){if(!confirm('Забанить '+name+' в чате?'))return;await post('/api/admin/chat/ban',{id:uid})}toast('Готово')}catch(e){toast(e.message,1)}};
window.chNode=function(m){
 const d=document.createElement('div');d.className='ch-m'+(m.uid===chMe?' me':'')+(m.to?' pm':'');
 d.dataset.id=m.id;d.dataset.u=m.username;d.dataset.uid=m.uid;d.dataset.ts=m.ts;d.dataset.pm=m.to?1:0;d.style.setProperty('--h',uHue(m.username));
 if(muted().includes(m.username)&&m.uid!==chMe)d.style.display='none';
 const a=document.createElement('div');a.className='ch-av';avFill(a,m.avatar,m.username);
 const c=document.createElement('div');c.className='ch-c';
 const h=document.createElement('div');h.className='ch-n';const nm=document.createElement('span');nm.textContent=m.username;if(m.color)nm.style.color=m.color;if(m.badge&&FLB[m.badge]){const bd=document.createElement('span');bd.className='fl-bd';bd.innerHTML=flBadge(m.badge,16);h.appendChild(bd)}h.appendChild(nm);
 if(m.is_admin||m.role){const t=document.createElement('em');t.textContent=m.is_admin?'ADMIN':m.role==='moderator'?'MOD':'SUPPORT';h.appendChild(t)}
 c.appendChild(h);
 const b=document.createElement('div');b.className='ch-b';
 if(m.to){const t=document.createElement('div');t.style.marginBottom='4px';const s2=document.createElement('span');s2.className='ch-pm';s2.textContent=m.uid===chMe?'Личное для '+m.to:'Личное сообщение';t.appendChild(s2);b.appendChild(t)}
 if(m.reply){const q=document.createElement('div');q.className='ch-q';q.textContent=m.reply.username+': '+m.reply.text;b.appendChild(q)}
 const t=document.createElement('div');t.className='ch-t';
 const me=(user&&user.username||'').toLowerCase();
 m.text.split(/(@[A-Za-z0-9_]{3,20})/g).forEach(p=>{if(/^@/.test(p)){const s2=document.createElement('span');s2.textContent=p;if(p.slice(1).toLowerCase()===me)s2.className='ch-me-t';t.appendChild(s2)}else t.appendChild(document.createTextNode(p))});
 const ts=document.createElement('span');ts.className='ch-ts';ts.textContent=new Date(m.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});t.appendChild(ts);
 b.appendChild(t);
 const ac=document.createElement('div');ac.className='ch-a';
 const bt=(ic,f,ti,cls)=>{const x=document.createElement('button');x.type='button';x.innerHTML=ico(ic,15);x.title=ti;x.setAttribute('aria-label',ti);if(cls)x.className=cls;x.onclick=e=>{e.stopPropagation();f()};ac.appendChild(x)};
 bt('reply',()=>chatReply(m.id,m.username,m.text.slice(0,40)),'Ответить');
 if(m.uid!==chMe)bt('eyeoff',()=>chatHide(m.username),'Скрыть этого пользователя у себя');
 if(chAdm&&m.uid!==chMe&&!m.is_admin){bt('mute',()=>chatModAct('mute',m.id,m.uid,m.username),'Мут');bt('ban',()=>chatModAct('ban',m.id,m.uid,m.username),'Бан в чате','dng')}
 if(chAdm)bt('trash',()=>chatDel(m.id),'Удалить','dng');
 b.onclick=()=>{if(matchMedia('(hover:none)').matches){document.querySelectorAll('#chList .ch-m.tap').forEach(e=>{if(e!==d)e.classList.remove('tap')});d.classList.toggle('tap')}};
 c.appendChild(b);d.appendChild(a);d.appendChild(c);d.appendChild(ac);return d};
window.chatSend=async function(){const i=$('chIn'),t=i.value.trim();if(!t)return;i.value='';chAuto();const r=rpl;rpl=0;$('chRp').style.display='none';
 try{await api('/api/chat/send',{text:t,reply:r});setTimeout(chPoll,120)}catch(e){toast(e.message,1);i.value=t;chAuto()}};
function chatInit(){if($('chRp'))return;const inp=$$('.ch-in');if(!inp)return;const b=H('<div class="ch-rp" id="chRp"><b></b><button onclick="rpl=0;this.parentNode.style.display=\'none\'">'+ico('x',14)+'</button></div>');b.querySelector('button').onclick=()=>{rpl=0;b.style.display='none'};inp.parentNode.insertBefore(b,inp);
 $('chIn').placeholder='Сообщение… (@ник, /w ник текст — личное)'}

/* ===== Кабинет: карточки ===== */
let injected=false,lastLoad=0;
function inject(){const g=$$('#cab .grid');if(!g||injected)return;injected=true;
 const card=(id,t,body)=>H(`<div class="card" id="${id}"><h3>${t}</h3>${body}</div>`);
 const dv=$('dv');if(dv&&!$('hwcd'))dv.after(H('<p id="hwcd" style="font-size:12.5px;margin-top:8px"></p>'));
 (($('adm'))?(...c)=>$('adm').before(...c):(...c)=>g.append(...c))(
  card('xFl','FL — валюта сервиса','<div id="flB"><small>Загрузка…</small></div>'),
   card('xLvl','Уровень и достижения','<div class="kv"><span>Уровень</span><b id="xl">—</b></div><div class="xbar"><i id="xlb" style="width:0"></i></div><small id="xlt" style="color:var(--m)"></small><div id="xach" style="margin-top:8px"></div>'),
  card('xHist','История подписки','<div class="xtl" id="xhist"><small>Загрузка…</small></div>'),
  card('x2fa','Двухфакторная защита (2FA)','<p id="x2s"></p><div id="x2b"></div>'),
  card('xRv','Отзыв о сервисе','<div class="fld ta"><textarea id="xrvt" placeholder=" "></textarea><label>Ваш отзыв (от 10 символов)</label></div><div class="row"><select id="xrvs" style="padding:10px;border-radius:10px;background:var(--card2);color:var(--fg);border:1px solid var(--bd)"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select><button class="btn sm" onclick="sendReview()">Отправить</button></div><p style="font-size:12px">Отзыв появится на сайте после модерации.</p>'))}
window.sendReview=async()=>{try{const r=await post('/api/review',{text:$('xrvt').value,stars:+$('xrvs').value});toast(r.msg);$('xrvt').value=''}catch(e){toast(e.message,1)}};
async function loadExt(){if(!user)return;chatInit();inject();if(Date.now()-lastLoad<15000)return;lastLoad=Date.now();loadFl();
 try{const x=window.__x=await post('/api/ext/me');
  $('xl').textContent=x.level+' · '+x.xp+' XP';$('xlb').style.width=Math.min(100,(x.xp-x.lvl_from)/(x.lvl_to-x.lvl_from)*100)+'%';$('xlt').textContent='До уровня '+(x.level+1)+': '+Math.max(0,x.lvl_to-x.xp)+' XP';
  $('xach').innerHTML=x.ach.map(a=>`<div class="xach ${a.done?'ok':'off'}"><div class="xb">${a.done?ico('check',16):Math.round(a.cur/a.goal*100)+'%'}</div><div><b>${esc(a.title)}</b><small>${esc(a.desc)} · ${a.cur}/${a.goal}</small></div></div>`).join('');
  const hc=$('hwcd');if(hc)hc.textContent=x.hwid_cd>0?'Сброс устройства: доступен через '+(x.hwid_cd>=864e5?Math.ceil(x.hwid_cd/864e5)+' дн.':Math.ceil(x.hwid_cd/36e5)+' ч.'):'Сброс устройства доступен сейчас (удалите устройство в списке).';
  draw2fa(x)}catch{}
 try{const h=await post('/api/history'),L={trial:'Пробный период',key:'Активация ключа',redeem:'Активация ключа',promo:'Промокод',gift:'Подарок',admin:'Выдано админом',admin_grant:'Выдано админом',ref:'Бонус за реферала',fl:'Покупка за FL'};
  $('xhist').innerHTML=h.list.length?h.list.map(i=>`<div><b>${esc(L[i.source]||i.source||'Событие')}</b> ${i.days>0?'+'+i.days+' дн.':i.days<0?i.days+' дн.':'∞'}<small>${dt(i.ts)}${i.details?' · '+esc(String(i.details).replace(/\[.*?\]/,'').trim().slice(0,60)):''}</small></div>`).join(''):'<small>Пока пусто</small>'}catch{}}
function draw2fa(x){$('x2s').textContent=x.totp_on?'2FA включена: код нужен при входе и смене пароля.':'Защитите аккаунт кодом из Google Authenticator / Authy.';
 $('x2b').innerHTML=x.totp_on?'<div class="row"><button class="btn sm ghost" onclick="tfaOff()">Отключить 2FA</button></div>':'<div class="row"><button class="btn sm" onclick="tfaSetup()">Включить 2FA</button></div><div id="x2q"></div>'}
window.tfaSetup=async()=>{try{const r=await post('/api/2fa/setup');$('x2q').innerHTML=`<p style="margin-top:10px">Добавьте в приложение ключ вручную:</p><pre style="font-size:15px;letter-spacing:2px;white-space:pre-wrap;word-break:break-all">${esc(r.secret)}</pre><p><a href="${esc(r.uri)}" style="color:var(--r)">Открыть в приложении</a></p><div class="xrow"><input id="x2c" placeholder="Код из приложения" inputmode="numeric" maxlength="6"><button class="btn sm" onclick="tfaOn()">Подтвердить</button></div>`}catch(e){toast(e.message,1)}};
window.tfaOn=async()=>{try{await post('/api/2fa/enable',{code:$('x2c').value});toast('2FA включена');lastLoad=0;loadExt()}catch(e){toast(e.message,1)}};
window.tfaOff=async()=>{const c=prompt('Код 2FA для отключения:');if(!c)return;try{await post('/api/2fa/disable',{code:c});toast('2FA отключена');lastLoad=0;loadExt()}catch(e){toast(e.message,1)}};

/* ===== FL: валюта ===== */
const fst=document.createElement('style');fst.textContent=`
.fl-bal{font-size:34px;font-weight:800;line-height:1.1}.fl-bal span{font-size:15px;font-weight:700;color:var(--m);margin-left:4px}
#flB h4{margin:18px 0 6px}#flB .xrow input{min-width:0}
.fl-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
.fl-it{border:1px solid var(--bd);border-radius:12px;padding:10px;background:#0b0f16;display:flex;flex-direction:column;gap:6px;font-size:13px}
.fl-it b{font-size:14px}.fl-it.on{border-color:var(--r)}.fl-it .btn{width:100%}
`;document.head.appendChild(fst);
const flFmt=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
let flPrice=0;
const flAfter=()=>{lastLoad=0;loadFl()};
async function loadFl(){const el=$('flB');if(!el||!user)return;try{drawFl(await post('/api/fl/info'))}catch(e){el.innerHTML='<small>Не удалось загрузить FL</small>'}}
function drawFl(d){
 const el=$('flB');if(!el)return;flPrice=d.day_price;
 const mins=Math.ceil(d.next_bonus/6e4),nb=d.bonus<=0?'Бонус за вход сейчас отключён.':d.next_bonus>0?`Бонус за вход +${d.bonus} FL раз в 24 ч. Следующий через ${mins>=60?Math.floor(mins/60)+' ч ':''}${mins%60} мин.`:`Бонус за вход +${d.bonus} FL раз в 24 ч — доступен.`;
 const item=(k,it)=>{const on=(k==='color'?d.color:d.badge)===it.id;return `<div class="fl-it${on?' on':''}">${k==='badge'?`<div style="height:30px;display:flex;align-items:center">${flBadge(it.id,28)}</div>`:''}<b ${k==='color'?`style="color:${it.hex}"`:''}>${esc(it.name)}</b>`+
  (on?`<button class="btn sm ghost" onclick="flEquip('${k}','')">Снять</button>`:it.owned?`<button class="btn sm" onclick="flEquip('${k}','${it.id}')">Надеть</button>`:`<button class="btn sm" onclick="flBuy('${k}','${it.id}')">${flFmt(it.price)} FL</button>`)+`</div>`};
 const cur=d.colors.find(c=>c.id===d.color),bd=d.badges.find(b=>b.id===d.badge);
 const ev={};['flTo','flAm','flDays','flGTo','flGAm'].forEach(i=>{const e=$(i);if(e)ev[i]=e.value});
 el.innerHTML=`<div class="fl-bal">${flFmt(d.fl)}<span>FL</span></div><small>${nb}</small>
 <h4>Перевод пользователю</h4><div class="xrow"><input id="flTo" placeholder="Ник" style="flex:1"><input id="flAm" type="number" min="1" placeholder="Сумма" style="width:100px"><button class="btn sm" onclick="flTransfer()">Отправить</button></div>
 <h4>Дни подписки</h4>${d.day_price>0?`<small>1 день = ${flFmt(d.day_price)} FL</small><div class="xrow"><input id="flDays" type="number" min="1" max="90" value="1" style="width:90px" oninput="flSum()"><span id="flSum" style="font-size:13px"></span><button class="btn sm" onclick="flBuyDays()">Купить</button></div>`:'<small>Покупка дней сейчас отключена.</small>'}
 <h4>Цвет ника в чате</h4><div class="fl-g">${d.colors.map(c=>item('color',c)).join('')}</div>
 <h4>Бейдж в чате</h4><div class="fl-g">${d.badges.map(b=>item('badge',b)).join('')}</div>
 <p style="font-size:13px;margin-top:12px">В чате вы выглядите так: ${bd?`<span class="fl-bd">${flBadge(bd.id,16)}</span> `:''}<b${cur?` style="color:${cur.hex}"`:''}>${esc(user.username)}</b></p>
 <h4>История FL</h4>${d.log.length?`<div class="xtl">${d.log.map(l=>`<div><b>${l.delta>0?'+':''}${flFmt(l.delta)} FL</b> ${esc(l.reason)}<small>${dt(l.ts)}</small></div>`).join('')}</div>`:'<small>Пока пусто</small>'}
 ${d.cfg?`<h4>Админ: выдать / списать FL</h4><div class="xrow"><input id="flGTo" placeholder="Ник" style="flex:1"><input id="flGAm" type="number" placeholder="± сумма" style="width:110px"><button class="btn sm" onclick="flGive()">Применить</button></div>
 <h4>Админ: настройки FL</h4><div class="xrow"><span style="font-size:13px">Бонус за вход</span><input id="flCb" type="number" min="0" value="${d.cfg.bonus}" style="width:80px"><span style="font-size:13px">Цена дня</span><input id="flCp" type="number" min="0" value="${d.cfg.day_price}" style="width:80px"><label style="font-size:13px"><input id="flCi" type="checkbox"${d.cfg.ip_limit?' checked':''}> 1 бонус на IP / сутки</label><button class="btn sm" onclick="flCfgSave()">Сохранить</button></div>`:''}`;
 for(const k in ev){const e=$(k);if(e&&ev[k])e.value=ev[k]}window.flSum();
}
window.flSum=()=>{const e=$('flSum'),i=$('flDays');if(e&&i)e.textContent='= '+flFmt((+i.value||0)*flPrice)+' FL'};
window.flTransfer=async()=>{try{const r=await post('/api/fl/transfer',{to:$('flTo').value,amount:+$('flAm').value});toast('Переведено. Баланс: '+flFmt(r.fl)+' FL');$('flAm').value='';flAfter()}catch(e){toast(e.message,1)}};
window.flBuyDays=async()=>{const d=+$('flDays').value;if(!confirm('Купить '+d+' дн. подписки?'))return;try{const r=await post('/api/fl/buy_days',{days:d});toast('Добавлено дней: '+r.days);flAfter();try{init()}catch{}}catch(e){toast(e.message,1)}};
window.flBuy=async(k,id)=>{try{await post('/api/fl/buy_item',{kind:k,id});toast('Куплено и надето');flAfter()}catch(e){toast(e.message,1)}};
window.flEquip=async(k,id)=>{try{await post('/api/fl/equip',{kind:k,id});flAfter()}catch(e){toast(e.message,1)}};
window.flGive=async()=>{try{const r=await post('/api/admin/fl/give',{to:$('flGTo').value,amount:+$('flGAm').value});toast(r.username+': '+flFmt(r.fl)+' FL');$('flGAm').value='';flAfter()}catch(e){toast(e.message,1)}};
window.flCfgSave=async()=>{try{await post('/api/admin/fl/config',{bonus:+$('flCb').value,day_price:+$('flCp').value,ip_limit:$('flCi').checked});toast('Сохранено');flAfter()}catch(e){toast(e.message,1)}};

/* ===== Конфиги: избранное и оценки ===== */
const _sc=window.showConfigs;
window.showConfigs=async function(){await _sc();if(!user)return;try{const m=await post('/api/config/mine'),L=$('cfgList');if(!L)return;
 L.querySelectorAll('.it[onclick^="openCfg"]').forEach(it=>{const id=+it.getAttribute('onclick').match(/\d+/)[0],s=m.stats[id],f=m.fav.includes(id),r=m.rate[id]||0;
  const x=H(`<div style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--m)" onclick="event.stopPropagation()"><button class="btn sm ghost" style="height:30px;padding:0 10px" onclick="cfgFav(${id})">${ico('star',14,f)} ${f?'В избранном':'В избранное'}</button><span>${s?ico('star',13,1)+' '+s.avg+' ('+s.n+')':'нет оценок'}</span><select style="padding:5px;border-radius:8px;background:var(--card2);color:var(--fg);border:1px solid var(--bd)" onchange="cfgRate(${id},this.value)"><option value="">Оценить</option>${[5,4,3,2,1].map(n=>`<option value="${n}"${r===n?' selected':''}>${n} из 5</option>`).join('')}</select></div>`);it.appendChild(x)});
 const items=[...L.querySelectorAll('.it')];items.sort((a,b)=>(b.textContent.includes('В избранном')?1:0)-(a.textContent.includes('В избранном')?1:0)).forEach(e=>L.appendChild(e))}catch{}};
window.cfgFav=async id=>{await post('/api/config/fav',{id});showConfigs()};window.cfgRate=async(id,v)=>{if(!v)return;await post('/api/config/rate',{id,stars:+v});toast('Оценка сохранена');showConfigs()};

/* ===== Админ-вкладки ===== */
const tabs=[['Дашборд','ap19'],['Чат-модерация','ap20'],['Роли','ap21'],['Массовые','ap22'],['Антифрод','ap23'],['Контент','ap24']];
function injectAdmin(){const sg=$('seg');if(!sg||$('ap19')||!user||!user.is_admin)return;
 tabs.forEach((t,i)=>{const b=document.createElement('button');b.textContent=t[0];b.onclick=()=>at(19+i);sg.appendChild(b);const p=document.createElement('div');p.id=t[1];p.style.display='none';$('ap18').after(p);p.dataset.x=1});
 // порядок: ap18 → ... добавляем после последнего
 let prev=$('ap18');tabs.forEach(t=>{const p=$(t[1]);prev.after(p);prev=p});
 $('ap19').innerHTML='<div id="dashB">Загрузка…</div>';
 $('ap20').innerHTML='<div class="xrow"><span>Медленный режим, сек:</span><input id="cmSlow" type="number" min="0" max="300" style="width:80px"><button class="btn sm" onclick="cmSlow()">Применить</button></div><div class="xrow"><input id="cmW" placeholder="Запрещённое слово"><button class="btn sm" onclick="cmWord()">Добавить</button></div><div id="cmWords" class="xrow"></div><div class="xrow"><b>Мут/бан:</b></div><div id="cmMuted"></div><div class="xrow"><b>Журнал модерации:</b></div><div id="cmLog" style="font-size:12.5px"></div>';
 $('ap21').innerHTML='<p style="color:var(--m);font-size:13px">Модератор — чат (мут, бан, удаление, слова). Support — пока метка для тикетов.</p><div class="xrow"><input id="rlId" placeholder="ID пользователя" type="number"><select id="rlR"><option value="moderator">moderator</option><option value="support">support</option><option value="">снять роль</option></select><button class="btn sm" onclick="rlSet()">Назначить</button></div><div id="rlList"></div>';
 $('ap22').innerHTML='<div class="xrow"><input id="bkQ" placeholder="Ник / e-mail содержит"><select id="bkS"><option value="">Любая подписка</option><option value="active">Активна</option><option value="none">Нет подписки</option><option value="expiring">Истекает</option></select><input id="bkD" type="number" value="3" style="width:70px" title="Дней до конца"><select id="bkB"><option value="">Все</option><option value="0">Не в бане</option><option value="1">В бане</option></select><button class="btn sm" onclick="bkPrev()">Предпросмотр</button></div><div id="bkOut"></div><div class="xrow" id="bkAct" style="display:none"><input id="bkDays" type="number" placeholder="Дней" style="width:90px"><button class="btn sm" onclick="bkDo(\'grant\')">Выдать дни</button><input id="bkTxt" placeholder="Текст уведомления" style="flex:1"><button class="btn sm" onclick="bkDo(\'notify\')">Разослать</button><button class="btn sm ghost" onclick="bkCsv()">Экспорт CSV</button></div>';
 $('ap23').innerHTML='<div class="xrow"><input id="frId" type="number" placeholder="ID пользователя"><button class="btn sm" onclick="frUser()">Карточка риска</button><button class="btn sm ghost" onclick="loadFraud()">Обновить кластеры</button></div><div id="frUser"></div><div id="frList"></div>';
 $('ap24').innerHTML='<h4>FAQ</h4><div class="xrow"><input id="fq" placeholder="Вопрос" style="flex:1"><input id="fa" placeholder="Ответ" style="flex:2"><button class="btn sm" onclick="ctAdd(\'faq\')">Добавить</button></div><div id="ctFaq"></div><h4>Changelog</h4><div class="xrow"><input id="cv" placeholder="Версия" style="width:90px"><input id="ct" placeholder="Заголовок" style="flex:1"><input id="cx" placeholder="Описание" style="flex:2"><button class="btn sm" onclick="ctAdd(\'cl\')">Добавить</button></div><div id="ctCl"></div><h4>Отзывы</h4><div id="ctRv"></div>'}
window.at=function(i){injectAdmin();const sg=$('seg');[...sg.children].forEach((b,k)=>{const el=$('ap'+k);if(el)el.style.display=k===i?'':'none';b.classList.toggle('on',k===i)});sg.children[i]?.scrollIntoView({inline:'center',block:'nearest'});
 ([null,lk,ul,pli,()=>tlist(1),nli,stt,loadSet,loadAud,loadChart,loadCoup,loadTop,loadIp,null,()=>{},loadHwidLog,loadCfgAdm,licList,ldInfo,loadDash,loadChatMod,loadRoles,null,loadFraud,loadContent][i]||(()=>{}))()};
window.loadDash=async()=>{try{const d=await post('/api/admin/dash'),f=d.funnel,mx=Math.max(1,...d.series.map(s=>Math.max(s[0],s[1])));
 const pc=(a,b)=>b?Math.round(a/b*100)+'%':'—',delta=d.regs_prev?Math.round((d.regs-d.regs_prev)/d.regs_prev*100):null;
 $('dashB').innerHTML=`<div class="xgrid"><div class="stat-card"><b>${d.online}</b><span>онлайн сейчас</span></div><div class="stat-card"><b>${d.regs}</b><span>регистраций за 24ч${delta!==null?' ('+(delta>=0?'+':'')+delta+'%)':''}</span></div><div class="stat-card"><b>${d.acts}</b><span>активаций за 24ч</span></div><div class="stat-card"><b>${d.active}</b><span>активных подписок</span></div></div>
 <h4>Воронка</h4>${[['Регистрация',f.total,f.total],['Триал',f.trial,f.total],['Оплата / ключ',f.paid,f.total]].map(x=>`<div style="font-size:13px">${x[0]}: <b>${x[1]}</b> <span style="color:var(--m)">${pc(x[1],x[2])}</span></div><div class="xbar"><i style="width:${x[2]?x[1]/x[2]*100:0}%"></i></div>`).join('')}
 <h4>Рефералы</h4><p style="font-size:13px">Приглашено: <b>${d.ref.invited}</b> · оплатили: <b>${d.ref.paid}</b> · конверсия: <b>${d.ref.conv}%</b></p>
 <h4>Последние 24 часа (синий — регистрации, зелёный — активации)</h4><svg viewBox="0 0 240 60" style="width:100%;height:90px">${d.series.map((s,i)=>`<rect x="${i*10+1}" y="${58-s[0]/mx*56}" width="4" height="${s[0]/mx*56}" fill="#4da3ff"/><rect x="${i*10+5}" y="${58-s[1]/mx*56}" width="4" height="${s[1]/mx*56}" fill="#35d98a"/>`).join('')}</svg>
 <h4>Промокоды</h4>${d.promos.length?d.promos.map(p=>`<div class="hwid-row"><span>${esc(p.code)}</span><span>${p.uses}/${p.max_uses||'∞'}</span></div>`).join(''):'<small>Нет</small>'}`}catch(e){$('dashB').textContent=e.message}};
window.loadChatMod=async()=>{try{const s=await post('/api/admin/chat/state');$('cmSlow').value=s.slow;$('cmWords').innerHTML=s.words.map(w=>`<span class="badge-s" style="cursor:pointer;background:#2a3142;color:#fff" onclick="cmWordDel('${esc(w).replace(/'/g,'')}')">${esc(w)} ${ico('x',11)}</span>`).join('')||'<small>Список пуст</small>';
 $('cmMuted').innerHTML=s.muted.map(u=>`<div class="hwid-row"><span>${esc(u.username)} — ${u.chat_banned?'бан':'мут до '+dt(u.chat_muted_until)}</span><button class="btn sm ghost" style="height:30px" onclick="cmUn(${u.id})">Снять</button></div>`).join('')||'<small>Никого</small>';
 $('cmLog').innerHTML=s.log.map(l=>`<div class="hwid-row"><span>${dt(l.ts)} · ${esc(l.adm||'')} · <b>${esc(l.action)}</b> ${esc(l.target)}</span><span style="color:var(--m)">${esc(l.details)}</span></div>`).join('')}catch(e){toast(e.message,1)}};
window.cmSlow=async()=>{await post('/api/admin/chat/slow',{sec:+$('cmSlow').value});toast('Готово')};window.cmWord=async()=>{await post('/api/admin/chat/word_add',{word:$('cmW').value});$('cmW').value='';loadChatMod()};
window.cmWordDel=async w=>{await post('/api/admin/chat/word_del',{word:w});loadChatMod()};window.cmUn=async id=>{await post('/api/admin/chat/unmute',{id});loadChatMod()};
window.loadRoles=async()=>{const r=await post('/api/admin/roles');$('rlList').innerHTML=r.list.map(u=>`<div class="hwid-row"><span>#${u.id} ${esc(u.username)}</span><b>${u.is_admin?'admin':u.role||'—'}</b></div>`).join('')};
window.rlSet=async()=>{try{await post('/api/admin/role',{id:+$('rlId').value,role:$('rlR').value});toast('Готово');loadRoles()}catch(e){toast(e.message,1)}};
const bf=()=>({q:$('bkQ').value,sub:$('bkS').value,days:+$('bkD').value,banned:$('bkB').value});
window.bkPrev=async()=>{try{const r=await post('/api/admin/bulk',{action:'preview',filter:bf()});$('bkOut').innerHTML=`<p>Под фильтр попадает: <b>${r.count}</b></p>`+r.sample.map(u=>`<div class="hwid-row"><span>#${u.id} ${esc(u.username)}</span><span style="color:var(--m)">${esc(u.email||'')}</span></div>`).join('')+(r.count>15?'<small>…и ещё '+(r.count-15)+'</small>':'');$('bkAct').style.display=r.count?'flex':'none'}catch(e){toast(e.message,1)}};
window.bkDo=async a=>{const n=a==='grant'?'выдать '+$('bkDays').value+' дн.':'разослать уведомление';if(!confirm('Точно '+n+' всем из предпросмотра?'))return;try{const r=await post('/api/admin/bulk',{action:a,filter:bf(),days:+$('bkDays').value,text:$('bkTxt').value});toast('Готово: '+r.count)}catch(e){toast(e.message,1)}};
window.bkCsv=async()=>{try{const r=await _fetch(API_BASE+'/api/admin/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'csv',filter:bf()}),credentials:'include'});const b=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='users.csv';a.click()}catch(e){toast(e.message,1)}};
window.loadFraud=async()=>{try{const r=await post('/api/admin/fraud');$('frList').innerHTML=r.list.length?r.list.map(c=>`<div class="it" style="display:block;margin:8px 0;padding:10px;border:1px solid var(--bd);border-radius:12px"><b>${esc(c.kind)}</b> <small class="ld-h">${esc(c.value)}</small><div style="margin-top:6px;font-size:13px">${c.users.map(u=>`<a href="#" onclick="event.preventDefault();$('frId').value=${u.id};frUser()" style="color:${u.banned?'#ff7a8d':'var(--r)'};margin-right:10px">#${u.id} ${esc(u.username)}</a>`).join('')}</div></div>`).join(''):'<p style="color:var(--m)">Связанных аккаунтов не найдено</p>'}catch(e){toast(e.message,1)}};
window.frUser=async()=>{try{const r=await post('/api/admin/fraud/user',{id:+$('frId').value});$('frUser').innerHTML=`<div class="card" style="margin:10px 0"><h3>${esc(r.user.username)} — риск: ${r.level} (${r.score}/100)</h3><div class="xbar"><i style="width:${r.score}%;background:${r.score>=60?'#ff4d6a':r.score>=30?'#ffb64d':'#35d98a'}"></i></div><p>Связанных аккаунтов: ${r.linked.length} · триалов: ${r.trials}</p>${r.linked.map(u=>`<div class="hwid-row"><span>#${u.id} ${esc(u.username)}</span><span>${u.banned?'бан':''}</span></div>`).join('')}${r.linked.length?'<button class="btn sm" style="margin-top:8px" onclick="frBan()">Заблокировать связанных</button>':''}</div>`}catch(e){toast(e.message,1)}};
window.frBan=async()=>{if(!confirm('Заблокировать все связанные аккаунты?'))return;try{const r=await post('/api/admin/fraud/banlinked',{id:+$('frId').value});toast('Заблокировано: '+r.count);frUser()}catch(e){toast(e.message,1)}};
window.loadContent=async()=>{const r=await post('/api/admin/content');const row=(t,d,c)=>`<div class="hwid-row"><span>${t}</span><button class="btn sm ghost" style="height:30px" onclick="${d}">${c||'Удалить'}</button></div>`;
 $('ctFaq').innerHTML=r.faq.map(f=>row(esc(f.q),`ctDel('faq',${f.id})`)).join('');$('ctCl').innerHTML=r.changelog.map(c=>row(esc(c.version+' '+c.title),`ctDel('cl',${c.id})`)).join('');
 $('ctRv').innerHTML=r.reviews.map(v=>`<div class="hwid-row"><span>${esc(v.username)} ${v.stars}/5: ${esc(v.text)}</span><span>${v.approved?'':`<button class="btn sm" style="height:30px" onclick="ctRv(${v.id},1)">Одобрить</button> `}<button class="btn sm ghost" style="height:30px" onclick="ctRv(${v.id},0,1)">Удалить</button></span></div>`).join('')||'<small>Нет</small>'};
window.ctAdd=async k=>{if(k==='faq')await post('/api/admin/faq/add',{q:$('fq').value,a:$('fa').value});else await post('/api/admin/changelog/add',{version:$('cv').value,title:$('ct').value,text:$('cx').value});loadContent()};
window.ctDel=async(k,id)=>{await post(k==='faq'?'/api/admin/faq/del':'/api/admin/changelog/del',{id});loadContent()};window.ctRv=async(id,a,d)=>{await post('/api/admin/review',{id,approve:a,del:d});loadContent()};

/* ===== Лендинг: счётчики, FAQ, changelog, отзывы ===== */
async function landing(){const how=$('how');if(!how||$('xpub'))return;try{const r=await _fetch(API_BASE+'/api/public/info').then(x=>x.json());
 const f=r.faq.length,sec=H(`<div id="xpub"><section class="xsec"><div class="xcnt"><div><b>${r.counters.users}</b><span>пользователей</span></div><div><b>${r.counters.activations}</b><span>активаций</span></div></div>
 ${r.reviews.length?'<h2>Отзывы</h2><div class="xrv">'+r.reviews.map(v=>`<div>${ico('star',15,1).repeat(v.stars)}<br>${esc(v.text)}<small>— ${esc(v.username)}</small></div>`).join('')+'</div>':''}</section>
 ${f?`<section class="xsec xfaq" id="faq"><h2>FAQ</h2><input id="xfq" placeholder="Поиск по вопросам…" oninput="faqF(this.value)"><div id="xfl">${r.faq.map(q=>`<details><summary>${esc(q.q)}</summary><p>${esc(q.a)}</p></details>`).join('')}</div></section>`:''}
 ${r.changelog.length?`<section class="xsec" id="chlog"><h2>Что нового</h2><div class="xtl">${r.changelog.map(c=>`<div><b>${esc(c.version||'')} ${esc(c.title||'')}</b><small>${new Date(c.ts).toLocaleDateString('ru-RU')}</small>${esc(c.text||'')}</div>`).join('')}</div></section>`:''}</div>`);
 $('how').after(sec)}catch{}}
window.faqF=v=>{v=v.toLowerCase();document.querySelectorAll('#xfl details').forEach(d=>d.style.display=d.textContent.toLowerCase().includes(v)?'':'none')};

/* ===== хуки ===== */
const _r=window.render;window.render=function(){_r.apply(this,arguments);try{if(user){loadExt();injectAdmin()}else landing()}catch{}};
setTimeout(()=>{try{user?loadExt():landing()}catch{}},1500);
})();
