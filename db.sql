-- Represents users of the platform
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    fiat_balance_aed NUMERIC(20, 2) DEFAULT 0.00,
    -- Custodial Wallet Info
    xrpl_address VARCHAR(35) NOT NULL UNIQUE,
    xrpl_seed_encrypted TEXT NOT NULL, -- Encrypted seed, managed by HSM in production
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Represents real estate properties available for tokenization
CREATE TABLE properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    total_value_aed NUMERIC(20, 2) NOT NULL,
    tokens_to_issue BIGINT NOT NULL,
    -- XRPL Token Info
    token_currency_code VARCHAR(40) NOT NULL UNIQUE, -- e.g., '4A48534D42303031000000000000000000000000' (Hex for JHSMB001)
    issuer_address VARCHAR(35) NOT NULL,
    is_fully_funded BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tracks user investments into properties (the bridge between fiat and tokens)
CREATE TABLE investments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    property_id UUID REFERENCES properties(id),
    amount_invested_aed NUMERIC(20, 2) NOT NULL,
    tokens_received BIGINT NOT NULL,
    xrpl_tx_hash VARCHAR(64), -- To link to the on-chain token transfer
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tracks rental income distributions
CREATE TABLE rental_distributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID REFERENCES properties(id),
    total_rent_aed NUMERIC(20, 2) NOT NULL,
    distribution_date DATE NOT NULL,
    xrpl_tx_hash VARCHAR(64), -- Can link to the master payment tx
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_properties_token_code ON properties(token_currency_code);