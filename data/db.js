const fs = require('fs');
const path = require('path');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const bcrypt = require('bcryptjs');

const DEFAULT_DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
const DEFAULT_DB_FILE = process.env.DB_FILE || 'db.json';
const dbPath = process.env.DB_PATH || path.join(DEFAULT_DB_DIR, DEFAULT_DB_FILE);
const dbDir = path.dirname(dbPath);

// Ensure the directory exists
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const adapter = new JSONFile(dbPath);
const db = new Low(adapter, { submissions: [], admin_users: [], offline_messages: {}, chats: {} });

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

async function initializeDB() {
    try {
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log('Created database directory:', dbDir);
        }
        
        await db.read();
        
        if (!db.data || typeof db.data !== 'object') {
            console.log('Initializing new database...');
            db.data = { submissions: [], admin_users: [], offline_messages: {}, chats: {} };
        }
        
        db.data.submissions = db.data.submissions || [];
        db.data.admin_users = db.data.admin_users || [];
        db.data.chats = db.data.chats || {};
        
        // Admin user creation (consider making this configurable/secure)
        const adminUser = db.data.admin_users.find(user => user.username === 'Sanud119@gmail.com');
        if (!adminUser) {
            console.log('Creating admin user...');
            const hash = await bcrypt.hash('Sugam@2008', 12);
            db.data.admin_users.push({
                id: Date.now(),
                username: 'Sanud119@gmail.com',
                password_hash: hash,
                created_at: new Date().toISOString()
            });
            await enqueueDbWrite(() => {});
            console.log('Admin user created successfully');
        }
        
        await db.read();
        if (db.data.chats) {
            let hasChanges = false;
            Object.keys(db.data.chats).forEach(clientId => {
                const chat = db.data.chats[clientId];
                if (chat && (chat.isAdmin || (chat.messages && chat.messages.length === 0 && !chat.clientInfo?.name))) {
                    delete db.data.chats[clientId];
                    hasChanges = true;
                    console.log('Cleaned up ghost chat session:', clientId);
                }
            });
            if (hasChanges) {
                await enqueueDbWrite(() => {});
            }
        }

        console.log('Database ready at:', dbPath);
        
    } catch (error) {
        console.error('Database initialization error:', error);
        try {
            db.data = { submissions: [], admin_users: [], offline_messages: {}, chats: {} };
            
            const hash = await bcrypt.hash('Sugam@2008', 12);
            db.data.admin_users.push({
                id: Date.now(),
                username: 'Sanud119@gmail.com',
                password_hash: hash,
                created_at: new Date().toISOString()
            });
            
            await enqueueDbWrite(() => {});
            console.log('Fresh database created successfully');
        } catch (writeError) {
            console.error('Failed to create fresh database:', writeError);
            throw writeError;
        }
    }
}

module.exports = { db, enqueueDbWrite, initializeDB };
