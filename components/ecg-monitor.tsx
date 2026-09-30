'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ECGPacket } from '@/lib/protocol/wearableProtocol'

type Props = {
  packets: ECGPacket[]
  mode: 'demo' | 'real'
  active: boolean
  error?: string
  onStart: () => void
  onStop: () => void
}

type Sample = { value: number; sequence: number; index: number }
const SAMPLE_RATE = 200
const CAPACITY = 6000

export default function ECGMonitor({ packets, mode, active, error, onStart, onStop }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState<5 | 10>(5)
  const [filtered, setFiltered] = useState(true)
  const [lockedScale, setLockedScale] = useState(false)
  const [sessionStarted, setSessionStarted] = useState<number | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const previousSequence = useRef<number | null>(null)
  const lastPacketKey = useRef<string | null>(null)
  const lostPackets = useRef(0)
  const totalPackets = useRef(0)
  const gaps = useRef(0)
  const lastRate = useRef({ time: 0, count: 0 })
  const [stats, setStats] = useState({ lost: 0, rate: 0, bpm: '--', sequence: '--' as number | string })

  useEffect(() => {
    if (!packets.length) return
    const packet = packets.at(-1)!
    const packetKey = `${packet.sequence}:${Array.from(packet.raw).join(',')}`
    if (lastPacketKey.current === packetKey) return
    lastPacketKey.current = packetKey
    if (sessionStarted == null) setSessionStarted(Date.now())
    totalPackets.current += 1
    if (previousSequence.current != null) {
      const gap = (packet.sequence - previousSequence.current + 256) % 256
      if (gap > 1) { lostPackets.current += gap - 1; gaps.current += gap - 1 }
    }
    previousSequence.current = packet.sequence
    setSamples((current) => {
      const start = current.length ? current.at(-1)!.index + 1 : 0
      const missing = gaps.current
      gaps.current = 0
      const next = [...current, ...Array.from({ length: missing * 9 }, (_, index) => ({ value: Number.NaN, sequence: -1, index: start + index })), ...packet.samples.map((value, index) => ({ value, sequence: packet.sequence, index: start + missing * 9 + index }))]
      return next.slice(-CAPACITY)
    })
    const now = Date.now()
    if (now - lastRate.current.time >= 500) {
      const elapsed = lastRate.current.time ? (now - lastRate.current.time) / 1000 : 2
      const rate = Math.round(((totalPackets.current - lastRate.current.count) * 9) / elapsed)
      lastRate.current = { time: now, count: totalPackets.current }
      setStats((current) => ({ ...current, rate, lost: lostPackets.current, sequence: packet.sequence }))
    } else setStats((current) => ({ ...current, lost: lostPackets.current, sequence: packet.sequence }))
  }, [packets, sessionStarted])

  const visible = useMemo(() => samples.slice(-seconds * SAMPLE_RATE), [samples, seconds])
  const displayValues = useMemo(() => {
    if (!filtered) return visible.map((sample) => sample.value)
    let baseline = 0
    return visible.map((sample, index, values) => {
      if (!Number.isFinite(sample.value)) return Number.NaN
      const previous = Number.isFinite(values[index - 1]?.value) ? values[index - 1].value : sample.value
      baseline += (sample.value - baseline) * 0.015
      return sample.value - baseline + (sample.value - previous) * 0.08
    })
  }, [visible, filtered])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || paused) return
    const context = canvas.getContext('2d')
    if (!context) return
    let frame = 0
    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = rect.width * ratio; canvas.height = rect.height * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const width = rect.width; const height = rect.height
      context.fillStyle = getComputedStyle(canvas).getPropertyValue('--ecg-bg') || '#fbfdfb'; context.fillRect(0, 0, width, height)
      context.strokeStyle = getComputedStyle(canvas).getPropertyValue('--ecg-grid') || '#d8e7df'; context.lineWidth = 1
      for (let x = 0; x <= width; x += width / (seconds * 5)) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke() }
      for (let y = 0; y <= height; y += 20) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke() }
      const finite = displayValues.filter(Number.isFinite) as number[]
      if (!finite.length) { context.fillStyle = '#71827c'; context.font = '12px Arial'; context.fillText('Waiting for ECG samples…', 18, 24); frame = requestAnimationFrame(draw); return }
      const min = lockedScale ? -2000 : Math.min(...finite); const max = lockedScale ? 2000 : Math.max(...finite); const padding = lockedScale ? 0 : Math.max(20, (max - min) * 0.15)
      const low = min - padding; const high = max + padding
      context.strokeStyle = '#3f829f'; context.lineWidth = 2; context.beginPath()
      displayValues.forEach((value, index) => { if (!Number.isFinite(value)) { context.stroke(); context.beginPath(); return }; const x = (index / Math.max(1, seconds * SAMPLE_RATE - 1)) * width; const y = height - ((value - low) / (high - low)) * height; if (index === 0 || !Number.isFinite(displayValues[index - 1])) context.moveTo(x, y); else context.lineTo(x, y) })
      context.stroke(); frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [displayValues, seconds, paused, lockedScale])

  useEffect(() => { if (!samples.length) return; const peaks: number[] = []; for (let i = 1; i < displayValues.length - 1; i++) if (Number.isFinite(displayValues[i]) && displayValues[i] > displayValues[i - 1] && displayValues[i] >= displayValues[i + 1] && displayValues[i] > 0) peaks.push(i); const intervals = peaks.slice(-9).slice(1).map((peak, index) => peak - peaks.slice(-9)[index]); const bpm = intervals.length ? Math.round(60 * SAMPLE_RATE / (intervals.reduce((sum, value) => sum + value, 0) / intervals.length)) : null; if (bpm && bpm > 30 && bpm < 220) setStats((current) => ({ ...current, bpm: String(bpm) })) }, [displayValues, samples.length])

  const download = () => { const rows = ['sample_index,time_s,sequence,value_raw']; samples.forEach((sample) => rows.push(`${sample.index},${(sample.index / SAMPLE_RATE).toFixed(3)},${sample.sequence < 0 ? '' : sample.sequence},${Number.isFinite(sample.value) ? sample.value : ''}`)); const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'ecg-session.csv'; link.click(); URL.revokeObjectURL(url) }
  const reset = () => { setSamples([]); setSessionStarted(Date.now()); previousSequence.current = null; lastPacketKey.current = null; lostPackets.current = 0; totalPackets.current = 0; gaps.current = 0; lastRate.current = { time: 0, count: 0 }; setStats({ lost: 0, rate: 0, bpm: '--', sequence: '--' }) }
  const duration = sessionStarted ? Math.floor((Date.now() - sessionStarted) / 1000) : 0
  return <section className="view-stack ecg-monitor"><section className="info-card ecg-header"><div><p className="eyebrow">MAX86150 · ECG / PPG</p><h2>ECG and PPG monitor</h2><p className="subheading">ADC counts · 200 Hz · 9 samples per packet</p></div><div className="button-row"><button className="primary-btn" onClick={active ? onStop : onStart}>{active ? 'Stop ECG' : 'Start ECG'}</button><button className="secondary-btn" onClick={reset}>New session</button></div></section>{error && <div className="error-banner">{error}</div>}<section className="info-card ecg-chart-card"><div className="ecg-toolbar"><label>Window <select value={seconds} onChange={(event) => setSeconds(Number(event.target.value) as 5 | 10)}><option value="5">5 s</option><option value="10">10 s</option></select></label><label><input type="checkbox" checked={filtered} onChange={(event) => setFiltered(event.target.checked)} /> Display filter</label><label><input type="checkbox" checked={lockedScale} onChange={(event) => setLockedScale(event.target.checked)} /> Lock scale</label><button className="secondary-btn" onClick={() => setPaused(!paused)}>{paused ? 'Resume display' : 'Pause display'}</button><button className="secondary-btn" onClick={download} disabled={!samples.length}>Download CSV</button></div><div className="ecg-canvas-wrap"><canvas ref={canvasRef} aria-label="Real-time ECG waveform" /></div><p className="card-footnote">Grid: large square = 0.2 s · Y axis: ADC counts · {paused ? 'Display paused; reception continues.' : 'Scrolling window'}</p></section><section className="info-card ecg-chart-card ppg-chart-card"><div className="section-heading compact"><div><p className="eyebrow">PPG · MAX86150</p><h2>Photoplethysmography</h2></div><span className="source-pill unavailable">UNAVAILABLE</span></div><p className="feature-note">Firmware hiện chỉ cung cấp ECG qua FE45. Chưa có characteristic hoặc payload PPG raw để vẽ dạng sóng; HR/SpO₂ vẫn được nhận từ SENSOR_DATA FE42.</p></section><section className="ecg-stats">{[['Sample rate', `${stats.rate || 0} /s`], ['Total packets', String(totalPackets.current)], ['Lost packets', String(stats.lost)], ['Loss rate', `${totalPackets.current ? ((stats.lost / (totalPackets.current + stats.lost)) * 100).toFixed(1) : '0.0'}%`], ['Sequence', String(stats.sequence)], ['Session', `${duration}s`], ['Estimated HR', `${stats.bpm} bpm`]].map(([label, value]) => <div className="info-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</section><p className="card-footnote">Estimated heart rate is for reference only and must not be used for diagnosis. Source: {mode === 'real' ? 'wearable BLE' : 'demo session'}.</p></section>
}
