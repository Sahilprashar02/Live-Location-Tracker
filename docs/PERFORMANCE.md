# Live Location Tracker — Performance

> Measured numbers, and the triggers for changing things.
> Filled from a single live snapshot and the code on 2026-10-20.

---

## 1. How to Read This Document

**Every number here was measured, not estimated.** Anything unmeasured is
marked UNKNOWN and left blank.

This is **not** a load test. There is no traffic generator, no p50/p95, no
throughput measurement, and no production analytics. The numbers below are a
single idle-container snapshot plus five HTTP requests from one workstation.
They prove the deployment is alive; they do not prove capacity.

> Never state a speedup you have not measured. “Added indexes” is a change.
> “Cut p95 from 800 ms to 90 ms” is a result. Only the second is worth writing.

---

## 2. Measured Environment

| Aspect | Value |
|---|---|
| Host | Oracle Cloud, `aarch64`, 4 vCPU, 23 GiB RAM (shared with other apps) |
| OS/kernel | Ubuntu 24.04.5 LTS, Linux `6.17.0-1020-oracle` `aarch64` |
| Backend runtime | `node:22-alpine` (Node `22.23.3`), container `llt-backend`, memory limit 1 GiB |
| MongoDB | `mongo:7` (`7.0.43`), container `global-mongodb`, memory limit 4 GiB |
| Kafka | `apache/kafka:3.9.1`, container `global-kafka`, memory limit 2 GiB, KRaft, 1 topic partition |
| Reverse proxy | `global-nginx` (nginx `1.27.5`), TLS |
| Frontend | Vercel static deployment |
| Workstation client | macOS, Node 24.21.0 (for tooling only; not the runtime) |
| Date | 2026-10-20 (refreshed `13:57 UTC`) |

The server is shared; other projects' load is not isolated from these
measurements.

---

## 3. Measured Baseline

### 3.1 HTTP latency from one workstation

Ten sequential requests, `curl -w '%{time_total}'`, no concurrency:

| Target | Status | Samples (s) | Median (s) |
|---|---|---|---|
| Backend `/health` | 200 | 0.1848, 0.0839, 0.1183, 0.1117, 0.1378, 0.1289, 0.0956, 0.1307, 0.0954, 0.1166 | **0.1174** |
| Vercel `/` | 200 | 0.1418, 0.1335, 0.1219, 0.1625, 0.1458, 0.1284, 0.1415, 0.1310, 0.1403, 0.1362 | **0.1382** |

These include public-internet latency to the origin and are not server-side
timings. They are reproducible only from a similar network location.

An earlier five-sample run at `13:55 UTC` had two `/health` outliers (1.29 s and
2.19 s); the ten-sample run above is the recorded baseline. No load was
generated, so these are not throughput or p95-under-load numbers.

### 3.2 Container resource snapshot

Three consecutive `docker stats --no-stream` samples at `13:57 UTC`; the
median is shown:

| Container | CPU | Memory usage | Memory limit | Approx. utilization |
|---|---|---|---|---|
| `llt-backend` | 1.50% | 54.67 MiB | 1 GiB | ~5.3% |
| `global-mongodb` | 0.42% | 160.6 MiB | 4 GiB | ~3.9% |
| `global-kafka` | 0.72% | 919.0 MiB | 2 GiB | ~44.9% |

Host memory: 23 GiB total, 3.0 GiB used, 923 MiB free, 19 GiB buff/cache
(20 GiB available). This is an **idle** snapshot; no user load was generated.

A preceding single sample showed transient CPU spikes (`llt-backend` 5.02%,
`global-mongodb` 63.55%, `global-kafka` 165.20%). The host is shared, so
other projects' load is not controlled.

### 3.3 Kafka

| Metric | Value |
|---|---|
| Topic partitions | 1 |
| Replication factor | 1 |
| `broadcast-group` lag | 0 (current offset 3, log-end offset 3) |
| `db-processor-group` lag | 0 (current offset 3, log-end offset 3) |
| Messages in topic at snapshot | 3 |

The topic had three historical events and both consumer groups were caught up.
This confirms the consumer groups are connected; it is not a throughput test.

### 3.4 MongoDB indexes and query plans

Read-only `getIndexes()` after the index deploy at `14:08 UTC`:

| Collection | Documents | Indexes present |
|---|---|---|
| `friends` | 0 | `_id`, `userId`, `friendId`, `status`, unique `userId+friendId`, `userId+status`, `friendId+status` |
| `sharesessions` | 0 | `_id`, unique `shareCode`, `ownerId`, `expiresAt`, `isActive`, `ownerId+isActive+expiresAt` |
| `geofences` | 0 | `_id`, `userId`, `targetUserId`, `targetUserId+isActive` |
| `locationhistories` | 3 | `_id`, unique `eventId`, `userId+timestamp:-1`, TTL `timestamp` (86400 s) |
| `users` | 1 | `_id`, unique `googleId` |

The latest-location query used by the share viewer:

```text
LocationHistory.findOne({ userId }).sort({ timestamp: -1 })
plan = LIMIT > FETCH > IXSCAN
returned = 1, keys examined = 1, docs examined = 1, executionTimeMillis = 0
```

The per-event queries were explained against the empty collections. Each chose
an index scan rather than a collection scan:

```text
Friend.find({ friendId, status: 'accepted' })         plan = FETCH > IXSCAN
Friend.find({ userId, status: 'accepted' })           plan = FETCH > IXSCAN
Geofence.find({ targetUserId, isActive: true })       plan = FETCH > IXSCAN
ShareSession.find({ ownerId, isActive, expiresAt })   plan = FETCH > FETCH > IXSCAN
```

All four returned `keys=0, docs=0, ms=0` because the collections are empty.
This proves index selection, not real-data latency. The missing-index finding is
addressed; query cost under real data remains **UNKNOWN**.

### 3.5 Not measured

| Metric | Status |
|---|---|
| Requests per second / concurrent sockets | **UNKNOWN** |
| p50/p95/p99 API latency under load | **UNKNOWN** |
| Socket event round-trip latency | **UNKNOWN** |
| Kafka produce latency and consumer throughput | **UNKNOWN** |
| Mongo query latency / `explain()` plans for friend/share/geofence queries | Index selection verified with empty collections; real-data latency **UNKNOWN** |
| Memory growth over hours/days | **UNKNOWN** |
| Deploy duration (build/restart/health phases) | **UNKNOWN** in this document; the deploy script prints it per run |
| Error rate | **UNKNOWN** |
| Browser bundle size / Core Web Vitals | **UNKNOWN** |

---

## 4. Bottlenecks Found and Verified

No bottleneck was **measured under load**. The following are code-level
findings (verified by reading the code) whose cost is **INFERRED**:

| Component | Finding | Verification | Root cause |
|---|---|---|---|
| Broadcast consumer | Two MongoDB queries per location event: accepted friends and active share sessions | `broadcastConsumer.js` `eachMessage` | Fan-out needs the current friend/share graph; there is no cache |
| Socket handler | One `Geofence.find` per location event, then one `save()` per fence whose state changed | `socket/handler.js` | Geofences are evaluated on ingest, not in a consumer |
| Socket handler | In-memory `activeUsers` and `rateLimitMap`; no cross-process state | `socket/handler.js` | Single-process design |
| Kafka | One partition, replication factor 1 | `config/kafka.js`; live topic description | Minimal compatible setup; single consumer per group |
| DB consumer | Buffer 50 / 5 s; `insertMany` + `User.updateMany` per flush | `dbConsumer.js` | Batched write design |
| Mongo indexes | Per-event friend/share/geofence queries originally had only separate single-field indexes | `models/*`; live `getIndexes()`; §3.4 | Index coverage was not tuned with `explain()` |
| Kafka memory | 919 MiB / 2 GiB idle | live `docker stats` | Broker baseline/JVM heap; not app-specific |
| Frontend | 5 s send throttle, 350 ms search debounce, 5 min weather cache | `app.js`, `search.js` | Client-side load control |

Live `getIndexes()` after the 2026-10-20 deploy confirmed all four compound
indexes are installed. `explain()` selected `IXSCAN` for each per-event query,
but the friend/share/geofence collections are empty, so real-data query cost is
still **UNKNOWN**. The broadcast consumer now runs its two independent lookups
concurrently; it still performs two queries per event.

Kafka's idle memory is notable but is the shared broker's baseline, not an LLT
leak. Do not reduce its limit without understanding the other projects using
it.

---

## 5. Changes Implemented

These are already in the code, not proposals:

| Change | Why it matters |
|---|---|
| Kafka decouples live fan-out from persistence | DB writes are batched instead of one per socket event |
| DB consumer buffers 50 events / 5 s | Fewer Mongo round-trips; `insertMany` |
| `eventId` unique + dedup cache | Idempotent retries; duplicate Kafka delivery does not duplicate history |
| Client 5 s send interval + server 3 s per-user limit | Bounds event rate per user |
| `{ userId, timestamp: -1 }` index | Latest-point lookup for a share link |
| TTL 24 h on `timestamp` | Bounds history size and retention |
| Compound indexes for per-event lookups | Covers `Friend.{friendId,status}`, `Geofence.{targetUserId,isActive}`, and active shares without changing query shapes |
| Concurrent friend/share consumer lookups | The two independent MongoDB queries now run in `Promise.all` instead of serially |
| Single Node process | Avoids duplicate socket state without an adapter; deliberately limits scale |
| Keyless Esri tiles for Dark/Light | Removes the CARTO API-key dependency and its failing requests |

No before/after measurement exists for any of these. Do not claim a speedup.

---

## 6. Before vs After

| Metric | Before | After | Delta |
|---|---|---|---|
| — | **UNKNOWN** | **UNKNOWN** | — |

There is no recorded baseline from before the Kafka batching or index changes.
If you need a before/after, capture one now and record the versions.

---

## 7. Resource Headroom

| Resource | Allowance | Consumption (idle snapshot) | Headroom |
|---|---|---|---|
| `llt-backend` memory | 1 GiB | 54.67 MiB | ~95% |
| `llt-backend` CPU | 4 shared vCPU (no per-container CPU limit) | 1.50% | Large at idle; unknown under load |
| `global-mongodb` memory | 4 GiB | 160.6 MiB | ~96% |
| `global-kafka` memory | 2 GiB | 919.0 MiB | ~55% |
| Host memory | 23 GiB | 3.0 GiB used + 19 GiB cache | ~20 GiB available |
| Kafka partitions | 1 | 1 | No parallelism |
| Backend replicas | 1 | 1 | No horizontal headroom by design |

The backend has lots of **memory** headroom but no **process/partition**
headroom. Memory is not the first constraint; fan-out and per-event queries
are.

---

## 8. Remaining Risks

| # | Risk | Mitigation | Status |
|---|---|---|---|
| 1 | No load test or real-user baseline | Run a staged socket/HTTP load test against a disposable environment | **Open** — idle baseline only |
| 2 | Single Node process cannot scale horizontally | Add a Socket.IO Redis adapter + sticky sessions + shared rate limiter before replicas | Open |
| 3 | One Kafka partition limits consumer parallelism | Review partitions and consumer group design before increasing | Open |
| 4 | Per-event friend/share/geofence queries | Compound indexes added; real-data plan and event-rate measurement still needed | **Open** — indexes added, unmeasured |
| 5 | No Kafka consumer-lag or event-loop-lag metric | Add metrics/alerting or periodic `kafka-consumer-groups --describe` | Open |
| 6 | In-memory rate limit/dedup state resets on restart | Accept for single process; move to Redis if replicating | Accepted |
| 7 | Public Nominatim/OSRM/tile quotas | Monitor 4xx/429 and tile failures; have a fallback/provider plan | Open |
| 8 | Kafka idle memory is ~45% of its limit | Shared-broker concern; coordinate with Infra before changing | Accepted |
| 9 | 24 h TTL makes old shares empty | Product decision; document the empty state | Accepted |
| 10 | No APM/tracing | Add structured logs/metrics if production usage grows | Open |

---

## 9. Scaling Triggers

> **Do not upgrade infrastructure until a measurement says to.** These are
> qualitative triggers because there is no baseline.

| Trigger | Action |
|---|---|
| `llt-backend` memory approaches 1 GiB, OOM kills, or grows without bound over hours | Investigate the in-memory maps/cache and leaks; do not just raise the limit |
| Event-loop lag or CPU saturation on the backend under normal use | Measure per-event queries; consider caching the friend/share graph; then revisit replicas |
| Sustained Kafka consumer lag > 0 for minutes | Inspect consumer health/DB latency; increase partitions/consumers only with an ordering review |
| MongoDB slow-query logs or `explain()` shows collection scans | Add compound indexes for `Friend.{friendId,status}` and active shares; measure before/after |
| Socket connection count or fan-out latency becomes the limiting factor | Add a Socket.IO Redis adapter + sticky sessions, then replicas |
| Mongo storage grows unexpectedly | Check TTL index health (`getIndexes()`), share/geofence retention, and session collection growth |
| 429/403 from Nominatim/OSRM or missing tiles | Reduce client request rate, cache results, or move to a provider with an SLA |
| Browser bundle/Core Web Vitals regress | Measure the Vite bundle and the live page; do not guess |

Raising the 1 GiB limit is not a scaling plan; a single process is the
architectural limit.

---

## 10. Re-measurement Commands

```bash
# Container CPU/memory (single snapshot)
ssh oracle 'docker stats --no-stream --format "{{.Name}} {{.CPUPerc}} {{.MemUsage}}" llt-backend global-mongodb global-kafka'

# Container limits
ssh oracle 'docker inspect -f "{{.HostConfig.Memory}}" llt-backend global-mongodb global-kafka'

# Host memory/CPU
ssh oracle 'nproc; free -h'

# Kafka topic and consumer lag
ssh oracle 'docker exec global-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic location-updates'
ssh oracle 'docker exec global-kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group broadcast-group'
ssh oracle 'docker exec global-kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group db-processor-group'

# HTTP total time (public network; not server-side)
for i in $(seq 1 10); do
  curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' https://llt.140-245-27-200.sslip.io/health
done

# Backend logs (flush timing/errors)
ssh oracle 'cd /opt/apps/live-location-tracker && docker compose -f docker-compose.prod.yml logs --tail=200 backend'

# MongoDB index verification (run inside the Mongo container/mongosh)
# db.locationhistories.getIndexes()
# db.friends.getIndexes()
# db.sharesessions.getIndexes()
# db.geofences.getIndexes()
# db.users.getIndexes()
```

All commands in this section were run read-only on 2026-10-20; results are in
§2–§3. For a real baseline, use a load generator and a disposable environment.
Do not load-test production without explicit authorisation.

---

## 11. Superseded Claims and Measurement Gaps

These claims were removed from the root README during the documentation pass:

| Former claim | Current status |
|---|---|
| “hundreds of concurrent users” | No load test; single process, one partition |
| “free, unlimited OSRM profiles” | Public demo servers; no SLA or measured quota |
| “high performance and scalability” | Architectural ceiling is one Node process; not measured |

There is still no recorded before/after for Kafka batching or indexes, so this
document cannot show a delta. See [README.md](./README.md) §6 for the
documentation-conflict policy.

---

## 12. Related Documents

| Need | Document |
|---|---|
| Index and reading order | [README.md](./README.md) |
| Query shapes and indexes | [DATABASE.md](./DATABASE.md) |
| Error diagnosis | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |
| Deployment topology | [DEPLOYMENT.md](./DEPLOYMENT.md) |
