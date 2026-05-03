import http from "node:http";
import express from "express";
import session from "express-session";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import { config } from "./config.js";
import { createAuthRouter } from "./auth.js";
import { createConsumer, createProducer, ensureLocationTopic } from "./kafka.js";
import { isFreshTimestamp, locationPayloadSchema } from "./locationValidation.js";

const app = express();
const server = http.createServer(app);
const sessionMiddleware = session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false
  }
});

app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(sessionMiddleware);
app.use("/auth", createAuthRouter());

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null, demoAuth: config.demoAuth });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const io = new Server(server, {
  cors: { origin: config.clientOrigin, credentials: true }
});

io.engine.use(sessionMiddleware);

const activeUsers = new Map();
const seenEventIds = new Set();
let producer;

io.use((socket, next) => {
  const user = socket.request.session?.user;
  if (!user) {
    next(new Error("Authentication required"));
    return;
  }

  socket.user = user;
  next();
});

io.on("connection", (socket) => {
  const user = socket.user;
  socket.emit("presence:snapshot", Array.from(activeUsers.values()));

  socket.on("location:update", async (payload, ack) => {
    try {
      const parsed = locationPayloadSchema.parse(payload);

      if (!isFreshTimestamp(parsed.timestamp)) {
        ack?.({ ok: false, error: "stale_timestamp" });
        return;
      }

      if (seenEventIds.has(parsed.eventId)) {
        ack?.({ ok: false, error: "duplicate_event" });
        return;
      }

      rememberEvent(parsed.eventId);

      const event = {
        ...parsed,
        userId: user.id,
        userName: user.name,
        socketId: socket.id,
        receivedAt: Date.now()
      };

      await producer.send({
        topic: config.locationTopic,
        messages: [{ key: user.id, value: JSON.stringify(event) }]
      });

      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, error: "invalid_location" });
      socket.emit("location:error", { message: "Invalid location payload" });
    }
  });

  socket.on("disconnect", () => {
    const existing = activeUsers.get(user.id);
    if (existing?.socketId === socket.id) {
      activeUsers.delete(user.id);
      io.emit("user:offline", { userId: user.id });
    }
  });
});

async function startSocketBroadcaster() {
  const consumer = await createConsumer("socket-broadcaster");
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const event = JSON.parse(message.value.toString());
      const publicLocation = {
        userId: event.userId,
        userName: event.userName,
        latitude: event.latitude,
        longitude: event.longitude,
        accuracy: event.accuracy,
        heading: event.heading,
        speed: event.speed,
        timestamp: event.timestamp,
        receivedAt: event.receivedAt,
        socketId: event.socketId
      };
      activeUsers.set(event.userId, publicLocation);
      io.emit("location:updated", publicLocation);
    }
  });
}

function rememberEvent(eventId) {
  seenEventIds.add(eventId);
  if (seenEventIds.size > 10000) {
    const oldest = seenEventIds.values().next().value;
    seenEventIds.delete(oldest);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, user] of activeUsers.entries()) {
    if (now - user.receivedAt > config.staleUserMs) {
      activeUsers.delete(userId);
      io.emit("user:stale", { userId });
    }
  }
}, 10000);

async function start() {
  await ensureLocationTopic();
  producer = await createProducer();
  await startSocketBroadcaster();
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${config.port} is already in use. Stop that process or start this app with PORT=4010 CLIENT_ORIGIN=http://localhost:5174 npm run dev:server.`
      );
      process.exit(1);
    }

    throw error;
  });
  server.listen(config.port, () => {
    console.log(`API and Socket.IO server listening on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
