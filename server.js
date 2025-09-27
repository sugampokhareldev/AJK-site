// Load environment variables
require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const validator = require('validator');
const rateLimit = require('express-rate-limit');
const compression = require('compression'); // Performance FIX: Add compression

// Use memory store for sessions to avoid file system issues on Render
const MemoryStore = require('memorystore')(session);
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Trust proxy (CRITICAL for secure cookies behind a reverse proxy like Render)
app.set('trust proxy', 1);

// Environment-specific settings
const isProduction = NODE_ENV === 'production';

// Use environment secret or generate one for development
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
    if (isProduction) {
        console.error('CRITICAL: SESSION_SECRET is not set in the environment variables for production.');
        process.exit(1);
    }
    SESSION_SECRET = crypto.randomBytes(64).toString('hex');
    console.warn('Warning: SESSION_SECRET not set. Using a temporary secret for development.');
}

// Database setup with lowdb
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'db.json');
const dbDir = path.dirname(dbPath);

// Ensure the directory exists
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const adapter = new JSONFile(dbPath);
const db = new Low(adapter, { submissions: [], admin_users: [], offline_messages: {}, chats: {} });


// =================================================================
// MIDDLEWARE SETUP
// =================================================================
app.use(compression()); // Performance FIX: Enable compression for all responses
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://ajkcleaners.de',
            'https://www.ajkcleaners.de',
            'https://ajk-cleaning.onrender.com',
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:3001',
            'http://127.0.0.1:3001'
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1 || (origin && origin.includes('localhost'))) {
            callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Set-Cookie']
}));
app.options('*', cors());
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));


// =================================================================
// SECURE GEMINI API PROXY
// =================================================================
app.post('/api/gemini', async (req, res) => {
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
        console.error('Gemini API key is not configured on the server.');
        return res.status(500).json({ error: { message: 'The AI service is not configured correctly. Please contact support.' } });
    }
    
    if (!req.body || !req.body.contents) {
        return res.status(400).json({ error: { message: 'Request body is required and must contain "contents"' } });
    }

    const { contents, systemInstruction } = req.body;
    
    if (contents.length === 0) {
        return res.status(400).json({ error: { message: 'Invalid request body: contents are empty.' } });
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`;

    try {
        const fetch = (await import('node-fetch')).default;
        
        const geminiPayload = {
            contents: contents
        };

        if (systemInstruction) {
            geminiPayload.systemInstruction = systemInstruction;
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Gemini API Error:', data);
            const errorMessage = data?.error?.message || `API error: ${response.status}`;
            return res.status(response.status).json({ error: { message: errorMessage } });
        }

        res.json(data);
    } catch (error) {
        console.error('Error proxying request to Gemini API:', error);
        res.status(500).json({ error: { message: `The server encountered an error while trying to contact the AI service. Details: ${error.message}` } });
    }
});
// =================================================================
// END OF GEMINI PROXY
// =================================================================


// ==================== WEBSOCKET CHAT SERVER ====================
const clients = new Map();
const adminSessions = new Map();
const chatHistory = [];
const connectionQuality = new Map();

// Persist a chat message to LowDB for a given clientId
async function persistChatMessage(clientId, message) {
  try {
    await db.read();
    db.data = db.data && typeof db.data === 'object' ? db.data : {};
    db.data.chats = db.data.chats || {};
    if (!db.data.chats[clientId] || db.data.chats[clientId].deleted) {
      db.data.chats[clientId] = {
        clientInfo: db.data.chats[clientId]?.clientInfo || { name: 'Guest', email: '', ip: 'unknown', firstSeen: new Date().toISOString() },
        messages: []
      };
    }
    const exists = (db.data.chats[clientId].messages || []).some(m => m.id === message.id);
    if (!exists) {
      db.data.chats[clientId].messages.push({
        id: message.id,
        message: message.message,
        timestamp: message.timestamp,
        isAdmin: !!message.isAdmin,
        type: message.type || 'chat'
      });
      await db.write();
    }
  } catch (e) {
    console.error('Error persisting chat message:', e);
  }
}

// Function to store offline messages for ADMINS
function storeAdminOfflineMessage(clientId, message) {
  if (!db.data.offline_messages) {
    db.data.offline_messages = {};
  }
 
  if (!db.data.offline_messages[clientId]) {
    db.data.offline_messages[clientId] = [];
  }
 
  db.data.offline_messages[clientId].push({
    message,
    timestamp: new Date().toISOString()
  });
 
  db.write().catch(err => console.error('Error saving offline message:', err));
}

// Function to deliver offline messages when admin connects
function deliverAdminOfflineMessages() {
  if (!db.data.offline_messages) return;
 
  Object.keys(db.data.offline_messages).forEach(clientId => {
    const messages = db.data.offline_messages[clientId];
    messages.forEach(msg => {
      chatHistory.push(msg.message);
      broadcastToAll(msg.message);
    });
    
    delete db.data.offline_messages[clientId];
  });
 
  db.write().catch(err => console.error('Error clearing offline messages:', err));
}

function broadcastToAll(message, sourceSessionId = null, excludeClientId = null) {
    clients.forEach(c => {
        if (excludeClientId && c.id === excludeClientId) return;
        
        if (message.isAdmin) {
            if (c.id === message.clientId && c.ws.readyState === WebSocket.OPEN) {
                try { c.ws.send(JSON.stringify(message)); } 
                catch (error) { console.error('Error sending message to client:', error); }
            }
            if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                try { c.ws.send(JSON.stringify(message)); }
                catch (error) { console.error('Error sending message to admin:', error); }
            }
        } else {
            if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                try { c.ws.send(JSON.stringify(message)); }
                catch (error) { console.error('Error sending message to admin:', error); }
            }
        }
    });
}

function notifyAdmin(type, payload, targetSessionId = null) {
    clients.forEach(client => {
        if (client.isAdmin && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify({ type, payload, timestamp: new Date().toISOString() }));
            } catch (error) {
                console.error('Error notifying admin:', error);
            }
        }
    });
}

// FIX: This function now handles offline message persistence.
async function sendToClient(clientId, messageText, sourceSessionId = null) {
    const client = clients.get(clientId);
    const adminMessage = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        type: 'chat',
        message: messageText,
        name: 'Support',
        timestamp: new Date().toISOString(),
        isAdmin: true,
        clientId: clientId,
        sessionId: sourceSessionId
    };

    chatHistory.push(adminMessage);

    // If client is online, send directly via WebSocket
    if (client && client.ws.readyState === WebSocket.OPEN) {
        try {
            client.ws.send(JSON.stringify(adminMessage));
            await persistChatMessage(clientId, adminMessage);
            return { success: true, status: 'delivered' };
        } catch (error) {
            console.error('Error sending message to client, will attempt to save:', error);
            await persistChatMessage(clientId, adminMessage);
            return { success: true, status: 'saved_after_error' };
        }
    } else {
        // If client is offline, just save the message to the database
        await persistChatMessage(clientId, adminMessage);
        console.log(`Client ${clientId} is offline. Message saved.`);
        return { success: true, status: 'saved_offline' };
    }
}


function sendChatReset(clientId) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        try {
            client.ws.send(JSON.stringify({
                type: 'chat_reset',
                message: 'Chat session has been reset by admin.',
                timestamp: new Date().toISOString(),
                resetToAI: true
            }));
            return true;
        } catch (error) {
            console.error('Error sending chat reset message:', error);
            return false;
        }
    }
    return false;
}

function broadcastToClients(messageText, sourceSessionId = null) {
    let count = 0;
    clients.forEach(client => {
        if (!client.isAdmin && client.ws.readyState === WebSocket.OPEN && 
            (!sourceSessionId || client.sessionId === sourceSessionId)) {
            const adminMessage = {
                id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                type: 'chat',
                message: messageText,
                name: 'Support',
                timestamp: new Date().toISOString(),
                isAdmin: true,
                clientId: client.id,
                sessionId: sourceSessionId
            };
            
            chatHistory.push(adminMessage);
            
            try {
                client.ws.send(JSON.stringify(adminMessage));
                count++;
            } catch (error) {
                console.error('Error broadcasting to client:', error);
            }
        }
    });
    return count;
}

async function cleanupGhostChats() {
    try {
        await db.read();
        const chats = db.data.chats || {};
        let removedCount = 0;
        
        Object.keys(chats).forEach(clientId => {
            const chat = chats[clientId];
            if (chat && 
                chat.clientInfo && 
                chat.clientInfo.name === 'Guest' && 
                (!chat.messages || chat.messages.length === 0) &&
                new Date(chat.clientInfo.firstSeen) < new Date(Date.now() - 24 * 60 * 60 * 1000)) {
                
                delete chats[clientId];
                removedCount++;
            }
        });
        
        if (removedCount > 0) {
            await db.write();
            console.log(`Cleaned up ${removedCount} ghost chats`);
        }
    } catch (e) {
        console.error('Error cleaning up ghost chats:', e);
    }
}

const wss = new WebSocket.Server({ 
    server,
    perMessageDeflate: {
        zlibDeflateOptions: {
            chunkSize: 1024,
            windowBits: 13,
            concurrencyLimit: 10,
        },
        threshold: 1024,
        serverMaxWindow: 15,
        clientMaxWindow: 15,
        serverMaxNoContextTakeover: false,
        clientMaxNoContextTakeover: false,
    }
});

const allowedOrigins = [
    'https://ajk-cleaning.onrender.com',
    'https://ajkcleaners.de',
    'http://ajkcleaners.de',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001'
];

async function handleAdminConnection(ws, request) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId) {
        ws.close(1008, 'Session ID required');
        return;
    }
    
    const sessionData = adminSessions.get(sessionId);
    if (!sessionData) {
        ws.close(1008, 'Invalid admin session');
        return;
    }
    
    const clientId = 'admin_' + sessionId;
    const client = {
        ws,
        isAdmin: true,
        name: 'Admin',
        id: clientId,
        sessionId: sessionId,
        joined: new Date().toISOString()
    };
    
    clients.set(clientId, client);
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            await handleAdminMessage(client, message);
        } catch (error) {
            console.error('Admin WebSocket message error:', error);
        }
    });
    
    ws.on('close', () => {
        clients.delete(clientId);
        console.log('Admin disconnected:', sessionId);
    });
    
    ws.on('error', (error) => {
        console.error('Admin WebSocket error:', error);
        clients.delete(clientId);
    });
    
    ws.send(JSON.stringify({
        type: 'admin_identified',
        message: 'Admin connection established'
    }));

    deliverAdminOfflineMessages();

    notifyAdmin(`Admin connected`, { name: 'Admin', sessionId });
}

async function handleAdminMessage(adminClient, message) {
    switch (message.type) {
        case 'get_chat_history':
            if (message.clientId) {
                try {
                    await db.read();
                    const clientChat = db.data.chats[message.clientId];
                    
                    const memoryMessages = chatHistory.filter(m => m.clientId === message.clientId);
                    const persistedMessages = (clientChat && !clientChat.deleted) ? (clientChat.messages || []) : [];
                    
                    const allMessages = [...memoryMessages, ...persistedMessages];
                    const uniqueMessages = allMessages.filter((msg, index, self) => 
                        index === self.findIndex(m => m.id === msg.id)
                    );
                    
                    uniqueMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

                    adminClient.ws.send(JSON.stringify({
                        type: 'chat_history',
                        clientId: message.clientId,
                        messages: uniqueMessages
                    }));
                } catch (error) {
                    console.error('Error loading chat history:', error);
                    adminClient.ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Failed to load chat history'
                    }));
                }
            }
            break;
            
        case 'admin_message':
            if (message.clientId && message.message) {
                const { success, status } = await sendToClient(message.clientId, message.message, adminClient.sessionId);
                if (status === 'saved_offline') {
                    adminClient.ws.send(JSON.stringify({
                        type: 'info',
                        message: 'Client is offline. Message saved for delivery.'
                    }));
                }
            }
            break;
       
        case 'get_clients':
            const clientList = Array.from(clients.values())
                .filter(c => !c.isAdmin)
                .map(c => ({
                    id: c.id,
                    name: c.name,
                    email: c.email,
                    isOnline: c.ws.readyState === WebSocket.OPEN,
                    lastActive: c.lastActive
                }));
            
            try {
                adminClient.ws.send(JSON.stringify({
                    type: 'clients',
                    clients: clientList
                }));
            } catch (error) {
                console.error('Error sending client list:', error);
            }
            break;

        case 'broadcast':
            if (message.message) {
                const broadcastCount = broadcastToClients(message.message, adminClient.sessionId);
                try {
                    adminClient.ws.send(JSON.stringify({
                        type: 'system',
                        message: `Broadcast sent to ${broadcastCount} clients`
                    }));
                } catch (error) {
                    console.error('Error sending broadcast confirmation:', error);
                }
            }
            break;
    }
}


wss.on('connection', async (ws, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const isAdminEndpoint = url.searchParams.get('endpoint') === 'admin';
    
    if (isAdminEndpoint) {
        return handleAdminConnection(ws, request);
    }
    
    const clientIp = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                     request.headers['x-real-ip'] || 
                     request.socket.remoteAddress || 
                     'unknown';
    
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
        console.log('WebSocket connection from blocked origin:', origin);
        ws.close(1008, 'Origin not allowed');
        return;
    }
    
    console.log('Client connected:', clientIp);
    
    let clientId;
    let hadProvidedClientId = false;
    try {
        const urlObj = new URL(request.url, `http://${request.headers.host}`);
        const providedClientId = urlObj.searchParams.get('clientId');
        if (providedClientId && /^client_[a-zA-Z0-9_-]{5,}$/.test(providedClientId)) {
            clientId = providedClientId;
            hadProvidedClientId = true;
        } else {
            clientId = 'client_' + Date.now() + Math.random().toString(36).substr(2, 9);
        }
    } catch (_) {
        clientId = 'client_' + Date.now() + Math.random().toString(36).substr(2, 9);
    }

    if (!hadProvidedClientId) {
        try {
            await db.read();
            const chats = (db.data && db.data.chats) ? db.data.chats : {};
            let bestId = null;
            let bestTime = 0;
            for (const [cid, chat] of Object.entries(chats)) {
                if (!chat || chat.deleted) continue;
                const ipMatch = chat.clientInfo && chat.clientInfo.ip === clientIp;
                if (!ipMatch) continue;
                const msgs = Array.isArray(chat.messages) ? chat.messages : [];
                const lastTs = msgs.length ? new Date(msgs[msgs.length - 1].timestamp).getTime() : 0;
                if (lastTs > bestTime && !clients.has(cid)) {
                    bestTime = lastTs;
                    bestId = cid;
                }
            }
            if (bestId) {
                clientId = bestId;
            }
        } catch (e) {
            console.error('Error attempting IP-based chat mapping:', e);
        }
    }
    
    const client = {
        ws,
        ip: clientIp,
        isAdmin: false,
        name: 'Guest',
        email: '',
        id: clientId,
        joined: new Date().toISOString(),
        sessionId: null,
        hasReceivedWelcome: false,
        lastActive: new Date().toISOString()
    };
    clients.set(clientId, client);
    
    ws.isAlive = true;
    ws.missedPings = 0;
    ws.connectionStart = Date.now();
    ws.clientId = clientId;
    
    connectionQuality.set(clientId, {
        latency: 0,
        connectedSince: ws.connectionStart,
        missedPings: 0
    });
    
    try {
        await db.read();
        db.data = db.data && typeof db.data === 'object' ? db.data : {};
        db.data.chats = db.data.chats || {};
        
        if (db.data.chats[clientId] && !db.data.chats[clientId].deleted) {
            const existingChatHistory = db.data.chats[clientId].messages || [];
            
            if (existingChatHistory.length > 0) {
                try {
                    ws.send(JSON.stringify({
                        type: 'history',
                        messages: existingChatHistory,
                        clientId: clientId
                    }));
                } catch (error) {
                    console.error('Error sending chat history:', error);
                }
            }
        }
    } catch (e) {
        console.error('Error loading chat history:', e);
    }
    
    notifyAdmin('client_connected', { clientId, ip: clientIp, name: 'Guest' });

    ws.on('message', async (data) => {
        try {
            if (!clients.has(clientId)) {
                console.error('Client not found in clients map:', clientId);
                return;
            }
            
            const client = clients.get(clientId);
            if (!client) {
                console.error('Client object is undefined for:', clientId);
                return;
            }
            
            let message;
            try {
                message = JSON.parse(data.toString());
            } catch (parseError) {
                console.error('Invalid JSON received from client:', clientIp);
                return;
            }
            
            if (!message || typeof message !== 'object' || !message.type) {
                console.log('Invalid message format from:', clientIp);
                return;
            }
            
            client.lastActivity = new Date().toISOString();
            
            switch (message.type) {
                case 'chat':
                    const messageText = message.message || message.text;
                    if (typeof messageText !== 'string' || messageText.trim().length === 0) {
                        return;
                    }
                    
                    const sanitizedText = validator.escape(messageText.trim()).substring(0, 500);
                    
                    const isDuplicate = chatHistory.some(msg => 
                        msg.clientId === clientId && 
                        msg.message === sanitizedText && 
                        (Date.now() - new Date(msg.timestamp).getTime()) < 1000
                    );
                    
                    if (isDuplicate) {
                        return;
                    }
                    
                    const chatMessage = {
                        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                        type: 'chat',
                        name: client.name,
                        message: sanitizedText,
                        timestamp: new Date().toISOString(),
                        isAdmin: false,
                        clientId: clientId,
                        sessionId: client.sessionId
                    };
                    
                    chatHistory.push(chatMessage);
                    await persistChatMessage(clientId, chatMessage);
                    
                    let adminOnline = false;
                    clients.forEach(c => {
                        if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                            adminOnline = true;
                        }
                    });
                    
                    if (!adminOnline) {
                        storeAdminOfflineMessage(clientId, chatMessage);
                    } else {
                        broadcastToAll(chatMessage);
                    }
                    
                    notifyAdmin('new_message', { clientId, name: client.name, message: sanitizedText.substring(0, 50) });
                    
                    if (!adminOnline) {
                        try {
                            await db.read();
                            const chatObj = db.data.chats[clientId];
                            if (chatObj && !chatObj.offlineAutoMessageSent) {
                                const autoMsg = {
                                    id: Date.now() + '-auto',
                                    type: 'system',
                                    message: 'Thank you for contacting AJK Cleaning! We have received your message and will get back to you shortly. For immediate assistance, please call us at +49-17661852286 or email Rajau691@gmail.com.',
                                    timestamp: new Date().toISOString(),
                                    clientId: clientId
                                };
                                try { ws.send(JSON.stringify(autoMsg)); } catch (e) { console.error('Error sending offline auto message:', e); }
                                
                                chatObj.messages.push({
                                    id: autoMsg.id,
                                    message: autoMsg.message,
                                    timestamp: autoMsg.timestamp,
                                    isAdmin: false,
                                    type: 'system'
                                });
                                chatObj.offlineAutoMessageSent = true;
                                await db.write();
                            }
                        } catch (e) {
                            console.error('Error processing offline auto message:', e);
                        }
                    }
                    break;
                    
                case 'typing':
                    if (typeof message.isTyping !== 'boolean') {
                        return;
                    }
                    
                    clients.forEach(c => {
                        if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                            try {
                                c.ws.send(JSON.stringify({
                                    type: 'typing',
                                    isTyping: message.isTyping,
                                    name: client.name,
                                    clientId: clientId
                                }));
                            } catch (error) {
                                console.error('Error sending typing indicator:', error);
                            }
                        }
                    });
                    break;
                    
                case 'identify':
                    if (message.isAdmin) {
                       return;
                    }

                    if (message.name && typeof message.name === 'string') {
                        client.name = validator.escape(message.name.substring(0, 50)) || 'Guest';
                    }
                    if (message.email && typeof message.email === 'string' && validator.isEmail(message.email)) {
                        client.email = message.email;
                    }
                    if (message.sessionId && typeof message.sessionId === 'string') {
                        client.sessionId = message.sessionId;
                    }

                    try {
                        await db.read();
                        db.data.chats = db.data.chats || {};
                        
                        if (!db.data.chats[clientId] || db.data.chats[clientId].deleted) {
                            db.data.chats[clientId] = {
                                clientInfo: {
                                    name: client.name || 'Guest',
                                    email: client.email || '',
                                    ip: client.ip,
                                    firstSeen: new Date().toISOString()
                                },
                                messages: [],
                                status: 'active'
                            };
                        } else {
                            db.data.chats[clientId].clientInfo.name = client.name || db.data.chats[clientId].clientInfo.name || 'Guest';
                            if (client.email) db.data.chats[clientId].clientInfo.email = client.email;
                            db.data.chats[clientId].clientInfo.lastSeen = new Date().toISOString();
                        }
                        await db.write();
                    } catch (e) {
                        console.error('Error upserting chat on identify:', e);
                    }
                    
                    notifyAdmin('client_identified', { clientId, name: client.name, email: client.email });
                    break;
                    
                case 'ping':
                    try {
                        ws.send(JSON.stringify({
                            type: 'pong',
                            timestamp: Date.now()
                        }));
                    } catch (error) {
                        console.error('Error sending pong:', error);
                    }
                    break;
                    
                default:
                    console.log('Unknown message type from:', clientIp, message.type);
            }
        } catch (error) {
            console.error('Error processing message from', clientIp, ':', error);
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Message processing failed'
                }));
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }
    });

    ws.on('close', (code, reason) => {
        if (!clients.has(clientId)) {
            return;
        }
        
        const client = clients.get(clientId);
        if (!client) {
            return;
        }
        
        console.log('Client disconnected:', clientIp, clientId, 'Code:', code, 'Reason:', reason.toString());
        
        clients.delete(clientId);
        connectionQuality.delete(clientId);
        
        notifyAdmin('client_disconnected', { 
            clientId, 
            name: client.name,
            reason: reason.toString() || 'No reason given',
            connectionDuration: Date.now() - ws.connectionStart
        });
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error for client', clientIp, ':', error);
        clients.delete(clientId);
        connectionQuality.delete(clientId);
    });
    
    ws.on('pong', () => {
        ws.isAlive = true;
        ws.missedPings = 0;
        
        if (ws.lastPingTime) {
            const latency = Date.now() - ws.lastPingTime;
            connectionQuality.set(clientId, {
                latency,
                connectedSince: ws.connectionStart,
                missedPings: ws.missedPings
            });
        }
    });
    
    const originalPing = ws.ping;
    ws.ping = function() {
        ws.lastPingTime = Date.now();
        originalPing.apply(ws, arguments);
    };
});

wss.on('error', (error) => {
    console.error('WebSocket Server Error:', error);
});

function cleanupAdminSessions() {
    const now = Date.now();
    const TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
    adminSessions.forEach((session, sessionId) => {
        const sessionAge = now - new Date(session.loginTime).getTime();
        if (sessionAge > TIMEOUT) {
            adminSessions.delete(sessionId);
            console.log(`Cleaned up stale admin session: ${sessionId}`);
        }
    });
}

const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Terminating dead connection:', ws.clientId || 'unknown');
            
            if (ws.clientId) {
                const client = clients.get(ws.clientId);
                if (client) {
                    if (client.isAdmin && client.sessionId) {
                        adminSessions.delete(client.sessionId);
                    }
                    clients.delete(ws.clientId);
                    connectionQuality.delete(ws.clientId);
                    
                    if (client.isAdmin) {
                        notifyAdmin('admin_disconnected', { name: client.name, reason: 'timeout' });
                    } else {
                        notifyAdmin('client_disconnected', { clientId: ws.clientId, reason: 'timeout' });
                    }
                }
            }
            
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.missedPings = (ws.missedPings || 0) + 1;

        if (ws.missedPings > 3) {
            console.log('Too many missed pings, terminating:', ws.clientId);
            return ws.terminate();
        }
        
        try {
            ws.ping();
        } catch (error) {
            console.error('Error pinging client:', error);
            ws.terminate();
        }
    });
}, 30000);


const adminSessionCleanupInterval = setInterval(cleanupAdminSessions, 60 * 60 * 1000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(adminSessionCleanupInterval);
});

setTimeout(cleanupGhostChats, 5000);
setInterval(cleanupGhostChats, 60 * 60 * 1000);
// ==================== END WEBSOCKET CHAT SERVER ====================

// ==================== VALIDATION MIDDLEWARE ====================
const validateFormSubmission = (req, res, next) => {
  const { name, email, phone, service, message } = req.body;
 
  if (!name || !email || !message) {
    return res.status(400).json({ success: false, error: 'Name, email, and message are required' });
  }
 
  if (!validator.isEmail(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email format' });
  }
 
  if (name.trim().length < 2 || name.trim().length > 100) {
    return res.status(400).json({ success: false, error: 'Name must be between 2 and 100 characters' });
  }
 
  if (message.trim().length < 10 || message.trim().length > 1000) {
    return res.status(400).json({ success: false, error: 'Message must be between 10 and 1000 characters' });
  }
 
  if (phone && !validator.isMobilePhone(phone, 'any')) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
  }
 
  next();
};
// ==================== END VALIDATION MIDDLEWARE ====================

app.use((req, res, next) => {
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const host = req.get('host');
    
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; " +
        "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
        "img-src 'self' data: https: blob:; " +
        "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; " +
        `connect-src 'self' ${protocol}://${host} https://generativelanguage.googleapis.com; ` + 
        "frame-src 'self';"
    );
    next();
});

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new MemoryStore({
        checkPeriod: 86400000
    }),
    cookie: { 
        secure: isProduction,
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// ==================== RATE LIMITING ====================
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  skip: (req) => {
    return req.path.startsWith('/api/admin') && req.session.authenticated;
  }
});

app.use('/api/', apiLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
  skip: (req) => {
    return req.session.authenticated;
  }
});

app.use('/api/admin/login', loginLimiter);
// ==================== END RATE LIMITING ====================

async function initializeDB() {
    try {
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        await db.read();
        
        if (!db.data || typeof db.data !== 'object') {
            db.data = { submissions: [], admin_users: [], offline_messages: {}, chats: {} };
        }
        
        db.data.submissions = db.data.submissions || [];
        db.data.admin_users = db.data.admin_users || [];
        db.data.chats = db.data.chats || {};
        
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!adminPassword) {
            console.error('CRITICAL: ADMIN_PASSWORD is not set in the environment variables.');
            process.exit(1);
        }
        
        const adminUser = db.data.admin_users.find(user => user.username === adminUsername);
        if (!adminUser) {
            const hash = await bcrypt.hash(adminPassword, 12);
            db.data.admin_users.push({
                id: Date.now(),
                username: adminUsername,
                password_hash: hash,
                created_at: new Date().toISOString()
            });
            await db.write();
            console.log('Admin user created successfully');
        }
        
        try { await db.write(); } catch (_) {}

        console.log('Database ready at:', dbPath);
        
    } catch (error) {
        console.error('Database initialization error:', error);
        try {
            db.data = { submissions: [], admin_users: [], offline_messages: {}, chats: {} };
            
            const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
            db.data.admin_users.push({
                id: Date.now(),
                username: process.env.ADMIN_USERNAME || 'admin',
                password_hash: hash,
                created_at: new Date().toISOString()
            });
            
            await db.write();
            console.log('Fresh database created successfully');
        } catch (writeError) {
            console.error('Failed to create fresh database:', writeError);
            throw writeError;
        }
    }
}

app.set('db', db);

function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
}

app.post('/api/form/submit', validateFormSubmission, async (req, res) => {
    try {
        const { name, email, phone, service, message } = req.body;
        
        const sanitizedData = {
            name: validator.escape(name.trim()).substring(0, 100),
            email: validator.normalizeEmail(email) || email,
            phone: phone ? validator.escape(phone.trim()).substring(0, 20) : '',
            service: service ? validator.escape(service.trim()).substring(0, 50) : '',
            message: validator.escape(message.trim()).substring(0, 1000)
        };
        
        await db.read();
        const submission = {
            id: Date.now(),
            ...sanitizedData,
            submitted_at: new Date().toISOString(),
            ip: req.ip || req.connection.remoteAddress || 'unknown',
            status: 'new' 
        };
        
        db.data.submissions.push(submission);
        await db.write();
        
        try {
            await sendEmailNotification(sanitizedData);
        } catch (emailError) {
            console.error('Email notification failed:', emailError);
        }
        
        notifyAdmin('new_submission', {
            id: submission.id,
            name: sanitizedData.name,
            email: sanitizedData.email,
            service: sanitizedData.service
        });
        
        console.log('Form submission received:', { id: submission.id, email: sanitizedData.email });
        
        res.json({ success: true, id: submission.id, message: 'Thank you! Your message has been sent successfully.' });
    } catch (error) {
        console.error('Form submission error:', error);
        res.status(500).json({ success: false, error: 'Internal server error. Please try again or contact us directly.' });
    }
});

async function sendEmailNotification(formData) {
    console.log('--- Sending Email Notification (Simulation) ---');
    console.log('To: admin@ajkcleaning.com');
    console.log('From: no-reply@ajkcleaning.com');
    console.log('Subject: New Contact Form Submission');
    console.log(`Body:\nName: ${formData.name}\nEmail: ${formData.email}\nPhone: ${formData.phone}\nService: ${formData.service}\nMessage: ${formData.message}`);
    console.log('---------------------------------------------');
}


// Protected API endpoints
app.get('/api/submissions', requireAuth, async (req, res) => {
    try {
        await db.read();
        res.json([...db.data.submissions].reverse());
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/submissions/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    
    if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Invalid submission ID' });
    }
    
    try {
        await db.read();
        const submission = db.data.submissions.find(s => s.id === id);
        
        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        res.json(submission);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/submissions/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    
    if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Invalid submission ID' });
    }
    
    try {
        await db.read();
        const initialLength = db.data.submissions.length;
        db.data.submissions = db.data.submissions.filter(s => s.id !== id);
        
        if (db.data.submissions.length === initialLength) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        
        await db.write();
        res.json({ success: true, message: 'Submission deleted successfully' });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/statistics', requireAuth, async (req, res) => {
    try {
        await db.read();
        const submissions = db.data.submissions;
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        const todaySubmissions = submissions.filter(s => 
            new Date(s.submitted_at) >= today
        );
        
        const weekSubmissions = submissions.filter(s => 
            new Date(s.submitted_at) >= weekAgo
        );
        
        const monthSubmissions = submissions.filter(s => 
            new Date(s.submitted_at) >= monthAgo
        );
        
        res.json({
            total: submissions.length,
            today: todaySubmissions.length,
            week: weekSubmissions.length,
            month: monthSubmissions.length
        });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/chat/stats', requireAuth, (req, res) => {
    const connectedClients = Array.from(clients.values());
    const adminClients = connectedClients.filter(client => client.isAdmin);
    const userClients = connectedClients.filter(client => !client.isAdmin);
    
    res.json({
        connectedClients: clients.size,
        activeChats: userClients.length,
        totalMessages: chatHistory.length,
        adminOnline: adminClients.length,
        admins: adminClients.map(a => ({ name: a.name, joined: a.joined })),
        users: userClients.map(u => ({ 
            id: u.id, 
            name: u.name, 
            email: u.email, 
            joined: u.joined, 
            ip: u.ip 
        }))
    });
});

app.post('/api/chat/send', requireAuth, async (req, res) => {
    const { clientId, message } = req.body;
    
    if (!clientId || !message) {
        return res.status(400).json({ success: false, error: 'Client ID and message are required' });
    }

    const { success, status } = await sendToClient(clientId, message);
    if (status === 'delivered') {
        return res.json({ success: true, message: 'Message sent successfully' });
    } else {
        return res.json({ success: true, message: 'Client offline. Message saved.' });
    }
});

app.post('/api/chat/broadcast', requireAuth, (req, res) => {
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ success: false, error: 'Message is required' });
    }
    
    const count = broadcastToClients(message);
    res.json({ success: true, message: `Message broadcast to ${count} clients` });
});

app.get('/api/chat/history/:clientId', requireAuth, async (req, res) => {
    const { clientId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    try {
        await db.read();
        const chats = (db.data && db.data.chats) ? db.data.chats : {};
        const chat = chats[clientId];
        const messages = (chat && !chat.deleted && Array.isArray(chat.messages)) ? chat.messages : [];
        
        const start = Math.max(0, messages.length - limit);
        return res.json(messages.slice(start));
    } catch (e) {
        console.error('Error reading chat history from DB:', e);
        return res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/chat/history', requireAuth, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const filteredHistory = chatHistory.slice(-limit);
    res.json(filteredHistory);
});

app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    await db.read();
    const chats = (db.data && db.data.chats) ? db.data.chats : {};
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/chats/:clientId', requireAuth, async (req, res) => {
    const clientId = req.params.clientId;
    
    try {
        await db.read();
        db.data = db.data && typeof db.data === 'object' ? db.data : {};
        db.data.chats = db.data.chats || {};
        
        if (db.data.chats[clientId]) {
            delete db.data.chats[clientId];
            
            if (db.data.offline_messages && db.data.offline_messages[clientId]) {
                delete db.data.offline_messages[clientId];
            }
            
            await db.write();

            const liveClient = clients.get(clientId);
            if (liveClient && liveClient.ws && liveClient.ws.readyState === WebSocket.OPEN) {
                try {
                    liveClient.ws.send(JSON.stringify({
                        type: 'chat_reset',
                        message: 'Chat session has been reset by admin. You are now connected to AI assistant.',
                        timestamp: new Date().toISOString(),
                        resetToAI: true
                    }));
                    
                    setTimeout(() => {
                        try {
                            liveClient.ws.close(1000, 'Chat reset by admin');
                        } catch (e) {
                            console.error('Error during delayed closing of client connection:', e);
                        }
                    }, 500);
                } catch (e) {
                    console.error('Error notifying client of chat reset:', e);
                }
            }
            
            for (let i = chatHistory.length - 1; i >= 0; i--) {
                if (chatHistory[i].clientId === clientId) {
                    chatHistory.splice(i, 1);
                }
            }
            
            clients.delete(clientId);

            res.json({ success: true, message: 'Chat completely deleted and client notified if online.' });
        } else {
            res.status(404).json({ error: 'Chat not found' });
        }
    } catch (err) {
        console.error('Chat deletion error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});


app.post('/api/chats/:clientId/status', requireAuth, async (req, res) => {
    const { clientId } = req.params;
    const { status } = req.body;

    if (!['active', 'resolved'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        await db.read();
        if (db.data.chats[clientId]) {
            db.data.chats[clientId].status = status;
            await db.write();
            res.json({ success: true, message: `Chat status updated to ${status}` });
        } else {
            res.status(404).json({ error: 'Chat not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/chats/resolve/:clientId', requireAuth, async (req, res) => {
    const clientId = req.params.clientId;

    try {
        await db.read();
        db.data = db.data && typeof db.data === 'object' ? db.data : {};
        db.data.chats = db.data.chats || {};
        if (db.data.chats[clientId]) {
            db.data.chats[clientId].status = 'resolved';
            await db.write();
            res.json({ success: true, message: 'Chat resolved successfully' });
        } else {
            res.status(404).json({ error: 'Chat not found' });
        }
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/chats/:clientId', requireAuth, async (req, res) => {
  const clientId = req.params.clientId;
 
  try {
    await db.read();
    db.data = db.data && typeof db.data === 'object' ? db.data : {};
    db.data.chats = db.data.chats || {};
    if (db.data.chats[clientId] && !db.data.chats[clientId].deleted) {
      res.json(db.data.chats[clientId]);
    } else {
      res.status(404).json({ error: 'Chat not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: NODE_ENV,
        database: db ? 'Connected' : 'Disconnected',
        websocket: {
            clients: clients.size,
            messages: chatHistory.length
        }
    });
});

app.post('/api/admin/login', async (req, res) => {
    const { username, password, sessionId, deviceType } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    
    try {
        await db.read();
        const user = db.data.admin_users.find(u => u.username === username);
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const isValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        req.session.authenticated = true;
        req.session.user = { id: user.id, username: user.username };
        
        if (sessionId) {
            adminSessions.set(sessionId, {
                id: sessionId,
                username: username,
                loginTime: new Date().toISOString(),
                deviceType: deviceType || 'unknown',
                ip: req.ip,
                authenticated: true
            });
        }
        
        res.json({ success: true, message: 'Login successful' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    const { sessionId } = req.body;
    
    if (sessionId) {
        adminSessions.delete(sessionId);
    }
    
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logout successful' });
    });
});

app.get('/api/admin/status', (req, res) => {
    res.json({ authenticated: !!req.session.authenticated });
});

app.use(express.static(path.join(__dirname), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
        else if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
        else if (filePath.endsWith('.ico')) res.setHeader('Content-Type', 'image/x-icon');
        else if (filePath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
        else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) res.setHeader('Content-Type', 'image/jpeg');
        else if (filePath.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
    }
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get(['/admin', '/admin/login'], (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    
    if (isProduction) {
        res.status(500).json({ error: 'Internal server error' });
    } else {
        res.status(500).json({ 
            error: 'Internal server error',
            details: err.message,
            stack: err.stack 
        });
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (isProduction) {
        process.exit(1);
    }
});

function gracefulShutdown(signal) {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    
    server.close(() => {
        console.log('HTTP server closed');
        
        wss.close(() => {
            console.log('WebSocket server closed');
            console.log('Cleanup completed');
            process.exit(0);
        });
    });
    
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

initializeDB().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`=== SERVER STARTING on ${new Date().toLocaleString()} ===`);
        console.log(`Environment: ${NODE_ENV}`);
        console.log(`Server running on port ${PORT}`);
        console.log(`Database path: ${dbPath}`);
        console.log(`WebSocket chat server: READY`);
        console.log(`=== SERVER READY ===`);
    });
}).catch(err => {
    console.error('Failed to initialize and start server:', err);
    process.exit(1);
});