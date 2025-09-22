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

const FileStore = require('session-file-store')(session);
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Trust proxy (CRITICAL for secure cookies)
app.set('trust proxy', 1);

// Use environment secret or generate one
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');

// Environment-specific settings
const isProduction = NODE_ENV === 'production';

// Database setup with lowdb
const DEFAULT_DB_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
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

// ==================== WEBSOCKET CHAT SERVER ====================
const clients = new Map();
const adminSessions = new Map(); // Track admin sessions
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

// Function to store offline messages
function storeOfflineMessage(clientId, message) {
  // Create or update the offline messages storage
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
  
  // Save to database
  db.write().catch(err => console.error('Error saving offline message:', err));
}

// Function to deliver offline messages when admin connects
function deliverOfflineMessages() {
  if (!db.data.offline_messages) return;
  
  Object.keys(db.data.offline_messages).forEach(clientId => {
    const messages = db.data.offline_messages[clientId];
    messages.forEach(msg => {
      // Add to chat history
      chatHistory.push(msg.message);
      
      // Broadcast to all admins
      broadcastToAll(msg.message);
    });
    
    // Clear delivered messages
    delete db.data.offline_messages[clientId];
  });
  
  // Save changes to database
  db.write().catch(err => console.error('Error clearing offline messages:', err));
}

// FIXED: Modified broadcastToAll to prevent duplicate messages
function broadcastToAll(message, sourceSessionId = null, excludeClientId = null) {
    clients.forEach(c => {
        // Skip excluded client (sender)
        if (excludeClientId && c.id === excludeClientId) {
            return;
        }
        
        // For admin messages, send to the target client and all admins
        if (message.isAdmin) {
            // Send to the target client
            if (c.id === message.clientId && c.ws.readyState === WebSocket.OPEN) {
                try {
                    c.ws.send(JSON.stringify(message));
                } catch (error) {
                    console.error('Error sending message to client:', error);
                }
            }
            
            // Send to all admins (excluding sender if specified)
            if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                try {
                    c.ws.send(JSON.stringify(message));
                } catch (error) {
                    console.error('Error sending message to admin:', error);
                }
            }
        } 
        // For client messages, send to all admins
        else {
            if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                try {
                    c.ws.send(JSON.stringify(message));
                } catch (error) {
                    console.error('Error sending message to admin:', error);
                }
            }
        }
    });
}

// FIXED: Modified notifyAdmin to send to all admins
function notifyAdmin(type, payload, targetSessionId = null) {
    clients.forEach(client => {
        if (client.isAdmin && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify({
                    type: type,
                    payload: payload,
                    timestamp: new Date().toISOString()
                }));
            } catch (error) {
                console.error('Error notifying admin:', error);
            }
        }
    });
}

// Modify sendToClient to include session information
function sendToClient(clientId, messageText, sourceSessionId = null) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        const adminMessage = {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            type: 'chat',
            message: messageText,
            name: 'Support',
            timestamp: new Date().toISOString(),
            isAdmin: true,
            clientId: clientId,
            sessionId: sourceSessionId // Include session ID
        };
        
        chatHistory.push(adminMessage);
        
        try {
            client.ws.send(JSON.stringify(adminMessage));
            // Persist even when client is online to keep full history
            persistChatMessage(clientId, adminMessage);
            return true;
        } catch (error) {
            console.error('Error sending message to client:', error);
            return false;
        }
    }
    return false;
}

// Modify broadcastToClients to respect sessions
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

// Create WebSocket server
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

// Allowed origins for WebSocket connections
const allowedOrigins = [
    'https://ajk-cleaning.onrender.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001'
];

wss.on('connection', async (ws, request) => {
    const clientIp = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                     request.headers['x-real-ip'] || 
                     request.socket.remoteAddress || 
                     'unknown';
    
    // Check origin for WebSocket connections
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
        console.log('WebSocket connection from blocked origin:', origin);
        ws.close(1008, 'Origin not allowed');
        return;
    }
    
    console.log('Client connected:', clientIp);
    
    // Adopt stable clientId from query param if provided by client
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

    // Fallback mapping: if no clientId provided, try to reuse the latest chat for this IP
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
                if (lastTs > bestTime && !clients.has(cid)) { // don't hijack an active session
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
        lastActive: new Date().toISOString() // Initialize lastActive
    };
    clients.set(clientId, client);
    
    ws.missedPings = 0;
    ws.connectionStart = Date.now();
    ws.clientId = clientId;
    
    connectionQuality.set(clientId, {
        latency: 0,
        connectedSince: ws.connectionStart,
        missedPings: 0
    });
    
    // Check if chat was deleted and create new session if needed
    await db.read();
    db.data = db.data && typeof db.data === 'object' ? db.data : {};
    db.data.chats = db.data.chats || {};
    db.data.offline_messages = db.data.offline_messages || {};
    db.data.pending_client_messages = db.data.pending_client_messages || {};
    if (db.data.chats[clientId] && db.data.chats[clientId].deleted) {
        // Create a new chat session
        db.data.chats[clientId] = {
            clientInfo: {
                name: client.name,
                email: client.email,
                ip: clientIp,
                firstSeen: new Date().toISOString()
            },
            messages: [],
            previousChat: db.data.chats[clientId].clientId // Reference to old chat
        };
        await db.write();
    }

    // DEFERRED: Chat object creation is now deferred until the first message or identification to avoid creating empty chats for non-interactive visitors.
    
    // Load chat history if it exists
    if (db.data.chats[clientId] && !db.data.chats[clientId].deleted) {
        const chatHistory = db.data.chats[clientId].messages || [];
        
        // Send history to client
        if (chatHistory.length > 0) {
            try {
                ws.send(JSON.stringify({
                    type: 'history',
                    messages: chatHistory,
                    clientId: clientId
                }));
            } catch (error) {
                console.error('Error sending chat history:', error);
            }
        }
    }
    
    try {
        ws.send(JSON.stringify({
            type: 'client_id',
            clientId: clientId
        }));
        
        // Deliver any pending admin messages queued while client was offline
        try {
            await db.read();
            db.data = db.data && typeof db.data === 'object' ? db.data : {};
            db.data.pending_client_messages = db.data.pending_client_messages || {};
            db.data.chats = db.data.chats || {};
            if (!db.data.chats[clientId]) {
                db.data.chats[clientId] = { clientInfo: { name: 'Guest', email: '', ip: clientIp, firstSeen: new Date().toISOString() }, messages: [] };
            }
            const pending = db.data.pending_client_messages[clientId] || [];
            if (pending.length > 0) {
                for (const pm of pending) {
                    // Send to client
                    try { ws.send(JSON.stringify(pm)); } catch (e) { console.error('Error delivering pending message:', e); }
                    // Append to persistent history now that it is delivered (avoid duplicates)
                    const exists = (db.data.chats[clientId].messages || []).some(m => m.id === pm.id);
                    if (!exists) {
                        db.data.chats[clientId].messages.push({
                            id: pm.id,
                            message: pm.message,
                            timestamp: pm.timestamp,
                            isAdmin: true,
                            type: 'chat'
                        });
                    }
                }
                // Clear queue
                db.data.pending_client_messages[clientId] = [];
                await db.write();
            }
        } catch (e) {
            console.error('Error delivering pending client messages:', e);
        }
    } catch (error) {
        console.error('Error sending initial messages:', error);
    }
    
    notifyAdmin(`New client connected: ${clientIp} (${clientId})`);
    
    ws.on('message', async (data) => {
        try {
            // Add client identification safety check at the beginning
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
            
            // Update last active time on any message
            client.lastActive = new Date().toISOString();
            
            switch (message.type) {
                case 'chat':
                    // Handle both message and text fields
                    const messageText = message.message || message.text;
                    if (typeof messageText !== 'string' || messageText.trim().length === 0) {
                        console.log('Invalid chat message from:', clientIp);
                        return;
                    }
                    
                    const sanitizedText = validator.escape(messageText.trim()).substring(0, 500);
                    
                    // Check if this is a duplicate message (based on timestamp and content)
                    const isDuplicate = chatHistory.some(msg => 
                        msg.clientId === clientId && 
                        msg.message === sanitizedText && 
                        (Date.now() - new Date(msg.timestamp).getTime()) < 1000
                    );
                    
                    if (isDuplicate) {
                        console.log('Duplicate message detected, ignoring:', clientIp);
                        return;
                    }
                    
                    const chatMessage = {
                        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                        type: 'chat',
                        name: client.name,
                        message: sanitizedText,
                        timestamp: new Date().toISOString(),
                        isAdmin: client.isAdmin,
                        clientId: clientId,
                        sessionId: client.sessionId
                    };
                    
                    chatHistory.push(chatMessage);
                    
                    // Store message in database
                    await db.read();
                    db.data = db.data && typeof db.data === 'object' ? db.data : {};
                    db.data.chats = db.data.chats || {};
                    if (db.data.chats[clientId] && db.data.chats[clientId].deleted) {
                        db.data.chats[clientId] = {
                            clientInfo: {
                                name: client.name,
                                email: client.email,
                                ip: clientIp,
                                firstSeen: new Date().toISOString()
                            },
                            messages: []
                        };
                    }
                    if (!db.data.chats[clientId]) {
                        db.data.chats[clientId] = {
                            clientInfo: {
                                name: client.name,
                                email: client.email,
                                ip: clientIp,
                                firstSeen: new Date().toISOString()
                            },
                            messages: []
                        };
                    }
                    
                    db.data.chats[clientId].messages.push({
                        id: chatMessage.id,
                        message: sanitizedText,
                        timestamp: new Date().toISOString(),
                        isAdmin: client.isAdmin,
                        type: 'chat'
                    });
                    
                    await db.write();
                    
                    // Check if any admin is online
                    let adminOnline = false;
                    clients.forEach(c => {
                        if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                            adminOnline = true;
                        }
                    });
                    
                    if (!adminOnline && !client.isAdmin) {
                        // Store message for later delivery
                        storeOfflineMessage(clientId, chatMessage);
                    } else {
                        // Broadcast to admins as usual
                        if (client.isAdmin) {
                            // For admin messages, exclude the sender to prevent duplicates
                            broadcastToAll(chatMessage, null, clientId);
                        } else {
                            // For client messages, broadcast normally
                            broadcastToAll(chatMessage);
                        }
                    }
                    
                    if (!client.isAdmin) {
                        notifyAdmin(`New message from ${client.name}: ${sanitizedText.substring(0, 50)}${sanitizedText.length > 50 ? '...' : ''}`);
                    }
                    
                    // Send automated offline message only once per chat when no admin is online
                    if (!client.isAdmin && !adminOnline) {
                        try {
                            await db.read();
                            db.data = db.data && typeof db.data === 'object' ? db.data : {};
                            db.data.chats = db.data.chats || {};
                            const chatObj = db.data.chats[clientId];
                            if (chatObj && !chatObj.offlineAutoMessageSent) {
                                const autoMsg = {
                                    id: Date.now() + '-auto',
                                    type: 'system',
                                    message: 'Thank you for contacting AJK Cleaning! We have received your message and will get back to you shortly. For immediate assistance, please call us at +49-17661852286 or email Rajau691@gmail.com.',
                                    timestamp: new Date().toISOString(),
                                    clientId: clientId
                                };
                                // Send to client
                                try { ws.send(JSON.stringify(autoMsg)); } catch (e) { console.error('Error sending offline auto message:', e); }
                                // Persist in DB and mark flag
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
                    if (message.name && typeof message.name === 'string') {
                        client.name = validator.escape(message.name.substring(0, 50)) || 'Guest';
                    }
                    if (message.email && typeof message.email === 'string' && validator.isEmail(message.email)) {
                        client.email = message.email;
                    }
                    if (message.sessionId && typeof message.sessionId === 'string') {
                        client.sessionId = message.sessionId;
                    }
                    
                    // Handle admin identification
                    if (message.isAdmin) {
                        // Validate admin session
                        if (!adminSessions.has(message.sessionId)) {
                            console.log('Invalid admin session attempt:', message.sessionId);
                            // Don't close the connection, just don't mark as admin
                            try {
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    message: 'Invalid admin session. Please log in again.'
                                }));
                            } catch (error) {
                                console.error('Error sending error message:', error);
                            }
                        } else {
                            client.isAdmin = true;
                            adminSessions.set(message.sessionId, {
                                id: message.sessionId,
                                name: client.name,
                                connectedAt: new Date().toISOString(),
                                ip: clientIp
                            });
                            
                            // Send all chat history to admin when they connect
                            try {
                                await db.read();
                                db.data = db.data && typeof db.data === 'object' ? db.data : {};
                                db.data.chats = db.data.chats || {};
                                
                                // Send history for all chats to admin (include empty chats)
                                const allChats = {};
                                Object.keys(db.data.chats).forEach(cId => {
                                    const chat = db.data.chats[cId];
                                    if (chat && !chat.deleted) {
                                        allChats[cId] = {
                                            clientInfo: chat.clientInfo,
                                            messages: Array.isArray(chat.messages) ? chat.messages : []
                                        };
                                    }
                                });
                                
                                try {
                                    ws.send(JSON.stringify({
                                        type: 'admin_history',
                                        chats: allChats
                                    }));
                                } catch (_) {}

                                // Also push current online clients list
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
                                    ws.send(JSON.stringify({
                                        type: 'clients',
                                        clients: clientList
                                    }));
                                } catch (_) {}
                            } catch (e) {
                                console.error('Error sending admin history:', e);
                            }
                            
                            // Deliver any offline messages when admin connects
                            deliverOfflineMessages();
                            
                            // Notify about admin connection
                            notifyAdmin(`Admin ${client.name} connected`);
                        }
                    } else {
                        client.isAdmin = false;

                        // Ensure a persistent chat session (ticket) exists for this client upon identification
                        try {
                            await db.read();
                            db.data = db.data && typeof db.data === 'object' ? db.data : {};
                            db.data.chats = db.data.chats || {};
                            
                            // If chat doesn't exist or was deleted, create a new one. Otherwise, update it.
                            if (!db.data.chats[clientId] || db.data.chats[clientId].deleted) {
                                db.data.chats[clientId] = {
                                    clientInfo: {
                                        name: client.name || 'Guest',
                                        email: client.email || '',
                                        ip: client.ip,
                                        firstSeen: new Date().toISOString()
                                    },
                                    messages: []
                                };
                            } else {
                                db.data.chats[clientId].clientInfo = db.data.chats[clientId].clientInfo || {};
                                db.data.chats[clientId].clientInfo.name = client.name || db.data.chats[clientId].clientInfo.name || 'Guest';
                                if (client.email) db.data.chats[clientId].clientInfo.email = client.email;
                                db.data.chats[clientId].clientInfo.lastSeen = new Date().toISOString();
                            }

                            await db.write();
                        } catch (e) {
                            console.error('Error upserting chat on identify:', e);
                        }
                    }
                    
                    console.log('Client identified:', client.name, client.email, client.isAdmin ? '(Admin)' : '', 'Session:', client.sessionId);
                    
                    if (!client.isAdmin) {
                        notifyAdmin(`Client ${clientId} identified as: ${client.name} (${client.email || 'no email'})`);
                    }
                    break;
                    
                case 'get_history':
                    if (client.isAdmin && message.clientId) {
                        const targetClientId = message.clientId;
                        try {
                            await db.read();
                            db.data = db.data && typeof db.data === 'object' ? db.data : {};
                            db.data.chats = db.data.chats || {};
                            const clientChat = db.data.chats[targetClientId];
                            const persistedMessages = (clientChat && !clientChat.deleted) ? (clientChat.messages || []) : [];
                            ws.send(JSON.stringify({
                                type: 'history',
                                messages: persistedMessages,
                                clientId: targetClientId
                            }));
                        } catch (error) {
                            console.error('Error sending history from DB:', error);
                            try {
                                ws.send(JSON.stringify({ type: 'history', messages: [], clientId: targetClientId }));
                            } catch (_) {}
                        }
                    }
                    break;
                    
                case 'get_clients':
                    if (client.isAdmin) {
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
                            ws.send(JSON.stringify({
                                type: 'clients',
                                clients: clientList
                            }));
                        } catch (error) {
                            console.error('Error sending client list:', error);
                        }
                    }
                    break;
                    
                case 'admin_message':
                    if (client.isAdmin && message.targetClientId && message.message) {
                        const targetClient = clients.get(message.targetClientId);
                        const adminMessage = {
                            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                            type: 'chat',
                            message: message.message,
                            name: 'Support',
                            timestamp: new Date().toISOString(),
                            isAdmin: true,
                            clientId: message.targetClientId,
                            sessionId: client.sessionId
                        };

                        // If client online, send immediately
                        if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                            const isDup = chatHistory.some(msg => 
                                msg.clientId === adminMessage.clientId && 
                                msg.message === adminMessage.message && 
                                (Date.now() - new Date(msg.timestamp).getTime()) < 1000
                            );
                            if (!isDup) {
                                chatHistory.push(adminMessage);
                                broadcastToAll(adminMessage, null, client.id);
                                // Persist admin message even when client is online
                                try { await persistChatMessage(adminMessage.clientId, adminMessage); } catch (e) {}
                            }
                        } else {
                            // Client offline: persist and queue for delivery
                            try {
                                await db.read();
                                db.data = db.data && typeof db.data === 'object' ? db.data : {};
                                db.data.chats = db.data.chats || {};
                                db.data.pending_client_messages = db.data.pending_client_messages || {};
                                if (!db.data.chats[adminMessage.clientId]) {
                                    db.data.chats[adminMessage.clientId] = {
                                        clientInfo: { name: 'Guest', email: '', ip: 'unknown', firstSeen: new Date().toISOString() },
                                        messages: []
                                    };
                                }
                                // Queue for next delivery (do not add to history yet to avoid duplicates)
                                if (!db.data.pending_client_messages[adminMessage.clientId]) {
                                    db.data.pending_client_messages[adminMessage.clientId] = [];
                                }
                                // Mark as queued for admin UI context
                                adminMessage.queued = true;
                                db.data.pending_client_messages[adminMessage.clientId].push(adminMessage);
                                await db.write();
                                // Also persist in chat history immediately (avoid duplicates on delivery)
                                const chatObj = db.data.chats[adminMessage.clientId];
                                if (chatObj) {
                                    const exists = (chatObj.messages || []).some(m => m.id === adminMessage.id);
                                    if (!exists) {
                                        chatObj.messages.push({
                                            id: adminMessage.id,
                                            message: adminMessage.message,
                                            timestamp: adminMessage.timestamp,
                                            isAdmin: true,
                                            type: 'chat'
                                        });
                                        await db.write();
                                    }
                                }
                                // Echo to all admins so message appears in live chat UI
                                try { broadcastToAll(adminMessage); } catch (_) {}
                                // Acknowledge to sender
                                try {
                                    client.ws.send(JSON.stringify({ type: 'system', message: 'Client is offline. Message queued.' }));
                                } catch (_) {}
                            } catch (e) {
                                console.error('Error queuing admin offline message:', e);
                            }
                        }
                    }
                    break;
                    
                case 'broadcast':
                    if (client.isAdmin && message.message) {
                        const broadcastCount = broadcastToClients(message.message, client.sessionId);
                        try {
                            client.ws.send(JSON.stringify({
                                type: 'system',
                                message: `Broadcast sent to ${broadcastCount} clients`
                            }));
                        } catch (error) {
                            console.error('Error sending broadcast confirmation:', error);
                        }
                    }
                    break;
                    
                case 'ping':
                    // Handle ping messages for connection health
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
        }
    });
    
    ws.on('close', (code, reason) => {
        // Check if client exists before trying to access properties
        if (!clients.has(clientId)) {
            console.log('Client already removed during disconnect:', clientId);
            return;
        }
        
        const client = clients.get(clientId);
        if (!client) {
            console.log('Client object undefined during disconnect:', clientId);
            return;
        }
        
        console.log('Client disconnected:', clientIp, clientId, 'Code:', code, 'Reason:', reason);
        
        // Clean up admin sessions
        if (client.isAdmin && client.sessionId) {
            adminSessions.delete(client.sessionId);
            notifyAdmin(`Admin ${client.name} disconnected`);
        }
        
        clients.delete(clientId);
        connectionQuality.delete(clientId);
        if (!client.isAdmin) {
            notifyAdmin(`Client disconnected: ${client.name} (${clientId})`);
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error for client', clientIp, ':', error);
        
        // Clean up admin sessions
        if (client.isAdmin && client.sessionId) {
            adminSessions.delete(client.sessionId);
        }
        
        clients.delete(clientId);
        connectionQuality.delete(clientId);
    });
    
    ws.isAlive = true;
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
                        notifyAdmin(`Admin ${client.name} disconnected due to timeout`);
                    } else {
                        notifyAdmin(`Client disconnected due to timeout: ${ws.clientId}`);
                    }
                }
            }
            
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.missedPings = (ws.missedPings || 0) + 1;
        
        try {
            ws.ping();
        } catch (error) {
            console.error('Error pinging client:', error);
            ws.terminate();
        }
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

// ==================== END WEBSOCKET CHAT SERVER ====================

// ==================== ENHANCED VALIDATION MIDDLEWARE ====================
const validateFormSubmission = (req, res, next) => {
  const { name, email, phone, service, message } = req.body;
  
  // Check required fields
  if (!name || !email || !message) {
    return res.status(400).json({ success: false, error: 'Name, email, and message are required' });
  }
  
  // Validate email format
  if (!validator.isEmail(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email format' });
  }
  
  // Validate name length
  if (name.trim().length < 2 || name.trim().length > 100) {
    return res.status(400).json({ success: false, error: 'Name must be between 2 and 100 characters' });
  }
  
  // Validate message length
  if (message.trim().length < 10 || message.trim().length > 1000) {
    return res.status(400).json({ success: false, error: 'Message must be between 10 and 1000 characters' });
  }
  
  // Validate phone if provided
  if (phone && !validator.isMobilePhone(phone, 'any')) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
  }
  
  next();
};
// ==================== END ENHANCED VALIDATION MIDDLEWARE ====================

// CORS configuration
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
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

// CSP middleware
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
        `connect-src 'self' ${protocol}://${host}; ` +
        "frame-src 'self';"
    );
    next();
});

// Session configuration
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new FileStore({
        path: path.join(__dirname, 'sessions'),
        ttl: 86400, // 1 day in seconds
        logFn: function () {} // Disable logging
    }),
    cookie: { 
        secure: isProduction,
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// ==================== RATE LIMITING ====================
// General API rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  skip: (req) => {
    // Skip rate limiting for admin endpoints if user is authenticated
    return req.path.startsWith('/api/admin') && req.session.authenticated;
  }
});

// Apply to all API routes
app.use('/api/', apiLimiter);

// Stricter limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: 'Too many login attempts, please try again later.',
  skip: (req) => {
    // Skip if already authenticated
    return req.session.authenticated;
  }
});

// Apply to login endpoint
app.use('/api/admin/login', loginLimiter);
// ==================== END RATE LIMITING ====================

// Initialize database function
async function initializeDB() {
    try {
        // Ensure the directory exists
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log('Created database directory:', dbDir);
        }
        
        await db.read();
        
        // Initialize if database is empty or corrupted
        if (!db.data || typeof db.data !== 'object') {
            console.log('Initializing new database...');
            db.data = { submissions: [], admin_users: [], offline_messages: {}, chats: {} };
        }
        
        // Ensure arrays exist
        db.data.submissions = db.data.submissions || [];
        db.data.admin_users = db.data.admin_users || [];
        db.data.offline_messages = db.data.offline_messages || {};
        db.data.chats = db.data.chats || {};
        db.data.pending_client_messages = db.data.pending_client_messages || {};
        
        // Create admin user if it doesn't exist
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
            await db.write();
            console.log('Admin user created successfully');
        }
        
        // Persist ensured structure (safe no-op if unchanged)
        try { await db.write(); } catch (_) {}

        console.log('Database ready at:', dbPath);
        
    } catch (error) {
        console.error('Database initialization error:', error);
        // Try to create fresh database
        try {
            db.data = { submissions: [], admin_users: [], offline_messages: {}, chats: {} };
            
            const hash = await bcrypt.hash('Sugam@2008', 12);
            db.data.admin_users.push({
                id: Date.now(),
                username: 'Sanud119@gmail.com',
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

// After initializing the database, set it in the app context
app.set('db', db);

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
}

// Form submission endpoint
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
            ip: req.ip || req.connection.remoteAddress || 'unknown'
        };
        
        db.data.submissions.push(submission);
        await db.write();
        
        notifyAdmin('new_submission', {
            id: submission.id,
            name: sanitizedData.name,
            email: sanitizedData.email
        });
        
        console.log('Form submission received:', { id: submission.id, email: sanitizedData.email });
        
        res.json({ success: true, id: submission.id });
    } catch (error) {
        console.error('Form submission error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

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

app.get('/api/statistics', requireAuth, async (req, res) =>  {
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

    // Try to send immediately if client is online
    const sent = sendToClient(clientId, message);
    if (sent) {
        return res.json({ success: true, message: 'Message sent successfully' });
    }

    // Client is offline: queue for delivery and echo to admins
    try {
        await db.read();
        db.data = db.data && typeof db.data === 'object' ? db.data : {};
        db.data.chats = db.data.chats || {};
        db.data.pending_client_messages = db.data.pending_client_messages || {};
        if (!db.data.chats[clientId]) {
            db.data.chats[clientId] = {
                clientInfo: { name: 'Guest', email: '', ip: 'unknown', firstSeen: new Date().toISOString() },
                messages: []
            };
        }
        if (!db.data.pending_client_messages[clientId]) {
            db.data.pending_client_messages[clientId] = [];
        }
        const adminMessage = {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            type: 'chat',
            message: message,
            name: 'Support',
            timestamp: new Date().toISOString(),
            isAdmin: true,
            clientId: clientId,
            queued: true
        };
        db.data.pending_client_messages[clientId].push(adminMessage);
        await db.write();
        // Also persist in chat history immediately (avoid duplicates on delivery)
        const chatObj = db.data.chats[clientId];
        if (chatObj) {
            const exists = (chatObj.messages || []).some(m => m.id === adminMessage.id);
            if (!exists) {
                chatObj.messages.push({
                    id: adminMessage.id,
                    message: adminMessage.message,
                    timestamp: adminMessage.timestamp,
                    isAdmin: true,
                    type: 'chat'
                });
                await db.write();
            }
        }
        // Echo to all admins so it appears in live chat UI
        try { broadcastToAll(adminMessage); } catch (_) {}
        return res.json({ success: true, message: 'Client offline. Message queued.' });
    } catch (e) {
        console.error('Error queuing message via REST:', e);
        return res.status(500).json({ success: false, error: 'Failed to queue message' });
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
        // Return the last N messages (persisted order is chronological append)
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

// Get all chats
app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    await db.read();
    const chats = (db.data && db.data.chats) ? db.data.chats : {};
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete a chat
app.delete('/api/chats/:clientId', requireAuth, async (req, res) => {
  const clientId = req.params.clientId;
  
  try {
    await db.read();
    db.data = db.data && typeof db.data === 'object' ? db.data : {};
    db.data.chats = db.data.chats || {};
    if (db.data.chats[clientId]) {
      // Mark as deleted and cleanup related state
      db.data.chats[clientId].deleted = true;
      db.data.chats[clientId].deletedAt = new Date().toISOString();
      db.data.pending_client_messages = db.data.pending_client_messages || {};
      db.data.offline_messages = db.data.offline_messages || {};
      db.data.pending_client_messages[clientId] = [];
      db.data.offline_messages[clientId] = [];
      await db.write();

      // Purge in-memory history for this client
      for (let i = chatHistory.length - 1; i >= 0; i--) {
          if (chatHistory[i].clientId === clientId) {
              chatHistory.splice(i, 1);
          }
      }

      // Notify live client to reset chat UI
      const liveClient = clients.get(clientId);
      if (liveClient && liveClient.ws && liveClient.ws.readyState === WebSocket.OPEN) {
          try {
              liveClient.ws.send(JSON.stringify({ type: 'chat_reset' }));
          } catch (e) {
              console.error('Error notifying client of chat reset:', e);
          }
      }

      res.json({ success: true, message: 'Chat deleted successfully' });
    } else {
      res.status(404).json({ error: 'Chat not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Route to update chat status
app.post('/api/chats/:clientId/status', requireAuth, async (req, res) => {
    const { clientId } = req.params;
    const { status } = req.body;

    if (!['pending', 'resolved'].includes(status)) {
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

// Route to resolve a chat
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

// Get a specific chat
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

// Add debug endpoints
app.get('/api/chat/debug', requireAuth, (req, res) => {
    res.json({
        connectedClients: Array.from(clients.keys()),
        adminSessions: Array.from(adminSessions.keys()),
        totalMessages: chatHistory.length,
        databasePath: dbPath,
        serverTime: new Date().toISOString()
    });
});

app.get('/api/chat/debug/:clientId', requireAuth, (req, res) => {
    const clientId = req.params.clientId;
    const client = clients.get(clientId);
    
    if (!client) {
        return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json({
        clientInfo: {
            id: client.id,
            name: client.name,
            email: client.email,
            isAdmin: client.isAdmin,
            isConnected: client.ws.readyState === WebSocket.OPEN,
            ip: client.ip,
            joined: client.joined,
            lastActive: client.lastActive
        },
        connectionQuality: connectionQuality.get(clientId),
        messageCount: chatHistory.filter(m => m.clientId === clientId).length
    });
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

// Admin login endpoint
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
        
        // Store admin session for WebSocket validation
        if (sessionId) {
            adminSessions.set(sessionId, {
                id: sessionId,
                username: username,
                loginTime: new Date().toISOString(),
                deviceType: deviceType || 'unknown',
                ip: req.ip
            });
        }
        
        res.json({ success: true, message: 'Login successful' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin logout endpoint
app.post('/api/admin/logout', (req, res) => {
    const { sessionId } = req.body;
    
    // Remove from admin sessions
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

// Check authentication status
app.get('/api/admin/status', (req, res) => {
    res.json({ authenticated: !!req.session.authenticated });
});

// Serve static files
app.use(express.static(path.join(__dirname), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.ico')) {
            res.setHeader('Content-Type', 'image/x-icon');
        } else if (filePath.endsWith('.png')) {
            res.setHeader('Content-Type', 'image/png');
        } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
            res.setHeader('Content-Type', 'image/jpeg');
        } else if (filePath.endsWith('.svg')) {
            res.setHeader('Content-Type', 'image/svg+xml');
        }
    }
}));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin panel for both login and main admin interface
app.get(['/admin', '/admin/login'], (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve the enhanced chat client
app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// 404 handler for API routes
app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// Global error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    
    // Don't expose internal errors in production
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

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // In production, you might want to exit gracefully
    if (isProduction) {
        console.error('Uncaught Exception - Server will exit');
        process.exit(1);
    }
});

// Graceful shutdown
function gracefulShutdown(signal) {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    
    // Stop accepting new connections
    server.close(() => {
        console.log('HTTP server closed');
        
        // Close WebSocket server
        wss.close(() => {
            console.log('WebSocket server closed');
            
            // Close database connections if needed
            console.log('Cleanup completed');
            process.exit(0);
        });
    });
    
    // Force close after 30 seconds
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Initialize and start server
initializeDB().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`=== SERVER STARTING ===`);
        console.log(`Environment: ${NODE_ENV}`);
        console.log(`Server running on port ${PORT}`);
        console.log(`Database path: ${dbPath}`);
        console.log(`Trust proxy: ${app.get('trust proxy')}`);
        console.log(`Secure cookies: ${isProduction}`);
        console.log(`Rate limiting: ENABLED`);
        console.log(`Enhanced validation: ENABLED`);
        console.log(`WebSocket chat server: READY`);
        console.log(`Offline message support: ENABLED`);
        console.log(`Connection quality monitoring: ENABLED`);
        console.log(`Chat persistence: ENABLED`);
        console.log(`=== SERVER READY ===`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});