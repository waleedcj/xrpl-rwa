// api.js
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const xrplService = require('./xrpl-service');
const xrpl = require('xrpl');
var cors = require('cors')

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

// --- USER ENDPOINTS ---

// Create a new user and their custodial XRPL wallet
app.post('/users', async (req, res) => {
    const { name, email } = req.body;
    if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required.' });
    }

    try {
        const { address, seed } = xrplService.createCustodialWallet();
        const encryptedSeed = seed; // In production: Encrypt this!

        // Step 1: Fund the base wallet with XRP TODO REMOVE THIS LATER
        await xrplService.fundNewWallet(address);

        // CHANGED: Step 2: Automatically set up the TrustLine for our AED token
        await xrplService.setupFiatTrustLine(seed);

        const newUser = await pool.query(
            'INSERT INTO users (name, email, xrpl_address, xrpl_seed_encrypted) VALUES ($1, $2, $3, $4) RETURNING id, name, email, xrpl_address',
            [name, email, address, encryptedSeed]
        );

        res.status(201).json(newUser.rows[0]);
    } catch (error) {
        console.error('Failed to create user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Simulate a fiat deposit for a user
app.post('/deposit-fiat', async (req, res) => {
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
app.post('/properties', async (req, res) => {
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
        const result = await pool.query('SELECT * FROM properties ORDER BY created_at DESC');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Failed to get properties:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Main investment endpoint
// Main investment endpoint - FINAL VERSION WITH RACE CONDITION FIX
app.post('/invest', async (req, res) => {
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

// ====================================================================
// NEW ENDPOINT: To pre-mint all tokens for a property
// In a real app, this should be protected and only callable by an admin.
// ====================================================================
app.post('/properties/:propertyId/mint', async (req, res) => {
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
app.post('/distribute-rent', async (req, res) => {
    // Body now expects rentInAedPerToken
    const { propertyId, totalRentAed, rentInAedPerToken } = req.body;
    if (!propertyId || !totalRentAed || !rentInAedPerToken) {
        return res.status(400).json({ error: 'propertyId, totalRentAed, and rentInAedPerToken are required.' });
    }

    try {
        // Find all investors for this property and their token count
        const investorsRes = await pool.query(
            'SELECT u.xrpl_address, i.tokens_received FROM investments i JOIN users u ON i.user_id = u.id WHERE i.property_id = $1',
            [propertyId]
        );

        if (investorsRes.rowCount === 0) {
            return res.status(404).json({ message: 'No investors found for this property.' });
        }

        // Calculate AED rent due for each holder
        const holders = investorsRes.rows.map(row => ({
            propertyId: propertyId,
            xrpl_address: row.xrpl_address,
            balance: row.tokens_received,
            rent_due_aed: parseFloat(row.tokens_received) * rentInAedPerToken,
        }));
        
        // Use XRPL service to send payments in our AED token
        const distributionResults = await xrplService.distributeRent(holders);

        await pool.query(
            'INSERT INTO rental_distributions (property_id, total_rent_aed, distribution_date) VALUES ($1, $2, NOW())',
            [propertyId, totalRentAed]
        );

        res.status(200).json({ message: 'Rent distribution process initiated.', results: distributionResults });

    } catch (error) {
        console.error('Rent distribution failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get a user's dashboard view
app.get('/dashboard/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const userRes = await pool.query('SELECT id, name, email, fiat_balance_aed, xrpl_address FROM users WHERE id = $1', [userId]);
        if (userRes.rowCount === 0) return res.status(404).json({ error: 'User not found' });
        
        const holdingsRes = await pool.query(
            'SELECT p.name, p.token_currency_code, i.tokens_received FROM investments i JOIN properties p ON i.property_id = p.id WHERE i.user_id = $1',
            [userId]
        );

        // In a real app, you would also query the XRPL for rental income transactions
        // or query the rental_distributions table.

        res.json({
            userInfo: userRes.rows[0],
            tokenHoldings: holdingsRes.rows
        });

    } catch (error) {
        console.error('Failed to get dashboard:', error);
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