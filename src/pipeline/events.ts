import { EventEmitter } from "node:events";
import type { ScanEvent } from "./types.js";

/** In-process event bus feeding the SSE route; ring buffer for replay. */
class ScanEventBus extends EventEmitter {
  private buffers = new Map<string, ScanEvent[]>();

  publish(ev: ScanEvent): void {
    const buf = this.buffers.get(ev.scanId) ?? [];
    buf.push(ev);
    if (buf.length > 500) buf.shift();
    this.buffers.set(ev.scanId, buf);
    this.emit(`scan:${ev.scanId}`, ev);
    this.emit("scan:*", ev);
  }

  replay(scanId: string): ScanEvent[] {
    return this.buffers.get(scanId) ?? [];
  }
}

export const scanEvents = new ScanEventBus();
scanEvents.setMaxListeners(50);
