import dotenv from "dotenv";

dotenv.config({ path: new URL("../../.env", import.meta.url).pathname });

export const config = {
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  sessionSecret: process.env.SESSION_SECRET || "dev-secret-change-me",
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  locationTopic: process.env.LOCATION_TOPIC || "location-updates",
  staleUserMs: Number(process.env.STALE_USER_MS || 45000),
  demoAuth: process.env.DEMO_AUTH !== "false",
  oidc: {
    issuerUrl: process.env.OIDC_ISSUER_URL,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    redirectUri: process.env.OIDC_REDIRECT_URI || "http://localhost:4000/auth/callback",
    scopes: process.env.OIDC_SCOPES || "openid profile email"
  }
};
