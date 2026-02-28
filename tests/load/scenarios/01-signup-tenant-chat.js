import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

import { loginWithCredentials, signup } from "../lib/auth.js";
import { sendChatMessage } from "../lib/chat.js";
import { randomString } from "../lib/config.js";

const onboardingSuccess = new Rate("onboarding_success_rate");
const onboardingDuration = new Trend("onboarding_flow_duration", true);

export const options = {
  scenarios: {
    signup_tenant_chat: {
      executor: "per-vu-iterations",
      vus: Number(__ENV.SIGNUP_VUS || 50),
      iterations: 1,
      maxDuration: __ENV.SIGNUP_MAX_DURATION || "30m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    "auth_duration{type:signup}": ["p(99)<200"],
    "auth_duration{type:login}": ["p(99)<200"],
    onboarding_success_rate: ["rate>0.95"],
  },
};

export default function () {
  const start = Date.now();
  const email = `${randomString("tenant")}-${__VU}-${__ITER}@example.test`;
  const password = "LoadTest!1234";

  const signupStep = signup(email, password, `Tenant ${__VU}`);
  const loginStep = loginWithCredentials(email, password);

  let chatOk = false;
  if (loginStep.ok) {
    const chatStep = sendChatMessage("Hello, this is my first message.");
    chatOk = chatStep.ok;
  }

  const success = signupStep.ok && loginStep.ok && chatOk;
  onboardingSuccess.add(success ? 1 : 0);
  onboardingDuration.add(Date.now() - start);

  check({ success }, {
    "signup -> tenant creation -> first chat succeeded": (s) => s.success,
  });
}
