import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { deriveBtcAddress } from "./seed";

const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

function createHarness(
  answer: string,
  overrides: Partial<Parameters<typeof deriveBtcAddress>[1]> = {}
) {
  const logs: unknown[][] = [];
  const errors: unknown[][] = [];
  const exitCodes: number[] = [];

  const run = deriveBtcAddress(answer, {
    log: (...args) => logs.push(args),
    error: (...args) => errors.push(args),
    setExitCode: (code) => exitCodes.push(code),
    ...overrides,
  });

  return {
    run,
    logs,
    errors,
    exitCodes,
  };
}

describe("seed2btc", () => {
  test("derives the expected BIP84 mainnet address for a valid mnemonic", async () => {
    const harness = createHarness(`  ${mnemonic}  `);

    await harness.run;

    expect(harness.logs).toEqual([
      ["\nYEAH — ADDRESS DERIVED"],
      ["Network: Bitcoin mainnet"],
      ["Path:    m/84'/0'/0'/0/0"],
      ["Address: bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"],
    ]);
    expect(harness.errors).toEqual([]);
    expect(harness.exitCodes).toEqual([]);
  });

  test("rejects an invalid mnemonic without deriving an address", async () => {
    const derivePayment = async () => {
      throw new Error("should not derive");
    };
    const harness = createHarness("not a valid seed", { derivePayment });

    await harness.run;

    expect(harness.logs).toEqual([["FAIL — INVALID BIP39 MNEMONIC"]]);
    expect(harness.errors).toEqual([]);
    expect(harness.exitCodes).toEqual([1]);
  });

  test("sets the process exit code when using the default exit handler", async () => {
    const previousExitCode = process.exitCode;

    try {
      await deriveBtcAddress("invalid", {
        log: () => {},
      });

      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode ?? 0;
    }
  });

  test("reports a missing public key", async () => {
    const harness = createHarness(mnemonic, {
      derivePayment: async () => ({ address: "bc1qexample" }),
    });

    await harness.run;

    expect(harness.errors).toEqual([["FAIL —", "Could not derive public key"]]);
    expect(harness.exitCodes).toEqual([1]);
  });

  test("reports a missing address", async () => {
    const harness = createHarness(mnemonic, {
      derivePayment: async () => ({ publicKey: new Uint8Array([1]) }),
    });

    await harness.run;

    expect(harness.errors).toEqual([["FAIL —", "Could not derive address"]]);
    expect(harness.exitCodes).toEqual([1]);
  });

  test("reports unknown derivation errors", async () => {
    const harness = createHarness(mnemonic, {
      derivePayment: async () => {
        throw "unexpected";
      },
    });

    await harness.run;

    expect(harness.errors).toEqual([["FAIL —", "Unknown error"]]);
    expect(harness.exitCodes).toEqual([1]);
  });

  test("returns the derived address", async () => {
    const harness = createHarness(mnemonic);

    expect(await harness.run).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
  });

  test("returns nothing for an invalid mnemonic", async () => {
    const harness = createHarness("invalid");

    expect(await harness.run).toBeUndefined();
  });

  test("reports Error messages from derivation", async () => {
    const harness = createHarness(mnemonic, {
      derivePayment: async () => {
        throw new Error("boom");
      },
    });

    await harness.run;

    expect(harness.errors).toEqual([["FAIL —", "boom"]]);
    expect(harness.exitCodes).toEqual([1]);
  });

  test("rejects a mnemonic with a bad checksum", async () => {
    const harness = createHarness(mnemonic.replace(/about$/, "abandon"));

    await harness.run;

    expect(harness.logs).toEqual([["FAIL — INVALID BIP39 MNEMONIC"]]);
    expect(harness.exitCodes).toEqual([1]);
  });

  test("derives from a prompted seed phrase", async () => {
    const logs: unknown[][] = [];
    const input = new PassThrough();
    input.end(`${mnemonic}\n`);

    const result = await deriveBtcAddress(undefined, {
      input,
      output: new PassThrough(),
      log: (...args) => logs.push(args),
    });

    expect(result).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
  });

  test("CLI accepts the seed phrase as arguments without prompting", async () => {
    const proc = Bun.spawn(["bun", `${import.meta.dir}/seed2btc.ts`, ...mnemonic.split(" ")], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();

    expect(await proc.exited).toBe(0);
    expect(out).toContain("Address: bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    expect(out).not.toContain("Seed phrase:");
  });

  test("CLI accepts the seed phrase as a single quoted argument", async () => {
    const proc = Bun.spawn(["bun", `${import.meta.dir}/seed2btc.ts`, mnemonic], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();

    expect(await proc.exited).toBe(0);
    expect(out).toContain("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
  });

  test("CLI exits non-zero for an invalid seed phrase argument", async () => {
    const proc = Bun.spawn(["bun", `${import.meta.dir}/seed2btc.ts`, "not", "valid"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();

    expect(await proc.exited).toBe(1);
    expect(out).toContain("FAIL — INVALID BIP39 MNEMONIC");
  });

  test("prompts for a seed phrase when no input argument is provided", async () => {
    const logs: unknown[][] = [];
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    input.end("invalid\n");

    await deriveBtcAddress(undefined, {
      input,
      output,
      log: (...args) => logs.push(args),
      setExitCode: () => {},
    });

    expect(Buffer.concat(outputChunks).toString()).toContain("Seed phrase: ");
    expect(logs).toEqual([["FAIL — INVALID BIP39 MNEMONIC"]]);
  });
});