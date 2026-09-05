import assert from "node:assert/strict";
import { analyzeWav } from "./analyze-wav.mjs";

export function recordedStop(wav, evidence) {
  assert.ok(evidence, "missing recorded capture interval evidence");
  const { stopFrame, recordedFrames, voicesFreedAfterFrame, allocatedFrames } = evidence;
  for (const value of [stopFrame, recordedFrames, voicesFreedAfterFrame, allocatedFrames]) {
    assert.ok(Number.isInteger(value) && value > 0, "invalid capture frame evidence");
  }
  const sampleRate = 48000;
  const preStart = stopFrame - 0.25 * sampleRate;
  const preEnd = stopFrame - 0.1 * sampleRate;
  const postStart = stopFrame + 1.6 * sampleRate;
  const postEnd = stopFrame + 1.7 * sampleRate;
  assert.ok(postEnd < recordedFrames, "post-fade interval was not recorded");
  assert.ok(postEnd < voicesFreedAfterFrame, "voices were freed before the measured interval");
  assert.ok(recordedFrames <= allocatedFrames && allocatedFrames <= 120 * sampleRate);
  const capture = analyzeWav(wav, [
    { name: "preStop", start: preStart / sampleRate, end: preEnd / sampleRate },
    { name: "postStop", start: postStart / sampleRate, end: postEnd / sampleRate },
  ]);
  assert.equal(capture.format.sampleRate, sampleRate);
  assert.equal(capture.duration * sampleRate, allocatedFrames);
  assert.ok(capture.segments[0].channels.every(({peak}) => peak > 0.001), "no active audio immediately before stop");
  return capture;
}

export function requireRecordedSilence(capture) {
  assert.equal(capture.segments.find(({name}) => name === "postStop").peak, 0,
    "recorded post-fade audio is not silent");
}
