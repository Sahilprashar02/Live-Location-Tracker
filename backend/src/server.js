require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Model and Config imports
const User = require('./models/User');
const connectDB = require('./config/db');
const { initKafka, disconnectKafka } = require('./config/kafka');

// Consumer imports
const { startBroadcastConsumer, stopBroadcastConsumer } = require('./consumers/broadcastConsumer');
const { startDBConsumer, stopDBConsumer } = require('./consumers/dbConsumer');

// Socket handler import
const { initSocketHandler } = require('./socket/handler');

const PORT = process.env.PORT || 3000;
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

// Socket.IO middleware for authentication (Supports both Session and JWT)
io.use(async (socket, next) => {
  try {
    // 1. Check for JWT token (Preferred for Vercel/Incognito)
    const token = socket.handshake.auth.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.SESSION_SECRET);
        const user = await User.findById(decoded.id);
        if (user) {
          socket.request.user = user;
          return next();
        }
      } catch (err) {
        console.warn('Socket JWT verify failed, falling back to session');
      }
    }

    // 2. Fallback to session (For local dev or browsers that allow cookies)
    sessionMiddleware(socket.request, {}, (err) => {
      if (err) return next(err);
      if (socket.request.user) {
        return next();
      }
      next(new Error('Unauthorized'));
    });
  } catch (error) {
    next(new Error('Authentication error'));
  }
});

/**
 * Bootstrap the entire application
 */
const bootstrap = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Start server immediately for Render health checks
    server.listen(PORT, () => {
      console.log(`\n🚀 Server running on port ${PORT}`);
      console.log(`📡 Socket.IO ready with JWT support`);
    });

    // 3. Initialize Kafka in the background
    console.log('⏳ Initializing Kafka services...');
    initKafka()
      .then(async () => {
        await startBroadcastConsumer(io);
        await startDBConsumer();
        initSocketHandler(io);
        console.log('✅ Kafka and Socket services fully initialized');
      })
      .catch((error) => {
        console.error('❌ Kafka initialization failed:', error.message);
        // Fallback: still initialize socket handler so basic connectivity works
        initSocketHandler(io);
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
    server.close(() => process.exit(0));
  } catch (error) {
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

bootstrap();
