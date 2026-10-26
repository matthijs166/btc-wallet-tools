import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const API = "https://blockstream.info/api";

type Readline = Pick<
  ReturnType<typeof createInterface>,
  "question" | "close"
>;

type Dependencies = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  log: typeof console.log;
  error: typeof console.error;
  setExitCode: (code: number) => void;
};

const defaultDependencies: Dependencies = {
  input: stdin,
  output: stdout,
  fetch,
  log: console.log,
  error: console.error,
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

export async function checkBtcAddress(
  addressInput?: string,
  overrides: Partial<Dependencies> = {}
): Promise<true | void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  let rl: Readline | undefined;

  try {
    const address = (
      addressInput ??
      (await (rl = createInterface({
        input: dependencies.input,
        output: dependencies.output,
      })).question("Bitcoin address: "))
    ).trim();

    // Basic input validation. The API performs additional validation.
    if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,90}$/.test(address)) {
      dependencies.log("FAIL — INVALID BITCOIN ADDRESS");
      dependencies.setExitCode(1);
      return;
    }

    const response = await dependencies.fetch(
      `${API}/address/${encodeURIComponent(address)}`,
      { signal: AbortSignal.timeout(15000) }
    );

    if (!response.ok) {
      dependencies.log(`FAIL — API HTTP ${response.status}`);
      dependencies.setExitCode(1);
      return;
    }

    const data = await response.json() as {
      chain_stats: {
        funded_txo_sum: number;
        spent_txo_sum: number;
        tx_count: number;
      };
      mempool_stats: {
        funded_txo_sum: number;
        spent_txo_sum: number;
        tx_count: number;
      };
    };

    const confirmed =
      data.chain_stats.funded_txo_sum -
      data.chain_stats.spent_txo_sum;

    const unconfirmed =
      data.mempool_stats.funded_txo_sum -
      data.mempool_stats.spent_txo_sum;

    const total = confirmed + unconfirmed;

    if (total > 0) {
      dependencies.log("YEAH — FUNDS FOUND");
      dependencies.log(`Confirmed:   ${confirmed} sats`);
      dependencies.log(`Unconfirmed: ${unconfirmed} sats`);
      dependencies.log(`Total:       ${total} sats`);
      return true;
    } else {
      dependencies.log("FAIL — NO FUNDS FOUND");
      dependencies.log(`Transactions: ${data.chain_stats.tx_count}`);
      dependencies.log("This address currently has no spendable balance.");
    }
  } catch (error) {
    dependencies.error(
      "FAIL — CHECK ERROR:",
      error instanceof Error ? error.message : "Unknown error"
    );
    dependencies.setExitCode(1);
  } finally {
    rl?.close();
  }
}

if (import.meta.main) {
  await checkBtcAddress(process.argv.slice(2).join(" ") || undefined);
}
