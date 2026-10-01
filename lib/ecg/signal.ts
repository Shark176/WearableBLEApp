import type { ECGPacket } from '@/lib/protocol/wearableProtocol'

/** Firmware ECG stream: 200 Hz, up to 9 int16 samples per FE45 packet. */
export const ECG_SAMPLE_RATE = 200
export const ECG_SAMPLES_PER_PACKET = 9
/** Interval at which the firmware emits one full packet (≈45 ms). */
export const ECG_PACKET_INTERVAL_MS = (ECG_SAMPLES_PER_PACKET / ECG_SAMPLE_RATE) * 1000

/** Monotonic host clock on an epoch-like scale, in ms. Same timebase as `ECGPacket.hostRxMs`. */
export const hostNow = () => performance.timeOrigin + performance.now()

/**
 * Display-only filter: removes baseline wander with a 1 s causal moving average,
 * then applies light 3-point smoothing. NaN marks a gap (lost packets) and restarts
 * the filter. Not a clinical filter.
 *
 * `values` may contain up to `ECG_SAMPLE_RATE` warm-up samples before `from`;
 * only samples from index `from` onward are returned.
 */
export function displayFilter(values: ArrayLike<number>, from = 0): Float64Array {
  const window = ECG_SAMPLE_RATE
  const detrended = new Float64Array(values.length)
  let sum = 0
  let count = 0
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (!Number.isFinite(value)) { sum = 0; count = 0; detrended[i] = Number.NaN; continue }
    sum += value
    count += 1
    if (count > window) { sum -= values[i - window]; count = window }
    detrended[i] = value - sum / count
  }
  const out = new Float64Array(values.length - from)
  for (let i = from; i < values.length; i++) {
    const current = detrended[i]
    const previous = Number.isFinite(detrended[i - 1]) ? detrended[i - 1] : current
    const next = Number.isFinite(detrended[i + 1]) ? detrended[i + 1] : current
    out[i - from] = Number.isFinite(current) ? (previous + 2 * current + next) / 4 : Number.NaN
  }
  return out
}

/**
 * Rough heart-rate estimate from R-peaks in a filtered signal. Picks the dominant
 * polarity, thresholds at 55% of the peak amplitude and enforces a 300 ms refractory
 * period. Returns null when fewer than 3 beats are found or the result is implausible.
 */
export function estimateHeartRate(filtered: ArrayLike<number>): number | null {
  let max = 0
  let min = 0
  for (let i = 0; i < filtered.length; i++) {
    const value = filtered[i]
    if (!Number.isFinite(value)) continue
    if (value > max) max = value
    if (value < min) min = value
  }
  const polarity = max >= -min ? 1 : -1
  const threshold = 0.55 * Math.max(max, -min)
  if (threshold <= 0) return null

  const refractory = Math.round(0.3 * ECG_SAMPLE_RATE)
  const peaks: number[] = []
  for (let i = 1; i < filtered.length - 1; i++) {
    const value = filtered[i] * polarity
    if (!(value > threshold) || !(value >= filtered[i - 1] * polarity) || !(value > filtered[i + 1] * polarity)) continue
    const last = peaks.at(-1)
    if (last != null && i - last < refractory) {
      if (value > filtered[last] * polarity) peaks[peaks.length - 1] = i
      continue
    }
    peaks.push(i)
  }
  if (peaks.length < 3) return null

  const intervals = peaks.slice(1).map((peak, index) => peak - peaks[index]).sort((a, b) => a - b)
  const median = intervals[Math.floor(intervals.length / 2)]
  const bpm = Math.round((60 * ECG_SAMPLE_RATE) / median)
  return bpm >= 30 && bpm <= 220 ? bpm : null
}

/** PQRST wave shape as Gaussians: [offset from R (s), width (s), amplitude (ADC counts)]. */
const WAVES: [number, number, number][] = [
  [-0.2, 0.025, 110],   // P
  [-0.03, 0.01, -140],  // Q
  [0, 0.012, 1100],     // R
  [0.03, 0.012, -260],  // S
  [0.26, 0.05, 290],    // T
]

/** Synthetic ECG source for demo mode, emitting firmware-shaped FE45 packets. */
export function createSyntheticEcg(heartRate = 72) {
  let sampleIndex = 0
  let sequence = 0
  let previousBeat = -1
  let nextBeat = 0.4
  const beatAt = (t: number, beat: number) => WAVES.reduce((sum, [offset, width, amplitude]) => sum + amplitude * Math.exp(-(((t - beat - offset) / width) ** 2) / 2), 0)

  const nextSample = () => {
    const t = sampleIndex++ / ECG_SAMPLE_RATE
    if (t >= nextBeat) { previousBeat = nextBeat; nextBeat += (60 / heartRate) * (0.96 + Math.random() * 0.08) }
    const wander = 140 * Math.sin(2 * Math.PI * 0.25 * t)
    const noise = (Math.random() - 0.5) * 30
    return Math.round(beatAt(t, previousBeat) + beatAt(t, nextBeat) + wander + noise)
  }

  return {
    nextPacket(): ECGPacket {
      const samples = Array.from({ length: ECG_SAMPLES_PER_PACKET }, nextSample)
      const raw = new Uint8Array(20)
      const view = new DataView(raw.buffer)
      raw[0] = sequence
      raw[1] = samples.length
      samples.forEach((value, index) => view.setInt16(2 + index * 2, value, true))
      const packet = { sequence, sampleCount: samples.length, samples, raw, hostRxMs: hostNow() }
      sequence = (sequence + 1) & 0xff
      return packet
    },
  }
}
