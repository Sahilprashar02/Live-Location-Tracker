const { Kafka } = require('kafkajs');

const TOPIC = 'location-updates';

const normalizeCertificate = (value) => {
  if (!value) return undefined;
  return value.replace(/\\n/g, '\n');
};

// SASL mechanisms supported by kafkajs. The shared global-kafka broker uses
// scram-sha-512 when its SASL listener (Infra compose.kafka-sasl.yml) is on.
const SASL_MECHANISMS = ['plain', 'scram-sha-256', 'scram-sha-512'];

const getKafkaConnectionOptions = (env = process.env) => {
  const ca = normalizeCertificate(env.KAFKA_CA_CERT);
  const cert = normalizeCertificate(env.KAFKA_ACCESS_CERT);
  const key = normalizeCertificate(env.KAFKA_ACCESS_KEY);

  if (ca && cert && key) {
    return {
      ssl: {
        ca: [ca],
        cert,
        key,
        rejectUnauthorized: true,
      },
    };
  }

  if (env.KAFKA_USERNAME && env.KAFKA_PASSWORD) {
    // Defaults keep the previous behaviour (SASL/PLAIN over TLS, for hosted
    // brokers). The in-network broker has no TLS, so it sets KAFKA_SSL=false
    // and KAFKA_SASL_MECHANISM=scram-sha-512.
    const mechanism = (env.KAFKA_SASL_MECHANISM || 'plain').toLowerCase();
    if (!SASL_MECHANISMS.includes(mechanism)) {
      throw new Error(
        `KAFKA_SASL_MECHANISM must be one of ${SASL_MECHANISMS.join(', ')}`
      );
    }
    return {
      ssl: env.KAFKA_SSL !== 'false',
      sasl: {
        mechanism,
        username: env.KAFKA_USERNAME,
        password: env.KAFKA_PASSWORD,
      },
    };
  }

  return {};
};

// Create Kafka client
const kafka = new Kafka({
  clientId: 'location-tracker',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  ...getKafkaConnectionOptions(),
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
            numPartitions: 1, // Use 1 partition for cloud provider compatibility
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
  getKafkaConnectionOptions, // exported for testability (pure: takes env)
};
