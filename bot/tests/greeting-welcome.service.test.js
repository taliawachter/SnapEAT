import test from "node:test";
import assert from "node:assert/strict";
import {
  FULL_WELCOME_GREETING_REPLY,
  SHORT_GREETING_REPLY,
  getGreetingResponseForUser,
} from "../services/greeting-welcome.service.js";

test("first greeting returns the full welcome message", async () => {
  const savedFlags = [];

  const result = await getGreetingResponseForUser({
    phone: "+972501234567",
    text: "שלום",
    pendingState: null,
    storage: {
      async readWelcomeFlag() {
        return null;
      },
      async saveWelcomeFlag(phone, value) {
        savedFlags.push([phone, value]);
      },
    },
  });

  assert.equal(result.shouldReply, true);
  assert.equal(result.reply, FULL_WELCOME_GREETING_REPLY);
  assert.deepEqual(savedFlags, [["972501234567", true]]);
});

test("later greeting returns the short greeting", async () => {
  let readCount = 0;

  const result = await getGreetingResponseForUser({
    phone: "+972501234567",
    text: "היי",
    pendingState: null,
    storage: {
      async readWelcomeFlag() {
        readCount += 1;
        return true;
      },
      async saveWelcomeFlag() {
        throw new Error("should not save for later greetings");
      },
    },
  });

  assert.equal(result.shouldReply, true);
  assert.equal(result.reply, SHORT_GREETING_REPLY);
  assert.equal(readCount, 1);
});

test("restart-safe behavior uses the persisted flag", async () => {
  const result = await getGreetingResponseForUser({
    phone: "+972501234567",
    text: "מה נשמע",
    pendingState: null,
    storage: {
      async readWelcomeFlag() {
        return true;
      },
      async saveWelcomeFlag() {
        throw new Error("should not save after restart");
      },
    },
  });

  assert.equal(result.shouldReply, true);
  assert.equal(result.reply, SHORT_GREETING_REPLY);
});

test("active pending flow is not interrupted", async () => {
  let readCount = 0;
  let saveCount = 0;

  const result = await getGreetingResponseForUser({
    phone: "+972501234567",
    text: "שלום",
    pendingState: { step: "awaiting_confirmation" },
    storage: {
      async readWelcomeFlag() {
        readCount += 1;
        return null;
      },
      async saveWelcomeFlag() {
        saveCount += 1;
      },
    },
  });

  assert.equal(result.shouldReply, false);
  assert.equal(result.reply, null);
  assert.equal(readCount, 0);
  assert.equal(saveCount, 0);
});

test("firestore failure falls back safely to the short greeting", async () => {
  const result = await getGreetingResponseForUser({
    phone: "+972501234567",
    text: "בוקר טוב",
    pendingState: null,
    storage: {
      async readWelcomeFlag() {
        throw new Error("firestore unavailable");
      },
      async saveWelcomeFlag() {
        throw new Error("firestore unavailable");
      },
    },
  });

  assert.equal(result.shouldReply, true);
  assert.equal(result.reply, SHORT_GREETING_REPLY);
});
