const client = require('@prometheus-io/client');

const register = new client.Registry();

// Process/runtime metrics: CPU, memory, event-loop lag, GC, handles.
client.collectDefaultMetrics({
  register,
  prefix: 'llt_',
});

const httpRequestDuration = new client.Histogram({
  name: 'llt_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const activeSockets = new client.Gauge({
  name: 'llt_active_socket_connections',
  help: 'Number of currently connected Socket.IO sockets',
  registers: [register],
});

const activeUsers = new client.Gauge({
  name: 'llt_active_users',
  help: 'Number of unique users with an active Socket.IO connection',
  registers: [register],
});

const locationEventsProduced = new client.Counter({
  name: 'llt_location_events_produced_total',
  help: 'Location events published to Kafka',
  registers: [register],
});

const locationEventsDropped = new client.Counter({
  name: 'llt_location_events_dropped_total',
  help: 'Location events rejected before reaching Kafka',
  labelNames: ['reason'],
  registers: [register],
});

const locationEventsConsumed = new client.Counter({
  name: 'llt_location_events_consumed_total',
  help: 'Location events consumed from Kafka',
  labelNames: ['consumer'],
  registers: [register],
});

const geofenceAlerts = new client.Counter({
  name: 'llt_geofence_alerts_total',
  help: 'Geofence transition alerts emitted to clients',
  registers: [register],
});

const metricsMiddleware = (req, res, next) => {
  if (req.path === '/metrics') return next();

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route
      ? `${req.baseUrl}${req.route.path}`
      : 'static-or-unmatched';
    httpRequestDuration.observe(
      { method: req.method, route, status_code: res.statusCode },
      seconds
    );
  });

  next();
};

const metricsHandler = async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    console.error('Metrics collection failed:', error.message);
    res.status(500).end();
  }
};

module.exports = {
  register,
  metricsMiddleware,
  metricsHandler,
  activeSockets,
  activeUsers,
  locationEventsProduced,
  locationEventsDropped,
  locationEventsConsumed,
  geofenceAlerts,
};
