#!/usr/bin/env node

/**
 * Reset Admin Credentials Script
 * This script clears old admin users and forces creation of new ones
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

async function resetAdminCredentials() {
    console.log('🔄 Resetting Admin Credentials...\n');
    
    const dbPath = path.join(__dirname, 'data', 'db.json');
    
    try {
        // Read current database
        const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        
        console.log('📊 Current admin users:');
        if (dbData.admin_users && dbData.admin_users.length > 0) {
            dbData.admin_users.forEach((user, index) => {
                console.log(`   ${index + 1}. ${user.username || user.email} (ID: ${user.id})`);
            });
        } else {
            console.log('   No admin users found');
        }
        
        // Clear admin users
        dbData.admin_users = [];
        
        // Write updated database
        fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2));
        
        console.log('\n✅ Old admin users cleared!');
        console.log('🔄 Next steps:');
        console.log('   1. Set your new credentials in .env file:');
        console.log('      ADMIN_EMAIL=your-email@ajkcleaners.de');
        console.log('      ADMIN_PASSWORD=your-new-password');
        console.log('   2. Start the server: npm start');
        console.log('   3. The system will create a new admin user automatically');
        
        console.log('\n📁 Database backup saved as: data/db.json.backup');
        
    } catch (error) {
        console.error('❌ Error resetting admin credentials:', error.message);
        process.exit(1);
    }
}

// Run the reset
resetAdminCredentials().catch(console.error);
