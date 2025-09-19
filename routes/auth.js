const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

// Login endpoint
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        
        console.log('Login attempt from IP:', ip, 'Username:', username);
        
        if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ success: false, error: 'Username and password required' });
        }
        
        // Get security functions from app context
        const security = req.app.get('security');
        
        if (security.isIpLocked(ip)) {
            const attemptData = security.loginAttempts.get(ip);
            const remainingTime = Math.ceil((attemptData.lockedUntil - Date.now()) / 60000);
            return res.status(429).json({ 
                success: false, 
                error: `Too many failed attempts. Account locked for ${remainingTime} minutes.` 
            });
        }
        
        const db = req.app.get('db');
        await db.read();
        const user = db.data.admin_users.find(u => u.username === username);
        
        if (!user) {
            const attemptData = security.recordFailedAttempt(ip);
            const remainingAttempts = security.getRemainingAttempts(ip);
            
            console.log(`Failed login attempt - User not found: ${username}, IP: ${ip}`);
            
            return res.status(401).json({ 
                success: false, 
                error: `Invalid credentials. ${remainingAttempts} attempts remaining.`,
                remainingAttempts: remainingAttempts
            });
        }
        
        const result = await bcrypt.compare(password, user.password_hash);
        
        if (result) {
            security.loginAttempts.delete(ip);
            
            req.session.authenticated = true;
            req.session.user = { id: user.id, username: user.username };
            
            console.log('Successful login from IP:', ip, 'User:', username);
            res.json({ 
                success: true, 
                message: 'Login successful',
                user: { id: user.id, username: user.username }
            });
        } else {
            const attemptData = security.recordFailedAttempt(ip);
            const remainingAttempts = security.getRemainingAttempts(ip);
            
            console.log(`Failed login attempt from IP: ${ip}, Username: ${username}, Attempts: ${attemptData.count}/${security.MAX_ATTEMPTS}`);
            
            res.status(401).json({ 
                success: false, 
                error: `Invalid credentials. ${remainingAttempts} attempts remaining.`,
                remainingAttempts: remainingAttempts
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Other auth endpoints
router.get('/login-attempts', (req, res) => {   
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const security = req.app.get('security');
    const attemptData = security.loginAttempts.get(ip);
    const remainingAttempts = security.getRemainingAttempts(ip);
    
    res.json({
        ip: ip,
        remainingAttempts: remainingAttempts,
        isLocked: attemptData ? attemptData.lockedUntil > Date.now() : false,
        lockedUntil: attemptData ? attemptData.lockedUntil : null,
        attemptCount: attemptData ? attemptData.count : 0
    });
});

router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logout successful' });
    });
});

router.get('/status', (req, res) => {
    res.json({ 
        authenticated: !!(req.session && req.session.authenticated),
        user: req.session ? req.session.user : null
    });
});

module.exports = router;