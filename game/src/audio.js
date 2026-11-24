// Sound from nothing: every effect is synthesized with the Web Audio API — short oscillator
// blips and filtered noise bursts — so the game ships no audio files. The context is created
// lazily on the first user gesture (browsers refuse sound before one), and every call is a
// no-op until then, which also keeps the headless screenshot runs silent and safe.

export function createAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenFlip = 0;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, dur, type, gain, slideTo) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, gain, freq) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(t);
  }

  function startLoop(kind) {
    if (!ensure()) return null;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    amp.gain.value = 0;
    osc.connect(amp).connect(ctx.destination);
    osc.start();
    return { osc, amp };
  }

  return {
    /** Call from any user gesture so later effects are allowed to sound. */
    unlock() {
      ensure();
    },
    pickup() {
      tone(880, 0.09, 'square', 0.05);
      setTimeout(() => tone(1320, 0.12, 'square', 0.05), 45);
    },
    cash() {
      tone(1175, 0.07, 'triangle', 0.07);
      setTimeout(() => tone(1568, 0.1, 'triangle', 0.07), 55);
    },
    punch() {
      noise(0.08, 0.16, 900);
    },
    shot() {
      noise(0.13, 0.22, 2600);
      tone(160, 0.1, 'sawtooth', 0.1, 60);
    },
    dry() {
      tone(2200, 0.04, 'square', 0.04);
    },
    hurt() {
      tone(140, 0.16, 'sawtooth', 0.12, 70);
    },
    crash() {
      noise(0.22, 0.2, 700);
    },
    enter() {
      tone(392, 0.07, 'triangle', 0.06);
      setTimeout(() => tone(523, 0.09, 'triangle', 0.06), 60);
    },
    mission() {
      tone(659, 0.11, 'triangle', 0.08);
      setTimeout(() => tone(784, 0.11, 'triangle', 0.08), 100);
      setTimeout(() => tone(1047, 0.18, 'triangle', 0.08), 200);
    },
    dialogue() {
      tone(740, 0.05, 'square', 0.03);
    },
    busted() {
      tone(330, 0.5, 'sawtooth', 0.1, 110);
    },
    wasted() {
      tone(220, 0.8, 'sawtooth', 0.12, 55);
    },
    /**
     * Per-frame ambience: the player's engine note (ratio 0..1, or null when on foot) and the
     * nearest siren (distance in px, or null when no officer is close).
     */
    update(engineRatio, sirenDist) {
      if (!ctx) return;
      if (engineRatio !== null && engineRatio !== undefined) {
        if (!engineOsc) {
          const loop = startLoop('engine');
          if (!loop) return;
          engineOsc = loop.osc;
          engineGain = loop.amp;
          engineOsc.type = 'sawtooth';
        }
        engineOsc.frequency.value = 42 + engineRatio * 105;
        engineGain.gain.value = 0.028;
      } else if (engineGain) {
        engineGain.gain.value = 0;
      }
      if (sirenDist !== null && sirenDist !== undefined && sirenDist < 760) {
        if (!sirenOsc) {
          const loop = startLoop('siren');
          if (!loop) return;
          sirenOsc = loop.osc;
          sirenGain = loop.amp;
          sirenOsc.type = 'triangle';
        }
        sirenFlip += 1;
        if (sirenFlip % 22 === 0) sirenOsc.frequency.value = sirenOsc.frequency.value > 800 ? 660 : 920;
        sirenGain.gain.value = 0.016 * (1 - sirenDist / 800);
      } else if (sirenGain) {
        sirenGain.gain.value = 0;
      }
    },
  };
}
