const xrpl = require('xrpl');

const mySeed = "your_seed_here";

try {
    // Create a Wallet instance from the seed
    const wallet = xrpl.Wallet.fromSeed(mySeed);

    // Get the classic R-address
    const classicAddress = wallet.address; 

    // Optionally, get the X-address (a modern address format that can include a destination tag)
    const xAddress = wallet.getXAddress();

    console.log("Wallet created successfully:");
    console.log("Classic Address (R-address):", classicAddress);
    console.log("X-Address:", xAddress);

} catch (error) {
    console.error("Error deriving wallet from seed:", error);
}