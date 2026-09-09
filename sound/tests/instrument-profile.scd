(
var assert, assertEqual, assertNil, assertThrows, profilePath, factory;
var cursor, legacy, first, dense, emitted, bassActions, snapshot, stopped, sameA, sameB, other;
var cooldowns, lastByType, burst, actions;

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

    // Withholding the first onset or scheduling repeats without a fresh input breaks visible write-back.
    burst = factory.value(\stoneAndSignalV2, 1);
    first = burst.at(\select).value(cursor, 10.0);
    assert.value(first.notNil, "a fresh cursor activity group must respond immediately");
    assertEqual.value(first.at(\type), \bass, "independent Park-Miller fixture begins with bass");
    assertEqual.value(first.at(\strokes), 1, "one cursor admission can start only one bass pluck");
    actions = List[first];
    [10.125, 10.25, 10.375, 10.5, 10.625, 10.75].do { |now|
        var action = burst.at(\select).value(cursor, now);
        if(action.notNil) { actions.add(action) };
    };
    assertEqual.value(actions.size, 3, "dense 8Hz input is thinned to three fresh bass onsets in 750ms");
    assert.value(actions.every { |action| action.at(\type) == \bass and: { action.at(\strokes) == 1 } },
        "a continuous activity group keeps its timbre and never starts an autonomous phrase");
    assertNil.value(burst.at(\select).value(cursor, 9.0), "backward clock input cannot retrigger sound");

    // The exact idle boundary must allow a new group, while short sampling gaps keep a melody.
    burst = factory.value(\stoneAndSignalV2, 20260909);
    first = burst.at(\select).value(cursor, 0.0);
    assertEqual.value(first.at(\type), \pluck, "first production group uses the original pluck");
    assertEqual.value(burst.at(\select).value(cursor, 0.649).at(\type), \pluck,
        "a short sampling gap does not switch the melodic unit");
    assertEqual.value(burst.at(\select).value(cursor, 1.3).at(\type), \bass,
        "an idle gap starts the next deterministic unit without waiting for another input");
    burst = factory.value(\stoneAndSignalV2, 54321);
    first = burst.at(\select).value((x: 0.5, y: 0.0, motion: 0.5), 0.0);
    assertEqual.value(first.at(\midi), 48, "plucked melody follows the cursor's first pitch position");
    assertEqual.value(burst.at(\select).value((x: 0.5, y: 1.0, motion: 0.5), 0.375).at(\midi), 72,
        "later fresh positions change pitches inside the same melodic unit");

    [120000, 123000, 127000].do { |seedValue|
        var accent = factory.value(\stoneAndSignalV2, seedValue);
        var onsets = 13.collect { |tick| accent.at(\select).value(cursor, tick / 8.0) }.reject(_.isNil);
        assertEqual.value(onsets.size, 1, "stone, blade and relic accents do not repeat on every character");
    };

    // Each accepted carrier can repeat, but only on input, with a single-attack tail.
    [[54321, \pluck], [90000, \amTuning], [110000, \signalCall], [116000, \earth]].do { |entry|
        var profile = factory.value(\stoneAndSignalV2, entry.at(0));
        var onsets = List.new;
        13.do { |tick|
            var action = profile.at(\select).value(cursor, tick / 8.0);
            if(action.notNil) { onsets.add(action) };
        };
        assert.value(onsets.size >= 2, entry.at(1) ++ " follows continuous cursor activity");
        assert.value(onsets.every { |action| action.at(\type) == entry.at(1) },
            "one activity group does not randomly switch timbres between characters");
        if([\amTuning, \signalCall, \earth].includes(entry.at(1))) {
            assert.value(onsets.every { |action| action.at(\cursorPulse) == 1 },
                "textures use one input-triggered attack and a natural release");
        };
    };

    // A wrong PRNG, cooldown or idle boundary changes the independently specified phrase fixture.
    dense = factory.value(\stoneAndSignalV2, 20260005);
    emitted = List.new;
    bassActions = List.new;
    32.do { |tick|
        var now = tick * 4.0;
        var action = dense.at(\select).value(cursor, now);
        if(action.notNil) {
            emitted.add([now, action.at(\type)]);
            if(action.at(\type) == \bass) { bassActions.add(action) };
        };
    };
    assertEqual.value(emitted.copyRange(0, 3).collect(_.at(1)), [\pluck, \bass, \pluck, \blade],
        "fixed seed selects stable types for separate activity groups");
    assertEqual.value(emitted.size, 32, "every isolated activity group gets a fresh response");

    cooldowns = (signalCall: 16.0, relic: 30.0, amTuning: 12.0, flint: 12.0,
        earth: 24.0, blade: 18.0);
    lastByType = IdentityDictionary.new;
    emitted.do { |entry|
        var type = entry.at(1), previous = lastByType.at(type);
        if(previous.notNil and: { cooldowns.at(type).notNil }) {
            assert.value((entry.at(0) - previous) >= cooldowns.at(type),
                type ++ " category cooldown is enforced");
        };
        lastByType.put(type, entry.at(0));
    };
    snapshot = dense.at(\snapshot).value;
    assertEqual.value(snapshot.at(\queueDepth), 0,
        "skipped cursor opportunities are never queued for replay");
    assert.value(bassActions.every { |action| action.at(\strokes) == 1 },
        "bass phrases contain only fresh input-triggered single plucks");
    burst = factory.value(\stoneAndSignalV2, 1);
    emitted = List.new;
    12801.do { |tick|
        var now = tick / 100.0;
        var action = burst.at(\select).value(cursor, now);
        if(action.notNil) { emitted.add(now) };
    };
    assert.value(emitted.size <= 428, "dense input cannot exceed the bounded bass onset rate");
    emitted.doAdjacentPairs { |left, right|
        assert.value(right - left >= 0.299, "even 100Hz input cannot stack bass attacks");
    };

    // Replacing the deterministic state with ambient randomness breaks replay of identical evidence.
    sameA = factory.value(\stoneAndSignalV2, 12345);
    sameB = factory.value(\stoneAndSignalV2, 12345);
    other = factory.value(\stoneAndSignalV2, 54321);
    assertEqual.value(
        (0..160).collect { |tick| sameA.at(\select).value(cursor, tick.asFloat) }.reject(_.isNil).collect(_[\type]),
        (0..160).collect { |tick| sameB.at(\select).value(cursor, tick.asFloat) }.reject(_.isNil).collect(_[\type]),
        "same seed, cursor values, and fake times replay the same types"
    );
    assert.value(other.at(\select).value(cursor, 0.0).notNil,
        "new input groups do not wait for the old independent opportunity clock");

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
