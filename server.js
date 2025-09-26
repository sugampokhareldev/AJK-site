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

// Use memory store for sessions to avoid file system issues
const MemoryStore = require('memorystore')(session);
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

// NEW: Function to send chat reset message to client
function sendChatReset(clientId) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        try {
            client.ws.send(JSON.stringify({
                type: 'chat_reset',
                message: 'Chat session has been reset by admin',
                timestamp: new Date().toISOString()
            }));
            return true;
        } catch (error) {
            console.error('Error sending chat reset message:', error);
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

// Add this function to clean up existing ghost chats
async function cleanupGhostChats() {
    try {
        await db.read();
        const chats = db.data.chats || {};
        let removedCount = 0;
       
        Object.keys(chats).forEach(clientId => {
            const chat = chats[clientId];
            // Remove chats that have no messages and are from "Guest"
            if (chat && 
                chat.clientInfo && 
                chat.clientInfo.name === 'Guest' && 
                (!chat.messages || chat.messages.length === 0) &&
                // Keep chats created in last 24 hours to avoid deleting new legitimate ones
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
    'https://ajkcleaners.de',
    'http://ajkcleaners.de',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001'
];

// ==================== NEW ADMIN WEB SOCKET HANDLERS ====================

// Add this function after your existing WebSocket setup
async function handleAdminConnection(ws, request) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
   
    if (!sessionId) {
        ws.close(1008, 'Session ID required');
        return;
    }
   
    // Verify admin session
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
   
    // Send confirmation
    ws.send(JSON.stringify({
        type: 'admin_identified',
        message: 'Admin connection established'
    }));

    // Deliver any offline messages when admin connects
    deliverOfflineMessages();

    // Notify other admins about the new connection
    notifyAdmin(`Admin connected`, { name: 'Admin', sessionId });
}

// Add admin message handler
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
                const success = sendToClient(message.clientId, message.message, adminClient.sessionId);
                if (success) {
                    console.log('Admin message sent to client:', message.clientId);
                } else {
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

// ==================== END NEW ADMIN WEB SOCKET HANDLERS ====================

// ==================== UPDATED WEB SOCKET CONNECTION HANDLER ====================

wss.on('connection', async (ws, request) => {
    // Check if this is an admin connection
    const url = new URL(request.url, `http://${request.headers.host}`);
    const isAdminEndpoint = url.searchParams.get('endpoint') === 'admin';
   
    if (isAdminEndpoint) {
        return handleAdminConnection(ws, request);
    }
   
    // Rest of your existing client connection code stays exactly the same
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
   
    // FIX 1: REMOVED automatic chat creation - chats will be created only on first message or identify
   
    // Load existing chat history if it exists (without creating new chat)
    try {
        await db.read();
        db.data = db.data && typeof db.data === 'object' ? db.data : {};
        db.data.chats = db.data.chats || {};
       
        if (db.data.chats[clientId] && !db.data.chats[clientId].deleted) {
            const existingChatHistory = db.data.chats[clientId].messages || [];
           
            // Send history to client
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
           
            // ==================== CONSOLIDATED CLIENT MESSAGE HANDLER ====================
            switch (message.type) {
                case 'chat':
                    const messageText = message.message || message.text;
                    if (typeof messageText !== 'string' || messageText.trim().length === 0) {
                        console.log('Invalid chat message from:', clientIp);
                        return;
                    }
                   
                    const sanitizedText = validator.escape(messageText.trim()).substring(0, 500);
                   
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
                        isAdmin: false, // Always false for client messages
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
                        storeOfflineMessage(clientId, chatMessage);
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
                    // This case should ONLY handle non-admin identifications now
                    if (message.isAdmin) {
                        console.warn(`Client ${clientId} attempted invalid admin identification.`);
                        try {
                           ws.send(JSON.stringify({ type: 'error', message: 'Invalid request.' }));
                        } catch(e) { console.error(e); }
                        return; // Stop processing
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

                    // Ensure a persistent chat session exists for this client upon identification
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
                    
                    console.log(`Client identified: ${client.name} (${client.email})`);
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
        }
    });

   
    ws.on('close', (code, reason) => {
        if (!clients.has(clientId)) {
            console.log('Client already removed during disconnect:', clientId);
            return;
        }
       
        const client = clients.get(clientId);
        if (!client) {
            console.log('Client object undefined during disconnect:', clientId);
            return;
        }
       
        console.log('Client disconnected:', clientIp, clientId, 'Code:', code, 'Reason:', reason.toString());
       
        clients.delete(clientId);
        connectionQuality.delete(clientId);
        notifyAdmin('client_disconnected', { clientId, name: client.name });
    });
   
    ws.on('error', (error) => {
        console.error('WebSocket error for client', clientIp, ':', error);
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

// Stale Admin Session Cleanup
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
       
        try {
            ws.ping();
        } catch (error) {
            console.error('Error pinging client:', error);
            ws.terminate();
        }
    });
}, 30000);

const adminSessionCleanupInterval = setInterval(cleanupAdminSessions, 60 * 60 * 1000); // Every hour

wss.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(adminSessionCleanupInterval);
});

// Run cleanup on server start and periodically
setTimeout(cleanupGhostChats, 5000); // Run 5 seconds after startup
setInterval(cleanupGhostChats, 60 * 60 * 1000); // Every hour

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

// FIX 3: Use memory store for sessions to avoid file system issues
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new MemoryStore({
        checkPeriod: 86400000 // prune expired entries every 24h
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
        db.data.chats = db.data.chats || {};
       
        // Create admin user if it doesn't exist from environment variables
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!adminPassword) {
            console.error('CRITICAL: ADMIN_PASSWORD is not set in the environment variables.');
            process.exit(1);
        }
        
        const adminUser = db.data.admin_users.find(user => user.username === adminUsername);
        if (!adminUser) {
            console.log('Creating admin user...');
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
       
        // Persist ensured structure (safe no-op if unchanged)
        try { await db.write(); } catch (_) {}

        console.log('Database ready at:', dbPath);
       
    } catch (error) {
        console.error('Database initialization error:', error);
        // Try to create fresh database
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

    // Try to send immediately if client is online
    const sent = sendToClient(clientId, message);
    if (sent) {
        return res.json({ success: true, message: 'Message sent successfully' });
    }

    // Client is offline: persist the message and echo to admins
    try {
        const adminMessage = {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            type: 'chat',
            message: message,
            name: 'Support',
            timestamp: new Date().toISOString(),
            isAdmin: true,
            clientId: clientId,
            queued: true // This can be used by admin UI to show it was sent to an offline user
        };

        await persistChatMessage(clientId, adminMessage);
       
        // Echo to all admins so it appears in live chat UI
        try { broadcastToAll(adminMessage); } catch (_) {}
       
        return res.json({ success: true, message: 'Client offline. Message saved.' });
    } catch (e) {
        console.error('Error saving offline message via REST:', e);
        return res.status(500).json({ success: false, error: 'Failed to save message' });
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

// Add this new API route (find where your other app.get routes are):
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

// FIX 1: Enhanced Chat Deletion with proper reset notification
app.delete('/api/chats/:clientId', requireAuth, async (req, res) => {
    const clientId = req.params.clientId;
   
    try {
        await db.read();
        db.data = db.data && typeof db.data === 'object' ? db.data : {};
        db.data.chats = db.data.chats || {};
       
        if (db.data.chats[clientId]) {
            // COMPLETELY remove the chat data
            delete db.data.chats[clientId];
           
            // Also clean up pending messages
            if (db.data.pending_client_messages && db.data.pending_client_messages[clientId]) {
                delete db.data.pending_client_messages[clientId];
            }
           
            await db.write();

            // Clean up in-memory data more aggressively
            for (let i = chatHistory.length - 1; i >= 0; i--) {
                if (chatHistory[i].clientId === clientId) {
                    chatHistory.splice(i, 1);
                }
            }

            // FIX 1: Send chat reset message before closing connection
            const liveClient = clients.get(clientId);
            if (liveClient && liveClient.ws) {
                try {
                    // Send reset message first
                    sendChatReset(clientId);
                   
                    // Wait a bit for message to be delivered, then close
                    setTimeout(() => {
                        try {
                            liveClient.ws.close(1000, 'Chat deleted by admin');
                        } catch (e) {
                            console.error('Error closing client connection:', e);
                        }
                        clients.delete(clientId);
                    }, 100);
                } catch (e) {
                    console.error('Error notifying client of chat reset:', e);
                    try {
                        liveClient.ws.close(1000, 'Chat deleted by admin');
                    } catch (closeError) {
                        console.error('Error closing client connection:', closeError);
                    }
                    clients.delete(clientId);
                }
            }

            res.json({ success: true, message: 'Chat completely deleted' });
        } else {
            res.status(404).json({ error: 'Chat not found' });
        }
    } catch (err) {
        console.error('Chat deletion error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Route to update chat status
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
       
        // FIX 2: Improved admin session storage
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
        console.log(`Ghost chat prevention: ENABLED`);
        console.log(`Ghost chat cleanup: ENABLED`);
        console.log(`=== SERVER READY ===`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});