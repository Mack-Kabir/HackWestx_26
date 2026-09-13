"use client";

import { useMemo, useState } from "react";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useIsWalletReady,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import type { Analysis } from "@/lib/analysis";
import { solanaClient } from "@/lib/solana-client";
import {
  createWorkoutClaim,
  createWorkoutMemo,
  devnetExplorerUrl,
  hashWorkoutClaim,
} from "@/lib/workout-proof";

const shortAddress = (value: string) =>
  value.slice(0, 4) + "…" + value.slice(-4);

export default function WorkoutProof({ analysis }: { analysis: Analysis }) {
  const wallets = useWallets(solanaClient);
  const connected = useConnectedWallet(solanaClient);
  const ready = useIsWalletReady(solanaClient);
  const connectAction = useConnect(solanaClient);
  const disconnectAction = useDisconnect(solanaClient);
  const [selectedWallet, setSelectedWallet] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");
  const claim = useMemo(() => createWorkoutClaim(analysis), [analysis]);
  const wallet = wallets.find((candidate) => candidate.name === selectedWallet);

  async function submitProof() {
    if (!connected) return;
    setSubmitting(true);
    setError("");
    setSignature("");
    try {
      const digest = await hashWorkoutClaim(claim);
      const memo = createWorkoutMemo(claim, digest);
      const result = await solanaClient.memo.instructions
        .addMemo({ memo })
        .sendTransaction();
      setSignature(String(result.context.signature));
    } catch (reason) {
      const rejected = reason instanceof Error && reason.name === "AbortError";
      setError(
        rejected
          ? "The wallet request was cancelled. Nothing was recorded."
          : "The devnet proof could not be recorded. Check the wallet network and devnet SOL, then try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="workout-proof">
      <p className="overline">OPTIONAL DEVNET PROOF</p>
      <h3>Keep a public receipt</h3>
      <p>
        Your wallet can record a hash of this set on Solana devnet. No video,
        image, or landmark data is included.
      </p>
      {!ready ? (
        <p className="proof-note" role="status">
          Checking for a wallet…
        </p>
      ) : connected ? (
        <>
          <div className="proof-wallet">
            <span>
              {connected.wallet.name} ·{" "}
              {shortAddress(connected.account.address)}
            </span>
            <button
              className="link-button"
              disabled={disconnectAction.isRunning || submitting}
              onClick={() => disconnectAction.dispatch()}
            >
              Disconnect
            </button>
          </div>
          <button
            className="button outline"
            disabled={submitting}
            onClick={submitProof}
          >
            {submitting ? "Recording on devnet…" : "Record devnet proof"}
          </button>
        </>
      ) : wallets.length ? (
        <>
          <label htmlFor="proof-wallet">Wallet</label>
          <select
            id="proof-wallet"
            value={selectedWallet}
            onChange={(event) => setSelectedWallet(event.target.value)}
          >
            <option value="">Choose a wallet</option>
            {wallets.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </select>
          <button
            className="button outline"
            disabled={!wallet || connectAction.isRunning}
            onClick={() => wallet && connectAction.dispatch(wallet)}
          >
            {connectAction.isRunning ? "Connecting…" : "Connect devnet wallet"}
          </button>
        </>
      ) : (
        <p className="proof-note">
          No compatible browser wallet was found. Your movement review is still
          complete.
        </p>
      )}
      {Boolean(connectAction.error || disconnectAction.error) && (
        <p className="message error" role="alert">
          The wallet connection did not complete. Try again from your wallet.
        </p>
      )}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {signature && (
        <p className="proof-success" role="status">
          Proof recorded.{" "}
          <a
            href={devnetExplorerUrl(signature)}
            target="_blank"
            rel="noreferrer"
          >
            View on Solana Explorer
          </a>
        </p>
      )}
      <small>
        This is a wallet-signed self-claim, not verified attendance or reward
        eligibility. It spends a small devnet transaction fee; no tokens are
        issued.
      </small>
    </div>
  );
}
