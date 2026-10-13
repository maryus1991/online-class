import * as mediasoup from "mediasoup";
import type { types as mt } from "mediasoup";
import { config } from "./config.ts";
import { log } from "./log.ts";

interface WorkerSlot {
  worker: mt.Worker;
  webRtcServer: mt.WebRtcServer;
  rooms: number;
}

const slots: WorkerSlot[] = [];

export const mediaCodecs: mt.RouterRtpCodecCapability[] = [
  { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
  { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: { "x-google-start-bitrate": 1000 } },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
      "x-google-start-bitrate": 1000,
    },
  },
];

export async function initWorkers(): Promise<void> {
  const m = config.mediasoup;
  for (let i = 0; i < m.workers; i++) {
    const worker = await mediasoup.createWorker({ logLevel: m.logLevel });
    worker.on("died", (err) => {
      // اگر Worker از بین برود وضعیت همهٔ کلاس‌های آن از دست می‌رود؛ فرایند را می‌بندیم تا Docker دوباره بالا بیاورد.
      log.error(`mediasoup worker ${worker.pid} died`, err);
      setTimeout(() => process.exit(1), 2000);
    });
    const port = m.rtcPortMin + i;
    const webRtcServer = await worker.createWebRtcServer({
      listenInfos: [
        { protocol: "udp", ip: m.listenIp, announcedAddress: m.announcedAddress, port },
        { protocol: "tcp", ip: m.listenIp, announcedAddress: m.announcedAddress, port },
      ],
    });
    slots.push({ worker, webRtcServer, rooms: 0 });
    log.info(`mediasoup worker #${i} pid=${worker.pid} rtc=${m.listenIp}:${port} (announced ${m.announcedAddress})`);
  }
}

export interface RoomMedia {
  router: mt.Router;
  webRtcServer: mt.WebRtcServer;
  release(): void;
}

/** برای هر کلاس یک Router مستقل روی کم‌بارترین Worker ساخته می‌شود. */
export async function createRoomMedia(): Promise<RoomMedia> {
  const slot = slots.reduce((a, b) => (b.rooms < a.rooms ? b : a));
  const router = await slot.worker.createRouter({ mediaCodecs });
  slot.rooms++;
  let released = false;
  return {
    router,
    webRtcServer: slot.webRtcServer,
    release() {
      if (released) return;
      released = true;
      slot.rooms--;
      if (!router.closed) router.close();
    },
  };
}

export function closeWorkers(): void {
  for (const s of slots) if (!s.worker.closed) s.worker.close();
}
