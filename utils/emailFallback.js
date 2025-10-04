const nodemailer = require('nodemailer');

// Alternative email configurations for Render free tier
const emailConfigs = [
    // Configuration 1: Gmail with enhanced settings
    {
        name: 'Gmail Enhanced',
        config: {
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            connectionTimeout: 30000,
            greetingTimeout: 15000,
            socketTimeout: 30000,
            pool: false,
            tls: {
                rejectUnauthorized: false,
                ciphers: 'SSLv3'
            }
        }
    },
    // Configuration 2: Gmail with different port
    {
        name: 'Gmail Port 465',
        config: {
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            connectionTimeout: 30000,
            greetingTimeout: 15000,
            socketTimeout: 30000,
            pool: false,
            tls: {
                rejectUnauthorized: false
            }
        }
    },
    // Configuration 3: Outlook/Hotmail (alternative)
    {
        name: 'Outlook',
        config: {
            host: 'smtp-mail.outlook.com',
            port: 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            connectionTimeout: 30000,
            greetingTimeout: 15000,
            socketTimeout: 30000,
            pool: false,
            tls: {
                rejectUnauthorized: false
            }
        }
    }
];

// Function to test email configuration
async function testEmailConfig(config) {
    try {
        console.log(`🔧 Testing ${config.name} with:`, {
            host: config.config.host,
            port: config.config.port,
            secure: config.config.secure,
            user: config.config.auth?.user ? '***@gmail.com' : 'undefined'
        });
        
        const transporter = nodemailer.createTransport(config.config);
        await transporter.verify();
        console.log(`✅ ${config.name} configuration is working`);
        return transporter;
    } catch (error) {
        console.log(`❌ ${config.name} configuration failed:`, error.message);
        return null;
    }
}

// Function to find working email configuration
async function getWorkingEmailTransporter() {
    console.log('🔍 Testing email configurations...');
    
    for (const config of emailConfigs) {
        const transporter = await testEmailConfig(config);
        if (transporter) {
            console.log(`✅ Using ${config.name} for email service`);
            return transporter;
        }
    }
    
    console.log('❌ No working email configuration found');
    return null;
}

// Function to send email with fallback configurations
async function sendEmailWithFallback(mailOptions, maxRetries = 3) {
    let transporter = null;
    let lastError = null;
    
    // Try to get a working transporter
    transporter = await getWorkingEmailTransporter();
    
    if (!transporter) {
        console.log('❌ No working email configuration available - skipping email');
        return false; // Return false instead of throwing error
    }
    
    // Try sending with retry logic
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`📧 Sending email (attempt ${attempt}/${maxRetries})...`);
            await transporter.sendMail(mailOptions);
            console.log('✅ Email sent successfully');
            return true;
        } catch (error) {
            lastError = error;
            console.error(`❌ Email send failed (attempt ${attempt}/${maxRetries}):`, error.message);
            
            if (attempt < maxRetries) {
                // Try different configuration on retry
                if (attempt === 2) {
                    console.log('🔄 Trying alternative email configuration...');
                    transporter = await getWorkingEmailTransporter();
                }
                
                const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
                console.log(`⏳ Waiting ${delay/1000} seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    console.log('❌ All email attempts failed - continuing without email');
    return false; // Return false instead of throwing error
}

module.exports = {
    getWorkingEmailTransporter,
    sendEmailWithFallback,
    testEmailConfig
};
