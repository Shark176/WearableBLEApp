export const QVAR_ENABLED = false

export type QVARState = 'UNKNOWN' | 'WORN' | 'NOT_WORN'

export interface QVARData {
  rawValue?: number
  filteredValue?: number
  timestamp: number
}

export interface WearStatus {
  state: QVARState
  timestamp: number
  qvarValue?: number
  source: 'HARDWARE' | 'SIMULATED' | 'UNAVAILABLE'
}

export interface QVARDataSource {
  readonly kind: 'hardware' | 'demo' | 'unavailable'
  read(): Promise<QVARData | null>
}

export function classifyWearStatus(data: QVARData | null, source: WearStatus['source'] = 'UNAVAILABLE'): WearStatus {
  if (!data) return { state: 'UNKNOWN', timestamp: Date.now(), source }
  // Intentionally no threshold: the firmware-defined classifier is not available yet.
  return { state: 'UNKNOWN', timestamp: data.timestamp, qvarValue: data.filteredValue ?? data.rawValue, source }
}

export function unavailableWearStatus(timestamp = Date.now()): WearStatus {
  return { state: 'UNKNOWN', timestamp, source: 'UNAVAILABLE' }
}

export function simulatedWearStatus(state: Exclude<QVARState, 'UNKNOWN'> | 'UNKNOWN', timestamp = Date.now()): WearStatus {
  return { state, timestamp, source: 'SIMULATED' }
}
