import { config } from "./config.ts";
import { log } from "./log.ts";
import { closeWorkers } from "./mediasoup.ts";
import { rooms } from "./rooms.ts";

/** بررسی دوره‌ای: اتصال‌های بی‌پاسخ (کاربر خیالی) و کلاس‌های خالی پاک می‌شوند. */
export function startSweeper(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()]) {
      for (const peer of [...room.peers.values()]) {
        if (now - peer.lastSeen > config.timing.heartbeatTimeoutMs) {
          log.info(`heartbeat timeout: ${peer.name} (${room.id})`);
          const ws = peer.ws;
          room.removePeer(peer);
          try {
            ws?.close(4002, "heartbeat-timeout");
          } catch {
            /* ignore */
          }
        }
      }
      if (!room.closed && room.peers.size === 0 && room.emptySince && now - room.emptySince > config.timing.emptyRoomTtlMs) {
        room.close("empty");
      }
    }
  }, config.timing.sweepIntervalMs);
}

export function shutdown(stop: () => void): void {
  let done = false;
  const run = (sig: string) => {
    if (done) return;
    done = true;
    log.info(`${sig} received; shutting down`);
    for (const room of [...rooms.values()]) room.close("server-shutdown");
    closeWorkers();
    stop();
    setTimeout(() => process.exit(0), 300);
  };
  process.on("SIGINT", () => run("SIGINT"));
  process.on("SIGTERM", () => run("SIGTERM"));
}
