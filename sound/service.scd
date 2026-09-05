(
var argv, session, mode, durationText, duration, capturePath, hardwareOutput, argumentError;
var flockIngress = false;
var finiteFloat, validSession, validDurationText, jsonString, emit;
var emitReady, emitEvent, emitStats, emitComplete, completeEmitted = false, readyEmitted = false;
var soundRoot, policyFactory, policy, synthFactory, definitions;
var options, server, serverPort = 57141, launchedPid, preflightId, preflightResponder;
var endpointHelperPath, endpointOwned = false, endpointCheckPid;
var endpointCheckGeneration = 0, endpointCheckTimeout;
var phase = \validating, bootRoutine, startupTimeout, startupMonitor;
var cleanupRoutine, cleanupTimeout, captureWriteDoneResponder, captureWriteFailureResponder;
var checker, statsTask, durationTask, serverFailureResponder, oscKeys = Array.new;
var voiceBus, finalBus, mixer, outputSynth, captureBuffer, captureSynth, windSynth;
var windNodes = Array.new;
var captureFrames, pluckNodes = Array.new, livePlucks = 0, maxPlucks = 0, heartbeatControl = 0;
var capturePositionResponder, recordedFrames = 0, stopFrame = 0;
var pidIsRunning, cancelEndpointCheck, inspectEndpoint, stopTasks, removeResponders;
var ownsServerProcess, ownsServer, finishWithoutServer, terminateOwnedProcess, finishService;
var abortStartup, beginStop, installOsc, processAction, setupApplication;
var beginBootWait, verifyStartupEndpoint, startSafeBoot;

finiteFloat = { |value|
    value.isFloat and: {
        value.isNaN.not and: { value != inf and: { value != -inf } }
    }
};

jsonString = { |value|
    var escaped = "";
    value.asString.do { |character|
        escaped = escaped ++ switch(character.ascii,
            34, { "\\\"" },
            92, { "\\\\" },
            10, { "\\n" },
            13, { "\\r" },
            9, { "\\t" },
            {
                if(character.ascii < 32) {
                    Error("JSON strings cannot contain control characters").throw
                } {
                    character.asString
                }
            }
        );
    };
    "\"" ++ escaped ++ "\""
};

emit = { |prefix, body| (prefix ++ " " ++ body).postln };
emitReady = {
    readyEmitted = true;
    emit.value("SOUND_READY", "{" ++
        "\"clock\":" ++ Main.elapsedTime.asString ++ "," ++
        "\"languagePort\":" ++ NetAddr.langPort.asString ++ "," ++
        "\"serverPort\":" ++ serverPort.asString ++ "," ++
        "\"hardwareOutput\":" ++ if(hardwareOutput) { "true" } { "false" } ++ "," ++
        "\"session\":" ++ jsonString.value(session) ++ "," ++
        "\"serverPid\":" ++ launchedPid.asString ++ "}"
    );
};
emitEvent = { |type, reason|
    var body = "{\"type\":" ++ jsonString.value(type);
    if(reason.notNil) { body = body ++ ",\"reason\":" ++ jsonString.value(reason) };
    emit.value("SOUND_EVENT", body ++ "}");
};
emitStats = {
    var snapshot = policy.at(\snapshot).value;
    emit.value("SOUND_STATS", "{" ++
        "\"state\":" ++ jsonString.value(snapshot.at(\state)) ++ "," ++
        "\"acceptedPlucks\":" ++ snapshot.at(\acceptedPlucks).asString ++ "," ++
        "\"acceptedFlocks\":" ++ snapshot.at(\acceptedFlocks).asString ++ "," ++
        "\"rejected\":" ++ snapshot.at(\rejected).asString ++ "," ++
        "\"rateDropped\":" ++ snapshot.at(\rateDropped).asString ++ "," ++
        "\"livePlucks\":" ++ livePlucks.asString ++ "," ++
        "\"maxPlucks\":" ++ maxPlucks.asString ++ "}"
    );
};
emitComplete = { |reason, clean|
    if(completeEmitted.not) {
        completeEmitted = true;
        emit.value("SOUND_COMPLETE", "{" ++
            "\"reason\":" ++ jsonString.value(reason) ++ "," ++
            "\"clean\":" ++ if(clean) { "true" } { "false" } ++ "}"
        );
    };
};

argv = thisProcess.argv;
argumentError = nil;
if((argv.size != 4) and: { argv.size != 5 }) {
    argumentError = "invalidArguments";
} {
    session = argv.at(0);
    mode = argv.at(1);
    durationText = argv.at(2);
    capturePath = argv.at(3);
    if(argv.size == 5) {
        flockIngress = ["flock-v1"].includesEqual(argv.at(4));
        if(flockIngress.not) { argumentError = "invalidArguments" };
    };
    validSession = session.isString and: {
        session.size == 32 and: {
            session.every { |character| "0123456789abcdef".includes(character) }
        }
    };
    validDurationText = durationText.isString and: {
        durationText.notEmpty and: {
            durationText.count { |character| character == $. } <= 1 and: {
                durationText.every { |character| "0123456789.".includes(character) }
            }
        }
    };
    duration = if(validDurationText) { durationText.asFloat } { 0.0 };

    if(validSession.not or: { ["silent", "listen"].includesEqual(mode).not }) {
        argumentError = "invalidArguments";
    };
    if(argumentError.isNil and: {
        finiteFloat.value(duration).not or: { duration < 1 or: { duration > 3600 } }
    }) {
        argumentError = "invalidDuration";
    };
    if(argumentError.isNil and: {
        capturePath.isString.not or: { capturePath.notEmpty and: { duration > (120 - 1.5) } }
    }) {
        argumentError = "invalidCapture";
    };
};

if(argumentError.notNil) {
    emitComplete.value(argumentError, true);
    2.exit;
} {
hardwareOutput = ["listen"].includesEqual(mode);

soundRoot = thisProcess.nowExecutingPath.dirname;
endpointHelperPath = soundRoot +/+ "server-port-owner.ps1";
policyFactory = (soundRoot +/+ "policy.scd").load;
synthFactory = (soundRoot +/+ "synths.scd").load;
if(
    policyFactory.isKindOf(Function).not or: {
        synthFactory.isKindOf(Function).not or: { File.exists(endpointHelperPath).not }
    }
) {
    emitComplete.value("loadFailure", false);
    2.exit;
} {
policy = policyFactory.value(session, nil, flockIngress);
definitions = synthFactory.value;

options = ServerOptions.new
    .numInputBusChannels_(0)
    .numOutputBusChannels_(2)
    .numAudioBusChannels_(128)
    .maxNodes_(1024)
    .sampleRate_(48000)
    .loadDefs_(false)
    .device_("Windows WASAPI : Headphones (Senary Audio)")
    .verbosity_(-1)
    .zeroConf_(false);
server = Server(\janvimSoundService, NetAddr("127.0.0.1", serverPort), options);

pidIsRunning = { |pid|
    var result;
    if(pid.isNil) {
        false
    } {
        result = pid.pidRunning;
        result.notNil and: { result != false }
    }
};

ownsServerProcess = {
    launchedPid.notNil and: {
        server.pid == launchedPid and: { pidIsRunning.value(launchedPid) }
    }
};

cancelEndpointCheck = {
    endpointCheckGeneration = endpointCheckGeneration + 1;
    endpointCheckTimeout !? { endpointCheckTimeout.stop; endpointCheckTimeout = nil };
    if(pidIsRunning.value(endpointCheckPid)) {
        thisProcess.platform.killProcessByID(endpointCheckPid);
    };
    endpointCheckPid = nil;
};

inspectEndpoint = { |action|
    var generation;
    cancelEndpointCheck.value;
    generation = endpointCheckGeneration;
    if(ownsServerProcess.value.not) {
        action.value(2);
    } {
        endpointCheckPid = [
            "pwsh.exe", "-NoProfile", "-NonInteractive", "-File", endpointHelperPath,
            "-Port", serverPort.asString, "-ExpectedPid", launchedPid.asString
        ].unixCmd({ |exitCode|
            {
                if(generation == endpointCheckGeneration) {
                    endpointCheckTimeout !? {
                        endpointCheckTimeout.stop;
                        endpointCheckTimeout = nil;
                    };
                    endpointCheckPid = nil;
                    action.value(exitCode);
                };
            }.defer;
        }, false);
        endpointCheckTimeout = Routine {
            1.5.wait;
            if(generation == endpointCheckGeneration) {
                endpointCheckGeneration = endpointCheckGeneration + 1;
                if(pidIsRunning.value(endpointCheckPid)) {
                    thisProcess.platform.killProcessByID(endpointCheckPid);
                };
                endpointCheckPid = nil;
                endpointCheckTimeout = nil;
                action.value(4);
            };
        }.play(AppClock);
    };
};

stopTasks = {
    [checker, statsTask, durationTask, startupTimeout, startupMonitor, bootRoutine,
        cleanupRoutine, cleanupTimeout].do { |task|
        if(task.notNil and: { task !== thisThread }) { task.stop };
    };
    cancelEndpointCheck.value;
};

removeResponders = {
    oscKeys.do { |key| OSCdef(key).free };
    oscKeys = Array.new;
    serverFailureResponder !? { serverFailureResponder.free; serverFailureResponder = nil };
    captureWriteDoneResponder !? {
        captureWriteDoneResponder.free;
        captureWriteDoneResponder = nil;
    };
    captureWriteFailureResponder !? {
        captureWriteFailureResponder.free;
        captureWriteFailureResponder = nil;
    };
    preflightResponder !? { preflightResponder.free; preflightResponder = nil };
};

ownsServer = { endpointOwned and: { ownsServerProcess.value } };

finishWithoutServer = { |reason, clean, exitCode|
    if(phase != \complete) {
        phase = \complete;
        stopTasks.value;
        removeResponders.value;
        capturePositionResponder !? { capturePositionResponder.free; capturePositionResponder = nil };
        if(server.statusWatcher.aliveThread.notNil) { server.stopAliveThread };
        server.remove;
        if(readyEmitted) { emitStats.value };
        emitComplete.value(reason, clean);
        AppClock.sched(0.05, { exitCode.exit; nil });
    };
};

terminateOwnedProcess = { |reason, clean, exitCode|
    cleanupRoutine = Routine {
        var ended;
        endpointOwned = false;
        if(pidIsRunning.value(launchedPid)) {
            thisProcess.platform.killProcessByID(launchedPid);
        };
        20.do {
            if(pidIsRunning.value(launchedPid)) { 0.05.wait };
        };
        ended = pidIsRunning.value(launchedPid).not;
        finishWithoutServer.value(reason, clean and: { ended }, exitCode);
    }.play(AppClock);
};

finishService = { |reason, initiallyClean|
    cleanupTimeout = Routine {
        5.wait;
        if(phase == \stopping) {
            cleanupRoutine !? { cleanupRoutine.stop };
            terminateOwnedProcess.value(reason, false, 1);
        };
    }.play(AppClock);

    inspectEndpoint.value({ |ownershipStatus|
        if(phase == \stopping) {
            if(ownershipStatus == 0 and: { ownsServerProcess.value }) {
                endpointOwned = true;
                cleanupRoutine = Routine {
                    var captureWriteResult = \notRequested;
                    if(captureBuffer.notNil) {
                        emit.value("SOUND_CAPTURE", "{" ++
                            "\"allocatedFrames\":" ++ captureFrames.asString ++ "," ++
                            "\"recordedFrames\":" ++ recordedFrames.asString ++ "," ++
                            "\"stopFrame\":" ++ stopFrame.asString ++ "," ++
                            "\"voicesFreedAfterFrame\":" ++ recordedFrames.asString ++ "}"
                        );
                    };
                    captureSynth !? { captureSynth.free };
                    outputSynth !? { outputSynth.free };
                    pluckNodes.do { |node| node.free };
                    windNodes.do { |node| node.free };
                    windNodes = Array.new;
                    windSynth = nil;
                    voiceBus !? { voiceBus.free };
                    finalBus !? { finalBus.free };
                    captureBuffer !? {
                        captureWriteResult = \pending;
                        captureWriteDoneResponder = OSCFunc({
                            if(captureWriteResult == \pending) {
                                captureWriteResult = \done;
                            };
                        }, "/done", server.addr,
                            argTemplate: ["/b_write", captureBuffer.bufnum]).oneShot;
                        captureWriteFailureResponder = OSCFunc({
                            captureWriteResult = \failed;
                        }, "/fail", server.addr, argTemplate: ["/b_write"]).oneShot;
                        captureBuffer.write(
                            capturePath, "wav", "int16", captureFrames, 0, false,
                            [\b_free, captureBuffer.bufnum]
                        );
                    };
                    server.sync;
                    captureWriteDoneResponder !? {
                        captureWriteDoneResponder.free;
                        captureWriteDoneResponder = nil;
                    };
                    captureWriteFailureResponder !? {
                        captureWriteFailureResponder.free;
                        captureWriteFailureResponder = nil;
                    };

                    if(phase == \stopping) {
                        inspectEndpoint.value({ |quitOwnershipStatus|
                            if(phase == \stopping) {
                                if(quitOwnershipStatus == 0 and: { ownsServerProcess.value }) {
                                    var attempts = 0, clean = initiallyClean and: {
                                        captureWriteResult == \notRequested or: {
                                            captureWriteResult == \done
                                        }
                                    };
                                    endpointOwned = true;
                                    server.addr.sendMsg("/quit");
                                    cleanupRoutine = Routine {
                                        while {
                                            pidIsRunning.value(launchedPid) and: { attempts < 60 }
                                        } {
                                            0.05.wait;
                                            attempts = attempts + 1;
                                        };
                                        if(pidIsRunning.value(launchedPid)) {
                                            thisProcess.platform.killProcessByID(launchedPid);
                                            20.do {
                                                if(pidIsRunning.value(launchedPid)) { 0.05.wait };
                                            };
                                        };
                                        clean = clean and: {
                                            pidIsRunning.value(launchedPid).not
                                        };
                                        finishWithoutServer.value(
                                            reason, clean, if(clean) { 0 } { 1 }
                                        );
                                    }.play(AppClock);
                                } {
                                    terminateOwnedProcess.value(reason, false, 1);
                                };
                            };
                        });
                    };
                }.play(AppClock);
            } {
                terminateOwnedProcess.value(reason, false, 1);
            };
        };
    });
};

abortStartup = { |reason|
    if(phase == \starting) {
        phase = \stopping;
        stopTasks.value;
        removeResponders.value;
        endpointOwned = false;
        if(server.statusWatcher.aliveThread.notNil) { server.stopAliveThread };
        terminateOwnedProcess.value(reason, reason == "serverPortOccupied", 1);
    };
};

beginStop = { |reason, clean = true|
    if(phase == \ready) {
        phase = \stopping;
        emitEvent.value("stop", reason);
        emitStats.value;
        stopTasks.value;
        removeResponders.value;
        captureSynth !? { captureSynth.set(\mark, 1) };
        mixer !? { mixer.set(\stop, 1) };
        // Keep sources and recorder alive through the measured post-fade window.
        AppClock.sched(1.85, {
            finishService.value(reason, clean);
            nil
        });
    };
};

processAction = { |action|
    if(action.notNil) {
        switch(action.at(\type),
            \start, {
                heartbeatControl = heartbeatControl + 1;
                mixer.set(\heartbeat, heartbeatControl, \armed, 1);
                emitEvent.value("start", nil);
            },
            \pluck, {
                if(livePlucks < 8) {
                    var node = Synth.before(mixer, \jvPluck, [
                        \outBus, voiceBus.index,
                        \midi, action.at(\midi),
                        \motion, action.at(\motion),
                        \pan, action.at(\pan)
                    ]);
                    livePlucks = livePlucks + 1;
                    maxPlucks = maxPlucks.max(livePlucks);
                    pluckNodes = pluckNodes.add(node);
                    node.onFree {
                        {
                            livePlucks = (livePlucks - 1).max(0);
                            pluckNodes = pluckNodes.reject { |candidate| candidate === node };
                        }.defer;
                    };
                };
            },
            \wind, {
                if(windSynth.isNil) {
                    // Releasing winds still own a seat. A full pair drops this
                    // trigger; only a later fresh action may allocate again.
                    if(windNodes.size < 2) {
                        var node = Synth.before(mixer, \jvWind, [
                            \outBus, voiceBus.index,
                            \energy, action.at(\energy),
                            \pan, action.at(\pan)
                        ]);
                        windSynth = node;
                        windNodes = windNodes.add(node);
                        node.onFree {
                            {
                                windNodes = windNodes.reject { |candidate| candidate === node };
                                if(windSynth === node) { windSynth = nil };
                            }.defer;
                        };
                    };
                } {
                    windSynth.set(\energy, action.at(\energy), \pan, action.at(\pan));
                };
            },
            \windMute, {
                // The existing SynthDef gate has a 0.3s release. Keep the node
                // owned until onFree, but allow a fresh live to use a new seat.
                windSynth !? { windSynth.set(\gate, 0); windSynth = nil };
            },
            \stop, { beginStop.value(action.at(\reason).asString, true) }
        );
    };
};

installOsc = {
    var paths = [
        "/janvim/sound/v1/start",
        "/janvim/sound/v1/heartbeat",
        "/janvim/sound/v1/cursor",
        "/janvim/sound/v1/flock",
        "/janvim/sound/v1/stop"
    ];
    if(flockIngress) {
        paths = paths ++ ["/janvim/sound/v1/flock-live", "/janvim/sound/v1/flock-mute"];
    };

    paths.do { |path, index|
        var key = ("jvSoundService" ++ index).asSymbol;
        oscKeys = oscKeys.add(key);
        OSCdef(key, { |msg, bundleTime, address, receivePort|
            var decoded, before, after, action, now;
            if(
                phase == \ready and: {
                    address.ip == "127.0.0.1" and: { receivePort == 57140 }
                }
            ) {
                now = Main.elapsedTime;
                decoded = msg.copy;
                decoded.put(0, msg.at(0).asString);
                if(msg.at(1).isKindOf(Symbol)) { decoded.put(1, msg.at(1).asString) };
                before = policy.at(\snapshot).value;
                action = policy.at(\handle).value(decoded, now);
                after = policy.at(\snapshot).value;
                // Accepted heartbeats and rejected packets both return nil; only the
                // accepted heartbeat advances lastSeq while the policy stays running.
                if(
                    path == "/janvim/sound/v1/heartbeat" and: {
                        after.at(\lastSeq) > before.at(\lastSeq) and: {
                            after.at(\state) == \running
                        }
                    }
                ) {
                    heartbeatControl = heartbeatControl + 1;
                    mixer.set(\heartbeat, heartbeatControl);
                };
                processAction.value(action);
            };
        }, path.asSymbol, recvPort: 57140);
    };
};

setupApplication = {
    if(phase != \starting or: { ownsServer.value.not }) {
        abortStartup.value("ownershipLost");
    } {
        try {
            server.bootInit(false);
            if(phase == \starting and: { ownsServer.value }) {
                serverFailureResponder = OSCFunc({ |msg|
                    if(phase == \starting) {
                        abortStartup.value("serverFailure")
                    } {
                        beginStop.value("serverFailure", false)
                    };
                }, "/fail", server.addr);
                definitions.do { |definition| definition.send(server) };
                server.sync;

                if(phase == \starting and: { ownsServer.value }) {
                    voiceBus = Bus.audio(server, 2);
                    finalBus = Bus.audio(server, 2);
                    mixer = Synth.head(server, \jvMix, [
                        \inBus, voiceBus.index,
                        \outBus, finalBus.index,
                        \heartbeat, 0,
                        \armed, 0,
                        \stop, 0
                    ]);

                    if(capturePath.notEmpty) {
                        captureFrames = ((duration + 1.5).min(120) * 48000).asInteger;
                        captureBuffer = Buffer.alloc(server, captureFrames, 2);
                        server.sync;
                        if(phase == \starting and: { ownsServer.value }) {
                            captureSynth = Synth.after(mixer, \jvCapture, [
                                \inBus, finalBus.index,
                                \bufnum, captureBuffer.bufnum
                            ]);
                            capturePositionResponder = OSCFunc({ |msg|
                                recordedFrames = msg.at(3).asInteger.clip(0, captureFrames);
                                if(msg.at(4) == 1 and: { stopFrame == 0 }) {
                                    stopFrame = recordedFrames;
                                };
                            }, "/jv/capture-position", server.addr, argTemplate: [captureSynth.nodeID]);
                            captureSynth.onFree { { captureSynth = nil }.defer };
                        } {
                            abortStartup.value("ownershipLost");
                        };
                    };

                    if(phase == \starting and: { ownsServer.value }) {
                        if(hardwareOutput) {
                            outputSynth = Synth.after(captureSynth ? mixer, \jvOutput, [
                                \inBus, finalBus.index,
                                \hardware, 1
                            ]);
                        };

                        installOsc.value;
                        phase = \ready;
                        startupTimeout.stop;
                        startupMonitor.stop;
                        emitReady.value;
                        emitStats.value;

                        checker = Routine {
                            loop {
                                0.05.wait;
                                if(phase == \ready) {
                                    if(ownsServer.value.not or: { server.unresponsive }) {
                                        beginStop.value("serverExit", false);
                                    } {
                                        processAction.value(
                                            policy.at(\tick).value(Main.elapsedTime)
                                        );
                                    };
                                };
                            };
                        }.play(AppClock);
                        statsTask = Routine {
                            loop {
                                5.0.wait;
                                if(phase == \ready) { emitStats.value };
                            };
                        }.play(AppClock);
                        durationTask = Routine {
                            duration.wait;
                            beginStop.value("duration", true);
                        }.play(AppClock);
                    };
                } {
                    abortStartup.value("ownershipLost");
                };
            } {
                abortStartup.value("ownershipLost");
            };
        } { |error|
            if(phase == \starting) { abortStartup.value("setupFailure") };
        };
    };
};

beginBootWait = {
    if(phase == \starting and: { ownsServer.value }) {
        server.statusWatcher.serverBooting = true;
        bootRoutine = server.statusWatcher.doWhenBooted({
            server.statusWatcher.serverBooting = false;
            if(phase == \starting and: { ownsServer.value }) {
                setupApplication.value;
            };
        }, 100, { abortStartup.value("bootFailure"); false }, AppClock);
        server.startAliveThread;
    } {
        abortStartup.value("ownershipLost");
    };
};

verifyStartupEndpoint = {
    inspectEndpoint.value({ |ownershipStatus|
        if(phase == \starting) {
            switch(ownershipStatus,
                0, {
                    endpointOwned = true;
                    beginBootWait.value;
                },
                2, {
                    if(ownsServerProcess.value) {
                        AppClock.sched(0.05, {
                            if(phase == \starting) { verifyStartupEndpoint.value };
                            nil
                        });
                    } {
                        abortStartup.value("serverExit");
                    };
                },
                3, { abortStartup.value("serverPortOccupied") },
                { abortStartup.value("ownershipCheckFailed") }
            );
        };
    });
};

startSafeBoot = {
    phase = \starting;
    server.bootServerApp({ });
    launchedPid = server.pid;
    if(launchedPid.isNil) {
        abortStartup.value("bootFailure");
    } {
        startupTimeout = Routine {
            30.wait;
            abortStartup.value("startupTimeout");
        }.play(AppClock);
        startupMonitor = Routine {
            while { phase == \starting } {
                if(pidIsRunning.value(launchedPid).not) {
                    abortStartup.value("serverExit");
                };
                0.05.wait;
            };
        }.play(AppClock);
        verifyStartupEndpoint.value;
    };
};

preflightId = ((thisProcess.pid % 1000000) + 1000000).asInteger;
preflightResponder = OSCFunc({ |msg|
    if(msg.at(1) == preflightId and: { phase == \validating }) {
        phase = \complete;
        preflightResponder.free;
        preflightResponder = nil;
        server.remove;
        emitComplete.value("serverPortOccupied", true);
        AppClock.sched(0.05, { 1.exit; nil });
    };
}, "/synced", server.addr);
server.addr.sendMsg("/sync", preflightId);
AppClock.sched(0.30, {
    if(phase == \validating) {
        preflightResponder.free;
        preflightResponder = nil;
        startSafeBoot.value;
    };
    nil
});
};
};
)
