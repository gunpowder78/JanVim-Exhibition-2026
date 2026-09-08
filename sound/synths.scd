(
{
    [
        SynthDef(\jvPluck, { |outBus = 16, midi = 60, motion = 0.5, pan = 0, gain = 1|
            var safeMidi, safeMotion, safePan, safeGain, trigger, delay, excitation, body, envelope;

            safeMidi = midi.clip(36, 96);
            safeMotion = motion.clip(0, 1);
            safePan = pan.clip(-0.8, 0.8);
            safeGain = Lag.kr(gain.clip(0.0630957, 1.9952623), 0.05);
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
            Out.ar(outBus, Pan2.ar(body * envelope * safeGain, safePan));
        }),

        SynthDef(\jvWind, { |outBus = 16, energy = 0, pan = 0, gate = 1, gain = 1|
            var safeEnergy, safePan, safeGain, amplitude, center, source, envelope;

            safeEnergy = Lag.kr(energy.clip(0, 1), 0.5);
            safePan = Lag.kr(pan.clip(-0.8, 0.8), 0.5);
            safeGain = Lag.kr(gain.clip(0.0630957, 1.9952623), 0.05);
            amplitude = 0.015 + (safeEnergy * 0.35);
            center = Lag.kr(350 + (safeEnergy * 1650), 0.6);
            source = BPF.ar(PinkNoise.ar(amplitude), center, 0.45);
            envelope = EnvGen.kr(
                Env.asr(0.2, 1, 0.3, curve: -4),
                gate.clip(0, 1),
                doneAction: Done.freeSelf
            );
            Out.ar(outBus, Pan2.ar(source * envelope * safeGain, safePan));
        }),

        SynthDef(\jvSignalCall, { |outBus = 16, duration = 7, freq = 165, pan = 0,
            seed = 1, gain = 1|
            var envelope, pitch, vibrato, modulation, tone, breath, position, safeGain;
            RandSeed.ir(1, seed);
            safeGain = Lag.kr(gain.clip(0.0630957, 1.9952623), 0.05);
            envelope = EnvGen.kr(Env([0, 0.85, 1, 0.35, 0],
                [0.25, 0.22, 0.25, 0.28] * duration, \sine), doneAction: Done.freeSelf);
            pitch = EnvGen.kr(Env([freq * 1.08, freq * 0.82, freq * 1.32, freq * 0.98],
                [0.36, 0.29, 0.35] * duration, \sine));
            vibrato = SinOsc.kr(4.1, 0, 0.004, 1);
            modulation = SinOsc.ar(pitch * 2.003, 0, 0.55 * (0.3 + envelope));
            tone = SinOsc.ar(pitch * vibrato, modulation) +
                (SinOsc.ar(pitch * 2.006, 0.4) * 0.13);
            breath = BPF.ar(PinkNoise.ar(1), pitch * 3.4, 0.4) * 0.11;
            position = Line.kr(pan.clip(-0.6, 0.6), pan.clip(-0.6, 0.6) * -0.6, duration);
            Out.ar(outBus, Pan2.ar(LPF.ar(tone + breath, 1800) * envelope * 0.08 * safeGain,
                position));
        }),

        SynthDef(\jvSignalAM, { |outBus = 16, duration = 2.7, pan = 0, seed = 1, gain = 1|
            var envelope, tuning, lock, chopped, static, whistle, station, signal, safeGain;
            RandSeed.ir(1, seed);
            safeGain = Lag.kr(gain.clip(0.0630957, 1.9952623), 0.05);
            envelope = EnvGen.kr(Env([0, 1, 0.72, 0.92, 0],
                [0.025, 0.32, 0.60, 0.055] * duration, \sine), doneAction: Done.freeSelf);
            tuning = EnvGen.kr(Env([2500, 1580, 240, 940, 3100, 560],
                [0.15, 0.24, 0.18, 0.16, 0.27] * duration, \lin));
            lock = (-1 * ((tuning - 850) / 160).squared).exp;
            chopped = LFNoise0.kr(24).range(0.08, 1).lag(0.006);
            static = LPF.ar(HPF.ar(WhiteNoise.ar(0.40), 330), 3800) * chopped *
                (1 - (lock * 0.85));
            whistle = SinOsc.ar(tuning, SinOsc.ar(39, 0, 0.24), 0.039) * (1 - lock);
            station = BPF.ar(Pulse.ar(137, 0.34), 1050, 0.55) * lock * 0.065;
            signal = LPF.ar(HPF.ar(static + whistle + station, 260), 4100);
            Out.ar(outBus, Pan2.ar(signal * envelope * 0.22 * safeGain, pan.clip(-0.6, 0.6)));
        }),

        SynthDef(\jvSignalFlint, { |outBus = 16, scale = 1, pan = 0, seed = 1, gain = 1|
            var impulse, delayed, strike, stone, chips, thud, life, safeGain;
            RandSeed.ir(1, seed);
            safeGain = Lag.kr(gain.clip(0.0630957, 1.9952623), 0.05);
            impulse = Impulse.ar(0);
            delayed = impulse + (DelayN.ar(impulse, 0.8, 0.43) * 0.72) +
                (DelayN.ar(impulse, 0.8, 0.67) * 0.48);
            strike = WhiteNoise.ar(0.7) * Decay2.ar(delayed, 0.0003, 0.006);
            stone = (Ringz.ar(strike, [970, 1840, 3230, 5160] * scale,
                [0.018, 0.013, 0.009, 0.006]) * [0.8, 0.5, 0.26, 0.12]).sum * 0.095;
            chips = BPF.ar(DelayC.ar(strike, 0.1, 0.017), 3200 * scale, 0.65) * 0.27;
            thud = SinOsc.ar(XLine.kr(245, 172, 0.72), 0, 0.10) *
                Decay2.ar(delayed, 0.001, 0.038);
            life = EnvGen.kr(Env.linen(0.0005, 0.78, 0.12), doneAction: Done.freeSelf);
            Out.ar(outBus, Pan2.ar(LPF.ar(HPF.ar(stone + chips + thud, 140), 6200) *
                life * 0.34 * safeGain, pan.clip(-0.7, 0.7)));
        }),

        SynthDef(\jvSignalRelic, { |outBus = 16, midi = 50, pan = 0, seed = 1, gain = 1|
            var trigger, frequency, excitation, string, envelope, safeGain;
            RandSeed.ir(1, seed);
            safeGain = Lag.kr(gain.clip(0.0630957, 1.9952623), 0.05);
            trigger = Impulse.ar(0);
            frequency = midi.clip(36, 84).midicps;
            excitation = PinkNoise.ar(1.5) * Decay2.ar(trigger, 0.001, 0.026);
            string = Pluck.ar(excitation, trigger, 0.05, frequency.reciprocal, 4.8, 0.52);
            envelope = EnvGen.kr(Env.perc(0.003, 6.2, curve: -3),
                doneAction: Done.freeSelf);
            Out.ar(outBus, Pan2.ar(LPF.ar(string, 3300) * envelope * 0.72 * safeGain,
                pan.clip(-0.6, 0.6)));
        }),

        SynthDef(\jvSignalEarth, { |outBus = 16, duration = 5.2, pan = 0,
            seed = 1, gain = 1|
            var envelope, rubble, uneven, tectonic, signal, safeGain;
            RandSeed.ir(1, seed);
            safeGain = Lag.kr(gain.clip(0.0630957, 1.9952623), 0.05);
            envelope = EnvGen.kr(Env([0, 0.6, 1, 0.3, 0],
                [0.13, 0.22, 0.29, 0.36] * duration, \sine), doneAction: Done.freeSelf);
            uneven = LFNoise1.kr(7).range(0.25, 1);
            rubble = BPF.ar(BrownNoise.ar(1), [75, 148, 265], [0.65, 0.4, 0.3]).sum *
                uneven * 0.55;
            tectonic = SinOsc.ar(43.5 + LFNoise1.kr(2).range(-3.5, 3.5), 0, 0.095) +
                (SinOsc.ar(89, 0, 0.045) * LFNoise1.kr(4).range(0.45, 1));
            signal = LPF.ar(HPF.ar(rubble + tectonic, 30), 350);
            Out.ar(outBus, Pan2.ar(signal * envelope * 0.23 * safeGain,
                pan.clip(-0.2, 0.2)));
        }),

        SynthDef(\jvSignalBlade, { |outBus = 16, duration = 2.2, freq = 790,
            pan = 0, seed = 1, gain = 1|
            var envelope, bend, metal, draw, position, safeGain;
            RandSeed.ir(1, seed);
            safeGain = Lag.kr(gain.clip(0.0630957, 1.9952623), 0.05);
            envelope = EnvGen.kr(Env([0, 1, 0.23, 0],
                [0.025, 0.23, 0.745] * duration, [-2, -3, -5]), doneAction: Done.freeSelf);
            bend = EnvGen.kr(Env([0.86, 1.065, 1], [0.13, 0.87] * duration, \sine));
            metal = (SinOsc.ar(freq * bend * [1, 1.43, 2.39, 3.86],
                [0, 0.3, 0.9, 1.2]) * [1, 0.33, 0.16, 0.06]).sum;
            draw = BPF.ar(WhiteNoise.ar(1), 2700, 0.25) *
                EnvGen.kr(Env.perc(0.014, 0.16)) * 0.16;
            position = Line.kr(pan.clip(-0.7, 0.7) * -1, pan.clip(-0.7, 0.7), 0.45);
            Out.ar(outBus, Pan2.ar(LPF.ar(metal + draw, 3900) * envelope *
                0.055 * safeGain, position));
        }),

        SynthDef(\jvSignalBass, { |outBus = 16, duration = 3.3, midi = 28,
            seed = 1, gain = 1|
            var frequency, pitch, envelope, harmonics, cutoff, body, click, safeGain;
            RandSeed.ir(1, seed);
            safeGain = Lag.kr(gain.clip(0.0630957, 1.9952623), 0.05);
            frequency = midi.clip(24, 40).midicps;
            pitch = EnvGen.kr(Env([frequency * 1.13, frequency, frequency * 0.993],
                [0.065, duration - 0.065], [-5, -1]));
            envelope = EnvGen.kr(Env([0, 1, 0.78, 0],
                [0.015, duration * 0.21, duration * 0.79 - 0.015], [-2, -2, -4]),
                doneAction: Done.freeSelf);
            harmonics = SinOsc.ar(pitch) + (SinOsc.ar(pitch * 2.001) * 0.31) +
                (LFTri.ar(pitch) * 0.22) + (Pulse.ar(pitch, 0.42) * 0.08);
            cutoff = XLine.kr(760, 145, duration);
            body = RLPF.ar((harmonics * 1.6).tanh * 0.66, cutoff, 0.7);
            click = HPF.ar(PinkNoise.ar(1), 1100) * EnvGen.kr(Env.perc(0.001, 0.022)) * 0.023;
            Out.ar(outBus, Pan2.ar(HPF.ar(body + click, 30) * envelope * 0.11 * safeGain, 0));
        }),

        SynthDef(\jvSignalSpace, { |inBus = 16, outBus = 18|
            var input = In.ar(inBus, 2);
            Out.ar(outBus, FreeVerb2.ar(input.at(0), input.at(1), 0.23, 0.86, 0.62));
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

        SynthDef(\jvCapture, { |inBus = 18, bufnum = 0, mark = 0|
            RecordBuf.ar(
                In.ar(inBus, 2),
                bufnum,
                offset: 0,
                recLevel: 1,
                preLevel: 0,
                run: 1,
                loop: 0,
                trigger: 1,
                doneAction: Done.freeSelf
            );
            // Same node/block lifetime as RecordBuf. Report a conservative prefix
            // of acquired frames; the allocation's zero padding is not evidence.
            SendReply.kr(Impulse.kr(20), "/jv/capture-position", [
                (Sweep.kr(0, SampleRate.ir) - BlockSize.ir).max(0), mark
            ]);
        })
    ]
}
)
