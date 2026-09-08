import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const helper = join(process.cwd(), "sound/server-port-owner.ps1");
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

describe("Windows sound endpoint ownership", () => {
  it.each([
    { state: "not-bound-yet", expected: 2 },
    { state: "owned", expected: 0 },
    { state: "foreign", expected: 3 },
  ])("returns $expected for a real loopback endpoint that is $state", ({ state, expected }) => {
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference='Stop'
      $udp=[Net.Sockets.UdpClient]::new([Net.IPEndPoint]::new([Net.IPAddress]::Loopback,0))
      $port=([Net.IPEndPoint]$udp.Client.LocalEndPoint).Port
      if (${quote(state)} -eq 'not-bound-yet') { $udp.Dispose() }
      try {
        $expectedProcess = ${state === "foreign" ? "2147483646" : "$PID"}
        & (Get-Process -Id $PID).Path -NoProfile -NonInteractive -File ${quote(helper)} -Port $port -ExpectedPid $expectedProcess
        $status=$LASTEXITCODE
      } finally { $udp.Dispose() }
      exit $status
    `], { encoding: "utf8", timeout: 12_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(expected);
  }, 15_000);

  it("continues rejecting provider/permission errors instead of treating them as pending startup", () => {
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      function Get-NetUDPEndpoint { throw [UnauthorizedAccessException]::new('endpoint query denied') }
      & ([scriptblock]::Create(${quote(readFileSync(helper, "utf8"))})) -Port 57141 -ExpectedPid $PID
      exit $LASTEXITCODE
    `], { encoding: "utf8", timeout: 5_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(4);
  });

  it("does not downgrade an unrelated ObjectNotFound query error", () => {
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      function Get-NetUDPEndpoint { Write-Error 'provider missing' -Category ObjectNotFound -ErrorId UnrelatedMissingProvider -ErrorAction Stop }
      & ([scriptblock]::Create(${quote(readFileSync(helper, "utf8"))})) -Port 57141 -ExpectedPid $PID
      exit $LASTEXITCODE
    `], { encoding: "utf8", timeout: 5_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(4);
  });
});
