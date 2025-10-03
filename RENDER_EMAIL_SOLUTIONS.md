# 🚀 Email Solutions for Render Free Tier

## 🚨 **Problem Identified**
Render's free tier **blocks outbound SMTP connections** for security reasons. This is why you're getting "Connection timeout" errors.

## ✅ **Solutions (Choose One)**

### **Solution 1: SendGrid (Recommended - Free Tier Available)**

#### **Step 1: Create SendGrid Account**
1. Go to [SendGrid.com](https://sendgrid.com)
2. Sign up for a free account (100 emails/day free)
3. Verify your email address

#### **Step 2: Get API Key**
1. Go to Settings → API Keys
2. Click "Create API Key"
3. Choose "Restricted Access"
4. Give it a name like "AJK Cleaning App"
5. Set permissions: "Mail Send" → "Full Access"
6. Copy the API key (starts with `SG.`)

#### **Step 3: Configure Render Environment Variables**
Add to your Render environment variables:
```
SENDGRID_API_KEY=SG.your_api_key_here
```

#### **Step 4: Test SendGrid**
```bash
curl -X POST https://your-app.onrender.com/api/test-sendgrid-email
```

---

### **Solution 2: EmailJS (Free Tier Available)**

#### **Step 1: Create EmailJS Account**
1. Go to [EmailJS.com](https://www.emailjs.com)
2. Sign up for free account
3. Create a new service (Gmail, Outlook, etc.)

#### **Step 2: Create Email Template**
1. Go to Email Templates
2. Create a new template
3. Use this template:
```html
Subject: {{subject}}
To: {{to_email}}
From: {{from_name}} <{{from_email}}>

{{message}}

---
AJK Cleaning Company
```

#### **Step 3: Configure Render Environment Variables**
```
EMAILJS_SERVICE_ID=your_service_id
EMAILJS_TEMPLATE_ID=your_template_id
EMAILJS_PUBLIC_KEY=your_public_key
```

---

### **Solution 3: Formspree (Free Tier Available)**

#### **Step 1: Create Formspree Account**
1. Go to [Formspree.io](https://formspree.io)
2. Sign up for free account
3. Create a new form

#### **Step 2: Get Form Endpoint**
1. Copy your form endpoint URL
2. It looks like: `https://formspree.io/f/your-form-id`

#### **Step 3: Configure Render Environment Variables**
```
FORMSPREE_ENDPOINT=https://formspree.io/f/your-form-id
```

---

## 🧪 **Testing Your Email Service**

### **Test All Email Services**
```bash
# Test SendGrid
curl -X POST https://your-app.onrender.com/api/test-sendgrid-email

# Test Webhook Services
curl -X POST https://your-app.onrender.com/api/test-webhook-email

# Test Simple Email (will fail on Render free tier)
curl -X POST https://your-app.onrender.com/api/test-simple-email
```

### **Test Commercial Booking**
1. Go to your booking page
2. Fill out a commercial booking form
3. Check Render logs for email service attempts
4. Check your email for confirmation

---

## 📊 **Email Service Priority Order**

The system now tries email services in this order:

1. **SendGrid** (if `SENDGRID_API_KEY` is set)
2. **Webhook Services** (EmailJS, Formspree, Netlify Forms)
3. **Fallback SMTP** (will fail on Render free tier)
4. **Primary SMTP** (will fail on Render free tier)

---

## 🔧 **Quick Setup Commands**

### **For SendGrid:**
```bash
# Add to Render environment variables:
SENDGRID_API_KEY=SG.your_api_key_here
```

### **For EmailJS:**
```bash
# Add to Render environment variables:
EMAILJS_SERVICE_ID=your_service_id
EMAILJS_TEMPLATE_ID=your_template_id
EMAILJS_PUBLIC_KEY=your_public_key
```

### **For Formspree:**
```bash
# Add to Render environment variables:
FORMSPREE_ENDPOINT=https://formspree.io/f/your-form-id
```

---

## 🎯 **Recommended Solution**

**Use SendGrid** - it's the most reliable and professional solution:

1. ✅ **Free tier**: 100 emails/day
2. ✅ **Reliable**: Works with Render free tier
3. ✅ **Professional**: Proper email delivery
4. ✅ **Easy setup**: Just need API key
5. ✅ **No SMTP**: Uses API instead of SMTP

---

## 🚀 **Next Steps**

1. **Choose a solution** (SendGrid recommended)
2. **Set up the service** (follow steps above)
3. **Add environment variables** to Render
4. **Test the email service**
5. **Deploy and test commercial bookings**

Your email service will work perfectly once you configure one of these solutions! 🎉
