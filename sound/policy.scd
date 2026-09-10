(
var instrumentProfileFactory = (thisProcess.nowExecutingPath.dirname +/+ "instrument-profile.scd").load;
{ |session, initialCounters, flockIngress = false, instrumentProfile = \legacyPluckV1,
    instrumentSeed = 20260909|
    var paths, lengths, counterKeys, int32Max, validSeed;
    var state, lastSeq, lastHeartbeat, lastCursor, lastFlock;
    var flockEpoch = 0, flockRevision = 0, windExpiresAt;
    var acceptedPlucks, acceptedFlocks, rejected, rateDropped, sparseDropped;
    var finiteFloat, saturatingIncrement, reject, stop, timeout;
    var handle, tick, snapshot, instrumentSelector;

    paths = [
        "/janvim/sound/v1/start",
        "/janvim/sound/v1/heartbeat",
        "/janvim/sound/v1/cursor",
        "/janvim/sound/v1/flock",
        "/janvim/sound/v1/stop",
        "/janvim/sound/v1/site-mix"
    ];
    lengths = [4, 4, 7, 6, 4, 6];
    if(flockIngress == true) {
        paths = paths ++ ["/janvim/sound/v1/flock-live", "/janvim/sound/v1/flock-mute"];
        lengths = lengths ++ [9, 6];
    };
    counterKeys = [\acceptedPlucks, \acceptedFlocks, \rejected, \rateDropped, \sparseDropped];
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
    sparseDropped = if(initialCounters.isNil) { 0 } { initialCounters.at(\sparseDropped) ? 0 };
    if(instrumentProfileFactory.isKindOf(Function).not) {
        Error("instrument profile factory failed to load").throw;
    };
    instrumentSelector = instrumentProfileFactory.value(instrumentProfile, instrumentSeed);

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
            windExpiresAt = nil;
            instrumentSelector.at(\stop).value;
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
        var x, y, motion, energy, centroid, instrumentAction;
        var epoch, revision, expiresAt, windGainDb, instrumentGainDb;

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
                    if(valid and: { pathIndex == 5 }) {
                        windGainDb = msg.at(4);
                        instrumentGainDb = msg.at(5);
                        valid = finiteFloat.value(windGainDb) and: {
                            windGainDb >= -24.0 and: { windGainDb <= 6.0 and: {
                                finiteFloat.value(instrumentGainDb) and: {
                                    instrumentGainDb >= -24.0 and: { instrumentGainDb <= 6.0 }
                                }
                            } }
                        };
                    };
                    if(valid and: { pathIndex >= 6 }) {
                        epoch = msg.at(4);
                        revision = msg.at(5);
                        valid = epoch.isInteger and: {
                            epoch > 0 and: { epoch <= int32Max and: {
                                revision.isInteger and: {
                                    revision > 0 and: { revision <= int32Max and: {
                                        epoch >= flockEpoch and: { revision > flockRevision }
                                    } }
                                }
                            } }
                        };
                    };
                    if(valid and: { pathIndex == 6 }) {
                        energy = msg.at(6);
                        centroid = msg.at(7);
                        expiresAt = msg.at(8);
                        valid = finiteFloat.value(energy) and: {
                            energy >= 0.0 and: { energy <= 1.0 and: {
                                finiteFloat.value(centroid) and: {
                                    centroid >= 0.0 and: { centroid <= 1.0 and: {
                                        finiteFloat.value(expiresAt) and: {
                                            now < expiresAt and: { expiresAt <= (sentAt + 0.5) }
                                        }
                                    } }
                                }
                            } }
                        };
                    };
                    if(valid) {
                        if(pathIndex == 0) {
                            valid = state == \idle;
                        } {
                            if(pathIndex != 4) {
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
                                        x = msg.at(4).clip(0.0, 1.0);
                                        y = msg.at(5).clip(0.0, 1.0);
                                        motion = msg.at(6).clip(0.0, 1.0);
                                        instrumentAction = instrumentSelector.at(\select).value(
                                            (x: x, y: y, motion: motion), now
                                        );
                                        if(instrumentAction.notNil) {
                                            acceptedPlucks = saturatingIncrement.value(acceptedPlucks);
                                        } {
                                            if(instrumentProfile == \stoneAndSignalV2) {
                                                sparseDropped = saturatingIncrement.value(sparseDropped);
                                            };
                                        };
                                        instrumentAction
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
                                        if(pathIndex == 4) {
                                            stop.value(\requested)
                                        } {
                                            if(pathIndex == 5) {
                                                (type: \siteMix, windGainDb: windGainDb,
                                                    instrumentGainDb: instrumentGainDb)
                                            } {
                                                // The sender admits samples at 20Hz. Apply each new
                                                // watermark here immediately, including epoch/mute
                                                // changes less than 50ms apart. Never renew the lease.
                                                flockEpoch = epoch;
                                                flockRevision = revision;
                                                if(pathIndex == 6) {
                                                    windExpiresAt = expiresAt;
                                                    acceptedFlocks = saturatingIncrement.value(acceptedFlocks);
                                                    (type: \wind, energy: energy, pan: (centroid * 1.6) - 0.8)
                                                } {
                                                    windExpiresAt = nil;
                                                    (type: \windMute)
                                                }
                                            }
                                        }
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
        var action;
        if(finiteFloat.value(now)) {
            action = timeout.value(now);
            if(action.notNil) {
                action
            } {
                if(state == \running and: {
                    windExpiresAt.notNil and: { now >= windExpiresAt }
                }) {
                    windExpiresAt = nil;
                    (type: \windMute)
                } {
                    nil
                }
            }
        } {
            nil
        }
    };

    snapshot = {
        (
            state: state,
            lastSeq: lastSeq,
            acceptedPlucks: acceptedPlucks,
            acceptedFlocks: acceptedFlocks,
            rejected: rejected,
            rateDropped: rateDropped,
            sparseDropped: sparseDropped
        )
    };

    (handle: handle, tick: tick, snapshot: snapshot)
}
)
