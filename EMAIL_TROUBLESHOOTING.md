# 📧 Email Service Troubleshooting Guide

## 🚨 **Common Email Issues on Render**

### **Issue 1: Email Configuration Conflicts**
**Problem:** Multiple email configurations in your codebase
**Solution:** ✅ Fixed - Standardized all email configs to use same environment variables

### **Issue 2: Missing Environment Variables**
**Problem:** Render doesn't have SMTP credentials configured
**Solution:** Set these in your Render dashboard:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-character-app-password
```

### **Issue 3: Gmail Authentication**
**Problem:** Gmail blocks regular passwords for security
**Solution:** Use Gmail App Passwords (see setup below)

## 🔧 **Gmail App Password Setup**

### **Step 1: Enable 2-Factor Authentication**
1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable "2-Step Verification" if not already enabled

### **Step 2: Generate App Password**
1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Click "App passwords" (under 2-Step Verification)
3. Select "Mail" and "Other (custom name)"
4. Enter "AJK Cleaning Website"
5. Copy the 16-character password (no spaces)

### **Step 3: Configure Render Environment Variables**
In your Render dashboard, set:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-character-app-password
```

## 🧪 **Testing Email Service**

### **Test Endpoint Available:**
Your app has a test endpoint: `POST /api/test-email`

### **Manual Testing:**
1. Go to your Render app URL
2. Open browser console (F12)
3. Run this JavaScript:
```javascript
fetch('/api/test-email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
})
.then(r => r.json())
.then(console.log);
```

### **Expected Response:**
```json
{
  "success": true,
  "message": "Test email sent successfully"
}
```

## 🔍 **Debugging Steps**

### **1. Check Render Logs**
1. Go to your Render dashboard
2. Click on your service
3. Go to "Logs" tab
4. Look for email-related errors

### **2. Common Error Messages:**

**"Invalid login"**
- ❌ Wrong SMTP_PASS (using regular password instead of App Password)
- ✅ Use Gmail App Password

**"Connection timeout"**
- ❌ Wrong SMTP_HOST or SMTP_PORT
- ✅ Use smtp.gmail.com and 587

**"Authentication failed"**
- ❌ Wrong SMTP_USER or SMTP_PASS
- ✅ Double-check your Gmail address and App Password

**"Email notifications will be disabled"**
- ❌ Missing environment variables
- ✅ Set all SMTP_* variables in Render

### **3. Verify Configuration**
Check your server logs for:
```
✅ Email server is ready to send messages
```
If you see:
```
❌ Email configuration error: [error message]
```
Then your SMTP settings are incorrect.

## 🚀 **Alternative Email Services**

If Gmail doesn't work, try these alternatives:

### **Option 1: SendGrid (Recommended)**
```javascript
// In server.js, replace nodemailer config with:
const emailTransporter = nodemailer.createTransporter({
    service: 'SendGrid',
    auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
    }
});
```

### **Option 2: Mailgun**
```javascript
const emailTransporter = nodemailer.createTransporter({
    host: 'smtp.mailgun.org',
    port: 587,
    auth: {
        user: process.env.MAILGUN_SMTP_USER,
        pass: process.env.MAILGUN_SMTP_PASS
    }
});
```

### **Option 3: Outlook/Hotmail**
```javascript
const emailTransporter = nodemailer.createTransporter({
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});
```

## 📋 **Quick Checklist**

- [ ] 2-Factor Authentication enabled on Gmail
- [ ] App Password generated (16 characters)
- [ ] SMTP_HOST=smtp.gmail.com
- [ ] SMTP_PORT=587
- [ ] SMTP_USER=your-email@gmail.com
- [ ] SMTP_PASS=your-app-password
- [ ] Test endpoint returns success
- [ ] Check Render logs for errors

## 🆘 **Still Not Working?**

### **Check These:**
1. **Render Free Tier Limits:** Free tier has restrictions on outbound connections
2. **Gmail Security:** Some Gmail accounts have additional security restrictions
3. **Network Issues:** Render's network might be blocked by Gmail

### **Solutions:**
1. **Upgrade Render Plan:** Paid plans have better email support
2. **Use Different Email Service:** Try SendGrid or Mailgun
3. **Contact Support:** Check Render's documentation for email issues

---

**Need Help?** Check your Render logs first, then try the test endpoint!
