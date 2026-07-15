import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeLongTermMemoryPatch,
  sanitizeMemoryPatch,
} from "../services/memory-update/merge.helper.js";

function basePatch() {
  return sanitizeMemoryPatch({
    add: {},
    remove: {},
    replace: {},
    confidence: 0.9,
    shouldUpdate: true,
    reason: "test",
  });
}

test("1. New goal added", () => {
  const current = {};
  const patch = basePatch();
  patch.add.goals = ["לרדת 5 קילו"];

  const result = mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.equal(result.changed, true);
  assert.deepEqual(result.updatedMemory.goals, ["לרדת 5 קילו"]);
});

test("2. Contradictory goal replaced", () => {
  const current = { goals: ["לעלות במשקל"] };
  const patch = basePatch();
  patch.add.goals = ["לרדת 5 קילו"];

  const result = mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.deepEqual(result.updatedMemory.goals, ["לרדת 5 קילו"]);
});

test("3. Duplicate preference ignored", () => {
  const current = { dietaryPreferences: ["טבעונית"] };
  const patch = basePatch();
  patch.add.dietaryPreferences = ["  טבעונית  "];

  const result = mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.equal(result.changed, false);
  assert.deepEqual(result.updatedMemory.dietaryPreferences, ["טבעונית"]);
});

test("4. likedFoods removes matching dislikedFoods", () => {
  const current = { dislikedFoods: ["טונה"] };
  const patch = basePatch();
  patch.add.likedFoods = ["טונה"];

  const result = mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.deepEqual(result.updatedMemory.likedFoods, ["טונה"]);
  assert.deepEqual(result.updatedMemory.dislikedFoods, []);
});

test("5. dislikedFoods removes matching likedFoods", () => {
  const current = { likedFoods: ["טונה"] };
  const patch = basePatch();
  patch.add.dislikedFoods = ["טונה"];

  const result = mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.deepEqual(result.updatedMemory.dislikedFoods, ["טונה"]);
  assert.deepEqual(result.updatedMemory.likedFoods, []);
});

test("6. Allergy preserved when not mentioned", () => {
  const current = { allergies: ["בוטנים"] };
  const patch = basePatch();

  const result = mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.deepEqual(result.updatedMemory.allergies, ["בוטנים"]);
});

test("7. Allergy explicit removal accepted only at high confidence", () => {
  const current = { allergies: ["בוטנים"] };
  const patch = basePatch();
  patch.confidence = 0.99;
  patch.remove.allergies = ["בוטנים"];

  const result = mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.deepEqual(result.updatedMemory.allergies, []);
  assert.equal(result.blockedRemovals.length, 0);
});

test("8. Allergy removal blocked below safety threshold", () => {
  const current = { allergies: ["בוטנים"] };
  const patch = basePatch();
  patch.confidence = 0.8;
  patch.remove.allergies = ["בוטנים"];

  const result = mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.deepEqual(result.updatedMemory.allergies, ["בוטנים"]);
  assert.equal(result.blockedRemovals.length, 1);
});

test("9. Empty patch produces changed=false", () => {
  const current = { dietaryPreferences: ["צמחונית"] };
  const patch = basePatch();

  const result = mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.equal(result.changed, false);
});

test("10. Unknown patch fields are ignored", () => {
  const patch = sanitizeMemoryPatch({
    add: {
      unknownField: ["x"],
      goals: ["לרדת 3 קילו"],
    },
    remove: {
      hack: ["y"],
    },
    replace: {
      nope: ["z"],
    },
    confidence: 0.9,
    shouldUpdate: true,
    reason: "ok",
  });

  const result = mergeLongTermMemoryPatch({}, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.deepEqual(result.updatedMemory.goals, ["לרדת 3 קילו"]);
  assert.equal("unknownField" in result.updatedMemory, false);
});

test("11. Existing unrelated categories are preserved", () => {
  const current = {
    allergies: ["בוטנים"],
    customField: "keep-me",
  };
  const patch = basePatch();
  patch.add.goals = ["לרדת 2 קילו"];

  const result = mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.equal(result.updatedMemory.customField, "keep-me");
  assert.deepEqual(result.updatedMemory.allergies, ["בוטנים"]);
});

test("12. Input objects are not mutated", () => {
  const current = { likedFoods: ["אבוקדו"], dislikedFoods: ["טונה"] };
  const patch = basePatch();
  patch.add.likedFoods = ["טונה"];

  const beforeCurrent = JSON.parse(JSON.stringify(current));
  const beforePatch = JSON.parse(JSON.stringify(patch));

  mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: 0.95 });

  assert.deepEqual(current, beforeCurrent);
  assert.deepEqual(patch, beforePatch);
});
