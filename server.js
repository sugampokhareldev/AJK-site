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

// ==================== BRUTE FORCE PROTECTION ====================
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

// Clean up old attempts every hour
setInterval(() => {
    const now = Date.now();
    for (const [ip, attemptData] of loginAttempts.entries()) {
        if (now - attemptData.lastAttempt > LOCKOUT_TIME * 2) {
            loginAttempts.delete(ip);
        }
    }
}, 60 * 60 * 1000); // Cleanup every hour

function recordFailedAttempt(ip) {
    const now = Date.now();
    let attemptData = loginAttempts.get(ip) || { 
        count: 0, 
        firstAttempt: now,
        lastAttempt: now,
        lockedUntil: 0 
    };
    
    attemptData.count++;
    attemptData.lastAttempt = now;
    
    if (attemptData.count >= MAX_ATTEMPTS) {
        attemptData.lockedUntil = now + LOCKOUT_TIME;
    }
    
    loginAttempts.set(ip, attemptData);
    return attemptData;
}

function getRemainingAttempts(ip) {
    const attemptData = loginAttempts.get(ip);
    if (!attemptData) return MAX_ATTEMPTS;
    
    if (attemptData.lockedUntil > Date.now()) {
        return 0; // Locked out
    }
    
    return Math.max(0, MAX_ATTEMPTS - attemptData.count);
}

function isIpLocked(ip) {
    const attemptData = loginAttempts.get(ip);
    return attemptData && attemptData.lockedUntil > Date.now();
}
// ==================== END BRUTE FORCE PROTECTION ====================

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
const clients = new Map(); // Using Map for better client management
const chatHistory = [];

// Create WebSocket server AFTER the server is created
const wss = new WebSocket.Server({ server });

// Add this helper function to broadcast to all connected clients
function broadcastToAll(message) {
    clients.forEach(c => {
        if (c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(JSON.stringify(message));
        }
    });
}

wss.on('connection', (ws, request) => {
    const clientIp = request.headers['x-forwarded-for'] || request.socket.remoteAddress;
    console.log('Client connected:', clientIp);
    
    // Generate unique client ID
    const clientId = 'client_' + Date.now() + Math.random().toString(36).substr(2, 9);
    
    // Add client to tracking
    const client = {
        ws,
        ip: clientIp,
        isAdmin: false,
        name: 'Guest',
        email: '',
        id: clientId,
        joined: new Date().toISOString()
    };
    clients.set(clientId, client);
    
    // Send client their ID
    ws.send(JSON.stringify({
        type: 'client_id',
        clientId: clientId
    }));
    
    // Send chat history to new client
    if (chatHistory.length > 0) {
        ws.send(JSON.stringify({
            type: 'history',
            messages: chatHistory.slice(-50), // Last 50 messages
            clientId: clientId
        }));
    }
    
    // Send welcome message
    ws.send(JSON.stringify({
        type: 'system',
        message: 'Welcome to AJK Cleaning! How can we help you today?',
        timestamp: new Date().toISOString()
    }));
    
    // Notify admin about new connection
    notifyAdmin(`New client connected: ${clientIp} (${clientId})`);
    
    // WebSocket message handler - PROPERLY NESTED INSIDE CONNECTION HANDLER
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString()); // Convert buffer to string
            
            // Basic message validation
            if (!message || typeof message !== 'object') {
                console.log('Invalid message format from:', clientIp);
                return;
            }
            
            // Add message type validation
            if (!message.type || typeof message.type !== 'string') {
                console.log('Missing message type from:', clientIp);
                return;
            }
            
            switch (message.type) {
                case 'chat':
                    // Validate and sanitize message - handle both 'message' and 'text' fields
                    const messageText = message.message || message.text;
                    if (typeof messageText !== 'string' || messageText.trim().length === 0) {
                        console.log('Invalid chat message from:', clientIp);
                        return;
                    }
                    
                    const sanitizedText = validator.escape(messageText.trim()).substring(0, 500);
                    
                    // Store and broadcast chat message
                    const chatMessage = {
                        id: Date.now(),
                        type: 'chat',
                        name: client.name,
                        message: sanitizedText, // Use 'message' field consistently
                        timestamp: new Date().toISOString(),
                        isAdmin: client.isAdmin,
                        clientId: clientId
                    };
                    
                    chatHistory.push(chatMessage);
                    
                    // Broadcast to ALL clients (including admins)
                    broadcastToAll(chatMessage);
                    
                    // Notify admin about new message
                    if (!client.isAdmin) {
                        notifyAdmin(`New message from ${client.name}: ${sanitizedText.substring(0, 50)}${sanitizedText.length > 50 ? '...' : ''}`);
                    }
                    break;
                    
                case 'typing':
                    // Validate typing message
                    if (typeof message.isTyping !== 'boolean') {
                        return;
                    }
                    
                    // Broadcast typing indicator to admins only
                    clients.forEach(c => {
                        if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                            c.ws.send(JSON.stringify({
                                type: 'typing',
                                isTyping: message.isTyping,
                                name: client.name,
                                clientId: clientId
                            }));
                        }
                    });
                    break;
                    
                case 'identify':
                    // Client identification with validation
                    if (message.name && typeof message.name === 'string') {
                        client.name = validator.escape(message.name.substring(0, 50)) || 'Guest';
                    }
                    if (message.email && typeof message.email === 'string' && validator.isEmail(message.email)) {
                        client.email = message.email;
                    }
                    client.isAdmin = message.isAdmin || false;
                    
                    console.log('Client identified:', client.name, client.email, client.isAdmin ? '(Admin)' : '');
                    
                    // Notify admin about client identification
                    if (!client.isAdmin) {
                        notifyAdmin(`Client ${clientId} identified as: ${client.name} (${client.email || 'no email'})`);
                    }
                    break;
                    
                case 'get_history':
                    // Send chat history for specific client (admin request)
                    if (client.isAdmin && message.clientId) {
                        const targetClientId = message.clientId;
                        const clientMessages = chatHistory.filter(msg => msg.clientId === targetClientId);
                        
                        ws.send(JSON.stringify({
                            type: 'history',
                            messages: clientMessages,
                            clientId: targetClientId
                        }));
                    }
                    break;
                    
                case 'admin_message':
                    // Admin message to specific client
                    if (client.isAdmin && message.targetClientId && message.message) {
                        const targetClient = clients.get(message.targetClientId);
                        if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                            const adminMessage = {
                                type: 'chat',
                                message: message.message,
                                name: 'Support',
                                timestamp: new Date().toISOString(),
                                isAdmin: true,
                                clientId: message.targetClientId
                            };
                            
                            // Store in history
                            chatHistory.push({
                                ...adminMessage,
                                id: Date.now()
                            });
                            
                            // Send to target client
                            targetClient.ws.send(JSON.stringify(adminMessage));
                            
                            // Also send to all admins (including the sender)
                            clients.forEach(c => {
                                if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                                    c.ws.send(JSON.stringify(adminMessage));
                                }
                            });
                        }
                    }
                    break;
                    
                case 'broadcast':
                    // Broadcast to all clients
                    if (client.isAdmin && message.message) {
                        const broadcastCount = broadcastToClients(message.message);
                        // Notify admin about broadcast result
                        client.ws.send(JSON.stringify({
                            type: 'system',
                            message: `Broadcast sent to ${broadcastCount} clients`
                        }));
                    }
                    break;
                    
                default:
                    console.log('Unknown message type from:', clientIp, message.type);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected:', clientIp, clientId);
        clients.delete(clientId);
        
        // Notify admin about disconnection
        notifyAdmin(`Client disconnected: ${client.name} (${clientId})`);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(clientId);
    });
});

// Admin functions
function notifyAdmin(message) {
    clients.forEach(client => {
        if (client.isAdmin && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
                type: 'admin',
                message: message,
                timestamp: new Date().toISOString()
            }));
        }
    });
}

function getConnectedClients() {
    return Array.from(clients.values()).filter(client => !client.isAdmin);
}

// Send message to specific client
function sendToClient(clientId, messageText) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        const adminMessage = {
            type: 'chat',
            message: messageText,
            name: 'Support',
            timestamp: new Date().toISOString(),
            isAdmin: true,
            clientId: clientId
        };
        
        // Store in history
        chatHistory.push({
            ...adminMessage,
            id: Date.now()
        });
        
        client.ws.send(JSON.stringify(adminMessage));
        return true;
    }
    return false;
}

// Send message to specific client (WebSocket version)
function sendMessageToClient(clientId, message) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        const adminMessage = {
            type: 'chat',
            message: message,
            name: 'Support',
            timestamp: new Date().toISOString(),
            isAdmin: true,
            clientId: clientId
        };
        
        // Store in history
        chatHistory.push({
            ...adminMessage,
            id: Date.now()
        });
        
        client.ws.send(JSON.stringify(adminMessage));
        return true;
    }
    return false;
}

// Broadcast to all non-admin clients
function broadcastToClients(messageText) {
    let count = 0;
    clients.forEach(client => {
        if (!client.isAdmin && client.ws.readyState === WebSocket.OPEN) {
            const adminMessage = {
                type: 'chat',
                message: messageText,
                name: 'Support',
                timestamp: new Date().toISOString(),
                isAdmin: true,
                clientId: client.id
            };
            
            // Store in history
            chatHistory.push({
                ...adminMessage,
                id: Date.now()
            });
            
            client.ws.send(JSON.stringify(adminMessage));
            count++;
        }
    });
    return count;
}
// ==================== END WEBSOCKET CHAT SERVER ====================

// CORS configuration for Render
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://ajk-cleaning.onrender.com',
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:3001',
            'http://127.0.0.1:3001'
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('localhost')) {
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

// Handle preflight requests
app.options('*', cors());

app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));

// Updated CSP middleware to allow external resources
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; " +
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; " +
    "img-src 'self' data: https:; " +
    "font-src 'self'; " +
    "connect-src 'self' ws://" + req.headers.host + " wss://" + req.headers.host + "; " +
    "frame-src 'self';"
  );
  next();
});

// Session configuration for Render production - FIXED
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
        // Remove domain setting - let browser handle it
    }
}));

// Test endpoint to check session
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

// Login endpoint with brute force protection
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    
    console.log('Login attempt from IP:', ip, 'Username:', username);
    
    // Validate input
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ success: false, error: 'Username and password required' });
    }
    
    // Check if IP is locked out
    if (isIpLocked(ip)) {
        const attemptData = loginAttempts.get(ip);
        const remainingTime = Math.ceil((attemptData.lockedUntil - Date.now()) / 60000);
        return res.status(429).json({ 
            success: false, 
            error: `Too many failed attempts. Account locked for ${remainingTime} minutes.` 
        });
    }
    
    await db.read();
    const user = db.data.admin_users.find(u => u.username === username);
    
    if (!user) {
        const attemptData = recordFailedAttempt(ip);
        const remainingAttempts = getRemainingAttempts(ip);
        
        console.log(`Failed login attempt - User not found: ${username}, IP: ${ip}`);
        
        return res.status(401).json({ 
            success: false, 
            error: `Invalid credentials. ${remainingAttempts} attempts remaining.`,
            remainingAttempts: remainingAttempts
        });
    }
    
    const result = await bcrypt.compare(password, user.password_hash);
    
    if (result) {
        // Reset attempts on successful login
        loginAttempts.delete(ip);
        
        req.session.authenticated = true;
        req.session.user = { id: user.id, username: user.username };
        
        console.log('Successful login from IP:', ip, 'User:', username);
        res.json({ 
            success: true, 
            message: 'Login successful',
            user: { id: user.id, username: user.username }
        });
    } else {
        const attemptData = recordFailedAttempt(ip);
        const remainingAttempts = getRemainingAttempts(ip);
        
        console.log(`Failed login attempt from IP: ${ip}, Username: ${username}, Attempts: ${attemptData.count}/${MAX_ATTEMPTS}`);
        
        res.status(401).json({ 
            success: false, 
            error: `Invalid credentials. ${remainingAttempts} attempts remaining.`,
            remainingAttempts: remainingAttempts
        });
    }
});

// Check login attempt status
app.get('/api/admin/login-attempts', (req, res) => {   
    const ip = req.ip || req.connection.remoteAddress;
    const attemptData = loginAttempts.get(ip);
    const remainingAttempts = getRemainingAttempts(ip);
    
    res.json({
        ip: ip,
        remainingAttempts: remainingAttempts,
        isLocked: attemptData ? attemptData.lockedUntil > Date.now() : false,
        lockedUntil: attemptData ? attemptData.lockedUntil : null,
        attemptCount: attemptData ? attemptData.count : 0
    });
});

// Logout endpoint
app.post('/api/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logout successful' });
    });
});

// Check authentication status
app.get('/api/admin/status', (req, res) => {
    res.json({ 
        authenticated: !!(req.session && req.session.authenticated),
        user: req.session ? req.session.user : null
    });
});

// Form submission endpoint with validation
app.post('/api/form/submit', async (req, res) => {
    try {
        const { name, email, phone, service, message } = req.body;
        
        // Validate required fields
        if (!name || !email || !message) {
            return res.status(400).json({ success: false, error: 'Name, email, and message are required' });
        }
        
        // Validate email format
        if (!validator.isEmail(email)) {
            return res.status(400).json({ success: false, error: 'Invalid email format' });
        }
        
        // Sanitize inputs
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
            ip: req.ip || req.connection.remoteAddress
        };
        
        db.data.submissions.push(submission);
        await db.write();
        
        // Notify admin about new form submission
        notifyAdmin(`New contact form submission from ${sanitizedData.name} (${sanitizedData.email})`);
        
        console.log('Form submission received:', { id: submission.id, email: sanitizedData.email });
        
        res.json({ success: true, id: submission.id });
    } catch (error) {
        console.error('Form submission error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Protected API endpoints - GET ALL SUBMISSIONS
app.get('/api/submissions', requireAuth, async (req, res) => {
    try {
        await db.read();
        res.json(db.data.submissions.reverse());
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get a specific submission
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

// Delete a submission
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

// Get statistics
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

// Chat statistics endpoint
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

// Send message to specific client (admin only)
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

// Broadcast message to all clients (admin only)
app.post('/api/chat/broadcast', requireAuth, (req, res) => {
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ success: false, error: 'Message is required' });
    }
    
    const count = broadcastToClients(message);
    res.json({ success: true, message: `Message broadcast to ${count} clients` });
});

// Get chat history for specific client (admin only)
app.get('/api/chat/history/:clientId', requireAuth, (req, res) => {
    const { clientId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const clientMessages = chatHistory
        .filter(msg => msg.clientId === clientId)
        .slice(-limit);
    
    res.json(clientMessages);
});

// Get all chat history (admin only)
app.get('/api/chat/history', requireAuth, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const filteredHistory = chatHistory.slice(-limit);
    res.json(filteredHistory);
});

// Health check endpoint
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

// Serve JavaScript files
app.get('/admin.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'admin.js'));
});

app.get('/admin-login.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'admin-login.js'));
});

// Static files
app.use(express.static(path.join(__dirname)));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.get('/admin', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// 404 handler for API routes
app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Initialize and start server
initializeDB().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`=== SERVER STARTING ===`);
        console.log(`Environment: ${NODE_ENV}`);
        console.log(`Server running on port ${PORT}`);
        console.log(`Database path: ${dbPath}`);
        console.log(`Trust proxy: ${app.get('trust proxy')}`);
        console.log(`Secure cookies: ${isProduction}`);
        console.log(`Brute force protection: ENABLED (${MAX_ATTEMPTS} attempts)`);
        console.log(`WebSocket chat server: READY`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});