// hash-passwords.js
const bcrypt = require('bcrypt');
const { query, poolConnect } = require('./db');

async function hashAllPasswords() {
    try {
        console.log('🔐 Starting password hashing...');
        await poolConnect;
        
        // Get all users
        const users = await query('SELECT id, username, password_hash FROM user_table');
        
        console.log(`📊 Found ${users.length} users to process`);
        
        let hashedCount = 0;
        let skippedCount = 0;
        
        for (const user of users) {
            // Check if password is already hashed (starts with $2b$, $2a$, or $2y$)
            const isHashed = user.password_hash && 
                (user.password_hash.startsWith('$2b$') || 
                 user.password_hash.startsWith('$2a$') || 
                 user.password_hash.startsWith('$2y$'));
            
            if (isHashed) {
                console.log(`⏭️  Skipping ${user.username} - already hashed`);
                skippedCount++;
                continue;
            }
            
            // Hash the plain text password
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(user.password_hash, saltRounds);
            
            // Update the user's password
            await query(
                'UPDATE user_table SET password_hash = @param0 WHERE id = @param1',
                [hashedPassword, user.id]
            );
            
            console.log(`✅ Hashed password for ${user.username} (ID: ${user.id})`);
            hashedCount++;
        }
        
        console.log(`\n📊 Summary:`);
        console.log(`   ✅ ${hashedCount} passwords hashed`);
        console.log(`   ⏭️  ${skippedCount} passwords already hashed`);
        console.log(`   📊 ${users.length} total users processed`);
        console.log('\n✅ All passwords processed successfully!');
        
    } catch (error) {
        console.error('❌ Error hashing passwords:', error);
    } finally {
        process.exit();
    }
}

// Run the script
hashAllPasswords();