(
var assert, assertEqual, assertNil, assertThrows, profilePath, factory;
var cursor, legacy, first, dense, emitted, snapshot, stopped, sameA, sameB, other;
var expectedTimes, expectedTypes, cooldowns, lastByType;

assert = { |condition, message|
    if(condition.not) { Error("ASSERTION FAILED: " ++ message).throw };
};

assertEqual = { |actual, expected, message|
    assert.value(
        actual.asCompileString == expected.asCompileString,
        message ++ " (actual: " ++ actual ++ ", expected: " ++ expected ++ ")"
    );
};

assertNil = { |actual, message|
    assert.value(actual.isNil, message ++ " (actual: " ++ actual ++ ")");
};

assertThrows = { |function, message|
    var threw = false;
    try { function.value } { threw = true };
    assert.value(threw, message);
};

profilePath = thisProcess.nowExecutingPath.dirname +/+ "../instrument-profile.scd";
cursor = (x: 0.5, y: 0.5, motion: 0.5);

try {
    factory = profilePath.load;
    assert.value(factory.isKindOf(Function), "instrument profile must load as a factory Function");

    // Removing the legacy branch would make an unconfigured show sparse instead of preserving golden behavior.
    legacy = factory.value(\legacyPluckV1, 20260909);
    first = legacy.at(\select).value(cursor, 10.0);
    assertEqual.value(first.at(\type), \pluck, "legacy profile emits the existing pluck action");
    assertEqual.value(first.at(\midi), 60, "legacy profile preserves the existing pentatonic midpoint");
    assert.value(legacy.at(\select).value(cursor, 10.125).notNil,
        "legacy profile leaves the existing 125ms policy admission unchanged");

    // A wrong PRNG, weight boundary, cooldown, or opportunity clock changes this hand-derived sequence.
    dense = factory.value(\stoneAndSignalV2, 20260005);
    emitted = List.new;
    1025.do { |tick|
        var now = tick / 8.0;
        var action = dense.at(\select).value(cursor, now);
        if(action.notNil) { emitted.add([now, action.at(\type)]) };
    };
    expectedTimes = [4.0, 20.0, 24.0, 44.0, 48.0, 56.0, 60.0,
        76.0, 84.0, 88.0, 104.0, 108.0, 116.0, 128.0];
    expectedTypes = [\amTuning, \signalCall, \relic, \bass, \signalCall,
        \blade, \flint, \signalCall, \earth, \flint, \bass, \flint,
        \amTuning, \blade];
    assertEqual.value(emitted.collect(_.at(0)), expectedTimes,
        "dense 8Hz input keeps the fixed-seed four-second opportunity sequence");
    assertEqual.value(emitted.collect(_.at(1)), expectedTypes,
        "fixed seed selects every approved timbre with stable weights");
    emitted.doAdjacentPairs { |left, right|
        assert.value((right.at(0) - left.at(0)) >= 4.0,
            "global spacing prevents dense cursor sound");
    };

    cooldowns = (signalCall: 22.0, relic: 42.0, amTuning: 48.0, flint: 12.0,
        earth: 60.0, blade: 22.0, bass: 30.0);
    lastByType = IdentityDictionary.new;
    emitted.do { |entry|
        var type = entry.at(1), previous = lastByType.at(type);
        if(previous.notNil) {
            assert.value((entry.at(0) - previous) >= cooldowns.at(type),
                type ++ " category cooldown is enforced");
        };
        lastByType.put(type, entry.at(0));
    };
    snapshot = dense.at(\snapshot).value;
    assertEqual.value(snapshot.at(\queueDepth), 0,
        "skipped cursor opportunities are never queued for replay");
    assert.value(snapshot.at(\emitted) <= 32,
        "four-second opportunities bound a 128-second dense input run");

    // Replacing the deterministic state with ambient randomness breaks replay of identical evidence.
    sameA = factory.value(\stoneAndSignalV2, 12345);
    sameB = factory.value(\stoneAndSignalV2, 12345);
    other = factory.value(\stoneAndSignalV2, 54321);
    assertEqual.value(
        (0..160).collect { |tick| sameA.at(\select).value(cursor, tick.asFloat) }.reject(_.isNil).collect(_[\type]),
        (0..160).collect { |tick| sameB.at(\select).value(cursor, tick.asFloat) }.reject(_.isNil).collect(_[\type]),
        "same seed, cursor values, and fake times replay the same types"
    );
    assert.value(other.at(\select).value(cursor, 0.0).isNil,
        "candidate keeps its initial silence for every seed");

    // Removing the latch would let delayed cursor traffic sound after unified Stop.
    stopped = factory.value(\stoneAndSignalV2, 20260005);
    stopped.at(\select).value(cursor, 0.0);
    stopped.at(\select).value(cursor, 4.0);
    stopped.at(\stop).value;
    assertNil.value(stopped.at(\select).value(cursor, 100.0),
        "Stop prevents all later cursor-triggered sound");
    snapshot = stopped.at(\snapshot).value;
    assertEqual.value(snapshot.at(\state), \stopped, "Stop is terminal");
    assertEqual.value(snapshot.at(\queueDepth), 0, "Stop has no delayed event queue to drain");

    assertThrows.value({ factory.value(\unknownProfile, 1) }, "unknown profile fails closed");
    assertThrows.value({ factory.value(\stoneAndSignalV2, 0) }, "zero seed fails closed");
    assertThrows.value({ factory.value(\stoneAndSignalV2, 1.0) }, "non-integer seed fails closed");

    "PASS: sound/tests/instrument-profile.scd".postln;
    0.exit;
} { |error|
    error.reportError;
    1.exit;
};
)
