import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";
import type { QueuePayload } from "@/lib/types";

export const QUEUE_NAME = "clipforge";

let connection: IORedis | null = null;
let queue: Queue<QueuePayload> | null = null;

export function getRedis(): IORedis {
  if (!connection) {
    // BullMQ requires maxRetriesPerRequest: null
    connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getQueue(): Queue<QueuePayload> {
  if (!queue) {
    queue = new Queue<QueuePayload>(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return queue;
}

/** Enqueue with the DB job id as the BullMQ job id so duplicates are ignored. */
export async function enqueue(name: "ingest" | "transcribe" | "analyze" | "render" | "export", payload: QueuePayload) {
  return getQueue().add(name, payload, { jobId: payload.jobId });
}
