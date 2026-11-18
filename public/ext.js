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
.ch-rp{display:none;align-items:center;gap:8px;padding:6px 12px;font-size:12px;color:#9fb4cf;border-top:1px solid rgba(255,255,255,.08)}.ch-rp b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.ch-rp button{background:none;border:0;color:#ff7a8d;cursor:pointer}
.ch-q{font-size:11.5px;color:#7f8ca2;border-left:2px solid var(--r);padding-left:7px;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ch-pm{font-size:9.5px;font-weight:800;letter-spacing:.08em;padding:2px 6px;border-radius:6px;background:rgba(255,170,60,.18);color:#ffb64d;border:1px solid rgba(255,170,60,.4)}
.ch-me-t{background:rgba(59,158,255,.18);border-radius:6px;padding:0 3px;color:#9fd0ff}.ch-m.pm .ch-t{color:#ffd9a0}
.ch-a{margin-left:auto;display:flex;gap:6px;opacity:0;transition:.15s}.ch-m:hover .ch-a,.ch-m:focus-within .ch-a{opacity:1}@media(hover:none){.ch-a{opacity:.8}}
.ch-a button{background:none;border:0;color:#7f8ca2;cursor:pointer;font-size:11.5px;padding:0}.ch-a button:hover{color:#fff}
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

/* ===== Чат ===== */
let rpl=0;const muted=()=>{try{return JSON.parse(localStorage.ch_mute||'[]')}catch{return[]}};
window.chatHide=n=>{const m=muted();if(!m.includes(n)){m.push(n);localStorage.ch_mute=JSON.stringify(m)}document.querySelectorAll('#chList .ch-m').forEach(e=>{if(e.dataset.u===n)e.remove()});toast('Скрыто: '+n+' (у вас)')};
window.chatUnhideAll=()=>{localStorage.ch_mute='[]';toast('Скрытые показаны после обновления')};
window.chatReply=(id,name,txt)=>{rpl=id;const b=$('chRp');b.style.display='flex';b.querySelector('b').textContent='Ответ '+name+': '+txt;$('chIn').focus()};
window.chatModAct=async(a,id,uid,name)=>{try{if(a==='mute'){const m=prompt('Мут '+name+' на сколько минут?','10');if(!m)return;await post('/api/admin/chat/mute',{id:uid,minutes:+m})}
 else if(a==='ban'){if(!confirm('Забанить '+name+' в чате?'))return;await post('/api/admin/chat/ban',{id:uid})}toast('Готово')}catch(e){toast(e.message,1)}};
window.chNode=function(m){
 const d=document.createElement('div');d.className='ch-m'+(m.uid===chMe?' me':'')+(m.to?' pm':'');d.dataset.id=m.id;d.dataset.u=m.username;
 if(muted().includes(m.username)&&m.uid!==chMe)d.style.display='none';
 const a=document.createElement('div');a.className='ch-av';avFill(a,m.avatar,m.username);
 const c=document.createElement('div');c.className='ch-c';
 const h=document.createElement('div');h.className='ch-n';const nm=document.createElement('span');nm.textContent=m.username;h.appendChild(nm);
 if(m.is_admin||m.role){const t=document.createElement('em');t.textContent=m.is_admin?'ADMIN':m.role==='moderator'?'MOD':'SUPPORT';h.appendChild(t)}
 if(m.to){const t=document.createElement('span');t.className='ch-pm';t.textContent=m.uid===chMe?'ЛС → '+m.to:'ЛС';h.appendChild(t)}
 const tm=document.createElement('small');tm.textContent=new Date(m.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});h.appendChild(tm);
 const ac=document.createElement('span');ac.className='ch-a';
 const bt=(t,f,ti)=>{const x=document.createElement('button');x.textContent=t;x.title=ti;x.onclick=f;ac.appendChild(x)};
 bt('↩',()=>chatReply(m.id,m.username,m.text.slice(0,40)),'Ответить');
 if(m.uid!==chMe)bt('скрыть',()=>chatHide(m.username),'Скрыть этого пользователя у себя');
 if(chAdm&&m.uid!==chMe&&!m.is_admin){bt('мут',()=>chatModAct('mute',m.id,m.uid,m.username),'Мут');bt('бан',()=>chatModAct('ban',m.id,m.uid,m.username),'Бан в чате')}
 if(chAdm)bt('✕',()=>chatDel(m.id),'Удалить');
 h.appendChild(ac);c.appendChild(h);
 if(m.reply){const q=document.createElement('div');q.className='ch-q';q.textContent='↩ '+m.reply.username+': '+m.reply.text;c.appendChild(q)}
 const t=document.createElement('div');t.className='ch-t';
 const me=(user&&user.username||'').toLowerCase();
 m.text.split(/(@[A-Za-z0-9_]{3,20})/g).forEach(p=>{if(/^@/.test(p)){const s=document.createElement('span');s.textContent=p;if(p.slice(1).toLowerCase()===me)s.className='ch-me-t';t.appendChild(s)}else t.appendChild(document.createTextNode(p))});
 c.appendChild(t);d.appendChild(a);d.appendChild(c);return d};
window.chatSend=async function(){const i=$('chIn'),t=i.value.trim();if(!t)return;i.value='';const r=rpl;rpl=0;$('chRp').style.display='none';
 try{await api('/api/chat/send',{text:t,reply:r});setTimeout(chPoll,120)}catch(e){toast(e.message,1);i.value=t}};
function chatInit(){if($('chRp'))return;const inp=$$('.ch-in');if(!inp)return;const b=H('<div class="ch-rp" id="chRp"><b></b><button onclick="rpl=0;this.parentNode.style.display=\'none\'">✕</button></div>');b.querySelector('button').onclick=()=>{rpl=0;b.style.display='none'};inp.parentNode.insertBefore(b,inp);
 $('chIn').placeholder='Сообщение… (@ник, /w ник текст — личное)'}

/* ===== Кабинет: карточки ===== */
let injected=false,lastLoad=0;
function inject(){const g=$$('#cab .grid');if(!g||injected)return;injected=true;
 const card=(id,t,body)=>H(`<div class="card" id="${id}"><h3>${t}</h3>${body}</div>`);
 const dv=$('dv');if(dv&&!$('hwcd'))dv.after(H('<p id="hwcd" style="font-size:12.5px;margin-top:8px"></p>'));
 (($('adm'))?(...c)=>$('adm').before(...c):(...c)=>g.append(...c))(
  card('xLvl','Уровень и достижения','<div class="kv"><span>Уровень</span><b id="xl">—</b></div><div class="xbar"><i id="xlb" style="width:0"></i></div><small id="xlt" style="color:var(--m)"></small><div id="xach" style="margin-top:8px"></div>'),
  card('xHist','История подписки','<div class="xtl" id="xhist"><small>Загрузка…</small></div>'),
  card('x2fa','Двухфакторная защита (2FA)','<p id="x2s"></p><div id="x2b"></div>'),
  card('xRv','Отзыв о сервисе','<div class="fld ta"><textarea id="xrvt" placeholder=" "></textarea><label>Ваш отзыв (от 10 символов)</label></div><div class="row"><select id="xrvs" style="padding:10px;border-radius:10px;background:var(--card2);color:var(--fg);border:1px solid var(--bd)"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select><button class="btn sm" onclick="sendReview()">Отправить</button></div><p style="font-size:12px">Отзыв появится на сайте после модерации.</p>'))}
window.sendReview=async()=>{try{const r=await post('/api/review',{text:$('xrvt').value,stars:+$('xrvs').value});toast(r.msg);$('xrvt').value=''}catch(e){toast(e.message,1)}};
async function loadExt(){if(!user)return;chatInit();inject();if(Date.now()-lastLoad<15000)return;lastLoad=Date.now();
 try{const x=window.__x=await post('/api/ext/me');
  $('xl').textContent=x.level+' · '+x.xp+' XP';$('xlb').style.width=Math.min(100,(x.xp-x.lvl_from)/(x.lvl_to-x.lvl_from)*100)+'%';$('xlt').textContent='До уровня '+(x.level+1)+': '+Math.max(0,x.lvl_to-x.xp)+' XP';
  $('xach').innerHTML=x.ach.map(a=>`<div class="xach ${a.done?'ok':'off'}"><div class="xb">${a.done?'✓':Math.round(a.cur/a.goal*100)+'%'}</div><div><b>${esc(a.title)}</b><small>${esc(a.desc)} · ${a.cur}/${a.goal}</small></div></div>`).join('');
  const hc=$('hwcd');if(hc)hc.textContent=x.hwid_cd>0?'Сброс устройства: доступен через '+(x.hwid_cd>=864e5?Math.ceil(x.hwid_cd/864e5)+' дн.':Math.ceil(x.hwid_cd/36e5)+' ч.'):'Сброс устройства доступен сейчас (удалите устройство в списке).';
  draw2fa(x)}catch{}
 try{const h=await post('/api/history'),L={trial:'Пробный период',key:'Активация ключа',redeem:'Активация ключа',promo:'Промокод',gift:'Подарок',admin:'Выдано админом',admin_grant:'Выдано админом',ref:'Бонус за реферала'};
  $('xhist').innerHTML=h.list.length?h.list.map(i=>`<div><b>${esc(L[i.source]||i.source||'Событие')}</b> ${i.days>0?'+'+i.days+' дн.':i.days<0?i.days+' дн.':'∞'}<small>${dt(i.ts)}${i.details?' · '+esc(String(i.details).replace(/\[.*?\]/,'').trim().slice(0,60)):''}</small></div>`).join(''):'<small>Пока пусто</small>'}catch{}}
function draw2fa(x){$('x2s').textContent=x.totp_on?'2FA включена: код нужен при входе и смене пароля.':'Защитите аккаунт кодом из Google Authenticator / Authy.';
 $('x2b').innerHTML=x.totp_on?'<div class="row"><button class="btn sm ghost" onclick="tfaOff()">Отключить 2FA</button></div>':'<div class="row"><button class="btn sm" onclick="tfaSetup()">Включить 2FA</button></div><div id="x2q"></div>'}
window.tfaSetup=async()=>{try{const r=await post('/api/2fa/setup');$('x2q').innerHTML=`<p style="margin-top:10px">Добавьте в приложение ключ вручную:</p><pre style="font-size:15px;letter-spacing:2px;white-space:pre-wrap;word-break:break-all">${esc(r.secret)}</pre><p><a href="${esc(r.uri)}" style="color:var(--r)">Открыть в приложении</a></p><div class="xrow"><input id="x2c" placeholder="Код из приложения" inputmode="numeric" maxlength="6"><button class="btn sm" onclick="tfaOn()">Подтвердить</button></div>`}catch(e){toast(e.message,1)}};
window.tfaOn=async()=>{try{await post('/api/2fa/enable',{code:$('x2c').value});toast('2FA включена');lastLoad=0;loadExt()}catch(e){toast(e.message,1)}};
window.tfaOff=async()=>{const c=prompt('Код 2FA для отключения:');if(!c)return;try{await post('/api/2fa/disable',{code:c});toast('2FA отключена');lastLoad=0;loadExt()}catch(e){toast(e.message,1)}};

/* ===== Конфиги: избранное и оценки ===== */
const _sc=window.showConfigs;
window.showConfigs=async function(){await _sc();if(!user)return;try{const m=await post('/api/config/mine'),L=$('cfgList');if(!L)return;
 L.querySelectorAll('.it[onclick^="openCfg"]').forEach(it=>{const id=+it.getAttribute('onclick').match(/\d+/)[0],s=m.stats[id],f=m.fav.includes(id),r=m.rate[id]||0;
  const x=H(`<div style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--m)" onclick="event.stopPropagation()"><button class="btn sm ghost" style="height:30px;padding:0 10px" onclick="cfgFav(${id})">${f?'★ В избранном':'☆ В избранное'}</button><span>${s?'★ '+s.avg+' ('+s.n+')':'нет оценок'}</span><select style="padding:5px;border-radius:8px;background:var(--card2);color:var(--fg);border:1px solid var(--bd)" onchange="cfgRate(${id},this.value)"><option value="">Оценить</option>${[5,4,3,2,1].map(n=>`<option value="${n}"${r===n?' selected':''}>${n} ★</option>`).join('')}</select></div>`);it.appendChild(x)});
 const items=[...L.querySelectorAll('.it')];items.sort((a,b)=>(b.textContent.includes('★ В избранном')?1:0)-(a.textContent.includes('★ В избранном')?1:0)).forEach(e=>L.appendChild(e))}catch{}};
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
window.loadChatMod=async()=>{try{const s=await post('/api/admin/chat/state');$('cmSlow').value=s.slow;$('cmWords').innerHTML=s.words.map(w=>`<span class="badge-s" style="cursor:pointer;background:#2a3142;color:#fff" onclick="cmWordDel('${esc(w).replace(/'/g,'')}')">${esc(w)} ✕</span>`).join('')||'<small>Список пуст</small>';
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
 $('ctRv').innerHTML=r.reviews.map(v=>`<div class="hwid-row"><span>${esc(v.username)} ${v.stars}★: ${esc(v.text)}</span><span>${v.approved?'':`<button class="btn sm" style="height:30px" onclick="ctRv(${v.id},1)">Одобрить</button> `}<button class="btn sm ghost" style="height:30px" onclick="ctRv(${v.id},0,1)">Удалить</button></span></div>`).join('')||'<small>Нет</small>'};
window.ctAdd=async k=>{if(k==='faq')await post('/api/admin/faq/add',{q:$('fq').value,a:$('fa').value});else await post('/api/admin/changelog/add',{version:$('cv').value,title:$('ct').value,text:$('cx').value});loadContent()};
window.ctDel=async(k,id)=>{await post(k==='faq'?'/api/admin/faq/del':'/api/admin/changelog/del',{id});loadContent()};window.ctRv=async(id,a,d)=>{await post('/api/admin/review',{id,approve:a,del:d});loadContent()};

/* ===== Лендинг: счётчики, FAQ, changelog, отзывы ===== */
async function landing(){const how=$('how');if(!how||$('xpub'))return;try{const r=await _fetch(API_BASE+'/api/public/info').then(x=>x.json());
 const f=r.faq.length,sec=H(`<div id="xpub"><section class="xsec"><div class="xcnt"><div><b>${r.counters.users}</b><span>пользователей</span></div><div><b>${r.counters.activations}</b><span>активаций</span></div></div>
 ${r.reviews.length?'<h2>Отзывы</h2><div class="xrv">'+r.reviews.map(v=>`<div>${'★'.repeat(v.stars)}<br>${esc(v.text)}<small>— ${esc(v.username)}</small></div>`).join('')+'</div>':''}</section>
 ${f?`<section class="xsec xfaq" id="faq"><h2>FAQ</h2><input id="xfq" placeholder="Поиск по вопросам…" oninput="faqF(this.value)"><div id="xfl">${r.faq.map(q=>`<details><summary>${esc(q.q)}</summary><p>${esc(q.a)}</p></details>`).join('')}</div></section>`:''}
 ${r.changelog.length?`<section class="xsec" id="chlog"><h2>Что нового</h2><div class="xtl">${r.changelog.map(c=>`<div><b>${esc(c.version||'')} ${esc(c.title||'')}</b><small>${new Date(c.ts).toLocaleDateString('ru-RU')}</small>${esc(c.text||'')}</div>`).join('')}</div></section>`:''}</div>`);
 $('how').after(sec)}catch{}}
window.faqF=v=>{v=v.toLowerCase();document.querySelectorAll('#xfl details').forEach(d=>d.style.display=d.textContent.toLowerCase().includes(v)?'':'none')};

/* ===== хуки ===== */
const _r=window.render;window.render=function(){_r.apply(this,arguments);try{if(user){loadExt();injectAdmin()}else landing()}catch{}};
setTimeout(()=>{try{user?loadExt():landing()}catch{}},1500);
})();
