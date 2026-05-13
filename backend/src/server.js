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

// Trust Render's proxy to ensure correct protocol (https) in OAuth redirects
app.set('trust proxy', 1);

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
    secure: true, // Required for SameSite: 'none'
    sameSite: 'none', // Required for cross-domain (Vercel -> Render)
  },
});

// Normalize CLIENT_URL (remove trailing slash for CORS compatibility)
const CLIENT_URL = process.env.CLIENT_URL ? process.env.CLIENT_URL.replace(/\/$/, "") : null;

// CORS configuration for cross-domain sessions
if (CLIENT_URL) {
  app.use(cors({
    origin: CLIENT_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
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
    // 1. Connect to MongoDB (Required for sessions)
    await connectDB();

    // 2. Start server immediately
    // This ensures Render detects an open port quickly, preventing deployment timeouts.
    server.listen(PORT, () => {
      console.log(`\n🚀 Server running at http://localhost:${PORT}`);
      console.log(`📡 Socket.IO ready`);
      console.log(`🔐 Auth: http://localhost:${PORT}/auth/google`);
      console.log(`💚 Health: http://localhost:${PORT}/health\n`);
    });

    // 3. Initialize Kafka in the background
    // If Kafka fails to connect (e.g., local broker not running on Render), 
    // the server remains active to respond to health checks.
    console.log('⏳ Initializing Kafka services...');
    initKafka()
      .then(async () => {
        // Start consumers after Kafka is ready
        await startBroadcastConsumer(io);
        await startDBConsumer();

        // Initialize Socket.IO handler
        initSocketHandler(io);
        
        console.log('✅ Kafka and Socket services fully initialized');
      })
      .catch((error) => {
        console.error('❌ Kafka initialization failed:', error.message);
        console.log('⚠️ The app is running but real-time tracking via Kafka is unavailable.');
        
        // Still initialize basic socket handler so the app doesn't crash
        initSocketHandler(io);
      });

  } catch (error) {
    console.error('❌ Failed to bootstrap:', error);
    // Exit if core dependencies (DB) fail
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
