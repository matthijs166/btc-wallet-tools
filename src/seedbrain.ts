import * as bip39 from "bip39";
import * as ecc from "tiny-secp256k1";
import BIP32Factory from "bip32";
import { payments, initEccLib } from "bitcoinjs-lib";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

initEccLib(ecc);

const bip32 = BIP32Factory(ecc);

type Readline = Pick<
  ReturnType<typeof createInterface>,
  "question" | "close"
>;

type DerivedPayment = {
  publicKey?: Uint8Array;
  address?: string;
};

type Dependencies = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  derivePayment: (mnemonic: string) => Promise<DerivedPayment>;
  log: typeof console.log;
  error: typeof console.error;
  setExitCode: (code: number) => void;
};

const defaultDependencies: Dependencies = {
  input: stdin,
  output: stdout,
  derivePayment: async (mnemonic) => {
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const root = bip32.fromSeed(seed);

    // BIP84: Bitcoin mainnet, Native SegWit (bc1q...)
    const path = "m/84'/0'/0'/0/0";
    const child = root.derivePath(path);
    const payment = child.publicKey
      ? payments.p2wpkh({
          pubkey: child.publicKey,
          network: bitcoinNetwork(),
        })
      : {};

    return { publicKey: child.publicKey, address: payment.address };
  },
  log: console.log,
  error: console.error,
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

export async function deriveBtcAddress(
  mnemonicInput?: string,
  overrides: Partial<Dependencies> = {}
): Promise<string | void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  let rl: Readline | undefined;

  try {
    const mnemonic =
      mnemonicInput ??
      (await (rl = createInterface({
        input: dependencies.input,
        output: dependencies.output,
      })).question("Brain wallet phrase: "));

    const phrase = mnemonic.trim();
    if (!phrase) {
      dependencies.log("FAIL — EMPTY BRAIN WALLET");
      dependencies.setExitCode(1);
      return;
    }

    // A brain wallet must not be checkable against the BIP39 word list.
    // Phrases whose every word is in that list are rejected, including
    // checksum-valid mnemonics and word-list phrases with a bad checksum.
    if (isVerifiableViaBipWordlist(phrase)) {
      dependencies.log("FAIL — VERIFIABLE VIA BIP WORD LIST");
      dependencies.setExitCode(1);
      return;
    }

    const path = "m/84'/0'/0'/0/0";
    const payment = await dependencies.derivePayment(phrase);

    if (!payment.publicKey) {
      throw new Error("Could not derive public key");
    }

    if (!payment.address) {
      throw new Error("Could not derive address");
    }

    dependencies.log("\nYEAH — ADDRESS DERIVED");
    dependencies.log(`Network: Bitcoin mainnet`);
    dependencies.log(`Path:    ${path}`);
    dependencies.log(`Mode:    Brain wallet (not BIP39-verifiable)`);
    dependencies.log(`Address: ${payment.address}`);
    return payment.address;
  } catch (error) {
    dependencies.error(
      "FAIL —",
      error instanceof Error ? error.message : "Unknown error"
    );
    dependencies.setExitCode(1);
  } finally {
    rl?.close();
  }
}

function isVerifiableViaBipWordlist(phrase: string): boolean {
  const wordlist = bip39.wordlists.english;
  if (!wordlist) {
    throw new Error("BIP39 English word list is unavailable");
  }

  const words = phrase.normalize("NFKD").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return false;
  }

  const allowed = new Set(wordlist);
  return words.every((word) => allowed.has(word));
}

function bitcoinNetwork() {
  return {
    messagePrefix: "\x18Bitcoin Signed Message:\n",
    bech32: "bc",
    bip32: { public: 0x0488b21e, private: 0x0488ade4 },
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80,
  };
}

if (import.meta.main) {
  await deriveBtcAddress(process.argv.slice(2).join(" ") || undefined);
}
