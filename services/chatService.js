const WebSocket = require('ws');
const { db, enqueueDbWrite } = require('../config/database');
const validator = require('validator');

const clients = new Map();
const adminSessions = new Map(); // Track admin sessions
const chatHistory = []; // Capped in-memory history
const MAX_HISTORY_LENGTH = 1000; // Cap to prevent memory leak
const connectionQuality = new Map();

// Function to add a message to the capped in-memory history
function addMessageToHistory(message) {
    chatHistory.push(message);
    if (chatHistory.length > MAX_HISTORY_LENGTH) {
        // Remove the oldest message to cap the array size
        chatHistory.splice(0, chatHistory.length - MAX_HISTORY_LENGTH);
    }
}

// Persist a chat message to LowDB for a given clientId
async function persistChatMessage(clientId, message) {
  try {
    await db.read();
    db.data = db.data && typeof db.data === 'object' ? db.data : {};
    db.data.chats = db.data.chats || {};
    
    // Don't create chat sessions for admin users or temporary connections
    if (db.data.chats[clientId] && db.data.chats[clientId].isAdmin) {
        return;
    }
    
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
      await enqueueDbWrite(() => {}); // The write is handled by the queue
    }
  } catch (e) {
    console.error('Error persisting chat message:', e);
  }
}

// Function to store offline messages
function storeOfflineMessage(clientId, message) {
  // Don't store offline messages for admin users
  const client = clients.get(clientId);
  if (client && client.isAdmin) return;
  
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
  enqueueDbWrite(() => {}).catch(err => console.error('Error saving offline message:', err));
}

// Function to deliver offline messages when admin connects
function deliverOfflineMessages() {
  if (!db.data.offline_messages) return;
  
  Object.keys(db.data.offline_messages).forEach(clientId => {
    const messages = db.data.offline_messages[clientId];
    messages.forEach(msg => {
      // Add to chat history
      addMessageToHistory(msg.message);
      
      // Broadcast to all admins
      broadcastToAll(msg.message);
    });
    
    // Clear delivered messages
    delete db.data.offline_messages[clientId];
  });
  
  // Save changes to database
  enqueueDbWrite(() => {}).catch(err => console.error('Error clearing offline messages:', err));
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
        
        addMessageToHistory(adminMessage);
        
        try {
            client.ws.send(JSON.stringify(adminMessage));
            // Persist even when client is online to keep full history (but not for admin users)
            if (!client.isAdmin) {
                persistChatMessage(clientId, adminMessage);
            }
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
            
            addMessageToHistory(adminMessage);
            
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

async function promoteToPermanent(client, clientId, clientIp, ws) {
    // CRITICAL FIX: Never promote a connection that has been identified as an admin.
    if (client.isAdmin) {
        return clientId; // Return the existing ID without creating a session.
    }
    // Also prevent promotion of clients with reserved names.
    if (client.name === 'Admin' || client.name === 'Support') {
        console.log(`Blocking promotion for reserved name: ${client.name}`);
        return clientId;
    }

    console.log('Converting temporary connection to permanent for client:', clientIp, 'Name:', client.name);
    client.isTemporary = false;

    const newClientId = 'client_' + Date.now() + Math.random().toString(36).substr(2, 9);

    // Update client mapping
    clients.delete(clientId);
    client.id = newClientId;
    clients.set(newClientId, client);

    // Update WebSocket reference
    ws.clientId = newClientId;

    // Send the new client ID to the client
    try {
        ws.send(JSON.stringify({ type: 'client_id', clientId: newClientId }));
    } catch (error) {
        console.error('Error sending new client ID:', error);
    }

    notifyAdmin(`New chat session created: ${client.name} (${clientIp}) - ${newClientId}`);

    // Create the entry in the database ONLY if this is not an admin
    if (!client.isAdmin) {
        try {
            await db.read();
            db.data.chats = db.data.chats || {};
            if (!db.data.chats[newClientId]) {
                db.data.chats[newClientId] = {
                    clientInfo: {
                        name: client.name || 'Guest', 
                        email: client.email || '',
                        ip: client.ip,
                        firstSeen: new Date().toISOString(),
                        originalName: client.name // Store the original name
                    },
                    messages: [],
                    status: 'active'
                };
                await enqueueDbWrite(() => {});
            }
        } catch (e) {
            console.error('Error creating new chat session in DB on promotion:', e);
        }
    }

    return newClientId;
}

async function handleChatMessage(client, message, clientId, ws) {
    // If this is a temporary connection, promote to permanent FIRST
    if (client.isTemporary) {        
        // FIX: Update the in-memory client name from the message BEFORE promoting.
        // This ensures the database record is created with the correct name.
        if (typeof message.name !== 'string' || message.name.trim().length === 0) {
            console.log('Blocking promotion due to invalid name:', message.name);
            return clientId;
        }
        
        if (message.name && message.name !== 'Guest') {
            client.name = validator.escape(message.name.substring(0, 50)) || client.name;
        }
        clientId = await promoteToPermanent(client, clientId, client.ip, ws);
    }
    
    const messageText = message.message || message.text;
    if (typeof messageText !== 'string' || messageText.trim().length === 0) {
        console.log('Invalid chat message from:', client.ip);
        return;
    }

    const sanitizedText = validator.escape(messageText.trim()).substring(0, 500);

    // Update client name from message if provided and different
    if (message.name && message.name !== client.name && message.name !== 'Guest') {
        const newName = validator.escape(message.name.substring(0, 50)) || client.name;
        client.name = newName;
        
        // Update in database
        try {
            // This check is important: only update DB for non-temporary (already promoted) clients
            await db.read();
            if (db.data.chats[clientId]) {
                db.data.chats[clientId].clientInfo.name = client.name;
                await enqueueDbWrite(() => {});
                console.log('Updated client name in database from chat message:', client.name);
            }
        } catch (e) {
            console.error('Error updating client name from message:', e);
        }
    }

    const isDuplicate = chatHistory.some(msg =>
        msg.clientId === clientId &&
        msg.message === sanitizedText &&
        (Date.now() - new Date(msg.timestamp).getTime()) < 1000
    );

    if (isDuplicate) {
        console.log('Duplicate message detected, ignoring:', client.ip);
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

    addMessageToHistory(chatMessage);

    // Only persist if this is not an admin message and not a temporary connection
    if (!client.isAdmin && !client.isTemporary) {
        await persistChatMessage(clientId, chatMessage);
    }

    let adminOnline = Array.from(clients.values()).some(c => c.isAdmin && c.ws.readyState === WebSocket.OPEN);

    if (!adminOnline && !client.isAdmin) {
        storeOfflineMessage(clientId, chatMessage);
    } else {
        broadcastToAll(chatMessage, null, client.isAdmin ? clientId : null);
    }

    if (!client.isAdmin && !client.isTemporary) {
        notifyAdmin(`New message from ${client.name}: ${sanitizedText.substring(0, 50)}${sanitizedText.length > 50 ? '...' : ''}`);
    }

    // Send automated offline message only once per chat when no admin is online
    if (!client.isAdmin && !adminOnline && !client.isTemporary) {
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
                try { client.ws.send(JSON.stringify(autoMsg)); } catch (e) { console.error('Error sending offline auto message:', e); }
                
                chatObj.messages.push({ id: autoMsg.id, message: autoMsg.message, timestamp: autoMsg.timestamp, isAdmin: false, type: 'system' });
                chatObj.offlineAutoMessageSent = true;
                await enqueueDbWrite(() => {});
            }
        } catch (e) {
            console.error('Error processing offline auto message:', e);
        }
    }
}

async function handleResolveChat(message) {
    const { targetClientId } = message;
    try {
        await db.read();
        if (db.data.chats[targetClientId]) {
            db.data.chats[targetClientId].status = 'resolved';
            await enqueueDbWrite(() => {});

            notifyAdmin('chat_resolved', { clientId: targetClientId });

            const targetClient = clients.get(targetClientId);
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                targetClient.ws.send(JSON.stringify({
                    type: 'system',
                    message: 'A support agent has marked this chat as resolved. This chat is now closed.'
                }));
            }
        }
    } catch (err) {
        console.error(`Error resolving chat for ${targetClientId}:`, err);
    }
}

function setupWebSocket(wss) {
    wss.on('connection', (ws, req) => {
        // ... (connection logic)
    });
}

// Get chat statistics
function getChatStats() {
    const activeClients = Array.from(clients.values()).filter(c => !c.isAdmin && c.ws.readyState === 1).length;
    const activeAdmins = Array.from(clients.values()).filter(c => c.isAdmin && c.ws.readyState === 1).length;
    
    return {
        activeClients,
        activeAdmins,
        totalConnections: clients.size,
        messagesInHistory: chatHistory.length
    };
}

// Send message to specific client
async function sendMessage(clientId, messageText) {
    const success = sendToClient(clientId, messageText);
    return {
        success,
        message: success ? 'Message sent successfully' : 'Failed to send message - client not found or offline'
    };
}

// Get chat history with limit
function getChatHistory(limit = 100) {
    return chatHistory.slice(-limit);
}

// Get chat history by client ID
async function getChatHistoryByClientId(clientId, limit = 100) {
    try {
        await db.read();
        const chat = db.data.chats[clientId];
        if (!chat) {
            return [];
        }
        
        const messages = chat.messages || [];
        return messages.slice(-limit);
    } catch (error) {
        console.error('Error getting chat history:', error);
        return [];
    }
}

// Get all chats
async function getChats() {
    try {
        await db.read();
        const chats = db.data.chats || {};
        
        // Convert to array format expected by admin panel
        const chatArray = Object.keys(chats).map(clientId => {
            const chat = chats[clientId];
            if (!chat.deleted && !chat.isAdmin) {
                const lastMessage = chat.messages && chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
                return {
                    id: clientId,
                    name: chat.clientInfo?.name || 'Unknown',
                    email: chat.clientInfo?.email || '',
                    status: chat.status || 'active',
                    // Only include the last message for the overview, not the whole history
                    lastMessage: lastMessage ? { message: lastMessage.message, timestamp: lastMessage.timestamp } : null,
                    lastActivity: lastMessage ? lastMessage.timestamp : (chat.clientInfo?.firstSeen || new Date().toISOString()),
                    unread: 0, // Could be calculated based on admin read status
                    created: chat.clientInfo?.firstSeen || new Date().toISOString()
                };
            }
            return null; // Return null for chats that should be filtered out
        }).filter(Boolean); // Filter out the null entries
        
        return chatArray;
    } catch (error) {
        console.error('Error getting chats:', error);
        return [];
    }
}

// Delete chat
async function deleteChat(chatId) {
    try {
        await db.read();
        if (db.data.chats[chatId]) {
            delete db.data.chats[chatId];
            await enqueueDbWrite(() => {});
            
            // Disconnect client if still connected
            const client = clients.get(chatId);
            if (client && client.ws.readyState === 1) {
                client.ws.close();
            }
            
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error deleting chat:', error);
        return false;
    }
}

// Update chat status
async function updateChatStatus(clientId, status) {
    try {
        await db.read();
        if (db.data.chats[clientId] && !db.data.chats[clientId].isAdmin) {
            db.data.chats[clientId].status = status;
            await enqueueDbWrite(() => {});
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error updating chat status:', error);
        return false;
    }
}

// Resolve chat
async function resolveChat(clientId) {
    return await updateChatStatus(clientId, 'resolved');
}

// Get chat by client ID
async function getChatByClientId(clientId) {
    try {
        await db.read();
        const chat = db.data.chats[clientId];
        if (!chat || chat.deleted || chat.isAdmin) {
            return null;
        }
        
        return {
            id: clientId,
            name: chat.clientInfo?.name || 'Unknown',
            email: chat.clientInfo?.email || '',
            status: chat.status || 'active',
            messages: chat.messages || [],
            lastActivity: chat.messages && chat.messages.length > 0 ? 
                chat.messages[chat.messages.length - 1].timestamp : 
                chat.clientInfo?.firstSeen || new Date().toISOString(),
            created: chat.clientInfo?.firstSeen || new Date().toISOString()
        };
    } catch (error) {
        console.error('Error getting chat by client ID:', error);
        return null;
    }
}

// Get debug info
function getDebugInfo() {
    const clientsInfo = Array.from(clients.entries()).map(([id, client]) => ({
        id,
        name: client.name,
        isAdmin: client.isAdmin,
        isTemporary: client.isTemporary,
        connected: client.ws.readyState === 1,
        ip: client.ip
    }));
    
    return {
        totalClients: clients.size,
        clients: clientsInfo,
        chatHistoryLength: chatHistory.length,
        adminSessions: Array.from(adminSessions.keys())
    };
}

// Get debug info by client ID
function getDebugInfoByClientId(clientId) {
    const client = clients.get(clientId);
    if (!client) {
        return null;
    }
    
    return {
        id: clientId,
        name: client.name,
        email: client.email,
        isAdmin: client.isAdmin,
        isTemporary: client.isTemporary,
        connected: client.ws.readyState === 1,
        ip: client.ip,
        sessionId: client.sessionId,
        joined: client.joined,
        lastActive: client.lastActive
    };
}

const validator = require('validator');

module.exports = ({ db, enqueueDbWrite, clients, sendToClient, notifyAdmin }) => {
    const chatHistory = []; // Capped in-memory history
    const MAX_HISTORY_LENGTH = 1000; // Cap to prevent memory leak

    // Function to add a message to the capped in-memory history
    function addMessageToHistory(message) {
        chatHistory.push(message);
        if (chatHistory.length > MAX_HISTORY_LENGTH) {
            // Remove the oldest message to cap the array size
            chatHistory.splice(0, chatHistory.length - MAX_HISTORY_LENGTH);
        }
    }

    // Persist a chat message to LowDB for a given clientId
    async function persistChatMessage(clientId, message) {
        try {
            await db.read();
            db.data = db.data && typeof db.data === 'object' ? db.data : {};
            db.data.chats = db.data.chats || {};
            
            // Don't create chat sessions for admin users or temporary connections
            if (db.data.chats[clientId] && db.data.chats[clientId].isAdmin) {
                return;
            }
            
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
                await enqueueDbWrite(() => {}); // The write is handled by the queue
            }
        } catch (e) {
            console.error('Error persisting chat message:', e);
        }
    }

    // Function to store offline messages
    async function storeOfflineMessage(clientId, message) {
        // Don't store offline messages for admin users
        const client = clients.get(clientId);
        if (client && client.isAdmin) return;
        
        await enqueueDbWrite(async () => {
            await db.read();
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
            
            await db.write();
        });
    }

    // Function to deliver offline messages when admin connects
    async function deliverOfflineMessages(adminClientId) {
        await enqueueDbWrite(async () => {
            await db.read();
            if (!db.data.offline_messages) return;
            
            for (const clientId in db.data.offline_messages) {
                const messages = db.data.offline_messages[clientId];
                for (const msg of messages) {
                    // Add to chat history
                    addMessageToHistory(msg.message);
                    
                    // Notify the specific admin who just connected
                    notifyAdmin('chat', msg.message, adminClientId);
                }
                // Clear delivered messages for this client
                delete db.data.offline_messages[clientId];
            }
            await db.write();
        });
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
    // This notifyAdmin is for internal service use, the one passed from server.js is for external use
    const internalNotifyAdmin = (type, payload, targetAdminClientId = null) => {
        clients.forEach(client => {
            if (client.isAdmin && client.ws.readyState === WebSocket.OPEN && (!targetAdminClientId || client.id === targetAdminClientId)) {
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
    };

    // Modify sendToClient to include session information
    const internalSendToClient = (clientId, messageText, sourceSessionId = null) => {
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
            
            addMessageToHistory(adminMessage);
            
            try {
                client.ws.send(JSON.stringify(adminMessage));
                // Persist even when client is online to keep full history (but not for admin users)
                if (!client.isAdmin) {
                    persistChatMessage(clientId, adminMessage);
                }
                return true;
            } catch (error) {
                console.error('Error sending message to client:', error);
                return false;
            }
        }
        return false;
    };

    // Modify broadcastToClients to respect sessions
    const broadcastToClients = (messageText, sourceSessionId = null) => {
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
                
                addMessageToHistory(adminMessage);
                
                try {
                    client.ws.send(JSON.stringify(adminMessage));
                    count++;
                } catch (error) {
                    console.error('Error broadcasting to client:', error);
                }
            }
        });
        return count;
    };

    async function promoteToPermanent(client, clientId, clientIp, ws) {
        // CRITICAL FIX: Never promote a connection that has been identified as an admin.
        if (client.isAdmin) {
            return clientId; // Return the existing ID without creating a session.
        }
        // Also prevent promotion of clients with reserved names.
        if (client.name === 'Admin' || client.name === 'Support') {
            console.log(`Blocking promotion for reserved name: ${client.name}`);
            return clientId;
        }

        console.log('Converting temporary connection to permanent for client:', clientIp, 'Name:', client.name);
        client.isTemporary = false;

        const newClientId = 'client_' + Date.now() + Math.random().toString(36).substr(2, 9);

        // Update client mapping
        clients.delete(clientId);
        client.id = newClientId;
        clients.set(newClientId, client);

        // Update WebSocket reference
        ws.clientId = newClientId;

        // Send the new client ID to the client
        try {
            ws.send(JSON.stringify({ type: 'client_id', clientId: newClientId }));
        } catch (error) {
            console.error('Error sending new client ID:', error);
        }

        notifyAdmin(`New chat session created: ${client.name} (${clientIp}) - ${newClientId}`);

        // Create the entry in the database ONLY if this is not an admin
        if (!client.isAdmin) {
            try {
                await db.read();
                db.data.chats = db.data.chats || {};
                if (!db.data.chats[newClientId]) {
                    db.data.chats[newClientId] = {
                        clientInfo: {
                            name: client.name || 'Guest', 
                            email: client.email || '',
                            ip: client.ip,
                            firstSeen: new Date().toISOString(),
                            originalName: client.name // Store the original name
                        },
                        messages: [],
                        status: 'active'
                    };
                    await enqueueDbWrite(() => {});
                }
            } catch (e) {
                console.error('Error creating new chat session in DB on promotion:', e);
            }
        }

        return newClientId;
    }

    async function handleChatMessage(client, message, clientId, ws) {
        // If this is a temporary connection, promote to permanent FIRST
        if (client.isTemporary) {        
            // FIX: Update the in-memory client name from the message BEFORE promoting.
            // This ensures the database record is created with the correct name.
            if (typeof message.name !== 'string' || message.name.trim().length === 0) {
                console.log('Blocking promotion due to invalid name:', message.name);
                return clientId;
            }
            
            if (message.name && message.name !== 'Guest') {
                client.name = validator.escape(message.name.substring(0, 50)) || client.name;
            }
            clientId = await promoteToPermanent(client, clientId, client.ip, ws);
        }
        
        const messageText = message.message || message.text;
        if (typeof messageText !== 'string' || messageText.trim().length === 0) {
            console.log('Invalid chat message from:', client.ip);
            return;
        }

        const sanitizedText = validator.escape(messageText.trim()).substring(0, 500);

        // Update client name from message if provided and different
        if (message.name && message.name !== client.name && message.name !== 'Guest') {
            const newName = validator.escape(message.name.substring(0, 50)) || client.name;
            client.name = newName;
            
            // Update in database
            try {
                // This check is important: only update DB for non-temporary (already promoted) clients
                await db.read();
                if (db.data.chats[clientId]) {
                    db.data.chats[clientId].clientInfo.name = client.name;
                    await enqueueDbWrite(() => {});
                    console.log('Updated client name in database from chat message:', client.name);
                }
            } catch (e) {
                console.error('Error updating client name from message:', e);
            }
        }

        const isDuplicate = chatHistory.some(msg =>
            msg.clientId === clientId &&
            msg.message === sanitizedText &&
            (Date.now() - new Date(msg.timestamp).getTime()) < 1000
        );

        if (isDuplicate) {
            console.log('Duplicate message detected, ignoring:', client.ip);
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

        addMessageToHistory(chatMessage);

        // Only persist if this is not an admin message and not a temporary connection
        if (!client.isAdmin && !client.isTemporary) {
            await persistChatMessage(clientId, chatMessage);
        }

        let adminOnline = Array.from(clients.values()).some(c => c.isAdmin && c.ws.readyState === WebSocket.OPEN);

        if (!adminOnline && !client.isAdmin) {
            storeOfflineMessage(clientId, chatMessage);
        } else {
            broadcastToAll(chatMessage, null, client.isAdmin ? clientId : null);
        }

        if (!client.isAdmin && !client.isTemporary) {
            notifyAdmin(`New message from ${client.name}: ${sanitizedText.substring(0, 50)}${sanitizedText.length > 50 ? '...' : ''}`);
        }

        // Send automated offline message only once per chat when no admin is online
        if (!client.isAdmin && !adminOnline && !client.isTemporary) {
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
                    try { client.ws.send(JSON.stringify(autoMsg)); } catch (e) { console.error('Error sending offline auto message:', e); }
                    
                    chatObj.messages.push({ id: autoMsg.id, message: autoMsg.message, timestamp: autoMsg.timestamp, isAdmin: false, type: 'system' });
                    chatObj.offlineAutoMessageSent = true;
                    await enqueueDbWrite(() => {});
                }
            } catch (e) {
                console.error('Error processing offline auto message:', e);
            }
        }
    }

    async function handleResolveChat(message) {
        const { targetClientId } = message;
        try {
            await db.read();
            if (db.data.chats[targetClientId]) {
                db.data.chats[targetClientId].status = 'resolved';
                await enqueueDbWrite(() => {});

                notifyAdmin('chat_resolved', { clientId: targetClientId });

                const targetClient = clients.get(targetClientId);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                    targetClient.ws.send(JSON.stringify({
                        type: 'system',
                        message: 'A support agent has marked this chat as resolved. This chat is now closed.'
                    }));
                }
            }
        } catch (err) {
            console.error(`Error resolving chat for ${targetClientId}:`, err);
        }
    }

    // Get chat statistics
    const getChatStats = () => {
        const activeClients = Array.from(clients.values()).filter(c => !c.isAdmin && c.ws.readyState === 1).length;
        const activeAdmins = Array.from(clients.values()).filter(c => c.isAdmin && c.ws.readyState === 1).length;
        
        return {
            activeClients,
            activeAdmins,
            totalConnections: clients.size,
            messagesInHistory: chatHistory.length
        };
    };

    // Send message to specific client
    const sendMessage = async (clientId, messageText, isAdmin = false) => {
        const success = sendToClient(clientId, messageText);
        
        // Also persist the message if it's an admin sending it
        if (isAdmin) {
            const adminMessage = {
                id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                type: 'chat',
                message: messageText,
                name: 'Admin',
                timestamp: new Date().toISOString(),
                isAdmin: true,
                clientId: clientId,
            };
            await persistChatMessage(clientId, adminMessage);
        }

        return {
            success,
            message: success ? 'Message sent successfully' : 'Failed to send message - client not found or offline'
        };
    };

    // Get chat history with limit
    const getChatHistory = (limit = 100) => {
        return chatHistory.slice(-limit);
    };

    // Get chat history by client ID
    const getChatHistoryByClientId = async (clientId, limit = 100) => {
        try {
            await db.read();
            const chat = db.data.chats[clientId];
            if (!chat) {
                return [];
            }
            
            const messages = chat.messages || [];
            return messages.slice(-limit);
        } catch (error) {
            console.error('Error getting chat history:', error);
            return [];
        }
    };

    // Get all chats
    const getChats = async () => {
        try {
            await db.read();
            const chats = db.data.chats || {};
            
            // Convert to array format expected by admin panel
            const chatArray = Object.keys(chats).map(clientId => {
                const chat = chats[clientId];
                if (!chat.deleted && !chat.isAdmin) {
                    const lastMessage = chat.messages && chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
                    return {
                        id: clientId,
                        name: chat.clientInfo?.name || 'Unknown',
                        email: chat.clientInfo?.email || '',
                        status: chat.status || 'active',
                        // Only include the last message for the overview, not the whole history
                        lastMessage: lastMessage ? { message: lastMessage.message, timestamp: lastMessage.timestamp } : null,
                        lastActivity: lastMessage ? lastMessage.timestamp : (chat.clientInfo?.firstSeen || new Date().toISOString()),
                        unread: 0, // Could be calculated based on admin read status
                        created: chat.clientInfo?.firstSeen || new Date().toISOString()
                    };
                }
                return null; // Return null for chats that should be filtered out
            }).filter(Boolean); // Filter out the null entries
            
            return chatArray;
        } catch (error) {
            console.error('Error getting chats:', error);
            return [];
        }
    };

    // Delete chat
    const deleteChat = async (chatId) => {
        try {
            return await enqueueDbWrite(async () => {
                await db.read();
                if (db.data.chats[chatId]) {
                    delete db.data.chats[chatId];
                    await db.write();
                    
                    // Disconnect client if still connected
                    const client = clients.get(chatId);
                    if (client && client.ws.readyState === 1) {
                        client.ws.close();
                    }
                    return true;
                }
                return false;
            });
        } catch (error) {
            console.error('Error deleting chat:', error);
            return false;
        }
    };

    // Update chat status
    const updateChatStatus = async (clientId, status) => {
        try {
            return await enqueueDbWrite(async () => {
                await db.read();
                if (db.data.chats[clientId] && !db.data.chats[clientId].isAdmin) {
                    db.data.chats[clientId].status = status;
                    await db.write();
                    return true;
                }
                return false;
            });
        } catch (error) {
            console.error('Error updating chat status:', error);
            return false;
        }
    };

    // Resolve chat
    const resolveChat = async (clientId) => {
        return await updateChatStatus(clientId, 'resolved');
    };

    // Get chat by client ID
    const getChatByClientId = async (clientId) => {
        try {
            await db.read();
            const chat = db.data.chats[clientId];
            if (!chat || chat.deleted || chat.isAdmin) {
                return null;
            }
            
            return {
                id: clientId,
                name: chat.clientInfo?.name || 'Unknown',
                email: chat.clientInfo?.email || '',
                status: chat.status || 'active',
                messages: chat.messages || [],
                lastActivity: chat.messages && chat.messages.length > 0 ? 
                    chat.messages[chat.messages.length - 1].timestamp : 
                    chat.clientInfo?.firstSeen || new Date().toISOString(),
                created: chat.clientInfo?.firstSeen || new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting chat by client ID:', error);
            return null;
        }
    };

    // Get debug info
    const getDebugInfo = () => {
        const clientsInfo = Array.from(clients.entries()).map(([id, client]) => ({
            id,
            name: client.name,
            isAdmin: client.isAdmin,
            isTemporary: client.isTemporary,
            connected: client.ws.readyState === 1,
            ip: client.ip
        }));
        
        return {
            totalClients: clients.size,
            clients: clientsInfo,
            chatHistoryLength: chatHistory.length,
            // adminSessions: Array.from(adminSessions.keys()) // adminSessions is not passed
        };
    };

    // Get debug info by client ID
    const getDebugInfoByClientId = (clientId) => {
        const client = clients.get(clientId);
        if (!client) {
            return null;
        }
        
        return {
            id: clientId,
            name: client.name,
            email: client.email,
            isAdmin: client.isAdmin,
            isTemporary: client.isTemporary,
            connected: client.ws.readyState === 1,
            ip: client.ip,
            sessionId: client.sessionId,
            joined: client.joined,
            lastActive: client.lastActive
        };
    };

    return {
        addMessageToHistory,
        persistChatMessage,
        storeOfflineMessage,
        deliverOfflineMessages,
        broadcastToAll,
        notifyAdmin: internalNotifyAdmin, // Use internal notifyAdmin
        sendToClient: internalSendToClient, // Use internal sendToClient
        broadcastToClients,
        promoteToPermanent,
        handleChatMessage,
        handleResolveChat,
        getChatStats,
        sendMessage,
        getChatHistory,
        getChatHistoryByClientId,
        getChats,
        deleteChat,
        updateChatStatus,
        resolveChat,
        getChatByClientId,
        getDebugInfo,
        getDebugInfoByClientId
    };
};

