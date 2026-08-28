export const SENSOR_DATA_LENGTH = 16
export const DEVICE_STATUS_LENGTH = 8
export const TEMP_INVALID = -32768

export const CONTROL_COMMANDS = [
  [0x01, 'Start measurement'], [0x02, 'Stop measurement'], [0x03, 'Request data'],
  [0x04, 'Normal mode'], [0x05, 'Low-power mode'], [0x06, 'ECG start'],
  [0x07, 'ECG stop'], [0x08, 'Emergency test'],
] as const

export type WearState = 'WORN' | 'NOT WORN' | 'UNKNOWN'
export function bytesToHex(bytes: Uint8Array) { return [...bytes].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ') }
export function readBytes(data: DataView) { return new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
export function decodeSensor(data: DataView) {
  if (data.byteLength !== SENSOR_DATA_LENGTH) throw new Error(`Sensor Data must be ${SENSOR_DATA_LENGTH} bytes`)
  const flags = data.getUint8(7)
  return { heartRate: data.getUint8(0), spo2: data.getUint8(1), temperature: data.getInt16(2, true) === TEMP_INVALID ? null : data.getInt16(2, true) / 100, supercap: data.getUint16(4, true), power: data.getUint8(6), flags, emergency: !!(flags & 0x10), ecgActive: !!(flags & 0x20), fallCandidate: !!(flags & 0x08), wear: 'UNKNOWN' as WearState, x: data.getInt16(8, true), y: data.getInt16(10, true), z: data.getInt16(12, true), magnitude: Math.sqrt(data.getInt16(8, true) ** 2 + data.getInt16(10, true) ** 2 + data.getInt16(12, true) ** 2) }
}
export function decodeStatus(data: DataView) {
  if (data.byteLength !== DEVICE_STATUS_LENGTH) throw new Error(`Device Status must be ${DEVICE_STATUS_LENGTH} bytes`)
  const flags = data.getUint8(7)
  const measurement = ['Idle', 'Measuring', 'ECG active', 'Low power', 'Emergency', 'Error'][data.getUint8(0)] || 'UNKNOWN'
  const errors: Record<number, string> = { 0: 'None', 1: 'Invalid command', 0x10: 'Temperature sensor not present', 0x11: 'Temperature timeout', 0x12: 'Temperature bus error' }
  return { measurement, measurementRaw: data.getUint8(0), sensorReady: data.getUint8(1) !== 0, error: errors[data.getUint8(2)] || 'UNKNOWN', errorCode: data.getUint8(2), power: data.getUint8(3), supercap: data.getUint16(4, true), resetCounter: data.getUint8(6), flags: flags & 0xf0, protocolVersion: flags & 0x0f }
}
export function commandPacket(command: number) { const bytes = new Uint8Array(8); bytes[0] = command; return bytes }
export function parseHex(input: string) { const tokens = input.trim().split(/[\s,]+/).filter(Boolean); if (!tokens.length || tokens.some((token) => !/^[0-9a-fA-F]{2}$/.test(token))) throw new Error('HEX must contain space-separated byte pairs'); return new Uint8Array(tokens.map((token) => Number.parseInt(token, 16))) }
