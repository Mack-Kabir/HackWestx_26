import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateKeyPair,
  getAddressFromPublicKey,
  signBytes,
} from "@solana/kit";
import { analyzeSquats, demoFrames } from "../src/lib/analysis";
import {
  calculateReward,
  createRewardRedemptionMessage,
  encodeWalletSignature,
  issueRewardAttestation,
  RewardError,
  RewardLedger,
  verifyRewardAttestation,
} from "../src/lib/reward-policy";
import {
  createWorkoutClaim,
  hashWorkoutClaim,
} from "../src/lib/workout-proof";

const secret = "test-only-formchain-attestation-secret-0001";
const now = Date.UTC(2026, 8, 12, 20, 0, 0);
const analysis = analyzeSquats(demoFrames(), 1000, 1000, 12, "video");

async function fixture(options?: { gymVisit?: boolean; score?: number }) {
  const keyPair = await generateKeyPair();
  const walletAddress = await getAddressFromPublicKey(keyPair.publicKey);
  const claim = createWorkoutClaim({
    ...analysis,
    movementScore: options?.score ?? analysis.movementScore,
  });
  const issueInput = {
    walletAddress,
    claim,
    claimDigest: await hashWorkoutClaim(claim),
    evidence: {
      version: "formchain.evidence.v1" as const,
      evidenceId: crypto.randomUUID(),
      source: "trusted-analysis-service" as const,
      observedAtMs: now - 1_000,
    },
    gymVisit: options?.gymVisit
      ? {
          version: "formchain.gym-visit.v1" as const,
          visitId: crypto.randomUUID(),
          gymId: "hackwestx-demo-gym",
          method: "rotating-gym-qr" as const,
          checkedInAtMs: now - 46 * 60_000,
          checkedOutAtMs: now - 60_000,
        }
      : undefined,
  };
  const attestation = await issueRewardAttestation(issueInput, secret, now);
  const walletSignature = encodeWalletSignature(
    await signBytes(
      keyPair.privateKey,
      createRewardRedemptionMessage(attestation.payload),
    ),
  );
  return { attestation, claim, issueInput, keyPair, walletSignature };
}

test("the reward policy ignores provisional form score and clip duration", async () => {
  const low = await fixture({ score: 1 });
  const high = await fixture({ score: 99 });
  assert.deepEqual(calculateReward(low.claim), calculateReward(high.claim));
  assert.equal(calculateReward(low.claim).verifiedGymTime, 0);
  assert.equal(calculateReward(low.claim).total, 16);
});

test("only verified QR attendance contributes capped gym-time points", async () => {
  const { claim, issueInput } = await fixture({ gymVisit: true });
  const reward = calculateReward(claim, issueInput.gymVisit);
  assert.equal(reward.verifiedGymTime, 9);
  assert.equal(reward.total, 25);
  assert.throws(() =>
    calculateReward(claim, {
      ...issueInput.gymVisit!,
      checkedOutAtMs: issueInput.gymVisit!.checkedInAtMs + 13 * 60 * 60_000,
    }),
  );
});

test("attestations are signed, expire, and bind the exact claim digest", async () => {
  const { attestation, issueInput } = await fixture();
  assert.deepEqual(
    await verifyRewardAttestation(attestation, secret, now),
    attestation.payload,
  );
  await assert.rejects(
    verifyRewardAttestation(attestation, secret, now + 11 * 60_000),
    (error: unknown) =>
      error instanceof RewardError && error.code === "attestation_expired",
  );
  await assert.rejects(
    issueRewardAttestation(
      { ...issueInput, claimDigest: "0".repeat(64) },
      secret,
      now,
    ),
    (error: unknown) =>
      error instanceof RewardError && error.code === "claim_digest_mismatch",
  );
});

test("redemption requires the bound wallet and rejects replay", async () => {
  const { attestation, issueInput, keyPair, walletSignature } = await fixture({
    gymVisit: true,
  });
  const ledger = new RewardLedger();
  const receipt = await ledger.redeem(
    attestation,
    walletSignature,
    secret,
    now,
  );
  assert.equal(receipt.awardedPoints, 25);
  assert.equal(receipt.balance, 25);
  assert.equal(receipt.storage, "ephemeral-prototype");
  await assert.rejects(
    ledger.redeem(attestation, walletSignature, secret, now),
    (error: unknown) =>
      error instanceof RewardError && error.code === "attestation_replayed",
  );

  const reissued = await issueRewardAttestation(issueInput, secret, now + 1);
  const reissuedSignature = encodeWalletSignature(
    await signBytes(
      keyPair.privateKey,
      createRewardRedemptionMessage(reissued.payload),
    ),
  );
  await assert.rejects(
    ledger.redeem(reissued, reissuedSignature, secret, now + 1),
    (error: unknown) =>
      error instanceof RewardError && error.code === "attestation_replayed",
  );
});

test("a different wallet cannot redeem a valid attestation", async () => {
  const { attestation } = await fixture();
  const attacker = await generateKeyPair();
  const forgedSignature = encodeWalletSignature(
    await signBytes(
      attacker.privateKey,
      createRewardRedemptionMessage(attestation.payload),
    ),
  );
  await assert.rejects(
    new RewardLedger().redeem(attestation, forgedSignature, secret, now),
    (error: unknown) =>
      error instanceof RewardError &&
      error.code === "wallet_signature_invalid",
  );
});
