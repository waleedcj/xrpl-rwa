# VARA-Compliant Real Estate Tokenization Platform on XRPL

This project is a backend service for a real estate tokenization platform designed for the UAE market, adhering to a VARA-compliant custodial model. It is built with Node.js, Express, and PostgreSQL, and it interacts with the XRP Ledger for all on-chain activities.

The platform allows real estate companies to list properties for fractional ownership, where investors can purchase tokens representing that ownership. These tokens generate yield from rental income, which is distributed on-chain.

## Key Features

-   **User Authentication:** Secure user registration and login using JWT (JSON Web Tokens).
-   **Role-Based Access Control:** Differentiates between `admin` and `user` roles to protect sensitive endpoints.
-   **Custodial Wallet System:** Automatically creates and manages secure custodial wallets for users on the XRPL.
-   **Property Tokenization:** Admins can list properties, which generates a unique security token for each one on the XRPL.
-   **Pre-Mint Token Model:** Follows the industry standard of minting the entire token supply to a secure distribution wallet, ensuring a fixed and transparent total supply.
-   **Compliant Investment Flow:** A robust, transaction-based investment process that prevents over-funding and handles race conditions.
-   **On-Chain Rental Distribution:** A mechanism for admins to distribute rental income (as a platform-issued AED token) to all token holders.
-   **Compliance-Ready Token Controls:** Implements on-chain `Freeze` and `Unfreeze` capabilities, essential for managing secondary market trades and meeting regulatory requirements.

## Architecture Overview

The platform uses a three-wallet system on the XRP Ledger for maximum security and clarity of roles:

1.  **Issuer Wallet:** A highly secure wallet whose only purpose is to create the currency codes for new property tokens.
2.  **Distribution Wallet:** A wallet that receives the entire pre-minted supply of tokens from the Issuer. It acts as the inventory and transfers tokens to investors.
3.  **Operational Wallet:** Used for platform-wide activities like funding new user wallets with XRP and distributing rental income.

## Technology Stack

-   **Backend:** Node.js, Express.js
-   **Database:** PostgreSQL
-   **Blockchain:** XRP Ledger (Testnet)
-   **Libraries:**
    -   `xrpl.js`: For interacting with the XRP Ledger.
    -   `pg`: For connecting to the PostgreSQL database.
    -   `jsonwebtoken` & `bcrypt`: for authentication and password hashing.
    -   `cors` & `dotenv`: for middleware and environment management.

---

## Getting Started

Follow these instructions to get the project set up and running on your local machine.

### Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or later)
-   [PostgreSQL](https://www.postgresql.org/download/) installed and running.

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd <your-project-directory>
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Database Setup

1.  **Create a PostgreSQL Database:**
    Open `psql` or your preferred PostgreSQL GUI and run the following command to create a new database.

    ```sql
    CREATE DATABASE real_estate_platform;
    ```

2.  **Create the Schema:**
    Connect to your new `real_estate_platform` database and run all the SQL commands from the `db.sql` file in the project root. This will create the `users`, `properties`, `investments`, and `rental_distributions` tables.

### 4. Environment Variables

1.  **Create a `.env` file** in the root of the project.
2.  Copy the contents of the `.env.example` file (pasted below for convenience) into your new `.env` file.

**.env.example**
```env
# Database Connection
DB_USER="your_postgres_user"
DB_HOST="localhost"
DB_DATABASE="real_estate_platform"
DB_PASSWORD="your_postgres_password"
DB_PORT=5432

# XRPL Testnet Wallet Seeds
# Get these from the XRPL Testnet Faucet: https://xrpl.org/xrp-testnet-faucet.html
ISSUER_WALLET_SEED="sXXXXXXXXXXXXXXXXXXXXXXXX"
DISTRIBUTION_WALLET_SEED="sYYYYYYYYYYYYYYYYYYYYYYYY"
OPERATIONAL_WALLET_SEED="sZZZZZZZZZZZZZZZZZZZZZZZZ"

# JWT Secret for Authentication
JWT_SECRET="a_very_long_and_super_secret_string_that_no_one_can_guess_12345!"
```

3.  **Fill in the values:**
    -   Update the `DB_*` variables with your PostgreSQL credentials.
    -   Go to the [XRPL Testnet Faucet](https://xrpl.org/xrp-testnet-faucet.html) and generate **three** new sets of credentials. Paste their "Secret" values into the corresponding `..._WALLET_SEED` variables.
    -   Ensure the `OPERATIONAL_WALLET_SEED` account is funded with Testnet XRP from the faucet.

### 5. Running the Application

Once the database and environment variables are set up, you can start the server.

```bash
node api.js
```

You should see the following output in your console, indicating the server is running and connected to the XRPL:

```
Server running on port 3000
Connecting to XRPL Testnet...
Connected to XRPL Testnet.
Property Token Issuer account configured: tesSUCCESS
```

---

## API Endpoints

### Authentication

-   **`POST /register`** (Public)
    -   Registers a new user.
    -   Body: `{ "name": "...", "email": "...", "password": "..." }`
-   **`POST /login`** (Public)
    -   Logs in a user and returns a JWT.
    -   Body: `{ "email": "...", "password": "..." }`

### Properties

-   **`GET /properties`** (Public)
    -   Returns a list of all properties with their funding status and holder count.
-   **`POST /properties`** (Admin Only)
    -   Creates a new property listing.
    -   Body: `{ "name": "...", "total_value_aed": ..., "tokens_to_issue": ..., "token_name": "..." }`
-   **`POST /properties/:propertyId/mint`** (Admin Only)
    -   Mints the entire supply of tokens for a specific property.
-   **`GET /properties/:propertyId/holders`** (Admin Only)
    -   Returns a list of all token holders for a specific property.

### User Actions

-   **`POST /deposit-fiat`** (User Only)
    -   Simulates a fiat deposit for the logged-in user.
    -   Body: `{ "amount": ... }`
-   **`POST /invest`** (User Only)
    -   Invests in a property on behalf of the logged-in user.
    -   Body: `{ "propertyId": "...", "amountInvestedAed": ... }`

### User Data

-   **`GET /dashboard/:userId`** (User Only, Admins can view any)
    -   Returns dashboard info, including balance and token holdings.
-   **`GET /users/:userId/investments`** (User Only, Admins can view any)
    -   Returns the investment history for a specific user.
-   **`GET /users/:userId/rent-history`** (User Only, Admins can view any)
    -   Returns the rental income history for a specific user.

### Admin Controls

-   **`POST /distribute-rent`** (Admin Only)
    -   Initiates the on-chain rent distribution for a property.
    -   Body: `{ "propertyId": "...", "totalRentAed": ..., "rentInAedPerToken": ... }`
-   **`POST /unfreeze`** (Admin Only)
    -   Unfreezes a user's tokens for a specific property to allow a transfer.
    -   Body: `{ "userId": "...", "propertyId": "..." }`