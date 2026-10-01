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

/** Spec §2 / §14.12: an enum value the app does not know is shown as `Unknown (0x..)`, never guessed. */
export const unknownEnum = (value: number) => `Unknown (0x${(value & 0xff).toString(16).padStart(2, '0').toUpperCase()})`
export const enumLabel = (labels: Record<number, string>, value: number) => labels[value] ?? unknownEnum(value)
/** Power state byte (FE42 byte 6, FE43 byte 3). Firmware v1 only sends 1 or 2. */
export const POWER_STATES: Record<number, string> = { 1: 'Normal', 2: 'Low power' }
export const MEASUREMENT_STATES: Record<number, string> = { 0: 'Idle', 1: 'Measuring', 2: 'ECG active', 3: 'Low power', 4: 'Emergency', 5: 'Error' }
export const ERROR_CODES: Record<number, string> = { 0: 'None', 1: 'Invalid command', 0x10: 'Temperature sensor not present', 0x11: 'Temperature timeout', 0x12: 'Temperature bus error' }

/** Service and characteristic UUIDs */
export const SERVICE_UUID = '0000fe40-cc7a-482a-984a-7f2ed5b3e58f'
export const CHARACTERISTICS = {
  CONTROL: '0000fe41-8e22-4541-9d4c-21edae82ed19',        // write, 8-byte control commands
  SENSOR_DATA: '0000fe42-8e22-4541-9d4c-21edae82ed19',   // notify, 16-byte sensor readings, 1 Hz while measuring
  DEVICE_STATUS: '0000fe43-8e22-4541-9d4c-21edae82ed19', // notify, 8-byte device status, on command or change
  NFC_EVENT: '0000fe44-8e22-4541-9d4c-21edae82ed19',      // notify; in the GATT table, firmware never sends it yet
  ECG_DATA: '0000fe45-8e22-4541-9d4c-21edae82ed19',       // notify, 9 int16 samples per packet at 200 Hz
  DEBUG_DATA: '0000fe46-8e22-4541-9d4c-21edae82ed19',     // notify: LoRa status packet 0x20; firmware ignores writes for now
  RECOVERY_DATA: '0000fe47-8e22-4541-9d4c-21edae82ed19',  // notify; history records, not working end-to-end in firmware yet
} as const

export type CharacteristicKey = keyof typeof CHARACTERISTICS

/** Characteristic metadata: GATT properties as in spec §4.2. */
export const CHARACTERISTIC_METADATA: Record<CharacteristicKey, { label: string; properties: readonly ('read' | 'write' | 'notify')[]; required: boolean }> = {
  CONTROL: { label: 'Control', properties: ['write'], required: true },
  SENSOR_DATA: { label: 'Sensor Data', properties: ['read', 'notify'], required: true },
  DEVICE_STATUS: { label: 'Device Status', properties: ['read', 'notify'], required: true },
  NFC_EVENT: { label: 'NFC Event', properties: ['read', 'notify'], required: false },
  ECG_DATA: { label: 'ECG Data', properties: ['read', 'notify'], required: false },
  DEBUG_DATA: { label: 'Debug Data', properties: ['read', 'write', 'notify'], required: false },
  RECOVERY_DATA: { label: 'Recovery Data', properties: ['read', 'notify'], required: false },
}

/** SYNC_TIME: command byte + Unix seconds + milliseconds, little-endian. The firmware has no ACK packet; it answers with a DEVICE_STATUS notification. */
export function syncTimePacket(date = new Date()) { const ms = date.getTime(); const packet = new Uint8Array(SYNC_TIME_LENGTH); const view = new DataView(packet.buffer); packet[0] = 0x09; view.setUint32(1, Math.floor(ms / 1000), true); view.setUint16(5, ms % 1000, true); packet[7] = 0x00; return packet }

export const CONTROL_COMMANDS = [
  [0x01, 'Start measurement'], [0x02, 'Stop measurement'], [0x03, 'Request data'],
  [0x04, 'Normal mode'], [0x05, 'Low-power mode'], [0x06, 'ECG start'],
  [0x07, 'ECG stop'], [0x08, 'Emergency test'], [0x09, 'Synchronize time'],
  [0x0E, 'Clear history'],
] as const

/** LoRaWAN test commands on CONTROL / FE41. The firmware answers each one with LoRa status packet 0x20 on DEBUG_DATA / FE46. */
export const LORA_COMMANDS = { JOIN: 0x0f, TEST_UPLINK: 0x10, STATUS: 0x11, TX_POWER: 0x12, LEAVE: 0x13 } as const
export const LORA_TX_POWER_MIN_DBM = -9
export const LORA_TX_POWER_MAX_DBM = 22
/** Byte 1 of TX_POWER is the SX1262 output power cap, int8 dBm. */
export function loraCommandPacket(command: number, txPowerDbm = 0) { const bytes = new Uint8Array(8); bytes[0] = command; if (command === LORA_COMMANDS.TX_POWER) new DataView(bytes.buffer).setInt8(1, txPowerDbm); return bytes }

export const LORA_STATUS_CODE = 0x20
export const LORA_STATE_NOT_BUILT = 0xff
export const LORA_STATES: Record<number, string> = { 0: 'Not started / left', 1: 'No credentials', 2: 'Joining', 3: 'Joined', 4: 'Join failed (retrying)', 5: 'Modem API error', 0xff: 'Not built in firmware' }
export const LORA_EVENTS: Record<number, string> = { 0: 'Reset', 1: 'Alarm', 2: 'Joined', 3: 'TX done', 4: 'Downlink', 5: 'Join failed' }
export const LORA_TX_DONE: Record<number, string> = { 0: 'Not sent', 1: 'Sent', 2: 'Confirmed' }
export const LORA_RESULTS: Record<number, string> = { 0: 'OK', 1: 'LoRa not built in firmware', 2: 'Not joined yet', 3: 'Modem refused (see modem rc)', 4: 'Invalid TX power', 0xff: 'Modem event' }
export const LORA_MODEM_RC: Record<number, string> = { 0: 'OK', 1: 'Not initialised', 2: 'Invalid', 3: 'Busy', 4: 'Fail', 5: 'No time', 6: 'Invalid stack ID', 7: 'No event' }

/** DEBUG_DATA / FE46 packet 0x20 (20 bytes, little-endian). */
export interface LoraStatus {
  state: number
  stateLabel: string
  txPowerDbm: number
  lastEvent: number
  txDoneStatus: number
  lastRc: number
  commandResult: number
  initStage: number
  uplinkCount: number
  eventCount: number
  downlinkCount: number
  panicCount: number
  busyTimeouts: number
  spiErrors: number
  receivedAt: number
}

export function decodeLoraStatus(data: DataView): LoraStatus {
  if (data.byteLength !== DEBUG_DATA_LENGTH || data.getUint8(0) !== LORA_STATUS_CODE) throw new Error('LoRa status must be a 20-byte FE46 packet starting with 0x20')
  const state = data.getUint8(1)
  return { state, stateLabel: enumLabel(LORA_STATES, state), txPowerDbm: data.getInt8(2), lastEvent: data.getUint8(3), txDoneStatus: data.getUint8(4), lastRc: data.getInt8(5), commandResult: data.getUint8(6), initStage: data.getUint8(7), uplinkCount: data.getUint16(8, true), eventCount: data.getUint16(10, true), downlinkCount: data.getUint16(12, true), panicCount: data.getUint16(14, true), busyTimeouts: data.getUint16(16, true), spiErrors: data.getUint16(18, true), receivedAt: Date.now() }
}

export const UNSUPPORTED_CHARACTERISTICS = [CHARACTERISTICS.NFC_EVENT, CHARACTERISTICS.DEBUG_DATA, CHARACTERISTICS.RECOVERY_DATA] as const

export function buildTimeSyncPacket(date = new Date()) { return syncTimePacket(date) }

export type WearState = 'WORN' | 'NOT WORN' | 'UNKNOWN'

/**
 * App-side power settings used by lib/wearableRepository.ts. They are NOT on the wire (spec §17.2 W2):
 * the BLE power state is only 1 = Normal or 2 = Low power, see POWER_STATES.
 */
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
  WEAR_DETECTED = 0x40,
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
  /** Host receive time of the BLE notification: performance.timeOrigin + performance.now(), in ms. */
  hostRxMs?: number
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
  /** Firmware qvar_raw, payload bytes 14-15, little-endian signed int16. */
  qvarRaw: number
}

export function decodeSensor(data: DataView): Sensor {
  if (data.byteLength !== SENSOR_DATA_LENGTH) throw new Error(`Sensor Data must be ${SENSOR_DATA_LENGTH} bytes`)
  const flags = data.getUint8(7)
  return { heartRate: data.getUint8(0), spo2: data.getUint8(1), temperature: data.getInt16(2, true) === TEMP_INVALID ? null : data.getInt16(2, true) / 100, supercap: data.getUint16(4, true), power: data.getUint8(6), flags, emergency: !!(flags & SensorFlags.EMERGENCY), ecgActive: !!(flags & SensorFlags.ECG_ACTIVE), fallCandidate: !!(flags & SensorFlags.FALL_CANDIDATE), wear: !!(flags & SensorFlags.WEAR_DETECTED) ? 'WORN' : 'NOT WORN', x: data.getInt16(8, true), y: data.getInt16(10, true), z: data.getInt16(12, true), magnitude: Math.sqrt(data.getInt16(8, true) ** 2 + data.getInt16(10, true) ** 2 + data.getInt16(12, true) ** 2), qvarRaw: data.getInt16(14, true) }
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
  emergency: boolean
  ecgActive: boolean
  wearDetected: boolean
}

export function decodeStatus(data: DataView): DeviceStatus {
  if (data.byteLength !== DEVICE_STATUS_LENGTH) throw new Error(`Device Status must be ${DEVICE_STATUS_LENGTH} bytes`)
  const flags = data.getUint8(7)
  const measurement = enumLabel(MEASUREMENT_STATES, data.getUint8(0))
  return { measurement, measurementRaw: data.getUint8(0), sensorReady: data.getUint8(1) !== 0, error: enumLabel(ERROR_CODES, data.getUint8(2)), errorCode: data.getUint8(2), power: data.getUint8(3), supercap: data.getUint16(4, true), resetCounter: data.getUint8(6), flags, protocolVersion: flags & 0x0f, emergency: !!(flags & 0x10), ecgActive: !!(flags & 0x20), wearDetected: !!(flags & 0x40) }
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
