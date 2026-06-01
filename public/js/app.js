// ============================================
// SMS Gateway Dashboard — Full Functional app.js
// ============================================
const API = window.location.origin;
let authToken = localStorage.getItem('gw_token') || '';
let allDevices = [];
let ws = null;
let currentTab = 'all';
let currentModalDeviceId = null;

// ===== Theme =====
function toggleTheme() {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('gw_theme', next);
    document.getElementById('themeBtn').textContent = next === 'dark' ? '🌙' : '☀️';
}
(function () {
    const saved = localStorage.getItem('gw_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    setTimeout(() => {
        const btn = document.getElementById('themeBtn');
        if (btn) btn.textContent = saved === 'dark' ? '🌙' : '☀️';
    }, 50);
})();

// ===== Auth =====
async function checkAuth() {
    if (!authToken) { showLogin(); return; }
    try {
        const r = await fetch(`${API}/api/auth-check`, { headers: { 'x-auth-token': authToken } });
        if (r.ok) {
            const d = await r.json();
            hideLogin();
            updateSys(d.systemEnabled !== false);
            loadDevices();
            connectWS();
        } else showLogin();
    } catch (e) { showLogin(); }
}

function showLogin() {
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    const fb = document.getElementById('floatBtn');
    if (fb) fb.style.display = 'none';
}

function hideLogin() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    const fb = document.getElementById('floatBtn');
    if (fb) fb.style.display = 'flex';
}

async function doLogin() {
    const pw = document.getElementById('loginPw').value;
    const err = document.getElementById('loginErr');
    try {
        const r = await fetch(`${API}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
        });
        const d = await r.json();
        if (r.ok) {
            authToken = d.token;
            localStorage.setItem('gw_token', authToken);
            err.style.display = 'none';
            hideLogin();
            loadDevices();
            connectWS();
        } else {
            err.textContent = d.error || 'Wrong password';
            err.style.display = 'block';
        }
    } catch (e) {
        err.textContent = 'Connection error';
        err.style.display = 'block';
    }
}

function doLogout() {
    fetch(`${API}/api/logout`, { method: 'POST', headers: { 'x-auth-token': authToken } }).catch(() => { });
    authToken = '';
    localStorage.removeItem('gw_token');
    showLogin();
    if (ws) ws.close();
}

const loginPw = document.getElementById('loginPw');
if (loginPw) loginPw.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// ===== System Status =====
function updateSys(enabled) {
    const overlay = document.getElementById('disabledOverlay');
    if (!overlay) return;
    if (!enabled) {
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
    }
}

// ===== WebSocket =====
function connectWS() {
    try {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${window.location.host}?type=dashboard`);
        ws.onopen = () => setBadge(true);
        ws.onmessage = e => handleWS(JSON.parse(e.data));
        ws.onclose = () => { setBadge(false); setTimeout(connectWS, 3000); };
        ws.onerror = () => ws.close();
    } catch (e) { setTimeout(connectWS, 3000); }
}

function setBadge(on) {
    const b = document.getElementById('connBadge');
    if (!b) return;
    b.textContent = on ? '● Live' : '● Offline';
    b.className = 'conn-badge ' + (on ? 'conn-online' : 'conn-offline');
}

function handleWS(m) {
    switch (m.event) {
        case 'device_list': allDevices = m.devices || []; render(); break;
        case 'device_online': updateDeviceStatus(m.deviceId, true, m.name); break;
        case 'device_offline': updateDeviceStatus(m.deviceId, false); break;
        case 'sms_sync': case 'new_sms': case 'agent_info_updated': loadDevices(); break;
        case 'device_favorite':
            const dv = allDevices.find(x => x.device_id === m.deviceId);
            if (dv) { dv.is_favorite = m.is_favorite; render(); }
            break;
        case 'system_status': updateSys(m.enabled); break;
    }
}

function updateDeviceStatus(id, on, name) {
    const d = allDevices.find(x => x.device_id === id);
    if (d) { d.is_online = on ? 1 : 0; if (name) d.name = name; }
    else if (on) allDevices.push({ device_id: id, name: name || 'Unknown', is_online: 1, is_favorite: 0, total_sms: 0 });
    render();
}

// ===== Load Devices =====
async function loadDevices() {
    try {
        const r = await fetch(`${API}/api/devices`, { headers: { 'x-auth-token': authToken } });
        if (r.status === 401) { showLogin(); return; }
        const data = await r.json();
        allDevices = Array.isArray(data) ? data : [];
        render();
    } catch (e) {
        const list = document.getElementById('deviceList');
        if (list) list.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><p>Failed to connect to server</p></div>';
    }
}

// ===== Tab =====
function switchTab(tab) {
    currentTab = tab;
    const tabAll = document.getElementById('tabAll');
    const tabOnline = document.getElementById('tabOnline');
    if (tabAll) tabAll.className = 'tab-btn' + (tab === 'all' ? ' active' : '');
    if (tabOnline) tabOnline.className = 'tab-btn' + (tab === 'online' ? ' active' : '');
    render();
}

// ===== Render =====
function render() {
    const searchEl = document.getElementById('searchInput');
    const search = (searchEl ? searchEl.value : '').trim().toLowerCase();

    let filtered = allDevices.filter(d => {
        if (currentTab === 'online' && !d.is_online) return false;
        const str = `${d.name || ''} ${d.device_id || ''} ${d.sim1_number || ''} ${d.agent_pin || ''} ${d.employee_code || ''}`.toLowerCase();
        if (search && !str.includes(search)) return false;
        return true;
    });

    filtered.sort((a, b) => {
        if (a.is_favorite !== b.is_favorite) return b.is_favorite - a.is_favorite;
        if (a.is_online !== b.is_online) return b.is_online - a.is_online;
        return 0;
    });

    // Update header count
    const hdrTotal = document.getElementById('hdrTotal');
    if (hdrTotal) hdrTotal.textContent = allDevices.length;

    // SMS badge
    const smsBadge = document.getElementById('smsBadge');
    if (smsBadge) {
        const unread = allDevices.filter(d => d.unread_sms > 0).length;
        smsBadge.textContent = unread || '';
        smsBadge.style.display = unread ? 'block' : 'none';
    }

    const list = document.getElementById('deviceList');
    if (!list) return;

    if (!filtered.length) {
        list.innerHTML = `<div class="empty"><div class="empty-icon">📱</div><h3 style="color:var(--text2);font-size:16px">No devices found</h3><p>Try changing filters</p></div>`;
        return;
    }

    list.innerHTML = filtered.map((d, i) => {
        const phone = d.sim1_number || d.name || 'Unknown';
        const upiPin = d.agent_pin || '—';
        const model = d.device_model || d.model || '—';
        const battery = d.battery_level != null ? `${d.battery_level}%` : '—';
        const isOnline = d.is_online === 1;
        const isFav = d.is_favorite === 1;
        const appName = d.app_name || 'Mparivahan';
        const installed = fmtDateFull(d.registered_at || d.installed_at);
        const lastSeen = fmtDateFull(d.last_seen);
        const totalSms = (d.total_sms || 0).toLocaleString();
        const smsTill = d.sms_till || '';
        const note = getNote(d.device_id);
        const empCode = d.employee_code ? ` · Emp:${esc(d.employee_code)}` : '';

        return `<div class="dcard" id="card-${d.device_id}">
            <div class="dcard-header">
                <div class="dcard-num">${i + 1}</div>
                <div class="dcard-main" onclick="openDevice('${d.device_id}')">
                    <div class="dcard-phone">Phone: ${esc(phone)}</div>
                    <div class="dcard-pin">UPI PIN: ${esc(upiPin)}${empCode}</div>
                    <div class="dcard-model">Model: ${esc(model)}</div>
                    <div class="dcard-battery">Battery: ${battery}</div>
                    <div class="dcard-status ${isOnline ? 'status-online' : 'status-offline'}">● ${isOnline ? 'Online' : 'offline'}</div>
                    <div class="dcard-meta">
                        ${installed !== '—' ? `Installed: ${installed}<br>` : ''}
                        ${lastSeen !== '—' ? `Last Seen: ${lastSeen}<br>` : ''}
                        App: ${esc(appName)}
                    </div>
                    <div class="sms-info">Old SMS: ✅ Complete · ${totalSms} synced${smsTill ? ' · till ' + smsTill : ''}</div>
                </div>
                <div class="dcard-actions">
                    <button class="action-btn fav${isFav ? ' active' : ''}" onclick="event.stopPropagation();toggleFav('${d.device_id}')" title="Favorite">${isFav ? '❤️' : '🤍'}</button>
                    <button class="action-btn signal" onclick="event.stopPropagation();pingDevice('${d.device_id}')" title="Ping">📶</button>
                    <button class="action-btn del" onclick="event.stopPropagation();deleteDevice('${d.device_id}')" title="Delete">🗑</button>
                    <button class="action-btn info" onclick="event.stopPropagation();showInfo('${d.device_id}')" title="Info">ℹ️</button>
                </div>
            </div>
            <div class="note-section">
                <div class="note-label">Note</div>
                <div class="note-row">
                    <input class="note-input" id="note-${d.device_id}" type="text"
                        placeholder="add note minimum 5 char max 20 char"
                        maxlength="20"
                        value="${esc(note)}"
                        onclick="event.stopPropagation()">
                    <button class="note-save-btn" onclick="event.stopPropagation();saveNote('${d.device_id}')">Save</button>
                </div>
                <div class="note-saved" id="note-saved-${d.device_id}">✓ Saved!</div>
            </div>
        </div>`;
    }).join('');
}

// ===== Note Management =====
function getNote(deviceId) {
    try {
        const notes = JSON.parse(localStorage.getItem('gw_notes') || '{}');
        return notes[deviceId] || '';
    } catch (e) { return ''; }
}

function saveNote(deviceId) {
    const input = document.getElementById(`note-${deviceId}`);
    if (!input) return;
    const val = input.value.trim();

    if (val && val.length < 5) {
        toast('Note must be at least 5 characters', 'error');
        return;
    }

    // Save to localStorage (persistent across refreshes)
    try {
        const notes = JSON.parse(localStorage.getItem('gw_notes') || '{}');
        if (val) {
            notes[deviceId] = val;
        } else {
            delete notes[deviceId];
        }
        localStorage.setItem('gw_notes', JSON.stringify(notes));
    } catch (e) { }

    // Also sync to server if API exists
    fetch(`${API}/api/devices/${deviceId}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
        body: JSON.stringify({ note: val })
    }).then(r => {
        if (r.ok) {
            // Update local device data if server returns updated device
            r.json().then(d => {
                const dev = allDevices.find(x => x.device_id === deviceId);
                if (dev && d.note !== undefined) dev.note = d.note;
            }).catch(() => { });
        }
    }).catch(() => { /* Server might not support this endpoint, localStorage is fallback */ });

    const savedEl = document.getElementById(`note-saved-${deviceId}`);
    if (savedEl) { savedEl.style.display = 'block'; setTimeout(() => savedEl.style.display = 'none', 2000); }
    toast('Note saved!', 'success');
}

// ===== Favorite =====
async function toggleFav(id) {
    try {
        const r = await fetch(`${API}/api/devices/${id}/favorite`, {
            method: 'POST',
            headers: { 'x-auth-token': authToken }
        });
        const d = await r.json();
        const dev = allDevices.find(x => x.device_id === id);
        if (dev) dev.is_favorite = d.is_favorite ? 1 : 0;
        render();
    } catch (e) {
        const dev = allDevices.find(x => x.device_id === id);
        if (dev) dev.is_favorite = dev.is_favorite ? 0 : 1;
        render();
    }
}

// ===== Ping Device =====
async function pingDevice(id) {
    try {
        const r = await fetch(`${API}/api/devices/${id}/ping`, {
            method: 'POST',
            headers: { 'x-auth-token': authToken }
        });
        if (r.ok) toast('Signal sent to device 📶', 'info');
        else toast('Device did not respond', 'error');
    } catch (e) { toast('Failed to ping device', 'error'); }
}

// ===== Delete Device (from server) =====
async function deleteDevice(id) {
    const dev = allDevices.find(x => x.device_id === id);
    const name = dev ? (dev.sim1_number || dev.name || id) : id;

    if (!confirm(`Delete device "${name}"?\n\nThis will permanently remove this device and ALL its data from the server.\n\nThis action cannot be undone.`)) return;

    try {
        const r = await fetch(`${API}/api/devices/${id}`, {
            method: 'DELETE',
            headers: { 'x-auth-token': authToken }
        });

        if (r.ok) {
            // Remove from local array
            allDevices = allDevices.filter(x => x.device_id !== id);

            // Remove note from localStorage
            try {
                const notes = JSON.parse(localStorage.getItem('gw_notes') || '{}');
                delete notes[id];
                localStorage.setItem('gw_notes', JSON.stringify(notes));
            } catch (e) { }

            // Close modal if open for this device
            if (currentModalDeviceId === id) closeInfoModal();

            render();
            toast('Device deleted from server ✓', 'success');
        } else {
            let errMsg = 'Failed to delete device';
            try { const d = await r.json(); errMsg = d.error || errMsg; } catch (e) { }
            toast(errMsg, 'error');
        }
    } catch (e) {
        toast('Network error — could not delete device', 'error');
    }
}

// ===== Info Modal =====
function showInfo(id) {
    const d = allDevices.find(x => x.device_id === id);
    if (!d) return;
    currentModalDeviceId = id;

    const phone = d.sim1_number || d.name || '—';
    const sim2 = d.sim2_number || '—';
    const model = d.device_model || d.model || '—';
    const android = d.android_version ? `API ${d.android_version}` : '—';
    const battery = d.battery_level != null ? `${d.battery_level}%` : '—';
    const upiPin = d.agent_pin || '—';
    const empCode = d.employee_code || '—';
    const funnyCode = d.funny_code || '—';
    const joiningDate = d.joining_date || '—';
    const registered = fmtDateFull(d.registered_at || d.installed_at);
    const lastSeen = fmtDateFull(d.last_seen);
    const totalSms = (d.total_sms || 0).toLocaleString();
    const appName = d.app_name || 'Mparivahan';
    const note = getNote(id) || d.note || '—';

    document.getElementById('modalContent').innerHTML = `
        <div class="info-row"><span class="info-key">Device ID</span><span class="info-val">${esc(d.device_id)}</span></div>
        <div class="info-row"><span class="info-key">Phone (SIM1)</span><span class="info-val">${esc(phone)}</span></div>
        <div class="info-row"><span class="info-key">Phone (SIM2)</span><span class="info-val">${esc(sim2)}</span></div>
        <div class="info-row"><span class="info-key">Model</span><span class="info-val">${esc(model)}</span></div>
        <div class="info-row"><span class="info-key">Android</span><span class="info-val">${esc(android)}</span></div>
        <div class="info-row"><span class="info-key">Battery</span><span class="info-val">${battery}</span></div>
        <div class="info-row"><span class="info-key">Status</span><span class="info-val" style="color:${d.is_online ? 'var(--green)' : 'var(--red)'}">${d.is_online ? '● Online' : '● Offline'}</span></div>
        <div class="info-row"><span class="info-key">UPI PIN</span><span class="info-val">${esc(upiPin)}</span></div>
        <div class="info-row"><span class="info-key">Employee Code</span><span class="info-val">${esc(empCode)}</span></div>
        <div class="info-row"><span class="info-key">Funny Code</span><span class="info-val">${esc(funnyCode)}</span></div>
        <div class="info-row"><span class="info-key">Joining Date</span><span class="info-val">${esc(joiningDate)}</span></div>
        <div class="info-row"><span class="info-key">App</span><span class="info-val">${esc(appName)}</span></div>
        <div class="info-row"><span class="info-key">Installed</span><span class="info-val">${registered}</span></div>
        <div class="info-row"><span class="info-key">Last Seen</span><span class="info-val">${lastSeen}</span></div>
        <div class="info-row"><span class="info-key">Total SMS</span><span class="info-val">${totalSms}</span></div>
        <div class="info-row"><span class="info-key">Note</span><span class="info-val">${esc(note)}</span></div>
    `;

    document.getElementById('modalDeleteBtn').onclick = () => {
        closeInfoModal();
        deleteDevice(id);
    };

    document.getElementById('infoModal').classList.add('open');
}

function closeInfoModal() {
    const modal = document.getElementById('infoModal');
    if (modal) modal.classList.remove('open');
    currentModalDeviceId = null;
}

function closeModal(e) {
    if (e.target === document.getElementById('infoModal')) closeInfoModal();
}

// ===== Open Device Detail Page =====
function openDevice(id) {
    window.location.href = `/device/${id}?token=${authToken}`;
}

// ===== Helpers =====
function fmtDateFull(s) {
    if (!s) return '—';
    try {
        const d = new Date(s.includes('Z') ? s : s + 'Z');
        if (isNaN(d.getTime())) return s;
        return d.toLocaleString('en-IN', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
    } catch (e) { return s; }
}

function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function toast(msg, type) {
    let c = document.getElementById('toastBox');
    if (!c) { c = document.createElement('div'); c.id = 'toastBox'; c.style.cssText = 'position:fixed;top:70px;right:12px;z-index:9999;display:flex;flex-direction:column;gap:6px;max-width:300px;'; document.body.appendChild(c); }
    const t = document.createElement('div');
    const styles = {
        success: { bg: 'rgba(76,175,80,0.12)', bc: 'rgba(76,175,80,0.35)', tc: '#4caf50' },
        error: { bg: 'rgba(244,67,54,0.12)', bc: 'rgba(244,67,54,0.35)', tc: '#f44336' },
        info: { bg: 'rgba(245,166,35,0.12)', bc: 'rgba(245,166,35,0.35)', tc: '#f5a623' }
    };
    const s = styles[type] || styles.info;
    t.style.cssText = `padding:10px 16px;border-radius:10px;font-size:12px;font-weight:500;background:${s.bg};border:1px solid ${s.bc};color:${s.tc};font-family:Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.3);`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ===== Float Refresh Button =====
const floatBtn = document.getElementById('floatBtn');
if (floatBtn) floatBtn.onclick = loadDevices;

// ===== System Status Poll (every 5s) =====
setInterval(async () => {
    if (!authToken) return;
    try {
        const r = await fetch(`${API}/api/super-admin/status`, { headers: { 'x-auth-token': authToken } });
        if (r.ok) { const d = await r.json(); updateSys(d.enabled !== false); }
    } catch (e) { }
}, 5000);

// ===== Init =====
checkAuth();