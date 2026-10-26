import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { checkBtcAddress } from "./btc-check";

const address = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";

function createHarness(
  answer: string,
  overrides: Partial<Parameters<typeof checkBtcAddress>[1]> = {}
) {
  const logs: unknown[][] = [];
  const errors: unknown[][] = [];
  const exitCodes: number[] = [];

  const run = checkBtcAddress(answer, {
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

function stats(
  chain: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number },
  mempool: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }
) {
  return {
    chain_stats: chain,
    mempool_stats: mempool,
  };
}

describe("btc-check", () => {
  test("reports confirmed and unconfirmed funds", async () => {
    let requestedUrl = "";
    const data = stats(
      { funded_txo_sum: 10_000, spent_txo_sum: 2_500, tx_count: 3 },
      { funded_txo_sum: 1_000, spent_txo_sum: 250, tx_count: 1 }
    );
    const harness = createHarness(` ${address} `, {
      fetch: async (input) => {
        requestedUrl = String(input);
        return Response.json(data);
      },
    });

    await harness.run;

    expect(requestedUrl).toBe(
      `https://blockstream.info/api/address/${encodeURIComponent(address)}`
    );
    expect(harness.logs).toEqual([
      ["YEAH — FUNDS FOUND"],
      ["Confirmed:   7500 sats"],
      ["Unconfirmed: 750 sats"],
      ["Total:       8250 sats"],
    ]);
    expect(harness.errors).toEqual([]);
    expect(harness.exitCodes).toEqual([]);
  });

  test("rejects invalid addresses without calling the API", async () => {
    let fetched = false;
    const harness = createHarness("not-an-address", {
      fetch: async () => {
        fetched = true;
        return Response.json({});
      },
    });

    await harness.run;

    expect(harness.logs).toEqual([["FAIL — INVALID BITCOIN ADDRESS"]]);
    expect(fetched).toBe(false);
    expect(harness.exitCodes).toEqual([1]);
  });

  test("reports an unsuccessful API response", async () => {
    const harness = createHarness(address, {
      fetch: async () => new Response(null, { status: 503 }),
    });

    await harness.run;

    expect(harness.logs).toEqual([["FAIL — API HTTP 503"]]);
    expect(harness.exitCodes).toEqual([1]);
  });

  test("sets the process exit code when using the default exit handler", async () => {
    const previousExitCode = process.exitCode;

    try {
      await checkBtcAddress(address, {
        fetch: async () => new Response(null, { status: 503 }),
        log: () => {},
      });

      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode ?? 0;
    }
  });

  test("reports an address with no spendable balance", async () => {
    const harness = createHarness(address, {
      fetch: async () =>
        Response.json(
          stats(
            { funded_txo_sum: 500, spent_txo_sum: 500, tx_count: 4 },
            { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 }
          )
        ),
    });

    await harness.run;

    expect(harness.logs).toEqual([
      ["FAIL — NO FUNDS FOUND"],
      ["Transactions: 4"],
      ["This address currently has no spendable balance."],
    ]);
    expect(harness.exitCodes).toEqual([]);
  });

  test("reports fetch errors", async () => {
    const harness = createHarness(address, {
      fetch: async () => {
        throw new Error("network unavailable");
      },
    });

    await harness.run;

    expect(harness.errors).toEqual([
      ["FAIL — CHECK ERROR:", "network unavailable"],
    ]);
    expect(harness.exitCodes).toEqual([1]);
  });

  test("reports unknown errors", async () => {
    const harness = createHarness(address, {
      fetch: async () => {
        throw "unexpected";
      },
    });

    await harness.run;

    expect(harness.errors).toEqual([["FAIL — CHECK ERROR:", "Unknown error"]]);
    expect(harness.exitCodes).toEqual([1]);
  });

  test("accepts bech32 addresses", async () => {
    let requestedUrl = "";
    const bech32 = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
    const harness = createHarness(bech32, {
      fetch: async (input) => {
        requestedUrl = String(input);
        return Response.json(
          stats(
            { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
            { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 }
          )
        );
      },
    });

    await harness.run;

    expect(requestedUrl).toBe(`https://blockstream.info/api/address/${bech32}`);
    expect(harness.logs[0]).toEqual(["FAIL — NO FUNDS FOUND"]);
  });

  test.each(["", "   ", "2abc", "bc1", `1${"a".repeat(100)}`, "1abc def"])(
    "rejects malformed address %p",
    async (bad) => {
      let fetched = false;
      const harness = createHarness(bad, {
        fetch: async () => {
          fetched = true;
          return Response.json({});
        },
      });

      await harness.run;

      expect(fetched).toBe(false);
      expect(harness.logs).toEqual([["FAIL — INVALID BITCOIN ADDRESS"]]);
      expect(harness.exitCodes).toEqual([1]);
    }
  );

  test("reports funds when only unconfirmed balance exists", async () => {
    const harness = createHarness(address, {
      fetch: async () =>
        Response.json(
          stats(
            { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
            { funded_txo_sum: 900, spent_txo_sum: 0, tx_count: 1 }
          )
        ),
    });

    await harness.run;

    expect(harness.logs[0]).toEqual(["YEAH — FUNDS FOUND"]);
    expect(harness.logs[3]).toEqual(["Total:       900 sats"]);
  });

  test("reports invalid JSON from the API as an error", async () => {
    const harness = createHarness(address, {
      fetch: async () => new Response("not json", { status: 200 }),
    });

    await harness.run;

    expect(harness.errors[0]?.[0]).toBe("FAIL — CHECK ERROR:");
    expect(harness.exitCodes).toEqual([1]);
  });

  test("checks a prompted address", async () => {
    const logs: unknown[][] = [];
    const input = new PassThrough();
    input.end(`${address}\n`);

    await checkBtcAddress(undefined, {
      input,
      output: new PassThrough(),
      fetch: async () =>
        Response.json(
          stats(
            { funded_txo_sum: 1, spent_txo_sum: 0, tx_count: 1 },
            { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 }
          )
        ),
      log: (...args) => logs.push(args),
    });

    expect(logs[0]).toEqual(["YEAH — FUNDS FOUND"]);
  });

  test("CLI accepts the address as an argument without prompting", async () => {
    const proc = Bun.spawn(["bun", `${import.meta.dir}/btc-check.ts`, "not-an-address"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();

    expect(await proc.exited).toBe(1);
    expect(out).toContain("FAIL — INVALID BITCOIN ADDRESS");
    expect(out).not.toContain("Bitcoin address:");
  });

  test("prompts for an address when no input argument is provided", async () => {
    const logs: unknown[][] = [];
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    input.end("invalid\n");

    await checkBtcAddress(undefined, {
      input,
      output,
      log: (...args) => logs.push(args),
      setExitCode: () => {},
    });

    expect(Buffer.concat(outputChunks).toString()).toContain("Bitcoin address: ");
    expect(logs).toEqual([["FAIL — INVALID BITCOIN ADDRESS"]]);
  });
});