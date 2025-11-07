// xrpl-service.js
require('dotenv').config();
const xrpl = require('xrpl');

const ISSUER_WALLET_SEED = process.env.ISSUER_WALLET_SEED;
const OPERATIONAL_WALLET_SEED = process.env.OPERATIONAL_WALLET_SEED;
const DISTRIBUTION_WALLET_SEED = process.env.DISTRIBUTION_WALLET_SEED;

// NEW: Define our platform's dummy AED currency code.
// In a 3-char code, this is simple. For production, you might use a hex code.
const FIAT_CURRENCY_CODE = 'AED';

let client;

async function getClient() {
    if (!client || !client.isConnected()) {
        console.log("Connecting to XRPL Testnet...");
        client = new xrpl.Client('wss://s.altnet.rippletest.net:51233');
        await client.connect();
        console.log("Connected to XRPL Testnet.");
    }
    return client;
}

function createCustodialWallet() {
    const wallet = xrpl.Wallet.generate();
    return {
        address: wallet.address,
        seed: wallet.seed,
    };
}

async function fundNewWallet(walletAddress) {
    const client = await getClient();
    const operationalWallet = xrpl.Wallet.fromSeed(OPERATIONAL_WALLET_SEED);

    const prepared = await client.autofill({
        TransactionType: 'Payment',
        Account: operationalWallet.address,
        Amount: '1500000', // 1.5 XRP (0.5 base + 0.5 for property token TL + 0.5 for AED TL)
        Destination: walletAddress,
    });

    const signed = operationalWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    console.log(`Funded new wallet ${walletAddress}:`, result.result.meta.TransactionResult);
    return result;
}

// NEW FUNCTION: Prepares a user's wallet to receive our platform's AED token.
async function setupFiatTrustLine(userSeed) {
    const client = await getClient();
    const userWallet = xrpl.Wallet.fromSeed(userSeed);
    const operationalWallet = xrpl.Wallet.fromSeed(OPERATIONAL_WALLET_SEED);

    const trustSetTx = {
        TransactionType: 'TrustSet',
        Account: userWallet.address,
        LimitAmount: {
            currency: FIAT_CURRENCY_CODE,
            issuer: operationalWallet.address, // The operational wallet issues our AED
            value: '100000000', // User can hold up to 100M AED from us
        },
    };

    const prepared = await client.autofill(trustSetTx);
    const signed = userWallet.sign(prepared);
    await client.submitAndWait(signed.tx_blob);
    console.log(`AED TrustLine created for user ${userWallet.address}`);
}


async function configureIssuerAccount() {
    // No changes here, this function is correct.
    const client = await getClient();
    const issuerWallet = xrpl.Wallet.fromSeed(ISSUER_WALLET_SEED);

    const settingsTx = {
        TransactionType: "AccountSet",
        Account: issuerWallet.address,
        SetFlag: xrpl.AccountSetAsfFlags.asfDefaultRipple,
        Domain: "68747470733a2f2f77616c69646d2e646576"
    };

    const prepared = await client.autofill(settingsTx);
    const signed = issuerWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    console.log("Property Token Issuer account configured:", result.result.meta.TransactionResult);
    return result;
}

// ====================================================================
// NEW FUNCTION: The one-time minting of the entire token supply.
// ====================================================================
async function mintAllPropertyTokens(tokenCurrencyCode, totalTokensToIssue) {
    const client = await getClient();
    const issuerWallet = xrpl.Wallet.fromSeed(ISSUER_WALLET_SEED);
    const distributionWallet = xrpl.Wallet.fromSeed(DISTRIBUTION_WALLET_SEED);

    // Step 1: Fund the Distribution Wallet if it's new, so it can exist and create trustlines.
    // In a real app, you would check its balance first. For this, we'll just fund it.
    // You only need to run this logic once for the lifetime of the wallet.
    try {
        await fundNewWallet(distributionWallet.address);
    } catch (e) {
        console.log("Distribution wallet likely already funded.");
    }

    // Step 2: Create a TrustLine from the Distribution Wallet to the Issuer
    const trustSetTx = {
        TransactionType: 'TrustSet',
        Account: distributionWallet.address,
        LimitAmount: {
            currency: tokenCurrencyCode,
            issuer: issuerWallet.address,
            value: totalTokensToIssue.toString(), // The limit should be at least the total supply
        },
    };
    const prepTrust = await client.autofill(trustSetTx);
    const signedTrust = distributionWallet.sign(prepTrust);
    await client.submitAndWait(signedTrust.tx_blob);
    console.log(`TrustLine created for Distribution Wallet for token ${tokenCurrencyCode}.`);

    // Step 3: Send the ENTIRE supply of tokens from Issuer to Distribution Wallet
    const paymentTx = {
        TransactionType: 'Payment',
        Account: issuerWallet.address,
        Amount: {
            currency: tokenCurrencyCode,
            issuer: issuerWallet.address,
            value: totalTokensToIssue.toString(),
        },
        Destination: distributionWallet.address,
    };
    const prepPayment = await client.autofill(paymentTx);
    const signedPayment = issuerWallet.sign(prepPayment);
    const paymentResult = await client.submitAndWait(signedPayment.tx_blob);
    console.log(`MINTED ${totalTokensToIssue} tokens to Distribution Wallet.`);

    return paymentResult.result.hash;
}

// ====================================================================
// RENAMED & CHANGED: This function now TRANSFERS, not mints.
// ====================================================================
async function distributeAndFreezeTokens(userSeed, tokenCurrencyCode, tokenAmount) {
    const client = await getClient();
    const userWallet = xrpl.Wallet.fromSeed(userSeed);
    const distributionWallet = xrpl.Wallet.fromSeed(DISTRIBUTION_WALLET_SEED); // <-- SENDER is now Distribution Wallet
    const issuerAddress = xrpl.Wallet.fromSeed(ISSUER_WALLET_SEED).address; // We still need issuer for the currency object

    // 1. Create a Trust Line from User to Issuer (this remains the same)
    const trustSetTx = {
        TransactionType: 'TrustSet',
        Account: userWallet.address,
        LimitAmount: {
            currency: tokenCurrencyCode,
            issuer: issuerAddress,
            value: '1000000000', // A large number is fine
        },
    };
    const prepTrust = await client.autofill(trustSetTx);
    const signedTrust = userWallet.sign(prepTrust);
    await client.submitAndWait(signedTrust.tx_blob);
    console.log(`TrustLine created for ${userWallet.address} for property token ${tokenCurrencyCode}.`);

    // 2. TRANSFER Tokens from Distribution Wallet to User
    const paymentTx = {
        TransactionType: 'Payment',
        Account: distributionWallet.address, // <-- CHANGED
        Amount: {
            currency: tokenCurrencyCode,
            issuer: issuerAddress, // <-- Issuer address stays the same here
            value: tokenAmount.toString(),
        },
        Destination: userWallet.address,
    };
    const prepPayment = await client.autofill(paymentTx);
    const signedPayment = distributionWallet.sign(prepPayment); // <-- CHANGED
    const paymentResult = await client.submitAndWait(signedPayment.tx_blob);
    console.log(`TRANSFERRED ${tokenAmount} of ${tokenCurrencyCode} to ${userWallet.address}.`);

    // 3. Freeze the Trust Line (this remains the same)
    const freezeTx = {
        TransactionType: 'TrustSet',
        Account: userWallet.address,
        LimitAmount: {
            currency: tokenCurrencyCode,
            issuer: issuerAddress,
            value: '0',
        },
        Flags: xrpl.TrustSetFlags.tfSetFreeze,
    };
    const prepFreeze = await client.autofill(freezeTx);
    const signedFreeze = userWallet.sign(prepFreeze);
    await client.submitAndWait(signedFreeze.tx_blob);
    console.log(`Property token TrustLine FROZEN for ${userWallet.address}.`);

    return paymentResult.result.hash;
}

async function unfreezeTokens(userSeed, tokenCurrencyCode) {
    const client = await getClient();
    const userWallet = xrpl.Wallet.fromSeed(userSeed);
    const issuerAddress = xrpl.Wallet.fromSeed(ISSUER_WALLET_SEED).address;

    // To unfreeze, we send a TrustSet transaction with the tfClearFreeze flag.
    const unfreezeTx = {
        TransactionType: 'TrustSet',
        Account: userWallet.address,
        LimitAmount: {
            currency: tokenCurrencyCode,
            issuer: issuerAddress,
            // The value field is ignored when clearing a freeze, but it must be present.
            // We can just set it to a high limit.
            value: '1000000000',
        },
        Flags: xrpl.TrustSetFlags.tfClearFreeze, // <-- The key flag to UNFREEZE
    };

    const prepared = await client.autofill(unfreezeTx);
    const signed = userWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    console.log(`Property token TrustLine UN-FROZEN for ${userWallet.address} for token ${tokenCurrencyCode}.`);
    return result.result.hash;
}

// CHANGED: This function now distributes our dummy AED token, not XRP.
async function distributeRent(holders) {
    const client = await getClient();
    const operationalWallet = xrpl.Wallet.fromSeed(OPERATIONAL_WALLET_SEED);
    
    const results = [];
    for (const holder of holders) {
        if (holder.rent_due_aed <= 0) continue;

        const roundedAmount = holder.rent_due_aed.toFixed(6);

        const payment = {
            TransactionType: 'Payment',
            Account: operationalWallet.address,
            // CHANGED: Amount is now an object for our issued AED currency
            Amount: {
                currency: FIAT_CURRENCY_CODE,
                issuer: operationalWallet.address,
                value: roundedAmount,
            },
            Destination: holder.xrpl_address,
            Memos: [{
                Memo: {
                    MemoType: xrpl.convertStringToHex('rent_payment'),
                    MemoData: xrpl.convertStringToHex(`Rent for PropertyID: ${holder.propertyId}`)
                }
            }]
        };

        try {
            const prepared = await client.autofill(payment);
            const signed = operationalWallet.sign(prepared);
            const result = await client.submitAndWait(signed.tx_blob);
            results.push({
                address: holder.xrpl_address,
                amount_aed: holder.rent_due_aed,
                status: result.result.meta.TransactionResult
            });
            console.log(`Paid ${holder.rent_due_aed} AED rent to ${holder.xrpl_address}: ${result.result.meta.TransactionResult}`);
        } catch (error) {
            console.error(`Failed to pay rent to ${holder.xrpl_address}:`, error.message);
            results.push({
                address: holder.xrpl_address,
                amount_aed: holder.rent_due_aed,
                status: 'tecUNFUNDED_PAYMENT', // Or another error code
                error: error.message
            });
        }
    }
    return results;
}

module.exports = {
    // ... (export other functions as before)
    getClient,
    createCustodialWallet,
    fundNewWallet,
    setupFiatTrustLine,
    configureIssuerAccount,
    mintAllPropertyTokens, 
    distributeAndFreezeTokens,
    unfreezeTokens,
    distributeRent,
    ISSUER_WALLET_ADDRESS: xrpl.Wallet.fromSeed(ISSUER_WALLET_SEED).address
};