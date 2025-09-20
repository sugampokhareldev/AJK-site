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
const MemoryStore = require('memorystore')(session);
const crypto = require('crypto');
const fs = require('fs');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const validator = require('validator');
const rateLimit = require('express-rate-limit');

// Import security functions
const security = require('./security');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Trust Render's proxy (CRITICAL for secure cookies)
app.set('trust proxy', 1);

// Use environment secret or generate one
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');

// Environment-specific settings
const isProduction = NODE_ENV === 'production';

// Set security functions in app context
app.set('security', security);

// Database setup with lowdb
const dbPath = process.env.DB_PATH || path.join(__dirname, 'db.json');
const dbDir = path.dirname(dbPath);

// Ensure the directory exists
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database
const adapter = new JSONFile(dbPath);
const db = new Low(adapter, { submissions: [], admin_users: [] });

// Initialize database with error handling
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
            db.data = { submissions: [], admin_users: [] };
        }
        
        // Ensure arrays exist
        db.data.submissions = db.data.submissions || [];
        db.data.admin_users = db.data.admin_users || [];
        
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
        
        console.log('Database ready at:', dbPath);
        
    } catch (error) {
        console.error('Database initialization error:', error);
        // Try to create fresh database
        try {
            db.data = { submissions: [], admin_users: [] };
            
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

// ==================== WEBSOCKET CHAT SERVER ====================
const clients = new Map();
const chatHistory = [];
const connectionQuality = new Map();

function broadcastToAll(message) {
    clients.forEach(c => {
        if (c.ws.readyState === WebSocket.OPEN) {
            try {
                c.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error('Error sending message to client:', error);
            }
        }
    });
}

function notifyAdmin(message) {
    clients.forEach(client => {
        if (client.isAdmin && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify({
                    type: 'admin',
                    message: message,
                    timestamp: new Date().toISOString()
                }));
            } catch (error) {
                console.error('Error notifying admin:', error);
            }
        }
    });
}

function sendToClient(clientId, messageText) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        const adminMessage = {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            type: 'chat',
            message: messageText,
            name: 'Support',
            timestamp: new Date().toISOString(),
            isAdmin: true,
            clientId: clientId
        };
        
        chatHistory.push(adminMessage);
        
        try {
            client.ws.send(JSON.stringify(adminMessage));
            return true;
        } catch (error) {
            console.error('Error sending message to client:', error);
            return false;
        }
    }
    return false;
}

function broadcastToClients(messageText) {
    let count = 0;
    clients.forEach(client => {
        if (!client.isAdmin && client.ws.readyState === WebSocket.OPEN) {
            const adminMessage = {
                id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                type: 'chat',
                message: messageText,
                name: 'Support',
                timestamp: new Date().toISOString(),
                isAdmin: true,
                clientId: client.id
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

wss.on('connection', (ws, request) => {
    const clientIp = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                     request.headers['x-real-ip'] || 
                     request.socket.remoteAddress || 
                     'unknown';
    
    console.log('Client connected:', clientIp);
    
    const clientId = 'client_' + Date.now() + Math.random().toString(36).substr(2, 9);
    
    const client = {
        ws,
        ip: clientIp,
        isAdmin: false,
        name: 'Guest',
        email: '',
        id: clientId,
        joined: new Date().toISOString(),
        sessionId: null,
        hasReceivedWelcome: false
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
    
    try {
        ws.send(JSON.stringify({
            type: 'client_id',
            clientId: clientId
        }));
        
        // Send recent chat history to the client
        if (chatHistory.length > 0) {
            const recentMessages = chatHistory.filter(msg => 
                msg.clientId === clientId || msg.isAdmin
            ).slice(-20);
            
            if (recentMessages.length > 0) {
                ws.send(JSON.stringify({
                    type: 'history',
                    messages: recentMessages,
                    clientId: clientId
                }));
            }
        }
    } catch (error) {
        console.error('Error sending initial messages:', error);
    }
    
    notifyAdmin(`New client connected: ${clientIp} (${clientId})`);
    
    ws.on('message', (data) => {
        try {
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
            
            switch (message.type) {
                case 'chat':
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
                    broadcastToAll(chatMessage);
                    
                    if (!client.isAdmin) {
                        notifyAdmin(`New message from ${client.name}: ${sanitizedText.substring(0, 50)}${sanitizedText.length > 50 ? '...' : ''}`);
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
                    client.isAdmin = message.isAdmin || false;
                    
                    console.log('Client identified:', client.name, client.email, client.isAdmin ? '(Admin)' : '');
                    
                    // Only send welcome message to non-admin clients on first identification
                    if (!client.isAdmin && !client.hasReceivedWelcome) {
                        try {
                            ws.send(JSON.stringify({
                                type: 'system',
                                message: 'Welcome to AJK Cleaning! How can we help you today?',
                                timestamp: new Date().toISOString()
                            }));
                            client.hasReceivedWelcome = true;
                        } catch (error) {
                            console.error('Error sending welcome message:', error);
                        }
                    }
                    
                    if (!client.isAdmin) {
                        notifyAdmin(`Client ${clientId} identified as: ${client.name} (${client.email || 'no email'})`);
                    }
                    break;
                    
                case 'get_history':
                    if (client.isAdmin && message.clientId) {
                        const targetClientId = message.clientId;
                        const clientMessages = chatHistory.filter(msg => msg.clientId === targetClientId);
                        
                        try {
                            ws.send(JSON.stringify({
                                type: 'history',
                                messages: clientMessages,
                                clientId: targetClientId
                            }));
                        } catch (error) {
                            console.error('Error sending history:', error);
                        }
                    }
                    break;
                    
                case 'admin_message':
                    if (client.isAdmin && message.targetClientId && message.message) {
                        const targetClient = clients.get(message.targetClientId);
                        if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                            const adminMessage = {
                                id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                                type: 'chat',
                                message: message.message,
                                name: 'Support',
                                timestamp: new Date().toISOString(),
                                isAdmin: true,
                                clientId: message.targetClientId
                            };
                            
                            // Check for duplicate before adding to history
                            const isDup = chatHistory.some(msg => 
                                msg.clientId === adminMessage.clientId && 
                                msg.message === adminMessage.message && 
                                (Date.now() - new Date(msg.timestamp).getTime()) < 1000
                            );
                            
                            if (!isDup) {
                                chatHistory.push(adminMessage);
                                
                                try {
                                    targetClient.ws.send(JSON.stringify(adminMessage));
                                    
                                    // Send to all admins except the sender to prevent duplication
                                    clients.forEach(c => {
                                        if (c.isAdmin && c.id !== client.id && c.ws.readyState === WebSocket.OPEN) {
                                            try {
                                                c.ws.send(JSON.stringify(adminMessage));
                                            } catch (error) {
                                                console.error('Error sending to admin:', error);
                                            }
                                        }
                                    });
                                } catch (error) {
                                    console.error('Error sending admin message:', error);
                                }
                            }
                        }
                    }
                    break;
                    
                case 'broadcast':
                    if (client.isAdmin && message.message) {
                        const broadcastCount = broadcastToClients(message.message);
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
                    
                default:
                    console.log('Unknown message type from:', clientIp, message.type);
            }
        } catch (error) {
            console.error('Error processing message from', clientIp, ':', error);
        }
    });
    
    ws.on('close', (code, reason) => {
        console.log('Client disconnected:', clientIp, clientId, 'Code:', code, 'Reason:', reason);
        clients.delete(clientId);
        connectionQuality.delete(clientId);
        notifyAdmin(`Client disconnected: ${client.name} (${clientId})`);
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

const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Terminating dead connection:', ws.clientId || 'unknown');
            
            if (ws.clientId) {
                clients.delete(ws.clientId);
                connectionQuality.delete(ws.clientId);
                notifyAdmin(`Client disconnected due to timeout: ${ws.clientId}`);
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

// After initializing the database, set it in the app context
app.set('db', db);

// After session configuration
// Create route handlers
const authRoutes = require('./routes/auth');
const submissionRoutes = require('./routes/submissions');

app.use('/api/admin', authRoutes);
app.use('/api/submissions', submissionRoutes);

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({
        authenticated: !!req.session.authenticated,
        sessionId: req.sessionID,
        environment: NODE_ENV,
        port: PORT,
        secureCookie: req.session.cookie.secure,
        clientIp: req.ip
    });
});

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
        
        notifyAdmin(`New contact form submission from ${sanitizedData.name} (${sanitizedData.email})`);
        
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
        res.json(db.data.submissions.reverse());
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

app.post('/api/chat/send', requireAuth, (req, res) => {
    const { clientId, message } = req.body;
    
    if (!clientId || !message) {
        return res.status(400).json({ success: false, error: 'Client ID and message are required' });
    }
    
    if (sendToClient(clientId, message)) {
        res.json({ success: true, message: 'Message sent successfully' });
    } else {
        res.status(404).json({ success: false, error: 'Client not found or not connected' });
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

app.get('/api/chat/history/:clientId', requireAuth, (req, res) => {
    const { clientId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const clientMessages = chatHistory
        .filter(msg => msg.clientId === clientId)
        .slice(-limit);
    
    res.json(clientMessages);
});

app.get('/api/chat/history', requireAuth, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const filteredHistory = chatHistory.slice(-limit);
    res.json(filteredHistory);
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
        console.log(`Brute force protection: ENABLED (${security.MAX_ATTEMPTS} attempts)`);
        console.log(`Rate limiting: ENABLED`);
        console.log(`Enhanced validation: ENABLED`);
        console.log(`WebSocket chat server: READY`);
        console.log(`Connection quality monitoring: ENABLED`);
        console.log(`=== SERVER READY ===`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});