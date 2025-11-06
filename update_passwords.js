// update_passwords.js
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// The default password you want to set for all existing users.
// You will use this password to log in as them.
const DEFAULT_PASSWORD = 'password123';

async function setMissingPasswords() {
    console.log('Starting script to set missing passwords...');

    try {
        console.log(`Hashing the default password: "${DEFAULT_PASSWORD}"`);
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, salt);
        console.log('Password hashed successfully.');

        console.log('Finding users with missing passwords...');
        const result = await pool.query(
            `UPDATE users 
             SET password_hash = $1 
             WHERE password_hash IS NULL`,
            [passwordHash]
        );

        if (result.rowCount > 0) {
            console.log(`Successfully updated ${result.rowCount} user(s) with the new password hash.`);
            console.log(`You can now log in for these users with the password: "${DEFAULT_PASSWORD}"`);
        } else {
            console.log('No users with missing passwords found. Nothing to do.');
        }

    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        // Ensure the script closes the database connection
        await pool.end();
        console.log('Script finished. Database connection closed.');
    }
}

setMissingPasswords();