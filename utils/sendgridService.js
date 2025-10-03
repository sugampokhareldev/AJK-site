const nodemailer = require('nodemailer');

// SendGrid configuration for Render free tier
const sendGridTransporter = nodemailer.createTransport({
    service: 'SendGrid',
    auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
    }
});

// Alternative SendGrid configuration using SMTP
const sendGridSMTPTransporter = nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
    }
});

// Function to send email using SendGrid
async function sendEmailWithSendGrid(mailOptions) {
    try {
        console.log('📧 Sending email via SendGrid...');
        await sendGridTransporter.sendMail(mailOptions);
        console.log('✅ Email sent successfully via SendGrid');
        return true;
    } catch (error) {
        console.log('🔄 SendGrid service failed, trying SMTP...');
        try {
            await sendGridSMTPTransporter.sendMail(mailOptions);
            console.log('✅ Email sent successfully via SendGrid SMTP');
            return true;
        } catch (smtpError) {
            console.error('❌ SendGrid SMTP also failed:', smtpError.message);
            throw smtpError;
        }
    }
}

module.exports = {
    sendEmailWithSendGrid,
    sendGridTransporter,
    sendGridSMTPTransporter
};
