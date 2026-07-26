import test from "node:test";
import assert from "node:assert/strict";
import { shouldHandleStandaloneProfileUpdate } from "../services/nutrition-targets.service.js";

test("profile update messages only occur after actual profile changes", () => {
  assert.equal(
    shouldHandleStandaloneProfileUpdate("אני שוקל 68 קילו", {
      fields: { weightKg: 68 },
      invalidFields: {},
    }),
    true
  );

  assert.equal(
    shouldHandleStandaloneProfileUpdate("אני רוצה לרדת במשקל", {
      fields: { goal: "lose" },
      invalidFields: {},
    }),
    true
  );

  assert.equal(
    shouldHandleStandaloneProfileUpdate("גובה 17", {
      fields: {},
      invalidFields: { heightCm: { raw: "גובה 17" } },
    }),
    true
  );
});

test("nutrition questions never trigger profile updates", () => {
  assert.equal(
    shouldHandleStandaloneProfileUpdate("מה אני צריכה לאכול בשביל לרדת במשקל?", {
      fields: { goal: "lose" },
      invalidFields: {},
    }),
    false
  );

  assert.equal(
    shouldHandleStandaloneProfileUpdate("תן לי תפריט מתאים", {
      fields: {},
      invalidFields: {},
    }),
    false
  );

  assert.equal(
    shouldHandleStandaloneProfileUpdate("כמה חלבון אני צריכה?", {
      fields: {},
      invalidFields: {},
    }),
    false
  );

  assert.equal(
    shouldHandleStandaloneProfileUpdate("מה כדאי לאכול בערב?", {
      fields: {},
      invalidFields: {},
    }),
    false
  );
});
