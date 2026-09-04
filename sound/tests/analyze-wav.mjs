import { Buffer } from "node:buffer";

const MAX_WAV_BYTES = 64 * 1024 * 1024;
const FRAME_BYTES = 4;
const SAMPLE_SCALE = 32768;

const fail = (message) => {
  throw new Error(`Invalid WAV: ${message}`);
};

const emptyMetrics = () => ({
  peak: 0,
  squareSum: 0,
  sampleCount: 0,
  clippedSamples: 0,
});

const addSample = (metrics, rawSample) => {
  const sample = rawSample / SAMPLE_SCALE;
  metrics.peak = Math.max(metrics.peak, Math.abs(sample));
  metrics.squareSum += sample * sample;
  metrics.sampleCount += 1;
  if (rawSample === -32768 || rawSample === 32767) {
    metrics.clippedSamples += 1;
  }
};

const finishMetrics = ({ peak, squareSum, sampleCount, clippedSamples }) => ({
  peak,
  rms: Math.sqrt(squareSum / sampleCount),
  clippedSamples,
});

const parseChunks = (buffer) => {
  if (buffer.length < 12) fail("truncated RIFF header");
  if (buffer.toString("ascii", 0, 4) !== "RIFF") fail("missing RIFF signature");
  if (buffer.toString("ascii", 8, 12) !== "WAVE") fail("missing WAVE signature");

  const declaredEnd = buffer.readUInt32LE(4) + 8;
  if (declaredEnd !== buffer.length) fail("truncated or trailing RIFF data");

  let format = null;
  let pcmData = null;
  let offset = 12;
  while (offset < declaredEnd) {
    if (offset + 8 > declaredEnd) fail("truncated chunk header");
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkBytes = buffer.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    const bodyEnd = bodyStart + chunkBytes;
    const nextOffset = bodyEnd + (chunkBytes % 2);
    if (bodyEnd > declaredEnd || nextOffset > declaredEnd) fail("truncated chunk data");

    if (chunkId === "fmt ") {
      if (format !== null) fail("duplicate format chunk");
      if (chunkBytes < 16) fail("truncated format chunk");
      format = {
        audioFormat: buffer.readUInt16LE(bodyStart),
        channelCount: buffer.readUInt16LE(bodyStart + 2),
        sampleRate: buffer.readUInt32LE(bodyStart + 4),
        byteRate: buffer.readUInt32LE(bodyStart + 8),
        blockAlign: buffer.readUInt16LE(bodyStart + 12),
        bitsPerSample: buffer.readUInt16LE(bodyStart + 14),
      };
    } else if (chunkId === "data") {
      if (pcmData !== null) fail("duplicate data chunk");
      pcmData = { start: bodyStart, bytes: chunkBytes };
    }

    offset = nextOffset;
  }

  if (format === null) fail("missing format chunk");
  if (pcmData === null) fail("missing data chunk");
  return { format, pcmData };
};

const validateFormat = (format, pcmData) => {
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    fail("unsupported encoding; expected PCM16LE");
  }
  if (format.channelCount !== 2) fail("expected stereo audio");
  if (format.sampleRate === 0) fail("sample rate must be positive");
  if (format.blockAlign !== FRAME_BYTES) fail("invalid block alignment");
  if (format.byteRate !== format.sampleRate * FRAME_BYTES) fail("invalid byte rate");
  if (pcmData.bytes % FRAME_BYTES !== 0) fail("data is not frame-aligned");
  if (pcmData.bytes === 0) fail("empty audio data");
};

const validateSegments = (segments, sampleRate, duration) => {
  if (!Array.isArray(segments)) throw new TypeError("segments must be an Array");
  const names = new Set();

  return segments.map((segment) => {
    if (segment === null || typeof segment !== "object") fail("segment must be an object");
    const { name, start, end } = segment;
    if (typeof name !== "string" || name.length === 0 || names.has(name)) {
      fail("segment names must be non-empty and unique");
    }
    names.add(name);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      fail("segment boundaries must be finite");
    }
    if (start < 0 || end <= start || end > duration) fail("segment range is invalid");
    const exactFrameStart = start * sampleRate;
    const exactFrameEnd = end * sampleRate;
    const frameStart = Math.round(exactFrameStart);
    const frameEnd = Math.round(exactFrameEnd);
    if (
      Math.abs(exactFrameStart - frameStart) > 1e-7 ||
      Math.abs(exactFrameEnd - frameEnd) > 1e-7
    ) {
      fail("segment must end on a frame boundary");
    }
    if (frameEnd <= frameStart) fail("segment must contain at least one frame");
    return { name, start, end, frameStart, frameEnd };
  });
};

export const analyzeWav = (buffer, segments = []) => {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("WAV input must be a Buffer");
  if (buffer.length > MAX_WAV_BYTES) throw new RangeError("WAV input exceeds 64 MiB");

  const { format, pcmData } = parseChunks(buffer);
  validateFormat(format, pcmData);
  const frameCount = pcmData.bytes / FRAME_BYTES;
  const duration = frameCount / format.sampleRate;
  const checkedSegments = validateSegments(segments, format.sampleRate, duration);
  const channelMetrics = [emptyMetrics(), emptyMetrics()];
  const segmentMetrics = checkedSegments.map((segment) => ({
    ...segment,
    combined: emptyMetrics(),
    channels: [emptyMetrics(), emptyMetrics()],
  }));

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = pcmData.start + frame * FRAME_BYTES;
    for (let channel = 0; channel < 2; channel += 1) {
      const rawSample = buffer.readInt16LE(frameOffset + channel * 2);
      addSample(channelMetrics[channel], rawSample);
      for (const segment of segmentMetrics) {
        if (frame >= segment.frameStart && frame < segment.frameEnd) {
          addSample(segment.channels[channel], rawSample);
          addSample(segment.combined, rawSample);
        }
      }
    }
  }

  return {
    format: {
      container: "RIFF",
      encoding: "PCM16LE",
      sampleRate: format.sampleRate,
    },
    duration,
    channels: channelMetrics.map(finishMetrics),
    segments: segmentMetrics.map((segment) => {
      const combinedMetrics = finishMetrics(segment.combined);
      return {
        name: segment.name,
        start: segment.start,
        end: segment.end,
        peak: combinedMetrics.peak,
        rms: combinedMetrics.rms,
        channels: segment.channels.map(finishMetrics),
      };
    }),
  };
};
