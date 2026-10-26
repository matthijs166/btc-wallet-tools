

import { deriveBtcAddress } from "./seed";
import { checkBtcAddress } from "./btc-check";

// Ask for seed
const seed = prompt("Enter your bip39 seed phrase: ");
if (!seed) {
  throw new Error("Seed phrase is required");
}

// Derive the Bitcoin address from the seed
const btcAddress = await deriveBtcAddress(seed);
console.log(`Derived Bitcoin address: ${btcAddress}`);
if (!btcAddress) {
  throw new Error("Failed to derive Bitcoin address");
}

// Check the Bitcoin address for funds
await checkBtcAddress(btcAddress);
