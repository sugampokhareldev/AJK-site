
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const crypto = require('crypto');

module.exports = (app) => {
    const isProduction = process.env.NODE_ENV === 'production';

    let SESSION_SECRET = process.env.SESSION_SECRET;
    if (!SESSION_SECRET) {
        if (isProduction) {
            throw new Error('CRITICAL: SESSION_SECRET environment variable is not set for production.');
        }
        SESSION_SECRET = crypto.randomBytes(64).toString('hex');
    }

    app.use(session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        store: new FileStore({
            path: path.join(__dirname, '..', 'sessions'),
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
};
