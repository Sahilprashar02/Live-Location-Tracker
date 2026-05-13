const { Kafka } = require('kafkajs');

const TOPIC = 'location-updates';

// Create Kafka client
const kafka = new Kafka({
  clientId: 'location-tracker',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  retry: {
    initialRetryTime: 1000,
    retries: 10,
  },
});

// Shared producer instance
const producer = kafka.producer();

/**
 * Create a consumer with a specific group ID.
 * Each consumer group independently reads all messages from the topic.
 */
const createConsumer = (groupId) => {
  return kafka.consumer({ groupId });
};

/**
 * Ensure the location-updates topic exists.
 * Uses the Kafka admin API to create the topic if it doesn't already exist.
 */
const ensureTopic = async () => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const topics = await admin.listTopics();

    if (!topics.includes(TOPIC)) {
      await admin.createTopics({
        topics: [
          {
            topic: TOPIC,
            numPartitions: 3,
            replicationFactor: 1,
          },
        ],
      });
      console.log(`✅ Kafka topic "${TOPIC}" created`);
    } else {
      console.log(`✅ Kafka topic "${TOPIC}" already exists`);
    }
  } finally {
    await admin.disconnect();
  }
};

/**
 * Connect the producer and ensure the topic exists.
 */
const initKafka = async () => {
  await producer.connect();
  console.log('✅ Kafka producer connected');
  await ensureTopic();
};

const disconnectKafka = async () => {
  await producer.disconnect();
  console.log('✅ Kafka producer disconnected');
};

module.exports = {
  kafka,
  producer,
  createConsumer,
  ensureTopic,
  initKafka,
  disconnectKafka,
  TOPIC,
};
