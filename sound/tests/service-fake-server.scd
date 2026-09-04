(
var testsDirectory = thisProcess.nowExecutingPath.dirname;
var fakeServerPath = testsDirectory +/+ "fake-scsynth.mjs";

Server.program = "node.exe %".format(fakeServerPath.quote);
Routine {
    var fakeServer;
    while { fakeServer.isNil } {
        fakeServer = Server.named.at(\janvimSoundService);
        0.01.wait;
    };
    // The fake server has no shared-memory segment. This fixture-only change
    // keeps the service on its real UDP boot/setup path.
    fakeServer.slotPut(\isLocal, false);
}.play(AppClock);
(testsDirectory +/+ "../service.scd").load;
)
