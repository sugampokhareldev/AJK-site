
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

module.exports = (app) => {
    const isProduction = process.env.NODE_ENV === 'production';

    app.use(cors({
        origin: function (origin, callback) {
            if (!origin) return callback(null, true);
            
            const allowedOrigins = [
                'https://ajk-cleaning.onrender.com',
                'http://localhost:3000',
                'http://127.0.0.1:3000',
                'http://localhost:3001',
                'http://127.0.0.1:3001',
                'https://www.ajkcleaners.de'
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

    const apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
      skip: (req) => {
        // Skip rate limiting for admin endpoints if user is authenticated
        return req.path.startsWith('/api/admin') && req.session.authenticated;
      }
    });

    app.use('/api/', apiLimiter);

    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // Limit each IP to 5 login attempts per windowMs
      message: 'Too many login attempts, please try again later.',
      skip: (req) => {
        // Skip if already authenticated
        return req.session.authenticated;
      }
    });

    app.use('/api/admin/login', loginLimiter);

    app.use(express.static(path.join(__dirname, '..'), {
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

    if (isProduction) {
        app.use(morgan('combined'));
    } else {
        app.use(morgan('dev'));
    }

    app.use(helmet());
};
