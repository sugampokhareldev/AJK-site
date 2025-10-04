# 📧 Email Configuration Guide

## **🔍 NOTIFICATION_EMAIL vs ADMIN_EMAILS**

### **NOTIFICATION_EMAIL**
- **Purpose:** Single primary admin email for notifications
- **Usage:** When you want to send notifications to ONE admin email
- **Format:** Single email address
- **Example:** `NOTIFICATION_EMAIL=admin@yourcompany.com`

### **ADMIN_EMAILS**
- **Purpose:** Multiple admin emails for notifications
- **Usage:** When you want to send notifications to MULTIPLE admin emails
- **Format:** Comma-separated list of email addresses
- **Example:** `ADMIN_EMAILS=admin1@company.com,admin2@company.com,manager@company.com`

## **📬 What Notifications Are Sent?**

Both `NOTIFICATION_EMAIL` and `ADMIN_EMAILS` receive the same types of notifications:

### **1. New Booking Alerts**
- When customers book cleaning services
- Includes customer details, service type, date/time
- Sent to all configured admin emails

### **2. New Review Alerts**
- When customers submit reviews
- Includes review text, rating, customer info
- Sent to all configured admin emails

### **3. Quote Request Alerts**
- When customers request quotes
- Includes customer requirements and contact info
- Sent to all configured admin emails

### **4. Payment Confirmations**
- When payments are processed successfully
- Includes payment details and booking info
- Sent to all configured admin emails

### **5. Custom Message Alerts**
- When admins send custom messages to customers
- Includes message content and customer info
- Sent to all configured admin emails

## **🔧 Configuration Priority**

The system checks for admin emails in this order:

1. **ADMIN_EMAILS** (if set) - Uses comma-separated list
2. **NOTIFICATION_EMAIL** (if set) - Uses single email
3. **Default fallback** - Uses `sugampokharel28@gmail.com`

## **💡 When to Use Which?**

### **Use NOTIFICATION_EMAIL when:**
- You have ONE admin managing everything
- You want simple configuration
- You're the sole owner/manager

**Example:**
```bash
NOTIFICATION_EMAIL=owner@cleaningcompany.com
```

### **Use ADMIN_EMAILS when:**
- You have MULTIPLE admins/managers
- You want notifications sent to a team
- You have different people handling different aspects

**Example:**
```bash
ADMIN_EMAILS=owner@company.com,manager@company.com,bookings@company.com
```

## **🚀 Render.com Setup**

### **Option 1: Single Admin Email**
```
NOTIFICATION_EMAIL=your-email@gmail.com
```

### **Option 2: Multiple Admin Emails**
```
ADMIN_EMAILS=admin1@gmail.com,admin2@gmail.com,manager@gmail.com
```

### **Option 3: Mixed Configuration**
```
NOTIFICATION_EMAIL=primary-admin@gmail.com
ADMIN_EMAILS=admin1@gmail.com,admin2@gmail.com,backup-admin@gmail.com
```

## **📋 Email Content Examples**

### **New Booking Alert Email:**
```
🚨 NEW BOOKING ALERT - AJK Cleaning Company

Booking ID: booking_1234567890
Booking Type: One-Time Cleaning
Service: Basic Cleaning (Residential)
Date: 2025-10-15
Time: 14:00
Duration: 2 hours
Cleaners: 1

CUSTOMER DETAILS:
Name: Mr. John Smith
Email: john@example.com
Phone: +1234567890
Address: 123 Main St, City, 12345
Property Size: 1500 sq ft

REQUIRED ACTIONS:
1. Contact customer within 2 hours
2. Confirm booking details and schedule
3. Provide accurate pricing quote
4. Schedule site visit if needed
5. Update booking status in admin panel
```

### **New Review Alert Email:**
```
⭐ NEW CUSTOMER REVIEW - AJK Cleaning Company

Review Details:
Customer: John Smith
Email: john@example.com
Service: Basic Cleaning
Rating: ★★★★★ (5/5)
Status: Pending Approval

Customer Review:
"The cleaning service was excellent! Very professional and thorough."

Action Required:
Please review and approve this customer feedback in your admin panel.
```

## **🔧 Testing Your Configuration**

### **Test Admin Emails:**
1. Set your environment variables
2. Make a test booking
3. Check if you receive the admin notification email
4. Check server logs for: `📧 Admin emails configured: [your-emails]`

### **Test Customer Emails:**
1. Make a test booking
2. Check if customer receives confirmation email
3. Check if admin receives notification email

## **📝 Notes**

- **All configured emails receive ALL notifications**
- **Use comma-separated format for multiple emails**
- **No spaces around commas in ADMIN_EMAILS**
- **Changes take effect immediately after server restart**
- **Check server logs to verify which emails are configured**

---
**Status**: 📧 **EMAIL CONFIGURATION EXPLAINED**
