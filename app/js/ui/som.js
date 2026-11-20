// Every sound of the game, synthesized with the Web Audio API: no files to download.
//
// One small palette, so the table sounds like one place: a slap on the table top (cards, knocks), a plucked
// string (turns, wins, losses), the horn of a raise call that climbs with the hand value, and the clink of a
// bottle cap when points land. Everything is short, goes through one compressor, and nothing here ever
// throws: where audio is missing or blocked the game is simply silent.

/** @typedef {import('../net/types.js').RoomSnapshot} RoomSnapshot */

/**
 * @typedef {'deal' | 'card' | 'round' | 'truco' | 'seis' | 'nove' | 'doze' | 'accept' | 'run' | 'turn' | 'tick'
 *   | 'win' | 'lose' | 'match-win' | 'match-end' | 'taunt'} SoundName
 */
/** @typedef {{ name: SoundName, at: number }} Cue a sound and its delay in seconds */
/**
 * @typedef {Object} Sound
 * @property {() => boolean} isOn
 * @property {(on: boolean) => void} setOn persisted for the next visit
 * @property {() => void} unlock call from a user gesture: creates or resumes the audio context
 * @property {(name: SoundName, delay?: number) => void} play
 */

const STORAGE_KEY = 'trucoimpar.som';
/** The same sound twice within this window would only be louder: the second one is dropped. */
const SAME_SOUND_MS = 60;

const NOTE = { D4: 293.66, F4: 349.23, G4: 392, A4: 440, C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5 };
/** Root of the horn for each raise call: every step up the ladder starts higher. */
const HORN_ROOT = { truco: 196, seis: 233.08, nove: 261.63, doze: 311.13 };

/** @returns {boolean} */
function loadSetting() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** @param {boolean} on */
function saveSetting(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Private mode or a full disk: the setting lasts for this visit only.
  }
}

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} out
 * @param {number} t start time
 * @param {number} peak
 * @param {number} attack
 * @param {number} dur
 * @returns {GainNode} an envelope from silence to `peak` and back
 */
function envelope(ctx, out, t, peak, attack, dur) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  gain.connect(out);
  return gain;
}

/**
 * An oscillator gliding from one pitch to another.
 * @param {AudioContext} ctx
 * @param {AudioNode} out
 * @param {OscillatorType} type
 * @param {number} t
 * @param {number} from
 * @param {number} to
 * @param {number} dur
 */
function voice(ctx, out, type, t, from, to, dur) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  osc.connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

/** @returns {Sound} */
export function createSound() {
  let on = loadSetting();
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {AudioNode | null} */
  let master = null;
  /** @type {AudioBuffer | null} */
  let noise = null;
  /** @type {Map<SoundName, number>} */
  const lastPlayed = new Map();

  function ensureContext() {
    if (ctx !== null) return;
    const Ctor = /** @type {typeof AudioContext | undefined} */ (globalThis.AudioContext ?? Reflect.get(globalThis, 'webkitAudioContext'));
    if (Ctor === undefined) return;
    ctx = new Ctor();
    const compressor = ctx.createDynamicsCompressor();
    compressor.connect(ctx.destination);
    const volume = ctx.createGain();
    volume.gain.value = 0.7;
    volume.connect(compressor);
    master = volume;
    noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
  }

  /**
   * The slap: a burst of filtered noise.
   * @param {number} t @param {number} freq @param {number} dur @param {number} peak
   */
  function slap(t, freq, dur, peak) {
    if (!ctx || !master || !noise) return;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    source.connect(filter);
    filter.connect(envelope(ctx, master, t, peak, 0.004, dur));
    source.start(t, Math.random() * 0.3, dur + 0.03);
  }

  /** The body of a knock: a low sine falling fast. @param {number} t @param {number} from @param {number} to @param {number} dur @param {number} peak */
  function thump(t, from, to, dur, peak) {
    if (!ctx || !master) return;
    voice(ctx, envelope(ctx, master, t, peak, 0.005, dur), 'sine', t, from, to, dur);
  }

  /** A plucked string: triangle with a quieter octave on top. @param {number} t @param {number} freq @param {number} [peak] @param {number} [dur] */
  function pluck(t, freq, peak = 0.2, dur = 0.34) {
    if (!ctx || !master) return;
    voice(ctx, envelope(ctx, master, t, peak, 0.006, dur), 'triangle', t, freq, freq, dur);
    voice(ctx, envelope(ctx, master, t, peak * 0.3, 0.004, dur * 0.5), 'sine', t, freq * 2, freq * 2, dur * 0.5);
  }

  /** The horn of a raise call: a sawtooth that opens up. @param {number} t @param {number} freq @param {number} dur @param {number} peak */
  function horn(t, freq, dur, peak) {
    if (!ctx || !master) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.4);
    filter.frequency.exponentialRampToValueAtTime(900, t + dur);
    filter.connect(envelope(ctx, master, t, peak, 0.02, dur));
    voice(ctx, filter, 'sawtooth', t, freq * 0.97, freq, dur);
    voice(ctx, filter, 'sawtooth', t, freq * 1.006, freq * 1.006, dur);
  }

  /** A bottle cap on glass: two high partials that ring briefly. @param {number} t @param {number} [peak] */
  function clink(t, peak = 0.11) {
    if (!ctx || !master) return;
    voice(ctx, envelope(ctx, master, t, peak, 0.002, 0.3), 'sine', t, 2637, 2637, 0.3);
    voice(ctx, envelope(ctx, master, t, peak * 0.6, 0.002, 0.2), 'sine', t, 4186, 4186, 0.2);
  }

  /** @param {number} t @param {keyof typeof HORN_ROOT} call */
  function raiseCall(t, call) {
    const root = HORN_ROOT[call];
    const level = Object.keys(HORN_ROOT).indexOf(call);
    thump(t, 130, 45, 0.24, 0.6);
    slap(t, 900, 0.09, 0.3);
    horn(t + 0.03, root, 0.15, 0.2);
    horn(t + 0.19, root * 1.5, 0.34, 0.24);
    if (level >= 1) horn(t + 0.19, root * 2, 0.34, 0.1 + level * 0.03);
    if (level >= 3) thump(t + 0.19, 110, 40, 0.3, 0.5);
  }

  /** @type {Record<SoundName, (t: number) => void>} */
  const SOUNDS = {
    deal: (t) => [0, 0.075, 0.15].forEach((d) => slap(t + d, 2600, 0.05, 0.13)),
    card: (t) => {
      slap(t, 1800, 0.05, 0.24);
      thump(t, 170, 80, 0.09, 0.3);
    },
    round: (t) => {
      thump(t, 230, 150, 0.06, 0.22);
      pluck(t + 0.05, NOTE.E5, 0.12, 0.26);
    },
    truco: (t) => raiseCall(t, 'truco'),
    seis: (t) => raiseCall(t, 'seis'),
    nove: (t) => raiseCall(t, 'nove'),
    doze: (t) => raiseCall(t, 'doze'),
    accept: (t) => {
      for (const d of [0, 0.12]) {
        thump(t + d, 260, 170, 0.06, 0.34);
        slap(t + d, 1200, 0.03, 0.1);
      }
      pluck(t + 0.24, NOTE.C5, 0.14, 0.3);
    },
    run: (t) => {
      if (!ctx || !master) return;
      voice(ctx, envelope(ctx, master, t, 0.14, 0.02, 0.3), 'triangle', t, 640, 230, 0.3);
      slap(t + 0.02, 700, 0.2, 0.05);
    },
    turn: (t) => {
      pluck(t, NOTE.E5, 0.2);
      pluck(t + 0.11, NOTE.A5, 0.2, 0.42);
    },
    tick: (t) => {
      thump(t, 1050, 880, 0.05, 0.16);
      slap(t, 3000, 0.02, 0.04);
    },
    win: (t) => {
      clink(t);
      [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((freq, i) => pluck(t + 0.05 + i * 0.075, freq, 0.18, i === 3 ? 0.5 : 0.28));
    },
    lose: (t) => [NOTE.A4, NOTE.F4, NOTE.D4].forEach((freq, i) => pluck(t + i * 0.13, freq, 0.12, i === 2 ? 0.45 : 0.28)),
    'match-win': (t) => {
      clink(t);
      [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((freq, i) => pluck(t + 0.05 + i * 0.09, freq, 0.19, 0.32));
      [NOTE.C5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((freq) => pluck(t + 0.6, freq, 0.13, 0.9));
      clink(t + 0.6, 0.08);
    },
    'match-end': (t) => {
      [NOTE.G4, NOTE.C5, NOTE.E5].forEach((freq, i) => pluck(t + i * 0.11, freq, 0.14, 0.3));
      [NOTE.C5, NOTE.G5].forEach((freq) => pluck(t + 0.4, freq, 0.11, 0.7));
    },
    taunt: (t) => {
      if (!ctx || !master) return;
      voice(ctx, envelope(ctx, master, t, 0.15, 0.008, 0.08), 'sine', t, 420, 860, 0.08);
      voice(ctx, envelope(ctx, master, t + 0.1, 0.15, 0.008, 0.11), 'sine', t + 0.1, 620, 1180, 0.11);
    },
  };

  return {
    isOn: () => on,
    setOn(next) {
      on = next;
      saveSetting(on);
    },
    unlock() {
      try {
        ensureContext();
        if (ctx !== null && ctx.state === 'suspended') ctx.resume().catch(() => {});
      } catch {
        // No audio on this device: stay silent.
      }
    },
    play(name, delay = 0) {
      if (!on || ctx === null || ctx.state !== 'running') return;
      try {
        const t = ctx.currentTime + delay + 0.01;
        const previous = lastPlayed.get(name);
        if (previous !== undefined && Math.abs(t - previous) * 1000 < SAME_SOUND_MS) return;
        lastPlayed.set(name, t);
        SOUNDS[name](t);
      } catch {
        // A sound that cannot play is skipped, never an error for the game.
      }
    },
  };
}

/** @param {RoomSnapshot} snapshot @returns {boolean} whether this device's player has to act right now */
function mustAct(snapshot) {
  const hand = snapshot.game?.hand ?? null;
  if (!snapshot.game || hand === null || snapshot.you.role !== 'player') return false;
  if (snapshot.game.phase === 'truco') return hand.raise?.mustAnswer === true;
  return snapshot.game.phase === 'play' && hand.turn === snapshot.you.id;
}

/**
 * What the table sounds like when `snapshot` follows `previous`: one cue per public event, spread out so they
 * are heard one after the other. Events are only voiced when the snapshot directly follows the previous one
 * (after a reconnection the past is not replayed).
 * @param {RoomSnapshot | null} previous
 * @param {RoomSnapshot} snapshot
 * @returns {Cue[]}
 */
export function cuesFor(previous, snapshot) {
  if (previous === null || snapshot.seq !== previous.seq + 1) return [];
  const me = snapshot.you.role === 'player' ? snapshot.you.id : null;
  /** @type {Cue[]} */
  const cues = [];
  let at = 0;
  /** @param {SoundName} name @param {number} gap */
  const add = (name, gap) => {
    cues.push({ name, at });
    at += gap;
  };
  const handEnded = snapshot.events.some((event) => event.type === 'handEnded');
  let called = false;
  for (const event of snapshot.events) {
    switch (event.type) {
      case 'handDealt': add('deal', 0.25); break;
      case 'cardPlayed': add('card', 0.14); break;
      case 'roundEnded': if (!handEnded) add('round', 0.3); break;
      case 'trucoCalled':
        called = true;
        add(event.value >= 12 ? 'doze' : event.value >= 9 ? 'nove' : event.value >= 6 ? 'seis' : 'truco', 0.6);
        break;
      case 'trucoResolved': add(event.accepted.length > 0 ? 'accept' : 'run', 0.4); break;
      case 'handEnded': if (!snapshot.events.some((other) => other.type === 'matchEnded')) add(event.winner === me ? 'win' : me === null ? 'round' : 'lose', 0.5); break;
      case 'matchEnded': add(event.winner === me ? 'match-win' : 'match-end', 1); break;
      case 'taunt': add('taunt', 0.25); break;
      default: break;
    }
  }
  // A raise call is loud enough to tell everybody they have to answer.
  const iJustPlayed = snapshot.events.some((event) => event.type === 'cardPlayed' && event.playerId === me);
  if (!called && mustAct(snapshot) && (iJustPlayed || !mustAct(previous))) add('turn', 0.3);
  return cues;
}
