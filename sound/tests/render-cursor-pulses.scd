(
var outputDirectory, definitions, score, options, nodeId = 9100;
try {
    outputDirectory = thisProcess.argv.at(0).standardizePath;
    definitions = (thisProcess.nowExecutingPath.dirname +/+ "../synths.scd").load.value;
    score = Score.new;
    definitions.do { |definition| score.add([0.0, [\d_recv, definition.asBytes]]) };
    // Isolated one-shot probes followed by three actual admissions. No hardware device is opened.
    [\jvSignalBass, \jvPluck, \jvSignalAM, \jvSignalCall, \jvSignalEarth].do { |name, index|
        [0.25, 3.25, 3.625, 4.0].do { |offset|
            score.add([(index * 8.0) + offset, [
                \s_new, name, nodeId, 0, 0, \outBus, 0, \gain, -10.dbamp * 2.0,
                \duration, 1.2, \strokes, 1, \cursorPulse, 1,
                \midi, 33, \freq, 165, \motion, 0.5, \seed, 20260909
            ]]);
            nodeId = nodeId + 1;
        };
    };
    options = ServerOptions.new.numOutputBusChannels_(2).numInputBusChannels_(0)
        .numAudioBusChannels_(128).maxNodes_(1024).sampleRate_(48000).loadDefs_(false);
    score.add([39.98, [\c_set, 0, 0]]);
    score.recordNRT(
        oscFilePath: outputDirectory +/+ "cursor-pulses.osc",
        outputFilePath: outputDirectory +/+ "cursor-pulses.wav",
        sampleRate: 48000, headerFormat: "wav", sampleFormat: "int16",
        options: options, duration: 40.0,
        action: { "PASS: cursor pulses NRT".postln; 0.exit }
    );
} { |error| error.reportError; 1.exit };
)
