import {
  bytesToHex, decodeDebugData, decodeECGData, decodeLoraStatus, loraCommandPacket, LORA_STATUS_CODE, type LoraStatus, decodeNFCData, decodeRecoveryData, decodeSensor, decodeStatus,
  commandPacket, syncTimePacket, CHARACTERISTICS, SERVICE_UUID, type CharacteristicKey, type DebugCommand, type DeviceStatus,
  type ECGPacket, type NFCData, type RecoveryPacket, type Sensor,
} from '../protocol/wearableProtocol'

export type BleState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'reconnecting' | 'error'
export type BlePermission = 'granted' | 'prompt' | 'denied' | 'unknown'
export type BleDiagnostics = { secureContext: boolean; supported: boolean; available: boolean | null; permission: BlePermission; lastErrorName: string; errorMessage: string; failedOperation?: string }
export type DiscoveredCharacteristic = { serviceUuid: string; uuid: string; properties: string[]; readable: boolean; writable: boolean; notifiable: boolean }
export type DiscoveredService = { uuid: string; characteristics: DiscoveredCharacteristic[] }
export type CharacteristicStatus = { lastPacket?: { data: Uint8Array; timestamp: number }; packetCount: number; subscribed?: boolean }
export type BleCallbacks = {
  onState?: (state: BleState) => void; onPacket?: (characteristic: string, data: DataView) => void; onError?: (error: BleError) => void
  onDiagnostics?: (diagnostics: BleDiagnostics) => void; onDiscovery?: (services: DiscoveredService[]) => void; onDevice?: (device: BluetoothDevice) => void
  onSensor?: (sensor: Sensor, data: DataView) => void; onStatus?: (status: DeviceStatus, data: DataView) => void
  onECG?: (packet: ECGPacket, raw: Uint8Array) => void; onDebugData?: (response: DebugCommand, raw: Uint8Array) => void
  onNFCEvent?: (data: NFCData, raw: Uint8Array) => void; onRecoveryData?: (packet: RecoveryPacket, raw: Uint8Array) => void
  onLoraStatus?: (status: LoraStatus, raw: Uint8Array) => void
}
export const WEARABLE_SERVICE_UUID = SERVICE_UUID
export const WRITE_CHARACTERISTIC_UUID = CHARACTERISTICS.CONTROL
export const SENSOR_DATA_UUID = CHARACTERISTICS.SENSOR_DATA
export const DEVICE_STATUS_UUID = CHARACTERISTICS.DEVICE_STATUS
export class BleError extends Error { constructor(public override name: string, message: string, public operation = 'unknown') { super(message) } }
type BluetoothDeviceLike = BluetoothDevice & { gatt: BluetoothRemoteGATTServer | null }
const initialDiagnostics: BleDiagnostics = { secureContext: false, supported: false, available: null, permission: 'unknown', lastErrorName: '', errorMessage: '', failedOperation: '' }
const asBleError = (error: unknown, operation: string) => { const value = error as { name?: string; message?: string }; return new BleError(value?.name || 'Error', value?.message || String(error), operation) }
/** Spec §5.2: these commands (and any invalid code) are answered by a DEVICE_STATUS notification; 0x03 and 0x0A-0x13 are not. */
const answeredByStatus = (code: number) => code === 0x01 || code === 0x02 || (code >= 0x04 && code <= 0x09) || code === 0x00 || code >= 0x14
const STATUS_TIMEOUT_MS = 2000
const hex8 = (value: number) => `0x${value.toString(16).padStart(2, '0').toUpperCase()}`
/** Human-readable reason for error code 0x01 after a command (spec §5.5, §13.2). */
const rejection = (code: number, status: DeviceStatus) => {
  if (code === 0x06 && status.measurementRaw === 1) return 'ECG start failed: the MAX86150 did not enter ECG mode (FE43: Measuring, error 0x01). No ECG data will arrive.'
  if ((code === 0x01 || code === 0x06) && status.measurementRaw === 5) return `Command ${hex8(code)} failed: the sensor block is not initialised (FE43: Error, error 0x01).`
  if (code === 0x09) return 'Time sync rejected by the device (FE43 error 0x01); the old time is kept.'
  return `Command ${hex8(code)} rejected by the device (FE43: ${status.measurement}, error 0x01). Send 0x02 to return to a clean state.`
}
const propertyNames = (c: BluetoothRemoteGATTCharacteristic) => ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter((name) => Boolean((c.properties as Record<string, boolean>)[name]))

export class BleManager {
  private device: BluetoothDeviceLike | null = null; private callbacks: BleCallbacks; private diagnosticsState = initialDiagnostics
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null; private characteristics = new Map<string, BluetoothRemoteGATTCharacteristic>(); private packetStats = new Map<string, CharacteristicStatus>()
  private statusWaiters = new Set<(status: DeviceStatus | null) => void>(); private watchedDevices = new WeakSet<BluetoothDevice>()
  constructor(callbacks: BleCallbacks = {}) { this.callbacks = callbacks; void this.refreshDiagnostics() }
  private publish(patch: Partial<BleDiagnostics>) { this.diagnosticsState = { ...this.diagnosticsState, ...patch }; this.callbacks.onDiagnostics?.(this.diagnosticsState) }
  async refreshDiagnostics() { const secureContext = typeof window !== 'undefined' && window.isSecureContext; const supported = typeof navigator !== 'undefined' && 'bluetooth' in navigator; let available: boolean | null = null; let permission: BlePermission = 'unknown'; if (supported) { try { available = await navigator.bluetooth.getAvailability() } catch {} if (navigator.permissions?.query) { try { permission = (await navigator.permissions.query({ name: 'bluetooth' as PermissionName })).state as BlePermission } catch {} } } this.publish({ secureContext, supported, available, permission }); return this.diagnosticsState }
  private fail(name: string, message: string, operation: string) { const e = new BleError(name, message, operation); this.publish({ lastErrorName: name, errorMessage: message, failedOperation: operation }); this.callbacks.onError?.(e); return e }
  async scan() { const d = await this.refreshDiagnostics(); if (!d.secureContext) throw this.fail('SecurityError', 'Web Bluetooth requires a secure HTTPS context.', 'scan'); if (!d.supported) throw this.fail('TypeError', 'Web Bluetooth is not supported in this browser.', 'scan'); this.callbacks.onState?.('scanning'); try { const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [WEARABLE_SERVICE_UUID] }); this.device = device as BluetoothDeviceLike; this.callbacks.onDevice?.(device); this.publish({ permission: 'granted', lastErrorName: '', errorMessage: '', failedOperation: '' }); return this.device } catch (error) { const e = asBleError(error, 'scan'); this.callbacks.onState?.('disconnected'); this.callbacks.onError?.(e); throw e } }
  async connect(device = this.device) { if (!device?.gatt) throw this.fail('InvalidStateError', 'No wearable selected.', 'connect'); this.device = device; if (!this.watchedDevices.has(device)) { this.watchedDevices.add(device); /* Spec §13.3: the device may drop the link on its own; every value is stale after that. */ device.addEventListener('gattserverdisconnected', () => { if (this.device === device) this.handleDisconnected() }) } this.callbacks.onState?.('connecting'); try { const server = await device.gatt.connect(); const services = await server.getPrimaryServices(); const discovered: DiscoveredService[] = []; this.writeCharacteristic = null; for (const service of services) { const chars = await service.getCharacteristics(); const items: DiscoveredCharacteristic[] = []; for (const c of chars) { const properties = propertyNames(c); const uuid = c.uuid.toLowerCase(); const item = { serviceUuid: service.uuid, uuid: c.uuid, properties, readable: properties.includes('read'), writable: properties.includes('write') || properties.includes('writeWithoutResponse'), notifiable: properties.includes('notify') || properties.includes('indicate') }; items.push(item); if (uuid === WRITE_CHARACTERISTIC_UUID) this.writeCharacteristic = c; this.characteristics.set(uuid, c); this.packetStats.set(uuid, { packetCount: 0 }); if (item.notifiable) { /* Listen first: the firmware notifies FE43 as soon as its CCCD is written. */ c.addEventListener('characteristicvaluechanged', () => { const rxMs = performance.timeOrigin + performance.now(); const value = c.value; if (!value) return; const raw = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)); const stats = this.packetStats.get(uuid) || { packetCount: 0 }; this.packetStats.set(uuid, { ...stats, packetCount: stats.packetCount + 1, lastPacket: { data: raw, timestamp: Date.now() }, subscribed: true }); this.callbacks.onPacket?.(c.uuid, value); try { if (uuid === SENSOR_DATA_UUID) this.callbacks.onSensor?.(decodeSensor(value), value); else if (uuid === DEVICE_STATUS_UUID) { const status = decodeStatus(value); this.callbacks.onStatus?.(status, value); this.statusWaiters.forEach((waiter) => waiter(status)) } else if (uuid === CHARACTERISTICS.ECG_DATA) this.callbacks.onECG?.({ ...decodeECGData(value), hostRxMs: rxMs }, raw); else if (uuid === CHARACTERISTICS.NFC_EVENT) this.callbacks.onNFCEvent?.(decodeNFCData(value), raw); else if (uuid === CHARACTERISTICS.DEBUG_DATA) { if (raw[0] === LORA_STATUS_CODE) this.callbacks.onLoraStatus?.(decodeLoraStatus(value), raw); else this.callbacks.onDebugData?.(decodeDebugData(value), raw) } else if (uuid === CHARACTERISTICS.RECOVERY_DATA) this.callbacks.onRecoveryData?.(decodeRecoveryData(value), raw) } catch (error) { this.callbacks.onError?.(asBleError(error, `decode ${c.uuid}`)) } }); await c.startNotifications() } } discovered.push({ uuid: service.uuid, characteristics: items }) } this.callbacks.onDiscovery?.(discovered); this.callbacks.onState?.('connected'); return discovered } catch (error) { const e = asBleError(error, 'connect'); this.callbacks.onState?.('error'); this.callbacks.onError?.(e); throw e } }
  /** FE45 must be subscribed before 0x06 (spec §5.3); resolves with the confirming FE43 status. */
  async startECG() { const ecg = this.characteristics.get(CHARACTERISTICS.ECG_DATA); if (!ecg) throw this.fail('NotFoundError', 'ECG characteristic FE45 was not discovered.', 'start ECG'); await ecg.startNotifications(); return this.sendCommand(commandPacket(0x06)) }
  async stopECG() { return this.sendCommand(commandPacket(0x07)) }
  /**
   * Writes one 8-byte CONTROL packet (spec §14.4) and, for commands the firmware answers on FE43, waits for that
   * DEVICE_STATUS and throws when it carries error 0x01 (spec §14.5). Resolves with the status, or null when the
   * command has no FE43 answer.
   */
  async sendCommand(packet: Uint8Array) {
    if (packet.length !== 8) throw this.fail('TypeError', `CONTROL writes must be exactly 8 bytes (got ${packet.length}).`, 'write')
    if (!this.writeCharacteristic) throw this.fail('InvalidStateError', 'Connect to a wearable before sending commands.', 'write')
    const code = packet[0]
    const answer = answeredByStatus(code) ? this.nextStatus(STATUS_TIMEOUT_MS) : null
    try { await this.writeCharacteristic.writeValue(packet) } catch (error) { answer?.cancel(); throw asBleError(error, `write ${hex8(code)}`) }
    if (!answer) return null
    const status = await answer.promise
    if (!status) throw this.fail('TimeoutError', `No DEVICE_STATUS within ${STATUS_TIMEOUT_MS} ms after command ${hex8(code)}; its result is unknown.`, 'confirm command')
    if (status.errorCode === 0x01) throw this.fail('CommandRejected', rejection(code, status), 'confirm command')
    return status
  }
  private nextStatus(timeoutMs: number) {
    let finish: (status: DeviceStatus | null) => void = () => undefined
    const promise = new Promise<DeviceStatus | null>((resolve) => {
      const timer = setTimeout(() => finish(null), timeoutMs)
      finish = (status) => { clearTimeout(timer); this.statusWaiters.delete(finish); resolve(status) }
      this.statusWaiters.add(finish)
    })
    return { promise, cancel: () => finish(null) }
  }
  private handleDisconnected() { this.writeCharacteristic = null; this.characteristics.clear(); this.statusWaiters.forEach((waiter) => waiter(null)); this.callbacks.onState?.('disconnected') }
  /** LoRaWAN test command (CONTROL 0x0F-0x13); the answer arrives as an FE46 LoRa status notification. */
  async sendLoraCommand(command: number, txPowerDbm = 0) { return this.writeCharacteristicValue('CONTROL', loraCommandPacket(command, txPowerDbm)) }
  async reconnect() { this.callbacks.onState?.('reconnecting'); return this.connect() }
  /** Spec §13.4: send 0x02 first so the device turns its sensors off right away, then drop the link. */
  async disconnect() { const device = this.device; try { if (device?.gatt?.connected && this.writeCharacteristic) await this.writeCharacteristic.writeValue(commandPacket(0x02)) } catch { /* best effort */ } device?.gatt?.disconnect(); this.handleDisconnected() }
  /** SYNC_TIME has no ACK packet; the device answers with FE43 error 0x00 (accepted) or 0x01 (rejected), spec §5.4. */
  async syncTime() { return this.sendCommand(syncTimePacket()) }
  async writeHex(hex: string) { const normalized = hex.replace(/[\s:-]/g, ''); if (!normalized || !/^[0-9a-f]+$/i.test(normalized) || normalized.length % 2) throw this.fail('TypeError', 'Enter an even number of hexadecimal characters.', 'write'); const data = Uint8Array.from(normalized.match(/.{2}/g)!, (byte) => parseInt(byte, 16)); await this.sendCommand(data); return data }
  async readCharacteristic(key: CharacteristicKey | string) { const uuid = (CHARACTERISTICS[key as CharacteristicKey] || key).toLowerCase(); if ([CHARACTERISTICS.NFC_EVENT, CHARACTERISTICS.DEBUG_DATA, CHARACTERISTICS.RECOVERY_DATA].includes(uuid as typeof CHARACTERISTICS.NFC_EVENT)) throw this.fail('NotSupportedError', `Characteristic ${key} is not used in protocol v1 (spec §14.13).`, 'read'); const characteristic = this.characteristics.get(uuid); if (!characteristic?.properties.read) throw this.fail('InvalidStateError', `Characteristic ${key} is not readable.`, 'read'); return characteristic.readValue() }
  async writeCharacteristicValue(key: CharacteristicKey | string, data: Uint8Array) { const characteristic = this.characteristics.get((CHARACTERISTICS[key as CharacteristicKey] || key).toLowerCase()); if (!characteristic || (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse)) throw this.fail('InvalidStateError', `Characteristic ${key} is not writable.`, 'write'); await characteristic.writeValue(data); return data }
  getCharacteristicStats(key: CharacteristicKey | string) { return this.packetStats.get((CHARACTERISTICS[key as CharacteristicKey] || key).toLowerCase()) || { packetCount: 0 } }
  get diagnostics() { return this.diagnosticsState }
}
export { bytesToHex }
export type { LoraStatus, NFCData, RecoveryPacket }
