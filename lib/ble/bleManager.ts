import { 
  bytesToHex, 
  decodeSensor, 
  decodeStatus, 
  decodeSyncTimeAck, 
  syncTimePacket,
  CHARACTERISTICS,
  SERVICE_UUID,
  type Sensor,
  type DeviceStatus,
  type ECGPacket,
  type DebugCommand,
  type DebugResponse,
  type CharacteristicKey,
} from '../protocol/wearableProtocol'

export type BleState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'reconnecting' | 'error'
export type BlePermission = 'granted' | 'prompt' | 'denied' | 'unknown'
export type TimeSyncState = 'idle' | 'syncing' | 'synced' | 'timeout' | 'error'
export type BleDiagnostics = { secureContext: boolean; supported: boolean; available: boolean | null; permission: BlePermission; lastErrorName: string; errorMessage: string; failedOperation?: string; timeSync?: { state: TimeSyncState; sentAt?: number; acknowledgedAt?: number; deviceEpoch?: number; offsetMs?: number; roundTripMs?: number } }
export type DiscoveredCharacteristic = { serviceUuid: string; uuid: string; properties: string[]; readable: boolean; writable: boolean; notifiable: boolean }
export type DiscoveredService = { uuid: string; characteristics: DiscoveredCharacteristic[] }
export type CharacteristicStatus = { lastPacket?: { data: Uint8Array; timestamp: number }; packetCount: number; subscribed?: boolean }

export type BleCallbacks = { 
  onState?: (state: BleState) => void
  onPacket?: (characteristic: string, data: DataView) => void
  onError?: (error: BleError) => void
  onDiagnostics?: (diagnostics: BleDiagnostics) => void
  onDiscovery?: (services: DiscoveredService[]) => void
  onDevice?: (device: BluetoothDevice) => void
  onSensor?: (sensor: Sensor, data: DataView) => void
  onStatus?: (status: DeviceStatus, data: DataView) => void
  onECG?: (packet: ECGPacket, raw: Uint8Array) => void
  onDebugData?: (response: DebugResponse, raw: Uint8Array) => void
  onNFCEvent?: (raw: Uint8Array) => void
  onRecoveryData?: (raw: Uint8Array) => void
  onReconnect?: () => void
}

export const WEARABLE_SERVICE_UUID = SERVICE_UUID
export const WRITE_CHARACTERISTIC_UUID = CHARACTERISTICS.CONTROL
export const SENSOR_DATA_UUID = CHARACTERISTICS.SENSOR_DATA
export const DEVICE_STATUS_UUID = CHARACTERISTICS.DEVICE_STATUS

export class BleError extends Error { constructor(public override name: string, message: string, public operation = 'unknown') { super(message) } }
type BluetoothDeviceLike = BluetoothDevice & { gatt: BluetoothRemoteGATTServer | null }
const initialDiagnostics: BleDiagnostics = { secureContext: false, supported: false, available: null, permission: 'unknown', lastErrorName: '', errorMessage: '', failedOperation: '', timeSync: { state: 'idle' } }
const asBleError = (error: unknown, operation: string) => { const value = error as { name?: string; message?: string }; return new BleError(value?.name || 'Error', value?.message || String(error), operation) }
const propertyNames = (c: BluetoothRemoteGATTCharacteristic) => ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter((name) => Boolean((c.properties as Record<string, boolean>)[name]))

export class BleManager {
  private device: BluetoothDeviceLike | null = null; private callbacks: BleCallbacks; private diagnostics = initialDiagnostics; private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null; private characteristics = new Map<string, BluetoothRemoteGATTCharacteristic>(); private packetStats = new Map<string, CharacteristicStatus>()
  constructor(callbacks: BleCallbacks = {}) { this.callbacks = callbacks; void this.refreshDiagnostics() }
  private publish(patch: Partial<BleDiagnostics>) { this.diagnosticsState = { ...this.diagnosticsState, ...patch }; this.callbacks.onDiagnostics?.(this.diagnosticsState) }
  async refreshDiagnostics() { const secureContext = typeof window !== 'undefined' && window.isSecureContext; const supported = typeof navigator !== 'undefined' && 'bluetooth' in navigator; let available: boolean | null = null; let permission: BlePermission = 'unknown'; if (supported) { try { available = await navigator.bluetooth.getAvailability() } catch {} if (navigator.permissions?.query) { try { permission = (await navigator.permissions.query({ name: 'bluetooth' as PermissionName })).state as BlePermission } catch {} } } this.publish({ secureContext, supported, available, permission }); return this.diagnosticsState }
  async scan() { const d = await this.refreshDiagnostics(); if (!d.secureContext) throw this.fail('SecurityError', 'Web Bluetooth requires a secure HTTPS context.', 'scan'); if (!d.supported) throw this.fail('TypeError', 'Web Bluetooth is not supported in this browser.', 'scan'); this.callbacks.onState?.('scanning'); try { const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [WEARABLE_SERVICE_UUID] }); this.device = device as BluetoothDeviceLike; this.callbacks.onDevice?.(device); this.publish({ permission: 'granted', lastErrorName: '', errorMessage: '', failedOperation: '' }); return this.device } catch (error) { const e = asBleError(error, 'scan'); this.callbacks.onState?.('disconnected'); this.publish({ permission: e.name === 'NotAllowedError' ? 'denied' : this.diagnosticsState.permission, lastErrorName: e.name, errorMessage: e.message, failedOperation: 'scan' }); this.callbacks.onError?.(e); throw e } }
  private fail(name: string, message: string, operation: string) { const e = new BleError(name, message, operation); this.publish({ lastErrorName: name, errorMessage: message, failedOperation: operation }); this.callbacks.onError?.(e); return e }
  async connect(device = this.device) { if (!device?.gatt) throw this.fail('InvalidStateError', 'No wearable selected.', 'connect'); this.device = device; this.callbacks.onState?.('connecting'); try { const server = await device.gatt.connect(); const services = await server.getPrimaryServices(); const discovered: DiscoveredService[] = []; this.writeCharacteristic = null; for (const service of services) { const chars = await service.getCharacteristics(); const items: DiscoveredCharacteristic[] = []; for (const c of chars) { const properties = propertyNames(c); const item = { serviceUuid: service.uuid, uuid: c.uuid, properties, readable: properties.includes('read'), writable: properties.includes('write') || properties.includes('writeWithoutResponse'), notifiable: properties.includes('notify') || properties.includes('indicate') }; items.push(item); if (c.uuid.toLowerCase() === WRITE_CHARACTERISTIC_UUID) this.writeCharacteristic = c; this.characteristics.set(c.uuid.toLowerCase(), c); this.packetStats.set(c.uuid.toLowerCase(), { packetCount: 0 }); if (item.notifiable) { await c.startNotifications(); c.addEventListener('characteristicvaluechanged', () => { const value = c.value; if (!value) return; const raw = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)); const stats = this.packetStats.get(c.uuid.toLowerCase()) || { packetCount: 0 }; this.packetStats.set(c.uuid.toLowerCase(), { ...stats, packetCount: stats.packetCount + 1, lastPacket: { data: raw, timestamp: Date.now() }, subscribed: true }); this.callbacks.onPacket?.(c.uuid, value); try { const uuid = c.uuid.toLowerCase(); if (uuid === SENSOR_DATA_UUID) this.callbacks.onSensor?.(decodeSensor(value), value); else if (uuid === DEVICE_STATUS_UUID) this.callbacks.onStatus?.(decodeStatus(value), value); else if (uuid === CHARACTERISTICS.ECG_DATA) this.callbacks.onECG?.({ sequence: Date.now(), samples: [], raw }, raw); else if (uuid === CHARACTERISTICS.NFC_EVENT) this.callbacks.onNFCEvent?.(raw); else if (uuid === CHARACTERISTICS.RECOVERY_DATA) this.callbacks.onRecoveryData?.(raw); else if (uuid === CHARACTERISTICS.DEBUG_DATA) this.callbacks.onDebugData?.({ commandId: raw[0] ?? 0, status: 'unsupported', data: raw, message: 'FE46 debug format is firmware-defined.' }, raw) } catch (error) { const e = asBleError(error, 'decode notification'); this.publish({ lastErrorName: e.name, errorMessage: e.message, failedOperation: e.operation }); this.callbacks.onError?.(e) } }) } } discovered.push({ uuid: service.uuid, characteristics: items }) } this.callbacks.onDiscovery?.(discovered); device.addEventListener('gattserverdisconnected', () => this.callbacks.onState?.('disconnected')); this.callbacks.onState?.('connected'); return device } catch (error) { const e = asBleError(error, 'connect'); this.publish({ lastErrorName: e.name, errorMessage: e.message, failedOperation: 'connect' }); this.callbacks.onState?.('error'); this.callbacks.onError?.(e); throw e } }
  async reconnect() { this.callbacks.onState?.('reconnecting'); return this.connect() }
  disconnect() { this.device?.gatt?.disconnect(); this.writeCharacteristic = null; this.callbacks.onState?.('disconnected') }
  async syncTime(timeoutMs = 3000) { if (!this.writeCharacteristic) throw this.fail('InvalidStateError', 'Connect to a wearable before synchronizing time.', 'sync time'); const sentAt = performance.now(); this.publish({ timeSync: { state: 'syncing', sentAt: Date.now() } }); try { await this.writeCharacteristic.writeValue(syncTimePacket()); const deviceEpoch = Math.floor(Date.now() / 1000); const roundTripMs = Math.round(performance.now() - sentAt); this.publish({ timeSync: { state: 'synced', sentAt: Date.now() - roundTripMs, acknowledgedAt: Date.now(), deviceEpoch, offsetMs: deviceEpoch * 1000 - Date.now(), roundTripMs } }); return { deviceEpoch, roundTripMs } } catch (error) { const e = asBleError(error, 'sync time'); this.publish({ timeSync: { state: 'error', sentAt: Date.now() }, lastErrorName: e.name, errorMessage: e.message, failedOperation: e.operation }); throw e } }
  async writeHex(hex: string) { const normalized = hex.replace(/[\s:-]/g, ''); if (!normalized || !/^[0-9a-f]+$/i.test(normalized) || normalized.length % 2) throw this.fail('TypeError', 'Enter an even number of hexadecimal characters.', 'write'); if (!this.writeCharacteristic) throw this.fail('InvalidStateError', 'Discover a writable characteristic before sending data.', 'write'); const data = Uint8Array.from(normalized.match(/.{2}/g)!, (byte) => parseInt(byte, 16)); try { await this.writeCharacteristic.writeValue(data) } catch (error) { const e = asBleError(error, 'write'); this.callbacks.onError?.(e); throw e } return data }
  async readCharacteristic(key: CharacteristicKey | string) { const uuid = (CHARACTERISTICS[key as CharacteristicKey] || key).toLowerCase(); const characteristic = this.characteristics.get(uuid); if (!characteristic?.properties.read) throw this.fail('InvalidStateError', `Characteristic ${key} is not readable.`, 'read'); return characteristic.readValue() }
  async writeCharacteristicValue(key: CharacteristicKey | string, data: Uint8Array) { const uuid = (CHARACTERISTICS[key as CharacteristicKey] || key).toLowerCase(); const characteristic = this.characteristics.get(uuid); if (!characteristic || (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse)) throw this.fail('InvalidStateError', `Characteristic ${key} is not writable.`, 'write'); await characteristic.writeValue(data); return data }
  getCharacteristicStats(key: CharacteristicKey | string) { const uuid = (CHARACTERISTICS[key as CharacteristicKey] || key).toLowerCase(); return this.packetStats.get(uuid) || { packetCount: 0 } }
  get diagnostics() { return this.diagnosticsState }
}
export { bytesToHex }
