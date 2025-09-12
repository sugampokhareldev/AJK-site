// Load environment variables
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const crypto = require('crypto');
const fs = require('fs');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Trust Render's proxy (CRITICAL for secure cookies)
app.set('trust proxy', 1);

// Use environment secret or generate one
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');

// Environment-specific settings
const isProduction = NODE_ENV === 'production';

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
    await db.read();
    
    // Check if data is corrupted
    if (typeof db.data !== 'object' || db.data === null) {
      console.log('Database corrupted, resetting to default...');
      db.data = { submissions: [], admin_users: [] };
      await db.write();
    }
    
    db.data = db.data || { submissions: [], admin_users: [] };
    
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
    } else {
      console.log('Admin user already exists');
    }
    
    console.log('Database ready at:', dbPath);
    
  } catch (error) {
    console.error('Database initialization error:', error);
    console.log('Creating fresh database...');
    
    // Create fresh database
    db.data = { submissions: [], admin_users: [] };
    
    // Create admin user
    const hash = await bcrypt.hash('Sugam@2008', 12);
    db.data.admin_users.push({
      id: Date.now(),
      username: 'Sanud119@gmail.com',
      password_hash: hash,
      created_at: new Date().toISOString()
    });
    
    await db.write();
    console.log('Fresh database created successfully');
  }
}

// CORS configuration for Render
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://ajk-cleaning.onrender.com',
            'http://localhost:3000',
            'http://127.0.0.1:3000'
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Set-Cookie']
}));

// Handle preflight requests
app.options('*', cors());

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Updated CSP middleware to allow external resources
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://gc.kis.v2.scr.kaspersky.com; " +
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.tailwindcss.com https://gc.kis.v2.scr.kaspersky.com; " +
    "img-src 'self' data: https: blob: https://images.unsplash.com https://randomuser.me https://gc.kis.v2.scr.kaspersky.com; " +
    "font-src 'self' https://cdnjs.cloudflare.com; " +
    "connect-src 'self' ws://gc.kis.v2.scr.kaspersky.com; " +
    "frame-src 'self' https://gc.kis.v2.scr.kaspersky.com;"
  );
  next();
});

// Session configuration for Render production
app.use(session({
    secret: SESSION_SECRET,
    resave: true,
    saveUninitialized: false,
    store: new FileStore({
        path: path.join(__dirname, 'sessions'),
        ttl: 86400 // 24 hours
    }),
    cookie: { 
        secure: isProduction, // true in production
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax', // CRITICAL: 'none' for cross-site
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Test endpoint to check session
app.get('/api/test', (req, res) => {
    res.json({
        authenticated: !!req.session.authenticated,
        sessionId: req.sessionID,
        environment: NODE_ENV,
        port: PORT,
        secureCookie: req.session.cookie.secure
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

// Login endpoint
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password required' });
    }
    
    await db.read();
    const user = db.data.admin_users.find(u => u.username === username);
    
    if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    const result = await bcrypt.compare(password, user.password_hash);
    
    if (result) {
        req.session.authenticated = true;
        req.session.user = { id: user.id, username: user.username };
        res.json({ success: true, message: 'Login successful' });
    } else {
        res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
});

// Logout endpoint
app.post('/api/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
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

// Form submission endpoint
app.post('/api/form/submit', async (req, res) => {
    const { name, email, phone, message } = req.body;
    
    if (!name || !email || !message) {
        return res.status(400).json({ success: false, error: 'Name, email, and message are required' });
    }
    
    await db.read();
    const submission = {
        id: Date.now(),
        name,
        email,
        phone: phone || '',
        message,
        submitted_at: new Date().toISOString()
    };
    
    db.data.submissions.push(submission);
    await db.write();
    
    res.json({ success: true, id: submission.id });
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
        
        const todaySubmissions = submissions.filter(s => 
            new Date(s.submitted_at) >= today
        );
        
        const weekSubmissions = submissions.filter(s => 
            new Date(s.submitted_at) >= weekAgo
        );
        
        res.json({
            total: submissions.length,
            today: todaySubmissions.length,
            week: weekSubmissions.length
        });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error' });
    }
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

// Initialize and start server
initializeDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Environment: ${NODE_ENV}`);
        console.log(`Database path: ${dbPath}`);
        console.log(`Trust proxy: ${app.get('trust proxy')}`);
        console.log(`Secure cookies: ${isProduction}`);
        console.log(`Server ready for form submissions`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});