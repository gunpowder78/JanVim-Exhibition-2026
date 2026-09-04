(
var argv, session, mode, durationText, duration, capturePath, hardwareOutput, argumentError;
var finiteFloat, validSession, validDurationText, jsonString, emit;
var emitReady, emitEvent, emitStats, emitComplete, completeEmitted = false;
var soundRoot, policyFactory, policy, synthFactory, definitions;
var options, server, serverPort = 57141, launchedPid, preflightId, preflightResponder;
var phase = \validating, bootRoutine, startupTimeout, startupMonitor;
var checker, statsTask, durationTask, serverFailureResponder, oscKeys = Array.new;
var voiceBus, finalBus, mixer, outputSynth, captureBuffer, captureSynth, windSynth;
var pluckNodes = Array.new, livePlucks = 0, maxPlucks = 0, heartbeatControl = 0;
var stopTasks, removeResponders, ownsServer, finishWithoutServer, finishService;
var abortStartup, beginStop, installOsc, processAction, setupApplication, startSafeBoot;

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
if(argv.size != 4) {
    argumentError = "invalidArguments";
} {
    session = argv.at(0);
    mode = argv.at(1);
    durationText = argv.at(2);
    capturePath = argv.at(3);
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
policyFactory = (soundRoot +/+ "policy.scd").load;
synthFactory = (soundRoot +/+ "synths.scd").load;
if(policyFactory.isKindOf(Function).not or: { synthFactory.isKindOf(Function).not }) {
    emitComplete.value("loadFailure", false);
    2.exit;
} {
policy = policyFactory.value(session);
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

stopTasks = {
    [checker, statsTask, durationTask, startupTimeout, startupMonitor, bootRoutine].do { |task|
        if(task.notNil and: { task !== thisThread }) { task.stop };
    };
};

removeResponders = {
    oscKeys.do { |key| OSCdef(key).free };
    oscKeys = Array.new;
    serverFailureResponder !? { serverFailureResponder.free; serverFailureResponder = nil };
    preflightResponder !? { preflightResponder.free; preflightResponder = nil };
};

ownsServer = {
    launchedPid.notNil and: {
        server.pid == launchedPid and: { launchedPid.pidRunning }
    }
};

finishWithoutServer = { |reason, clean, exitCode|
    if(phase != \complete) {
        phase = \complete;
        stopTasks.value;
        removeResponders.value;
        server.remove;
        emitComplete.value(reason, clean);
        AppClock.sched(0.05, { exitCode.exit; nil });
    };
};

finishService = { |reason, initiallyClean|
    Routine {
        var clean = initiallyClean, attempts = 0;

        captureSynth !? { captureSynth.free };
        outputSynth !? { outputSynth.free };
        pluckNodes.do { |node| node.free };
        windSynth !? { windSynth.free };
        captureBuffer !? {
            captureBuffer.close({ |buffer| buffer.freeMsg });
        };
        voiceBus !? { voiceBus.free };
        finalBus !? { finalBus.free };
        0.25.wait;

        if(ownsServer.value) {
            server.addr.sendMsg("/quit");
            while { launchedPid.pidRunning and: { attempts < 60 } } {
                0.05.wait;
                attempts = attempts + 1;
            };
            if(launchedPid.pidRunning) {
                thisProcess.platform.killProcessByID(launchedPid);
                20.do {
                    if(launchedPid.pidRunning) { 0.05.wait };
                };
            };
            clean = clean and: { launchedPid.pidRunning.not };
        } {
            clean = clean and: { launchedPid.notNil and: { launchedPid.pidRunning.not } };
        };

        server.stopAliveThread;
        server.remove;
        phase = \complete;
        emitComplete.value(reason, clean);
        0.05.wait;
        if(clean) { 0.exit } { 1.exit };
    }.play(AppClock);
};

abortStartup = { |reason|
    if(phase == \starting) {
        phase = \stopping;
        stopTasks.value;
        removeResponders.value;
        if(ownsServer.value) {
            server.addr.sendMsg("/quit");
            AppClock.sched(1.0, {
                if(launchedPid.pidRunning) {
                    thisProcess.platform.killProcessByID(launchedPid);
                };
                finishWithoutServer.value(reason, false, 1);
                nil
            });
        } {
            finishWithoutServer.value(reason, false, 1);
        };
    };
};

beginStop = { |reason, clean = true|
    if(phase == \ready) {
        phase = \stopping;
        emitEvent.value("stop", reason);
        stopTasks.value;
        removeResponders.value;
        mixer !? { mixer.set(\stop, 1) };
        AppClock.sched(1.5, {
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
                    windSynth = Synth.before(mixer, \jvWind, [
                        \outBus, voiceBus.index,
                        \energy, action.at(\energy),
                        \pan, action.at(\pan)
                    ]);
                } {
                    windSynth.set(\energy, action.at(\energy), \pan, action.at(\pan));
                };
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
    if(ownsServer.value.not) {
        abortStartup.value("ownershipLost");
    } {
        server.bootInit(false);
        serverFailureResponder = OSCFunc({ |msg|
            if(phase == \starting) {
                abortStartup.value("serverFailure")
            } {
                beginStop.value("serverFailure", false)
            };
        }, "/fail", server.addr);
        definitions.do { |definition| definition.send(server) };
        server.sync;
        if(phase == \starting) {
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
                captureBuffer = Buffer.alloc(server, 65536, 2);
                server.sync;
                captureBuffer.write(capturePath, "wav", "int16", 0, 0, true);
                server.sync;
                captureSynth = Synth.after(mixer, \jvCapture, [
                    \inBus, finalBus.index,
                    \bufnum, captureBuffer.bufnum
                ]);
            };

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
                        if(
                            server.pid != launchedPid or: {
                                launchedPid.pidRunning.not or: { server.unresponsive }
                            }
                        ) {
                            beginStop.value("serverExit", false);
                        } {
                            processAction.value(policy.at(\tick).value(Main.elapsedTime));
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
    };
};

startSafeBoot = {
    phase = \starting;
    server.statusWatcher.serverBooting = true;
    bootRoutine = server.doWhenBooted({
        server.statusWatcher.serverBooting = false;
        setupApplication.value;
    }, 100, { abortStartup.value("bootFailure"); false }, AppClock);
    server.bootServerApp({ server.startAliveThread });
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
                if(launchedPid.pidRunning.not) {
                    abortStartup.value("serverExit");
                };
                0.05.wait;
            };
        }.play(AppClock);
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
