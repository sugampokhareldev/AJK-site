const Joi = require('joi');
const logger = require('../config/logger');

// Validation schemas
const schemas = {
    // Form submission validation
    formSubmission: Joi.object({
        name: Joi.string()
            .trim()
            .min(2)
            .max(100)
            .required()
            .messages({
                'string.empty': 'Name is required',
                'string.min': 'Name must be at least 2 characters long',
                'string.max': 'Name cannot exceed 100 characters'
            }),
        
        email: Joi.string()
            .email()
            .required()
            .messages({
                'string.email': 'Please provide a valid email address',
                'string.empty': 'Email is required'
            }),
        
        phone: Joi.string()
            .trim()
            .pattern(/^[\+]?[1-9][\d]{0,15}$/)
            .allow('')
            .messages({
                'string.pattern.base': 'Please provide a valid phone number'
            }),
        
        service: Joi.string()
            .trim()
            .max(100)
            .allow('')
            .messages({
                'string.max': 'Service selection cannot exceed 100 characters'
            }),
        
        message: Joi.string()
            .trim()
            .min(10)
            .max(1000)
            .required()
            .messages({
                'string.empty': 'Message is required',
                'string.min': 'Message must be at least 10 characters long',
                'string.max': 'Message cannot exceed 1000 characters'
            })
    }),

    // Admin login validation
    adminLogin: Joi.object({
        username: Joi.string()
            .email()
            .required()
            .messages({
                'string.email': 'Username must be a valid email address',
                'string.empty': 'Username is required'
            }),
        
        password: Joi.string()
            .min(6)
            .required()
            .messages({
                'string.empty': 'Password is required',
                'string.min': 'Password must be at least 6 characters long'
            }),
        
        sessionId: Joi.string()
            .optional(),
        
        deviceType: Joi.string()
            .optional()
    }),

    // Chat message validation
    chatMessage: Joi.object({
        type: Joi.string()
            .valid('chat', 'typing', 'identify', 'get_history', 'get_clients', 'admin_message', 'broadcast', 'ping')
            .required(),
        
        message: Joi.string()
            .trim()
            .max(500)
            .when('type', {
                is: 'chat',
                then: Joi.required(),
                otherwise: Joi.optional()
            }),
        
        text: Joi.string()
            .trim()
            .max(500)
            .optional(),
        
        name: Joi.string()
            .trim()
            .max(50)
            .optional(),
        
        email: Joi.string()
            .email()
            .optional(),
        
        isTyping: Joi.boolean()
            .when('type', {
                is: 'typing',
                then: Joi.required(),
                otherwise: Joi.optional()
            }),
        
        clientId: Joi.string()
            .optional(),
        
        targetClientId: Joi.string()
            .when('type', {
                is: 'admin_message',
                then: Joi.required(),
                otherwise: Joi.optional()
            }),
        
        sessionId: Joi.string()
            .optional(),
        
        isAdmin: Joi.boolean()
            .optional()
    })
};

// Validation middleware factory
const validate = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errorDetails = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));

            logger.warn('Validation error', {
                path: req.path,
                method: req.method,
                ip: req.ip,
                errors: errorDetails
            });

            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errorDetails
            });
        }

        // Replace req.body with validated and sanitized data
        req.body = value;
        next();
    };
};

// WebSocket message validation
const validateWebSocketMessage = (data) => {
    const { error, value } = schemas.chatMessage.validate(data, {
        abortEarly: false,
        stripUnknown: true
    });

    if (error) {
        const errorDetails = error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
        }));

        logger.warn('WebSocket validation error', {
            errors: errorDetails,
            originalData: data
        });

        return { isValid: false, errors: errorDetails };
    }

    return { isValid: true, data: value };
};

// Export validation middleware and schemas
module.exports = {
    validate,
    validateWebSocketMessage,
    schemas,
    
    // Pre-configured middleware
    validateFormSubmission: validate(schemas.formSubmission),
    validateAdminLogin: validate(schemas.adminLogin)
};
