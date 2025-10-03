# 🔧 Environment Variables Configuration

## 📧 Admin Email Notifications

### Single Admin Email
```bash
ADMIN_EMAIL=your-email@gmail.com
```

### Multiple Admin Emails
```bash
ADMIN_EMAILS=sugampokharel28@gmail.com,Sanudhakal119@gmail.com
```

## 🎯 How It Works

### Priority Order:
1. **ADMIN_EMAILS** (if set) - Comma-separated list of emails
2. **ADMIN_EMAIL** (if set) - Single admin email
3. **Default fallback** - `sugampokharel28@gmail.com`

### Examples:

#### Option 1: Single Admin Email
```bash
ADMIN_EMAIL=sugampokharel28@gmail.com
```

#### Option 2: Multiple Admin Emails
```bash
ADMIN_EMAILS=sugampokharel28@gmail.com,Sanudhakal119@gmail.com
```

#### Option 3: Mixed Configuration
```bash
ADMIN_EMAIL=primary-admin@gmail.com
ADMIN_EMAILS=sugampokharel28@gmail.com,Sanudhakal119@gmail.com,backup-admin@gmail.com
```

## 📬 Notification Types

The following notifications will be sent to all configured admin emails:

- ✅ **New Booking Alerts** - When customers book services
- ✅ **New Review Alerts** - When customers submit reviews
- ✅ **Quote Request Alerts** - When customers request quotes
- ✅ **Payment Confirmations** - When payments are processed
- ✅ **Custom Message Alerts** - When admins send custom messages

## 🚀 Render.com Setup

### In Render Dashboard:
1. Go to your service settings
2. Navigate to "Environment" tab
3. Add the environment variables:

```
ADMIN_EMAILS=sugampokharel28@gmail.com,Sanudhakal119@gmail.com
```

### Or use single email:
```
ADMIN_EMAIL=sugampokharel28@gmail.com
```

## 🔄 Easy Updates

To change admin emails:

1. **Update in Render Dashboard** - Environment variables
2. **Redeploy** - Changes take effect immediately
3. **No code changes needed** - Fully configurable via environment

## 📝 Notes

- Emails are sent to **ALL** configured admin emails
- Use comma-separated format for multiple emails
- No spaces around commas
- Case-sensitive email addresses
- Supports any email provider (Gmail, Outlook, etc.)

## 🧪 Testing

Test the configuration with:
```bash
curl -X POST https://your-app.onrender.com/api/test-admin-notification
```

This will send a test notification to all configured admin emails.
