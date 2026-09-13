import { createClient, lamports } from "@solana/kit";
import { memoProgram } from "@solana-program/memo";
import { solanaDevnetRpc } from "@solana/kit-plugin-rpc";
import { airdropSigner, generatedSigner } from "@solana/kit-plugin-signer";
import { devnetExplorerUrl } from "../src/lib/workout-proof";

if (process.env.RUN_SOLANA_DEVNET !== "1") {
  throw new Error(
    "This script writes a test memo to Solana devnet. Set RUN_SOLANA_DEVNET=1 to confirm.",
  );
}

async function main() {
  const client = await createClient()
    .use(generatedSigner())
    .use(
      solanaDevnetRpc({
        rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
      }),
    )
    .use(airdropSigner(lamports(10_000_000n)))
    .use(memoProgram());

  const nonce = crypto.randomUUID();
  const result = await client.memo.instructions
    .addMemo({ memo: "formchain:integration-test:v1|nonce=" + nonce })
    .sendTransaction();
  const signature = String(result.context.signature);

  console.log(devnetExplorerUrl(signature));
}

void main();
