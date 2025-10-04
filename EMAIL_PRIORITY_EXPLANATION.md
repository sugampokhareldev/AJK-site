# 📧 Email Priority System Explained

## **🔍 How the Priority System Works**

The system checks for admin emails in this **exact order**:

### **1. ADMIN_EMAILS (Highest Priority)**
- **IF `ADMIN_EMAILS` is set** → Uses this (ignores NOTIFICATION_EMAIL)
- **Example:** `ADMIN_EMAILS=admin1@gmail.com,admin2@gmail.com`
- **Result:** Sends to admin1@gmail.com AND admin2@gmail.com

### **2. NOTIFICATION_EMAIL (Second Priority)**
- **IF `ADMIN_EMAILS` is NOT set** → Uses NOTIFICATION_EMAIL
- **Example:** `NOTIFICATION_EMAIL=single-admin@gmail.com`
- **Result:** Sends to single-admin@gmail.com

### **3. Default Fallback (Lowest Priority)**
- **IF neither is set** → Uses default email
- **Result:** Sends to `sugampokharel28@gmail.com`

## **❌ Common Misconception**

**NOTIFICATION_EMAIL is NOT a backup!**

- It's not used when ADMIN_EMAILS fails
- It's not used alongside ADMIN_EMAILS
- It's only used when ADMIN_EMAILS is not set

## **✅ Correct Understanding**

**ADMIN_EMAILS takes priority over NOTIFICATION_EMAIL**

- If both are set → Only ADMIN_EMAILS is used
- If only ADMIN_EMAILS is set → Uses ADMIN_EMAILS
- If only NOTIFICATION_EMAIL is set → Uses NOTIFICATION_EMAIL
- If neither is set → Uses default

## **🧪 Examples**

### **Example 1: Both Set**
```bash
ADMIN_EMAILS=admin1@gmail.com,admin2@gmail.com
NOTIFICATION_EMAIL=backup@gmail.com
```
**Result:** Sends to admin1@gmail.com AND admin2@gmail.com
**NOTIFICATION_EMAIL is ignored!**

### **Example 2: Only ADMIN_EMAILS Set**
```bash
ADMIN_EMAILS=admin1@gmail.com,admin2@gmail.com
# NOTIFICATION_EMAIL not set
```
**Result:** Sends to admin1@gmail.com AND admin2@gmail.com

### **Example 3: Only NOTIFICATION_EMAIL Set**
```bash
# ADMIN_EMAILS not set
NOTIFICATION_EMAIL=single-admin@gmail.com
```
**Result:** Sends to single-admin@gmail.com

### **Example 4: Neither Set**
```bash
# Neither ADMIN_EMAILS nor NOTIFICATION_EMAIL set
```
**Result:** Sends to default email (sugampokharel28@gmail.com)

## **💡 When to Use Which?**

### **Use ADMIN_EMAILS when:**
- You want notifications sent to MULTIPLE people
- You have a team of admins
- You want to ensure everyone gets notified

### **Use NOTIFICATION_EMAIL when:**
- You want notifications sent to ONE person
- You're the sole admin
- You want simple configuration

## **🔧 Configuration Tips**

### **For Multiple Admins:**
```bash
ADMIN_EMAILS=owner@gmail.com,manager@gmail.com,bookings@gmail.com
```

### **For Single Admin:**
```bash
NOTIFICATION_EMAIL=admin@gmail.com
```

### **For Testing:**
```bash
ADMIN_EMAILS=test@gmail.com
```

## **📋 Summary**

- **ADMIN_EMAILS** = Multiple admin emails (takes priority)
- **NOTIFICATION_EMAIL** = Single admin email (used only if ADMIN_EMAILS not set)
- **Default** = Fallback if neither is set
- **Only ONE of these is used at a time!**

---
**Status**: 📧 **EMAIL PRIORITY SYSTEM CLARIFIED**
