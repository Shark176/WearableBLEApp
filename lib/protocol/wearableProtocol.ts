/**
 * WearableHealthService (0xFE40 namespace) — consolidated protocol v1
 * Characteristics: FE40–FE47 UUID base with service and endpoints
 */

export const SENSOR_DATA_LENGTH = 16
export const DEVICE_STATUS_LENGTH = 8
export const SYNC_TIME_LENGTH = 8
export const ECG_DATA_LENGTH = 20
export const NFC_EVENT_LENGTH = 20
export const DEBUG_DATA_LENGTH = 20
export const RECOVERY_DATA_LENGTH = 24
export const TEMP_INVALID = -32768

/** Service and characteristic UUIDs */
export const SERVICE_UUID = '0000fe40-cc7a-482a-984a-7f2ed5b3e58f'
export const CHARACTERISTICS = {
  CONTROL: '0000fe41-8e22-4541-9d4c-21edae82ed19',        // write, v1 control commands
  SENSOR_DATA: '0000fe42-8e22-4541-9d4c-21edae82ed19',   // notify, 16-byte sensor readings
  DEVICE_STATUS: '0000fe43-8e22-4541-9d4c-21edae82ed19', // notify, 8-byte device status
  NFC_EVENT: '0000fe44-8e22-4541-9d4c-21edae82ed19',      // notify optional; FE44 NFC event payload (v1: undefined, firmware-supplied)
  ECG_DATA: '0000fe45-8e22-4541-9d4c-21edae82ed19',       // notify optional; FE45 ECG raw samples (v1: undefined, firmware-supplied)
  DEBUG_DATA: '0000fe46-8e22-4541-9d4c-21edae82ed19',     // read/write optional; FE46 debug commands/responses (v1: undefined, firmware-supplied)
  RECOVERY_DATA: '0000fe47-8e22-4541-9d4c-21edae82ed19',  // read/notify optional; FE47 historical recovery envelope (v1: undefined, firmware-supplied)
} as const

export type CharacteristicKey = keyof typeof CHARACTERISTICS

/** Characteristic metadata for discovery */
export const CHARACTERISTIC_METADATA: Record<CharacteristicKey, { label: string; direction: 'read' | 'write' | 'notify'; required: boolean }> = {
  CONTROL: { label: 'Control', direction: 'write', required: true },
  SENSOR_DATA: { label: 'Sensor Data', direction: 'notify', required: true },
  DEVICE_STATUS: { label: 'Device Status', direction: 'notify', required: true },
  NFC_EVENT: { label: 'NFC Event', direction: 'notify', required: false },
  ECG_DATA: { label: 'ECG Data', direction: 'notify', required: false },
  DEBUG_DATA: { label: 'Debug Data', direction: 'read', required: false },
  RECOVERY_DATA: { label: 'Recovery Data', direction: 'notify', required: false },
}

/** SYNC_TIME: Unix epoch seconds, little-endian uint64. */
export function syncTimePacket(epochSeconds = Math.floor(Date.now() / 1000)) { const packet = new Uint8Array(SYNC_TIME_LENGTH); let value = BigInt(epochSeconds); for (let index = 0; index < SYNC_TIME_LENGTH; index += 1) { packet[index] = Number(value & 0xffn); value >>= 8n } return packet }
export function decodeSyncTimeAck(data: DataView) { if (data.byteLength < SYNC_TIME_LENGTH) throw new Error(`SYNC_TIME ACK must be ${SYNC_TIME_LENGTH} bytes`); let epoch = 0n; for (let index = SYNC_TIME_LENGTH - 1; index >= 0; index -= 1) epoch = (epoch << 8n) | BigInt(data.getUint8(index)); return Number(epoch) }

export const CONTROL_COMMANDS = [
  [0x01, 'Start measurement'], [0x02, 'Stop measurement'], [0x03, 'Request data'],
  [0x04, 'Normal mode'], [0x05, 'Low-power mode'], [0x06, 'ECG start'],
  [0x07, 'ECG stop'], [0x08, 'Emergency test'],
] as const

export type WearState = 'WORN' | 'NOT WORN' | 'UNKNOWN'

/** Power and flag enums */
export enum PowerProfile {
  HIGH = 0x00,
  NORMAL = 0x01,
  LOW = 0x02,
  CRITICAL = 0x03,
}

export enum PowerMode {
  AUTO = 0x00,
  MANUAL = 0x01,
}

export enum SensorFlags {
  FALL_CANDIDATE = 0x08,
  EMERGENCY = 0x10,
  ECG_ACTIVE = 0x20,
}

/** Historical record model — source-aware deduplication */
export interface HistoricalRecord {
  sequence: number
  timestamp: number
  source: 'LIVE_BLE' | 'BLE_RECOVERY' | 'NFC_RECOVERY'
  data: Sensor
  crc?: number
  raw?: Uint8Array
}

/** ECG packet decoder (20 bytes: seq + sample count + 9 int16 samples) */
export interface ECGPacket {
  sequence: number
  sampleCount: number
  samples: number[]
  raw: Uint8Array
}

export function decodeECGData(data: DataView): ECGPacket {
  if (data.byteLength !== 20) throw new Error('ECG Data must be 20 bytes')
  const sequence = data.getUint8(0)
  const sampleCount = Math.min(data.getUint8(1), 9) // max 9 samples per packet
  const samples: number[] = []
  for (let i = 0; i < sampleCount; i++) {
    const offset = 2 + i * 2
    samples.push(data.getInt16(offset, true)) // little-endian int16
  }
  return { sequence, sampleCount, samples, raw: readBytes(data) }
}

/** NFC Data (20 bytes: state, lastEvent, ftmStatus, configResult, recoveryStatus, + 15 reserved) */
export interface NFCData {
  state: number
  lastEvent: number
  ftmStatus: number
  configResult: number
  recoveryStatus: number
  raw: Uint8Array
}

export function decodeNFCData(data: DataView): NFCData {
  if (data.byteLength !== 20) throw new Error('NFC Data must be 20 bytes')
  return {
    state: data.getUint8(0),
    lastEvent: data.getUint8(1),
    ftmStatus: data.getUint8(2),
    configResult: data.getUint8(3),
    recoveryStatus: data.getUint8(4),
    raw: readBytes(data),
  }
}

/** Debug command/response (20 bytes: command + 19 params) */
export interface DebugCommand {
  command: number
  params: Uint8Array
  raw: Uint8Array
}

export function decodeDebugData(data: DataView): DebugCommand {
  if (data.byteLength !== 20) throw new Error('Debug Data must be 20 bytes')
  const command = data.getUint8(0)
  const params = readBytes(data).slice(1)
  return { command, params, raw: readBytes(data) }
}

/** Adaptive power configuration (TODO: actual firmware thresholds undefined) */
export interface PowerConfiguration {
  mode: PowerMode
  profile: PowerProfile
  sensorAcquisitionRateHz?: number
  processingRateHz?: number
  bleReportingIntervalMs?: number
  st25dvLoggingIntervalMs?: number
  lowBatteryThresholdMv?: number
  criticalBatteryThresholdMv?: number
  hysteresisMv?: number
}

export function bytesToHex(bytes: Uint8Array) { return [...bytes].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ') }
export function readBytes(data: DataView) { return new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }

export interface Sensor {
  heartRate: number
  spo2: number
  temperature: number | null
  supercap: number
  power: number
  flags: number
  emergency: boolean
  ecgActive: boolean
  fallCandidate: boolean
  wear: WearState
  x: number
  y: number
  z: number
  magnitude: number
}

export function decodeSensor(data: DataView): Sensor {
  if (data.byteLength !== SENSOR_DATA_LENGTH) throw new Error(`Sensor Data must be ${SENSOR_DATA_LENGTH} bytes`)
  const flags = data.getUint8(7)
  return { heartRate: data.getUint8(0), spo2: data.getUint8(1), temperature: data.getInt16(2, true) === TEMP_INVALID ? null : data.getInt16(2, true) / 100, supercap: data.getUint16(4, true), power: data.getUint8(6), flags, emergency: !!(flags & SensorFlags.EMERGENCY), ecgActive: !!(flags & SensorFlags.ECG_ACTIVE), fallCandidate: !!(flags & SensorFlags.FALL_CANDIDATE), wear: 'UNKNOWN' as WearState, x: data.getInt16(8, true), y: data.getInt16(10, true), z: data.getInt16(12, true), magnitude: Math.sqrt(data.getInt16(8, true) ** 2 + data.getInt16(10, true) ** 2 + data.getInt16(12, true) ** 2) }
}

export interface DeviceStatus {
  measurement: string
  measurementRaw: number
  sensorReady: boolean
  error: string
  errorCode: number
  power: number
  supercap: number
  resetCounter: number
  flags: number
  protocolVersion: number
}

export function decodeStatus(data: DataView): DeviceStatus {
  if (data.byteLength !== DEVICE_STATUS_LENGTH) throw new Error(`Device Status must be ${DEVICE_STATUS_LENGTH} bytes`)
  const flags = data.getUint8(7)
  const measurement = ['Idle', 'Measuring', 'ECG active', 'Low power', 'Emergency', 'Error'][data.getUint8(0)] || 'UNKNOWN'
  const errors: Record<number, string> = { 0: 'None', 1: 'Invalid command', 0x10: 'Temperature sensor not present', 0x11: 'Temperature timeout', 0x12: 'Temperature bus error' }
  return { measurement, measurementRaw: data.getUint8(0), sensorReady: data.getUint8(1) !== 0, error: errors[data.getUint8(2)] || 'UNKNOWN', errorCode: data.getUint8(2), power: data.getUint8(3), supercap: data.getUint16(4, true), resetCounter: data.getUint8(6), flags: flags & 0xf0, protocolVersion: flags & 0x0f }
}

export function commandPacket(command: number) { const bytes = new Uint8Array(8); bytes[0] = command; return bytes }
export function parseHex(input: string) { const tokens = input.trim().split(/[\s,]+/).filter(Boolean); if (!tokens.length || tokens.some((token) => !/^[0-9a-fA-F]{2}$/.test(token))) throw new Error('HEX must contain space-separated byte pairs'); return new Uint8Array(tokens.map((token) => Number.parseInt(token, 16))) }

/** Recovery Data (24 bytes: seq(2) + timestamp(4) + sensor(16) + crc(2)) */
export interface RecoveryPacket {
  sequence: number
  timestamp: number
  sensor: Sensor
  crc: number
  raw: Uint8Array
}

export function decodeRecoveryData(data: DataView): RecoveryPacket {
  if (data.byteLength !== RECOVERY_DATA_LENGTH) throw new Error(`Recovery Data must be ${RECOVERY_DATA_LENGTH} bytes`)
  const sequence = data.getUint16(0, true) // little-endian uint16
  const timestamp = data.getUint32(2, true) // little-endian uint32
  const crc = data.getUint16(22, true) // little-endian uint16

  // Extract sensor payload (16 bytes from offset 6)
  const sensorView = new DataView(data.buffer, data.byteOffset + 6, 16)
  const sensor = decodeSensor(sensorView)

  return { sequence, timestamp, sensor, crc, raw: readBytes(data) }
}
