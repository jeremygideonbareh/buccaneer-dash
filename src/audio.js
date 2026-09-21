// Every sound is synthesised with Web Audio, so there are no audio files to load.

let ctx = null
let master = null
let muted = false
try {
  muted = localStorage.getItem('bd-muted') === '1'
} catch {}

let noiseBuffer = null
function noise() {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  return src
}

/** Browsers only allow audio after a click or key press, so call this from one. */
export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume()
    return
  }
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = muted ? 0 : 0.7
  master.connect(ctx.destination)
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = noiseBuffer.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  startOcean()
}

export function isMuted() {
  return muted
}
export function toggleMute() {
  muted = !muted
  try {
    localStorage.setItem('bd-muted', muted ? '1' : '0')
  } catch {}
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.05)
  return muted
}

// The sea: looping noise through a lowpass, swelling slowly
function startOcean() {
  const src = noise()
  src.loop = true
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 420
  const gain = ctx.createGain()
  gain.gain.value = 0.09
  const lfo = ctx.createOscillator()
  const lfoGain = ctx.createGain()
  lfo.frequency.value = 0.13
  lfoGain.gain.value = 0.06
  lfo.connect(lfoGain).connect(gain.gain)
  src.connect(lp).connect(gain).connect(master)
  src.start()
  lfo.start()
}

function env(gain, t, attack, peak, decay) {
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(peak, t + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
}

function tone(freq, { type = 'triangle', at = 0, peak = 0.2, decay = 0.25, slideTo } = {}) {
  if (!ctx) return
  const t = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + decay)
  env(g, t, 0.01, peak, decay)
  osc.connect(g).connect(master)
  osc.start(t)
  osc.stop(t + decay + 0.05)
}

function burst({ at = 0, from = 1200, to = 100, peak = 0.6, decay = 0.6, type = 'lowpass', q = 0.7 } = {}) {
  if (!ctx) return
  const t = ctx.currentTime + at
  const src = noise()
  const f = ctx.createBiquadFilter()
  f.type = type
  f.Q.value = q
  f.frequency.setValueAtTime(from, t)
  f.frequency.exponentialRampToValueAtTime(to, t + decay)
  const g = ctx.createGain()
  env(g, t, 0.005, peak, decay)
  src.connect(f).connect(g).connect(master)
  src.start(t)
  src.stop(t + decay + 0.05)
}

export const sfx = {
  click: () => tone(660, { type: 'square', peak: 0.05, decay: 0.05 }),
  beep: () => tone(440, { peak: 0.25, decay: 0.3 }),
  cannon: () => {
    burst({ from: 1600, to: 60, peak: 0.9, decay: 0.9 })
    tone(95, { type: 'sine', peak: 0.6, decay: 0.7, slideTo: 35 })
  },
  bell: () => {
    for (const [f, p] of [
      [880, 0.18],
      [1320, 0.1],
      [2210, 0.05],
    ])
      tone(f, { type: 'sine', peak: p, decay: 1.4 })
  },
  whoosh: () => burst({ from: 300, to: 2400, peak: 0.35, decay: 0.7, type: 'bandpass', q: 1.2 }),
  thud: () => {
    tone(70, { type: 'sine', peak: 0.5, decay: 0.25, slideTo: 40 })
    burst({ from: 600, to: 80, peak: 0.3, decay: 0.25 })
  },
  coin: () => [988, 1319, 1760].forEach((f, i) => tone(f, { type: 'square', at: i * 0.07, peak: 0.07, decay: 0.18 })),
  gate: () => tone(1046, { type: 'sine', peak: 0.1, decay: 0.3 }),
  fanfare: () => {
    // A little hornpipe flourish
    const notes = [523, 659, 784, 1046, 784, 1046]
    notes.forEach((f, i) => tone(f, { type: 'square', at: i * 0.12, peak: 0.08, decay: i === notes.length - 1 ? 0.8 : 0.14 }))
  },
  lose: () => [392, 349, 311, 262].forEach((f, i) => tone(f, { type: 'triangle', at: i * 0.22, peak: 0.15, decay: 0.3 })),
}
