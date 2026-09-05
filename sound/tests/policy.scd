(
var assert, assertEqual, assertNear, assertNil, assertThrows, session, policyPath, factory;
var p, action, snapshot, nan;
var ingressCases, ingressFailures = 0;

assert = { |condition, message|
    if(condition.not) { Error("ASSERTION FAILED: " ++ message).throw };
};

assertEqual = { |actual, expected, message|
    assert.value(actual == expected, message ++ " (actual: " ++ actual ++ ", expected: " ++ expected ++ ")");
};

assertNear = { |actual, expected, tolerance, message|
    assert.value((actual - expected).abs <= tolerance, message ++ " (actual: " ++ actual ++ ", expected: " ++ expected ++ ")");
};

assertNil = { |actual, message|
    assert.value(actual.isNil, message ++ " (actual: " ++ actual ++ ")");
};

assertThrows = { |function, message|
    var threw = false;
    try { function.value } { threw = true };
    assert.value(threw, message);
};

session = "0123456789abcdef0123456789abcdef";
policyPath = thisProcess.nowExecutingPath.dirname +/+ "../policy.scd";
nan = Float.from32Bits(16r7fc00000);

try {
    factory = policyPath.load;
    assert.value(factory.isKindOf(Function), "policy.scd must evaluate to a factory Function");

    // Explicit start is required, and string sessions compare by value.
    p = factory.value(session);
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session.copy, 1, 10.0], 10.0), "heartbeat before start must be rejected");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/cursor", session.copy, 1, 10.0, 0.5, 0.5, 0.5], 10.0), "cursor before start must be rejected");
    snapshot = p.at(\snapshot).value;
    assertEqual.value(snapshot.at(\state), \idle, "pre-start traffic must not change state");
    assertEqual.value(snapshot.at(\lastSeq), 0, "pre-start traffic must not advance sequence");
    assertEqual.value(snapshot.at(\rejected), 2, "pre-start traffic must increment rejected");
    action = p.at(\handle).value(["/janvim/sound/v1/start", session.copy, 1, 10.0], 10.0);
    assertEqual.value(action.at(\type), \start, "valid start must emit start action");
    assertEqual.value(p.at(\snapshot).value.at(\state), \running, "valid start must enter running state");

    // Shape, type, finite, session, path, and timing checks happen before mutation.
    p = factory.value(session);
    action = p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 100.0], 100.0);
    assertEqual.value(action.at(\type), \start, "validation fixture must start");
    assertNil.value(p.at(\handle).value("not-an-array", 100.0), "message must be an Array");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2, 100.0, 0.0], 100.0), "heartbeat exact length must be enforced");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/unknown", session, 2, 100.0], 100.0), "path allowlist must be enforced");
    assertNil.value(p.at(\handle).value([\notAString, session, 2, 100.0], 100.0), "path type must be enforced");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", "ffffffffffffffffffffffffffffffff", 2, 100.0], 100.0), "session must match by value");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2.0, 100.0], 100.0), "sequence must be an Integer");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 0, 100.0], 100.0), "sequence must be positive");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2, 100], 100.0), "sentAt must be a Float");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2, nan], 100.0), "NaN sentAt must be rejected");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2, inf], 100.0), "infinite sentAt must be rejected");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2, 99.499], 100.0), "packet older than 0.5 seconds must be rejected");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2, 100.101], 100.0), "packet over 0.1 seconds in future must be rejected");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/cursor", session, 2, 100.0, 1, 0.5, 0.5], 100.0), "cursor features must be Floats");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/cursor", session, 2, 100.0, nan, 0.5, 0.5], 100.0), "cursor features must be finite");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/flock", session, 2, 100.0, 0.5, inf], 100.0), "flock features must be finite");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2, 100.0], inf), "receiver time must be finite");
    snapshot = p.at(\snapshot).value;
    assertEqual.value(snapshot.at(\lastSeq), 1, "invalid packets must not advance sequence");
    assertEqual.value(snapshot.at(\rejected), 16, "each invalid packet must be counted");

    // Stale/future boundaries are inclusive; duplicates and out-of-order packets are rejected.
    p = factory.value(session);
    p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 20.0], 20.0);
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2, 19.5], 20.0), "accepted heartbeat has no synthesis action");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 3, 20.1], 20.0), "accepted heartbeat at future boundary has no synthesis action");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 3, 20.0], 20.0), "duplicate sequence must be rejected");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2, 20.0], 20.0), "out-of-order sequence must be rejected");
    assertEqual.value(p.at(\snapshot).value.at(\lastSeq), 3, "rejected order violations must not mutate sequence");

    // Cursor values clamp, map to MIDI/pan endpoints, and obey >= 0.125 spacing.
    p = factory.value(session);
    p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 30.0], 30.0);
    action = p.at(\handle).value(["/janvim/sound/v1/cursor", session, 2, 30.0, -1.0, -1.0, -1.0], 30.0);
    assertEqual.value(action.at(\type), \pluck, "cursor must emit pluck");
    assertEqual.value(action.at(\midi), 48, "low y endpoint must select MIDI 48");
    assertNear.value(action.at(\motion), 0.0, 0.000001, "motion must clamp low");
    assertNear.value(action.at(\pan), -0.8, 0.000001, "x must clamp and map to left pan");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/cursor", session, 3, 30.124, 0.5, 0.5, 0.5], 30.124), "cursor inside spacing must be dropped");
    action = p.at(\handle).value(["/janvim/sound/v1/cursor", session, 4, 30.125, 2.0, 2.0, 2.0], 30.125);
    assertEqual.value(action.at(\midi), 72, "high y endpoint must select MIDI 72");
    assertNear.value(action.at(\motion), 1.0, 0.000001, "motion must clamp high");
    assertNear.value(action.at(\pan), 0.8, 0.000001, "x must clamp and map to right pan");
    snapshot = p.at(\snapshot).value;
    assertEqual.value(snapshot.at(\lastSeq), 4, "rate-dropped packet must advance valid sequence");
    assertEqual.value(snapshot.at(\acceptedPlucks), 2, "accepted plucks must be counted");
    assertEqual.value(snapshot.at(\rateDropped), 1, "rate-dropped cursor must be counted");

    // Flock values clamp/map and obey >= 0.05 spacing independently.
    p = factory.value(session);
    p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 40.0], 40.0);
    action = p.at(\handle).value(["/janvim/sound/v1/flock", session, 2, 40.0, -1.0, 2.0], 40.0);
    assertEqual.value(action.at(\type), \wind, "flock must emit wind");
    assertNear.value(action.at(\energy), 0.0, 0.000001, "energy must clamp low");
    assertNear.value(action.at(\pan), 0.8, 0.000001, "centroid must clamp and map right");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/flock", session, 3, 40.049, 0.5, 0.5], 40.049), "flock inside spacing must be dropped");
    action = p.at(\handle).value(["/janvim/sound/v1/flock", session, 4, 40.05, 2.0, -1.0], 40.05);
    assertNear.value(action.at(\energy), 1.0, 0.000001, "energy must clamp high");
    assertNear.value(action.at(\pan), -0.8, 0.000001, "centroid must clamp and map left");
    snapshot = p.at(\snapshot).value;
    assertEqual.value(snapshot.at(\acceptedFlocks), 2, "accepted flocks must be counted");
    assertEqual.value(snapshot.at(\rateDropped), 1, "rate-dropped flock must be counted");

    // Only valid start/heartbeat refresh the lease; timeout is checked before late traffic.
    p = factory.value(session);
    p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 50.0], 50.0);
    p.at(\handle).value(["/janvim/sound/v1/cursor", session, 2, 51.9, 0.5, 0.5, 0.5], 51.9);
    action = p.at(\tick).value(52.0);
    assertEqual.value(action.at(\type), \stop, "cursor traffic must not prevent timeout");
    assertEqual.value(action.at(\reason), \heartbeatTimeout, "timeout stop must identify reason");
    assertNil.value(p.at(\tick).value(53.0), "timeout stop must emit once");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/start", session, 3, 53.0], 53.0), "start must not resurrect stopped policy");

    p = factory.value(session);
    p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 300.0], 300.0);
    p.at(\handle).value(["/janvim/sound/v1/cursor", session, 2, 301.9, 0.5, 0.5, 0.5], 301.9);
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/cursor", session, 3, 301.99, 0.5, 0.5, 0.5], 301.99), "cursor just before expiry must be rate-dropped");
    action = p.at(\tick).value(302.0);
    assertEqual.value(action.at(\reason), \heartbeatTimeout, "rate-dropped packet must not refresh lease");
    snapshot = p.at(\snapshot).value;
    assertEqual.value(snapshot.at(\lastSeq), 3, "rate-dropped packet before expiry must advance sequence");
    assertEqual.value(snapshot.at(\rateDropped), 1, "rate-dropped packet before expiry must be counted");

    p = factory.value(session);
    p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 60.0], 60.0);
    action = p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2, 62.0], 62.0);
    assertEqual.value(action.at(\type), \stop, "late heartbeat must trigger timeout before admission");
    assertEqual.value(action.at(\reason), \heartbeatTimeout, "late heartbeat timeout reason must be stable");
    assertEqual.value(p.at(\snapshot).value.at(\lastSeq), 1, "late heartbeat must not advance sequence");

    p = factory.value(session);
    p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 80.0], 80.0);
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2, 81.9], 81.9), "valid heartbeat must have no synthesis action");
    assertNil.value(p.at(\tick).value(83.899), "valid heartbeat must refresh lease");
    action = p.at(\tick).value(83.9);
    assertEqual.value(action.at(\reason), \heartbeatTimeout, "refreshed lease must expire at two seconds");

    // Explicit stop latches terminal state and is idempotent.
    p = factory.value(session);
    p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 70.0], 70.0);
    action = p.at(\handle).value(["/janvim/sound/v1/stop", session, 2, 70.1], 70.1);
    assertEqual.value(action.at(\type), \stop, "explicit stop must emit stop action");
    assertEqual.value(action.at(\reason), \requested, "explicit stop must identify reason");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/stop", session, 3, 70.2], 70.2), "repeated stop must not emit twice");
    assertNil.value(p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 4, 70.3], 70.3), "heartbeat must not resurrect stopped policy");
    assertEqual.value(p.at(\snapshot).value.at(\state), \stopped, "stop must remain terminal");

    // Snapshot is bounded and detached from mutable policy state.
    snapshot = p.at(\snapshot).value;
    assertEqual.value(snapshot.size, 6, "snapshot must expose only bounded counters/state");
    snapshot.put(\lastSeq, 999999);
    snapshot.put(\rejected, 999999);
    snapshot = p.at(\snapshot).value;
    assertEqual.value(snapshot.at(\lastSeq), 2, "snapshot mutation must not change policy sequence");
    assert.value(snapshot.at(\rejected) < 999999, "snapshot mutation must not change policy counters");

    // Validated counter seeds make int32 saturation reachable without billion-iteration tests.
    assertThrows.value({ factory.value(session, "not-an-event") }, "counter seed must be an Event");
    assertThrows.value({ factory.value(session, (acceptedPlucks: -1)) }, "counter seed must be nonnegative");
    assertThrows.value({ factory.value(session, (acceptedPlucks: 1.0)) }, "counter seed must use Integers");
    assertThrows.value({ factory.value(session, (unknownCounter: 0)) }, "counter seed must reject unknown keys");
    p = factory.value(session, (
        acceptedPlucks: 2147483646,
        acceptedFlocks: 2147483646,
        rejected: 2147483646,
        rateDropped: 2147483646
    ));
    p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 200.0], 200.0);
    p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2.0, 200.0], 200.0);
    p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, 2.0, 200.0], 200.0);
    p.at(\handle).value(["/janvim/sound/v1/cursor", session, 2, 200.0, 0.5, 0.5, 0.5], 200.0);
    p.at(\handle).value(["/janvim/sound/v1/cursor", session, 3, 200.01, 0.5, 0.5, 0.5], 200.01);
    p.at(\handle).value(["/janvim/sound/v1/cursor", session, 4, 200.02, 0.5, 0.5, 0.5], 200.02);
    p.at(\handle).value(["/janvim/sound/v1/cursor", session, 5, 200.125, 0.5, 0.5, 0.5], 200.125);
    p.at(\handle).value(["/janvim/sound/v1/flock", session, 6, 200.2, 0.5, 0.5], 200.2);
    p.at(\handle).value(["/janvim/sound/v1/flock", session, 7, 200.25, 0.5, 0.5], 200.25);
    snapshot = p.at(\snapshot).value;
    assertEqual.value(snapshot.at(\acceptedPlucks), 2147483647, "acceptedPlucks must saturate at int32 max");
    assertEqual.value(snapshot.at(\acceptedFlocks), 2147483647, "acceptedFlocks must saturate at int32 max");
    assertEqual.value(snapshot.at(\rejected), 2147483647, "rejected must saturate at int32 max");
    assertEqual.value(snapshot.at(\rateDropped), 2147483647, "rateDropped must saturate at int32 max");

    // Ten hours of fake-clock heartbeat activity is finite and wall-clock independent.
    p = factory.value(session);
    p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 0.0], 0.0);
    36000.do { |index|
        var now = (index + 1).asFloat;
        action = p.at(\handle).value(["/janvim/sound/v1/heartbeat", session, index + 2, now], now);
        assertNil.value(action, "accepted heartbeat must not emit synthesis action");
    };
    snapshot = p.at(\snapshot).value;
    assertEqual.value(snapshot.at(\state), \running, "10-hour fake-clock run must stay active");
    assertEqual.value(snapshot.at(\lastSeq), 36001, "10-hour fake-clock run must retain bounded sequence state");

    // Real production policy, explicit fake times. Each case names the break it catches.
    ingressCases = [
        ["new paths remain disabled by default", {
            [factory.value(session), factory.value(session, nil, false)].do { |old|
                old.at(\handle).value(["/janvim/sound/v1/start", session, 1, 10.0], 10.0);
                assertNil.value(old.at(\handle).value(["/janvim/sound/v1/flock-live", session, 2, 10.0, 1, 1, 0.7, 0.2, 10.5], 10.0), "old mode rejects live");
                assertNil.value(old.at(\handle).value(["/janvim/sound/v1/flock-mute", session, 2, 10.0, 1, 2], 10.0), "old mode rejects mute");
                assertEqual.value(old.at(\snapshot).value.at(\lastSeq), 1, "disabled paths cannot consume sequence");
                assertEqual.value(old.at(\snapshot).value.at(\rejected), 2, "both disabled paths rejected");
                action = old.at(\handle).value(["/janvim/sound/v1/flock", session, 2, 10.0, 0.7, 0.2], 10.0);
                assertEqual.value(action.tryPerform(\at, \type), \wind, "legacy flock still works");
                assertNil.value(old.at(\tick).value(10.6), "legacy wind has no new deadline");
            };
        }],
        ["490ms age retains only 10ms and expires exactly once", {
            p = factory.value(session, nil, true);
            p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 10.0], 10.0);
            action = p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 2, 10.49, 1, 1, 0.7, 0.2, 10.5], 10.49);
            assertEqual.value(action.tryPerform(\at, \type), \wind, "fresh remaining10ms");
            assertNear.value(action.at(\energy), 0.7, 0.000001, "live energy preserved");
            assertNear.value(action.at(\pan), -0.48, 0.000001, "live centroid maps to existing pan");
            assertNil.value(p.at(\tick).value(10.499), "before original deadline");
            action = p.at(\tick).value(10.5);
            assertEqual.value(action.tryPerform(\at, \type), \windMute, "expire without new packet");
            assertNil.value(p.at(\tick).value(10.51), "mute once");
            assertEqual.value(p.at(\snapshot).value.at(\state), \running, "wind expiry leaves show running");
        }],
        ["expired arrival is rejected before consuming sequence or watermark", {
            p = factory.value(session, nil, true);
            p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 10.0], 10.0);
            assertNil.value(p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 2, 10.49, 9, 99, 0.7, 0.2, 10.5], 10.5), "exactdeadline rejected");
            assertEqual.value(p.at(\snapshot).value.at(\lastSeq), 1, "expired packet cannot advance global sequence");
            action = p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 2, 10.5, 1, 1, 0.7, 0.2, 11.0], 10.5);
            assertEqual.value(action.tryPerform(\at, \type), \wind, "invalid watermark cannot poison next live");
            assertEqual.value(p.at(\tick).value(11.0).tryPerform(\at, \type), \windMute, "accepted originaldeadline expires");
        }],
        ["live and mute validate shape fields and global timing before mutation", {
            var live, mute, malformed;
            p = factory.value(session, nil, true);
            p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 20.0], 20.0);
            live = ["/janvim/sound/v1/flock-live", session, 2, 20.0, 1, 1, 0.7, 0.2, 20.5];
            mute = ["/janvim/sound/v1/flock-mute", session, 2, 20.0, 1, 1];
            malformed = [live.copyRange(0, 7), live.copy.add(0), mute.copyRange(0, 4), mute.copy.add(0)];
            // SC Integers are int32: an out-of-range decimal integer literal
            // saturates during parsing. Use a Float to carry the overflow value.
            [[4, 0], [4, -1], [4, 1.0], [4, 2147483648.0], [5, 0], [5, 1.0], [5, 2147483648.0],
                [6, -0.01], [6, 1.01], [6, 1], [6, nan], [7, -0.01], [7, 1.01], [7, inf],
                [8, nan], [8, inf], [8, 21], [8, 20.501], [8, 20.0],
                [1, "wrong"], [2, 2.0], [2, 2147483648.0], [3, 19.499], [3, 20.101]
            ].do { |pair| malformed = malformed.add(live.copy.put(pair.at(0), pair.at(1))) };
            [[4, 0], [4, 1.0], [5, -1], [5, 1.0], [5, 2147483648.0], [3, nan], [3, 19.499]
            ].do { |pair| malformed = malformed.add(mute.copy.put(pair.at(0), pair.at(1))) };
            malformed.do { |msg, index| assertNil.value(p.at(\handle).value(msg, 20.0), "malformed ingress rejected index " ++ index ++ " " ++ msg) };
            assertEqual.value(p.at(\snapshot).value.at(\rejected), malformed.size, "all malformed packets rejected");
            assertEqual.value(p.at(\snapshot).value.at(\lastSeq), 1, "malformed packets leave sequence alone");
            assertEqual.value(p.at(\handle).value(live, 20.0).tryPerform(\at, \type), \wind, "valid packet still admitted");
        }],
        ["new ingress requires start and preserves second argument counter seeds", {
            p = factory.value(session, (acceptedFlocks: 7), true);
            assertNil.value(p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 1, 10.0, 1, 1, 0.7, 0.2, 10.5], 10.0), "prestart live rejected");
            assertNil.value(p.at(\handle).value(["/janvim/sound/v1/flock-mute", session, 1, 10.0, 1, 1], 10.0), "prestart mute rejected");
            assertEqual.value(p.at(\snapshot).value.at(\lastSeq), 0, "prestart cannot advance sequence");
            p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 10.0], 10.0);
            assertEqual.value(p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 2, 10.0, 1, 1, 0.7, 0.2, 10.5], 10.0).tryPerform(\at, \type), \wind, "enabled fixture starts");
            assertEqual.value(p.at(\snapshot).value.at(\acceptedFlocks), 8, "seed remains second argument");
        }],
        ["new epoch and mute cannot be lost inside legacy 50ms spacing", {
            p = factory.value(session, nil, true);
            p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 30.0], 30.0);
            assertEqual.value(p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 2, 30.0, 1, 1, 0.7, 0.2, 30.5], 30.0).tryPerform(\at, \type), \wind, "first live");
            action = p.at(\handle).value(["/janvim/sound/v1/flock-mute", session, 3, 30.001, 2, 2], 30.001);
            assertEqual.value(action.tryPerform(\at, \type), \windMute, "new epoch mute immediate");
            assertNil.value(p.at(\tick).value(30.5), "mute clears outstanding expiry");
            action = p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 4, 30.501, 2, 3, 0.0, 1.0, 31.001], 30.501);
            assertEqual.value(action.tryPerform(\at, \type), \wind, "zero energy is still live not mute");
            action = p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 5, 30.502, 3, 4, 0.9, 0.8, 30.9], 30.502);
            assertEqual.value(action.tryPerform(\at, \type), \wind, "new epoch live immediate");
            action = p.at(\handle).value(["/janvim/sound/v1/flock-mute", session, 6, 30.503, 3, 5], 30.503);
            assertEqual.value(action.tryPerform(\at, \type), \windMute, "same epoch mute immediate");
        }],
        ["old epoch revision or UDP global sequence cannot undo newer mute", {
            p = factory.value(session, nil, true);
            p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 40.0], 40.0);
            assertEqual.value(p.at(\handle).value(["/janvim/sound/v1/flock-mute", session, 4, 40.0, 2, 4], 40.0).tryPerform(\at, \type), \windMute, "mute can be first received UDP state");
            [[5, 1, 5], [5, 2, 3], [5, 2, 4], [5, 3, 3], [3, 3, 5]].do { |fields|
                assertNil.value(p.at(\handle).value(["/janvim/sound/v1/flock-live", session, fields.at(0), 40.01, fields.at(1), fields.at(2), 0.7, 0.2, 40.5], 40.01), "stale live rejected");
            };
            assertNil.value(p.at(\handle).value(["/janvim/sound/v1/flock-mute", session, 5, 40.01, 1, 5], 40.01), "stale epoch mute rejected");
            assertEqual.value(p.at(\snapshot).value.at(\lastSeq), 4, "rejected ordering cannot mutate sequence");
            assertNil.value(p.at(\tick).value(40.5), "rejected live cannot arm expiry");
            assertEqual.value(p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 5, 40.51, 3, 5, 0.7, 0.2, 41.0], 40.51).tryPerform(\at, \type), \wind, "fresh monotonic watermark admitted");
        }],
        ["new live replaces deadline and late mute cannot clear replacement", {
            p = factory.value(session, nil, true);
            p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 50.0], 50.0);
            p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 2, 50.0, 1, 1, 0.7, 0.2, 50.5], 50.0);
            assertEqual.value(p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 4, 50.1, 2, 3, 0.8, 0.2, 50.6], 50.1).tryPerform(\at, \type), \wind, "replacement accepted");
            assertNil.value(p.at(\handle).value(["/janvim/sound/v1/flock-mute", session, 5, 50.2, 1, 2], 50.2), "late mute rejected");
            assertNil.value(p.at(\tick).value(50.5), "old deadline cannot mute replacement");
            assertEqual.value(p.at(\tick).value(50.6).tryPerform(\at, \type), \windMute, "replacement deadline retained");
        }],
        ["live and mute never renew two second Show lease", {
            ["/janvim/sound/v1/flock-live", "/janvim/sound/v1/flock-mute"].do { |path|
                var msg = [path, session, 2, 61.9, 1, 1];
                p = factory.value(session, nil, true);
                p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 60.0], 60.0);
                if(path.endsWith("live")) { msg = msg ++ [0.7, 0.2, 62.0] };
                assert.value(p.at(\handle).value(msg, 61.9).notNil, "lease fixture traffic accepted");
                action = p.at(\tick).value(62.0);
                assertEqual.value(action.tryPerform(\at, \type), \stop, "global timeout wins even at wind deadline");
                assertEqual.value(action.at(\reason), \heartbeatTimeout, "data cannot renew heartbeat");
                assertNil.value(p.at(\tick).value(62.1), "no delayed wind mute after globalstop");
            };
        }],
        ["whole Stop stays terminal even at a pending wind deadline", {
            p = factory.value(session, nil, true);
            p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 70.0], 70.0);
            assertEqual.value(p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 2, 70.0, 1, 1, 0.7, 0.2, 70.5], 70.0).tryPerform(\at, \type), \wind, "stop fixture live");
            action = p.at(\handle).value(["/janvim/sound/v1/stop", session, 3, 70.5], 70.5);
            assertEqual.value(action.tryPerform(\at, \type), \stop, "explicit Stop outranks wind expiry");
            assertNil.value(p.at(\tick).value(70.6), "Stop cannot later shorten fade via windMute");
            assertNil.value(p.at(\handle).value(["/janvim/sound/v1/flock-live", session, 4, 70.6, 2, 2, 0.7, 0.2, 71.0], 70.6), "live cannot revive stopped show");
            assertNil.value(p.at(\handle).value(["/janvim/sound/v1/flock-mute", session, 5, 70.6, 2, 3], 70.6), "mute cannot alter stopped show");
        }],
        ["enabled legacy flock keeps its clamp and rate behavior", {
            p = factory.value(session, nil, true);
            p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 80.0], 80.0);
            action = p.at(\handle).value(["/janvim/sound/v1/flock", session, 2, 80.0, -1.0, 2.0], 80.0);
            assertNear.value(action.at(\energy), 0.0, 0.000001, "legacy clamp preserved");
            assertNear.value(action.at(\pan), 0.8, 0.000001, "legacy pan preserved");
            assertNil.value(p.at(\handle).value(["/janvim/sound/v1/flock", session, 3, 80.001, 0.5, 0.5], 80.001), "legacy rate remains");
            assertNil.value(p.at(\tick).value(80.6), "legacy has no ingress expiry");
        }]
    ];
    ingressCases.do { |entry|
        try {
            entry.at(1).value;
            ("PASS ingress: " ++ entry.at(0)).postln;
        } { |error|
            ingressFailures = ingressFailures + 1;
            ("FAIL ingress: " ++ entry.at(0)).postln;
            error.errorString.postln;
        };
    };
    ("INGRESS RESULTS: " ++ (ingressCases.size - ingressFailures) ++ " passed, " ++ ingressFailures ++ " failed").postln;
    assertEqual.value(ingressFailures, 0, "all ingress policy cases pass");
    "PASS: sound/tests/policy.scd".postln;
    0.exit;
} { |error|
    error.reportError;
    1.exit;
};
)
