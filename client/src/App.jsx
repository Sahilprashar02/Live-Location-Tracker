import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { LogIn, LogOut, MapPin, Navigation, Radio, UserRound } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const LOCATION_INTERVAL_MS = Number(import.meta.env.VITE_LOCATION_INTERVAL_MS || 5000);
const defaultCenter = [28.6139, 77.209];

const userIcon = new L.DivIcon({
  className: "marker marker-other",
  html: "<span></span>",
  iconSize: [22, 22],
  iconAnchor: [11, 11]
});

const selfIcon = new L.DivIcon({
  className: "marker marker-self",
  html: "<span></span>",
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

export default function App() {
  const [me, setMe] = useState(null);
  const [demoAuth, setDemoAuth] = useState(false);
  const [locations, setLocations] = useState(new Map());
  const [status, setStatus] = useState("Checking session");
  const [sharing, setSharing] = useState(false);
  const [socketState, setSocketState] = useState("offline");
  const [permissionState, setPermissionState] = useState("unknown");
  const socketRef = useRef(null);
  const latestPosition = useRef(null);
  const watchRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    fetch(`${API_URL}/api/me`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        setMe(data.user);
        setDemoAuth(data.demoAuth);
        setStatus(data.user ? "Ready to share location" : "Please log in");
      })
      .catch(() => setStatus("Backend is not reachable"));
  }, []);

  useEffect(() => {
    if (!me) return undefined;

    const socket = io(API_URL, { withCredentials: true });
    socketRef.current = socket;

    socket.on("connect", () => setSocketState("connected"));
    socket.on("disconnect", () => setSocketState("offline"));
    socket.on("connect_error", () => setSocketState("auth required"));

    socket.on("presence:snapshot", (users) => {
      setLocations(new Map(users.map((user) => [user.userId, user])));
    });

    socket.on("location:updated", (location) => {
      setLocations((previous) => {
        const next = new Map(previous);
        next.set(location.userId, location);
        return next;
      });
    });

    socket.on("user:offline", ({ userId }) => removeUser(userId));
    socket.on("user:stale", ({ userId }) => removeUser(userId));
    socket.on("location:error", () => setStatus("Invalid location rejected by server"));

    return () => {
      socket.disconnect();
    };
  }, [me]);

  function removeUser(userId) {
    setLocations((previous) => {
      const next = new Map(previous);
      next.delete(userId);
      return next;
    });
  }

  function login() {
    window.location.href = `${API_URL}/auth/login`;
  }

  function demoLogin(name) {
    window.location.href = `${API_URL}/auth/demo-login?name=${encodeURIComponent(name)}`;
  }

  async function logout() {
    stopSharing();
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    setMe(null);
    setLocations(new Map());
    setStatus("Logged out");
  }

  function startSharing() {
    if (!navigator.geolocation) {
      setStatus("Geolocation is not supported");
      return;
    }

    setStatus("Waiting for location permission");
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        latestPosition.current = position;
        setPermissionState("granted");
        setStatus("Sharing live location");
      },
      (error) => {
        setPermissionState("blocked");
        setStatus(error.message || "Location permission denied");
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );

    intervalRef.current = window.setInterval(sendLatestLocation, LOCATION_INTERVAL_MS);
    setSharing(true);
  }

  function stopSharing() {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    watchRef.current = null;
    intervalRef.current = null;
    setSharing(false);
    setStatus("Location sharing stopped");
  }

  function sendLatestLocation() {
    const socket = socketRef.current;
    const position = latestPosition.current;
    if (!socket?.connected || !position) return;

    socket.emit(
      "location:update",
      {
        eventId: crypto.randomUUID(),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
        timestamp: Date.now()
      },
      (ack) => {
        if (!ack?.ok) setStatus(`Update rejected: ${ack?.error || "unknown"}`);
      }
    );
  }

  const users = useMemo(() => Array.from(locations.values()), [locations]);
  const selfLocation = me ? locations.get(me.id) : null;
  const center = selfLocation ? [selfLocation.latitude, selfLocation.longitude] : defaultCenter;

  if (!me) {
    return (
      <main className="login-screen">
        <section className="login-panel">
          <div className="brand">
            <MapPin size={30} />
            <div>
              <h1>Live Location Tracker</h1>
              <p>Authenticated real-time movement over Socket.IO and Kafka.</p>
            </div>
          </div>
          <button className="primary-button" onClick={login}>
            <LogIn size={18} />
            Log in with OIDC
          </button>
          {demoAuth && (
            <div className="demo-grid">
              <button onClick={() => demoLogin("Demo Rider")}>Demo Rider</button>
              <button onClick={() => demoLogin("Demo Customer")}>Demo Customer</button>
            </div>
          )}
          <p className="status">{status}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand compact">
          <MapPin size={24} />
          <h1>Live Tracker</h1>
        </div>

        <div className="user-box">
          <UserRound size={20} />
          <div>
            <strong>{me.name}</strong>
            <span>{me.email || me.id}</span>
          </div>
        </div>

        <div className="actions">
          {!sharing ? (
            <button className="primary-button" onClick={startSharing}>
              <Navigation size={18} />
              Share Location
            </button>
          ) : (
            <button className="danger-button" onClick={stopSharing}>
              <Radio size={18} />
              Stop Sharing
            </button>
          )}
          <button className="ghost-button" onClick={logout}>
            <LogOut size={18} />
            Log out
          </button>
        </div>

        <dl className="metrics">
          <div>
            <dt>Socket</dt>
            <dd>{socketState}</dd>
          </div>
          <div>
            <dt>Permission</dt>
            <dd>{permissionState}</dd>
          </div>
          <div>
            <dt>Visible Users</dt>
            <dd>{users.length}</dd>
          </div>
        </dl>

        <div className="user-list">
          {users.map((user) => (
            <div className="user-row" key={user.userId}>
              <span className={user.userId === me.id ? "dot self" : "dot"} />
              <div>
                <strong>{user.userName}</strong>
                <span>{new Date(user.receivedAt).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="status">{status}</p>
      </aside>

      <section className="map-wrap">
        <MapContainer center={center} zoom={15} scrollWheelZoom className="map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Recenter position={center} follow={Boolean(selfLocation)} />
          {users.map((user) => (
            <Marker
              key={user.userId}
              position={[user.latitude, user.longitude]}
              icon={user.userId === me.id ? selfIcon : userIcon}
            >
              <Popup>
                <strong>{user.userName}</strong>
                <br />
                {user.userId === me.id ? "You" : "Live user"}
                <br />
                Accuracy: {Math.round(user.accuracy || 0)}m
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </section>
    </main>
  );
}

function Recenter({ position, follow }) {
  const map = useMap();

  useEffect(() => {
    if (follow) map.setView(position, map.getZoom(), { animate: true });
  }, [follow, map, position]);

  return null;
}
