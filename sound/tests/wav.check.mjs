import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import console from "node:console";
import { clearTimeout, setTimeout } from "node:timers";
import dgram from "node:dgram";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeWav } from "./analyze-wav.mjs";

const pcm16StereoWav = ({ sampleRate = 4, frames }) => {
  const frameBytes = 4;
  const dataBytes = frames.length * frameBytes;
  const wav = Buffer.alloc(44 + dataBytes);

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * frameBytes, 28);
  wav.writeUInt16LE(frameBytes, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);

  frames.forEach(([left, right], index) => {
    wav.writeInt16LE(left, 44 + index * frameBytes);
    wav.writeInt16LE(right, 46 + index * frameBytes);
  });
  return wav;
};

test("calculates exact PCM16 stereo channel and segment metrics", () => {
  const wav = pcm16StereoWav({
    frames: [
      [0, 0],
      [16384, -16384],
      [32767, -32768],
      [0, 0],
    ],
  });

  const analysis = analyzeWav(wav, [
    { name: "initial", start: 0, end: 0.25 },
    { name: "active", start: 0.25, end: 0.75 },
  ]);

  assert.deepEqual(analysis.format, {
    container: "RIFF",
    encoding: "PCM16LE",
    sampleRate: 4,
  });
  assert.equal(analysis.duration, 1);
  assert.equal(analysis.channels.length, 2);
  assert.equal(analysis.channels[0].peak, 32767 / 32768);
  assert.equal(analysis.channels[0].rms, Math.sqrt((0.25 + (32767 / 32768) ** 2) / 4));
  assert.equal(analysis.channels[0].clippedSamples, 1);
  assert.equal(analysis.channels[1].peak, 1);
  assert.equal(analysis.channels[1].rms, Math.sqrt((0.25 + 1) / 4));
  assert.equal(analysis.channels[1].clippedSamples, 1);
  assert.deepEqual(analysis.segments[0], {
    name: "initial",
    start: 0,
    end: 0.25,
    peak: 0,
    rms: 0,
    channels: [
      { peak: 0, rms: 0, clippedSamples: 0 },
      { peak: 0, rms: 0, clippedSamples: 0 },
    ],
  });
  assert.equal(analysis.segments[1].peak, 1);
  assert.equal(
    analysis.segments[1].rms,
    Math.sqrt((0.25 + 0.25 + (32767 / 32768) ** 2 + 1) / 4),
  );
});

test("rejects truncated and frame-misaligned RIFF data", () => {
  const wav = pcm16StereoWav({ frames: [[1, -1]] });
  const misaligned = Buffer.concat([wav, Buffer.from([0, 0])]);
  misaligned.writeUInt32LE(misaligned.length - 8, 4);
  misaligned.writeUInt32LE(6, 40);

  assert.throws(() => analyzeWav(wav.subarray(0, wav.length - 1)), /truncated/i);
  assert.throws(() => analyzeWav(misaligned), /frame-aligned/i);
});

test("rejects unsupported encodings and inconsistent PCM headers", () => {
  const floatingPoint = pcm16StereoWav({ frames: [[0, 0]] });
  floatingPoint.writeUInt16LE(3, 20);
  const mono = pcm16StereoWav({ frames: [[0, 0]] });
  mono.writeUInt16LE(1, 22);
  const wrongByteRate = pcm16StereoWav({ frames: [[0, 0]] });
  wrongByteRate.writeUInt32LE(123, 28);

  assert.throws(() => analyzeWav(floatingPoint), /unsupported/i);
  assert.throws(() => analyzeWav(mono), /stereo/i);
  assert.throws(() => analyzeWav(wrongByteRate), /byte rate/i);
});

test("rejects invalid or non-finite segment boundaries", () => {
  const wav = pcm16StereoWav({ frames: [[0, 0]] });

  assert.throws(
    () => analyzeWav(wav, [{ name: "nan", start: Number.NaN, end: 0.25 }]),
    /finite/i,
  );
  assert.throws(
    () => analyzeWav(wav, [{ name: "infinite", start: 0, end: Number.POSITIVE_INFINITY }]),
    /finite/i,
  );
  assert.throws(
    () => analyzeWav(wav, [{ name: "backward", start: 0.5, end: 0.25 }]),
    /range/i,
  );
  assert.throws(
    () => analyzeWav(wav, [{ name: "fractional", start: 0, end: 0.1 }]),
    /frame boundary/i,
  );
});

test("rejects non-buffer and greater-than-64-MiB inputs", () => {
  assert.throws(() => analyzeWav(new Uint8Array(44)), /Buffer/i);
  assert.throws(() => analyzeWav(Buffer.alloc(64 * 1024 * 1024 + 1)), /64 MiB/i);
});

const psLiteral = (value) => `'${value.replaceAll("'", "''")}'`;

const soundPaths = () => {
  const testsDirectory = dirname(fileURLToPath(import.meta.url));
  const soundDirectory = resolve(testsDirectory, "..");
  return {
    testsDirectory,
    soundDirectory,
    repositoryDirectory: resolve(soundDirectory, ".."),
    launcher: join(soundDirectory, "sclang-launch.psm1"),
  };
};

const runIsolatedSclang = ({ scriptPath, scriptArguments, timeoutMilliseconds }) => {
  const paths = soundPaths();
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Import-Module ${psLiteral(paths.launcher)} -Force`,
    `$result = Invoke-JanVimIsolatedSclang -ScriptPath ${psLiteral(scriptPath)} -ScriptArguments @(${scriptArguments.map(psLiteral).join(",")}) -UdpPort 57140 -TimeoutMilliseconds ${timeoutMilliseconds} -KillTimeoutMilliseconds 2000 -MaxCaptureCharacters 131072 -WorkingDirectory ${psLiteral(paths.testsDirectory)}`,
    "if ($result.StdOut) { Write-Output $result.StdOut.TrimEnd() }",
    "if ($result.StdErr) { [Console]::Error.WriteLine($result.StdErr.TrimEnd()) }",
    "if ($result.TimedOut) { throw 'isolated sclang exceeded its deadline' }",
    "if ($result.KillDeadlineExceeded -or $result.CaptureIncomplete) { throw 'isolated sclang cleanup exceeded its bound' }",
    "if ($result.StdOutTruncated -or $result.StdErrTruncated) { throw 'isolated sclang output exceeded its bound' }",
    "if ($null -eq $result.ExitCode) { throw 'isolated sclang exit code unavailable' }",
    "exit $result.ExitCode",
  ].join("; ");

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("pwsh", ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: paths.repositoryDirectory,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let exceededCapture = false;
    const capture = (current, chunk) => {
      const next = current + chunk;
      if (next.length > 256 * 1024) {
        exceededCapture = true;
        return next.slice(0, 256 * 1024);
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      stdout = capture(stdout, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      stderr = capture(stderr, chunk.toString("utf8"));
    });
    child.once("error", rejectPromise);
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`PowerShell wrapper exceeded ${timeoutMilliseconds + 5000} ms`));
    }, timeoutMilliseconds + 5000);
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      if (exceededCapture) {
        rejectPromise(new Error("PowerShell wrapper output exceeded 256 KiB"));
      } else {
        resolvePromise({ status, signal, stdout, stderr });
      }
    });
  });
};

const parseRecords = (output, prefix) =>
  output
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(`${prefix} `))
    .map((line) => JSON.parse(line.slice(prefix.length + 1)));

const listen = (socket, port) =>
  new Promise((resolvePromise, rejectPromise) => {
    socket.once("error", rejectPromise);
    socket.bind(port, "127.0.0.1", resolvePromise);
  });

const closeSocket = (socket) =>
  new Promise((resolvePromise) => socket.close(resolvePromise));

const syncedReply = (id) => {
  const packet = Buffer.alloc(16);
  packet.write("/synced", 0, "ascii");
  packet.write(",i", 8, "ascii");
  packet.writeInt32BE(id, 12);
  return packet;
};

const requireSignalBounds = (analysis, activeSegmentNames, silentSegmentNames) => {
  for (const name of activeSegmentNames) {
    const segment = analysis.segments.find((candidate) => candidate.name === name);
    assert.ok(segment, `missing active segment ${name}`);
    assert.ok(segment.peak > 0.01, `${name} peak ${segment.peak} must be active`);
    assert.ok(segment.peak <= 0.2001, `${name} peak ${segment.peak} exceeds ceiling`);
  }
  for (const name of silentSegmentNames) {
    const segment = analysis.segments.find((candidate) => candidate.name === name);
    assert.ok(segment, `missing silent segment ${name}`);
    assert.ok(segment.peak <= 1 / 32768, `${name} peak ${segment.peak} is not silent`);
  }
  analysis.channels.forEach((channel, index) => {
    assert.ok(channel.peak > 0, `channel ${index} must contain signal`);
    assert.ok(channel.peak <= 0.2001, `channel ${index} exceeds ceiling`);
    assert.equal(channel.clippedSamples, 0, `channel ${index} contains clipped samples`);
  });
};

test("renders production pluck, wind, stop, and heartbeat-watchdog behavior in NRT", async () => {
  const { testsDirectory, soundDirectory, repositoryDirectory } = soundPaths();
  const rehearsalDirectory = await mkdtemp(join(tmpdir(), "sound-nrt-"));
  const launcher = join(soundDirectory, "sclang-launch.psm1");
  const renderer = join(testsDirectory, "render.scd");
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Import-Module ${psLiteral(launcher)} -Force`,
    `$result = Invoke-JanVimIsolatedSclang -ScriptPath ${psLiteral(renderer)} -ScriptArguments @(${psLiteral(rehearsalDirectory)}) -UdpPort 57140 -TimeoutMilliseconds 30000 -KillTimeoutMilliseconds 2000 -MaxCaptureCharacters 131072 -WorkingDirectory ${psLiteral(testsDirectory)}`,
    "if ($result.StdOut) { Write-Output $result.StdOut.TrimEnd() }",
    "if ($result.StdErr) { [Console]::Error.WriteLine($result.StdErr.TrimEnd()) }",
    "if ($result.TimedOut) { throw 'NRT renderer exceeded 30 seconds' }",
    "if ($result.KillDeadlineExceeded -or $result.CaptureIncomplete) { throw 'NRT renderer cleanup exceeded its bound' }",
    "if ($result.StdOutTruncated -or $result.StdErrTruncated) { throw 'NRT renderer output exceeded its bound' }",
    "if ($null -eq $result.ExitCode) { throw 'NRT renderer exit code unavailable' }",
    "exit $result.ExitCode",
  ].join("; ");
  const render = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", command], {
    cwd: repositoryDirectory,
    encoding: "utf8",
    maxBuffer: 512 * 1024,
    timeout: 35000,
  });

  assert.equal(
    render.status,
    0,
    `NRT render failed\nstdout:\n${render.stdout}\nstderr:\n${render.stderr}`,
  );
  assert.match(render.stdout, /PASS: sound\/tests\/render\.scd/);

  const mainPath = join(rehearsalDirectory, "main-capture.wav");
  const watchdogPath = join(rehearsalDirectory, "watchdog-capture.wav");
  const main = analyzeWav(await readFile(mainPath), [
    { name: "initial", start: 0, end: 0.4 },
    { name: "pluck", start: 0.6, end: 2.2 },
    { name: "wind", start: 3.0, end: 4.8 },
    { name: "stopFade", start: 5.0, end: 6.4 },
    { name: "postFade", start: 6.7, end: 8.7 },
  ]);
  const watchdog = analyzeWav(await readFile(watchdogPath), [
    { name: "active", start: 1.0, end: 2.5 },
    { name: "leaseFade", start: 2.8, end: 4.2 },
    { name: "postLease", start: 4.5, end: 6.5 },
  ]);

  assert.deepEqual(main.format, {
    container: "RIFF",
    encoding: "PCM16LE",
    sampleRate: 48000,
  });
  assert.ok(main.duration >= 9 && main.duration <= 9 + 64 / 48000);
  assert.ok(watchdog.duration >= 6.9 && watchdog.duration <= 6.9 + 64 / 48000);
  requireSignalBounds(main, ["pluck", "wind", "stopFade"], ["initial", "postFade"]);
  requireSignalBounds(watchdog, ["active", "leaseFade"], ["postLease"]);

  const evidence = {
    rehearsalDirectory,
    mainPath,
    watchdogPath,
    main: {
      duration: main.duration,
      channels: main.channels,
      segments: main.segments.map(({ name, peak, rms }) => ({ name, peak, rms })),
    },
    watchdog: {
      duration: watchdog.duration,
      channels: watchdog.channels,
      segments: watchdog.segments.map(({ name, peak, rms }) => ({ name, peak, rms })),
    },
  };
  console.log(`NRT_EVIDENCE ${JSON.stringify(evidence)}`);
});

test("refuses a responding occupant on the private server port without displacing it", async () => {
  const responder = dgram.createSocket("udp4");
  let syncRequests = 0;
  responder.on("message", (message, remote) => {
    if (message.toString("ascii", 0, 5) === "/sync" && message.length >= 16) {
      syncRequests += 1;
      responder.send(syncedReply(message.readInt32BE(12)), remote.port, remote.address);
    }
  });
  await listen(responder, 57141);

  try {
    const { soundDirectory } = soundPaths();
    const result = await runIsolatedSclang({
      scriptPath: join(soundDirectory, "service.scd"),
      scriptArguments: ["0123456789abcdef0123456789abcdef", "silent", "1", ""],
      timeoutMilliseconds: 10000,
    });

    assert.notEqual(result.status, 0);
    assert.ok(syncRequests >= 1, "service did not probe the occupied server port");
    assert.equal(parseRecords(result.stdout, "SOUND_READY").length, 0);
    assert.deepEqual(parseRecords(result.stdout, "SOUND_COMPLETE"), [
      { reason: "serverPortOccupied", clean: true },
    ]);
    assert.equal(responder.address().port, 57141);
  } finally {
    await closeSocket(responder);
  }
});

test("rejects invalid CLI arguments before probing the private server port", async () => {
  const responder = dgram.createSocket("udp4");
  let packets = 0;
  responder.on("message", () => {
    packets += 1;
  });
  await listen(responder, 57141);

  try {
    const { soundDirectory } = soundPaths();
    const result = await runIsolatedSclang({
      scriptPath: join(soundDirectory, "service.scd"),
      scriptArguments: ["0123456789abcdef0123456789abcdef", "invalid", "1", ""],
      timeoutMilliseconds: 5000,
    });

    assert.equal(result.status, 2);
    assert.deepEqual(parseRecords(result.stdout, "SOUND_COMPLETE"), [
      { reason: "invalidArguments", clean: true },
    ]);
    assert.equal(parseRecords(result.stdout, "SOUND_READY").length, 0);
    assert.equal(packets, 0);

    const captureTooLong = await runIsolatedSclang({
      scriptPath: join(soundDirectory, "service.scd"),
      scriptArguments: [
        "0123456789abcdef0123456789abcdef",
        "silent",
        "119",
        "unused.wav",
      ],
      timeoutMilliseconds: 5000,
    });
    assert.equal(captureTooLong.status, 2);
    assert.deepEqual(parseRecords(captureTooLong.stdout, "SOUND_COMPLETE"), [
      { reason: "invalidCapture", clean: true },
    ]);
    assert.equal(parseRecords(captureTooLong.stdout, "SOUND_READY").length, 0);
    assert.equal(packets, 0);
  } finally {
    await closeSocket(responder);
  }
});

test("boots and cleans up one captured silent service without an audible output", async () => {
  const { soundDirectory } = soundPaths();
  const rehearsalDirectory = await mkdtemp(join(tmpdir(), "sound-service-"));
  const capturePath = join(rehearsalDirectory, "silent-capture.wav");
  const session = "fedcba9876543210fedcba9876543210";
  const result = await runIsolatedSclang({
    scriptPath: join(soundDirectory, "service.scd"),
    scriptArguments: [session, "silent", "1", capturePath],
    timeoutMilliseconds: 15000,
  });

  assert.equal(
    result.status,
    0,
    `silent service failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const ready = parseRecords(result.stdout, "SOUND_READY");
  const stats = parseRecords(result.stdout, "SOUND_STATS");
  const complete = parseRecords(result.stdout, "SOUND_COMPLETE");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].languagePort, 57140);
  assert.equal(ready[0].serverPort, 57141);
  assert.equal(ready[0].hardwareOutput, false);
  assert.equal(ready[0].session, session);
  assert.ok(Number.isFinite(ready[0].clock));
  assert.ok(Number.isInteger(ready[0].serverPid) && ready[0].serverPid > 0);
  assert.ok(stats.length >= 1);
  assert.deepEqual(complete, [{ reason: "duration", clean: true }]);

  const capture = analyzeWav(await readFile(capturePath), [
    { name: "silent", start: 0, end: 0.5 },
  ]);
  assert.equal(capture.format.sampleRate, 48000);
  assert.ok(capture.duration >= 1);
  assert.equal(capture.segments[0].peak, 0);
  assert.equal(capture.segments[0].rms, 0);
  assert.equal(capture.channels[0].clippedSamples, 0);
  assert.equal(capture.channels[1].clippedSamples, 0);
  console.log(
    `SERVICE_EVIDENCE ${JSON.stringify({ rehearsalDirectory, capturePath, ready: ready[0], complete: complete[0], capture })}`,
  );
});
