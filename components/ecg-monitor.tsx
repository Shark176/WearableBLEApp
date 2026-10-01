'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Minus, Pause, Play, Plus, RotateCcw, Square } from 'lucide-react'
import type { ECGPacket } from '@/lib/protocol/wearableProtocol'
import type { EcgEvent, EcgStore } from '@/lib/ecg/ecgStore'
import { displayFilter, ECG_SAMPLE_RATE, ECG_SAMPLES_PER_PACKET, estimateHeartRate, hostNow } from '@/lib/ecg/signal'

type Props = {
  store: EcgStore
  mode: 'demo' | 'real'
  active: boolean
  onStart: () => void
  onStop: () => void
}

/** Columnar session recording; `firstIndex` is the session sample index of element 0. */
type Recording = { values: number[]; sequences: number[]; rxMs: number[]; firstIndex: number }
type Session = {
  received: number
  lost: number
  lastSequence: number | null
  /** Host time of the first packet of the current run, null between runs. */
  runStartedAt: number | null
  lastRxMs: number
  /** Recording time of finished runs. */
  elapsedMs: number
  arrivals: { time: number; samples: number }[]
}
type Stats = { rate: number; received: number; lost: number; sequence: number | null; duration: number; bpm: number | null }

/** Horizontal scale steps, oscilloscope style: seconds per major grid division. */
const TIME_PER_DIV = [0.1, 0.2, 0.5, 1, 2]
const DIVISIONS = 10
const DEFAULT_DIV_INDEX = 2
const MAX_DISPLAY_SAMPLES = (TIME_PER_DIV[TIME_PER_DIV.length - 1] * DIVISIONS + 1) * ECG_SAMPLE_RATE
const RECORD_MINUTES = 30
const RECORD_CAPACITY = RECORD_MINUTES * 60 * ECG_SAMPLE_RATE
/** Trim in one-minute chunks so a full recording is not spliced on every packet. */
const RECORD_SLACK = 60 * ECG_SAMPLE_RATE
const RATE_WINDOW_MS = 2000
const EMPTY_STATS: Stats = { rate: 0, received: 0, lost: 0, sequence: null, duration: 0, bpm: null }

const newRecording = (): Recording => ({ values: [], sequences: [], rxMs: [], firstIndex: 0 })
const newSession = (): Session => ({ received: 0, lost: 0, lastSequence: null, runStartedAt: null, lastRxMs: 0, elapsedMs: 0, arrivals: [] })
const pushGap = (recording: Recording) => { recording.values.push(Number.NaN); recording.sequences.push(-1); recording.rxMs.push(Number.NaN) }
const closeRun = (session: Session) => {
  if (session.runStartedAt == null) return
  session.elapsedMs += Math.max(0, session.lastRxMs - session.runStartedAt)
  session.runStartedAt = null
}
const formatDiv = (seconds: number) => (seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds} s`)

export default function ECGMonitor({ store, mode, active, onStart, onStop }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [divIndex, setDivIndex] = useState(DEFAULT_DIV_INDEX)
  const [filtered, setFiltered] = useState(true)
  const [lockedScale, setLockedScale] = useState(false)
  const [paused, setPaused] = useState(false)
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [hasSamples, setHasSamples] = useState(false)

  const timePerDiv = TIME_PER_DIV[divIndex]
  const seconds = timePerDiv * DIVISIONS

  // Hot path state lives in refs: packets arrive ~22×/s and the canvas redraws every frame.
  const recording = useRef<Recording>(newRecording())
  const session = useRef<Session>(newSession())
  const frozen = useRef<number[] | null>(null)
  const scale = useRef<{ low: number; high: number } | null>(null)
  const hasSamplesRef = useRef(false)
  const settings = useRef({ seconds, filtered, lockedScale, active })
  useEffect(() => { settings.current = { seconds, filtered, lockedScale, active } }, [seconds, filtered, lockedScale, active])

  const resetSession = useCallback(() => {
    recording.current = newRecording()
    session.current = newSession()
    frozen.current = null
    scale.current = null
    hasSamplesRef.current = false
    setStats(EMPTY_STATS)
    setHasSamples(false)
    setPaused(false)
  }, [])

  /** A new recording run: sequence numbers may restart, so do not count the jump as loss. */
  const beginRun = useCallback(() => {
    closeRun(session.current)
    session.current.lastSequence = null
    if (recording.current.values.length) pushGap(recording.current)
  }, [])

  const ingest = useCallback((packet: ECGPacket) => {
    const current = session.current
    const record = recording.current
    const rx = packet.hostRxMs ?? hostNow()
    if (current.lastSequence != null) {
      const gap = (packet.sequence - current.lastSequence + 256) % 256
      if (gap === 0) return // duplicate notification
      if (gap > 1) {
        current.lost += gap - 1
        for (let i = 0; i < (gap - 1) * ECG_SAMPLES_PER_PACKET; i++) pushGap(record)
      }
    }
    current.lastSequence = packet.sequence
    current.received += 1
    current.runStartedAt ??= rx
    current.lastRxMs = rx
    current.arrivals.push({ time: rx, samples: packet.samples.length })
    for (const value of packet.samples) { record.values.push(value); record.sequences.push(packet.sequence); record.rxMs.push(rx) }

    if (record.values.length > RECORD_CAPACITY + RECORD_SLACK) {
      const drop = record.values.length - RECORD_CAPACITY
      record.values.splice(0, drop)
      record.sequences.splice(0, drop)
      record.rxMs.splice(0, drop)
      record.firstIndex += drop
    }
    if (!hasSamplesRef.current) { hasSamplesRef.current = true; setHasSamples(true) }
  }, [])

  // Replay recent history on mount, then follow the live stream without re-rendering per packet.
  useEffect(() => {
    const handle = (event: EcgEvent) => {
      if (event.type === 'packet') ingest(event.packet)
      else if (event.type === 'start') beginRun()
      else resetSession()
    }
    resetSession()
    store.history().forEach(handle)
    return store.subscribe(handle)
  }, [store, ingest, beginRun, resetSession])

  // Stats refresh at 4 Hz instead of on every packet.
  useEffect(() => {
    const update = () => {
      const current = session.current
      const now = hostNow()
      current.arrivals = current.arrivals.filter((arrival) => now - arrival.time <= RATE_WINDOW_MS)
      const recent = current.arrivals.reduce((sum, arrival) => sum + arrival.samples, 0)
      const values = recording.current.values.slice(-9 * ECG_SAMPLE_RATE)
      const bpm = values.length > 3 * ECG_SAMPLE_RATE ? estimateHeartRate(displayFilter(values, Math.min(ECG_SAMPLE_RATE, values.length))) : null
      // The session clock only runs while recording; when stopped it rests on the last packet.
      const running = current.runStartedAt == null ? 0 : (active ? now : current.lastRxMs) - current.runStartedAt
      setStats((previous) => ({
        rate: Math.round(recent / (RATE_WINDOW_MS / 1000)),
        received: current.received,
        lost: current.lost,
        sequence: current.lastSequence,
        duration: Math.floor((current.elapsedMs + Math.max(0, running)) / 1000),
        bpm: bpm ?? (active ? previous.bpm : null),
      }))
    }
    update()
    const id = window.setInterval(update, 250)
    return () => window.clearInterval(id)
  }, [active])

  useEffect(() => {
    frozen.current = paused ? recording.current.values.slice(-MAX_DISPLAY_SAMPLES) : null
  }, [paused])

  // Single render loop; reads the latest samples and settings from refs.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!wrap || !canvas || !context) return
    const style = getComputedStyle(canvas)
    const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
    let frame = 0
    let previousTime = 0

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw)
      const elapsed = Math.min(100, time - previousTime)
      previousTime = time

      // Keep the backing store in sync with the CSS size and device pixel ratio.
      const ratio = window.devicePixelRatio || 1
      const width = wrap.clientWidth
      const height = wrap.clientHeight
      if (!width || !height) return
      const backingWidth = Math.round(width * ratio)
      const backingHeight = Math.round(height * ratio)
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) { canvas.width = backingWidth; canvas.height = backingHeight }

      const { seconds: windowSeconds, filtered: useFilter, lockedScale: locked, active: recordingNow } = settings.current
      const capacity = Math.round(windowSeconds * ECG_SAMPLE_RATE)

      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.fillStyle = color('--ecg-bg', '#fbfdfb')
      context.fillRect(0, 0, width, height)
      drawGrid(context, width, height, color('--ecg-grid-minor', '#edf4f0'), color('--ecg-grid', '#d8e7df'))

      const source = frozen.current ?? recording.current.values
      const warmup = useFilter ? Math.min(ECG_SAMPLE_RATE, Math.max(0, source.length - capacity)) : 0
      const raw = source.slice(-(capacity + warmup))
      const values = useFilter ? displayFilter(raw, warmup) : raw

      let min = Infinity
      let max = -Infinity
      for (const value of values) if (Number.isFinite(value)) { if (value < min) min = value; if (value > max) max = value }
      if (min === Infinity) {
        context.fillStyle = color('--ecg-muted', '#71827c')
        context.font = '13px Arial, sans-serif'
        context.textAlign = 'center'
        context.fillText(recordingNow ? 'Waiting for ECG samples…' : 'Press “Start ECG” to begin recording', width / 2, height / 2)
        context.textAlign = 'start'
        return
      }

      // Auto-scale grows at once and eases back (≈0.3 s time constant) so the trace does not jump.
      const padding = Math.max(40, (max - min) * 0.15)
      const target = { low: min - padding, high: max + padding }
      if (!scale.current) scale.current = target
      else if (!locked) {
        const ease = 1 - Math.exp(-elapsed / 300)
        const current = scale.current
        current.low = target.low < current.low ? target.low : current.low + (target.low - current.low) * ease
        current.high = target.high > current.high ? target.high : current.high + (target.high - current.high) * ease
      }
      const { low, high } = scale.current

      // Newest sample sits on the right edge; the window fills from the right.
      const offset = capacity - values.length
      const step = width / Math.max(1, capacity - 1)
      context.strokeStyle = color('--ecg-trace', '#3f829f')
      context.lineWidth = 1.6
      context.lineJoin = 'round'
      context.beginPath()
      let drawing = false
      for (let i = 0; i < values.length; i++) {
        const value = values[i]
        if (!Number.isFinite(value)) { drawing = false; continue }
        const x = (offset + i) * step
        const y = height - ((value - low) / (high - low)) * height
        if (drawing) context.lineTo(x, y)
        else { context.moveTo(x, y); drawing = true }
      }
      context.stroke()

      context.fillStyle = color('--ecg-muted', '#71827c')
      context.font = '10px Arial, sans-serif'
      context.fillText(`${Math.round(high)}`, 6, 12)
      context.fillText(`${Math.round(low)}`, 6, height - 6)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  const download = () => {
    const { values, sequences, rxMs, firstIndex } = recording.current
    const rows = ['sample_index,time_s,sequence,value_raw,host_rx_ms']
    for (let i = 0; i < values.length; i++) {
      const index = firstIndex + i
      rows.push(`${index},${(index / ECG_SAMPLE_RATE).toFixed(3)},${sequences[i] < 0 ? '' : sequences[i]},${Number.isFinite(values[i]) ? values[i] : ''},${Number.isFinite(rxMs[i]) ? rxMs[i].toFixed(3) : ''}`)
    }
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `ecg-session-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const lossRate = stats.received + stats.lost ? (stats.lost / (stats.received + stats.lost)) * 100 : 0
  const tiles: [string, string, string?][] = [
    ['Estimated HR', stats.bpm == null ? '--' : String(stats.bpm), 'bpm'],
    ['Sample rate', String(stats.rate), '/s'],
    ['Packets', String(stats.received)],
    ['Lost packets', String(stats.lost)],
    ['Loss rate', lossRate.toFixed(1), '%'],
    ['Sequence', stats.sequence == null ? '--' : String(stats.sequence)],
    ['Recording time', formatDuration(stats.duration)],
  ]

  return (
    <section className="view-stack ecg-monitor">
      <section className="info-card ecg-header">
        <div>
          <p className="eyebrow">ECG · FE45</p>
          <h2>Real-time electrocardiogram</h2>
          <p className="subheading">ADC counts · {ECG_SAMPLE_RATE} Hz · {ECG_SAMPLES_PER_PACKET} samples per packet</p>
        </div>
        <div className="ecg-header-side">
          <span className={`ecg-live ${active ? 'on' : ''}`}><span />{active ? 'Recording' : 'Stopped'}</span>
          <div className="button-row">
            <button className="primary-btn" onClick={active ? onStop : onStart}>
              {active ? <Square size={14} /> : <Play size={14} />}
              {active ? 'Stop ECG' : 'Start ECG'}
            </button>
            <button className="secondary-btn" onClick={resetSession}>
              <RotateCcw size={14} /> New session
            </button>
          </div>
        </div>
      </section>

      <section className="info-card ecg-chart-card">
        <div className="ecg-toolbar">
          <div className="ecg-field" role="group" aria-label="Time per division">
            Time/div
            <div className="ecg-stepper">
              <button aria-label="Decrease time per division (zoom in)" disabled={divIndex === 0} onClick={() => setDivIndex(divIndex - 1)}>
                <Minus size={13} />
              </button>
              <output aria-live="polite">{formatDiv(timePerDiv)}</output>
              <button aria-label="Increase time per division (zoom out)" disabled={divIndex === TIME_PER_DIV.length - 1} onClick={() => setDivIndex(divIndex + 1)}>
                <Plus size={13} />
              </button>
            </div>
            <span className="ecg-window">{seconds} s window</span>
          </div>
          <label className="ecg-check">
            <input type="checkbox" checked={filtered} onChange={(event) => setFiltered(event.target.checked)} /> Display filter
          </label>
          <label className="ecg-check">
            <input type="checkbox" checked={lockedScale} onChange={(event) => setLockedScale(event.target.checked)} /> Lock scale
          </label>
          <div className="ecg-toolbar-actions">
            <button className="secondary-btn" onClick={() => setPaused(!paused)}>
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button className="secondary-btn" onClick={download} disabled={!hasSamples}>
              <Download size={14} /> CSV
            </button>
          </div>
        </div>
        <div className="ecg-canvas-wrap" ref={wrapRef}>
          <canvas ref={canvasRef} aria-label="Real-time ECG waveform" role="img" />
        </div>
        <p className="card-footnote">
          Large square = {formatDiv(timePerDiv)} · small square = {formatDiv(timePerDiv / 5)} · Y axis: ADC counts{filtered ? ' (baseline removed)' : ''} ·{' '}
          {paused ? 'Display paused, reception continues.' : 'Scrolling window'} · CSV keeps the last {RECORD_MINUTES} min of the session.
        </p>
      </section>

      <section className="ecg-stats">
        {tiles.map(([label, value, unit]) => (
          <div className="ecg-stat" key={label}>
            <span>{label}</span>
            <strong>
              {value}
              {unit && <small>{unit}</small>}
            </strong>
          </div>
        ))}
      </section>

      <p className="card-footnote">
        Estimated heart rate is for reference only and must not be used for diagnosis. Source: {mode === 'real' ? 'wearable BLE (FE45)' : 'synthetic demo signal'}.
      </p>
    </section>
  )
}

/** Square grid: a major line every time division, five minor cells per division. */
function drawGrid(context: CanvasRenderingContext2D, width: number, height: number, minor: string, major: string) {
  const cell = width / (DIVISIONS * 5)
  const lines = (color: string, every: number) => {
    context.strokeStyle = color
    context.lineWidth = 1
    context.beginPath()
    for (let x = 0; x <= width + 0.5; x += cell * every) { context.moveTo(Math.round(x) + 0.5, 0); context.lineTo(Math.round(x) + 0.5, height) }
    for (let y = height; y >= -0.5; y -= cell * every) { context.moveTo(0, Math.round(y) + 0.5); context.lineTo(width, Math.round(y) + 0.5) }
    context.stroke()
  }
  if (cell >= 4) lines(minor, 1)
  lines(major, 5)
}

function formatDuration(total: number) {
  const minutes = Math.floor(total / 60)
  const secondsPart = String(total % 60).padStart(2, '0')
  return `${minutes}:${secondsPart}`
}
