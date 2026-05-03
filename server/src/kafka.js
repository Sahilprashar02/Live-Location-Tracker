import { Kafka, Partitioners, logLevel } from "kafkajs";
import { config } from "./config.js";

export const kafka = new Kafka({
  clientId: "live-location-tracker",
  brokers: config.kafkaBrokers,
  logLevel: logLevel.WARN
});

export async function createProducer() {
  const producer = kafka.producer({ createPartitioner: Partitioners.LegacyPartitioner });
  await producer.connect();
  return producer;
}

export async function createConsumer(groupId) {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topic: config.locationTopic, fromBeginning: false });
  return consumer;
}

export async function ensureLocationTopic() {
  const admin = kafka.admin();
  await admin.connect();
  const topics = await admin.listTopics();
  if (!topics.includes(config.locationTopic)) {
    await admin.createTopics({
      waitForLeaders: true,
      topics: [{ topic: config.locationTopic, numPartitions: 3, replicationFactor: 1 }]
    });
  }
  await admin.disconnect();
}
