import { check, sleep } from "k6";
import { Rate } from "k6/metrics";
import ws from "k6/ws";

import { loginWithCredentials, signup } from "../lib/auth.js";
import { randomMessage, sendChatMessage } from "../lib/chat.js";
import { config, randomString, randomWsTenantId } from "../lib/config.js";

const chatSessionSuccess = new Rate("chat_session_success_rate");
const wsSessionSuccess = new Rate("ws_session_success_rate");
const wsSessionAttempted = new Rate("ws_session_attempt_rate");
const wsVus = Number(__ENV.WS_VUS || 0);

const vuState = {
  initialized: false,
  conversationId: "",
};

export const options = {
  scenarios: {
    chat_sessions: {
      executor: "constant-vus",
      vus: Number(__ENV.CHAT_VUS || 50),
      duration: __ENV.CHAT_DURATION || config.scenarioDuration,
      gracefulStop: "30s",
      exec: "chatSession",
    },
    websocket_stability: {
      executor: "constant-vus",
      vus: wsVus,
      duration: __ENV.WS_DURATION || config.wsDuration,
      gracefulStop: "30s",
      exec: "websocketSession",
      startTime: __ENV.WS_START_TIME || "0s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    chat_session_success_rate: ["rate>0.95"],
  },
};

if (wsVus > 0) {
  options.thresholds.ws_session_success_rate = ["rate>0.95"];
}

function ensureAuthenticatedSession() {
  if (vuState.initialized) {
    return true;
  }

  const email = `${randomString("chat")}-${__VU}@example.test`;
  const password = "LoadTest!1234";

  signup(email, password, `Chat User ${__VU}`);
  const login = loginWithCredentials(email, password);
  vuState.initialized = login.ok;
  return vuState.initialized;
}

export function chatSession() {
  if (!ensureAuthenticatedSession()) {
    chatSessionSuccess.add(0);
    return;
  }

  const message = randomMessage();
  const chat = sendChatMessage(message, vuState.conversationId);
  if (chat.ok) {
    vuState.conversationId = chat.conversationId;
  }

  chatSessionSuccess.add(chat.ok ? 1 : 0);
  sleep(Number(__ENV.CHAT_THINK_TIME_SECONDS || "1"));
}

export function websocketSession() {
  const tenantId = randomWsTenantId(__VU - 1);
  if (!tenantId) {
    wsSessionAttempted.add(0);
    wsSessionSuccess.add(1);
    return;
  }

  wsSessionAttempted.add(1);

  const sessionSeconds = Number(__ENV.WS_SESSION_SECONDS || "3600");
  const url = `${config.apiBaseUrl.replace("http", "ws")}/api/tenants/${tenantId}/terminal`;

  const response = ws.connect(url, {}, function (socket) {
    let opened = false;

    socket.on("open", function () {
      opened = true;
      socket.send("echo load-test\n");
    });

    socket.on("binaryMessage", function () {
      // Keep connection alive with occasional command writes.
    });

    socket.setInterval(function () {
      socket.send("pwd\n");
    }, 15000);

    socket.setTimeout(function () {
      socket.close();
    }, sessionSeconds * 1000);

    socket.on("close", function () {
      wsSessionSuccess.add(opened ? 1 : 0);
    });

    socket.on("error", function () {
      wsSessionSuccess.add(0);
    });
  });

  check(response, {
    "websocket handshake 101": (r) => r && r.status === 101,
  });
}
