import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { motionRequest, motionResponse, validateBvh } from "../src/lib/motion";

const sample = readFileSync(
  new URL("./fixtures/simple-squat.bvh", import.meta.url),
  "utf8",
);

test("the bounded BVH parser accepts a small complete motion", () => {
  const result = validateBvh(sample);
  assert.deepEqual(result, { duration: 0.0666666, frames: 3, joints: 3 });
});

test("BVH validation rejects missing frames, unreasonable values, and large files", () => {
  assert.throws(() => validateBvh(sample.replace(/0 0 0 0 0 0 0 0 0\s*$/, "")));
  assert.throws(() => validateBvh(sample.replace("0.0333333", "0.00001")));
  assert.throws(() => validateBvh("x".repeat(2_000_001)));
});

test("motion API contracts accept only bounded squat demonstrations", () => {
  assert.equal(
    motionRequest.safeParse({ duration: 4, variant: "front-squat" }).success,
    true,
  );
  assert.equal(
    motionRequest.safeParse({ duration: 30, variant: "deadlift" }).success,
    false,
  );
  assert.equal(
    motionResponse.safeParse({
      status: "complete",
      id: "not-a-uuid",
      bvh: sample,
      model: "Kimodo",
    }).success,
    false,
  );
});
