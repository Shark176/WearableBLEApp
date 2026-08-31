interface BluetoothCharacteristicProperties {
  broadcast?: boolean
  read?: boolean
  write?: boolean
  writeWithoutResponse?: boolean
  notify?: boolean
  indicate?: boolean
}

declare interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  uuid: string
  properties: BluetoothCharacteristicProperties
  value: DataView | null
  readValue(): Promise<DataView>
  writeValue(value: BufferSource): Promise<void>
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
}

declare interface BluetoothRemoteGATTService {
  uuid: string
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>
}

declare interface BluetoothRemoteGATTServer {
  connected: boolean
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>
}

declare interface BluetoothDevice extends EventTarget {
  id: string
  name?: string
  gatt: BluetoothRemoteGATTServer | null
}

declare interface Bluetooth {
  getAvailability(): Promise<boolean>
  requestDevice(options: { acceptAllDevices?: boolean; optionalServices?: string[] }): Promise<BluetoothDevice>
}

declare interface Navigator {
  bluetooth: Bluetooth
}
