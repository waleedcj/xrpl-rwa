// api.js
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const xrplService = require('./xrpl-service');
const xrpl = require('xrpl');
var cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());

app.use(express.json());

// Database connection pool
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// MIDDLEWARE TO VERIFY JWT TOKENS
// This middleware checks if a valid JWT is present
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"

    if (token == null) {
        return res.sendStatus(401); // Unauthorized
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.sendStatus(403); // Forbidden (token is no longer valid)
        }
        req.user = user; // Attach the decoded user payload to the request object
        next(); // Proceed to the next function (the actual endpoint logic)
    });
};

// This middleware checks if the authenticated user is an admin
const authorizeAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admin access required.' });
    }
    next();
};

// --- USER ENDPOINTS ---

app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    try {
        // Hash the password before storing it
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // We still create a custodial wallet for the new user
        const { address, seed } = xrplService.createCustodialWallet();
        const encryptedSeed = seed; // In production: Encrypt this!
        await xrplService.fundNewWallet(address);
        await xrplService.setupFiatTrustLine(seed);

        const newUser = await pool.query(
            'INSERT INTO users (name, email, password_hash, xrpl_address, xrpl_seed_encrypted) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role',
            [name, email, password_hash, address, encryptedSeed]
        );

        res.status(201).json(newUser.rows[0]);
    } catch (error) {
        // Handle cases where email is already taken
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Email address is already registered.' });
        }
        console.error('Failed to register user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userRes.rowCount === 0) {
            return res.status(401).json({ error: 'Invalid credentials.' }); // User not found
        }
        const user = userRes.rows[0];

        // Compare the provided password with the stored hash
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials.' }); // Password incorrect
        }

        // If credentials are correct, create a JWT
        const payload = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' }); // Token expires in 1 day

        res.json({
            message: 'Login successful!',
            token: token,
            user: payload
        });

    } catch (error) {
        console.error('Login failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Simulate a fiat deposit for a user
app.post('/deposit-fiat', authenticateToken, async (req, res) => {
    const { userId, amount } = req.body;
    if (!userId || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Valid userId and positive amount are required.' });
    }

    try {
        const result = await pool.query(
            'UPDATE users SET fiat_balance_aed = fiat_balance_aed + $1 WHERE id = $2 RETURNING id, fiat_balance_aed',
            [amount, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Failed to deposit fiat:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- PROPERTY & INVESTMENT ENDPOINTS ---

// List a new property for tokenization
app.post('/properties', authenticateToken, authorizeAdmin, async (req, res) => {
    const { name, total_value_aed, tokens_to_issue, token_name } = req.body;
    // We create a hex currency code from the token name. e.g., "HSMB01"
    const token_currency_code = xrpl.convertStringToHex(token_name).padEnd(40, '0');
    const token_currency_name = token_name;

    try {
        const newProp = await pool.query(
            'INSERT INTO properties (name, total_value_aed, tokens_to_issue, token_currency_code, token_currency_name, issuer_address) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name, total_value_aed, tokens_to_issue, token_currency_code, token_currency_name, xrplService.ISSUER_WALLET_ADDRESS]
        );
        res.status(201).json(newProp.rows[0]);
    } catch (error) {
        console.error('Failed to list property:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all properties listed on the platform
app.get('/get-properties', async (req, res) => {
   try {
        // This advanced query joins properties with the sum of their investments.
        // COALESCE is used to return 0 for properties with no investments yet.
        const query = `
            SELECT 
                p.*, 
                COALESCE(SUM(i.amount_invested_aed), 0) as amount_raised_aed,
                COUNT(DISTINCT i.user_id) AS holder_count
            FROM 
                properties p
            LEFT JOIN 
                investments i ON p.id = i.property_id
            GROUP BY 
                p.id
            ORDER BY 
                p.created_at DESC;
        `;

        const result = await pool.query(query);
        res.status(200).json(result.rows);
        
    } catch (error)
     {
        console.error('Failed to get properties:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Main investment endpoint
// Main investment endpoint - FINAL VERSION WITH RACE CONDITION FIX
app.post('/invest', authenticateToken, async (req, res) => {
    // Ensure amountInvestedAed is a number right away
    const { userId, propertyId } = req.body;
    const amountInvestedAed = parseFloat(req.body.amountInvestedAed);

    if (isNaN(amountInvestedAed) || amountInvestedAed <= 0) {
        return res.status(400).json({ error: 'A valid, positive investment amount is required.' });
    }

    const dbClient = await pool.connect();
    try {
        // Start a database transaction
        await dbClient.query('BEGIN');

        // =====================================================================
        // THE CRITICAL FIX: Lock the property row when we select it.
        // Any other transaction trying to invest in the SAME property will now
        // have to wait until this transaction is finished (committed or rolled back).
        const propRes = await dbClient.query(
            'SELECT * FROM properties WHERE id = $1 FOR UPDATE',
            [propertyId]
        );
        // We also lock the user row since we are updating their balance.
        const userRes = await dbClient.query(
            'SELECT * FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        // =====================================================================

        if (propRes.rowCount === 0) throw new Error('Property not found');
        if (userRes.rowCount === 0) throw new Error('User not found');

        const property = propRes.rows[0];
        const user = userRes.rows[0];

        // Check 1: Is the property already marked as fully funded?
        if (property.is_fully_funded) {
            throw new Error('This property is already fully funded.');
        }

        // Get the current total amount invested in this property
        const investmentSumRes = await dbClient.query(
            'SELECT SUM(amount_invested_aed) as total FROM investments WHERE property_id = $1',
            [propertyId]
        );

        // Convert all financial values to numbers for safe calculations
        const propertyTotalValue = parseFloat(property.total_value_aed);
        const currentRaised = parseFloat(investmentSumRes.rows[0].total || 0);
        const userFiatBalance = parseFloat(user.fiat_balance_aed);
        const remainingToRaise = propertyTotalValue - currentRaised;

        // Check 2: Does this investment exceed the remaining amount?
        if (amountInvestedAed > remainingToRaise) {
            throw new Error(`Investment of ${amountInvestedAed} AED exceeds the remaining amount of ${remainingToRaise.toFixed(2)} AED needed.`);
        }

        // Check 3: Does the user have enough fiat balance?
        if (userFiatBalance < amountInvestedAed) {
            throw new Error('Insufficient fiat balance');
        }

        // Calculate tokens and ensure the investment is large enough for at least one
        const pricePerToken = propertyTotalValue / parseFloat(property.tokens_to_issue);
        const tokensToReceive = Math.floor(amountInvestedAed / pricePerToken);
        if (tokensToReceive < 1) {
            throw new Error('Investment amount is too low to receive at least one token.');
        }

        // All checks passed, proceed with updates
        // 1. Debit user's fiat balance
        await dbClient.query(
            'UPDATE users SET fiat_balance_aed = fiat_balance_aed - $1 WHERE id = $2',
            [amountInvestedAed, userId]
        );

        // 2. Issue tokens on the XRPL
        const userSeed = user.xrpl_seed_encrypted; // Decrypt in production
        const txHash = await xrplService.distributeAndFreezeTokens(
        userSeed,
        property.token_currency_code,
        tokensToReceive
    );

        // 3. Record the investment
        await dbClient.query(
            'INSERT INTO investments (user_id, property_id, amount_invested_aed, tokens_received, xrpl_tx_hash) VALUES ($1, $2, $3, $4, $5)',
            [userId, propertyId, amountInvestedAed, tokensToReceive, txHash]
        );

        // 4. Check if the property is now fully funded and update its status
        const newTotalRaised = currentRaised + amountInvestedAed;
        // Use a small epsilon (0.001) for safe floating point comparison
        if (newTotalRaised >= propertyTotalValue - 0.001) {
            await dbClient.query(
                'UPDATE properties SET is_fully_funded = TRUE WHERE id = $1',
                [propertyId]
            );
            console.log(`Property ${propertyId} is now fully funded!`);
        }

        // If everything was successful, commit the transaction
        await dbClient.query('COMMIT');
        res.status(201).json({
            message: 'Investment successful!',
            tokensReceived: tokensToReceive,
            xrplTxHash: txHash
        });

    } catch (error) {
        // If any error occurred, roll back all database changes
        await dbClient.query('ROLLBACK');
        console.error('Investment failed:', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        // Always release the database client back to the pool
        dbClient.release();
    }
});

app.get('/users/:userId/investments', authenticateToken, async (req, res) => {
    if (req.user.id !== req.params.userId && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: You can only access your own data.' });
    }
    const { userId } = req.params;

    try {
        // This query joins investments with properties to get the property name
        const query = `
            SELECT 
                i.id,
                i.property_id,
                p.name AS property_name,
                i.amount_invested_aed,
                i.tokens_received,
                i.xrpl_tx_hash,
                i.created_at AS investment_date
            FROM 
                investments i
            JOIN 
                properties p ON i.property_id = p.id
            WHERE 
                i.user_id = $1
            ORDER BY 
                i.created_at DESC;
        `;
        const result = await pool.query(query, [userId]);

        // If the user exists but has no investments, this will correctly return an empty array []
        res.status(200).json(result.rows);

    } catch (error) {
        console.error(`Failed to get investments for user ${userId}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ====================================================================
// NEW ENDPOINT: To pre-mint all tokens for a property
// In a real app, this should be protected and only callable by an admin.
// ====================================================================
app.post('/properties/:propertyId/mint', authenticateToken, authorizeAdmin, async (req, res) => {
    const { propertyId } = req.params;
    try {
        const propRes = await pool.query('SELECT * FROM properties WHERE id = $1', [propertyId]);
        if (propRes.rowCount === 0) {
            return res.status(404).json({ error: 'Property not found.' });
        }
        const property = propRes.rows[0];

        // You might add a check here to prevent minting more than once

        console.log(`Minting ${property.tokens_to_issue} of ${property.token_currency_code}...`);
        const txHash = await xrplService.mintAllPropertyTokens(
            property.token_currency_code,
            property.tokens_to_issue
        );

        res.status(200).json({
            message: 'All tokens for the property have been minted to the distribution wallet.',
            propertyId: property.id,
            mintTxHash: txHash
        });

    } catch (error) {
        console.error('Failed to mint property tokens:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- RENTAL INCOME & DASHBOARD ---

// Simulate distributing rent for a property
// This endpoint now uses AED per token to calculate distributions
app.post('/distribute-rent', authenticateToken, authorizeAdmin, async (req, res) => {
    const { propertyId, totalRentAed, rentInAedPerToken } = req.body;

    // Basic Input Validation
    if (!propertyId || !totalRentAed || !rentInAedPerToken || totalRentAed <= 0 || rentInAedPerToken <= 0) {
        return res.status(400).json({ error: 'Valid propertyId, and positive totalRentAed and rentInAedPerToken are required.' });
    }

    try {
        // Step 1: Get Property and check if it's fully funded
        const propRes = await pool.query('SELECT * FROM properties WHERE id = $1', [propertyId]);
        if (propRes.rowCount === 0) {
            return res.status(404).json({ error: 'Property not found.' });
        }
        const property = propRes.rows[0];

        // --- CRITICAL BUSINESS LOGIC CHECK ---
        if (!property.is_fully_funded) {
            return res.status(400).json({ error: 'Cannot distribute rent on a property that is not yet fully funded.' });
        }

        // Step 2: Get all token holders for this property by summing up their investments
        // This correctly handles users who have invested multiple times.
        const holdersQuery = `
            SELECT 
                i.user_id,
                u.xrpl_address,
                SUM(i.tokens_received) AS total_tokens_held
            FROM 
                investments i
            JOIN 
                users u ON i.user_id = u.id
            WHERE 
                i.property_id = $1
            GROUP BY 
                i.user_id, u.xrpl_address;
        `;
        const holdersRes = await pool.query(holdersQuery, [propertyId]);

        if (holdersRes.rowCount === 0) {
            return res.status(404).json({ message: 'No investors found for this property.' });
        }

        // Step 3: Calculate the precise rent due for each holder
        const holders = holdersRes.rows.map(row => ({
            propertyId: propertyId,
            xrpl_address: row.xrpl_address,
            // Use parseFloat to ensure numbers are not strings
            rent_due_aed: parseFloat(row.total_tokens_held) * parseFloat(rentInAedPerToken),
        }));
        
        // Optional Sanity Check: Ensure the total to be distributed matches the input
        const totalCalculatedRent = holders.reduce((sum, holder) => sum + holder.rent_due_aed, 0);
        console.log(`Admin entered total rent: ${totalRentAed}. Calculated total to be paid: ${totalCalculatedRent.toFixed(2)}.`);
        // Note: These might not match perfectly due to rounding in token calculation.
        // For a real system, you would need a clear policy on how to handle these rounding differences.

        // Step 4: Distribute the payments via the XRPL service
        const distributionResults = await xrplService.distributeRent(holders);

        // Step 5: Record the distribution event for historical tracking
       await pool.query(
            'INSERT INTO rental_distributions (property_id, total_rent_aed, distribution_date, rent_per_token_aed) VALUES ($1, $2, NOW(), $3)',
    // Add the missing propertyId to the front of this array
    [propertyId, totalRentAed, rentInAedPerToken]
);

res.status(200).json({
    message: 'Rent distribution process initiated.',
    calculatedTotal: totalCalculatedRent,
    results: distributionResults
});

    } catch (error) {
        console.error('Rent distribution failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/unfreeze', authenticateToken, authorizeAdmin, async (req, res) => {
    // We need to know WHICH user and WHICH property token to unfreeze.
    const { userId, propertyId } = req.body;
    if (!userId || !propertyId) {
        return res.status(400).json({ error: 'userId and propertyId are required.' });
    }

    try {
        // Step 1: Get the user's encrypted seed and the property's token code from the DB.
        const userRes = await pool.query('SELECT xrpl_seed_encrypted FROM users WHERE id = $1', [userId]);
        const propRes = await pool.query('SELECT token_currency_code FROM properties WHERE id = $1', [propertyId]);

        if (userRes.rowCount === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        if (propRes.rowCount === 0) {
            return res.status(404).json({ error: 'Property not found.' });
        }

        const userSeed = userRes.rows[0].xrpl_seed_encrypted; // In production, decrypt this first
        const tokenCurrencyCode = propRes.rows[0].token_currency_code;

        // Step 2: Call the XRPL service to perform the unfreeze transaction.
        const txHash = await xrplService.unfreezeTokens(userSeed, tokenCurrencyCode);

        res.status(200).json({
            message: "Tokens successfully unfrozen.",
            userId,
            propertyId,
            unfreezeTxHash: txHash,
        });

    } catch (error) {
        console.error('Failed to unfreeze tokens:', error);
        // Handle potential XRPL errors, e.g., if the trustline doesn't exist
        res.status(500).json({ error: 'An error occurred during the unfreeze process.', details: error.message });
    }
});

app.get('/properties/:propertyId/holders', authenticateToken, authorizeAdmin, async (req, res) => {
    const { propertyId } = req.params;

    try {
        // This query finds all unique users who have invested in the given property.
        // It joins with the users table to get their name and email.
        // It sums their investments to show their total token holdings.
        const query = `
            SELECT 
                u.id AS user_id,
                u.name,
                u.email,
                u.xrpl_address,
                SUM(i.tokens_received) AS total_tokens_held
            FROM 
                investments i
            JOIN 
                users u ON i.user_id = u.id
            WHERE 
                i.property_id = $1
            GROUP BY 
                u.id, u.name, u.email, u.xrpl_address
            ORDER BY 
                SUM(i.tokens_received) DESC;
        `;
        const result = await pool.query(query, [propertyId]);

        // This will return an empty array if there are no holders yet, which is correct.
        res.status(200).json(result.rows);

    } catch (error) {
        console.error(`Failed to get holders for property ${propertyId}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Get a user's dashboard view
app.get('/dashboard/:userId', authenticateToken, async (req, res) => {
     if (req.user.id !== req.params.userId && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: You can only access your own data.' });
    }

    const { userId } = req.params;
    try {
        const userRes = await pool.query('SELECT id, name, email, fiat_balance_aed, xrpl_address FROM users WHERE id = $1', [userId]);
        if (userRes.rowCount === 0) return res.status(404).json({ error: 'User not found' });
        
        // --- THIS QUERY IS THE ONLY PART THAT CHANGES ---
        const holdingsRes = await pool.query(
            `SELECT 
                p.name, 
                p.token_currency_code, 
                p.token_currency_name,
                i.tokens_received 
            FROM 
                investments i 
            JOIN 
                properties p ON i.property_id = p.id 
            WHERE 
                i.user_id = $1`,
            [userId]
        );

        res.json({
            userInfo: userRes.rows[0],
            tokenHoldings: holdingsRes.rows
        });

    } catch (error) {
        console.error('Failed to get dashboard:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/users/:userId/rent-history', authenticateToken, async (req, res) => {
    if (req.user.id !== req.params.userId && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: You can only access your own data.' });
    }
    const { userId } = req.params;

    try {
        // This query is more complex:
        // 1. It first calculates the user's total tokens for each property they've invested in.
        // 2. It then joins that with every rent distribution that has happened for those properties.
        // 3. Finally, it calculates the user's specific earnings for each event.
        const query = `
            WITH user_holdings AS (
                SELECT 
                    property_id, 
                    SUM(tokens_received) AS total_tokens
                FROM 
                    investments
                WHERE 
                    user_id = $1
                GROUP BY 
                    property_id
            )
            SELECT 
                p.name AS property_name,
                rd.distribution_date,
                uh.total_tokens AS tokens_held,
                rd.rent_per_token_aed,
                (uh.total_tokens * rd.rent_per_token_aed) AS rent_received_aed
            FROM 
                rental_distributions rd
            JOIN 
                user_holdings uh ON rd.property_id = uh.property_id
            JOIN
                properties p ON rd.property_id = p.id
            ORDER BY 
                rd.distribution_date DESC;
        `;
        const result = await pool.query(query, [userId]);

        res.status(200).json(result.rows);

    } catch (error) {
        console.error(`Failed to get rent history for user ${userId}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});





// --- Server Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    // One-time setup for the issuer account on server start
    await xrplService.configureIssuerAccount();
});