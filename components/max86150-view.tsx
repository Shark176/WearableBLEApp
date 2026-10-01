'use client'

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ECGMonitor from '@/components/ecg-monitor'
import type { DiscoveredService } from '@/lib/ble/bleManager'
import type { EcgStore } from '@/lib/ecg/ecgStore'
import { ECG_SAMPLE_RATE, ECG_SAMPLES_PER_PACKET } from '@/lib/ecg/signal'
import { CHARACTERISTICS, enumLabel, POWER_STATES, type DeviceStatus, type Sensor } from '@/lib/protocol/wearableProtocol'

type Vital = { index: number; hr: number; spo2: number }
type ConfigState = 'on' | 'off' | 'paused' | 'unknown' | 'info'
type ConfigItem = { label: string; state: ConfigState; value: string; detail: string }

type Props = {
  store: EcgStore
  mode: 'demo' | 'real'
  ecgActive: boolean
  onStartEcg: () => void
  onStopEcg: () => void
  sensor: Sensor | null
  status: DeviceStatus | null
  vitals: Vital[]
  /** Demo mode only: whether the simulated measurement loop is running. */
  simulationRunning: boolean
  connected: boolean
  services: DiscoveredService[]
}

const STATE_LABEL: Record<ConfigState, string> = { on: 'On', off: 'Off', paused: 'Paused', unknown: 'Unknown', info: '' }
const onOff = (value: boolean | undefined): ConfigState => (value == null ? 'unknown' : value ? 'on' : 'off')

/**
 * What the app can tell about the MAX86150 from protocol v1. The firmware reports
 * channel activity through FE42/FE43 flags; register-level settings are not exposed.
 */
function buildConfig({ mode, ecgActive, sensor, status, simulationRunning, connected, services }: Props): ConfigItem[] {
  if (mode === 'demo') {
    return [
      { label: 'ECG channel', state: onOff(ecgActive), value: STATE_LABEL[onOff(ecgActive)], detail: `Simulated · ${ECG_SAMPLE_RATE} Hz, ${ECG_SAMPLES_PER_PACKET} samples/packet` },
      { label: 'PPG channel (HR / SpO₂)', state: ecgActive ? 'paused' : onOff(simulationRunning), value: STATE_LABEL[ecgActive ? 'paused' : onOff(simulationRunning)], detail: ecgActive ? 'Simulated · HR and SpO₂ pause while ECG records' : 'Simulated measurement loop' },
      { label: 'Firmware sensor block', state: 'on', value: 'Ready', detail: 'Simulated' },
      { label: 'Wear detection', state: onOff(sensor ? sensor.wear === 'WORN' : undefined), value: sensor?.wear ?? 'Unknown', detail: 'Simulated' },
      { label: 'Register settings', state: 'unknown', value: 'Not reported', detail: 'LED current, sample rate, ADC range and FIFO are not part of protocol v1' },
    ]
  }

  const ecgReported = status || sensor ? Boolean(status?.ecgActive || sensor?.ecgActive) : undefined
  const ecg = onOff(ecgReported)
  // The firmware pauses HR/SpO₂ while ECG records. While measuring, protocol v1 cannot tell real PPG values
  // from the firmware's placeholders, so the channel is never reported as "on".
  const ppg: ConfigState = ecg === 'on' ? 'paused' : status?.measurementRaw === 0 ? 'off' : 'unknown'
  const ppgValue = ppg === 'unknown' && status?.measurementRaw === 1 ? 'Unverified' : STATE_LABEL[ppg]
  const ppgDetail = ppg === 'paused' ? 'HR and SpO₂ pause while ECG records'
    : status?.measurementRaw === 1 ? 'Measuring, but FE42 has no validity flag: values may be firmware placeholders'
    : status ? `FE43 measurement state: ${status.measurement}` : 'No FE43 status received yet'
  const ecgCharacteristic = connected ? services.some((service) => service.characteristics.some((item) => item.uuid.toLowerCase() === CHARACTERISTICS.ECG_DATA && item.notifiable)) : undefined
  const wear = status ? status.wearDetected : sensor ? sensor.wear === 'WORN' : undefined
  const power = status ? enumLabel(POWER_STATES, status.power) : 'Unknown'

  return [
    { label: 'ECG channel', state: ecg, value: STATE_LABEL[ecg], detail: ecgReported == null ? 'No FE42/FE43 notification received yet' : `Flag 0x20 in FE42/FE43 · ${ECG_SAMPLE_RATE} Hz, ${ECG_SAMPLES_PER_PACKET} samples/packet` },
    { label: 'PPG channel (HR / SpO₂)', state: ppg, value: ppgValue, detail: ppgDetail },
    { label: 'ECG notifications (FE45)', state: onOff(ecgCharacteristic), value: ecgCharacteristic == null ? 'Not connected' : ecgCharacteristic ? 'Subscribed' : 'Not found', detail: ecgCharacteristic === false ? 'The connected firmware does not expose FE45' : 'Optional characteristic, subscribed on connect' },
    { label: 'Firmware sensor block', state: onOff(status?.sensorReady), value: status ? (status.sensorReady ? 'Ready' : 'Not ready') : 'Unknown', detail: status && status.errorCode ? `Error 0x${status.errorCode.toString(16).padStart(2, '0')}: ${status.error}` : 'FE43 byte 1: firmware initialised, not proof the MAX86150 itself works' },
    { label: 'Wear detection', state: onOff(wear), value: wear == null ? 'Unknown' : wear ? 'Worn' : 'Not worn', detail: 'Flag 0x40 in FE42/FE43' },
    { label: 'Power mode', state: status ? 'info' : 'unknown', value: power, detail: 'FE43 byte 3' },
    { label: 'Register settings', state: 'unknown', value: 'Not reported', detail: 'LED current, sample rate, ADC range and FIFO are not part of protocol v1' },
  ]
}

export default function Max86150View(props: Props) {
  const { store, mode, ecgActive, onStartEcg, onStopEcg, sensor, vitals } = props
  const config = buildConfig(props)
  const ppgPaused = mode === 'real' && config[1].state === 'paused'
  const trend = vitals.slice(-30)

  return (
    <div className="view-stack max86150-view">
      <section className="info-card sensor-config">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">MAX86150 · CONFIGURATION</p>
            <h2>What is on and off</h2>
          </div>
          <span className="last-updated">{mode === 'demo' ? 'Simulation' : 'Reported by firmware'}</span>
        </div>
        <div className="config-grid">
          {config.map((item) => (
            <div className="config-item" key={item.label}>
              <div className="config-top">
                <span>{item.label}</span>
                <b className={`config-pill ${item.state}`}><i />{item.value}</b>
              </div>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </section>

      <ECGMonitor store={store} mode={mode} active={ecgActive} onStart={onStartEcg} onStop={onStopEcg} />

      <section className="info-card ppg-card">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">PPG · FE42</p>
            <h2>Heart rate and SpO₂</h2>
          </div>
          <span className={`config-pill ${config[1].state}`}><i />{config[1].value}</span>
        </div>
        <div className="ppg-values">
          <div className="ecg-stat"><span>Heart rate</span><strong>{sensor ? sensor.heartRate : '--'}<small>bpm</small></strong></div>
          <div className="ecg-stat"><span>SpO₂</span><strong>{sensor ? sensor.spo2 : '--'}<small>%</small></strong></div>
        </div>
        {trend.length > 1 ? (
          <div className="ppg-chart">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="index" hide />
                <YAxis yAxisId="hr" domain={['dataMin - 5', 'dataMax + 5']} width={34} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="spo2" orientation="right" domain={[85, 100]} width={34} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<PpgTooltip />} />
                <Line yAxisId="hr" type="monotone" dataKey="hr" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="spo2" type="monotone" dataKey="spo2" stroke="var(--chart-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="chart-legend">
              <span className="legend-x"><i />Heart rate (bpm, left axis)</span>
              <span className="legend-y"><i />SpO₂ (%, right axis)</span>
            </div>
          </div>
        ) : (
          <div className="chart-empty ppg-empty">{mode === 'real' ? 'Waiting for FE42 sensor notifications.' : 'Start the simulation to see the trend.'}</div>
        )}
        <p className="card-footnote">
          {ppgPaused ? 'HR and SpO₂ are paused while ECG records; the values above are the last ones received. ' : ''}
          Values are FE42 bytes 0–1 as sent by the firmware, last {trend.length} readings.{mode === 'real' ? ' Protocol v1 has no validity flag: when the MAX86150 is not running, the firmware sends placeholder values (HR cycling 68→82, 72 before the first beat; SpO₂ fixed at 98) that look like real readings.' : ''} The raw IR/Red waveform is not sent in protocol v1.
        </p>
      </section>
    </div>
  )
}

function PpgTooltip({ active, payload }: { active?: boolean; payload?: { payload: Vital }[] }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="accel-tooltip">
      <span className="tooltip-x">HR {point.hr} bpm</span>
      <span className="tooltip-y">SpO₂ {point.spo2}%</span>
    </div>
  )
}
