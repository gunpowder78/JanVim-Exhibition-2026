(
{
    [
        SynthDef(\jvPluck, { |outBus = 16, midi = 60, motion = 0.5, pan = 0|
            var safeMidi, safeMotion, safePan, trigger, delay, excitation, body, envelope;

            safeMidi = midi.clip(36, 96);
            safeMotion = motion.clip(0, 1);
            safePan = pan.clip(-0.8, 0.8);
            trigger = Impulse.kr(0);
            delay = safeMidi.midicps.reciprocal;
            excitation = PinkNoise.ar(1.8) * Decay2.kr(trigger, 0.001, 0.035);
            body = Pluck.ar(
                excitation,
                trigger,
                0.05,
                delay,
                0.55 + (safeMotion * 1.45),
                0.45
            );
            envelope = EnvGen.kr(
                Env.perc(0.002, 0.65 + (safeMotion * 1.35), curve: -4),
                doneAction: Done.freeSelf
            );
            Out.ar(outBus, Pan2.ar(body * envelope, safePan));
        }),

        SynthDef(\jvWind, { |outBus = 16, energy = 0, pan = 0, gate = 1|
            var safeEnergy, safePan, amplitude, center, source, envelope;

            safeEnergy = Lag.kr(energy.clip(0, 1), 0.5);
            safePan = Lag.kr(pan.clip(-0.8, 0.8), 0.5);
            amplitude = 0.015 + (safeEnergy * 0.35);
            center = Lag.kr(350 + (safeEnergy * 1650), 0.6);
            source = BPF.ar(PinkNoise.ar(amplitude), center, 0.45);
            envelope = EnvGen.kr(
                Env.asr(0.2, 1, 0.3, curve: -4),
                gate.clip(0, 1),
                doneAction: Done.freeSelf
            );
            Out.ar(outBus, Pan2.ar(source * envelope, safePan));
        }),

        SynthDef(\jvMix, {
            |inBus = 16, outBus = 18, heartbeat = 0, armed = 0, stop = 0|
            var heartbeatTrigger, elapsed, leaseExpired, releaseLatched;
            var signal, limited, fade;

            heartbeatTrigger = Changed.kr(heartbeat) + Impulse.kr(0);
            elapsed = Sweep.kr(heartbeatTrigger, 1);
            leaseExpired = (armed > 0) * (elapsed >= 2);
            releaseLatched = SetResetFF.kr((stop > 0) + leaseExpired, 0);
            signal = LeakDC.ar(In.ar(inBus, 2));
            limited = Limiter.ar(signal, 0.2, 0.01);
            fade = EnvGen.kr(
                Env.asr(0.005, 1, 1.5, curve: -4),
                1 - releaseLatched,
                doneAction: Done.freeSelf
            );
            Out.ar(outBus, limited * fade);
        }),

        SynthDef(\jvOutput, { |inBus = 18, hardware = 0|
            Out.ar(0, In.ar(inBus, 2) * hardware.clip(0, 1));
        }),

        SynthDef(\jvCapture, { |inBus = 18, bufnum = 0|
            DiskOut.ar(bufnum, In.ar(inBus, 2));
        })
    ]
}
)
