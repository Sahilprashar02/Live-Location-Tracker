import { z } from "zod";

export const locationPayloadSchema = z.object({
  eventId: z.string().min(8).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10000).optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  speed: z.number().min(0).max(300).nullable().optional(),
  timestamp: z.number().int().positive()
});

export function isFreshTimestamp(timestamp) {
  const ageMs = Math.abs(Date.now() - timestamp);
  return ageMs < 120000;
}
