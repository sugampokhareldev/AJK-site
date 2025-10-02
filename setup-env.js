#!/usr/bin/env node

/**
 * AJK Cleaning Company - Environment Setup Script
 * This script helps you set up your environment variables easily
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function setupEnvironment() {
    console.log('🔧 AJK Cleaning Company - Environment Setup');
    console.log('==========================================\n');
    
    console.log('This script will help you set up your environment variables.');
    console.log('You can skip any field by pressing Enter to use defaults.\n');
    
    // Check if .env already exists
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        console.log('⚠️  .env file already exists!');
        const overwrite = await question('Do you want to overwrite it? (y/N): ');
        if (overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
            console.log('❌ Setup cancelled.');
            rl.close();
            return;
        }
    }
    
    // Collect environment variables
    const adminEmail = await question('📧 Admin Email (default: admin@ajkcleaners.de): ') || 'admin@ajkcleaners.de';
    const adminPassword = await question('🔐 Admin Password (required): ');
    
    if (!adminPassword) {
        console.log('❌ Admin password is required!');
        rl.close();
        return;
    }
    
    const stripeSecretKey = await question('💳 Stripe Secret Key (optional): ');
    const stripePublishableKey = await question('💳 Stripe Publishable Key (optional): ');
    const stripeWebhookSecret = await question('🔗 Stripe Webhook Secret (optional): ');
    
    const sessionSecret = await question('🔒 Session Secret (default: auto-generated): ') || 
        require('crypto').randomBytes(32).toString('hex');
    
    const port = await question('🌐 Port (default: 3000): ') || '3000';
    const nodeEnv = await question('🏗️  Environment (development/production, default: production): ') || 'production';
    
    // Generate .env content
    const envContent = `# AJK Cleaning Company - Environment Variables
# Generated on ${new Date().toISOString()}

# Admin Authentication
ADMIN_EMAIL=${adminEmail}
ADMIN_PASSWORD=${adminPassword}

# Stripe Configuration
${stripeSecretKey ? `STRIPE_SECRET_KEY=${stripeSecretKey}` : '# STRIPE_SECRET_KEY=your_stripe_secret_key_here'}
${stripePublishableKey ? `STRIPE_PUBLISHABLE_KEY=${stripePublishableKey}` : '# STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key_here'}
${stripeWebhookSecret ? `STRIPE_WEBHOOK_SECRET=${stripeWebhookSecret}` : '# STRIPE_WEBHOOK_SECRET=your_webhook_secret_here'}

# Database Configuration
DATABASE_URL=./db.json

# Session Configuration
SESSION_SECRET=${sessionSecret}

# Server Configuration
PORT=${port}
NODE_ENV=${nodeEnv}

# Security Settings
CSRF_SECRET=${require('crypto').randomBytes(32).toString('hex')}

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
`;

    // Write .env file
    try {
        fs.writeFileSync(envPath, envContent);
        console.log('\n✅ Environment variables saved to .env file!');
        console.log('\n📋 Summary:');
        console.log(`   Admin Email: ${adminEmail}`);
        console.log(`   Admin Password: ${'*'.repeat(adminPassword.length)}`);
        console.log(`   Port: ${port}`);
        console.log(`   Environment: ${nodeEnv}`);
        
        if (stripeSecretKey) {
            console.log('   Stripe: Configured ✅');
        } else {
            console.log('   Stripe: Not configured (optional)');
        }
        
        console.log('\n🚀 You can now start your server with: npm start');
        console.log('📖 For more configuration options, see .env.example');
        
    } catch (error) {
        console.error('❌ Error writing .env file:', error.message);
    }
    
    rl.close();
}

// Run the setup
setupEnvironment().catch(console.error);
