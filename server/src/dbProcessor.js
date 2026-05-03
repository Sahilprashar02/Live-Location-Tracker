import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConsumer, ensureLocationTopic } from "./kafka.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../data");
const historyFile = path.join(dataDir, "location-history.jsonl");
const seenEventIds = new Set();

fs.mkdirSync(dataDir, { recursive: true });

await ensureLocationTopic();
const consumer = await createConsumer("location-history-writer");

console.log(`Database processor consuming location events into ${historyFile}`);

await consumer.run({
  eachMessage: async ({ message }) => {
    if (!message.value) return;
    const event = JSON.parse(message.value.toString());

    if (seenEventIds.has(event.eventId)) {
      return;
    }

    rememberEvent(event.eventId);

    const row = {
      eventId: event.eventId,
      userId: event.userId,
      latitude: event.latitude,
      longitude: event.longitude,
      accuracy: event.accuracy,
      timestamp: event.timestamp,
      storedAt: Date.now()
    };

    fs.appendFileSync(historyFile, `${JSON.stringify(row)}\n`);
    console.log(`stored ${row.eventId} for ${row.userId}`);
  }
});

function rememberEvent(eventId) {
  seenEventIds.add(eventId);
  if (seenEventIds.size > 10000) {
    const oldest = seenEventIds.values().next().value;
    seenEventIds.delete(oldest);
  }
}
