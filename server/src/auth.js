import crypto from "node:crypto";
import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { nanoid } from "nanoid";
import { config } from "./config.js";

const discoveryCache = new Map();

export function createAuthRouter() {
  const router = express.Router();

  router.get("/demo-login", (req, res) => {
    if (!config.demoAuth) {
      res.status(404).send("Demo auth is disabled");
      return;
    }

    const name = req.query.name?.toString().trim() || `Demo User ${nanoid(4)}`;
    req.session.user = {
      id: `demo:${name.toLowerCase().replaceAll(" ", "-")}`,
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@demo.local`,
      provider: "demo"
    };
    res.redirect(config.clientOrigin);
  });

  router.get("/login", async (req, res, next) => {
    try {
      if (config.demoAuth) {
        res.redirect("/auth/demo-login");
        return;
      }

      const discovery = await getDiscovery();
      const state = nanoid(32);
      const nonce = nanoid(32);
      const verifier = base64Url(crypto.randomBytes(32));
      const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());

      req.session.oidc = { state, nonce, verifier };

      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.oidc.clientId,
        redirect_uri: config.oidc.redirectUri,
        scope: config.oidc.scopes,
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256"
      });

      res.redirect(`${discovery.authorization_endpoint}?${params.toString()}`);
    } catch (error) {
      next(error);
    }
  });

  router.get("/callback", async (req, res, next) => {
    try {
      if (!req.session.oidc || req.query.state !== req.session.oidc.state) {
        res.status(400).send("Invalid OIDC state");
        return;
      }

      const discovery = await getDiscovery();
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: req.query.code?.toString() || "",
        redirect_uri: config.oidc.redirectUri,
        client_id: config.oidc.clientId,
        code_verifier: req.session.oidc.verifier
      });

      if (config.oidc.clientSecret) {
        body.set("client_secret", config.oidc.clientSecret);
      }

      const tokenResponse = await fetch(discovery.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      });

      if (!tokenResponse.ok) {
        throw new Error(`OIDC token exchange failed with ${tokenResponse.status}`);
      }

      const tokens = await tokenResponse.json();
      const user = await verifyIdToken(tokens.id_token, discovery);

      req.session.user = user;
      delete req.session.oidc;
      res.redirect(config.clientOrigin);
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.status(204).end();
    });
  });

  return router;
}

async function getDiscovery() {
  if (!config.oidc.issuerUrl || !config.oidc.clientId) {
    throw new Error("OIDC_ISSUER_URL and OIDC_CLIENT_ID are required when DEMO_AUTH=false");
  }

  if (discoveryCache.has(config.oidc.issuerUrl)) {
    return discoveryCache.get(config.oidc.issuerUrl);
  }

  const response = await fetch(config.oidc.issuerUrl);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed with ${response.status}`);
  }

  const discovery = await response.json();
  discoveryCache.set(config.oidc.issuerUrl, discovery);
  return discovery;
}

async function verifyIdToken(idToken, discovery) {
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: discovery.issuer,
    audience: config.oidc.clientId
  });

  return {
    id: payload.sub,
    name: payload.name || payload.preferred_username || payload.email || payload.sub,
    email: payload.email,
    provider: discovery.issuer
  };
}

function base64Url(buffer) {
  return buffer.toString("base64url");
}
