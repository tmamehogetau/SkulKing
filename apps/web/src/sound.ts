const SOUND_KEY = "skulking.sound.v1";

export type SoundCue =
  | "turn"
  | "bid"
  | "card"
  | "trickWin"
  | "trickOther"
  | "trickDiscard"
  | "roundEnd"
  | "gameEnd";

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "off";
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, muted ? "off" : "on");
  } catch {
    // storage unavailable
  }
}

function getContext(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
    return ctx;
  } catch {
    return null;
  }
}

function getNoiseBuffer(ac: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer;
  const length = Math.floor(ac.sampleRate * 0.25);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buffer;
  return buffer;
}

function playTone(
  ac: AudioContext,
  opts: {
    freq: number;
    endFreq?: number;
    type?: OscillatorType;
    delay?: number;
    duration: number;
    gain: number;
  },
): void {
  const start = ac.currentTime + (opts.delay ?? 0);
  const stop = start + opts.duration;

  const osc = ac.createOscillator();
  const amp = ac.createGain();

  osc.type = opts.type ?? "triangle";
  osc.frequency.setValueAtTime(opts.freq, start);
  if (opts.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), stop);
  }

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(opts.gain, start + Math.min(0.015, opts.duration * 0.25));
  amp.gain.exponentialRampToValueAtTime(0.0001, stop);

  osc.connect(amp);
  amp.connect(ac.destination);
  osc.start(start);
  osc.stop(stop + 0.01);
}

function playPaperSnap(ac: AudioContext, delay = 0): void {
  const start = ac.currentTime + delay;
  const duration = 0.065;
  const src = ac.createBufferSource();
  src.buffer = getNoiseBuffer(ac);

  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1500, start);
  filter.Q.setValueAtTime(1.8, start);

  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(0.11, start + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  src.connect(filter);
  filter.connect(amp);
  amp.connect(ac.destination);
  src.start(start);
  src.stop(start + duration + 0.01);

  playTone(ac, {
    freq: 310,
    endFreq: 140,
    type: "sine",
    delay,
    duration: 0.045,
    gain: 0.06,
  });
}

export function unlockAudio(): void {
  getContext();
}

export function playSound(cue: SoundCue, muted: boolean): void {
  if (muted) return;
  const ac = getContext();
  if (!ac) return;

  try {
    switch (cue) {
      case "turn": {
        // 真鍮の短い2音ベル（D5 -> A5）
        playTone(ac, { freq: 587.33, type: "triangle", duration: 0.16, gain: 0.08 });
        playTone(ac, { freq: 880, type: "sine", delay: 0.08, duration: 0.26, gain: 0.09 });
        break;
      }
      case "bid": {
        // 金貨を置いた金属音
        playTone(ac, { freq: 1318.5, type: "sine", duration: 0.09, gain: 0.065 });
        playTone(ac, { freq: 1975.5, type: "triangle", delay: 0.03, duration: 0.16, gain: 0.06 });
        break;
      }
      case "card": {
        // 羊皮紙のカードを出す音
        playPaperSnap(ac);
        break;
      }
      case "trickWin": {
        // 自分がトリックを獲得したときの華やかな和音（D5 -> F#5 -> A5）
        playTone(ac, { freq: 587.33, type: "triangle", duration: 0.18, gain: 0.08 });
        playTone(ac, { freq: 739.99, type: "triangle", delay: 0.07, duration: 0.22, gain: 0.08 });
        playTone(ac, { freq: 880, type: "sine", delay: 0.14, duration: 0.32, gain: 0.095 });
        break;
      }
      case "trickOther": {
        // 他人がトリックを取ったときの控えめな2音
        playTone(ac, { freq: 440, type: "triangle", duration: 0.13, gain: 0.055 });
        playTone(ac, { freq: 523.25, type: "sine", delay: 0.06, duration: 0.18, gain: 0.055 });
        break;
      }
      case "trickDiscard": {
        // クラーケン・白クジラで海底に沈む音
        playTone(ac, {
          freq: 290,
          endFreq: 95,
          type: "sawtooth",
          duration: 0.36,
          gain: 0.06,
        });
        playTone(ac, {
          freq: 210,
          endFreq: 72,
          type: "sine",
          delay: 0.05,
          duration: 0.4,
          gain: 0.08,
        });
        break;
      }
      case "roundEnd": {
        // ラウンド集計の区切り音
        playTone(ac, { freq: 523.25, type: "triangle", duration: 0.15, gain: 0.07 });
        playTone(ac, { freq: 659.25, type: "triangle", delay: 0.09, duration: 0.18, gain: 0.07 });
        playTone(ac, { freq: 783.99, type: "sine", delay: 0.18, duration: 0.3, gain: 0.085 });
        break;
      }
      case "gameEnd": {
        // 10ラウンド終了のファンファーレ
        playTone(ac, { freq: 523.25, type: "triangle", duration: 0.16, gain: 0.08 });
        playTone(ac, { freq: 659.25, type: "triangle", delay: 0.1, duration: 0.16, gain: 0.08 });
        playTone(ac, { freq: 783.99, type: "triangle", delay: 0.2, duration: 0.2, gain: 0.085 });
        playTone(ac, { freq: 1046.5, type: "sine", delay: 0.32, duration: 0.48, gain: 0.1 });
        break;
      }
    }
  } catch {
    // 音声合成失敗時はゲームの進行を妨げない
  }
}
