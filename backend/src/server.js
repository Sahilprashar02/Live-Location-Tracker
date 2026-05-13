require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

// Config imports
const connectDB = require('./config/db');
const { initKafka, disconnectKafka } = require('./config/kafka');

// Consumer imports
const { startBroadcastConsumer, stopBroadcastConsumer } = require('./consumers/broadcastConsumer');
const { startDBConsumer, stopDBConsumer } = require('./consumers/dbConsumer');

// Socket handler import
const { initSocketHandler } = require('./socket/handler');

const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL;
const FRONTEND_PATH = path.join(__dirname, '..', '..', 'frontend');

const validateEnv = () => {
  const required = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'SESSION_SECRET',
    'MONGODB_URI',
    'KAFKA_BROKER',
    'PORT',
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

try {
  validateEnv();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

const passport = require('./config/passport');
const authRoutes = require('./routes/auth');

// Initialize Express
const app = express();
const server = http.createServer(app);

// Session middleware (shared between Express and Socket.IO)
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 24 * 60 * 60, // 1 day
  }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    httpOnly: true,
    secure: false, // Set to true in production with HTTPS
    sameSite: 'lax',
  },
});

// CORS is only needed when a separate frontend origin is configured.
if (CLIENT_URL) {
  app.use(cors({
    origin: CLIENT_URL,
    credentials: true,
  }));
}

// Middleware
app.use(express.json());
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/auth', authRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Single-origin frontend hosting
app.use(express.static(FRONTEND_PATH));
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
});

// Initialize Socket.IO
const io = new Server(server, {
  ...(CLIENT_URL
    ? {
        cors: {
          origin: CLIENT_URL,
          credentials: true,
        },
      }
    : {}),
  pingTimeout: 30000,
  pingInterval: 10000,
});

// Share session middleware with Socket.IO
io.engine.use(sessionMiddleware);

/**
 * Bootstrap the entire application:
 * 1. Connect to MongoDB
 * 2. Initialize Kafka producer + ensure topic
 * 3. Start Kafka consumers (broadcast + DB)
 * 4. Initialize Socket.IO handler
 * 5. Start HTTP server
 */
const bootstrap = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Initialize Kafka
    await initKafka();

    // 3. Start consumers
    await startBroadcastConsumer(io);
    await startDBConsumer();

    // 4. Initialize Socket.IO handler
    initSocketHandler(io);

    // 5. Start server
    server.listen(PORT, () => {
      console.log(`\n🚀 Server running at http://localhost:${PORT}`);
      console.log(`📡 Socket.IO ready`);
      console.log(`🔐 Auth: http://localhost:${PORT}/auth/google`);
      console.log(`💚 Health: http://localhost:${PORT}/health\n`);
    });
  } catch (error) {
    console.error('❌ Failed to bootstrap:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  try {
    await stopBroadcastConsumer();
    await stopDBConsumer();
    await disconnectKafka();
    await mongoose.connection.close();
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the application
bootstrap();
