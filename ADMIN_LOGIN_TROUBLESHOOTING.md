# 🔧 Admin Login Troubleshooting Guide

## 🚨 **Issue: "Invalid credentials" despite correct email/password**

### **Root Cause Analysis:**
Your environment variables are correct, but there might be a database initialization issue.

---

## 🔍 **Diagnostic Steps**

### **Step 1: Check Environment Variables**
Your current setup:
```
ADMIN_EMAIL=Sanud119@gmail.com          ✅ Correct
ADMIN_PASSWORD=Sugam@2008              ✅ Correct
```

### **Step 2: Database Initialization Issue**
The system should automatically create an admin user on first startup, but this might have failed.

---

## 🛠️ **Solutions**

### **Solution 1: Force Database Reset (Recommended)**

1. **Delete the database file** (if using file-based database):
   ```bash
   # On your hosting platform, delete:
   /opt/render/project/src/submissions.db
   ```

2. **Restart your application** - it will recreate the database with your admin user.

### **Solution 2: Check Database Content**

If you have access to your hosting logs, look for:
```
✅ Admin user 'Sanud119@gmail.com' created successfully
```

If you see this message, the admin user was created correctly.

### **Solution 3: Manual Database Check**

The admin user should be stored in the database with:
- **Email**: `Sanud119@gmail.com`
- **Username**: `Sanud119` (email prefix)
- **Password**: Hashed version of `Sugam@2008`

---

## 🔧 **Quick Fix Commands**

### **For Render.com:**
1. Go to your Render dashboard
2. Go to your service
3. Click "Manual Deploy" → "Clear build cache and deploy"
4. This will restart the app and reinitialize the database

### **For Other Hosting:**
1. Restart your application
2. Check logs for admin user creation
3. If still failing, delete database file and restart

---

## 🧪 **Test Your Login**

### **Try These Credentials:**
- **Email**: `Sanud119@gmail.com`
- **Password**: `Sugam@2008`

### **Alternative (if email doesn't work):**
- **Username**: `Sanud119`
- **Password**: `Sugam@2008`

---

## 📋 **Expected Log Messages**

### **On Successful Startup:**
```
✅ Admin user 'Sanud119@gmail.com' created successfully
Database ready at: /opt/render/project/src/submissions.db
```

### **On Login Attempt:**
```
Login attempt for: Sanud119@gmail.com
Login successful
```

---

## 🚨 **If Still Not Working**

### **Check These:**
1. **Case sensitivity**: Make sure email is exactly `Sanud119@gmail.com`
2. **Special characters**: Password `Sugam@2008` should work
3. **Database permissions**: Make sure the app can write to the database file
4. **Environment variables**: Double-check they're set correctly in hosting panel

### **Emergency Reset:**
If nothing works, you can reset the admin user by:
1. Deleting the database file
2. Restarting the application
3. The system will recreate everything

---

## 🎯 **Most Likely Solution**

**Try restarting your application** - this will trigger the database initialization and create your admin user properly.

**Your environment variables are correct, so this should fix the issue! 🚀**
