(
{ |profile = \legacyPluckV1, seed = 20260909|
    var int32Max = 2147483647, randomState;
    var state = \running, startedAt, lastObservedAt, lastOpportunityAt;
    var opportunitySpacing = 4.0, opportunityChance = 0.6;
    var notes, bassNotes, cooldowns, lastByType, emitted = 0, sparseDropped = 0;
    var saturatingIncrement, nextRandom, legacyAction, candidateAction, select, stop, snapshot;

    if([\legacyPluckV1, \stoneAndSignalV2].includes(profile).not) {
        Error("unknown instrument profile").throw;
    };
    if(seed.isInteger.not or: { seed <= 0 or: { seed >= int32Max } }) {
        Error("instrument profile seed must be a positive int32 below max").throw;
    };

    randomState = seed;
    notes = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72];
    bassNotes = [28, 31, 33, 35];
    cooldowns = IdentityDictionary[
        \signalCall -> 22.0,
        \amTuning -> 48.0,
        \flint -> 12.0,
        \relic -> 42.0,
        \earth -> 60.0,
        \blade -> 22.0,
        \bass -> 30.0
    ];
    lastByType = IdentityDictionary.new;

    saturatingIncrement = { |value| if(value < int32Max) { value + 1 } { int32Max } };
    nextRandom = {
        // Park-Miller with Schrage's method keeps every intermediate inside signed int32.
        // This avoids platform overflow changing the fixed-seed sequence.
        var high = (randomState / 127773).floor.asInteger;
        var low = randomState % 127773;
        var next = (16807 * low) - (2836 * high);
        randomState = if(next > 0) { next } { next + int32Max };
        randomState.asFloat / int32Max.asFloat
    };

    legacyAction = { |cursor|
        var x = cursor.at(\x).clip(0.0, 1.0);
        var y = cursor.at(\y).clip(0.0, 1.0);
        var motion = cursor.at(\motion).clip(0.0, 1.0);
        var noteIndex = (y * (notes.size - 1)).round.asInteger;
        (type: \pluck, midi: notes.at(noteIndex), motion: motion, pan: (x * 1.6) - 0.8)
    };

    candidateAction = { |cursor, now|
        var x, y, motion, roll, type, previous, action;
        if(startedAt.isNil) {
            startedAt = now;
            lastObservedAt = now;
            sparseDropped = saturatingIncrement.value(sparseDropped);
            action = nil;
        } {
            if(now < lastObservedAt) {
                action = nil;
            } {
                lastObservedAt = now;
                if(
                    now < (startedAt + opportunitySpacing) or: {
                        lastOpportunityAt.notNil and: {
                            now < (lastOpportunityAt + opportunitySpacing)
                        }
                    }
                ) {
                    sparseDropped = saturatingIncrement.value(sparseDropped);
                    action = nil;
                } {
                    lastOpportunityAt = now;
                    if(nextRandom.value >= opportunityChance) {
                        sparseDropped = saturatingIncrement.value(sparseDropped);
                        action = nil;
                    } {
                        roll = nextRandom.value * 100.0;
                        type = case
                            { roll < 24.0 } { \signalCall }
                            { roll < 34.0 } { \amTuning }
                            { roll < 56.0 } { \flint }
                            { roll < 62.0 } { \relic }
                            { roll < 70.0 } { \earth }
                            { roll < 84.0 } { \blade }
                            { \bass };
                        previous = lastByType.at(type);
                        if(previous.notNil and: { now < (previous + cooldowns.at(type)) }) {
                            sparseDropped = saturatingIncrement.value(sparseDropped);
                            action = nil;
                        } {
                            x = cursor.at(\x).clip(0.0, 1.0);
                            y = cursor.at(\y).clip(0.0, 1.0);
                            motion = cursor.at(\motion).clip(0.0, 1.0);
                            lastByType.put(type, now);
                            emitted = saturatingIncrement.value(emitted);
                            action = switch(type,
                                \signalCall, { (
                                    type: type,
                                    freq: 132.0 + ((1.0 - y) * 68.0),
                                    duration: 6.2 + (motion * 1.6),
                                    pan: (x * 1.2) - 0.6,
                                    seed: randomState
                                ) },
                                \amTuning, { (
                                    type: type,
                                    duration: 2.3 + (motion * 0.9),
                                    pan: (x * 1.2) - 0.6,
                                    seed: randomState
                                ) },
                                \flint, { (
                                    type: type,
                                    scale: 0.9 + (y * 0.25),
                                    pan: (x * 1.4) - 0.7,
                                    seed: randomState
                                ) },
                                \relic, { (
                                    type: type,
                                    midi: notes.at((y * (notes.size - 1)).round.asInteger),
                                    pan: (x * 1.2) - 0.6,
                                    seed: randomState
                                ) },
                                \earth, { (
                                    type: type,
                                    duration: 4.6 + (motion * 1.0),
                                    pan: (x * 0.4) - 0.2,
                                    seed: randomState
                                ) },
                                \blade, { (
                                    type: type,
                                    freq: 680.0 + (y * 360.0),
                                    duration: 1.8 + (motion * 0.8),
                                    pan: (x * 1.4) - 0.7,
                                    seed: randomState
                                ) },
                                \bass, { (
                                    type: type,
                                    midi: bassNotes.at((y * (bassNotes.size - 1)).round.asInteger),
                                    duration: 3.0 + (motion * 0.8),
                                    seed: randomState
                                ) }
                            );
                        };
                    };
                };
            };
        };
        action
    };

    select = { |cursor, now|
        if(state == \stopped) {
            nil
        } {
            if(profile == \legacyPluckV1) {
                legacyAction.value(cursor)
            } {
                candidateAction.value(cursor, now)
            }
        }
    };
    stop = { state = \stopped; nil };
    snapshot = { (
        state: state,
        profile: profile,
        seed: seed,
        emitted: emitted,
        sparseDropped: sparseDropped,
        queueDepth: 0,
        maxVoices: 8
    ) };

    (select: select, stop: stop, snapshot: snapshot)
}
)
