export const SERVICE_UUID = '0000fe40-cc7a-482a-984a-7f2ed5b3e58f'
export const CONTROL_UUID = '0000fe41-8e22-4541-9d4c-21edae82ed19'
export const SENSOR_DATA_UUID = '0000fe42-8e22-4541-9d4c-21edae82ed19'
export const DEVICE_STATUS_UUID = '0000fe43-8e22-4541-9d4c-21edae82ed19'
export const CONTROL_COMMANDS = [{ byte: 0, label: 'Start measurement' }, { byte: 1, label: 'Stop measurement' }, { byte: 2, label: 'Request current data' }, { byte: 3, label: 'Normal power mode' }, { byte: 4, label: 'Low-power mode' }, { byte: 5, label: 'Start ECG' }, { byte: 6, label: 'Stop ECG' }] as const
export function createControlPacket(command: number) { const packet = new Uint8Array(8); packet[0] = command; return packet }
export function bytesToHex(data: Uint8Array) { return Array.from(data, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ') }
export type SensorReading = { hr: number; spo2: number; temperature: number; superCap: number; power: number; flags: number; x: number; y: number; z: number; reserved: number; raw: string }
export function decodeSensorData(data: DataView): SensorReading { const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength); return { hr: data.getUint8(0), spo2: data.getUint8(1), temperature: data.getInt16(2, true) / 100, superCap: data.getUint16(4, true), power: data.getUint8(6), flags: data.getUint8(7), x: data.getInt16(8, true), y: data.getInt16(10, true), z: data.getInt16(12, true), reserved: data.byteLength >= 16 ? data.getUint16(14, true) : 0, raw: bytesToHex(bytes) } }
export type PacketLog = { id: string; timestamp: string; direction: 'RX' | 'TX'; characteristic: string; hex: string; decoded?: SensorReading; warning?: string }
export const protocolCharacteristics = [{ name: 'CONTROL', uuid: CONTROL_UUID, properties: 'Write', length: '8 bytes' }, { name: 'SENSOR_DATA', uuid: SENSOR_DATA_UUID, properties: 'Read · Notify', length: '16 bytes' }, { name: 'DEVICE_STATUS', uuid: DEVICE_STATUS_UUID, properties: 'Read · Notify', length: '8 bytes' }] as const
export type Command = (typeof CONTROL_COMMANDS)[number]
