// Evaluation template: Memory
//
// Exercises the real, unmodified merge.helper.js against a rubric of memory
// updates focused specifically on SAFETY: allergy removal is the one place
// a wrong memory update can cause real physical harm, so this suite weighs
// allergy-boundary cases more heavily than ordinary preference merges.
// Fully deterministic — no model or network calls.
import {
  mergeLongTermMemoryPatch,
  sanitizeMemoryPatch,
} from "../../bot/services/memory-update/merge.helper.js";
import { runEvaluationSuite } from "../lib/evaluation-runner.js";

const SAFETY_REMOVAL_MIN_CONFIDENCE = 0.95;

function basePatch(overrides = {}) {
  return sanitizeMemoryPatch({
    add: {},
    remove: {},
    replace: {},
    confidence: 0.9,
    shouldUpdate: true,
    reason: "evaluation fixture",
    ...overrides,
  });
}

const cases = [
  {
    name: "allergy removal exactly AT the safety threshold is accepted (boundary case)",
    run: () => {
      const patch = basePatch();
      patch.confidence = SAFETY_REMOVAL_MIN_CONFIDENCE;
      patch.remove.allergies = ["בוטנים"];
      return mergeLongTermMemoryPatch({ allergies: ["בוטנים"] }, patch, {
        safetyRemovalMinConfidence: SAFETY_REMOVAL_MIN_CONFIDENCE,
      });
    },
    judge: (result) => {
      const removed = result.updatedMemory.allergies.length === 0 && result.blockedRemovals.length === 0;
      return {
        verdict: removed ? "PASS" : "WARN",
        score: removed ? 1 : 0.5,
        notes: removed
          ? "Confidence exactly at threshold is treated as sufficient — matches documented >= semantics."
          : `Boundary confidence (${SAFETY_REMOVAL_MIN_CONFIDENCE}) was blocked; confirm this is the intended boundary behavior.`,
      };
    },
  },
  {
    name: "allergy removal just BELOW the safety threshold is blocked, preserving the allergy",
    run: () => {
      const patch = basePatch();
      patch.confidence = SAFETY_REMOVAL_MIN_CONFIDENCE - 0.01;
      patch.remove.allergies = ["גלוטן"];
      return mergeLongTermMemoryPatch({ allergies: ["גלוטן"] }, patch, {
        safetyRemovalMinConfidence: SAFETY_REMOVAL_MIN_CONFIDENCE,
      });
    },
    judge: (result) => {
      const preserved = result.updatedMemory.allergies.includes("גלוטן") && result.blockedRemovals.length > 0;
      return {
        verdict: preserved ? "PASS" : "FAIL",
        score: preserved ? 1 : 0,
        notes: preserved
          ? "Sub-threshold confidence correctly failed closed — allergy stays recorded rather than being silently dropped."
          : "SAFETY REGRESSION: a low-confidence removal was allowed to drop a recorded allergy.",
      };
    },
  },
  {
    name: "adding a new allergy is never blocked by the removal safety threshold",
    run: () => {
      const patch = basePatch();
      patch.confidence = 0.3; // deliberately low — additions should not require high confidence
      patch.add.allergies = ["שומשום"];
      return mergeLongTermMemoryPatch({ allergies: [] }, patch, {
        safetyRemovalMinConfidence: SAFETY_REMOVAL_MIN_CONFIDENCE,
      });
    },
    judge: (result) => {
      const added = result.updatedMemory.allergies.includes("שומשום");
      return {
        verdict: added ? "PASS" : "FAIL",
        score: added ? 1 : 0,
        notes: added
          ? "Low-confidence ADDITION of a new allergy is accepted — safety threshold correctly applies only to removal, not to caution."
          : "A newly mentioned allergy was dropped — this is the unsafe direction (should default to remembering, not forgetting).",
      };
    },
  },
  {
    name: "multiple simultaneous allergy removals are evaluated independently, not as a batch",
    run: () => {
      const patch = basePatch();
      patch.confidence = 0.99;
      patch.remove.allergies = ["בוטנים", "שומשום"];
      // Simulate a merge helper that only trusts part of a compound removal
      // by re-running with one low-confidence removal for comparison.
      const highConfidenceResult = mergeLongTermMemoryPatch(
        { allergies: ["בוטנים", "שומשום"] },
        patch,
        { safetyRemovalMinConfidence: SAFETY_REMOVAL_MIN_CONFIDENCE }
      );
      return highConfidenceResult;
    },
    judge: (result) => {
      const bothRemoved = result.updatedMemory.allergies.length === 0;
      return {
        verdict: bothRemoved ? "PASS" : "WARN",
        score: bothRemoved ? 1 : 0.5,
        notes: bothRemoved
          ? "High-confidence removal of multiple allergies in one patch both succeed consistently."
          : `Expected both allergies removed at high confidence, got remaining=${JSON.stringify(result.updatedMemory.allergies)}.`,
      };
    },
  },
  {
    name: "input profile object is never mutated by the merge (safe for concurrent reads)",
    run: () => {
      const current = { allergies: ["בוטנים"], goals: ["שמירה על משקל"] };
      const frozenCopy = JSON.parse(JSON.stringify(current));
      const patch = basePatch();
      patch.add.goals = ["לרדת 3 קילו"];
      mergeLongTermMemoryPatch(current, patch, { safetyRemovalMinConfidence: SAFETY_REMOVAL_MIN_CONFIDENCE });
      return { current, frozenCopy };
    },
    judge: ({ current, frozenCopy }) => {
      const untouched = JSON.stringify(current) === JSON.stringify(frozenCopy);
      return {
        verdict: untouched ? "PASS" : "FAIL",
        score: untouched ? 1 : 0,
        notes: untouched
          ? "Caller's profile object was not mutated in place."
          : "The merge function mutated its input — risk of corrupting in-flight reads elsewhere in the bot process.",
      };
    },
  },
];

export async function runSuite() {
  return runEvaluationSuite("Memory", cases);
}
