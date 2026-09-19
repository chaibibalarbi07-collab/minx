const SUPABASE_URL = 'https://gybnzemqeehdayhvbkko.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MDxyf4Ucbeza52GMGW4Yaw_mkB31jUU';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth:{ persistSession:true, autoRefreshToken:true }
});

const state = { user:null, profile:null, balance:null, depositCfg:null, withdrawCfg:null, approvedTotal:0, packages:[] };
const $ = id => document.getElementById(id);
const fmt = n => (+n||0).toFixed(2);

function toast(msg, type='info'){
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(()=>{ el.style.transition='.3s'; el.style.opacity='0'; el.style.transform='translateY(-10px)'; setTimeout(()=>el.remove(),300); }, 3200);
}
function showModal(html){ $('modalBody').innerHTML = html; $('modal').classList.remove('hide'); }
function closeModal(){ $('modal').classList.add('hide'); }
$('modal').addEventListener('click', e => { if(e.target.id === 'modal') closeModal(); });

function errMsg(e){
  const m = (e && (e.message || e.error_description)) || 'خطأ';
  const map = {
    'daily_limit_reached':'وصلت للحد اليومي',
    'insufficient_deposit':'مبلغ الإيداع غير مكتمل',
    'invalid_speed':'سرعة غير صالحة',
    'balance_too_low':'رصيدك يجب أن يتجاوز $100 أولاً',
    'account_too_young':'عمر حسابك أقل من 30 يوماً',
    'insufficient_balance':'رصيدك غير كافٍ',
    'below_minimum':'المبلغ أقل من الحد الأدنى',
    'unauthorized':'يجب تسجيل الدخول',
    'forbidden':'ليس لديك صلاحية',
    'invalid_amount':'المبلغ غير صالح'
  };
  for(const k in map){ if(m.includes(k)) return map[k]; }
  return m;
}

function switchAuth(tab){
  $('tabLogin').classList.toggle('active', tab==='login');
  $('tabSignup').classList.toggle('active', tab==='signup');
  $('formLogin').classList.toggle('hide', tab!=='login');
  $('formSignup').classList.toggle('hide', tab!=='signup');
}

async function doSignup(){
  const u = $('suUser').value.trim(), e = $('suEmail').value.trim(), p = $('suPass').value, r = $('suRef').value.trim().toUpperCase();
  if(!u || !e || p.length < 6){ toast('املأ الحقول (كلمة المرور 6+)','error'); return; }
  const btn = $('btnSignup'); btn.disabled = true; btn.textContent = '...';
  try{
    const { error } = await sb.auth.signUp({ email:e, password:p, options:{ data:{ username:u, ref_code: r || null } } });
    if(error) throw error;
    toast('تم التسجيل! تحقق من بريدك','success');
    switchAuth('login');
  }catch(err){ toast(errMsg(err),'error'); }
  finally{ btn.disabled=false; btn.textContent='إنشاء حساب'; }
}

async function doLogin(){
  const e = $('loginEmail').value.trim(), p = $('loginPass').value;
  if(!e || !p){ toast('املأ الحقول','error'); return; }
  const btn = $('btnLogin'); btn.disabled = true; btn.textContent='...';
  try{
    const { error } = await sb.auth.signInWithPassword({ email:e, password:p });
    if(error) throw error;
    await bootstrap();
  }catch(err){ toast(errMsg(err),'error'); }
  finally{ btn.disabled=false; btn.textContent='تسجيل الدخول'; }
}

async function doLogout(){
  await sb.auth.signOut();
  location.reload();
}

function nav(page){
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $('page-'+page).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  window.scrollTo({top:0,behavior:'smooth'});
  if(page === 'speed') loadSpeed();
  if(page === 'ref') loadReferrals();
  if(page === 'profile') loadProfile();
}

async function bootstrap(){
  const { data:{ user } } = await sb.auth.getUser();
  if(!user){ $('authScreen').classList.remove('hide'); $('app').classList.add('hide'); return; }
  state.user = user;

  let { data:p } = await sb.from('profiles').select('*').eq('id',user.id).single();
  if(!p){
    const code = 'MX' + user.id.slice(0,6).toUpperCase();
    await sb.from('profiles').insert({ id:user.id, username:'user_'+user.id.slice(0,6), email:user.email, referral_code:code });
    await sb.from('balances').insert({ user_id:user.id });
    ({ data:p } = await sb.from('profiles').select('*').eq('id',user.id).single());
  }
  state.profile = p;

  const { data:cfg } = await sb.from('admin_settings').select('*').in('key', ['deposit','withdrawal']);
  (cfg||[]).forEach(r => {
    if(r.key==='deposit') state.depositCfg = r.value;
    if(r.key==='withdrawal') state.withdrawCfg = r.value;
  });

  const { data:pkgs } = await sb.from('speed_packages').select('*').eq('is_active',true).order('level');
  state.packages = pkgs || [];

  await loadBalance();
  await loadApprovedDeposits();
  await loadMiningState();
  await loadTransactions();

  $('authScreen').classList.add('hide');
  $('app').classList.remove('hide');
  $('topBalance').textContent = '$' + fmt(state.balance.minx_balance);

  if(p.is_admin) $('adminCard').classList.remove('hide');
}

async function loadBalance(){
  const { data } = await sb.from('balances').select('*').eq('user_id', state.user.id).single();
  if(!data) return;
  state.balance = data;
  $('balanceValue').textContent = fmt(data.minx_balance);
  $('topBalance').textContent = '$' + fmt(data.minx_balance);
  $('pBalance').textContent = '$' + fmt(data.minx_balance);
  $('pLocked').textContent = '$' + fmt(data.locked_balance);
}

async function loadApprovedDeposits(){
  const { data } = await sb.from('deposits').select('amount').eq('user_id', state.user.id).eq('status','approved');
  state.approvedTotal = (data||[]).reduce((s,d)=>s+(+d.amount),0);
}

async function loadMiningState(){
  const today = new Date().toISOString().slice(0,10);
  const { data:claims } = await sb.from('mining_claims').select('*').eq('user_id',state.user.id).gte('claimed_at', today+'T00:00:00Z');
  const todayEarned = (claims||[]).reduce((s,c)=>s+(+c.amount),0);
  const todayClicks = (claims||[]).length;

  const lvl = state.profile.active_speed_level || 1;
  const pkg = state.packages.find(p=>p.level===lvl);
  const value = pkg ? +pkg.value_per_click : 0.1;
  const dailyMax = pkg ? +pkg.daily_max : 1;

  $('speedTag').textContent = 'السرعة ' + lvl + ' — $' + value.toFixed(2) + '/نقرة';
  $('mineBtnVal').textContent = '+$' + value.toFixed(2);

  const pct = Math.min(100, (todayEarned / dailyMax) * 100);
  $('dailyBar').style.width = pct + '%';
  $('dailyLabel').textContent = '$' + todayEarned.toFixed(2) + ' / $' + dailyMax.toFixed(2);

  const maxClicks = Math.floor(dailyMax / value);
  const remaining = Math.max(0, maxClicks - todayClicks);
  $('remainingLabel').textContent = remaining > 0 ? 'متبقٍ: ' + remaining + ' نقرة' : 'وصلت للحد اليومي — عد غداً';

  $('todayEarned').textContent = '$' + todayEarned.toFixed(2);
  $('todayClicks').textContent = todayClicks;
  $('totalClicks').textContent = state.profile.total_clicks || 0;

  const can = todayEarned + value <= dailyMax + 0.0001;
  $('mineBtn').disabled = !can;
  $('mineBtn').classList.toggle('ready', can);
  $('mineBtnLabel').textContent = can ? 'اضغط للتعدين' : 'الحد اليومي اكتمل';
}

async function claimMining(){
  const btn = $('mineBtn'); btn.disabled = true;
  try{
    const { data, error } = await sb.rpc('claim_mining');
    if(error) throw error;
    toast('تم تعدين +$' + (+data.amount).toFixed(2), 'success');
    const { data:p } = await sb.from('profiles').select('*').eq('id', state.user.id).single();
    state.profile = p;
    await loadBalance();
    await loadMiningState();
    await loadTransactions();
  }catch(err){ toast(errMsg(err),'error'); }
}

async function loadSpeed(){
  const { data:pkgs } = await sb.from('speed_packages').select('*').eq('is_active',true).order('level');
  state.packages = pkgs || [];
  $('approvedDeposits').textContent = '$' + state.approvedTotal.toFixed(2);
  renderPackages();
}

function renderPackages(){
  const wrap = $('packagesList');
  if(!state.packages.length){ wrap.innerHTML = '<div class="empty">لا توجد حزم</div>'; return; }
  const currentLvl = state.profile.active_speed_level || 1;
  wrap.innerHTML = state.packages.map(p => {
    const isActive = p.level === currentLvl;
    const locked = state.approvedTotal < (+p.required_deposit);
    const isFree = (+p.required_deposit) === 0;
    let badge = '';
    if(isActive) badge = '<div class="badge active">مفعّل</div>';
    else if(locked && !isFree) badge = '<div class="badge lock">🔒</div>';
    let btnLabel = 'تفعيل', btnClass = 'primary';
    if(isActive){ btnLabel = 'مفعّل حالياً'; btnClass = 'ghost'; }
    else if(locked && !isFree){ btnLabel = 'يتطلب إيداع $' + (+p.required_deposit).toFixed(0); btnClass = 'ghost'; }
    return '<div class="pkg ' + (isActive?'active':'') + ' ' + (locked&&!isFree?'locked':'') + '">' +
      badge +
      '<div class="pkg-hd"><div><div class="pkg-name">Speed ' + p.level + '</div><div class="muted">' + (isFree?'مجاني — يومياً':'يتطلب إيداع معتمد') + '</div></div><div class="pkg-lvl">Lvl ' + p.level + '</div></div>' +
      '<div class="pkg-meta">' +
        '<div><div class="mv">' + (isFree?'مجاني':'$'+(+p.required_deposit).toFixed(0)) + '</div><div class="mk">الإيداع</div></div>' +
        '<div><div class="mv">$' + (+p.value_per_click).toFixed(2) + '</div><div class="mk">/نقرة</div></div>' +
        '<div><div class="mv">$' + (+p.daily_max).toFixed(0) + '</div><div class="mk">حد يومي</div></div>' +
      '</div>' +
      '<button class="btn ' + btnClass + '" style="margin-top:12px" ' + (isActive||(locked&&!isFree)?'disabled':'') + ' onclick="activateSpeed(' + p.level + ')">' + btnLabel + '</button>' +
    '</div>';
  }).join('');
}

async function activateSpeed(level){
  if(!confirm('تأكيد تنشيط Speed ' + level + '؟')) return;
  try{
    const { error } = await sb.rpc('activate_speed', { p_level: level });
    if(error) throw error;
    toast('تم تنشيط Speed ' + level, 'success');
    const { data:p } = await sb.from('profiles').select('*').eq('id', state.user.id).single();
    state.profile = p;
    await loadSpeed();
    await loadMiningState();
  }catch(err){ toast(errMsg(err),'error'); }
}

async function loadReferrals(){
  $('refCode').textContent = state.profile.referral_code;
  $('profileRef').textContent = state.profile.referral_code;
  const link = location.origin + location.pathname + '?ref=' + state.profile.referral_code;
  $('refLink').value = link;
  const { data } = await sb.from('referrals').select('*').eq('referrer_id', state.user.id).order('created_at',{ascending:false});
  const refs = data || [];
  $('refCount').textContent = refs.length;
  $('refEarned').textContent = '$' + refs.reduce((s,r)=>s+(+r.reward_amount),0).toFixed(2);
  const list = $('refList');
  if(!refs.length){ list.innerHTML = '<div class="empty">لا توجد إحالات</div>'; return; }
  list.innerHTML = refs.map(r => '<div class="row"><div><div class="t">مستخدم</div><div class="s">' + new Date(r.created_at).toLocaleDateString('ar') + '</div></div><div class="a ' + (r.rewarded?'pos':'') + '">' + (r.rewarded?'+$'+fmt(r.reward_amount):'قيد التحقق') + '</div></div>').join('');
}

function copyRef(){
  navigator.clipboard.writeText($('refLink').value).then(()=>toast('تم النسخ','success')).catch(()=>toast('فشل النسخ','error'));
}

async function loadProfile(){
  $('profileName').textContent = state.profile.username;
  $('profileEmail').textContent = state.profile.email;
  $('profileRef').textContent = state.profile.referral_code;
  $('avatarEl').textContent = (state.profile.username||'MX').slice(0,2).toUpperCase();
  $('pSpeed').textContent = state.profile.active_speed_level || 1;
  $('pClicks').textContent = state.profile.total_clicks || 0;
  const days = Math.floor((Date.now() - new Date(state.profile.created_at).getTime()) / 86400000);
  $('pAge').textContent = days;
  await loadTransactions();
}

async function loadTransactions(){
  const { data } = await sb.from('transactions').select('*').eq('user_id',state.user.id).order('created_at',{ascending:false}).limit(30);
  const tx = data || [];
  const map = { mining:'تعدين', deposit:'إيداع', withdrawal:'سحب', withdrawal_request:'طلب سحب', withdrawal_refund:'استرجاع سحب' };
  const render = list => !list.length ? '<div class="empty">لا توجد عمليات</div>' :
    list.map(t => '<div class="row"><div><div class="t">' + (map[t.type]||t.type) + '</div><div class="s">' + new Date(t.created_at).toLocaleString('ar') + '</div></div><div class="a ' + ((+t.amount)>=0?'pos':'neg') + '">' + ((+t.amount)>=0?'+':'') + '$' + fmt(t.amount) + '</div></div>').join('');
  $('recentTx').innerHTML = render(tx.slice(0,5));
  $('txList').innerHTML = render(tx);
}

function openDeposit(){
  const wallet = (state.depositCfg && state.depositCfg.wallet) || '—';
  const net = (state.depositCfg && state.depositCfg.network) || 'USDT — BNB Smart Chain (BEP20)';
  showModal(
    '<h3 style="margin-bottom:6px">طلب إيداع</h3>' +
    '<div class="muted" style="margin-bottom:14px">' + net + '</div>' +
    '<div class="field"><label>المبلغ (USDT)</label><input id="dpAmount" type="number" min="1" step="0.01" placeholder="100" oninput="onDepChange()"></div>' +
    '<div id="dpDetails" class="hide">' +
      '<div class="divider"></div>' +
      '<div class="muted" style="margin-bottom:8px">أرسل USDT (BEP20) إلى:</div>' +
      '<div class="wallet-box"><div class="addr">' + wallet + '</div></div>' +
      '<button class="btn ghost" onclick="copyWallet()">📋 نسخ العنوان</button>' +
      '<div class="field" style="margin-top:14px"><label>رقم/هاش العملية (اختياري)</label><input id="dpRef" style="direction:ltr"></div>' +
      '<div class="muted" style="margin-bottom:10px">أرسل طلبك — ستتم المراجعة من الإدارة</div>' +
      '<button class="btn primary" onclick="submitDeposit()" id="dpSubmit">إرسال الطلب</button>' +
    '</div>' +
    '<button class="btn ghost" style="margin-top:8px" onclick="closeModal()">إلغاء</button>'
  );
}
function onDepChange(){ const v = parseFloat($('dpAmount').value); $('dpDetails').classList.toggle('hide', !(v>0)); }
function copyWallet(){ navigator.clipboard.writeText((state.depositCfg && state.depositCfg.wallet) || '').then(()=>toast('تم النسخ','success')); }

async function submitDeposit(){
  const amount = parseFloat($('dpAmount').value);
  const ref = $('dpRef').value.trim();
  if(!amount || amount <= 0){ toast('أدخل مبلغاً صحيحاً','error'); return; }
  const btn = $('dpSubmit'); btn.disabled = true; btn.textContent = '...';
  try{
    const cfg = state.depositCfg || {};
    const { error } = await sb.rpc('request_deposit', {
      p_amount: amount, p_method: cfg.asset||'USDT', p_network: cfg.network_code||'BEP20',
      p_wallet: cfg.wallet||'', p_reference: ref, p_proof_url: 'manual'
    });
    if(error) throw error;
    toast('تم إرسال الطلب — بانتظار المراجعة','success');
    closeModal();
    await loadTransactions();
  }catch(err){ toast(errMsg(err),'error'); btn.disabled = false; btn.textContent = 'إرسال الطلب'; }
}

function openWithdraw(){
  const cfg = state.withdrawCfg || { min_balance:100, min_age_days:30, min_amount:10 };
  const bal = +state.balance.minx_balance;
  const ageDays = Math.floor((Date.now() - new Date(state.profile.created_at).getTime()) / 86400000);
  const cond1 = bal > cfg.min_balance, cond2 = ageDays >= cfg.min_age_days;
  let html = '<h3 style="margin-bottom:6px">طلب سحب</h3><div class="muted" style="margin-bottom:14px">يجب تحقيق الشرطين</div>' +
    '<div class="req-box ' + (cond1?'done':'pending') + '"><div class="req-row"><div><strong>الشرط 1 — الرصيد > $' + cfg.min_balance + '</strong><div class="muted" style="margin-top:4px">رصيدك: $' + bal.toFixed(2) + '</div></div><div class="check ' + (cond1?'ok':'no') + '">' + (cond1?'✓':'!') + '</div></div></div>';
  if(!cond1){
    const need = (cfg.min_balance - bal + 0.01).toFixed(2);
    html += '<div class="muted center" style="margin:20px 0">🔒 الشرط الثاني سيظهر بعد تجاوز الأول<br>تحتاج <strong style="color:var(--gold)">+$' + need + '</strong></div><button class="btn ghost" onclick="closeModal()">إغلاق</button>';
    showModal(html); return;
  }
  html += '<div class="req-box ' + (cond2?'done':'pending') + '"><div class="req-row"><div><strong>الشرط 2 — عمر ≥ ' + cfg.min_age_days + ' يوم</strong><div class="muted" style="margin-top:4px">عمرك: ' + ageDays + ' يوم</div></div><div class="check ' + (cond2?'ok':'no') + '">' + (cond2?'✓':'!') + '</div></div><div class="bar"><i style="width:' + Math.min(100,(ageDays/cfg.min_age_days)*100) + '%"></i></div><div class="muted center" style="margin-top:8px">' + (cond2?'مكتمل ✅':'متبقٍ ' + (cfg.min_age_days-ageDays) + ' يوم') + '</div></div>';
  if(!cond2){
    html += '<div class="muted center" style="margin:16px 0">⏳ يجب الانتظار حتى يكمل حسابك 30 يوماً</div><button class="btn ghost" onclick="closeModal()">إغلاق</button>';
    showModal(html); return;
  }
  html += '<div class="divider"></div>' +
    '<div class="field"><label>المبلغ ($)</label><input id="wdAmount" type="number" min="' + cfg.min_amount + '" step="0.01"></div>' +
    '<div class="field"><label>طريقة السحب</label><select id="wdMethod"><option value="USDT-BEP20">USDT BEP20</option><option value="USDT-TRC20">USDT TRC20</option><option value="BTC">Bitcoin</option></select></div>' +
    '<div class="field"><label>عنوان المحفظة</label><input id="wdAddr" style="direction:ltr" placeholder="0x..."></div>' +
    '<div class="muted" style="margin-bottom:14px">سيُحجز المبلغ حتى موافقة الإدارة.</div>' +
    '<button class="btn primary" onclick="submitWithdraw()" id="wdSubmit">إرسال الطلب</button>' +
    '<button class="btn ghost" style="margin-top:8px" onclick="closeModal()">إلغاء</button>';
  showModal(html);
}

async function submitWithdraw(){
  const amount = parseFloat($('wdAmount').value), method = $('wdMethod').value, address = $('wdAddr').value.trim();
  if(!amount || !address){ toast('املأ الحقول','error'); return; }
  const btn = $('wdSubmit'); btn.disabled = true; btn.textContent = '...';
  try{
    const { error } = await sb.rpc('request_withdrawal', { p_amount:amount, p_method:method, p_address:address });
    if(error) throw error;
    toast('تم إرسال طلب السحب','success');
    closeModal();
    await loadBalance();
    await loadTransactions();
  }catch(err){ toast(errMsg(err),'error'); btn.disabled = false; btn.textContent = 'إرسال الطلب'; }
}

async function openAdmin(){
  showModal('<div class="center"><span class="spinner"></span></div>');
  try{
    const [stats, deps, wds] = await Promise.all([
      sb.rpc('admin_stats'),
      sb.from('deposits').select('*').eq('status','pending').order('created_at'),
      sb.from('withdrawals').select('*').eq('status','pending').order('created_at')
    ]);
    const s = stats.data || {}, dp = deps.data || [], wd = wds.data || [];
    let html = '<h3 style="margin-bottom:14px">لوحة الإدارة</h3>' +
      '<div class="grid2" style="margin-bottom:14px">' +
        '<div class="stat"><div class="v">' + (s.users||0) + '</div><div class="k">مستخدم</div></div>' +
        '<div class="stat"><div class="v">$' + fmt(s.total_balance) + '</div><div class="k">الرصيد الإجمالي</div></div>' +
        '<div class="stat"><div class="v">' + (s.pending_deposits||0) + '</div><div class="k">إيداعات معلقة</div></div>' +
        '<div class="stat"><div class="v">' + (s.pending_withdrawals||0) + '</div><div class="k">سحوبات معلقة</div></div>' +
      '</div>' +
      '<div class="card-title">الإيداعات المعلقة</div>' +
      (dp.length ? dp.map(d => '<div class="row" style="flex-direction:column;align-items:stretch"><div class="t">$' + fmt(d.amount) + ' — ' + (d.network||'BEP20') + '</div><div style="display:flex;gap:6px;margin-top:8px"><button class="btn primary btn-sm" style="flex:1" onclick="admDep(\'' + d.id + '\',true)">قبول</button><button class="btn danger btn-sm" style="flex:1" onclick="admDep(\'' + d.id + '\',false)">رفض</button></div></div>').join('') : '<div class="empty">لا يوجد</div>') +
      '<div class="card-title" style="margin-top:14px">السحوبات المعلقة</div>' +
      (wd.length ? wd.map(w => '<div class="row" style="flex-direction:column;align-items:stretch"><div class="t">$' + fmt(w.amount) + ' — ' + (w.method||'') + '</div><div class="s">' + ((w.address||'').slice(0,20)) + '...</div><div style="display:flex;gap:6px;margin-top:8px"><button class="btn primary btn-sm" style="flex:1" onclick="admWd(\'' + w.id + '\',true)">قبول</button><button class="btn danger btn-sm" style="flex:1" onclick="admWd(\'' + w.id + '\',false)">رفض</button></div></div>').join('') : '<div class="empty">لا يوجد</div>') +
      '<button class="btn ghost" style="margin-top:14px" onclick="closeModal()">إغلاق</button>';
    showModal(html);
  }catch(err){ toast(errMsg(err),'error'); closeModal(); }
}
async function admDep(id, ok){ const note = ok?null:prompt('سبب الرفض:')||null; const { error } = await sb.rpc('admin_process_deposit',{p_id:id,p_approve:ok,p_note:note}); if(error) return toast(errMsg(error),'error'); toast('تمت المعالجة','success'); openAdmin(); }
async function admWd(id, ok){ const note = ok?null:prompt('سبب الرفض:')||null; const { error } = await sb.rpc('admin_process_withdrawal',{p_id:id,p_approve:ok,p_note:note}); if(error) return toast(errMsg(error),'error'); toast('تمت المعالجة','success'); openAdmin(); }

(async function init(){
  const params = new URLSearchParams(location.search);
  const ref = params.get('ref');
  if(ref){ $('suRef').value = ref; switchAuth('signup'); history.replaceState({}, '', location.pathname); }
  sb.auth.onAuthStateChange((event) => { if(event === 'SIGNED_OUT'){ $('app').classList.add('hide'); $('authScreen').classList.remove('hide'); } });
  setTimeout(async ()=>{ $('splash').classList.add('hide'); await bootstrap(); }, 1200);
})();
