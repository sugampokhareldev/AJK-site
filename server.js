// Load environment variables
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Use environment secret or generate one
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');

// Database path configuration for Render
const dbPath = process.env.DB_PATH || path.join(__dirname, 'submissions.db');
const dbDir = path.dirname(dbPath);

// Ensure the directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Database setup
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
  }
});

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));

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
    "connect-src 'self' http://localhost:3000 ws://gc.kis.v2.scr.kaspersky.com; " +
    "frame-src 'self' https://gc.kis.v2.scr.kaspersky.com;"
  );
  next();
});

// Session configuration - production ready
app.use(session({
    secret: SESSION_SECRET,
    resave: true,
    saveUninitialized: false,
    cookie: { 
        secure: NODE_ENV === 'production',
        httpOnly: true,
        sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Create tables
db.serialize(() => {
    // Create admin users table first
    db.run(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating admin_users table:', err);
        } else {
            console.log('Admin users table ready');
            
            // Create admin user
            const username = 'Sanud119@gmail.com';
            const password = 'Sugam@2008';
            
            // Check if user already exists
            db.get('SELECT * FROM admin_users WHERE username = ?', [username], (err, user) => {
                if (err) {
                    console.error('Error checking admin user:', err);
                    return;
                }
                
                if (!user) {
                    console.log('Creating admin user...');
                    bcrypt.hash(password, 12, (err, hash) => {
                        if (err) {
                            console.error('Error hashing password:', err);
                            return;
                        }
                        
                        db.run('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', 
                            [username, hash], function(err) {
                            if (err) {
                                console.error('Error creating admin user:', err);
                            } else {
                                console.log('Admin user created successfully with ID:', this.lastID);
                            }
                        });
                    });
                } else {
                    console.log('Admin user already exists');
                }
            });
        }
    });

    // Create submissions table
    db.run(`
        CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT,
            message TEXT,
            submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating submissions table:', err);
        } else {
            console.log('Submissions table ready');
        }
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
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password required' });
    }
    
    db.get('SELECT * FROM admin_users WHERE username = ?', [username], (err, user) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        bcrypt.compare(password, user.password_hash, (err, result) => {
            if (err) {
                console.error('Error comparing passwords:', err);
                return res.status(500).json({ success: false, error: 'Server error' });
            }
            
            if (result) {
                req.session.authenticated = true;
                req.session.user = { id: user.id, username: user.username };
                
                req.session.save((err) => {
                    if (err) {
                        return res.status(500).json({ success: false, error: 'Session error' });
                    }
                    res.json({ success: true, message: 'Login successful' });
                });
            } else {
                res.status(401).json({ success: false, error: 'Invalid credentials' });
            }
        });
    });
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
app.post('/api/form/submit', (req, res) => {
    const { name, email, message } = req.body;
    
    if (!name || !email || !message) {
        return res.status(400).json({ success: false, error: 'All fields required' });
    }
    
    const stmt = db.prepare('INSERT INTO submissions (name, email, message) VALUES (?, ?, ?)');
    stmt.run(name, email, message, function(err) {
        if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, id: this.lastID });
    });
    stmt.finalize();
});

// Protected API endpoints
app.get('/api/submissions', requireAuth, (req, res) => {
    db.all('SELECT * FROM submissions ORDER BY submitted_at DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
    });
});

// Get a specific submission (protected)
app.get('/api/submissions/:id', requireAuth, (req, res) => {
    const id = req.params.id;
    
    // Validate ID
    if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Invalid submission ID' });
    }
    
    db.get('SELECT * FROM submissions WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (!row) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        res.json(row);
    });
});

// Delete a submission (protected)
app.delete('/api/submissions/:id', requireAuth, (req, res) => {
    const id = req.params.id;
    
    // Validate ID
    if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Invalid submission ID' });
    }
    
    db.run('DELETE FROM submissions WHERE id = ?', [id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        res.json({ success: true, message: 'Submission deleted successfully' });
    });
});

// Get statistics (protected)
app.get('/api/statistics', requireAuth, (req, res) => {
    const queries = [
        'SELECT COUNT(*) as total FROM submissions',
        'SELECT COUNT(*) as today FROM submissions WHERE DATE(submitted_at) = DATE("now")',
        'SELECT COUNT(*) as week FROM submissions WHERE submitted_at >= DATE("now", "-7 days")'
    ];
    
    db.serialize(() => {
        db.get(queries[0], (err, totalResult) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            
            db.get(queries[1], (err, todayResult) => {
                if (err) return res.status(500).json({ error: 'Database error' });
                
                db.get(queries[2], (err, weekResult) => {
                    if (err) return res.status(500).json({ error: 'Database error' });
                    
                    res.json({
                        total: totalResult.total,
                        today: todayResult.today,
                        week: weekResult.week
                    });
                });
            });
        });
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

// 404 handler for API routes - Use regex pattern to avoid path-to-regexp error
app.all(/\/api\/.+/, (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
    console.log(`Database path: ${dbPath}`);
    console.log(`Main site: http://localhost:${PORT}/`);
    console.log(`Admin login: http://localhost:${PORT}/admin/login`);
});