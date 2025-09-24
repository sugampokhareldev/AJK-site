
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const fs = require('fs');

// ==================== DATABASE SETUP ====================
const DEFAULT_DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
const DEFAULT_DB_FILE = process.env.DB_FILE || 'db.json';
const dbPath = process.env.DB_PATH || path.join(DEFAULT_DB_DIR, DEFAULT_DB_FILE);
const dbDir = path.dirname(dbPath);

// Ensure the directory exists
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database
const adapter = new JSONFile(dbPath);
const db = new Low(adapter, { submissions: [], admin_users: [], offline_messages: {}, chats: {} });

// ==================== DATABASE WRITE QUEUE ====================
// Prevents LowDB corruption from concurrent writes
let dbWriteQueue = Promise.resolve();

const enqueueDbWrite = (writeFunction) => {
    dbWriteQueue = dbWriteQueue.then(async () => {
        try {
            await writeFunction();
            await db.write();
        } catch (e) {
            console.error('Error during queued DB write:', e);
        }
    });
    return dbWriteQueue;
};

const initializeDB = async () => {
    await db.read();
    console.log('Database initialized');
};

module.exports = { db, enqueueDbWrite, initializeDB };
