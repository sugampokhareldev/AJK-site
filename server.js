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
const crypto = require('crypto');
const fs = require('fs');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const validator = require('validator');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const geoip = require('geoip-lite'); // Added for analytics
const helmet = require('helmet');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const { sendEmailWithFallback } = require('./utils/emailFallback');
const { sendEmailWithSendGrid } = require('./utils/sendgridService');
const { sendEmailViaWebhook } = require('./utils/webhookEmailService');

// Email configuration with timeout and connection settings
const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || process.env.ADMIN_EMAIL,
        pass: process.env.SMTP_PASS || process.env.ADMIN_PASSWORD
    },
    // Connection timeout settings for Render
    connectionTimeout: 60000, // 60 seconds
    greetingTimeout: 30000,   // 30 seconds
    socketTimeout: 60000,     // 60 seconds
    // Retry settings
    pool: true,
    maxConnections: 1,
    maxMessages: 3,
    rateDelta: 20000, // 20 seconds
    rateLimit: 5, // max 5 messages per rateDelta
    // TLS settings for better compatibility
    tls: {
        rejectUnauthorized: false
    }
});

// Verify email configuration
emailTransporter.verify((error, success) => {
    if (error) {
        console.log('❌ Email configuration error:', error.message);
        console.log('📧 Email notifications will be disabled until SMTP is configured');
    } else {
        console.log('✅ Email server is ready to send messages');
    }
});

// Function to send customized quote email to client
async function sendQuoteEmail(quoteData) {
    const {
        customerName,
        customerEmail,
        customerPhone,
        serviceType,
        propertySize,
        frequency,
        specialRequirements,
        preferredDate,
        preferredTime,
        salutation = 'Dear'
    } = quoteData;

    const quoteHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Quote Request Received - AJK Cleaning</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f4f4f4; }
                .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
                .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
                .header p { margin: 10px 0 0 0; font-size: 16px; opacity: 0.9; }
                .content { padding: 30px; }
                .quote-details { background: #f8f9fa; border-radius: 8px; padding: 25px; margin: 20px 0; }
                .detail-row { display: flex; justify-content: space-between; margin: 12px 0; padding: 8px 0; border-bottom: 1px solid #e9ecef; }
                .detail-row:last-child { border-bottom: none; }
                .detail-label { font-weight: bold; color: #495057; }
                .detail-value { color: #212529; }
                .next-steps { background: #e8f5e8; border-left: 4px solid #28a745; padding: 20px; margin: 20px 0; }
                .next-steps h3 { color: #155724; margin: 0 0 15px 0; }
                .step-list { margin: 0; padding-left: 20px; }
                .step-list li { margin: 8px 0; color: #155724; }
                .contact-info { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 20px; margin: 20px 0; }
                .contact-info h3 { color: #1976d2; margin: 0 0 15px 0; }
                .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; border-top: 1px solid #e9ecef; }
                .highlight { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin: 20px 0; }
                .highlight h3 { color: #856404; margin: 0 0 10px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📋 Quote Request Received</h1>
                    <p>AJK Cleaning Company - Professional Cleaning Services</p>
                </div>
                
                <div class="content">
                    <div class="highlight">
                        <h3>✅ Thank You for Your Interest!</h3>
                        <p>We have received your quote request and our team will prepare a customized proposal for your cleaning needs.</p>
                    </div>

                    <div class="quote-details">
                        <h3 style="margin-top: 0; color: #495057;">📋 Your Quote Request Details</h3>
                        <div class="detail-row">
                            <span class="detail-label">Service Type:</span>
                            <span class="detail-value">${serviceType}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Property Size:</span>
                            <span class="detail-value">${propertySize} sq ft</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Service Frequency:</span>
                            <span class="detail-value">${frequency}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Preferred Date:</span>
                            <span class="detail-value">${preferredDate || 'Flexible'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Preferred Time:</span>
                            <span class="detail-value">${preferredTime || 'Flexible'}</span>
                        </div>
                        ${specialRequirements ? `
                        <div class="detail-row">
                            <span class="detail-label">Special Requirements:</span>
                            <span class="detail-value">${specialRequirements}</span>
                        </div>
                        ` : ''}
                    </div>

                    <div class="next-steps">
                        <h3>🎯 What Happens Next?</h3>
                        <ul class="step-list">
                            <li><strong>Within 2 hours:</strong> Our team will review your requirements</li>
                            <li><strong>Within 24 hours:</strong> We will call you to discuss your needs</li>
                            <li><strong>Within 48 hours:</strong> You will receive a detailed, customized quote</li>
                            <li><strong>If needed:</strong> We can schedule a free on-site visit</li>
                        </ul>
                    </div>

                    <div class="contact-info">
                        <h3>📞 Our Commitment to You</h3>
                        <p style="margin: 0 0 10px 0;"><strong>Response Time:</strong> We guarantee to contact you within 2 hours</p>
                        <p style="margin: 0 0 10px 0;"><strong>Free Consultation:</strong> No obligation, completely free</p>
                        <p style="margin: 0 0 10px 0;"><strong>Transparent Pricing:</strong> No hidden fees, clear breakdown</p>
                        <p style="margin: 0 0 10px 0;"><strong>Quality Guarantee:</strong> 100% satisfaction or we'll make it right</p>
                    </div>

                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h4 style="margin-top: 0; color: #495057;">📞 Need Immediate Assistance?</h4>
                        <p style="margin: 5px 0;"><strong>Phone:</strong> +49 176 61852286</p>
                        <p style="margin: 5px 0;"><strong>Email:</strong> info@ajkcleaners.de</p>
                        <p style="margin: 5px 0;"><strong>Hours:</strong> Monday - Friday: 8:00 AM - 6:00 PM</p>
                    </div>
                </div>
                
                <div class="footer">
                    <p><strong>AJK Cleaning Company</strong> | Professional Cleaning Services</p>
                    <p>Thank you for choosing us for your cleaning needs!</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const quoteText = `
📋 QUOTE REQUEST RECEIVED - AJK Cleaning Company

Dear ${customerName},

Thank you for your interest in our professional cleaning services!

YOUR QUOTE REQUEST DETAILS:
Service Type: ${serviceType}
Property Size: ${propertySize} sq ft
Service Frequency: ${frequency}
Preferred Date: ${preferredDate || 'Flexible'}
Preferred Time: ${preferredTime || 'Flexible'}
${specialRequirements ? `Special Requirements: ${specialRequirements}` : ''}

WHAT HAPPENS NEXT:
1. Within 2 hours: Our team will review your requirements
2. Within 24 hours: We will call you to discuss your needs
3. Within 48 hours: You will receive a detailed, customized quote
4. If needed: We can schedule a free on-site visit

OUR COMMITMENT:
- Response Time: We guarantee to contact you within 2 hours
- Free Consultation: No obligation, completely free
- Transparent Pricing: No hidden fees, clear breakdown
- Quality Guarantee: 100% satisfaction or we'll make it right

CONTACT INFORMATION:
Phone: +49 176 61852286
Email: info@ajkcleaners.de
Hours: Monday - Friday: 8:00 AM - 6:00 PM

Thank you for choosing AJK Cleaning Company!

Best regards,
The AJK Cleaning Team
    `;

    const mailOptions = {
        from: `"AJK Cleaning Company" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
        to: customerEmail,
        subject: `📋 Quote Request Received - ${serviceType} Cleaning Service`,
        html: quoteHtml,
        text: quoteText
    };

    try {
        await emailTransporter.sendMail(mailOptions);
        console.log(`📧 Quote confirmation email sent to ${customerEmail}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send quote email to ${customerEmail}:`, error.message);
        throw error;
    }
}

// Function to send admin notification for any booking
async function sendAdminNotification(booking) {
    const { details } = booking;
    const {
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        city,
        postalCode,
        bookingType,
        package: packageType,
        date: bookingDate,
        time: bookingTime,
        duration,
        cleaners,
        propertySize,
        specialRequests,
        salutation
    } = details;

    // Get admin emails from environment variables
    const adminEmails = process.env.ADMIN_EMAILS ? 
        process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : 
        [
            process.env.NOTIFICATION_EMAIL || 'sugampokharel28@gmail.com',
            'Sanudhakal119@gmail.com'
        ];

    const adminHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Booking Alert - AJK Cleaning</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f4f4f4; }
                .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
                .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
                .header p { margin: 10px 0 0 0; font-size: 16px; opacity: 0.9; }
                .content { padding: 30px; }
                .alert { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin-bottom: 25px; }
                .alert h2 { color: #856404; margin: 0 0 10px 0; font-size: 20px; }
                .booking-details { background: #f8f9fa; border-radius: 8px; padding: 25px; margin: 20px 0; }
                .detail-row { display: flex; justify-content: space-between; margin: 12px 0; padding: 8px 0; border-bottom: 1px solid #e9ecef; }
                .detail-row:last-child { border-bottom: none; }
                .detail-label { font-weight: bold; color: #495057; }
                .detail-value { color: #212529; }
                .customer-info { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 20px; margin: 20px 0; }
                .service-info { background: #f3e5f5; border-left: 4px solid #9c27b0; padding: 20px; margin: 20px 0; }
                .action-required { background: #ffebee; border-left: 4px solid #f44336; padding: 20px; margin: 20px 0; }
                .action-required h3 { color: #c62828; margin: 0 0 15px 0; }
                .action-list { margin: 0; padding-left: 20px; }
                .action-list li { margin: 8px 0; color: #d32f2f; }
                .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; border-top: 1px solid #e9ecef; }
                .priority-high { color: #d32f2f; font-weight: bold; }
                .booking-id { background: #667eea; color: white; padding: 5px 10px; border-radius: 4px; font-family: monospace; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🚨 New Booking Alert</h1>
                    <p>AJK Cleaning Company - Admin Notification</p>
                </div>
                
                <div class="content">
                    <div class="alert">
                        <h2>⚠️ Immediate Action Required</h2>
                        <p>A new <strong>${bookingType === 'subscription' ? 'Subscription' : 'One-Time'}</strong> cleaning booking has been received and requires your attention.</p>
                    </div>

                    <div class="booking-details">
                        <h3 style="margin-top: 0; color: #495057;">📋 Booking Information</h3>
                        <div class="detail-row">
                            <span class="detail-label">Booking ID:</span>
                            <span class="detail-value booking-id">${booking.id}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Booking Type:</span>
                            <span class="detail-value priority-high">${bookingType === 'subscription' ? 'Subscription Service' : 'One-Time Cleaning'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Service Package:</span>
                            <span class="detail-value">${packageType}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Requested Date:</span>
                            <span class="detail-value">${bookingDate || 'To be scheduled'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Requested Time:</span>
                            <span class="detail-value">${bookingTime || 'To be scheduled'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Duration:</span>
                            <span class="detail-value">${duration} hours</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Cleaners Needed:</span>
                            <span class="detail-value">${cleaners}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Property Size:</span>
                            <span class="detail-value">${propertySize || 'Not specified'} sq ft</span>
                        </div>
                    </div>

                    <div class="customer-info">
                        <h3 style="margin-top: 0; color: #1976d2;">👤 Customer Information</h3>
                        <div class="detail-row">
                            <span class="detail-label">Name:</span>
                            <span class="detail-value">${salutation} ${customerName}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Email:</span>
                            <span class="detail-value">${customerEmail}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Phone:</span>
                            <span class="detail-value">${customerPhone}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Address:</span>
                            <span class="detail-value">${customerAddress}, ${city} ${postalCode}</span>
                        </div>
                    </div>

                    ${specialRequests ? `
                    <div class="service-info">
                        <h3 style="margin-top: 0; color: #7b1fa2;">📝 Special Requirements</h3>
                        <p style="margin: 0; font-style: italic;">"${specialRequests}"</p>
                    </div>
                    ` : ''}

                    <div class="action-required">
                        <h3>🎯 Required Actions</h3>
                        <ul class="action-list">
                            <li>Contact customer within 2 hours</li>
                            <li>Confirm booking details and schedule</li>
                            <li>Provide accurate pricing quote</li>
                            <li>Schedule site visit if needed</li>
                            <li>Update booking status in admin panel</li>
                        </ul>
                    </div>

                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h4 style="margin-top: 0; color: #495057;">📞 Quick Contact</h4>
                        <p style="margin: 5px 0;"><strong>Customer:</strong> ${customerName} - ${customerPhone}</p>
                        <p style="margin: 5px 0;"><strong>Email:</strong> ${customerEmail}</p>
                        <p style="margin: 5px 0;"><strong>Booking Time:</strong> ${new Date().toLocaleString()}</p>
                    </div>
                </div>
                
                <div class="footer">
                    <p><strong>AJK Cleaning Company</strong> | Admin Notification System</p>
                    <p>This is an automated notification. Please respond promptly to maintain customer satisfaction.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const adminText = `
🚨 NEW BOOKING ALERT - AJK Cleaning Company

Booking ID: ${booking.id}
Booking Type: ${bookingType === 'subscription' ? 'Subscription Service' : 'One-Time Cleaning'}
Service: ${packageType}
Date: ${bookingDate || 'To be scheduled'}
Time: ${bookingTime || 'To be scheduled'}
Duration: ${duration} hours
Cleaners: ${cleaners}

CUSTOMER DETAILS:
Name: ${salutation} ${customerName}
Email: ${customerEmail}
Phone: ${customerPhone}
Address: ${customerAddress}, ${city} ${postalCode}
Property Size: ${propertySize || 'Not specified'} sq ft

${specialRequests ? `Special Requirements: ${specialRequests}` : ''}

REQUIRED ACTIONS:
1. Contact customer within 2 hours
2. Confirm booking details and schedule
3. Provide accurate pricing quote
4. Schedule site visit if needed
5. Update booking status in admin panel

Booking received: ${new Date().toLocaleString()}
    `;

    // Send to all admin emails
    for (const adminEmail of adminEmails) {
        try {
            const adminMailOptions = {
                from: `"AJK Cleaning System" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
                to: adminEmail,
                subject: `🚨 New ${bookingType === 'subscription' ? 'Subscription' : 'One-Time'} Booking - ${booking.id}`,
                html: adminHtml,
                text: adminText
            };

            await emailTransporter.sendMail(adminMailOptions);
            console.log(`📧 Admin notification sent to ${adminEmail} for booking ${booking.id}`);
        } catch (error) {
            console.error(`❌ Failed to send admin notification to ${adminEmail}:`, error.message);
        }
    }
}

// Function to send commercial booking confirmation with retry logic
async function sendCommercialBookingConfirmation(booking) {
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
        try {
        console.log(`[COMMERCIAL EMAIL] 🚀 Starting email send for booking:`, booking.id);
        const details = booking.details || {};
        const customerName = details.customerName || 'Valued Customer';
        const customerEmail = details.customerEmail;
        console.log(`[COMMERCIAL EMAIL] 📧 Sending to:`, customerEmail);
        const bookingDate = details.date || 'TBD';
        const bookingTime = details.time || 'TBD';
        const packageType = details.package || 'Commercial Cleaning';
        const duration = details.duration || 0;
        const cleaners = details.cleaners || 1;
        const specialRequests = details.specialRequests || 'None';
        const propertySize = details.propertySize || 'Not specified';

        const confirmationHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Commercial Booking Request - AJK Cleaning</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; }
                .booking-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .status { background: #fbbf24; color: #92400e; padding: 15px; border-radius: 8px; text-align: center; font-size: 16px; font-weight: bold; }
                .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
                .highlight { background: #eff6ff; padding: 15px; border-left: 4px solid #3b82f6; margin: 15px 0; }
                .consultation { background: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🏢 AJK Cleaning Company</h1>
                <h2>Commercial Booking Request</h2>
            </div>
            
            <div class="content">
                <p>Dear ${customerName},</p>
                
                <p>Thank you for your commercial cleaning inquiry! We have received your request and will contact you shortly to discuss your specific needs and provide a customized quote.</p>
                
                <div class="status">
                    📞 Consultation Required - We will contact you within 24 hours
                </div>
                
                <div class="booking-details">
                    <h3>📋 Your Request Details</h3>
                    <p><strong>Request ID:</strong> ${booking.id}</p>
                    <p><strong>Service Type:</strong> ${packageType}</p>
                    <p><strong>Preferred Date:</strong> ${bookingDate}</p>
                    <p><strong>Preferred Time:</strong> ${bookingTime}</p>
                    <p><strong>Property Size:</strong> ${propertySize} sq ft</p>
                    <p><strong>Estimated Duration:</strong> ${duration} hours</p>
                    <p><strong>Number of Cleaners:</strong> ${cleaners}</p>
                </div>
                
                ${specialRequests !== 'None' ? `
                <div class="highlight">
                    <h3>📝 Special Requirements</h3>
                    <p>${specialRequests}</p>
                </div>
                ` : ''}
                
                <div class="consultation">
                    <h3>💼 Next Steps</h3>
                    <p><strong>1. We will call you within 24 hours</strong> to discuss your specific needs</p>
                    <p><strong>2. We will provide a detailed quote</strong> based on your requirements</p>
                    <p><strong>3. We will schedule a site visit</strong> if needed for accurate pricing</p>
                    <p><strong>4. We will confirm the final details</strong> and schedule your cleaning</p>
                </div>
                
                <div class="highlight">
                    <h3>📞 Contact Information</h3>
                    <p><strong>Phone:</strong> +49 176 61852286</p>
                    <p><strong>Email:</strong> info@ajkcleaners.de</p>
                    <p><strong>Website:</strong> https://ajkcleaners.de</p>
                </div>
                
                <p>We look forward to providing you with professional commercial cleaning services!</p>
                
                <p>Best regards,<br>
                <strong>AJK Cleaning Team</strong></p>
            </div>
            
            <div class="footer">
                <p>AJK Cleaning Company | Professional Commercial Cleaning Services</p>
                <p>This is an automated confirmation. We will contact you soon!</p>
            </div>
        </body>
        </html>
        `;

        const mailOptions = {
            from: `"AJK Cleaning Company" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
            to: customerEmail,
            subject: `🏢 Commercial Cleaning Request Received - ${booking.id}`,
            html: confirmationHtml,
            text: `
Commercial Cleaning Request - AJK Cleaning Company

Dear ${customerName},

Thank you for your commercial cleaning inquiry!

Request ID: ${booking.id}
Service: ${packageType}
Date: ${bookingDate}
Time: ${bookingTime}
Property Size: ${propertySize} sq ft
Duration: ${duration} hours
Cleaners: ${cleaners}

Special Requirements: ${specialRequests}

NEXT STEPS:
1. We will call you within 24 hours
2. We will provide a detailed quote
3. We will schedule a site visit if needed
4. We will confirm final details

Contact: +49 176 61852286 | info@ajkcleaners.de

We look forward to serving your commercial cleaning needs!
            `
        };

        console.log(`[COMMERCIAL EMAIL] 📤 Attempting to send email... (Attempt ${retryCount + 1}/${maxRetries})`);
        
        // Try multiple email services in order of preference
        let emailSent = false;
        
        // Try 1: SendGrid (if configured)
        if (process.env.SENDGRID_API_KEY && !emailSent) {
            try {
                console.log('📧 Trying SendGrid...');
                await sendEmailWithSendGrid(mailOptions);
                console.log(`✅ Commercial booking confirmation sent via SendGrid to ${customerEmail} for request ${booking.id}`);
                emailSent = true;
            } catch (sendGridError) {
                console.log('❌ SendGrid failed:', sendGridError.message);
            }
        }
        
        // Try 2: Webhook service (if configured)
        if (!emailSent && (process.env.EMAILJS_SERVICE_ID || process.env.FORMSPREE_ENDPOINT || process.env.NETLIFY_FORMS_ENDPOINT)) {
            try {
                console.log('📧 Trying webhook email service...');
                await sendEmailViaWebhook(mailOptions);
                console.log(`✅ Commercial booking confirmation sent via webhook to ${customerEmail} for request ${booking.id}`);
                emailSent = true;
            } catch (webhookError) {
                console.log('❌ Webhook email service failed:', webhookError.message);
            }
        }
        
        // Try 3: Fallback email service
        if (!emailSent) {
            try {
                console.log('📧 Trying fallback email service...');
                const fallbackResult = await sendEmailWithFallback(mailOptions, 2);
                if (fallbackResult) {
                    console.log(`✅ Commercial booking confirmation sent via fallback to ${customerEmail} for request ${booking.id}`);
                    emailSent = true;
                } else {
                    console.log('❌ Fallback email service failed - no working configuration');
                }
            } catch (fallbackError) {
                console.log('❌ Fallback email service failed:', fallbackError.message);
            }
        }
        
        // Try 4: Primary transporter (last resort)
        if (!emailSent) {
            try {
                console.log('📧 Trying primary transporter...');
                await emailTransporter.sendMail(mailOptions);
                console.log(`✅ Commercial booking confirmation sent via primary to ${customerEmail} for request ${booking.id}`);
                emailSent = true;
            } catch (primaryError) {
                console.log('❌ Primary transporter failed:', primaryError.message);
                // Don't throw error here - let it fail gracefully
            }
        }
        
        if (emailSent) {
            console.log(`📧 Email details: From ${process.env.SMTP_USER || process.env.ADMIN_EMAIL} to ${customerEmail}`);
            
            // Send admin notification email
            try {
                await sendAdminNotification(booking);
                console.log(`📧 Admin notification sent for booking ${booking.id}`);
            } catch (adminError) {
                console.error(`❌ Failed to send admin notification:`, adminError.message);
                // Don't fail the main email process if admin notification fails
            }
            
            return; // Success - exit the retry loop
        } else {
            // All email services failed - exit gracefully instead of throwing error
            console.log('❌ All email services failed - booking will continue without email notification');
            return;
        }
        
    } catch (error) {
        retryCount++;
        console.error(`❌ Failed to send commercial booking confirmation (Attempt ${retryCount}/${maxRetries}):`, error.message);
        
        if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 2s, 4s, 8s
            console.log(`⏳ Retrying in ${delay/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        } else {
            console.error('❌ All retry attempts failed for commercial booking confirmation - continuing without email');
            return; // Exit gracefully instead of throwing error
        }
    }
    }
}

// Function to send employee payslip
async function sendEmployeePayslip(employee, month, year) {
    try {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = monthNames[parseInt(month) - 1];
        
        // Calculate comprehensive payroll
        const grossSalary = parseFloat(employee.salary);
        
        // Tax calculations (simplified)
        const federalTaxRate = 0.15; // 15% federal tax
        const stateTaxRate = 0.05;   // 5% state tax
        const socialSecurityRate = 0.062; // 6.2% social security
        // Medicare removed as requested
        
        // Check if custom tax amount is provided
        const customTaxAmount = parseFloat(employee.customTax) || 0;
        
        let federalTax, stateTax, socialSecurity;
        
        if (customTaxAmount > 0) {
            // Use custom tax amount instead of percentage calculations
            federalTax = customTaxAmount;
            stateTax = 0;
            socialSecurity = 0;
        } else {
            // Use percentage-based calculations
            federalTax = grossSalary * federalTaxRate;
            stateTax = grossSalary * stateTaxRate;
            socialSecurity = grossSalary * socialSecurityRate;
        }
        
        // Use actual employee deduction data
        const penalties = parseFloat(employee.penalties) || 0;
        const absences = parseFloat(employee.absences) || 0;
        const otherDeductions = parseFloat(employee.otherDeductions) || 0;
        
        const totalTaxes = federalTax + stateTax + socialSecurity;
        const totalDeductions = totalTaxes + penalties + absences + otherDeductions;
        const netSalary = grossSalary - totalDeductions;
        
        const payslipHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Payslip - ${monthName} ${year}</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; }
                .payslip-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .salary-breakdown { background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .net-salary { background: #10b981; color: white; padding: 20px; border-radius: 8px; text-align: center; font-size: 24px; font-weight: bold; margin: 20px 0; }
                .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
                .highlight { background: #eff6ff; padding: 15px; border-left: 4px solid #3b82f6; margin: 15px 0; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🧾 AJK Cleaning Company</h1>
                <h2>Monthly Payslip - ${monthName} ${year}</h2>
            </div>
            
            <div class="content">
                <p>Dear ${employee.name},</p>
                
                <p>Please find your payslip for ${monthName} ${year} below. This document contains your salary breakdown and tax information.</p>
                
                <div class="payslip-details">
                    <h3>📋 Employee Details</h3>
                    <p><strong>Employee ID:</strong> ${employee.id}</p>
                    <p><strong>Name:</strong> ${employee.name}</p>
                    <p><strong>Job Title:</strong> ${employee.jobTitle}</p>
                    <p><strong>SSN:</strong> ${employee.ssn || 'Not provided'}</p>
                    <p><strong>Tax ID:</strong> ${employee.taxId || 'Not provided'}</p>
                    <p><strong>Pay Period:</strong> ${monthName} ${year}</p>
                    <p><strong>Date Generated:</strong> ${new Date().toLocaleDateString()}</p>
                </div>
                
                <div class="salary-breakdown">
                    <h3>💰 Salary Breakdown</h3>
                    
                    <h4>📈 Earnings</h4>
                    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                        <span>Gross Salary:</span>
                        <span>€${grossSalary.toFixed(2)}</span>
                    </div>
                    
                    <h4>📉 Deductions</h4>
                    ${customTaxAmount > 0 ? `
                    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                        <span>Custom Tax Amount:</span>
                        <span>-€${federalTax.toFixed(2)}</span>
                    </div>
                    ` : `
                    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                        <span>Federal Tax (${(federalTaxRate * 100).toFixed(1)}%):</span>
                        <span>-€${federalTax.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                        <span>State Tax (${(stateTaxRate * 100).toFixed(1)}%):</span>
                        <span>-€${stateTax.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                        <span>Social Security (${(socialSecurityRate * 100).toFixed(1)}%):</span>
                        <span>-€${socialSecurity.toFixed(2)}</span>
                    </div>
                    `}
                    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                        <span>Penalties:</span>
                        <span>-€${penalties.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                        <span>Absences:</span>
                        <span>-€${absences.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                        <span>Other Deductions:</span>
                        <span>-€${otherDeductions.toFixed(2)}</span>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; margin: 10px 0; font-weight: bold; border-top: 2px solid #333; padding-top: 10px;">
                        <span>Total Deductions:</span>
                        <span>-€${totalDeductions.toFixed(2)}</span>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; margin: 10px 0; font-weight: bold; border-top: 2px solid #333; padding-top: 10px; font-size: 1.2em; color: #2d5a27;">
                        <span>Net Salary:</span>
                        <span>€${netSalary.toFixed(2)}</span>
                    </div>
                </div>
                
                <div class="net-salary">
                    Net Pay: €${netSalary.toFixed(2)}
                </div>
                
                <div class="highlight">
                    <h3>📞 Contact Information</h3>
                    <p><strong>HR Department:</strong> +49 176 61852286</p>
                    <p><strong>Email:</strong> info@ajkcleaners.de</p>
                    <p><strong>Website:</strong> https://ajkcleaners.de</p>
                </div>
                
                <p>Thank you for your hard work and dedication to AJK Cleaning Company!</p>
                
                <p>Best regards,<br>
                <strong>AJK Cleaning HR Team</strong></p>
            </div>
            
            <div class="footer">
                <p>AJK Cleaning Company | Professional Cleaning Services</p>
                <p>This is an automated payslip. Please keep this for your records.</p>
            </div>
        </body>
        </html>
        `;

        const mailOptions = {
            from: `"AJK Cleaning HR" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
            to: employee.email,
            subject: `🧾 Payslip - ${monthName} ${year} - ${employee.name}`,
            html: payslipHtml,
            text: `
Payslip - ${monthName} ${year}

Dear ${employee.name},

Your payslip for ${monthName} ${year}:

Employee ID: ${employee.id}
Job Title: ${employee.jobTitle}
SSN: ${employee.ssn || 'Not provided'}
Tax ID: ${employee.taxId || 'Not provided'}
Pay Period: ${monthName} ${year}

SALARY BREAKDOWN:

EARNINGS:
Gross Salary: €${grossSalary.toFixed(2)}

DEDUCTIONS:
${customTaxAmount > 0 ? 
`Custom Tax Amount: -€${federalTax.toFixed(2)}` : 
`Federal Tax (${(federalTaxRate * 100).toFixed(1)}%): -€${federalTax.toFixed(2)}
State Tax (${(stateTaxRate * 100).toFixed(1)}%): -€${stateTax.toFixed(2)}
Social Security (${(socialSecurityRate * 100).toFixed(1)}%): -€${socialSecurity.toFixed(2)}`}
Penalties: -€${penalties.toFixed(2)}
Absences: -€${absences.toFixed(2)}
Other Deductions: -€${otherDeductions.toFixed(2)}

Total Deductions: -€${totalDeductions.toFixed(2)}
Net Salary: €${netSalary.toFixed(2)}

Contact: +49 176 61852286 | info@ajkcleaners.de

Thank you for your hard work!
AJK Cleaning HR Team
            `
        };

        try {
            await emailTransporter.sendMail(mailOptions);
            console.log(`✅ Payslip sent to ${employee.email} for ${monthName} ${year}`);
            
            // Record payment in employee's payment history
            if (!employee.paymentHistory) {
                employee.paymentHistory = [];
            }
            
            const paymentRecord = {
                month: parseInt(month) - 1, // Convert to 0-based month
                year: parseInt(year),
                amount: netSalary,
                date: new Date().toISOString(),
                payslipSent: true
            };
            
            // Check if payment already exists for this month/year
            const existingPayment = employee.paymentHistory.find(p => 
                p.month === paymentRecord.month && p.year === paymentRecord.year
            );
            
            if (!existingPayment) {
                employee.paymentHistory.push(paymentRecord);
                console.log(`📝 Payment recorded for ${employee.name} - ${monthName} ${year}`);
                
                // Update the database
                const db = new Low(adapter);
                await db.read();
                const employeeIndex = db.data.employees.findIndex(emp => emp.id === employee.id);
                if (employeeIndex !== -1) {
                    db.data.employees[employeeIndex] = employee;
                    await db.write();
                    console.log(`💾 Database updated with payment record for ${employee.name}`);
                }
            }
            
        } catch (emailError) {
            console.error(`❌ Failed to send payslip to ${employee.email}:`, emailError.message);
            throw emailError;
        }
        
        // Send a copy to admin for testing
        try {
            const adminCopyOptions = {
                from: `"AJK Cleaning HR" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
                to: process.env.ADMIN_EMAIL,
                subject: `📋 Payslip Copy - ${employee.name} - ${monthName} ${year}`,
                html: payslipHtml,
                text: `
Payslip Copy - ${monthName} ${year}
Employee: ${employee.name}
Email: ${employee.email}
SSN: ${employee.ssn || 'Not provided'}
Tax ID: ${employee.taxId || 'Not provided'}

EARNINGS:
Gross Salary: €${grossSalary.toFixed(2)}

DEDUCTIONS:
${customTaxAmount > 0 ? 
`Custom Tax Amount: -€${federalTax.toFixed(2)}` : 
`Federal Tax: -€${federalTax.toFixed(2)}
State Tax: -€${stateTax.toFixed(2)}
Social Security: -€${socialSecurity.toFixed(2)}`}
Penalties: -€${penalties.toFixed(2)}
Absences: -€${absences.toFixed(2)}
Other Deductions: -€${otherDeductions.toFixed(2)}

Total Deductions: -€${totalDeductions.toFixed(2)}
Net Salary: €${netSalary.toFixed(2)}
                `
            };
            
            await emailTransporter.sendMail(adminCopyOptions);
            console.log(`✅ Payslip copy sent to admin (${process.env.ADMIN_EMAIL})`);
        } catch (adminEmailError) {
            console.error(`❌ Failed to send payslip copy to admin:`, adminEmailError.message);
            // Don't throw error for admin copy failure
        }
        
    } catch (error) {
        console.error('❌ Failed to send payslip:', error);
        throw error;
    }
}

// Function to send employee termination email
async function sendEmployeeTerminationEmail(employee) {
    try {
        const terminationHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Employment Termination - AJK Cleaning</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; }
                .termination-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
                .highlight { background: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>👋 AJK Cleaning Company</h1>
                <h2>Employment Termination Notice</h2>
            </div>
            
            <div class="content">
                <p>Dear ${employee.name},</p>
                
                <p>This email serves as formal notice of the termination of your employment with AJK Cleaning Company.</p>
                
                <div class="termination-details">
                    <h3>📋 Termination Details</h3>
                    <p><strong>Employee ID:</strong> ${employee.id}</p>
                    <p><strong>Name:</strong> ${employee.name}</p>
                    <p><strong>Job Title:</strong> ${employee.jobTitle}</p>
                    <p><strong>Date of Termination:</strong> ${new Date().toLocaleDateString()}</p>
                    <p><strong>Last Working Day:</strong> ${new Date().toLocaleDateString()}</p>
                </div>
                
                <div class="highlight">
                    <h3>📄 Next Steps</h3>
                    <p>1. Please return any company property in your possession</p>
                    <p>2. Your final payslip will be sent separately</p>
                    <p>3. If you have any questions, please contact HR</p>
                </div>
                
                <div class="highlight">
                    <h3>📞 Contact Information</h3>
                    <p><strong>HR Department:</strong> +49 176 61852286</p>
                    <p><strong>Email:</strong> info@ajkcleaners.de</p>
                </div>
                
                <p>We thank you for your service and wish you all the best in your future endeavors.</p>
                
                <p>Best regards,<br>
                <strong>AJK Cleaning HR Team</strong></p>
            </div>
            
            <div class="footer">
                <p>AJK Cleaning Company | Professional Cleaning Services</p>
                <p>This is an automated termination notice.</p>
            </div>
        </body>
        </html>
        `;

        const mailOptions = {
            from: `"AJK Cleaning HR" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
            to: employee.email,
            subject: `👋 Employment Termination Notice - ${employee.name}`,
            html: terminationHtml,
            text: `
Employment Termination Notice

Dear ${employee.name},

This email serves as formal notice of the termination of your employment with AJK Cleaning Company.

TERMINATION DETAILS:
Employee ID: ${employee.id}
Job Title: ${employee.jobTitle}
Date of Termination: ${new Date().toLocaleDateString()}

NEXT STEPS:
1. Please return any company property
2. Your final payslip will be sent separately
3. Contact HR if you have any questions

Contact: +49 176 61852286 | info@ajkcleaners.de

We thank you for your service and wish you all the best.

AJK Cleaning HR Team
            `
        };

        await emailTransporter.sendMail(mailOptions);
        console.log(`✅ Termination email sent to ${employee.email}`);
        
    } catch (error) {
        console.error('❌ Failed to send termination email:', error);
        throw error;
    }
}

// Function to send booking confirmation invoice
async function sendBookingInvoice(booking) {
    try {
        const details = booking.details || {};
        const customerName = details.customerName || 'Valued Customer';
        const customerEmail = details.customerEmail;
        const bookingDate = details.date || 'TBD';
        const bookingTime = details.time || 'TBD';
        const packageType = details.package || 'Cleaning Service';
        const duration = details.duration || 0;
        const cleaners = details.cleaners || 1;
        const amount = booking.amount || 0;
        const specialRequests = details.specialRequests || 'None';

        const invoiceHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Booking Confirmation - AJK Cleaning</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; }
                .invoice-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .total { background: #10b981; color: white; padding: 15px; border-radius: 8px; text-align: center; font-size: 18px; font-weight: bold; }
                .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
                .highlight { background: #eff6ff; padding: 15px; border-left: 4px solid #3b82f6; margin: 15px 0; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🧹 AJK Cleaning Company</h1>
                <h2>Booking Confirmation & Invoice</h2>
            </div>
            
            <div class="content">
                <p>Dear ${customerName},</p>
                
                <p>Thank you for choosing AJK Cleaning Company! Your booking has been confirmed and payment processed successfully.</p>
                
                <div class="highlight">
                    <h3>📋 Booking Details</h3>
                    <p><strong>Booking ID:</strong> ${booking.id}</p>
                    <p><strong>Service:</strong> ${packageType}</p>
                    <p><strong>Date:</strong> ${bookingDate}</p>
                    <p><strong>Time:</strong> ${bookingTime}</p>
                    <p><strong>Duration:</strong> ${duration} hours</p>
                    <p><strong>Cleaners:</strong> ${cleaners}</p>
                </div>
                
                <div class="invoice-details">
                    <h3>💰 Payment Summary</h3>
                    <p><strong>Service Fee:</strong> €${amount}</p>
                    <p><strong>Payment Status:</strong> ✅ Paid</p>
                    <p><strong>Payment Method:</strong> Stripe</p>
                </div>
                
                <div class="total">
                    Total Amount: €${amount}
                </div>
                
                ${specialRequests !== 'None' ? `
                <div class="highlight">
                    <h3>📝 Special Requests</h3>
                    <p>${specialRequests}</p>
                </div>
                ` : ''}
                
                <div class="highlight">
                    <h3>📞 Contact Information</h3>
                    <p><strong>Phone:</strong> +49 176 61852286</p>
                    <p><strong>Email:</strong> info@ajkcleaners.de</p>
                    <p><strong>Website:</strong> https://ajkcleaners.de</p>
                </div>
                
                <p>We look forward to providing you with excellent cleaning services!</p>
                
                <p>Best regards,<br>
                <strong>AJK Cleaning Team</strong></p>
            </div>
            
            <div class="footer">
                <p>AJK Cleaning Company | Professional Cleaning Services in Bischofsheim</p>
                <p>This is an automated confirmation email. Please keep this for your records.</p>
            </div>
        </body>
        </html>
        `;

        const mailOptions = {
            from: `"AJK Cleaning Company" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
            to: customerEmail,
            subject: `🧹 Booking Confirmation & Invoice - ${booking.id}`,
            html: invoiceHtml,
            text: `
Booking Confirmation - AJK Cleaning Company

Dear ${customerName},

Your booking has been confirmed!

Booking ID: ${booking.id}
Service: ${packageType}
Date: ${bookingDate}
Time: ${bookingTime}
Duration: ${duration} hours
Cleaners: ${cleaners}
Amount: €${amount}

Contact: +49 176 61852286 | info@ajkcleaners.de

Thank you for choosing AJK Cleaning Company!
            `
        };

        await emailTransporter.sendMail(mailOptions);
        console.log(`✅ Invoice email sent to ${customerEmail} for booking ${booking.id}`);
        console.log(`📧 Email details: From ${process.env.SMTP_USER || process.env.ADMIN_EMAIL} to ${customerEmail}`);
        
    } catch (error) {
        console.error('❌ Failed to send invoice email:', error);
        throw error;
    }
}

// Use memory store for sessions to avoid file system issues on Render
const MemoryStore = require('memorystore')(session);
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Trust proxy (CRITICAL for secure cookies behind a reverse proxy like Render)
app.set('trust proxy', 1);

// Environment-specific settings
const isProduction = NODE_ENV === 'production';

// Use environment secret or generate one for development
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
    if (isProduction) {
        console.error('CRITICAL: SESSION_SECRET is not set in the environment variables for production.');
        process.exit(1);
    }
    SESSION_SECRET = crypto.randomBytes(64).toString('hex');
    console.warn('Warning: SESSION_SECRET not set. Using a temporary secret for development.');
}

// Database setup with lowdb
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'db.json');
const dbDir = path.dirname(dbPath);

// Ensure the directory exists
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const adapter = new JSONFile(dbPath);
const db = new Low(adapter, { submissions: [], admin_users: [], offline_messages: {}, chats: {}, analytics_events: [], bookings: [] });

// Analytics Batching Setup
const analyticsQueue = [];
let isWritingAnalytics = false;

// =================================================================
// DATABASE CACHING
// =================================================================
const dbCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

async function cachedRead(key, fetchFn) {
    const cached = dbCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    const data = await fetchFn();
    dbCache.set(key, { data, timestamp: Date.now() });

    // Cleanup old cache entries
    if (dbCache.size > 50) {
        const oldestKey = Array.from(dbCache.keys())[0];
        dbCache.delete(oldestKey);
    }

    return data;
}

function clearCache(key = null) {
    if (key) {
        dbCache.delete(key);
    } else {
        dbCache.clear();
    }
}
// =================================================================
// END OF DATABASE CACHING
// =================================================================

// Stripe Webhook Endpoint - IMPORTANT: This must be before express.json()
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
    console.log('🔔 Webhook received:', req.headers['stripe-signature']);
    
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error('❌ STRIPE_WEBHOOK_SECRET is not set in environment variables');
        return res.status(500).send('Webhook secret not configured');
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        console.log('✅ Webhook signature verified, event type:', event.type);
    } catch (err) {
        console.error(`❌ Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            console.info(`[STRIPE] ✅ Payment successful for PaymentIntent ${paymentIntent.id}.`);
            
            try {
                console.info(`[STRIPE] Raw Metadata:`, paymentIntent.metadata);
                if (!paymentIntent.metadata || !paymentIntent.metadata.bookingDetailsId) {
                    console.error(`[STRIPE] ❌ CRITICAL: bookingDetailsId missing from metadata for PI ${paymentIntent.id}. Cannot create booking.`);
                    break;
                }
        
                await db.read();
                
                // Retrieve full booking details from temporary storage
                const tempId = paymentIntent.metadata.bookingDetailsId;
                let bookingDetails;
                
                if (global.tempBookingDetails && global.tempBookingDetails.has(tempId)) {
                    bookingDetails = global.tempBookingDetails.get(tempId);
                    // Clean up the temporary storage
                    global.tempBookingDetails.delete(tempId);
                    console.info(`[STRIPE] 📝 Retrieved full booking details from temp storage`);
                } else {
                    console.error(`[STRIPE] ❌ CRITICAL: Full booking details not found in temp storage for ID ${tempId}`);
                    break;
                }
                
                const totalAmount = parseFloat(paymentIntent.metadata.totalAmount || '0');
                
                console.info(`[STRIPE] 📝 Parsed booking details:`, bookingDetails);
                
                const newBooking = {
                    id: `booking_${Date.now()}`,
                    details: bookingDetails,
                    amount: totalAmount,
                    status: 'paid',
                    paymentIntentId: paymentIntent.id,
                    paidAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                };
                
                console.info(`[STRIPE] 📦 Preparing to save new booking:`, newBooking.id);
                db.data.bookings.push(newBooking);
                await db.write();
                
                console.info(`[STRIPE] ✅ Successfully wrote booking ${newBooking.id} to database.`);
                console.info(`[STRIPE] 📊 Total bookings now:`, db.data.bookings.length);
                
                // Send invoice email to customer
                try {
                    await sendBookingInvoice(newBooking);
                    console.log(`[STRIPE] 📧 Invoice email sent for booking ${newBooking.id}`);
                } catch (emailError) {
                    console.error(`[STRIPE] ❌ Failed to send invoice email for booking ${newBooking.id}:`, emailError.message);
                }
            } catch (error) {
                console.error(`[STRIPE] ❌ Error processing successful payment webhook: ${error.message}`);
                console.error(error.stack);
            }
            break;

        case 'payment_intent.payment_failed':
            const paymentIntentFailed = event.data.object;
            console.warn(`[STRIPE] ❌ Payment failed for PaymentIntent ${paymentIntentFailed.id}. Reason: ${paymentIntentFailed.last_payment_error?.message}`);
            
            try {
                await db.read();
                
                const existingBooking = db.data.bookings.find(b => b.paymentIntentId === paymentIntentFailed.id);
                if (existingBooking) {
                    console.warn(`[STRIPE] ⚠️ Booking for failed payment intent ${paymentIntentFailed.id} already exists. Status: ${existingBooking.status}`);
                    break; 
                }

                const bookingDetails = JSON.parse(paymentIntentFailed.metadata.bookingDetails || '{}');
                const totalAmount = parseFloat(paymentIntentFailed.metadata.totalAmount || '0');
                
                const failedBooking = {
                    id: `booking_${Date.now()}`,
                    details: bookingDetails,
                    amount: totalAmount,
                    status: 'payment_failed',
                    paymentIntentId: paymentIntentFailed.id,
                    paymentError: paymentIntentFailed.last_payment_error?.message || 'Payment failed',
                    failedAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                };

                db.data.bookings.push(failedBooking);
                await db.write();
                console.info(`[STRIPE] ✅ Created booking record for failed payment ${failedBooking.id}`);

            } catch (error) {
                console.error(`[STRIPE] ❌ Error creating record for failed payment: ${error.message}`);
            }
            break;

        default:
            // console.log(`[STRIPE] Unhandled event type: ${event.type}`); // Optional: for debugging
    }

    // Return a 200 response to acknowledge receipt of the event
    res.json({received: true});
});


// =================================================================
// MIDDLEWARE SETUP
// =================================================================
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false })); // Keep our custom CSP
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://ajkcleaners.de',
            'https://www.ajkcleaners.de',
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
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Set-Cookie', 'CSRF-Token', 'X-CSRF-Token']
}));
app.options('*', cors());
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json());
app.use(cookieParser());

// ENHANCEMENT: Add detailed request logging
app.use((req, res, next) => {
    const start = Date.now();
    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${new Date().toISOString()} | ${clientIP} | ${req.method} ${req.url} | ${res.statusCode} | ${duration}ms`);
    });
    
    next();
});

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


// =================================================================
// CSRF PROTECTION SETUP (FIXED)
// =================================================================
const csrfProtection = csrf({ cookie: true });

// Conditionally apply CSRF protection. Public POST endpoints are excluded.
app.use((req, res, next) => {
    const excludedRoutes = [
        '/api/form/submit', 
        '/api/gemini', 
        '/api/analytics/track', 
        '/create-payment-intent', 
        '/stripe-webhook',
        '/api/booking/webhook',
        '/api/bookings/check-payment-status',
        '/api/bookings/create-from-payment',
        '/api/bookings/commercial-create',
        '/api/admin/login',
        '/api/test-email',
        '/api/test-commercial-email',
        '/api/employees',
        '/api/employees/generate-payslips'
    ];
    if (excludedRoutes.includes(req.path)) {
        return next();
    }
    csrfProtection(req, res, next);
});

// Middleware to handle CSRF token errors
app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        console.warn('CSRF Token Validation Failed for request:', req.method, req.path);
        res.status(403).json({ 
            error: 'Invalid CSRF token. Please refresh the page and try again.',
            code: 'INVALID_CSRF_TOKEN' 
        });
    } else {
        next(err);
    }
});

// Provide a dedicated endpoint for the frontend to fetch the CSRF token
app.get('/api/csrf-token', (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
});

app.get('/api/stripe-key', (req, res) => {
    res.json({
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51SD6iOHIVAzPWFkU1ixyvux7u4Srneo6y2tuko22UX4OR2cGTNXvAssP1DAhbB9XnSDOgNPAwpOaLchXBBRD36Fb00uYOldQMJ'
    });
});

// Test email endpoint
app.post('/api/test-email', async (req, res) => {
    try {
        const testEmail = {
            from: `"AJK Cleaning Company" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
            to: process.env.ADMIN_EMAIL,
            subject: '🧪 Email Test - AJK Cleaning System',
            html: `
                <h2>Email System Test</h2>
                <p>This is a test email to verify the email system is working.</p>
                <p>Time: ${new Date().toISOString()}</p>
            `,
            text: 'Email System Test - This is a test email to verify the email system is working.'
        };

        await emailTransporter.sendMail(testEmail);
        console.log('✅ Test email sent successfully');
        res.json({ success: true, message: 'Test email sent successfully' });
    } catch (error) {
        console.error('❌ Test email failed:', error);
        res.status(500).json({ error: 'Failed to send test email: ' + error.message });
    }
});

// Test commercial email endpoint
app.post('/api/test-commercial-email', async (req, res) => {
    try {
        const testBooking = {
            id: 'test_commercial_123',
            details: {
                customerName: 'Test Commercial Customer',
                customerEmail: process.env.ADMIN_EMAIL,
                package: 'commercial',
                date: '2025-01-15',
                time: '10:00',
                duration: 4,
                cleaners: 2,
                propertySize: '500',
                specialRequests: 'Test commercial booking email'
            },
            amount: 0,
            status: 'pending_consultation'
        };

        await sendCommercialBookingConfirmation(testBooking);
        console.log('✅ Test commercial email sent successfully');
        res.json({ success: true, message: 'Test commercial email sent successfully' });
    } catch (error) {
        console.error('❌ Test commercial email failed:', error);
        res.status(500).json({ error: 'Failed to send test commercial email: ' + error.message });
    }
});

// Simple email test endpoint (bypasses fallback system)
app.post('/api/test-simple-email', async (req, res) => {
    try {
        console.log('🧪 Testing simple email configuration...');
        console.log('📧 SMTP Config:', {
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS ? '***' + process.env.SMTP_PASS.slice(-4) : 'undefined'
        });
        
        const testEmail = {
            from: `"AJK Cleaning Company" <${process.env.SMTP_USER}>`,
            to: process.env.ADMIN_EMAIL,
            subject: '🧪 Simple Email Test - AJK Cleaning System',
            html: `
                <h2>Simple Email Test</h2>
                <p>This is a simple test email to verify the basic email system is working.</p>
                <p>Time: ${new Date().toISOString()}</p>
                <p>Configuration: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}</p>
            `,
            text: 'Simple Email Test - This is a simple test email to verify the basic email system is working.'
        };

        await emailTransporter.sendMail(testEmail);
        console.log('✅ Simple test email sent successfully');
        res.json({ success: true, message: 'Simple test email sent successfully' });
    } catch (error) {
        console.error('❌ Simple test email failed:', error);
        res.status(500).json({ error: 'Failed to send simple test email: ' + error.message });
    }
});

// Test SendGrid email endpoint
app.post('/api/test-sendgrid-email', async (req, res) => {
    try {
        if (!process.env.SENDGRID_API_KEY) {
            return res.status(400).json({ error: 'SENDGRID_API_KEY not configured' });
        }
        
        const testEmail = {
            from: `"AJK Cleaning Company" <${process.env.ADMIN_EMAIL}>`,
            to: process.env.ADMIN_EMAIL,
            subject: '🧪 SendGrid Test - AJK Cleaning System',
            html: `
                <h2>SendGrid Email Test</h2>
                <p>This is a test email sent via SendGrid to verify the email service is working.</p>
                <p>Time: ${new Date().toISOString()}</p>
                <p>Service: SendGrid API</p>
            `,
            text: 'SendGrid Email Test - This is a test email sent via SendGrid to verify the email service is working.'
        };

        await sendEmailWithSendGrid(testEmail);
        console.log('✅ SendGrid test email sent successfully');
        res.json({ success: true, message: 'SendGrid test email sent successfully' });
    } catch (error) {
        console.error('❌ SendGrid test email failed:', error);
        res.status(500).json({ error: 'Failed to send SendGrid test email: ' + error.message });
    }
});

// Test webhook email endpoint
app.post('/api/test-webhook-email', async (req, res) => {
    try {
        const testEmail = {
            from: `"AJK Cleaning Company" <${process.env.ADMIN_EMAIL}>`,
            to: process.env.ADMIN_EMAIL,
            subject: '🧪 Webhook Test - AJK Cleaning System',
            html: `
                <h2>Webhook Email Test</h2>
                <p>This is a test email sent via webhook service to verify the email service is working.</p>
                <p>Time: ${new Date().toISOString()}</p>
                <p>Service: Webhook (EmailJS/Formspree/Netlify)</p>
            `,
            text: 'Webhook Email Test - This is a test email sent via webhook service to verify the email service is working.'
        };

        await sendEmailViaWebhook(testEmail);
        console.log('✅ Webhook test email sent successfully');
        res.json({ success: true, message: 'Webhook test email sent successfully' });
    } catch (error) {
        console.error('❌ Webhook test email failed:', error);
        res.status(500).json({ error: 'Failed to send webhook test email: ' + error.message });
    }
});

// Quote submission endpoint
app.post('/api/quote-submit', async (req, res) => {
    try {
        const {
            customerName,
            customerEmail,
            customerPhone,
            serviceType,
            propertySize,
            frequency,
            specialRequirements,
            preferredDate,
            preferredTime,
            salutation
        } = req.body;

        // Validate required fields
        if (!customerName || !customerEmail || !serviceType || !propertySize || !frequency) {
            return res.status(400).json({ 
                error: 'Missing required fields: customerName, customerEmail, serviceType, propertySize, frequency are required' 
            });
        }

        console.log(`[QUOTE] 📋 New quote request from ${customerName} (${customerEmail})`);
        console.log(`[QUOTE] 📋 Service: ${serviceType}, Size: ${propertySize} sq ft, Frequency: ${frequency}`);

        // Prepare quote data
        const quoteData = {
            customerName,
            customerEmail,
            customerPhone: customerPhone || 'Not provided',
            serviceType,
            propertySize,
            frequency,
            specialRequirements: specialRequirements || 'None',
            preferredDate: preferredDate || 'Flexible',
            preferredTime: preferredTime || 'Flexible',
            salutation: salutation || 'Dear'
        };

        // Send quote confirmation email to customer
        try {
            await sendQuoteEmail(quoteData);
            console.log(`[QUOTE] 📧 Quote confirmation email sent to ${customerEmail}`);
        } catch (emailError) {
            console.error(`[QUOTE] ❌ Failed to send quote email to ${customerEmail}:`, emailError.message);
            // Don't fail the request if email fails
        }

        // Store quote request in database for admin review
        try {
            await db.read();
            const quoteRequest = {
                id: `quote_${Date.now()}`,
                customerName,
                customerEmail,
                customerPhone: customerPhone || 'Not provided',
                serviceType,
                propertySize,
                frequency,
                specialRequirements: specialRequirements || 'None',
                preferredDate: preferredDate || 'Flexible',
                preferredTime: preferredTime || 'Flexible',
                salutation: salutation || 'Dear',
                status: 'pending_review',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            if (!db.data.quoteRequests) {
                db.data.quoteRequests = [];
            }
            db.data.quoteRequests.push(quoteRequest);
            await db.write();
            
            console.log(`[QUOTE] 📋 Quote request stored for admin review: ${quoteRequest.id}`);
        } catch (dbError) {
            console.error(`[QUOTE] ❌ Failed to store quote request:`, dbError.message);
        }

        res.json({ 
            success: true, 
            message: 'Quote request submitted successfully. You will receive a confirmation email shortly.',
            quoteId: `quote_${Date.now()}`
        });

    } catch (error) {
        console.error('❌ Quote submission failed:', error);
        res.status(500).json({ error: 'Failed to submit quote request: ' + error.message });
    }
});

// Test admin notification endpoint
app.post('/api/test-admin-notification', async (req, res) => {
    try {
        const testBooking = {
            id: 'test_admin_123',
            details: {
                customerName: 'Test Customer',
                customerEmail: 'test@example.com',
                customerPhone: '+49 123 456789',
                customerAddress: 'Test Street 123',
                city: 'Test City',
                postalCode: '12345',
                bookingType: 'one-time',
                package: 'basic',
                date: '2025-01-15',
                time: '10:00',
                duration: 2,
                cleaners: 1,
                propertySize: '100',
                specialRequests: 'Test admin notification',
                salutation: 'Mr.'
            },
            amount: 50,
            status: 'paid',
            paymentIntentId: 'test_pi_123',
            paidAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };

        await sendAdminNotification(testBooking);
        console.log('✅ Admin notification test sent successfully');
        res.json({ success: true, message: 'Admin notification test sent successfully' });
    } catch (error) {
        console.error('❌ Admin notification test failed:', error);
        res.status(500).json({ error: 'Failed to send admin notification test: ' + error.message });
    }
});

// Get all quote requests (for admin panel)
app.get('/api/quotes', async (req, res) => {
    try {
        await db.read();
        const quotes = db.data.quoteRequests || [];
        res.json(quotes);
    } catch (error) {
        console.error('❌ Failed to fetch quotes:', error);
        res.status(500).json({ error: 'Failed to fetch quote requests' });
    }
});

// Get specific quote request
app.get('/api/quotes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.read();
        const quotes = db.data.quoteRequests || [];
        const quote = quotes.find(q => q.id === id);
        
        if (!quote) {
            return res.status(404).json({ error: 'Quote request not found' });
        }
        
        res.json(quote);
    } catch (error) {
        console.error('❌ Failed to fetch quote:', error);
        res.status(500).json({ error: 'Failed to fetch quote request' });
    }
});

// Send professional quote response to client
app.post('/api/quotes/:id/send-response', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            subject,
            message,
            pricing,
            nextSteps,
            attachments
        } = req.body;

        if (!subject || !message) {
            return res.status(400).json({ 
                error: 'Subject and message are required' 
            });
        }

        await db.read();
        const quotes = db.data.quoteRequests || [];
        const quote = quotes.find(q => q.id === id);
        
        if (!quote) {
            return res.status(404).json({ error: 'Quote request not found' });
        }

        // Create professional quote response email
        const responseHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Quote Response - AJK Cleaning</title>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f4f4f4; }
                    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
                    .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
                    .header p { margin: 10px 0 0 0; font-size: 16px; opacity: 0.9; }
                    .content { padding: 30px; }
                    .quote-details { background: #f8f9fa; border-radius: 8px; padding: 25px; margin: 20px 0; }
                    .detail-row { display: flex; justify-content: space-between; margin: 12px 0; padding: 8px 0; border-bottom: 1px solid #e9ecef; }
                    .detail-row:last-child { border-bottom: none; }
                    .detail-label { font-weight: bold; color: #495057; }
                    .detail-value { color: #212529; }
                    .pricing { background: #e8f5e8; border-left: 4px solid #28a745; padding: 20px; margin: 20px 0; }
                    .pricing h3 { color: #155724; margin: 0 0 15px 0; }
                    .next-steps { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 20px; margin: 20px 0; }
                    .next-steps h3 { color: #1976d2; margin: 0 0 15px 0; }
                    .message-content { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin: 20px 0; }
                    .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; border-top: 1px solid #e9ecef; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>📋 Your Quote Response</h1>
                        <p>AJK Cleaning Company - Professional Cleaning Services</p>
                    </div>
                    
                    <div class="content">
                        <div class="quote-details">
                            <h3 style="margin-top: 0; color: #495057;">📋 Your Original Request</h3>
                            <div class="detail-row">
                                <span class="detail-label">Service Type:</span>
                                <span class="detail-value">${quote.serviceType}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Property Size:</span>
                                <span class="detail-value">${quote.propertySize} sq ft</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Service Frequency:</span>
                                <span class="detail-value">${quote.frequency}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Preferred Date:</span>
                                <span class="detail-value">${quote.preferredDate}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Preferred Time:</span>
                                <span class="detail-value">${quote.preferredTime}</span>
                            </div>
                            ${quote.specialRequirements !== 'None' ? `
                            <div class="detail-row">
                                <span class="detail-label">Special Requirements:</span>
                                <span class="detail-value">${quote.specialRequirements}</span>
                            </div>
                            ` : ''}
                        </div>

                        <div class="message-content">
                            <h3 style="margin-top: 0; color: #495057;">💬 Our Response</h3>
                            <div style="white-space: pre-line;">${message}</div>
                        </div>

                        ${pricing ? `
                        <div class="pricing">
                            <h3>💰 Pricing Information</h3>
                            <div style="white-space: pre-line;">${pricing}</div>
                        </div>
                        ` : ''}

                        ${nextSteps ? `
                        <div class="next-steps">
                            <h3>🎯 Next Steps</h3>
                            <div style="white-space: pre-line;">${nextSteps}</div>
                        </div>
                        ` : ''}

                        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <h4 style="margin-top: 0; color: #495057;">📞 Questions or Ready to Book?</h4>
                            <p style="margin: 5px 0;"><strong>Phone:</strong> +49 176 61852286</p>
                            <p style="margin: 5px 0;"><strong>Email:</strong> info@ajkcleaners.de</p>
                            <p style="margin: 5px 0;"><strong>Hours:</strong> Monday - Friday: 8:00 AM - 6:00 PM</p>
                        </div>
                    </div>
                    
                    <div class="footer">
                        <p><strong>AJK Cleaning Company</strong> | Professional Cleaning Services</p>
                        <p>Thank you for considering us for your cleaning needs!</p>
                    </div>
                </div>
            </body>
            </html>
        `;

        const responseText = `
📋 QUOTE RESPONSE - AJK Cleaning Company

Dear ${quote.customerName},

Thank you for your interest in our professional cleaning services!

YOUR ORIGINAL REQUEST:
Service Type: ${quote.serviceType}
Property Size: ${quote.propertySize} sq ft
Service Frequency: ${quote.frequency}
Preferred Date: ${quote.preferredDate}
Preferred Time: ${quote.preferredTime}
${quote.specialRequirements !== 'None' ? `Special Requirements: ${quote.specialRequirements}` : ''}

OUR RESPONSE:
${message}

${pricing ? `PRICING INFORMATION:\n${pricing}\n` : ''}
${nextSteps ? `NEXT STEPS:\n${nextSteps}\n` : ''}

QUESTIONS OR READY TO BOOK?
Phone: +49 176 61852286
Email: info@ajkcleaners.de
Hours: Monday - Friday: 8:00 AM - 6:00 PM

Thank you for considering AJK Cleaning Company!

Best regards,
The AJK Cleaning Team
        `;

        const mailOptions = {
            from: `"AJK Cleaning Company" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
            to: quote.customerEmail,
            subject: subject,
            html: responseHtml,
            text: responseText
        };

        await emailTransporter.sendMail(mailOptions);
        console.log(`📧 Quote response sent to ${quote.customerEmail} for quote ${id}`);

        // Update quote status
        quote.status = 'responded';
        quote.updatedAt = new Date().toISOString();
        quote.responseSentAt = new Date().toISOString();
        await db.write();

        res.json({ 
            success: true, 
            message: 'Quote response sent successfully',
            quoteId: id
        });

    } catch (error) {
        console.error('❌ Failed to send quote response:', error);
        res.status(500).json({ error: 'Failed to send quote response: ' + error.message });
    }
});

// Send custom message to client from admin
app.post('/api/submissions/:id/send-message', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { subject, message, messageType = 'custom' } = req.body;

        if (!subject || !message) {
            return res.status(400).json({ 
                error: 'Subject and message are required' 
            });
        }

        await db.read();
        const submissions = (db.data && Array.isArray(db.data.submissions)) ? db.data.submissions : [];
        const submission = submissions.find(s => s.id === parseInt(id));
        
        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        // Create professional custom message email
        const customMessageHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Message from AJK Cleaning</title>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f4f4f4; }
                    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
                    .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
                    .header p { margin: 10px 0 0 0; font-size: 16px; opacity: 0.9; }
                    .content { padding: 30px; }
                    .message-content { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin: 20px 0; }
                    .original-request { background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
                    .detail-row { display: flex; justify-content: space-between; margin: 8px 0; padding: 4px 0; border-bottom: 1px solid #e9ecef; }
                    .detail-row:last-child { border-bottom: none; }
                    .detail-label { font-weight: bold; color: #495057; }
                    .detail-value { color: #212529; }
                    .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; border-top: 1px solid #e9ecef; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>📧 Response from AJK Cleaning</h1>
                        <p>Professional Cleaning Services</p>
                    </div>
                    
                    <div class="content">
                        <div class="message-content">
                            <h3 style="margin-top: 0; color: #495057;">💬 Our Response</h3>
                            <div style="white-space: pre-line;">${message}</div>
                        </div>

                        <div class="original-request">
                            <h3 style="margin-top: 0; color: #495057;">📋 Your Original Request</h3>
                            <div class="detail-row">
                                <span class="detail-label">Name:</span>
                                <span class="detail-value">${submission.name}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Service:</span>
                                <span class="detail-value">${submission.service}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Preferred Date:</span>
                                <span class="detail-value">${submission.preferred_date || 'Not specified'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Preferred Time:</span>
                                <span class="detail-value">${submission.preferred_time || 'Not specified'}</span>
                            </div>
                            ${submission.message ? `
                            <div class="detail-row">
                                <span class="detail-label">Your Message:</span>
                                <span class="detail-value">${submission.message}</span>
                            </div>
                            ` : ''}
                        </div>

                        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <h4 style="margin-top: 0; color: #495057;">📞 Questions or Ready to Book?</h4>
                            <p style="margin: 5px 0;"><strong>Phone:</strong> +49 176 61852286</p>
                            <p style="margin: 5px 0;"><strong>Email:</strong> info@ajkcleaners.de</p>
                            <p style="margin: 5px 0;"><strong>Hours:</strong> Monday - Friday: 8:00 AM - 6:00 PM</p>
                        </div>
                    </div>
                    
                    <div class="footer">
                        <p><strong>AJK Cleaning Company</strong> | Professional Cleaning Services</p>
                        <p>Thank you for choosing us for your cleaning needs!</p>
                    </div>
                </div>
            </body>
            </html>
        `;

        const customMessageText = `
📧 RESPONSE FROM AJK CLEANING COMPANY

Dear ${submission.name},

${message}

YOUR ORIGINAL REQUEST:
Name: ${submission.name}
Service: ${submission.service}
Preferred Date: ${submission.preferred_date || 'Not specified'}
Preferred Time: ${submission.preferred_time || 'Not specified'}
${submission.message ? `Your Message: ${submission.message}` : ''}

QUESTIONS OR READY TO BOOK?
Phone: +49 176 61852286
Email: info@ajkcleaners.de
Hours: Monday - Friday: 8:00 AM - 6:00 PM

Thank you for choosing AJK Cleaning Company!

Best regards,
The AJK Cleaning Team
        `;

        const mailOptions = {
            from: `"AJK Cleaning Company" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
            to: submission.email,
            subject: subject,
            html: customMessageHtml,
            text: customMessageText
        };

        await emailTransporter.sendMail(mailOptions);
        console.log(`📧 Custom message sent to ${submission.email} for submission ${id}`);

        // Log the message in submission history
        if (!submission.messageHistory) {
            submission.messageHistory = [];
        }
        submission.messageHistory.push({
            type: messageType,
            subject: subject,
            message: message,
            sentAt: new Date().toISOString(),
            sentBy: 'admin'
        });
        submission.lastContactedAt = new Date().toISOString();
        
        await db.write();

        res.json({ 
            success: true, 
            message: 'Custom message sent successfully',
            submissionId: id
        });

    } catch (error) {
        console.error('❌ Failed to send custom message:', error);
        res.status(500).json({ error: 'Failed to send custom message: ' + error.message });
    }
});

// Reviews API endpoints
app.post('/api/reviews', async (req, res) => {
    try {
        const {
            customerName,
            customerEmail,
            serviceType,
            rating,
            reviewText,
            bookingId,
            isPublic = true
        } = req.body;

        // Validate required fields
        if (!customerName || !customerEmail || !rating || !reviewText) {
            return res.status(400).json({ 
                error: 'Missing required fields: customerName, customerEmail, rating, reviewText are required' 
            });
        }

        if (rating < 1 || rating > 5) {
            return res.status(400).json({ 
                error: 'Rating must be between 1 and 5' 
            });
        }

        await db.read();
        if (!db.data.reviews) {
            db.data.reviews = [];
        }

        const review = {
            id: `review_${Date.now()}`,
            customerName,
            customerEmail,
            serviceType: serviceType || 'General Cleaning',
            rating: parseInt(rating),
            reviewText,
            bookingId: bookingId || null,
            isPublic: isPublic === true,
            status: 'pending_approval', // Admin approval required
            createdAt: new Date().toISOString(),
            approvedAt: null,
            approvedBy: null
        };

        db.data.reviews.push(review);
        await db.write();

        console.log(`📝 New review submitted by ${customerName} (${customerEmail}) - Rating: ${rating}/5`);

        // Send notification to admin
        try {
            await sendAdminReviewNotification(review);
        } catch (emailError) {
            console.error('Failed to send admin notification for review:', emailError.message);
        }

        res.json({ 
            success: true, 
            message: 'Review submitted successfully. Thank you for your feedback!',
            reviewId: review.id
        });

    } catch (error) {
        console.error('❌ Review submission failed:', error);
        res.status(500).json({ error: 'Failed to submit review: ' + error.message });
    }
});

// Get public reviews for website display
app.get('/api/reviews/public', async (req, res) => {
    try {
        await db.read();
        console.log('📋 Fetching public reviews...');
        console.log('📋 Database data:', db.data ? Object.keys(db.data) : 'No data');
        console.log('📋 Reviews in database:', db.data.reviews ? db.data.reviews.length : 0);
        
        const reviews = (db.data.reviews || [])
            .filter(review => review.isPublic && review.status === 'approved')
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 20); // Limit to 20 most recent reviews

        console.log('📋 Public reviews found:', reviews.length);
        res.json(reviews);
    } catch (error) {
        console.error('❌ Failed to fetch public reviews:', error);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

// Admin endpoints for review management
app.get('/api/reviews/admin', requireAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const status = req.query.status || '';
        const rating = req.query.rating || '';

        await db.read();
        console.log('📋 Admin reviews request - Database data:', db.data ? Object.keys(db.data) : 'No data');
        console.log('📋 Reviews in database:', db.data.reviews ? db.data.reviews.length : 0);
        
        let reviews = db.data.reviews || [];
        console.log('📋 All reviews:', reviews.length);

        // Filter by status
        if (status) {
            reviews = reviews.filter(review => review.status === status);
            console.log(`📋 Filtered by status '${status}':`, reviews.length);
        }

        // Filter by rating
        if (rating) {
            reviews = reviews.filter(review => review.rating === parseInt(rating));
            console.log(`📋 Filtered by rating '${rating}':`, reviews.length);
        }

        // Sort by newest first
        reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedReviews = reviews.slice(startIndex, endIndex);

        res.json({
            reviews: paginatedReviews,
            pagination: {
                page,
                limit,
                total: reviews.length,
                totalPages: Math.ceil(reviews.length / limit),
                hasNext: endIndex < reviews.length,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Failed to fetch admin reviews:', error);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

// Approve/reject review
app.post('/api/reviews/:id/approve', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body; // 'approve' or 'reject'

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Action must be approve or reject' });
        }

        await db.read();
        const reviews = db.data.reviews || [];
        const reviewIndex = reviews.findIndex(review => review.id === id);

        if (reviewIndex === -1) {
            return res.status(404).json({ error: 'Review not found' });
        }

        const review = reviews[reviewIndex];
        review.status = action === 'approve' ? 'approved' : 'rejected';
        review.updatedAt = new Date().toISOString();
        review.approvedAt = action === 'approve' ? new Date().toISOString() : null;
        review.approvedBy = action === 'approve' ? 'admin' : null;

        await db.write();

        console.log(`📝 Review ${id} ${action}d by admin`);

        res.json({ 
            success: true, 
            message: `Review ${action}d successfully`,
            review: review
        });

    } catch (error) {
        console.error('❌ Failed to update review:', error);
        res.status(500).json({ error: 'Failed to update review: ' + error.message });
    }
});

// Delete review
app.delete('/api/reviews/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        await db.read();
        const reviews = db.data.reviews || [];
        const reviewIndex = reviews.findIndex(review => review.id === id);

        if (reviewIndex === -1) {
            return res.status(404).json({ error: 'Review not found' });
        }

        reviews.splice(reviewIndex, 1);
        await db.write();

        console.log(`📝 Review ${id} deleted by admin`);

        res.json({ 
            success: true, 
            message: 'Review deleted successfully'
        });

    } catch (error) {
        console.error('❌ Failed to delete review:', error);
        res.status(500).json({ error: 'Failed to delete review: ' + error.message });
    }
});

// Send admin notification for new review
async function sendAdminReviewNotification(review) {
    const adminEmailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Customer Review - AJK Cleaning</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f4f4f4; }
                .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
                .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
                .content { padding: 30px; }
                .review-details { background: #f8f9fa; border-radius: 8px; padding: 25px; margin: 20px 0; }
                .rating { font-size: 24px; color: #ffc107; margin: 10px 0; }
                .review-text { background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745; margin: 15px 0; }
                .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; border-top: 1px solid #e9ecef; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>⭐ New Customer Review</h1>
                    <p>AJK Cleaning Company - Review Management</p>
                </div>
                
                <div class="content">
                    <div class="review-details">
                        <h3 style="margin-top: 0; color: #495057;">📝 Review Details</h3>
                        <p><strong>Customer:</strong> ${review.customerName}</p>
                        <p><strong>Email:</strong> ${review.customerEmail}</p>
                        <p><strong>Service:</strong> ${review.serviceType}</p>
                        <p><strong>Rating:</strong> <span class="rating">${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)}</span> (${review.rating}/5)</p>
                        <p><strong>Status:</strong> Pending Approval</p>
                    </div>

                    <div class="review-text">
                        <h4 style="margin-top: 0; color: #495057;">💬 Customer Review:</h4>
                        <p style="font-style: italic; line-height: 1.6;">"${review.reviewText}"</p>
                    </div>

                    <div style="background: #e3f2fd; border-left: 4px solid #2196f3; padding: 20px; margin: 20px 0;">
                        <h4 style="margin-top: 0; color: #1976d2;">🎯 Action Required</h4>
                        <p>Please review and approve this customer feedback in your admin panel.</p>
                        <p><strong>Admin Panel:</strong> <a href="${process.env.ADMIN_URL || 'https://your-app.onrender.com/admin'}" style="color: #1976d2;">Review Management</a></p>
                    </div>
                </div>
                
                <div class="footer">
                    <p><strong>AJK Cleaning Company</strong> | Review Management System</p>
                    <p>Thank you for maintaining our service quality!</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const adminEmailText = `
⭐ NEW CUSTOMER REVIEW - AJK Cleaning Company

Review Details:
Customer: ${review.customerName}
Email: ${review.customerEmail}
Service: ${review.serviceType}
Rating: ${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)} (${review.rating}/5)
Status: Pending Approval

Customer Review:
"${review.reviewText}"

Action Required:
Please review and approve this customer feedback in your admin panel.

Admin Panel: ${process.env.ADMIN_URL || 'https://your-app.onrender.com/admin'}

Thank you for maintaining our service quality!

Best regards,
AJK Cleaning Company
    `;

    // Get admin emails from environment variables
    const adminEmails = process.env.ADMIN_EMAILS ? 
        process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : 
        [process.env.NOTIFICATION_EMAIL || 'sugampokharel28@gmail.com'];

    const mailOptions = {
        from: `"AJK Cleaning Company" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
        to: adminEmails.join(','),
        subject: `⭐ New Customer Review - ${review.rating}/5 stars from ${review.customerName}`,
        html: adminEmailHtml,
        text: adminEmailText
    };

    await emailTransporter.sendMail(mailOptions);
    console.log(`📧 Admin notification sent for review from ${review.customerName}`);
}

// Test endpoint to add sample reviews
app.post('/api/reviews/test-data', async (req, res) => {
    try {
        await db.read();
        if (!db.data.reviews) {
            db.data.reviews = [];
        }

        const sampleReviews = [
            {
                id: `review_${Date.now()}_1`,
                customerName: 'Sarah Johnson',
                customerEmail: 'sarah.johnson@example.com',
                serviceType: 'Residential Cleaning',
                rating: 5,
                reviewText: 'Absolutely fantastic service! The team was professional, thorough, and left my home spotless. I highly recommend AJK Cleaning to anyone looking for quality cleaning services.',
                bookingId: null,
                isPublic: true,
                status: 'approved',
                createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
                approvedAt: new Date(Date.now() - 86400000).toISOString(),
                approvedBy: 'admin'
            },
            {
                id: `review_${Date.now()}_2`,
                customerName: 'Michael Chen',
                customerEmail: 'michael.chen@example.com',
                serviceType: 'Commercial Cleaning',
                rating: 5,
                reviewText: 'Outstanding commercial cleaning service! Our office has never looked better. The team is reliable, efficient, and pays attention to every detail.',
                bookingId: null,
                isPublic: true,
                status: 'approved',
                createdAt: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
                approvedAt: new Date(Date.now() - 172800000).toISOString(),
                approvedBy: 'admin'
            },
            {
                id: `review_${Date.now()}_3`,
                customerName: 'Emma Wilson',
                customerEmail: 'emma.wilson@example.com',
                serviceType: 'Deep Cleaning',
                rating: 4,
                reviewText: 'Great deep cleaning service! The team was very thorough and used eco-friendly products. My home feels completely refreshed.',
                bookingId: null,
                isPublic: true,
                status: 'approved',
                createdAt: new Date(Date.now() - 259200000).toISOString(), // 3 days ago
                approvedAt: new Date(Date.now() - 259200000).toISOString(),
                approvedBy: 'admin'
            },
            {
                id: `review_${Date.now()}_4`,
                customerName: 'David Brown',
                customerEmail: 'david.brown@example.com',
                serviceType: 'Move In/Out Cleaning',
                rating: 5,
                reviewText: 'Perfect move-out cleaning service! The team made our old apartment look brand new. Highly professional and reasonably priced.',
                bookingId: null,
                isPublic: true,
                status: 'approved',
                createdAt: new Date(Date.now() - 345600000).toISOString(), // 4 days ago
                approvedAt: new Date(Date.now() - 345600000).toISOString(),
                approvedBy: 'admin'
            },
            {
                id: `review_${Date.now()}_5`,
                customerName: 'Lisa Garcia',
                customerEmail: 'lisa.garcia@example.com',
                serviceType: 'Residential Cleaning',
                rating: 5,
                reviewText: 'Excellent service! The cleaners were punctual, friendly, and did an amazing job. I will definitely book again.',
                bookingId: null,
                isPublic: true,
                status: 'approved',
                createdAt: new Date(Date.now() - 432000000).toISOString(), // 5 days ago
                approvedAt: new Date(Date.now() - 432000000).toISOString(),
                approvedBy: 'admin'
            }
        ];

        // Add sample reviews to database
        db.data.reviews.push(...sampleReviews);
        await db.write();

        console.log(`📝 Added ${sampleReviews.length} sample reviews to database`);

        res.json({ 
            success: true, 
            message: `Added ${sampleReviews.length} sample reviews successfully`,
            reviews: sampleReviews
        });

    } catch (error) {
        console.error('❌ Failed to add sample reviews:', error);
        res.status(500).json({ error: 'Failed to add sample reviews: ' + error.message });
    }
});

// Debug endpoint to check database contents
app.get('/api/debug/database', requireAuth, async (req, res) => {
    try {
        await db.read();
        const data = {
            submissions: {
                exists: !!db.data.submissions,
                length: db.data.submissions ? db.data.submissions.length : 0,
                sample: db.data.submissions ? db.data.submissions.slice(0, 2) : []
            },
            chats: {
                exists: !!db.data.chats,
                length: db.data.chats ? Object.keys(db.data.chats).length : 0,
                keys: db.data.chats ? Object.keys(db.data.chats) : []
            },
            quoteRequests: {
                exists: !!db.data.quoteRequests,
                length: db.data.quoteRequests ? db.data.quoteRequests.length : 0,
                sample: db.data.quoteRequests ? db.data.quoteRequests.slice(0, 2) : []
            },
            bookings: {
                exists: !!db.data.bookings,
                length: db.data.bookings ? db.data.bookings.length : 0,
                sample: db.data.bookings ? db.data.bookings.slice(0, 2) : []
            },
            allKeys: Object.keys(db.data || {})
        };
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Database error: ' + error.message });
    }
});

// Test quote email endpoint
app.post('/api/test-quote-email', async (req, res) => {
    try {
        const testQuoteData = {
            customerName: 'Test Customer',
            customerEmail: process.env.ADMIN_EMAIL,
            customerPhone: '+49 123 456789',
            serviceType: 'Residential Cleaning',
            propertySize: '1500',
            frequency: 'Weekly',
            specialRequirements: 'Test quote email with special requirements',
            preferredDate: '2025-01-15',
            preferredTime: 'Morning',
            salutation: 'Dear'
        };

        await sendQuoteEmail(testQuoteData);
        console.log('✅ Quote email test sent successfully');
        res.json({ success: true, message: 'Quote email test sent successfully' });
    } catch (error) {
        console.error('❌ Quote email test failed:', error);
        res.status(500).json({ error: 'Failed to send quote email test: ' + error.message });
    }
});

// ==================== TEAM MANAGEMENT API ====================

// Get all employees
app.get('/api/employees', async (req, res) => {
    try {
        await db.read();
        const employees = db.data.employees || [];
        res.json(employees);
    } catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).json({ error: 'Failed to fetch employees' });
    }
});

// Add new employee
app.post('/api/employees', async (req, res) => {
    try {
        const { name, email, jobTitle, phone, salary, dateJoined, address, status, notes, ssn, taxId, penalties, absences, otherDeductions, customTax } = req.body;
        
        if (!name || !email || !jobTitle || !salary || !dateJoined) {
            return res.status(400).json({ error: 'Name, email, job title, salary, and date joined are required' });
        }

        await db.read();
        
        // Ensure employees array exists
        if (!db.data.employees) {
            db.data.employees = [];
        }

        // Check if employee already exists
        const existingEmployee = db.data.employees.find(emp => emp.email === email);
        if (existingEmployee) {
            return res.status(400).json({ error: 'Employee with this email already exists' });
        }

        const newEmployee = {
            id: `emp_${Date.now()}`,
            name,
            email,
            jobTitle,
            phone: phone || '',
            salary: parseFloat(salary),
            dateJoined,
            address: address || '',
            status: status || 'active',
            notes: notes || '',
            ssn: ssn || '',
            taxId: taxId || '',
            penalties: parseFloat(penalties) || 0,
            absences: parseFloat(absences) || 0,
            otherDeductions: parseFloat(otherDeductions) || 0,
            customTax: parseFloat(customTax) || 0,
            paymentHistory: [], // Track payment history
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        db.data.employees.push(newEmployee);
        await db.write();

        console.log(`✅ Employee added: ${newEmployee.name} (${newEmployee.email})`);
        res.json({ success: true, employee: newEmployee });
    } catch (error) {
        console.error('Error adding employee:', error);
        res.status(500).json({ error: 'Failed to add employee' });
    }
});

// Update employee
app.put('/api/employees/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        await db.read();
        
        const employeeIndex = db.data.employees.findIndex(emp => emp.id === id);
        if (employeeIndex === -1) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        // Update employee
        db.data.employees[employeeIndex] = {
            ...db.data.employees[employeeIndex],
            ...updates,
            updatedAt: new Date().toISOString()
        };

        await db.write();

        console.log(`✅ Employee updated: ${db.data.employees[employeeIndex].name}`);
        res.json({ success: true, employee: db.data.employees[employeeIndex] });
    } catch (error) {
        console.error('Error updating employee:', error);
        res.status(500).json({ error: 'Failed to update employee' });
    }
});

// Delete employee
app.delete('/api/employees/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await db.read();
        
        const employeeIndex = db.data.employees.findIndex(emp => emp.id === id);
        if (employeeIndex === -1) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        const employee = db.data.employees[employeeIndex];
        
        // Remove employee
        db.data.employees.splice(employeeIndex, 1);
        await db.write();

        // Send termination email
        try {
            await sendEmployeeTerminationEmail(employee);
            console.log(`✅ Termination email sent to ${employee.email}`);
        } catch (emailError) {
            console.error('❌ Failed to send termination email:', emailError);
        }

        console.log(`✅ Employee deleted: ${employee.name}`);
        res.json({ success: true, message: 'Employee deleted successfully' });
    } catch (error) {
        console.error('Error deleting employee:', error);
        res.status(500).json({ error: 'Failed to delete employee' });
    }
});

// Generate payslips
app.post('/api/employees/generate-payslips', async (req, res) => {
    try {
        const { month, year, employeeIds } = req.body;
        
        if (!month || !year || !employeeIds || employeeIds.length === 0) {
            return res.status(400).json({ error: 'Month, year, and employee selection are required' });
        }

        await db.read();
        const employees = db.data.employees || [];
        
        const selectedEmployees = employees.filter(emp => 
            employeeIds.includes(emp.id) && emp.status === 'active'
        );

        if (selectedEmployees.length === 0) {
            return res.status(400).json({ error: 'No active employees selected' });
        }

        const payslips = [];
        
        for (const employee of selectedEmployees) {
            try {
                await sendEmployeePayslip(employee, month, year);
                payslips.push({
                    employeeId: employee.id,
                    employeeName: employee.name,
                    email: employee.email,
                    status: 'sent'
                });
                console.log(`✅ Payslip sent to ${employee.name} (${employee.email})`);
            } catch (emailError) {
                payslips.push({
                    employeeId: employee.id,
                    employeeName: employee.name,
                    email: employee.email,
                    status: 'failed',
                    error: emailError.message
                });
                console.error(`❌ Failed to send payslip to ${employee.name}:`, emailError);
            }
        }

        res.json({ 
            success: true, 
            message: `Payslips processed for ${payslips.length} employees`,
            payslips 
        });
    } catch (error) {
        console.error('Error generating payslips:', error);
        res.status(500).json({ error: 'Failed to generate payslips' });
    }
});
// =================================================================
// END OF CSRF SETUP
// =================================================================


// =================================================================
// SECURE GEMINI API PROXY
// =================================================================
app.post('/api/gemini', async (req, res) => {
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
        console.error('Gemini API key is not configured on the server.');
        return res.status(500).json({ error: { message: 'The AI service is not configured correctly. Please contact support.' } });
    }
    
    if (!req.body || !req.body.contents) {
        return res.status(400).json({ error: { message: 'Request body is required and must contain "contents"' } });
    }

    const { contents, systemInstruction } = req.body;
    
    if (contents.length === 0) {
        return res.status(400).json({ error: { message: 'Invalid request body: contents are empty.' } });
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`;

    try {
        const fetch = (await import('node-fetch')).default;
        
        const geminiPayload = {
            contents: contents
        };

        if (systemInstruction) {
            geminiPayload.systemInstruction = systemInstruction;
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Gemini API Error:', data);
            const errorMessage = data?.error?.message || `API error: ${response.status}`;
            return res.status(response.status).json({ error: { message: errorMessage } });
        }

        res.json(data);
    } catch (error) {
        console.error('Error proxying request to Gemini API:', error);
        res.status(500).json({ error: { message: `The server encountered an error while trying to contact the AI service. Details: ${error.message}` } });
    }
});
// =================================================================
// END OF GEMINI PROXY
// =================================================================


// ==================== WEBSOCKET CHAT SERVER ====================
const clients = new Map();
const adminSessions = new Map();
const connectionQuality = new Map();

// Persist a chat message to LowDB for a given clientId
async function persistChatMessage(clientId, message) {
  try {
    await db.read();
    db.data = db.data && typeof db.data === 'object' ? db.data : {};
    db.data.chats = db.data.chats || {};
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
      await db.write();
    }
  } catch (e) {
    console.error('Error persisting chat message:', e);
  }
}

// Function to store offline messages for ADMINS
function storeAdminOfflineMessage(clientId, message) {
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
 
  db.write().catch(err => console.error('Error saving offline message:', err));
}

// Function to deliver offline messages when admin connects
function deliverAdminOfflineMessages() {
  if (!db.data.offline_messages) return;
 
  Object.keys(db.data.offline_messages).forEach(clientId => {
    const messages = db.data.offline_messages[clientId];
    messages.forEach(msg => {
      broadcastToAll(msg.message);
    });
    
    delete db.data.offline_messages[clientId];
  });
 
  db.write().catch(err => console.error('Error clearing offline messages:', err));
}

function broadcastToAll(message, sourceSessionId = null, excludeClientId = null) {
    clients.forEach(c => {
        if (excludeClientId && c.id === excludeClientId) return;
        
        if (message.isAdmin) {
            if (c.id === message.clientId && c.ws.readyState === WebSocket.OPEN) {
                try { c.ws.send(JSON.stringify(message)); } 
                catch (error) { console.error('Error sending message to client:', error); }
            }
            if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                try { c.ws.send(JSON.stringify(message)); }
                catch (error) { console.error('Error sending message to admin:', error); }
            }
        } else {
            if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                try { c.ws.send(JSON.stringify(message)); }
                catch (error) { console.error('Error sending message to admin:', error); }
            }
        }
    });
}

function notifyAdmin(type, payload, targetSessionId = null) {
    clients.forEach(client => {
        if (client.isAdmin && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify({ type, payload, timestamp: new Date().toISOString() }));
            } catch (error) {
                console.error('Error notifying admin:', error);
            }
        }
    });
}

async function sendToClient(clientId, messageText, sourceSessionId = null) {
    const client = clients.get(clientId);
    const adminMessage = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        type: 'chat',
        message: messageText,
        name: 'Support',
        timestamp: new Date().toISOString(),
        isAdmin: true,
        clientId: clientId,
        sessionId: sourceSessionId
    };

    if (client && client.ws.readyState === WebSocket.OPEN) {
        try {
            client.ws.send(JSON.stringify(adminMessage));
            await persistChatMessage(clientId, adminMessage);
            return { success: true, status: 'delivered' };
        } catch (error) {
            console.error('Error sending message to client, will attempt to save:', error);
            await persistChatMessage(clientId, adminMessage);
            return { success: true, status: 'saved_after_error' };
        }
    } else {
        await persistChatMessage(clientId, adminMessage);
        console.log(`Client ${clientId} is offline. Message saved.`);
        return { success: true, status: 'saved_offline' };
    }
}


function sendChatReset(clientId) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        try {
            client.ws.send(JSON.stringify({
                type: 'chat_reset',
                message: 'Chat session has been reset by admin.',
                timestamp: new Date().toISOString(),
                resetToAI: true
            }));
            return true;
        } catch (error) {
            console.error('Error sending chat reset message:', error);
            return false;
        }
    }
    return false;
}

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

async function cleanupGhostChats() {
  try {
    await db.read();
    const chats = db.data.chats || {};
    let removedCount = 0;
    
    Object.keys(chats).forEach(clientId => {
        const chat = chats[clientId];
        if (chat && 
            chat.clientInfo && 
            chat.clientInfo.name === 'Guest' && 
            (!chat.messages || chat.messages.length === 0) &&
            new Date(chat.clientInfo.firstSeen) < new Date(Date.now() - 24 * 60 * 60 * 1000)) {
            
            delete chats[clientId];
            removedCount++;
        }
    });
    
    if (removedCount > 0) {
        await db.write();
        console.log(`Cleaned up ${removedCount} ghost chats`);
    }
  } catch (e) {
    console.error('Error cleaning up ghost chats:', e);
  }
}

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

const allowedOriginsWs = [
    'https://ajk-cleaning.onrender.com',
    'https://ajkcleaners.de',
    'http://ajkcleaners.de',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://ajk-website.onrender.com', // Updated service name
    'http://localhost:3001',
    'http://127.0.0.1:3001'
];

// REPLACED with secure version
async function handleAdminConnection(ws, request) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
        console.warn('Admin WebSocket connection attempt without session ID');
        ws.close(1008, 'Session ID required');
        return;
    }

    const sessionData = adminSessions.get(sessionId);
    if (!sessionData || !sessionData.authenticated) {
        console.warn(`Invalid admin session attempted: ${sessionId}`);
        ws.close(1008, 'Invalid or unauthenticated admin session');
        return;
    }

    // IP validation for security (relaxed for production)
    const clientIP = request.socket.remoteAddress;
    if (sessionData.ip && sessionData.ip !== clientIP) {
        console.warn(`IP mismatch for admin session ${sessionId}. Expected: ${sessionData.ip}, Got: ${clientIP}`);
        // Don't close connection in production - just log the warning
        // ws.close(1008, 'Session security violation - IP mismatch');
        // return;
    }

    // Check session age
    const sessionAge = Date.now() - new Date(sessionData.loginTime).getTime();
    const MAX_SESSION_AGE = 24 * 60 * 60 * 1000; // 24 hours
    if (sessionAge > MAX_SESSION_AGE) {
        console.warn(`Expired admin session attempted: ${sessionId}`);
        adminSessions.delete(sessionId);
        ws.close(1008, 'Session expired');
        return;
    }

    // Rest of existing code...
    const clientId = 'admin_' + sessionId;
    const client = {
        ws,
        isAdmin: true,
        name: sessionData.username || 'Admin',
        id: clientId,
        sessionId: sessionId,
        joined: new Date().toISOString()
    };
    
    clients.set(clientId, client);
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            await handleAdminMessage(client, message);
        } catch (error) {
            console.error('Admin WebSocket message error:', error);
        }
    });
    
    ws.on('close', () => {
        clients.delete(clientId);
        console.log('Admin disconnected:', sessionId);
    });
    
    ws.on('error', (error) => {
        console.error('Admin WebSocket error:', error);
        clients.delete(clientId);
    });
    
    ws.send(JSON.stringify({
        type: 'admin_identified',
        message: 'Admin connection established',
        username: sessionData.username
    }));

    deliverAdminOfflineMessages();
    notifyAdmin('admin_connected', { name: sessionData.username, sessionId });
}


async function handleAdminMessage(adminClient, message) {
    switch (message.type) {
        case 'get_chat_history':
            if (message.clientId) {
                try {
                    await db.read();
                    const clientChat = db.data.chats[message.clientId];
                    
                    const messages = (clientChat && !clientChat.deleted) ? (clientChat.messages || []) : [];
                    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

                    adminClient.ws.send(JSON.stringify({
                        type: 'chat_history',
                        clientId: message.clientId,
                        messages: messages
                    }));
                } catch (error) {
                    console.error('Error loading chat history:', error);
                    adminClient.ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Failed to load chat history'
                    }));
                }
            }
            break;
            
        case 'admin_message':
            if (message.clientId && message.message) {
                const { success, status } = await sendToClient(message.clientId, message.message, adminClient.sessionId);
                if (status === 'saved_offline') {
                    adminClient.ws.send(JSON.stringify({
                        type: 'info',
                        message: 'Client is offline. Message saved for delivery.'
                    }));
                }
            }
            break;
        
        case 'get_clients':
            const clientList = Array.from(clients.values())
                .filter(c => !c.isAdmin)
                .map(c => ({
                    id: c.id,
                    name: c.name,
                    email: c.email,
                    isOnline: c.ws.readyState === WebSocket.OPEN,
                    lastActive: c.lastActive
                }));
            
            try {
                adminClient.ws.send(JSON.stringify({
                    type: 'clients',
                    clients: clientList
                }));
            } catch (error) {
                console.error('Error sending client list:', error);
            }
            break;

        case 'broadcast':
            if (message.message) {
                const broadcastCount = broadcastToClients(message.message, adminClient.sessionId);
                try {
                    adminClient.ws.send(JSON.stringify({
                        type: 'system',
                        message: `Broadcast sent to ${broadcastCount} clients`
                    }));
                } catch (error) {
                    console.error('Error sending broadcast confirmation:', error);
                }
            }
            break;
    }
}


wss.on('connection', async (ws, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const isAdminEndpoint = url.searchParams.get('endpoint') === 'admin';
    
    if (isAdminEndpoint) {
        return handleAdminConnection(ws, request);
    }
    
    const clientIp = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                     request.headers['x-real-ip'] || 
                     request.socket.remoteAddress || 
                     'unknown';
    
    const origin = request.headers.origin;
    if (origin && !allowedOriginsWs.includes(origin)) {
        console.log('WebSocket connection from blocked origin:', origin);
        ws.close(1008, 'Origin not allowed');
        return;
    }
    
    console.log('Client connected:', clientIp);
    
    let clientId;
    let hadProvidedClientId = false;
    try {
        const urlObj = new URL(request.url, `http://${request.headers.host}`);
        const providedClientId = urlObj.searchParams.get('clientId');
        if (providedClientId && /^client_[a-zA-Z0-9_-]{5,}$/.test(providedClientId)) {
            clientId = providedClientId;
            hadProvidedClientId = true;
        } else {
            clientId = 'client_' + Date.now() + Math.random().toString(36).substr(2, 9);
        }
    } catch (_) {
        clientId = 'client_' + Date.now() + Math.random().toString(36).substr(2, 9);
    }

    if (!hadProvidedClientId) {
        try {
            await db.read();
            const chats = (db.data && db.data.chats) ? db.data.chats : {};
            let bestId = null;
            let bestTime = 0;
            for (const [cid, chat] of Object.entries(chats)) {
                if (!chat || chat.deleted) continue;
                const ipMatch = chat.clientInfo && chat.clientInfo.ip === clientIp;
                if (!ipMatch) continue;
                const msgs = Array.isArray(chat.messages) ? chat.messages : [];
                const lastTs = msgs.length ? new Date(msgs[msgs.length - 1].timestamp).getTime() : 0;
                if (lastTs > bestTime && !clients.has(cid)) {
                    bestTime = lastTs;
                    bestId = cid;
                }
            }
            if (bestId) {
                clientId = bestId;
            }
        } catch (e) {
            console.error('Error attempting IP-based chat mapping:', e);
        }
    }
    
    const client = {
        ws,
        ip: clientIp,
        isAdmin: false,
        name: 'Guest',
        email: '',
        id: clientId,
        joined: new Date().toISOString(),
        sessionId: null,
        hasReceivedWelcome: false,
        lastActive: new Date().toISOString()
    };
    clients.set(clientId, client);
    
    // Add connection timeout to clean up unestablished clients
    client.connectionEstablished = false;
    client.connectionTimeout = setTimeout(() => {
        if (!client.connectionEstablished) {
            console.log('⚠️ Client connection timeout, cleaning up:', clientId);
            clients.delete(clientId);
            connectionQuality.delete(clientId);
            notifyAdmin('client_connection_failed', {
                clientId,
                reason: 'Connection timeout - client never properly established connection',
                ip: clientIp
            });
        }
    }, 30000); // 30 second timeout
    
    ws.isAlive = true;
    ws.missedPings = 0;
    ws.connectionStart = Date.now();
    ws.clientId = clientId;
    
    connectionQuality.set(clientId, {
        latency: 0,
        connectedSince: ws.connectionStart,
        missedPings: 0
    });
    
    try {
        await db.read();
        db.data = db.data && typeof db.data === 'object' ? db.data : {};
        db.data.chats = db.data.chats || {};
        
        if (db.data.chats[clientId] && !db.data.chats[clientId].deleted) {
            const existingChatHistory = db.data.chats[clientId].messages || [];
            
            if (existingChatHistory.length > 0) {
                try {
                    ws.send(JSON.stringify({
                        type: 'history',
                        messages: existingChatHistory,
                        clientId: clientId
                    }));
                } catch (error) {
                    console.error('Error sending chat history:', error);
                }
            }
        }
    } catch (e) {
        console.error('Error loading chat history:', e);
    }
    
    notifyAdmin('client_connected', { clientId, ip: clientIp, name: 'Guest' });

    ws.on('message', async (data) => {
        try {
            if (!clients.has(clientId)) {
                console.error('Client not found in clients map:', clientId);
                return;
            }
            
            const client = clients.get(clientId);
            if (!client) {
                console.error('Client object is undefined for:', clientId);
                return;
            }
            
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
            
            client.lastActive = new Date().toISOString();
            
            switch (message.type) {
                case 'chat':
                    // Mark connection as established when first message is received
                    if (!client.connectionEstablished) {
                        client.connectionEstablished = true;
                        if (client.connectionTimeout) {
                            clearTimeout(client.connectionTimeout);
                            client.connectionTimeout = null;
                        }
                        console.log('✅ Client connection established:', clientId);
                    }
                    
                    const messageText = message.message || message.text;
                    if (typeof messageText !== 'string' || messageText.trim().length === 0) {
                        return;
                    }
                    
                    const sanitizedText = validator.escape(messageText.trim()).substring(0, 500);
                    
                    const chatMessage = {
                        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                        type: 'chat',
                        name: client.name,
                        message: sanitizedText,
                        timestamp: new Date().toISOString(),
                        isAdmin: false,
                        clientId: clientId,
                        sessionId: client.sessionId
                    };
                    
                    await persistChatMessage(clientId, chatMessage);
                    
                    let adminOnline = false;
                    clients.forEach(c => {
                        if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
                            adminOnline = true;
                        }
                    });
                    
                    if (!adminOnline) {
                        storeAdminOfflineMessage(clientId, chatMessage);
                    } else {
                        broadcastToAll(chatMessage);
                    }
                    
                    notifyAdmin('new_message', { clientId, name: client.name, message: sanitizedText.substring(0, 50) });
                    
                    if (!adminOnline) {
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
                                try { ws.send(JSON.stringify(autoMsg)); } catch (e) { console.error('Error sending offline auto message:', e); }
                                
                                chatObj.messages.push({
                                    id: autoMsg.id,
                                    message: autoMsg.message,
                                    timestamp: autoMsg.timestamp,
                                    isAdmin: false,
                                    type: 'system'
                                });
                                chatObj.offlineAutoMessageSent = true;
                                await db.write();
                            }
                        } catch (e) {
                            console.error('Error processing offline auto message:', e);
                        }
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
                    if (message.isAdmin) {
                       return;
                    }

                    if (message.name && typeof message.name === 'string') {
                        client.name = validator.escape(message.name.substring(0, 50)) || 'Guest';
                    }
                    if (message.email && typeof message.email === 'string' && validator.isEmail(message.email)) {
                        client.email = message.email;
                    }
                    if (message.sessionId && typeof message.sessionId === 'string') {
                        client.sessionId = message.sessionId;
                    }

                    try {
                        await db.read();
                        db.data.chats = db.data.chats || {};
                        
                        if (!db.data.chats[clientId] || db.data.chats[clientId].deleted) {
                            db.data.chats[clientId] = {
                                clientInfo: {
                                    name: client.name || 'Guest',
                                    email: client.email || '',
                                    ip: client.ip,
                                    firstSeen: new Date().toISOString()
                                },
                                messages: [],
                                status: 'active'
                            };
                        } else {
                            db.data.chats[clientId].clientInfo.name = client.name || db.data.chats[clientId].clientInfo.name || 'Guest';
                            if (client.email) db.data.chats[clientId].clientInfo.email = client.email;
                            db.data.chats[clientId].clientInfo.lastSeen = new Date().toISOString();
                        }
                        await db.write();
                    } catch (e) {
                        console.error('Error upserting chat on identify:', e);
                    }
                    
                    notifyAdmin('client_identified', { clientId, name: client.name, email: client.email });
                    break;
                    
                case 'ping':
                    try {
                        ws.send(JSON.stringify({
                            type: 'pong',
                            timestamp: Date.now()
                        }));
                    } catch (error) {
                        console.error('Error sending pong:', error);
                    }
                    break;
                    
                default:
                    console.log('Unknown message type from:', clientIp, message.type);
            }
        } catch (error) {
            console.error('Error processing message from', clientIp, ':', error);
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Message processing failed'
                }));
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }
    });

    ws.on('close', (code, reason) => {
        if (!clients.has(clientId)) {
            return;
        }
        
        const client = clients.get(clientId);
        if (!client) {
            return;
        }
        
        // Clear connection timeout if it exists
        if (client.connectionTimeout) {
            clearTimeout(client.connectionTimeout);
            client.connectionTimeout = null;
        }
        
        console.log('Client disconnected:', clientIp, clientId, 'Code:', code, 'Reason:', reason.toString());
        
        clients.delete(clientId);
        connectionQuality.delete(clientId);
        
        notifyAdmin('client_disconnected', { 
            clientId, 
            name: client.name,
            reason: reason.toString() || 'No reason given',
            connectionDuration: Date.now() - ws.connectionStart
        });
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error for client', clientIp, ':', error);
        
        // Clear connection timeout if it exists
        const client = clients.get(clientId);
        if (client && client.connectionTimeout) {
            clearTimeout(client.connectionTimeout);
            client.connectionTimeout = null;
        }
        
        clients.delete(clientId);
        connectionQuality.delete(clientId);
    });
    
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

function cleanupAdminSessions() {
    const now = Date.now();
    const TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
    adminSessions.forEach((session, sessionId) => {
        const sessionAge = now - new Date(session.loginTime).getTime();
        if (sessionAge > TIMEOUT) {
            adminSessions.delete(sessionId);
            console.log(`Cleaned up stale admin session: ${sessionId}`);
        }
    });
}

function cleanupStaleConnections() {
    const now = Date.now();
    const STALE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    
    clients.forEach((client, clientId) => {
        if (!client.lastActive) return;
        
        const timeSinceActivity = now - new Date(client.lastActive).getTime();
        if (timeSinceActivity > STALE_TIMEOUT) {
            console.log(`Cleaning up stale connection: ${clientId}`);
            try {
                client.ws.close(1000, 'Connection stale');
            } catch (e) {
                console.error('Error closing stale connection:', e);
            }
            clients.delete(clientId);
            connectionQuality.delete(clientId);
        }
    });
}

setInterval(cleanupStaleConnections, 60 * 1000);


const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Terminating dead connection:', ws.clientId || 'unknown');
            
            if (ws.clientId) {
                const client = clients.get(ws.clientId);
                if (client) {
                    if (client.isAdmin && client.sessionId) {
                        adminSessions.delete(client.sessionId);
                    }
                    clients.delete(ws.clientId);
                    connectionQuality.delete(ws.clientId);
                    
                    if (client.isAdmin) {
                        notifyAdmin('admin_disconnected', { name: client.name, reason: 'timeout' });
                    } else {
                        notifyAdmin('client_disconnected', { clientId: ws.clientId, reason: 'timeout' });
                    }
                }
            }
            
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.missedPings = (ws.missedPings || 0) + 1;

        if (ws.missedPings > 3) {
            console.log('Too many missed pings, terminating:', ws.clientId);
            return ws.terminate();
        }
        
        try {
            ws.ping();
        } catch (error) {
            console.error('Error pinging client:', error);
            ws.terminate();
        }
    });
}, 30000);


const adminSessionCleanupInterval = setInterval(cleanupAdminSessions, 60 * 60 * 1000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(adminSessionCleanupInterval);
});

setTimeout(cleanupGhostChats, 5000);
setInterval(cleanupGhostChats, 60 * 60 * 1000);

app.use((req, res, next) => {
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const host = req.get('host');
    
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://app.usercentrics.eu https://cdn.jsdelivr.net https://cdnjs.cloudflare.com blob: https://js.stripe.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; " +
        "img-src 'self' data: https: blob:; " +
        "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; " +
        `connect-src 'self' ${protocol}://${host} wss://${host} ws://${host} https://generativelanguage.googleapis.com https://api.usercentrics.eu https://privacy-proxy.usercentrics.eu https://www.google-analytics.com https://consent-api.service.consent.usercentrics.eu https://api.stripe.com; ` + 
        "frame-src 'self' https://www.google.com https://app.usercentrics.eu https://js.stripe.com;"
    );
    next();
});

// ==================== RATE LIMITING ====================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
  skip: (req) => {
    return req.session.authenticated;
  }
});

app.use('/api/admin/login', loginLimiter);

// NEW Advanced Rate Limiting
const requestTracker = new Map();
function advancedRateLimit(maxRequests = 100, windowMs = 15 * 60 * 1000) {
    return (req, res, next) => {
        // Skip for authenticated admin users
        if (req.session && req.session.authenticated) {
            return next();
        }

        const ip = req.ip;
        const now = Date.now();

        if (!requestTracker.has(ip)) {
            requestTracker.set(ip, []);
        }

        const requests = requestTracker.get(ip);
        const recentRequests = requests.filter(time => now - time < windowMs);

        if (recentRequests.length >= maxRequests) {
            const oldestRequest = Math.min(...recentRequests);
            const retryAfter = Math.ceil((windowMs - (now - oldestRequest)) / 1000);
            
            res.status(429).json({
                error: 'Too many requests from this IP',
                retryAfter: retryAfter,
                limit: maxRequests,
                window: windowMs / 1000
            });
            return;
        }

        recentRequests.push(now);
        requestTracker.set(ip, recentRequests);

        // Cleanup old entries periodically
        if (Math.random() < 0.01) { // 1% chance
            requestTracker.forEach((times, key) => {
                const recent = times.filter(time => now - time < windowMs);
                if (recent.length === 0) {
                    requestTracker.delete(key);
                } else {
                    requestTracker.set(key, recent);
                }
            });
        }
        
        next();
    };
}

// APPLY to API routes
app.use('/api/', advancedRateLimit(100, 15 * 60 * 1000));
// ==================== END RATE LIMITING ====================

const validateEmail = (email) => {
    return validator.isEmail(email) && email.length <= 254;
};

const validatePhone = (phone) => {
    const phoneRegex = /^[+]?[\d\s\-()]{8,20}$/;
    return phoneRegex.test(phone);
};

const validateFormSubmission = (req, res, next) => {
    const { name, email, phone, message, preferred_date } = req.body;
    
    if (!name || !phone || !message) {
      return res.status(400).json({ success: false, error: 'Name, phone, and message are required' });
    }
    
    if (name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ success: false, error: 'Name must be between 2 and 100 characters' });
    }
    
    if (message.trim().length < 10 || message.trim().length > 1000) {
      return res.status(400).json({ success: false, error: 'Message must be between 10 and 1000 characters' });
    }
    
    if (phone && !validatePhone(phone)) {
        return res.status(400).json({ success: false, error: 'Invalid phone number format' });
    }

    if (email && !validateEmail(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    if (preferred_date && !validator.isISO8601(preferred_date)) {
        return res.status(400).json({ success: false, error: 'Invalid date format' });
    }
    
    next();
};

async function initializeDB() {
    try {
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        await db.read();
        
        if (!db.data || typeof db.data !== 'object') {
            db.data = { submissions: [], admin_users: [], offline_messages: {}, chats: {}, analytics_events: [] };
        }
        
        db.data.submissions = db.data.submissions || [];
        db.data.admin_users = db.data.admin_users || [];
        db.data.chats = db.data.chats || {};
        db.data.analytics_events = db.data.analytics_events || []; // Ensure analytics array exists
        db.data.bookings = db.data.bookings || [];
        
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!adminEmail || !adminPassword) {
            console.error('CRITICAL: ADMIN_EMAIL and ADMIN_PASSWORD must be set in environment variables.');
            console.error('Please set:');
            console.error('ADMIN_EMAIL=your-email@example.com');
            console.error('ADMIN_PASSWORD=your-secure-password');
            process.exit(1);
        }
        
        const adminUser = db.data.admin_users.find(user => user.email === adminEmail);
        if (!adminUser) {
            const hash = await bcrypt.hash(adminPassword, 12);
            db.data.admin_users.push({
                id: Date.now(),
                email: adminEmail,
                username: adminEmail.split('@')[0], // Use email prefix as username
                password_hash: hash,
                created_at: new Date().toISOString()
            });
            await db.write();
            console.log(`✅ Admin user '${adminEmail}' created successfully`);
        } else {
            // Update password if it has changed
            const isValid = await bcrypt.compare(adminPassword, adminUser.password_hash);
            if (!isValid) {
                const hash = await bcrypt.hash(adminPassword, 12);
                adminUser.password_hash = hash;
                await db.write();
                console.log(`✅ Admin password updated for '${adminEmail}'`);
            } else {
                console.log(`✅ Admin user '${adminEmail}' already exists with current password`);
            }
        }
        
        try { await db.write(); } catch (_) {}

        console.log('Database ready at:', dbPath);
        
    } catch (error) {
        console.error('Database initialization error:', error);
        try {
            db.data = { submissions: [], admin_users: [], offline_messages: {}, chats: {}, analytics_events: [] };
            
            const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
            db.data.admin_users.push({
                id: Date.now(),
                email: process.env.ADMIN_EMAIL,
                username: process.env.ADMIN_EMAIL.split('@')[0],
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

app.set('db', db);

function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
}

// =================================================================
// START ANALYTICS ROUTES
// =================================================================
app.post('/api/analytics/track', (req, res) => {
    try {
        const { eventType, path, referrer, sessionId } = req.body;
        
        if (!eventType) {
            return res.status(400).json({ error: 'eventType is required.' });
        }

        const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
        const geo = geoip.lookup(ip);

        const event = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            eventType: validator.escape(eventType.substring(0, 50)),
            path: path ? validator.escape(path.substring(0, 200)) : undefined,
            referrer: referrer ? validator.escape(referrer.substring(0, 500)) : undefined,
            sessionId: sessionId ? validator.escape(sessionId.substring(0, 100)) : undefined,
            ip,
            country: geo ? geo.country : 'Unknown',
            userAgent: req.headers['user-agent']
        };

        analyticsQueue.push(event);
        res.status(202).json({ success: true });
    } catch (err) {
        console.error('Analytics tracking error:', err);
        res.status(500).json({ success: false });
    }
});

async function writeAnalyticsBatch() {
    if (isWritingAnalytics || analyticsQueue.length === 0) {
        return;
    }

    isWritingAnalytics = true;
    const batch = [...analyticsQueue];
    analyticsQueue.length = 0;

    try {
        await db.read();
        db.data.analytics_events.push(...batch);
        await db.write();
        clearCache('analytics');
        console.log(`Wrote ${batch.length} analytics events to the database.`);
    } catch (err) {
        console.error('Error writing analytics batch:', err);
        analyticsQueue.unshift(...batch);
    } finally {
        isWritingAnalytics = false;
    }
}

setInterval(writeAnalyticsBatch, 30000);

app.get('/api/analytics', requireAuth, async (req, res) => {
    try {
        const analyticsData = await cachedRead('analytics', async () => {
            await db.read();
            const events = db.data.analytics_events || [];
            const now = Date.now();
            const last24h = now - (24 * 60 * 60 * 1000);
            const last7d = now - (7 * 24 * 60 * 60 * 1000);
            const last5m = now - (5 * 60 * 1000);

            // Filter events for relevant time periods
            const events24h = events.filter(e => e.timestamp >= last24h);
            const events7d = events.filter(e => e.timestamp >= last7d);

            // 1. Real-Time Users (unique IPs in last 5 mins)
            const realtimeUsers = new Set(events.filter(e => e.timestamp >= last5m).map(e => e.ip)).size;

            // 2. Total Visits (pageviews in last 24h)
            const totalVisits24h = events24h.filter(e => e.eventType === 'pageview').length;

            // 3. Visitors by Country (top 6)
            const countryCounts = events24h.reduce((acc, event) => {
                const country = event.country || 'Unknown';
                acc[country] = (acc[country] || 0) + 1;
                return acc;
            }, {});
            const sortedCountries = Object.entries(countryCounts).sort(([, a], [, b]) => b - a).slice(0, 6);
            const countryData = {
                labels: sortedCountries.map(c => c[0]),
                data: sortedCountries.map(c => c[1])
            };

            // 4. Traffic Sources
            const getSource = (referrer) => {
                if (!referrer) return 'Direct';
                try {
                    const url = new URL(referrer);
                    if (url.hostname.includes('google')) return 'Google';
                    if (url.hostname.includes('facebook')) return 'Facebook';
                    if (url.hostname.includes('instagram')) return 'Instagram';
                    if (url.hostname.includes(req.hostname)) return 'Internal';
                    return 'Referral';
                } catch { return 'Direct'; }
            };
            const trafficCounts = events24h.reduce((acc, event) => {
                const source = getSource(event.referrer);
                acc[source] = (acc[source] || 0) + 1;
                return acc;
            }, {});
            const sortedTraffic = Object.entries(trafficCounts).sort(([, a], [, b]) => b - a).slice(0, 5);
            const trafficSourceData = {
                labels: sortedTraffic.map(t => t[0]),
                data: sortedTraffic.map(t => t[1])
            };

            // 5. Page Views (Last 7 Days)
            const pageViewsByDay = {};
            for (let i = 0; i < 7; i++) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dayKey = d.toISOString().split('T')[0];
                pageViewsByDay[dayKey] = 0;
            }
            events7d.forEach(event => {
                if (event.eventType === 'pageview') {
                    const dayKey = new Date(event.timestamp).toISOString().split('T')[0];
                    if (pageViewsByDay.hasOwnProperty(dayKey)) {
                        pageViewsByDay[dayKey]++;
                    }
                }
            });
            const sortedPageViews = Object.entries(pageViewsByDay).sort((a,b) => new Date(a[0]) - new Date(b[0]));
            const pageViews7d = {
                labels: sortedPageViews.map(p => new Date(p[0]).toLocaleDateString('en-US', { weekday: 'short' })),
                data: sortedPageViews.map(p => p[1])
            };

            // 6 & 7. Avg. Duration & Bounce Rate
            const sessions24h = {};
            events24h.forEach(e => {
                if (!sessions24h[e.ip]) sessions24h[e.ip] = [];
                sessions24h[e.ip].push(e.timestamp);
            });
            
            let totalDuration = 0;
            let bouncedSessions = 0;
            const activeSessions = Object.values(sessions24h);
            if (activeSessions.length > 0) {
                activeSessions.forEach(timestamps => {
                    if (timestamps.length > 1) {
                        const duration = Math.max(...timestamps) - Math.min(...timestamps);
                        totalDuration += duration;
                    } else {
                        bouncedSessions++;
                    }
                });
            }
            const avgDurationMs = activeSessions.length > 0 ? totalDuration / (activeSessions.length - bouncedSessions || 1) : 0;
            const avgDurationSec = Math.round(avgDurationMs / 1000);
            const avgDuration = `${Math.floor(avgDurationSec / 60)}m ${avgDurationSec % 60}s`;
            const bounceRate = activeSessions.length > 0 ? `${Math.round((bouncedSessions / activeSessions.length) * 100)}%` : '0%';

            return {
                realtimeUsers,
                totalVisits24h,
                avgDuration,
                bounceRate,
                countryData,
                trafficSourceData,
                pageViews7d,
            };
        });

        res.json(analyticsData);
    } catch (err) {
        console.error('Error fetching analytics data:', err);
        res.status(500).json({ error: 'Failed to retrieve analytics data.' });
    }
});
// =================================================================
// END ANALYTICS ROUTES
// =================================================================

app.post('/api/form/submit', validateFormSubmission, async (req, res) => {
    try {
        const { name, email, phone, service, message, preferred_date, preferred_time } = req.body;
        
        const sanitizedData = {
            name: validator.escape(name.trim()).substring(0, 100),
            email: email ? validator.normalizeEmail(email) : '',
            phone: phone ? validator.escape(phone.trim()).substring(0, 20) : '',
            service: service ? validator.escape(service.trim()).substring(0, 50) : '',
            message: validator.escape(message.trim()).substring(0, 1000),
            preferred_date: preferred_date || '',
            preferred_time: preferred_time ? validator.escape(preferred_time.trim()).substring(0, 50) : ''
        };
        
        await db.read();
        const submission = {
            id: Date.now(),
            ...sanitizedData,
            submitted_at: new Date().toISOString(),
            ip: req.ip || req.connection.remoteAddress || 'unknown',
            status: 'new' 
        };
        
        db.data.submissions.push(submission);
        await db.write();
        clearCache('submissions'); // ADDED: Invalidate cache
        
        async function sendEmailNotification(formData) {
            console.log('--- Sending Email Notification (Simulation) ---');
            console.log(`To: admin@ajkcleaning.com`);
            console.log(`Body:\nName: ${formData.name}\nEmail: ${formData.email}\nPhone: ${formData.phone}\nService: ${formData.service}\nMessage: ${formData.message}`);
            console.log('---------------------------------------------');
        }

        try {
            await sendEmailNotification(sanitizedData);
        } catch (emailError) {
            console.error('Email notification failed:', emailError);
        }
        
        notifyAdmin('new_submission', {
            id: submission.id,
            name: sanitizedData.name,
            email: sanitizedData.email,
            service: sanitizedData.service
        });
        
        console.log('Form submission received:', { id: submission.id, email: sanitizedData.email });
        
        res.json({ success: true, id: submission.id, message: 'Thank you! Your message has been sent successfully.' });
    } catch (error) {
        console.error('Form submission error:', error);
        res.status(500).json({ success: false, error: 'Internal server error. Please try again or contact us directly.' });
    }
});

app.get('/api/submissions', requireAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 10, 100); // Max 100
        const searchTerm = req.query.search || '';
        const serviceFilter = req.query.service || '';
        const dateFilter = req.query.date || '';
        const sortField = req.query.sortField || 'id';
        const sortDirection = req.query.sortDirection || 'desc';

        // Use cached data
        const submissions = await cachedRead('submissions', async () => {
            await db.read();
            // FIX: Ensure submissions is always an array to prevent crashes
            return (db.data && Array.isArray(db.data.submissions)) ? db.data.submissions : [];
        });

        // Apply filters
        let filtered = [...submissions];

        if (searchTerm) {
            const search = searchTerm.toLowerCase();
            filtered = filtered.filter(s =>
                 (s.name && s.name.toLowerCase().includes(search)) ||
                 (s.email && s.email.toLowerCase().includes(search)) ||
                 (s.phone && s.phone.toLowerCase().includes(search)) ||
                 (s.service && s.service.toLowerCase().includes(search)) ||
                 (s.message && s.message.toLowerCase().includes(search))
            );
        }

        if (serviceFilter) {
            filtered = filtered.filter(s => s.service === serviceFilter);
        }

        if (dateFilter) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            switch(dateFilter) {
                case 'today':
                    filtered = filtered.filter(s => new Date(s.submitted_at) >= today);
                    break;
                case 'week':
                    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
                    filtered = filtered.filter(s => new Date(s.submitted_at) >= weekAgo);
                    break;
                case 'month':
                    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
                    filtered = filtered.filter(s => new Date(s.submitted_at) >= monthAgo);
                    break;
            }
        }

        // Apply sorting
        filtered.sort((a, b) => {
            let valueA, valueB;
            if (sortField === 'date') {
                valueA = new Date(a.submitted_at).getTime();
                valueB = new Date(b.submitted_at).getTime();
            } else {
                valueA = a[sortField] || '';
                valueB = b[sortField] || '';
            }

            if (typeof valueA === 'string') {
                return sortDirection === 'asc'
                         ? valueA.localeCompare(valueB)
                         : valueB.localeCompare(valueA);
            } else {
                return sortDirection === 'asc' ? valueA - valueB : valueB - valueA;
            }
        });

        const total = filtered.length;
        const offset = (page - 1) * limit;
        const paginated = filtered.slice(offset, offset + limit);

        res.json({
            data: paginated,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: offset + limit < total,
                hasPrev: page > 1
            }
        });
    } catch (err) {
        console.error('Error fetching submissions:', err);
        res.status(500).json({ error: 'Server error while loading submissions.' });
    }
});


app.get('/api/submissions/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    
    if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Invalid submission ID' });
    }
    
    try {
        await db.read();
        // FIX: Added robust check for submissions array
        const submissions = (db.data && Array.isArray(db.data.submissions)) ? db.data.submissions : [];
        const submission = submissions.find(s => s.id === id);
        
        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        res.json(submission);
    } catch (err) {
        console.error('Error fetching submission details:', err);
        res.status(500).json({ error: 'Database error while fetching details' });
    }
});

app.delete('/api/submissions/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    
    if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Invalid submission ID' });
    }
    
    try {
        await db.read();
        // FIX: Added robust check for submissions array
        const submissions = (db.data && Array.isArray(db.data.submissions)) ? db.data.submissions : [];
        const initialLength = submissions.length;
        db.data.submissions = submissions.filter(s => s.id !== id);
        
        if (db.data.submissions.length === initialLength) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        
        await db.write();
        clearCache('submissions'); // ADDED: Invalidate cache
        res.json({ success: true, message: 'Submission deleted successfully' });
    } catch (err) {
        console.error('Error deleting submission:', err);
        res.status(500).json({ error: 'Database error during deletion' });
    }
});


app.post('/api/submissions/bulk-delete', requireAuth, async (req, res) => {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'No submission IDs provided' });
    }
    
    try {
        await db.read();
        const submissions = (db.data && Array.isArray(db.data.submissions)) ? db.data.submissions : [];
        const initialLength = submissions.length;
        const idsToDelete = ids.map(id => parseInt(id, 10));
        db.data.submissions = submissions.filter(s => !idsToDelete.includes(s.id));
        const deletedCount = initialLength - db.data.submissions.length;
        
        await db.write();
        clearCache('submissions');
        res.json({ 
            success: true, 
            message: `${deletedCount} submissions deleted successfully`,
            deleted: deletedCount
        });
    } catch (err) {
        console.error('Bulk delete error:', err);
        res.status(500).json({ error: 'Database error during bulk delete' });
    }
});

app.get('/api/submissions/export', requireAuth, async (req, res) => {
    try {
        await db.read();
        const submissions = db.data.submissions || [];
        
        const headers = ['ID', 'Name', 'Email', 'Phone', 'Service', 'Preferred Date', 'Preferred Time', 'Message', 'Date'];
        const csvRows = [headers.join(',')];
        
        submissions.forEach(sub => {
            const row = [
                sub.id,
                `"${(sub.name || '').replace(/"/g, '""')}"`,
                sub.email || '',
                sub.phone || '',
                `"${(sub.service || '').replace(/"/g, '""')}"`,
                sub.preferred_date || '',
                `"${(sub.preferred_time || '').replace(/"/g, '""')}"`,
                `"${(sub.message || '').replace(/"/g, '""')}"`,
                new Date(sub.submitted_at).toISOString()
            ];
            csvRows.push(row.join(','));
        });
        
        const csv = csvRows.join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=submissions-${Date.now()}.csv`);
        res.send(csv);
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: 'Export failed' });
    }
});

// Bookings API endpoints
app.get('/api/bookings', requireAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 10, 100);
        const searchTerm = req.query.search || '';
        const statusFilter = req.query.status || '';
        const dateFrom = req.query.dateFrom || '';
        const dateTo = req.query.dateTo || '';

        await db.read();
        let bookings = db.data.bookings || [];

        // Apply filters
        if (searchTerm) {
            bookings = bookings.filter(booking => 
                booking.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (booking.details?.customerName && booking.details.customerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (booking.details?.customerEmail && booking.details.customerEmail.toLowerCase().includes(searchTerm.toLowerCase()))
            );
        }

        if (statusFilter) {
            bookings = bookings.filter(booking => booking.status === statusFilter);
        }

        if (dateFrom) {
            const fromDate = new Date(dateFrom);
            bookings = bookings.filter(booking => new Date(booking.createdAt) >= fromDate);
        }

        if (dateTo) {
            const toDate = new Date(dateTo);
            toDate.setHours(23, 59, 59, 999);
            bookings = bookings.filter(booking => new Date(booking.createdAt) <= toDate);
        }

        // Sort by creation date (newest first)
        bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Calculate pagination
        const totalBookings = bookings.length;
        const totalPages = Math.ceil(totalBookings / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedBookings = bookings.slice(startIndex, endIndex);

        // Calculate stats
        const paidBookings = bookings.filter(b => b.status === 'paid' || b.status === 'confirmed' || b.status === 'in_progress' || b.status === 'completed');
        const stats = {
            total: totalBookings,
            revenue: paidBookings.reduce((sum, booking) => sum + (booking.amount || 0), 0),
            pending: bookings.filter(b => b.status === 'pending_payment').length,
            completed: bookings.filter(b => b.status === 'completed').length
        };

        res.json({
            data: paginatedBookings,
            pagination: {
                page,
                totalPages,
                total: totalBookings,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            stats
        });
    } catch (err) {
        console.error('Error fetching bookings:', err);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

app.get('/api/bookings/:id', requireAuth, async (req, res) => {
    try {
        await db.read();
        const bookings = db.data.bookings || [];
        const booking = bookings.find(b => b.id === req.params.id);
        
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json(booking);
    } catch (err) {
        console.error('Error fetching booking:', err);
        res.status(500).json({ error: 'Failed to fetch booking' });
    }
});

app.get('/api/bookings/by-payment-intent/:paymentIntentId', async (req, res) => {
    try {
        await db.read();
        const bookings = db.data.bookings || [];
        const booking = bookings.find(b => b.paymentIntentId === req.params.paymentIntentId);
        
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json(booking);
    } catch (err) {
        console.error('Error fetching booking by payment intent:', err);
        res.status(500).json({ error: 'Failed to fetch booking' });
    }
});

app.put('/api/bookings/:id/status', requireAuth, async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['pending_payment', 'paid', 'confirmed', 'in_progress', 'completed', 'payment_failed', 'cancelled'];
        
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        await db.read();
        const bookings = db.data.bookings || [];
        const bookingIndex = bookings.findIndex(b => b.id === req.params.id);
        
        if (bookingIndex === -1) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        bookings[bookingIndex].status = status;
        bookings[bookingIndex].updatedAt = new Date().toISOString();
        
        await db.write();
        res.json({ success: true, message: 'Booking status updated successfully' });
    } catch (err) {
        console.error('Error updating booking status:', err);
        res.status(500).json({ error: 'Failed to update booking status' });
    }
});

app.get('/api/bookings/export', requireAuth, async (req, res) => {
    try {
        await db.read();
        const bookings = db.data.bookings || [];
        
        const headers = ['ID', 'Customer Name', 'Customer Email', 'Customer Phone', 'Package', 'Date', 'Time', 'Duration', 'Cleaners', 'Amount', 'Status', 'Created At'];
        const csvRows = [headers.join(',')];
        
        bookings.forEach(booking => {
            const row = [
                booking.id,
                booking.details?.customerName || '',
                booking.details?.customerEmail || '',
                booking.details?.customerPhone || '',
                booking.details?.package || '',
                booking.details?.date || '',
                booking.details?.time || '',
                booking.details?.duration || '',
                booking.details?.cleaners || '',
                booking.amount || 0,
                booking.status || '',
                new Date(booking.createdAt).toLocaleString()
            ];
            csvRows.push(row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','));
        });
        
        const csv = csvRows.join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=bookings-${Date.now()}.csv`);
        res.send(csv);
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: 'Export failed' });
    }
});

// Quick fix: Update all pending payments to paid
app.post('/api/bookings/update-all-pending', async (req, res) => {
    try {
        await db.read();
        const bookings = db.data.bookings || [];
        let updatedCount = 0;
        
        for (let booking of bookings) {
            if (booking.status === 'pending_payment') {
                booking.status = 'paid';
                booking.paidAt = new Date().toISOString();
                booking.updatedAt = new Date().toISOString();
                updatedCount++;
            }
        }
        
        if (updatedCount > 0) {
            await db.write();
            res.json({ 
                success: true, 
                message: `Updated ${updatedCount} bookings to paid status`,
                updatedCount 
            });
        } else {
            res.json({ 
                success: true, 
                message: 'No pending bookings found',
                updatedCount: 0 
            });
        }
    } catch (error) {
        console.error('Error updating pending bookings:', error);
        res.status(500).json({ error: 'Failed to update bookings' });
    }
});

// Create commercial booking (no payment required)
app.post('/api/bookings/commercial-create', async (req, res) => {
    try {
        const { bookingDetails } = req.body;
        
        if (!bookingDetails) {
            return res.status(400).json({ error: 'Booking details are required' });
        }

        // Validate required fields
        if (!bookingDetails.customerEmail || !bookingDetails.customerName) {
            return res.status(400).json({ error: 'Customer email and name are required' });
        }

        console.log(`[COMMERCIAL] 📋 Creating commercial booking:`, bookingDetails);
        console.log(`[COMMERCIAL] 📧 Customer Email:`, bookingDetails.customerEmail);
        console.log(`[COMMERCIAL] 📅 Booking Date:`, bookingDetails.date);

        // Check if booking already exists (by email and date)
        await db.read();
        
        // Ensure bookings array exists
        if (!db.data.bookings) {
            db.data.bookings = [];
        }
        
        console.log(`[COMMERCIAL] 📊 Total existing bookings:`, db.data.bookings.length);
        const existingBooking = db.data.bookings.find(b => 
            b.details && 
            b.details.customerEmail === bookingDetails.customerEmail && 
            b.details.date === bookingDetails.date &&
            b.details.package === 'commercial'
        );
        
        if (existingBooking) {
            console.log(`[COMMERCIAL] ⚠️ Duplicate booking found, skipping email`);
            return res.json({ 
                status: 'exists', 
                message: 'Commercial booking already exists for this email and date',
                booking: existingBooking 
            });
        }

        // Create the commercial booking record
        const newBooking = {
            id: `booking_${Date.now()}`,
            details: bookingDetails,
            amount: 0, // Commercial bookings have no fixed amount
            status: 'pending_consultation', // Special status for commercial
            paymentIntentId: null, // No payment intent for commercial
            paidAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        console.log(`[COMMERCIAL] 📦 Creating commercial booking:`, newBooking);
        
        db.data.bookings.push(newBooking);
        await db.write();
        
        console.log(`[COMMERCIAL] ✅ Created commercial booking ${newBooking.id}`);
        console.log(`[COMMERCIAL] 📊 Total bookings in database:`, db.data.bookings.length);
        
        // Send commercial booking confirmation email (non-blocking)
        sendCommercialBookingConfirmation(newBooking)
            .then(() => {
                console.log(`[COMMERCIAL] 📧 Confirmation email sent for booking ${newBooking.id}`);
            })
            .catch(emailError => {
                console.error(`[COMMERCIAL] ❌ Failed to send confirmation email for booking ${newBooking.id}:`, emailError.message);
                console.error(`[COMMERCIAL] ❌ Full error:`, emailError);
                // Email failure doesn't affect booking completion
            });
        
        res.json({ 
            status: 'created', 
            message: 'Commercial booking created successfully',
            booking: newBooking 
        });

    } catch (error) {
        console.error('[COMMERCIAL] ❌ Error creating commercial booking:', error);
        res.status(500).json({ error: 'Failed to create commercial booking: ' + error.message });
    }
});

// Manual trigger to create booking (for testing)
app.post('/api/bookings/manual-create', async (req, res) => {
    try {
        const { paymentIntentId } = req.body;
        
        if (!paymentIntentId) {
            return res.status(400).json({ error: 'Payment Intent ID is required' });
        }

        console.log(`[MANUAL] 🔍 Looking for payment intent: ${paymentIntentId}`);

        // Retrieve payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        console.log(`[MANUAL] 📋 Payment Intent Status: ${paymentIntent.status}`);
        console.log(`[MANUAL] 📋 Payment Intent Metadata:`, paymentIntent.metadata);
        
        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({ 
                error: `Payment not successful. Status: ${paymentIntent.status}` 
            });
        }

        // Check if booking already exists
        await db.read();
        const existingBooking = db.data.bookings.find(b => b.paymentIntentId === paymentIntentId);
        if (existingBooking) {
            return res.json({ 
                status: 'exists', 
                message: 'Booking already exists',
                booking: existingBooking 
            });
        }

        // Parse booking details from metadata (handle both old and new format)
        let bookingDetails;
        if (paymentIntent.metadata.bookingDetailsId && global.tempBookingDetails) {
            // New format: retrieve from temp storage
            const tempId = paymentIntent.metadata.bookingDetailsId;
            if (global.tempBookingDetails.has(tempId)) {
                bookingDetails = global.tempBookingDetails.get(tempId);
                global.tempBookingDetails.delete(tempId);
            } else {
                bookingDetails = {};
            }
        } else if (paymentIntent.metadata.bookingDetails) {
            // Old format: parse from metadata
            bookingDetails = JSON.parse(paymentIntent.metadata.bookingDetails);
        } else {
            bookingDetails = {};
        }
        const totalAmount = parseFloat(paymentIntent.metadata.totalAmount || '0');
        
        console.log(`[MANUAL] 📝 Parsed booking details:`, bookingDetails);
        console.log(`[MANUAL] 💰 Total amount:`, totalAmount);
        
        // Create the booking record
        const newBooking = {
            id: `booking_${Date.now()}`,
            details: bookingDetails,
            amount: totalAmount,
            status: 'paid',
            paymentIntentId: paymentIntentId,
            paidAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
        };
        
        console.log(`[MANUAL] 📦 Creating booking:`, newBooking);
        
        db.data.bookings.push(newBooking);
        await db.write();
        
        console.log(`[MANUAL] ✅ Created booking ${newBooking.id}`);
        console.log(`[MANUAL] 📊 Total bookings in database:`, db.data.bookings.length);
        
        // Send invoice email to customer
        try {
            await sendBookingInvoice(newBooking);
            console.log(`[MANUAL] 📧 Invoice email sent for booking ${newBooking.id}`);
        } catch (emailError) {
            console.error(`[MANUAL] ❌ Failed to send invoice email for booking ${newBooking.id}:`, emailError.message);
        }
        
        // Send admin notification for new booking
        try {
            await sendAdminNotification(newBooking);
            console.log(`[MANUAL] 📧 Admin notification sent for booking ${newBooking.id}`);
        } catch (adminError) {
            console.error(`[MANUAL] ❌ Failed to send admin notification for booking ${newBooking.id}:`, adminError.message);
        }
        
        res.json({ 
            status: 'created', 
            message: 'Booking created successfully',
            booking: newBooking 
        });

    } catch (error) {
        console.error('[MANUAL] ❌ Error creating booking:', error);
        res.status(500).json({ error: 'Failed to create booking: ' + error.message });
    }
});

// Create booking manually if webhook failed
app.post('/api/bookings/create-from-payment', async (req, res) => {
    try {
        const { paymentIntentId } = req.body;
        
        if (!paymentIntentId) {
            return res.status(400).json({ error: 'Payment Intent ID is required' });
        }

        // Check if booking already exists
        await db.read();
        const existingBooking = db.data.bookings.find(b => b.paymentIntentId === paymentIntentId);
        if (existingBooking) {
            return res.json({ 
                status: 'exists', 
                message: 'Booking already exists',
                booking: existingBooking 
            });
        }

        // Retrieve payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({ 
                error: `Payment not successful. Status: ${paymentIntent.status}` 
            });
        }

        // Parse booking details from metadata (handle both old and new format)
        let bookingDetails;
        if (paymentIntent.metadata.bookingDetailsId && global.tempBookingDetails) {
            // New format: retrieve from temp storage
            const tempId = paymentIntent.metadata.bookingDetailsId;
            if (global.tempBookingDetails.has(tempId)) {
                bookingDetails = global.tempBookingDetails.get(tempId);
                global.tempBookingDetails.delete(tempId);
            } else {
                bookingDetails = {};
            }
        } else if (paymentIntent.metadata.bookingDetails) {
            // Old format: parse from metadata
            bookingDetails = JSON.parse(paymentIntent.metadata.bookingDetails);
        } else {
            bookingDetails = {};
        }
        const totalAmount = parseFloat(paymentIntent.metadata.totalAmount || '0');
        
        // Create the booking record
        const newBooking = {
            id: `booking_${Date.now()}`,
            details: bookingDetails,
            amount: totalAmount,
            status: 'paid',
            paymentIntentId: paymentIntentId,
            paidAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
        };
        
        db.data.bookings.push(newBooking);
        await db.write();
        
        // Send invoice email to customer
        try {
            await sendBookingInvoice(newBooking);
            console.log(`[PAYMENT] 📧 Invoice email sent for booking ${newBooking.id}`);
        } catch (emailError) {
            console.error(`[PAYMENT] ❌ Failed to send invoice email for booking ${newBooking.id}:`, emailError.message);
        }
        
        // Send admin notification for new booking
        try {
            await sendAdminNotification(newBooking);
            console.log(`[PAYMENT] 📧 Admin notification sent for booking ${newBooking.id}`);
        } catch (adminError) {
            console.error(`[PAYMENT] ❌ Failed to send admin notification for booking ${newBooking.id}:`, adminError.message);
        }
        
        res.json({ 
            status: 'created', 
            message: 'Booking created successfully',
            booking: newBooking 
        });

    } catch (error) {
        console.error('Error creating booking from payment:', error);
        res.status(500).json({ error: 'Failed to create booking from payment' });
    }
});

// Manual payment status check endpoint (for testing/debugging)
app.post('/api/bookings/check-payment-status', async (req, res) => {
    try {
        const { bookingId } = req.body;
        
        if (!bookingId) {
            return res.status(400).json({ error: 'Booking ID is required' });
        }

        await db.read();
        const bookings = db.data.bookings || [];
        const booking = bookings.find(b => b.id === bookingId);
        
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // If booking is already paid, return current status
        if (booking.status === 'paid') {
            return res.json({ 
                status: 'paid', 
                message: 'Booking is already marked as paid',
                booking: booking 
            });
        }

        // Check with Stripe if payment was successful
        if (booking.paymentIntentId) {
            try {
                const paymentIntent = await stripe.paymentIntents.retrieve(booking.paymentIntentId);
                
                if (paymentIntent.status === 'succeeded') {
                    // Update booking status
                    const bookingIndex = bookings.findIndex(b => b.id === bookingId);
                    if (bookingIndex !== -1) {
                        bookings[bookingIndex].status = 'paid';
                        bookings[bookingIndex].paidAt = new Date().toISOString();
                        await db.write();
                        
                        return res.json({ 
                            status: 'updated', 
                            message: 'Booking status updated to paid',
                            booking: bookings[bookingIndex]
                        });
                    }
                } else if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'requires_confirmation') {
                    return res.json({ 
                        status: 'pending', 
                        message: `Payment status: ${paymentIntent.status}`,
                        booking: booking 
                    });
                } else if (paymentIntent.status === 'canceled' || paymentIntent.status === 'payment_failed') {
                    // Update booking status to failed
                    const bookingIndex = bookings.findIndex(b => b.id === bookingId);
                    if (bookingIndex !== -1) {
                        bookings[bookingIndex].status = 'payment_failed';
                        bookings[bookingIndex].failedAt = new Date().toISOString();
                        await db.write();
                    }
                    
                    return res.json({ 
                        status: 'failed', 
                        message: `Payment failed: ${paymentIntent.status}`,
                        booking: bookings[bookingIndex]
                    });
                } else {
                    return res.json({ 
                        status: 'unknown', 
                        message: `Payment status: ${paymentIntent.status}`,
                        booking: booking 
                    });
                }
            } catch (stripeError) {
                console.error('Stripe error:', stripeError);
                return res.status(500).json({ error: 'Failed to check payment status with Stripe' });
            }
        }

        return res.json({ 
            status: 'no_payment_intent', 
            message: 'No payment intent found for this booking',
            booking: booking 
        });

    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({ error: 'Failed to check payment status' });
    }
});

app.get('/api/statistics', requireAuth, async (req, res) => {
    try {
        await db.read();
        const submissions = db.data.submissions || [];
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

app.get('/api/chat/stats', requireAuth, async (req, res) => {
    const connectedClients = Array.from(clients.values());
    const adminClients = connectedClients.filter(client => client.isAdmin);
    const userClients = connectedClients.filter(client => !client.isAdmin);
    
    await db.read();
    const totalMessages = Object.values(db.data.chats || {}).reduce((acc, chat) => acc + (chat.messages ? chat.messages.length : 0), 0);

    res.json({
        connectedClients: clients.size,
        activeChats: userClients.length,
        totalMessages: totalMessages,
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

app.post('/api/chat/send', requireAuth, async (req, res) => {
    const { clientId, message } = req.body;
    
    if (!clientId || !message) {
        return res.status(400).json({ success: false, error: 'Client ID and message are required' });
    }

    const { success, status } = await sendToClient(clientId, message);
    if (status === 'delivered') {
        return res.json({ success: true, message: 'Message sent successfully' });
    } else {
        return res.json({ success: true, message: 'Client offline. Message saved.' });
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

app.get('/api/chat/history/:clientId', requireAuth, async (req, res) => {
    const { clientId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    try {
        await db.read();
        const chats = (db.data && db.data.chats) ? db.data.chats : {};
        const chat = chats[clientId];
        const messages = (chat && !chat.deleted && Array.isArray(chat.messages)) ? chat.messages : [];
        
        const start = Math.max(0, messages.length - limit);
        return res.json(messages.slice(start));
    } catch (e) {
        console.error('Error reading chat history from DB:', e);
        return res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/chat/history', requireAuth, async (req, res) => {
    try {
        await db.read();
        const allMessages = Object.values(db.data.chats || {})
            .flatMap(chat => (chat.messages || []).map(msg => ({ ...msg, clientId: chat.clientInfo ? chat.clientInfo.id : 'unknown' }))); // Add clientId for context
        allMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const limit = parseInt(req.query.limit) || 100;
        const paginatedMessages = allMessages.slice(0, limit);
        res.json(paginatedMessages);
    } catch (error) {
        console.error('Error fetching all chat history:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    await db.read();
    const chats = (db.data && db.data.chats) ? db.data.chats : {};
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/chats/:clientId', requireAuth, async (req, res) => {
    const clientId = req.params.clientId;
    
    try {
        await db.read();
        db.data = db.data && typeof db.data === 'object' ? db.data : {};
        db.data.chats = db.data.chats || {};
        
        if (db.data.chats[clientId]) {
            delete db.data.chats[clientId];
            
            if (db.data.offline_messages && db.data.offline_messages[clientId]) {
                delete db.data.offline_messages[clientId];
            }
            
            await db.write();

            const liveClient = clients.get(clientId);
            if (liveClient && liveClient.ws && liveClient.ws.readyState === WebSocket.OPEN) {
                try {
                    liveClient.ws.send(JSON.stringify({
                        type: 'chat_reset',
                        message: 'Chat session has been reset by admin. You are now connected to AI assistant.',
                        timestamp: new Date().toISOString(),
                        resetToAI: true
                    }));
                    
                    setTimeout(() => {
                        try {
                            liveClient.ws.close(1000, 'Chat reset by admin');
                        } catch (e) {
                            console.error('Error during delayed closing of client connection:', e);
                        }
                    }, 500);
                } catch (e) {
                    console.error('Error notifying client of chat reset:', e);
                }
            }
            
            clients.delete(clientId);

            res.json({ success: true, message: 'Chat completely deleted and client notified if online.' });
        } else {
            res.status(404).json({ error: 'Chat not found' });
        }
    } catch (err) {
        console.error('Chat deletion error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});


app.post('/api/chats/:clientId/status', requireAuth, async (req, res) => {
    const { clientId } = req.params;
    const { status } = req.body;

    if (!['active', 'resolved'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        await db.read();
        if (db.data.chats[clientId]) {
            db.data.chats[clientId].status = status;
            await db.write();
            res.json({ success: true, message: `Chat status updated to ${status}` });
        } else {
            res.status(404).json({ error: 'Chat not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/chats/resolve/:clientId', requireAuth, async (req, res) => {
    const clientId = req.params.clientId;

    try {
        await db.read();
        db.data = db.data && typeof db.data === 'object' ? db.data : {};
        db.data.chats = db.data.chats || {};
        if (db.data.chats[clientId]) {
            db.data.chats[clientId].status = 'resolved';
            await db.write();
            res.json({ success: true, message: 'Chat resolved successfully' });
        } else {
            res.status(404).json({ error: 'Chat not found' });
        }
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/chats/:clientId', requireAuth, async (req, res) => {
  const clientId = req.params.clientId;
 
  try {
    await db.read();
    db.data = db.data && typeof db.data === 'object' ? db.data : {};
    db.data.chats = db.data.chats || {};
    if (db.data.chats[clientId] && !db.data.chats[clientId].deleted) {
      res.json(db.data.chats[clientId]);
    } else {
      res.status(404).json({ error: 'Chat not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Orphaned chat management endpoints
app.get('/api/chats/orphaned-info', requireAuth, async (req, res) => {
    try {
        const connectedClients = Array.from(clients.values());
        const orphanedClients = connectedClients.filter(client => 
            !client.connectionEstablished && 
            client.connectionTimeout && 
            !client.isAdmin
        );
        
        res.json({
            orphanedCount: orphanedClients.length,
            orphanedClients: orphanedClients.map(client => ({
                clientId: client.id,
                name: client.name || 'Unknown',
                joined: client.joined,
                ip: client.ip || 'Unknown',
                timeSinceJoined: Date.now() - new Date(client.joined).getTime()
            }))
        });
    } catch (err) {
        console.error('Error fetching orphaned chat info:', err);
        res.status(500).json({ error: 'Failed to fetch orphaned chat information' });
    }
});

app.post('/api/chats/cleanup-orphaned', requireAuth, async (req, res) => {
    try {
        const connectedClients = Array.from(clients.values());
        const orphanedClients = connectedClients.filter(client => 
            !client.connectionEstablished && 
            client.connectionTimeout && 
            !client.isAdmin
        );
        
        let cleanedCount = 0;
        orphanedClients.forEach(client => {
            if (client.connectionTimeout) {
                clearTimeout(client.connectionTimeout);
            }
            clients.delete(client.id);
            connectionQuality.delete(client.id);
            cleanedCount++;
        });
        
        res.json({
            success: true,
            message: `Cleaned up ${cleanedCount} orphaned chat sessions`,
            cleanedCount
        });
    } catch (err) {
        console.error('Error cleaning up orphaned chats:', err);
        res.status(500).json({ error: 'Failed to clean up orphaned chats' });
    }
});

app.get('/api/health/detailed', (req, res) => {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(uptime),
        memory: {
            used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
            total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB'
        },
        connections: {
            websocket: clients.size,
            admin: Array.from(clients.values()).filter(c => c.isAdmin).length,
            users: Array.from(clients.values()).filter(c => !c.isAdmin).length
        },
        database: {
            submissions: db.data.submissions?.length || 0,
            chats: Object.keys(db.data.chats || {}).length
        }
    });
});

app.post('/api/admin/login', async (req, res) => {
    const { username, password, sessionId, deviceType } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    
    try {
        await db.read();
        // Support both email and username for backward compatibility
        const user = db.data.admin_users.find(u => u.email === username || u.username === username);
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const isValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        req.session.authenticated = true;
        req.session.user = { id: user.id, username: user.username, email: user.email };
        
        if (sessionId) {
            adminSessions.set(sessionId, {
                id: sessionId,
                username: user.username,
                email: user.email,
                loginTime: new Date().toISOString(),
                deviceType: deviceType || 'unknown',
                ip: req.ip,
                authenticated: true
            });
        }
        
        res.json({ success: true, message: 'Login successful' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    const { sessionId } = req.body;
    
    if (sessionId) {
        adminSessions.delete(sessionId);
    }
    
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logout successful' });
    });
});

app.get('/api/admin/status', (req, res) => {
    res.json({ authenticated: !!req.session.authenticated });
});

app.get('/api/admin/backup', requireAuth, async (req, res) => {
    try {
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        const backupFile = path.join(backupDir, `backup-${Date.now()}.json`);
        await db.read();
        
        fs.writeFileSync(backupFile, JSON.stringify(db.data, null, 2));
        
        const files = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('backup-'))
            .sort()
            .reverse();
            
        if (files.length > 10) {
            files.slice(10).forEach(f => {
                fs.unlinkSync(path.join(backupDir, f));
            });
        }
        
        res.json({ 
            success: true, 
            message: `Backup created: ${path.basename(backupFile)}`,
            file: path.basename(backupFile)
        });
    } catch (err) {
        console.error('Backup error:', err);
        res.status(500).json({ error: 'Backup failed' });
    }
});

app.post('/create-payment-intent', async (req, res) => {
    const { totalAmount, bookingDetails } = req.body;

    // Basic validation
    if (typeof totalAmount !== 'number' || totalAmount <= 0) {
        return res.status(400).json({ error: 'Invalid total amount specified.' });
    }

    // Amount in cents for Stripe
    const amountInCents = Math.round(totalAmount * 100);
    
    // Minimum charge amount is €0.50 for many card types
    if (amountInCents < 50) {
         return res.status(400).json({ error: 'Amount must be at least €0.50.' });
    }

    try {
        // Store full booking details temporarily and reference by ID
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Store in a simple in-memory cache (in production, use Redis or database)
        if (!global.tempBookingDetails) {
            global.tempBookingDetails = new Map();
        }
        global.tempBookingDetails.set(tempId, bookingDetails);
        
        // Clean up old entries (older than 1 hour)
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        for (const [key, value] of global.tempBookingDetails.entries()) {
            const timestamp = parseInt(key.split('_')[1]);
            if (timestamp < oneHourAgo) {
                global.tempBookingDetails.delete(key);
            }
        }
        
        // Create payment intent with reference to full details
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: 'eur',
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                bookingDetailsId: tempId,
                totalAmount: totalAmount.toString()
            }
        });

        console.log(`[STRIPE] 💳 Created PaymentIntent ${paymentIntent.id}`);

        res.send({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id
        });
    } catch (e) {
        console.error('Stripe Payment Intent creation failed:', e.message);
        res.status(500).json({ error: `Payment Intent creation failed: ${e.message}` });
    }
});

app.use(express.static(path.join(__dirname), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
        else if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
        else if (filePath.endsWith('.ico')) res.setHeader('Content-Type', 'image/x-icon');
        else if (filePath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
        else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) res.setHeader('Content-Type', 'image/jpeg');
        else if (filePath.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
    }
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// FIXED: Generate and inject CSRF token for admin pages
app.get(['/admin', '/admin/login'], (req, res) => {
    const csrfToken = req.csrfToken();
    
    try {
        const adminHtmlPath = path.join(__dirname, 'admin.html');
        if (!fs.existsSync(adminHtmlPath)) {
             console.error("admin.html not found at:", adminHtmlPath);
             return res.status(500).send("<h1>Error: Admin interface file not found.</h1><p>Please ensure 'admin.html' exists in the root directory.</p>");
        }
        const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');
        
        // Inject CSRF token into the meta tag AND a global JavaScript variable for easy access
        const injectedHtml = adminHtml
            .replace(
                '<meta name="csrf-token" content="">', // Specifically target the empty placeholder
                `<meta name="csrf-token" content="${csrfToken}">\n    <script>window.CSRF_TOKEN = "${csrfToken}";</script>`
            );
            
        res.send(injectedHtml);
    } catch (error) {
        console.error("Could not read or process admin.html file:", error);
        res.status(500).send("<h1>Error loading admin page. Check server logs for details.</h1>");
    }
});

app.get('/booking', (req, res) => {
    res.sendFile(path.join(__dirname, 'booking.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

app.get('/impressum', (req, res) => {
    res.sendFile(path.join(__dirname, 'impressum.html'));
});

app.get('/datenschutz', (req, res) => {
    res.sendFile(path.join(__dirname, 'datenschutz.html'));
});

app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});


// Final error handling and server start
app.use((err, req, res, next) => {
    console.error('Server error:', err);
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

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (isProduction) {
        process.exit(1);
    }
});

function gracefulShutdown(signal) {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    
    server.close(() => {
        console.log('HTTP server closed');
        
        wss.close(() => {
            console.log('WebSocket server closed');
            console.log('Cleanup completed');
            process.exit(0);
        });
    });
    
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

initializeDB().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`=== SERVER STARTING on ${new Date().toLocaleString()} ===`);
        console.log(`Environment: ${NODE_ENV}`);
        console.log(`Server running on port ${PORT}`);
        console.log(`Database path: ${dbPath}`);
        console.log(`WebSocket chat server: READY`);
        console.log(`=== SERVER READY ===`);
    });
}).catch(err => {
    console.error('Failed to initialize and start server:', err);
    process.exit(1);
});