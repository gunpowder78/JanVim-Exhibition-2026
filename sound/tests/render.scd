(
var assert, outputDirectory, synthsPath, synthFactory, definitions, hasDefinition;
var options, addDefinitions, addScoreCleanup;
var mainScore, watchdogScore, renderScore, mainCapture, watchdogCapture;

assert = { |condition, message|
    if(condition.not) { Error("ASSERTION FAILED: " ++ message).throw };
};

try {
    assert.value(thisProcess.argv.size == 1, "render.scd requires one output directory");
    outputDirectory = thisProcess.argv.at(0).standardizePath;
    assert.value(PathName(outputDirectory).isFolder, "output directory must already exist");

    synthsPath = thisProcess.nowExecutingPath.dirname +/+ "../synths.scd";
    assert.value(File.exists(synthsPath), "production synths.scd must exist");
    synthFactory = synthsPath.load;
    assert.value(synthFactory.isKindOf(Function), "synths.scd must evaluate to a Function");
    definitions = synthFactory.value;
    assert.value(definitions.isArray, "synth factory must return an Array");
    assert.value(definitions.size == 5, "synth factory must return exactly five definitions");
    hasDefinition = { |name| definitions.detect { |definition| definition.name == name }.notNil };
    [\jvPluck, \jvWind, \jvMix, \jvOutput, \jvCapture].do { |name|
        assert.value(hasDefinition.value(name), "missing production SynthDef " ++ name);
    };

    options = ServerOptions.new
        .numOutputBusChannels_(2)
        .numInputBusChannels_(0)
        .numAudioBusChannels_(128)
        .maxNodes_(1024)
        .sampleRate_(48000)
        .loadDefs_(false);

    addDefinitions = { |score|
        definitions.do { |definition|
            score.add([0.0, [\d_recv, definition.asBytes]]);
        };
    };

    addScoreCleanup = { |score, outputNode, windNode, closeTime|
        score.add([closeTime - 0.15, [\n_set, windNode, \gate, 0]]);
        score.add([closeTime - 0.05, [\n_free, windNode]]);
        score.add([closeTime, [\n_free, outputNode]]);
        score.add([closeTime + 0.05, [\c_set, 0, 0]]);
    };

    mainCapture = outputDirectory +/+ "main-capture.wav";
    mainScore = Score.new;
    addDefinitions.value(mainScore);
    mainScore.add([0.01, [\s_new, \jvMix, 1000, 0, 0,
        \inBus, 16, \outBus, 18, \heartbeat, 0, \armed, 0]]);
    mainScore.add([0.01, [\s_new, \jvOutput, 1001, 1, 0,
        \inBus, 18, \hardware, 1]]);
    mainScore.add([0.50, [\s_new, \jvPluck, 1100, 2, 1000,
        \outBus, 16, \midi, 60, \motion, 0.8, \pan, -0.35]]);
    mainScore.add([2.50, [\s_new, \jvWind, 1200, 2, 1000,
        \outBus, 16, \energy, 0.65, \pan, 0.35, \gate, 1]]);
    mainScore.add([5.00, [\n_set, 1000, \stop, 1]]);
    addScoreCleanup.value(mainScore, 1001, 1200, 8.75);

    watchdogCapture = outputDirectory +/+ "watchdog-capture.wav";
    watchdogScore = Score.new;
    addDefinitions.value(watchdogScore);
    watchdogScore.add([0.01, [\s_new, \jvMix, 2000, 0, 0,
        \inBus, 16, \outBus, 18, \heartbeat, 1, \armed, 1]]);
    watchdogScore.add([0.01, [\s_new, \jvWind, 2200, 2, 2000,
        \outBus, 16, \energy, 0.65, \pan, -0.2, \gate, 1]]);
    watchdogScore.add([0.01, [\s_new, \jvOutput, 2001, 1, 0,
        \inBus, 18, \hardware, 1]]);
    watchdogScore.add([0.75, [\n_set, 2000, \heartbeat, 2]]);
    addScoreCleanup.value(watchdogScore, 2001, 2200, 6.60);

    renderScore = { |score, scoreName, capturePath, engineDuration, action|
        score.recordNRT(
            oscFilePath: outputDirectory +/+ (scoreName ++ ".osc"),
            outputFilePath: capturePath,
            inputFilePath: nil,
            sampleRate: 48000,
            headerFormat: "wav",
            sampleFormat: "int16",
            options: options,
            duration: engineDuration,
            action: action
        );
    };

    renderScore.value(mainScore, "main", mainCapture, 9.0, {
        renderScore.value(watchdogScore, "watchdog", watchdogCapture, 6.9, {
            "PASS: sound/tests/render.scd".postln;
            0.exit;
        });
    });
} { |error|
    error.reportError;
    1.exit;
};
)
