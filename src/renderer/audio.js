// Microphone capture at 16 kHz PCM16 (what Gemini Live expects) and gapless playback of
// the model's 24 kHz PCM16 audio. Both expose a smoothed 0–1 level for the orb.

const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(1600); // 100 ms at 16 kHz
    this.n = 0;
    this.sum = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.sum += s * s;
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.buf.length) {
        const rms = Math.sqrt(this.sum / this.n);
        this.port.postMessage({ pcm: this.buf.buffer.slice(0), rms }, []);
        this.n = 0;
        this.sum = 0;
      }
    }
    return true;
  }
}
registerProcessor('vektor-capture', Capture);
`;

export function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToInt16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

export class Microphone {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.level = 0;
    this.onChunk = null;
    this.active = false;
  }

  async start() {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    this.ctx = new AudioContext({ sampleRate: 16000 });
    // A data: URL, not blob: — pages loaded from file:// cannot load blob or file worklets.
    await this.ctx.audioWorklet.addModule('data:text/javascript;charset=utf-8,' + encodeURIComponent(CAPTURE_WORKLET));
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'vektor-capture');
    this.node.port.onmessage = (e) => {
      // Perceptual-ish scaling: speech RMS sits around 0.02–0.2.
      const target = Math.min(1, Math.sqrt(e.data.rms) * 2.2);
      this.level = target > this.level ? target : this.level * 0.82 + target * 0.18;
      this.onChunk?.(e.data.pcm);
    };
    source.connect(this.node);
    this.active = true;
  }

  stop() {
    this.active = false;
    this.level = 0;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.ctx = this.stream = this.node = null;
  }
}

export class Player {
  constructor() {
    this.ctx = new AudioContext({ sampleRate: 24000 });
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.gain.connect(this.analyser).connect(this.ctx.destination);
    this.data = new Uint8Array(this.analyser.fftSize);
    this.nextTime = 0;
    this.sources = new Set();
    this.smoothed = 0;
  }

  enqueue(b64) {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const pcm = base64ToInt16(b64);
    if (!pcm.length) return;
    const buffer = this.ctx.createBuffer(1, pcm.length, 24000);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    // A small lead keeps network jitter from producing clicks between chunks.
    const now = this.ctx.currentTime;
    if (this.nextTime < now + 0.03) this.nextTime = now + 0.06;
    src.start(this.nextTime);
    this.nextTime += buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  get playing() {
    return this.sources.size > 0 || this.nextTime > this.ctx.currentTime + 0.02;
  }

  stop() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.sources.clear();
    this.nextTime = 0;
  }

  get level() {
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) { const v = (this.data[i] - 128) / 128; sum += v * v; }
    const target = Math.min(1, Math.sqrt(sum / this.data.length) * 4);
    this.smoothed = target > this.smoothed ? target * 0.6 + this.smoothed * 0.4 : this.smoothed * 0.88 + target * 0.12;
    return this.smoothed;
  }

  /** A soft two-note chime for timers and connection, synthesised so there is no asset to ship. */
  chime(kind = 'notify') {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const notes = { notify: [880, 1318.5], connect: [659.3, 987.8], alarm: [880, 1174.7, 1318.5, 1760], error: [392, 311.1] }[kind] || [880];
    const t0 = this.ctx.currentTime + 0.02;
    notes.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = t0 + i * 0.14;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + 1);
    });
  }
}
