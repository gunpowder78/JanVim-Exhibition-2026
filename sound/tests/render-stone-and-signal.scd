(
var assert, outputDirectory, outputPath, synthFactory, profileFactory, definitions;
var hasDefinition, options, score, selector, instrumentGain, nodeId;
var voiceBus = 22, wetBus = 20, finalBus = 24;
var mixerNode = 9000, spaceNode = 9001, outputNode = 9002, stopTime = 129.0;

assert = { |condition, message|
    if(condition.not) { Error("ASSERTION FAILED: " ++ message).throw };
};

try {
    assert.value(thisProcess.argv.size == 1,
        "render-stone-and-signal.scd requires one output directory");
    outputDirectory = thisProcess.argv.at(0).standardizePath;
    assert.value(PathName(outputDirectory).isFolder, "output directory must already exist");
    outputPath = outputDirectory +/+ "stone-and-signal-v2-candidate.wav";

    synthFactory = (thisProcess.nowExecutingPath.dirname +/+ "../synths.scd").load;
    profileFactory = (thisProcess.nowExecutingPath.dirname +/+
        "../instrument-profile.scd").load;
    assert.value(synthFactory.isKindOf(Function), "production synth factory must load");
    assert.value(profileFactory.isKindOf(Function), "production profile factory must load");
    definitions = synthFactory.value;
    hasDefinition = { |name| definitions.detect { |definition|
        definition.name == name
    }.notNil };
    [
        \jvSignalCall, \jvSignalAM, \jvSignalFlint, \jvSignalRelic,
        \jvSignalEarth, \jvSignalBlade, \jvSignalBass, \jvSignalSpace,
        \jvMix, \jvOutput
    ].do { |name|
        assert.value(hasDefinition.value(name), "missing production SynthDef " ++ name);
    };

    options = ServerOptions.new
        .numOutputBusChannels_(2)
        .numInputBusChannels_(0)
        .numAudioBusChannels_(128)
        .maxNodes_(1024)
        .sampleRate_(48000)
        .loadDefs_(false);
    score = Score.new;
    definitions.do { |definition|
        score.add([0.0, [\d_recv, definition.asBytes]]);
    };

    // Test-only node and bus numbers intentionally differ from the approved reference sketch.
    // The live service allocates buses and node IDs from its private SC server.
    score.add([0.01, [\s_new, \jvMix, mixerNode, 0, 0,
        \inBus, voiceBus, \outBus, finalBus, \heartbeat, 0, \armed, 0]]);
    score.add([0.011, [\s_new, \jvSignalSpace, spaceNode, 2, mixerNode,
        \inBus, wetBus, \outBus, voiceBus]]);
    score.add([0.012, [\s_new, \jvOutput, outputNode, 3, mixerNode,
        \inBus, finalBus, \hardware, 1]]);

    selector = profileFactory.value(\stoneAndSignalV2, 20260005);
    instrumentGain = -10.dbamp;
    nodeId = 9100;
    1057.do { |tick|
        var now = tick / 8.0;
        var cursor = (
            x: (tick % 17) / 16.0,
            y: (tick % 13) / 12.0,
            motion: (tick % 11) / 10.0
        );
        var action = selector.at(\select).value(cursor, now);
        if(action.notNil) {
            var type = action.at(\type), definition, controls, usesSpace = false;
            switch(type,
                \signalCall, {
                    definition = \jvSignalCall;
                    controls = [\freq, action.at(\freq), \duration, action.at(\duration),
                        \pan, action.at(\pan), \seed, action.at(\seed)];
                    usesSpace = true;
                },
                \amTuning, {
                    definition = \jvSignalAM;
                    controls = [\duration, action.at(\duration), \pan, action.at(\pan),
                        \seed, action.at(\seed)];
                },
                \flint, {
                    definition = \jvSignalFlint;
                    controls = [\scale, action.at(\scale), \pan, action.at(\pan),
                        \seed, action.at(\seed)];
                },
                \relic, {
                    definition = \jvSignalRelic;
                    controls = [\midi, action.at(\midi), \pan, action.at(\pan),
                        \seed, action.at(\seed)];
                    usesSpace = true;
                },
                \earth, {
                    definition = \jvSignalEarth;
                    controls = [\duration, action.at(\duration), \pan, action.at(\pan),
                        \seed, action.at(\seed)];
                },
                \blade, {
                    definition = \jvSignalBlade;
                    controls = [\freq, action.at(\freq), \duration, action.at(\duration),
                        \pan, action.at(\pan), \seed, action.at(\seed)];
                    usesSpace = true;
                },
                \bass, {
                    definition = \jvSignalBass;
                    controls = [\midi, action.at(\midi), \duration, action.at(\duration),
                        \seed, action.at(\seed)];
                },
                { Error("unknown candidate render action").throw }
            );
            score.add([now + 0.25, [
                \s_new, definition, nodeId, 2, if(usesSpace) { spaceNode } { mixerNode },
                \outBus, if(usesSpace) { wetBus } { voiceBus },
                \gain, instrumentGain
            ] ++ controls]);
            ("CANDIDATE_RENDER_EVENT " ++ type.asString ++ " " ++ now.asString).postln;
            nodeId = nodeId + 1;
        };
    };
    assert.value(selector.at(\snapshot).value.at(\queueDepth) == 0,
        "candidate renderer must not introduce an event queue");

    score.add([stopTime, [\n_set, mixerNode, \stop, 1]]);
    score.add([133.45, [\n_free, outputNode]]);
    score.add([133.48, [\c_set, 0, 0]]);
    score.recordNRT(
        oscFilePath: outputDirectory +/+ "stone-and-signal-v2-candidate.osc",
        outputFilePath: outputPath,
        inputFilePath: nil,
        sampleRate: 48000,
        headerFormat: "wav",
        sampleFormat: "int16",
        options: options,
        duration: 133.5,
        action: {
            "PASS: sound/tests/render-stone-and-signal.scd".postln;
            0.exit;
        }
    );
} { |error|
    error.reportError;
    1.exit;
};
)
