(
var assert, assertEqual, assertNear, assertNil, assertThrows, session, policyPath, factory;
var p, action, snapshot, nan;

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

    "PASS: sound/tests/policy.scd".postln;
    0.exit;
} { |error|
    error.reportError;
    1.exit;
};
)
