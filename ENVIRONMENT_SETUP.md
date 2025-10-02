# 🔧 Environment Setup Guide

This guide will help you configure your AJK Cleaning Company website with environment variables for easy admin credential management.

## 🚀 Quick Setup

### Option 1: Interactive Setup (Recommended)
```bash
npm run setup
```
This will guide you through setting up all environment variables interactively.

### Option 2: Manual Setup
1. Copy the example file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your values:
   ```bash
   nano .env  # or use any text editor
   ```

## 📋 Required Environment Variables

### 🔐 Admin Authentication
```env
ADMIN_EMAIL=admin@ajkcleaners.de
ADMIN_PASSWORD=your-secure-password-here
```

### 💳 Stripe Configuration (Production)
```env
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key_here
STRIPE_PUBLISHABLE_KEY=pk_live_your_stripe_publishable_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

### 🔒 Security Settings
```env
SESSION_SECRET=your-super-secret-session-key-here
CSRF_SECRET=your-csrf-secret-key-here
```

## 🔄 Changing Admin Credentials

To change your admin email or password, simply update the `.env` file:

```env
# Change these values
ADMIN_EMAIL=new-admin@ajkcleaners.de
ADMIN_PASSWORD=new-secure-password
```

Then restart your server:
```bash
npm start
```

The system will automatically:
- ✅ Create a new admin user if the email doesn't exist
- ✅ Update the password if the email exists but password is different
- ✅ Keep existing credentials if they match

## 🛡️ Security Best Practices

### Password Requirements
- Use a strong password (minimum 12 characters)
- Include uppercase, lowercase, numbers, and symbols
- Avoid common words or patterns

### Environment File Security
- Never commit `.env` to version control
- Keep `.env` file permissions restricted (600)
- Use different credentials for development and production

### Example Strong Password
```
MySecure@Password123!
```

## 🔧 Development vs Production

### Development
```env
NODE_ENV=development
ADMIN_EMAIL=dev@ajkcleaners.de
ADMIN_PASSWORD=dev-password-123
```

### Production
```env
NODE_ENV=production
ADMIN_EMAIL=admin@ajkcleaners.de
ADMIN_PASSWORD=SuperSecure@Password2024!
```

## 🚨 Troubleshooting

### "ADMIN_EMAIL and ADMIN_PASSWORD must be set"
- Make sure your `.env` file exists
- Check that the variables are spelled correctly
- Ensure there are no spaces around the `=` sign

### "Invalid credentials" on login
- Verify your email and password in `.env`
- Check for typos in the environment variables
- Restart the server after changing credentials

### Environment variables not loading
- Ensure `.env` file is in the project root directory
- Check that `require('dotenv').config()` is at the top of `server.js`
- Restart the server completely

## 📞 Support

If you encounter issues with environment setup:
1. Check the server console for error messages
2. Verify your `.env` file format
3. Ensure all required variables are set
4. Try the interactive setup: `npm run setup`

## 🔄 Reset Admin Credentials

To completely reset admin credentials:

1. Stop the server
2. Delete the database file: `rm db.json`
3. Update your `.env` file with new credentials
4. Start the server: `npm start`

The system will create a fresh admin user with your new credentials.
