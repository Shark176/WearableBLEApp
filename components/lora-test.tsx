'use client'

import { useEffect, useState } from 'react'
import { Radio, RefreshCw, Send, Square, Wifi } from 'lucide-react'
import { enumLabel, LORA_COMMANDS, LORA_EVENTS, LORA_MODEM_RC, LORA_RESULTS, LORA_STATE_NOT_BUILT, LORA_TX_DONE, LORA_TX_POWER_MAX_DBM, LORA_TX_POWER_MIN_DBM, type LoraStatus } from '@/lib/protocol/wearableProtocol'

type Props = {
  status: LoraStatus | null
  mode: 'demo' | 'real'
  connected: boolean
  onCommand: (command: number, txPowerDbm?: number) => Promise<void>
}

/* Approximate SX1262 TX current per output power, from the firmware RAL table (DC-DC, high-power PA). */
const TX_PRESETS = [[-9, '24 mA'], [0, '41 mA'], [5, '54 mA'], [10, '71 mA'], [14, '89 mA']] as const
const INIT_STAGES: Record<number, string> = { 0: 'Not started', 1: 'Starting (smtc_modem_init)', 2: 'Started' }

export default function LoraTest({ status, mode, connected, onCommand }: Props) {
  const [txPower, setTxPower] = useState(0)
  const [busy, setBusy] = useState(false)
  const [, setNow] = useState(0)
  // Re-render once a second so the "x s ago" age of the last status stays current.
  useEffect(() => { if (!status) return; const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id) }, [status])
  const usable = mode === 'real' && connected && status?.state !== LORA_STATE_NOT_BUILT
  const run = async (command: number, power?: number) => { setBusy(true); try { await onCommand(command, power) } finally { setBusy(false) } }
  const powerValid = Number.isInteger(txPower) && txPower >= LORA_TX_POWER_MIN_DBM && txPower <= LORA_TX_POWER_MAX_DBM
  const row = (label: string, value: string) => <div className="info-row" key={label}><span>{label}</span><b>{value}</b></div>
  const age = status ? `${Math.max(0, Math.round((Date.now() - status.receivedAt) / 1000))} s ago` : '--'

  return <div className="view-stack">
    <section className="debug-intro"><div><p className="eyebrow">LORAWAN TEST · FE41 → FE46</p><h2>LoRa test</h2><p className="subheading">OTAA join and test uplinks on demand. LoRa never starts on its own: nothing is transmitted until you press Join.</p></div><Radio size={22} className="debug-icon" /></section>

    {mode === 'demo' && <section className="info-card"><p className="empty-state">Switch to Real mode and connect the wearable to test LoRa.</p></section>}

    <section className="info-card">
      <div className="section-heading compact"><div><p className="eyebrow">TX POWER CAP</p><h2>{status ? `${status.txPowerDbm} dBm on the device` : 'Unknown until the first status'}</h2></div><Wifi size={18} className="muted-icon" /></div>
      <p className="feature-note">Lower power means a lower current peak on the SX1262 during the join and uplinks, at the cost of range. The cap resets to the firmware default (0 dBm) after a device reset.</p>
      <div className="button-row" style={{ flexWrap: 'wrap', margin: '10px 0' }}>{TX_PRESETS.map(([dbm, current]) => <button key={dbm} className="secondary-btn" disabled={busy} onClick={() => setTxPower(dbm)} style={txPower === dbm ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : undefined}>{dbm} dBm · ~{current}</button>)}</div>
      <div className="raw-write"><input aria-label="TX power in dBm" type="number" min={LORA_TX_POWER_MIN_DBM} max={LORA_TX_POWER_MAX_DBM} step={1} value={Number.isNaN(txPower) ? '' : txPower} onChange={(event) => setTxPower(event.target.value === '' ? Number.NaN : Number(event.target.value))} /><button className="secondary-btn" disabled={!usable || busy || !powerValid} onClick={() => run(LORA_COMMANDS.TX_POWER, txPower)}><Send size={14} /> Set TX power</button></div>
      {!powerValid && <p className="feature-note">TX power must be an integer from {LORA_TX_POWER_MIN_DBM} to {LORA_TX_POWER_MAX_DBM} dBm.</p>}
    </section>

    <section className="control-card">
      <div className="section-heading compact"><div><p className="eyebrow">COMMANDS</p><h2>LoRaWAN actions</h2></div></div>
      <div className="button-row" style={{ flexWrap: 'wrap' }}>
        <button className="primary-btn" disabled={!usable || busy} onClick={() => run(LORA_COMMANDS.JOIN)}><Radio size={15} /> Join (OTAA)</button>
        <button className="secondary-btn" disabled={!usable || busy} onClick={() => run(LORA_COMMANDS.TEST_UPLINK)}><Send size={14} /> Send test uplink</button>
        <button className="secondary-btn" disabled={!usable || busy} onClick={() => run(LORA_COMMANDS.LEAVE)}><Square size={14} /> Stop LoRa</button>
        <button className="secondary-btn" disabled={mode !== 'real' || !connected || busy} onClick={() => run(LORA_COMMANDS.STATUS)}><RefreshCw size={14} /> Refresh status</button>
      </div>
      <small>Join: starts the modem on the first press, then joins. Test uplink: one unconfirmed uplink on FPort 101 carrying the uplink counter (4 bytes, big-endian; needs a join). Stop: leaves the network, the radio stays asleep.</small>
    </section>

    <section className="info-card">
      <div className="section-heading compact"><div><p className="eyebrow">STATUS · FE46 PACKET 0x20</p><h2>{status ? status.stateLabel : 'No status received'}</h2></div><span className={`status-dot ${status?.state === 3 ? 'online' : ''}`} /></div>
      {status ? <>
        {row('Last answer', `${enumLabel(LORA_RESULTS, status.commandResult)} · ${age}`)}
        {row('Modem', INIT_STAGES[status.initStage] ?? String(status.initStage))}
        {row('Last modem event', status.eventCount ? enumLabel(LORA_EVENTS, status.lastEvent) : 'None')}
        {row('Last TX', enumLabel(LORA_TX_DONE, status.txDoneStatus))}
        {row('Uplinks requested', String(status.uplinkCount))}
        {row('Downlinks', String(status.downlinkCount))}
        {row('Modem events', String(status.eventCount))}
        {row('Last modem rc', enumLabel(LORA_MODEM_RC, status.lastRc))}
        {row('Radio faults (panic / BUSY timeout / SPI)', `${status.panicCount} / ${status.busyTimeouts} / ${status.spiErrors}`)}
      </> : <p className="empty-state">{mode === 'real' && connected ? 'Press Refresh status to read the LoRa state.' : 'Connect the wearable first.'}</p>}
    </section>
  </div>
}
