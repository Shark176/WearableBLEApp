import { PowerMode, PowerProfile, type HistoricalRecord, type PowerConfiguration, type Sensor } from './protocol/wearableProtocol'

export type RecoverySession = {
  id: string
  source: 'BLE_RECOVERY' | 'NFC_RECOVERY'
  startedAt: number
  completedAt?: number
  localStartSequence: number
  deviceStartSequence?: number
  received: number
  missing: number
  status: 'idle' | 'running' | 'complete' | 'error'
  error?: string
}

export type ECGSession = { id: string; startedAt: number; endedAt?: number; sampleCount: number; rawPackets: Uint8Array[] }

export type WearableRepositoryState = {
  records: HistoricalRecord[]
  recoverySessions: RecoverySession[]
  ecgSessions: ECGSession[]
  powerConfiguration: PowerConfiguration
  lastSequence: number
}

const defaultState = (): WearableRepositoryState => ({
  records: [], recoverySessions: [], ecgSessions: [], lastSequence: 0,
  powerConfiguration: { mode: PowerMode.AUTO, profile: PowerProfile.NORMAL, sensorAcquisitionRateHz: 10, processingRateHz: 5, bleReportingIntervalMs: 1000, st25dvLoggingIntervalMs: 5000 },
})

/** Session-scoped repository. Persistence is intentionally injectable so firmware apps can provide durable storage. */
export class WearableRepository {
  private state = defaultState()
  private listeners = new Set<(state: WearableRepositoryState) => void>()
  subscribe(listener: (state: WearableRepositoryState) => void) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener) }
  private publish() { for (const listener of this.listeners) listener(this.state) }
  get snapshot() { return this.state }
  setPowerConfiguration(configuration: PowerConfiguration) { this.state = { ...this.state, powerConfiguration: configuration }; this.publish() }
  addLiveRecord(record: HistoricalRecord) { return this.addRecords([{ ...record, source: 'LIVE_BLE' }]) }
  addRecoveryRecords(records: HistoricalRecord[], source: 'BLE_RECOVERY' | 'NFC_RECOVERY') { return this.addRecords(records.map((record) => ({ ...record, source }))) }
  addRecords(records: HistoricalRecord[]) {
    const bySequence = new Map(this.state.records.map((record) => [record.sequence, record]))
    for (const record of records) if (!bySequence.has(record.sequence)) bySequence.set(record.sequence, record)
    const merged = [...bySequence.values()].sort((a, b) => a.sequence - b.sequence)
    this.state = { ...this.state, records: merged, lastSequence: Math.max(this.state.lastSequence, ...records.map((record) => record.sequence), 0) }
    this.publish(); return merged
  }
  beginRecovery(source: RecoverySession['source'], localStartSequence: number): RecoverySession { const session = { id: crypto.randomUUID(), source, startedAt: Date.now(), localStartSequence, received: 0, missing: 0, status: 'running' as const }; this.state = { ...this.state, recoverySessions: [...this.state.recoverySessions, session] }; this.publish(); return session }
  updateRecovery(id: string, patch: Partial<RecoverySession>) { this.state = { ...this.state, recoverySessions: this.state.recoverySessions.map((session) => session.id === id ? { ...session, ...patch } : session) }; this.publish() }
  startECG(): ECGSession { const session = { id: crypto.randomUUID(), startedAt: Date.now(), sampleCount: 0, rawPackets: [] }; this.state = { ...this.state, ecgSessions: [...this.state.ecgSessions, session] }; this.publish(); return session }
  addECGRawPacket(id: string, packet: Uint8Array) { this.state = { ...this.state, ecgSessions: this.state.ecgSessions.map((session) => session.id === id ? { ...session, rawPackets: [...session.rawPackets, packet], sampleCount: session.sampleCount + packet.byteLength } : session) }; this.publish() }
  endECG(id: string) { this.state = { ...this.state, ecgSessions: this.state.ecgSessions.map((session) => session.id === id ? { ...session, endedAt: Date.now() } : session) }; this.publish() }
  clearHistory() { this.state = { ...this.state, records: [], lastSequence: 0 }; this.publish() }
}

export function createHistoricalRecord(sequence: number, sensor: Sensor, source: HistoricalRecord['source'] = 'LIVE_BLE'): HistoricalRecord { return { sequence, timestamp: Date.now(), data: sensor, source } }

export const wearableRepository = new WearableRepository()
