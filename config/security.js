const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');

// Environment-based configuration
const isProduction = process.env.NODE_ENV === 'production';

// Security headers configuration
const helmetConfig = {
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'", // Required for Tailwind CSS
                "'unsafe-eval'", // Required for some dynamic features
                "https://cdn.tailwindcss.com",
                "https://cdnjs.cloudflare.com"
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'", // Required for inline styles
                "https://cdn.tailwindcss.com",
                "https://cdnjs.cloudflare.com",
                "https://fonts.googleapis.com"
            ],
            imgSrc: [
                "'self'",
                "data:",
                "https:",
                "blob:",
                "https://images.unsplash.com",
                "https://randomuser.me"
            ],
            fontSrc: [
                "'self'",
                "https://cdnjs.cloudflare.com",
                "https://fonts.gstatic.com"
            ],
            connectSrc: [
                "'self'",
                "ws:",
                "wss:"
            ],
            frameSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            workerSrc: ["'self'", "blob:"]
        }
    },
    crossOriginEmbedderPolicy: false, // Disable for compatibility
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
};

// Rate limiting configurations
const rateLimitConfigs = {
    // General API rate limiting
    api: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // Limit each IP to 100 requests per windowMs
        message: {
            error: 'Too many requests from this IP, please try again later.',
            retryAfter: '15 minutes'
        },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => {
            // Skip rate limiting for admin endpoints if user is authenticated
            return req.path.startsWith('/api/admin') && req.session?.authenticated;
        },
        handler: (req, res) => {
            logger.warn('Rate limit exceeded', {
                ip: req.ip,
                path: req.path,
                userAgent: req.get('User-Agent')
            });
            res.status(429).json({
                error: 'Too many requests from this IP, please try again later.',
                retryAfter: '15 minutes'
            });
        }
    }),

    // Stricter limiter for login attempts
    login: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
        message: {
            error: 'Too many login attempts, please try again later.',
            retryAfter: '15 minutes'
        },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => {
            // Skip if already authenticated
            return req.session?.authenticated;
        },
        handler: (req, res) => {
            logger.warn('Login rate limit exceeded', {
                ip: req.ip,
                username: req.body?.username,
                userAgent: req.get('User-Agent')
            });
            res.status(429).json({
                error: 'Too many login attempts, please try again later.',
                retryAfter: '15 minutes'
            });
        }
    }),

    // Form submission rate limiting
    form: rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 3, // Limit each IP to 3 form submissions per minute
        message: {
            error: 'Too many form submissions, please wait before submitting again.',
            retryAfter: '1 minute'
        },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            logger.warn('Form submission rate limit exceeded', {
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            res.status(429).json({
                success: false,
                error: 'Too many form submissions, please wait before submitting again.'
            });
        }
    })
};

// CORS configuration
const corsConfig = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = process.env.ALLOWED_ORIGINS 
            ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
            : [
                'https://ajk-cleaning.onrender.com',
                'http://localhost:3000',
                'http://127.0.0.1:3000',
                'http://localhost:3001',
                'http://127.0.0.1:3001',
                'https://www.ajkcleaners.de'
            ];
        
        if (allowedOrigins.indexOf(origin) !== -1 || 
            (!isProduction && origin.includes('localhost'))) {
            callback(null, true);
        } else {
            logger.warn('CORS blocked origin', { origin, ip: 'unknown' });
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Set-Cookie'],
    optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

// Session configuration
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'ajk.sid', // Change default session name
    cookie: { 
        secure: isProduction,
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        domain: isProduction ? '.onrender.com' : undefined
    }
};

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
    // Recursively sanitize all string inputs
    const sanitize = (obj) => {
        if (typeof obj === 'string') {
            return obj.trim().replace(/[<>]/g, ''); // Basic XSS prevention
        }
        if (typeof obj === 'object' && obj !== null) {
            for (const key in obj) {
                obj[key] = sanitize(obj[key]);
            }
        }
        return obj;
    };

    if (req.body) {
        req.body = sanitize(req.body);
    }
    if (req.query) {
        req.query = sanitize(req.query);
    }
    if (req.params) {
        req.params = sanitize(req.params);
    }

    next();
};

// Security middleware for WebSocket origins
const validateWebSocketOrigin = (origin) => {
    if (!origin) return true; // Allow requests with no origin
    
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
        ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
        : [
            'https://ajk-cleaning.onrender.com',
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:3001',
            'http://127.0.0.1:3001'
        ];
    
    return allowedOrigins.includes(origin) || 
           (!isProduction && origin.includes('localhost'));
};

module.exports = {
    helmetConfig,
    rateLimitConfigs,
    corsConfig,
    sessionConfig,
    sanitizeInput,
    validateWebSocketOrigin,
    isProduction
};
