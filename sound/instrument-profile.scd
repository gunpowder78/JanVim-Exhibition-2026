(
{ |profile = \legacyPluckV1, seed = 20260909|
    var int32Max = 2147483647, randomState;
    var state = \running, lastObservedAt, lastOnsetAt, phraseType, lastAccentAt;
    var activityGap = 0.65, spacing, singleAccent;
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
        \signalCall -> 16.0,
        \amTuning -> 12.0,
        \flint -> 12.0,
        \relic -> 30.0,
        \earth -> 24.0,
        \blade -> 18.0
    ];
    lastByType = IdentityDictionary.new;
    spacing = (bass: 0.3, pluck: 0.3, amTuning: 0.375, signalCall: 0.625, earth: 0.625);
    singleAccent = [\flint, \blade, \relic];

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
        var x, y, motion, roll, type, previous, action, newGroup;
        if(lastObservedAt.notNil and: { now < lastObservedAt }) {
            nil
        } {
            // Infer one activity group from fresh editor cursor samples. The wire intentionally
            // carries no text/cue metadata. No timer, pending note or heartbeat can generate notes.
            newGroup = lastObservedAt.isNil or: { (now - lastObservedAt) >= activityGap };
            lastObservedAt = now;
            if(newGroup) {
                roll = nextRandom.value * 100.0;
                type = case
                    { roll < 40.0 } { \bass }
                    { roll < 67.0 } { \pluck }
                    { roll < 82.0 } { \amTuning }
                    { roll < 88.0 } { \signalCall }
                    { roll < 93.0 } { \earth }
                    { roll < 96.0 } { \flint }
                    { roll < 99.0 } { \blade }
                    { \relic };
                previous = lastByType.at(type);
                if((previous.notNil and: { now < (previous + cooldowns.at(type)) }) or: {
                    singleAccent.includes(type) and: {
                        lastAccentAt.notNil and: { now < (lastAccentAt + 3.2) }
                    }
                }) {
                    type = if((roll % 2.0) < 1.0) { \bass } { \pluck };
                };
                phraseType = type;
                if(cooldowns.includesKey(type)) { lastByType.put(type, now) };
                if(singleAccent.includes(type)) { lastAccentAt = now };
            };
            type = phraseType;
            if(newGroup or: {
                singleAccent.includes(type).not and: {
                    lastOnsetAt.isNil or: { (now - lastOnsetAt) >= spacing.at(type) }
                }
            }) {
                x = cursor.at(\x).clip(0.0, 1.0);
                y = cursor.at(\y).clip(0.0, 1.0);
                motion = cursor.at(\motion).clip(0.0, 1.0);
                lastOnsetAt = now;
                emitted = saturatingIncrement.value(emitted);
                action = switch(type,
                    \pluck, { legacyAction.value(cursor) },
                    \signalCall, { (
                        type: type, freq: 132.0 + ((1.0 - y) * 68.0),
                        duration: 1.5, cursorPulse: 1,
                        pan: (x * 1.2) - 0.6, seed: randomState
                    ) },
                    \amTuning, { (
                        type: type, duration: 0.9, cursorPulse: 1,
                        pan: (x * 1.2) - 0.6, seed: randomState
                    ) },
                    \flint, { (
                        type: type, scale: 0.9 + (y * 0.25),
                        pan: (x * 1.4) - 0.7, seed: randomState
                    ) },
                    \relic, { (
                        type: type, midi: notes.at((y * (notes.size - 1)).round.asInteger),
                        pan: (x * 1.2) - 0.6, seed: randomState
                    ) },
                    \earth, { (
                        type: type, duration: 1.5, cursorPulse: 1,
                        pan: (x * 0.4) - 0.2, seed: randomState
                    ) },
                    \blade, { (
                        type: type, freq: 680.0 + (y * 360.0),
                        duration: 1.8 + (motion * 0.8),
                        pan: (x * 1.4) - 0.7, seed: randomState
                    ) },
                    \bass, { (
                        type: type, midi: bassNotes.at((y * (bassNotes.size - 1)).round.asInteger),
                        duration: 1.2, strokes: 1, seed: randomState
                    ) }
                );
            } {
                sparseDropped = saturatingIncrement.value(sparseDropped);
            };
            action
        }
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
        activityGap: activityGap,
        phraseType: phraseType,
        queueDepth: 0,
        maxVoices: 8
    ) };

    (select: select, stop: stop, snapshot: snapshot)
}
)
