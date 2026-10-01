import type { ECGPacket } from '@/lib/protocol/wearableProtocol'

/**
 * `start` marks the beginning of a new recording run (sequence numbers may restart),
 * `reset` drops everything (for example when switching between demo and real mode).
 */
export type EcgEvent = { type: 'packet'; packet: ECGPacket } | { type: 'start' } | { type: 'reset' }
export type EcgStore = ReturnType<typeof createEcgStore>

/** Roughly 22 s of packets at 200 Hz, replayed when the ECG view mounts. */
const HISTORY_EVENTS = 500

/**
 * ECG packets arrive ~22×/s. Keeping them outside React state means only the
 * components that subscribe re-render, instead of the whole dashboard.
 */
export function createEcgStore() {
  let history: EcgEvent[] = []
  let total = 0
  const listeners = new Set<(event: EcgEvent) => void>()

  const emit = (event: EcgEvent) => {
    if (event.type === 'reset') history = []
    else {
      history.push(event)
      if (history.length > HISTORY_EVENTS * 2) history = history.slice(-HISTORY_EVENTS)
    }
    listeners.forEach((listener) => listener(event))
  }

  return {
    push(packet: ECGPacket) { total += 1; emit({ type: 'packet', packet }) },
    markStart() { emit({ type: 'start' }) },
    reset() { total = 0; emit({ type: 'reset' }) },
    history: () => history.slice(-HISTORY_EVENTS),
    total: () => total,
    subscribe(listener: (event: EcgEvent) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
