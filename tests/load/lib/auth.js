import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

import { config } from "./config.js";

export const authDuration = new Trend("auth_duration", true);

function recordAuthTiming(type, res) {
  authDuration.add(res.timings.duration, { type });
}

export function signup(email, password, name) {
  const res = http.post(
    `${config.webBaseUrl}/api/auth/signup`,
    JSON.stringify({ email, password, name }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { endpoint: "signup" },
    }
  );

  recordAuthTiming("signup", res);
  const ok = check(res, {
    "signup accepted": (r) => r.status === 200 || r.status === 409,
  });

  return { ok, res };
}

export function loginWithCredentials(email, password) {
  const csrfRes = http.get(`${config.webBaseUrl}/api/auth/csrf`, {
    tags: { endpoint: "auth-csrf" },
  });

  const csrfOk = check(csrfRes, {
    "csrf fetched": (r) => r.status === 200,
    "csrf token present": (r) => {
      const body = r.json();
      return Boolean(body && body.csrfToken);
    },
  });

  if (!csrfOk) {
    return { ok: false, sessionRes: csrfRes };
  }

  const csrfToken = csrfRes.json().csrfToken;

  const callbackRes = http.post(
    `${config.webBaseUrl}/api/auth/callback/credentials?json=true`,
    {
      csrfToken,
      email,
      password,
      callbackUrl: "/dashboard",
      json: "true",
    },
    {
      tags: { endpoint: "auth-callback" },
    }
  );

  recordAuthTiming("login", callbackRes);

  const callbackOk = check(callbackRes, {
    "credentials callback ok": (r) => r.status === 200 || r.status === 302,
  });

  const sessionRes = http.get(`${config.webBaseUrl}/api/auth/session`, {
    tags: { endpoint: "auth-session" },
  });

  const sessionOk = check(sessionRes, {
    "session endpoint ok": (r) => r.status === 200,
    "session has user": (r) => {
      const body = r.json();
      return Boolean(body && body.user && body.user.email);
    },
  });

  return {
    ok: callbackOk && sessionOk,
    callbackRes,
    sessionRes,
  };
}
