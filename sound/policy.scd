(
{ |session, initialCounters|
    var paths, lengths, notes, counterKeys, int32Max, validSeed;
    var state, lastSeq, lastHeartbeat, lastCursor, lastFlock;
    var acceptedPlucks, acceptedFlocks, rejected, rateDropped;
    var finiteFloat, saturatingIncrement, reject, stop, timeout;
    var handle, tick, snapshot;

    paths = [
        "/janvim/sound/v1/start",
        "/janvim/sound/v1/heartbeat",
        "/janvim/sound/v1/cursor",
        "/janvim/sound/v1/flock",
        "/janvim/sound/v1/stop"
    ];
    lengths = [4, 4, 7, 6, 4];
    notes = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72];
    counterKeys = [\acceptedPlucks, \acceptedFlocks, \rejected, \rateDropped];
    int32Max = 2147483647;

    if(initialCounters.notNil) {
        if(initialCounters.isKindOf(Event).not) {
            Error("initialCounters must be an Event").throw;
        };
        validSeed = initialCounters.keys.every { |key| counterKeys.includes(key) };
        if(validSeed.not) {
            Error("initialCounters contains an unknown counter").throw;
        };
        counterKeys.do { |key|
            if(initialCounters.includesKey(key)) {
                validSeed = initialCounters.at(key);
                if(
                    validSeed.isInteger.not or: {
                        validSeed < 0 or: { validSeed > int32Max }
                    }
                ) {
                    Error("initialCounters values must be int32 counters").throw;
                };
            };
        };
    };

    state = \idle;
    lastSeq = 0;
    lastHeartbeat = nil;
    lastCursor = nil;
    lastFlock = nil;
    acceptedPlucks = if(initialCounters.isNil) { 0 } { initialCounters.at(\acceptedPlucks) ? 0 };
    acceptedFlocks = if(initialCounters.isNil) { 0 } { initialCounters.at(\acceptedFlocks) ? 0 };
    rejected = if(initialCounters.isNil) { 0 } { initialCounters.at(\rejected) ? 0 };
    rateDropped = if(initialCounters.isNil) { 0 } { initialCounters.at(\rateDropped) ? 0 };

    finiteFloat = { |value|
        value.isFloat and: {
            value.isNaN.not and: { value != inf and: { value != -inf } }
        }
    };

    saturatingIncrement = { |value|
        if(value < int32Max) { value + 1 } { int32Max }
    };

    reject = {
        rejected = saturatingIncrement.value(rejected);
        nil
    };

    stop = { |reason|
        if(state == \stopped) {
            nil
        } {
            state = \stopped;
            (type: \stop, reason: reason)
        }
    };

    timeout = { |now|
        if(
            (state == \running) and: {
                lastHeartbeat.notNil and: { now >= (lastHeartbeat + 2.0) }
            }
        ) {
            stop.value(\heartbeatTimeout)
        } {
            nil
        }
    };

    handle = { |msg, now|
        var timeoutAction, valid, path, pathIndex, seq, sentAt;
        var x, y, motion, energy, centroid, noteIndex;

        if(finiteFloat.value(now).not) {
            reject.value
        } {
            timeoutAction = timeout.value(now);
            if(timeoutAction.notNil) {
                timeoutAction
            } {
                if(state == \stopped) {
                    nil
                } {
                    valid = msg.isArray;
                    if(valid) {
                        valid = msg.size >= 1;
                    };
                    if(valid) {
                        path = msg.at(0);
                        valid = path.isString;
                    };
                    if(valid) {
                        pathIndex = paths.indexOfEqual(path);
                        valid = pathIndex.notNil;
                    };
                    if(valid) {
                        valid = msg.size == lengths.at(pathIndex);
                    };
                    if(valid) {
                        valid = [session].includesEqual(msg.at(1));
                    };
                    if(valid) {
                        seq = msg.at(2);
                        valid = seq.isInteger and: {
                            seq > 0 and: { seq <= int32Max }
                        };
                    };
                    if(valid) {
                        sentAt = msg.at(3);
                        valid = finiteFloat.value(sentAt);
                    };
                    if(valid) {
                        valid = (sentAt >= (now - 0.5)) and: {
                            sentAt <= (now + 0.1)
                        };
                    };
                    if(valid) {
                        valid = seq > lastSeq;
                    };
                    if(valid and: { pathIndex == 2 }) {
                        valid = finiteFloat.value(msg.at(4)) and: {
                            finiteFloat.value(msg.at(5)) and: {
                                finiteFloat.value(msg.at(6))
                            }
                        };
                    };
                    if(valid and: { pathIndex == 3 }) {
                        valid = finiteFloat.value(msg.at(4)) and: {
                            finiteFloat.value(msg.at(5))
                        };
                    };
                    if(valid) {
                        if(pathIndex == 0) {
                            valid = state == \idle;
                        } {
                            if((pathIndex >= 1) and: { pathIndex <= 3 }) {
                                valid = state == \running;
                            };
                        };
                    };

                    if(valid.not) {
                        reject.value
                    } {
                        lastSeq = seq;

                        if(pathIndex == 0) {
                            state = \running;
                            lastHeartbeat = now;
                            (type: \start)
                        } {
                            if(pathIndex == 1) {
                                lastHeartbeat = now;
                                nil
                            } {
                                if(pathIndex == 2) {
                                    if(lastCursor.notNil and: { now < (lastCursor + 0.125) }) {
                                        rateDropped = saturatingIncrement.value(rateDropped);
                                        nil
                                    } {
                                        lastCursor = now;
                                        acceptedPlucks = saturatingIncrement.value(acceptedPlucks);
                                        x = msg.at(4).clip(0.0, 1.0);
                                        y = msg.at(5).clip(0.0, 1.0);
                                        motion = msg.at(6).clip(0.0, 1.0);
                                        noteIndex = (y * (notes.size - 1)).round.asInteger;
                                        (
                                            type: \pluck,
                                            midi: notes.at(noteIndex),
                                            motion: motion,
                                            pan: (x * 1.6) - 0.8
                                        )
                                    }
                                } {
                                    if(pathIndex == 3) {
                                        if(lastFlock.notNil and: { now < (lastFlock + 0.05) }) {
                                            rateDropped = saturatingIncrement.value(rateDropped);
                                            nil
                                        } {
                                            lastFlock = now;
                                            acceptedFlocks = saturatingIncrement.value(acceptedFlocks);
                                            energy = msg.at(4).clip(0.0, 1.0);
                                            centroid = msg.at(5).clip(0.0, 1.0);
                                            (
                                                type: \wind,
                                                energy: energy,
                                                pan: (centroid * 1.6) - 0.8
                                            )
                                        }
                                    } {
                                        stop.value(\requested)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    };

    tick = { |now|
        if(finiteFloat.value(now)) { timeout.value(now) } { nil }
    };

    snapshot = {
        (
            state: state,
            lastSeq: lastSeq,
            acceptedPlucks: acceptedPlucks,
            acceptedFlocks: acceptedFlocks,
            rejected: rejected,
            rateDropped: rateDropped
        )
    };

    (handle: handle, tick: tick, snapshot: snapshot)
}
)
