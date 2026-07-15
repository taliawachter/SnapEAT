export const MEMORY_CATEGORIES = [
	"goals",
	"dietaryPreferences",
	"allergies",
	"sensitivities",
	"dietaryRestrictions",
	"likedFoods",
	"dislikedFoods",
	"eatingHabits",
	"persistentConstraints",
	"acceptedRecommendations",
	"importantNotes",
];

const REPLACEABLE_CATEGORIES = new Set([
	"goals",
	"dietaryPreferences",
	"dietaryRestrictions",
	"persistentConstraints",
]);

const SAFETY_SENSITIVE_CATEGORIES = new Set(["allergies", "sensitivities"]);

const MAX_ITEMS_PER_CATEGORY = 20;
const MAX_ITEM_LENGTH = 120;

function clamp01(value, fallback) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}

function normalizeText(value = "") {
	return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizedKey(value = "") {
	return normalizeText(value).toLowerCase();
}

function toStringArray(value) {
	if (Array.isArray(value)) return value;
	if (typeof value === "string") return [value];
	return [];
}

function uniqueNaturalValues(values = [], maxItems = MAX_ITEMS_PER_CATEGORY) {
	const output = [];
	const seen = new Set();

	for (const raw of values) {
		const cleaned = normalizeText(raw);
		if (!cleaned) continue;

		const limited = cleaned.slice(0, MAX_ITEM_LENGTH);
		const key = normalizedKey(limited);
		if (!key || seen.has(key)) continue;

		seen.add(key);
		output.push(limited);
		if (output.length >= maxItems) break;
	}

	return output;
}

function toNormalizedMap(values = []) {
	const map = new Map();
	for (const value of values) {
		const key = normalizedKey(value);
		if (!key || map.has(key)) continue;
		map.set(key, normalizeText(value));
	}
	return map;
}

function arraysEqualNormalized(a = [], b = []) {
	const aKeys = Array.from(new Set(a.map((item) => normalizedKey(item)).filter(Boolean))).sort();
	const bKeys = Array.from(new Set(b.map((item) => normalizedKey(item)).filter(Boolean))).sort();
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every((value, index) => value === bKeys[index]);
}

function classifyGoal(goal = "") {
	const text = normalizedKey(goal);
	if (!text) return "other";

	const loseMarkers = ["לרדת", "ירידה", "להפחית", "לחטב", "לשרוף שומן", "לרזות", "לרדת במשקל"];
	if (loseMarkers.some((marker) => text.includes(marker))) return "lose";

	const gainMarkers = ["לעלות", "עלייה", "להשמין", "מסה", "לעלות במשקל", "להעלות משקל"];
	if (gainMarkers.some((marker) => text.includes(marker))) return "gain";

	const maintainMarkers = ["לשמור", "שמירה", "תחזוקה", "לייצב", "לשמור על המשקל"];
	if (maintainMarkers.some((marker) => text.includes(marker))) return "maintain";

	return "other";
}

function getCategoryArray(profile = {}, category) {
	const raw = profile?.[category];
	return uniqueNaturalValues(toStringArray(raw));
}

export function sanitizeProfileForMemoryUpdate(profile = {}) {
	if (!profile || typeof profile !== "object" || Array.isArray(profile)) return {};

	const sanitized = {};
	for (const category of MEMORY_CATEGORIES) {
		const items = getCategoryArray(profile, category);
		if (items.length) sanitized[category] = items;
	}
	return sanitized;
}

export function sanitizeMemoryPatch(rawPatch) {
	const empty = {
		add: Object.fromEntries(MEMORY_CATEGORIES.map((category) => [category, []])),
		remove: Object.fromEntries(MEMORY_CATEGORIES.map((category) => [category, []])),
		replace: Object.fromEntries(Array.from(REPLACEABLE_CATEGORIES).map((category) => [category, null])),
		confidence: 0,
		shouldUpdate: false,
		reason: "",
	};

	if (!rawPatch || typeof rawPatch !== "object" || Array.isArray(rawPatch)) {
		return empty;
	}

	for (const category of MEMORY_CATEGORIES) {
		empty.add[category] = uniqueNaturalValues(toStringArray(rawPatch?.add?.[category]));
		empty.remove[category] = uniqueNaturalValues(toStringArray(rawPatch?.remove?.[category]));
	}

	for (const category of REPLACEABLE_CATEGORIES) {
		const rawValue = rawPatch?.replace?.[category];
		if (rawValue === null || rawValue === undefined) {
			empty.replace[category] = null;
			continue;
		}

		const cleaned = uniqueNaturalValues(toStringArray(rawValue));
		empty.replace[category] = cleaned.length ? cleaned : null;
	}

	empty.confidence = clamp01(rawPatch?.confidence, 0);
	empty.shouldUpdate = Boolean(rawPatch?.shouldUpdate);
	empty.reason = normalizeText(rawPatch?.reason || "").slice(0, 240);

	return empty;
}

export function mergeLongTermMemoryPatch(currentProfile = {}, patch, options = {}) {
	const safePatch = sanitizeMemoryPatch(patch);
	const safetyRemovalMinConfidence = clamp01(options?.safetyRemovalMinConfidence, 0.95);
	const nextProfile = {
		...(currentProfile && typeof currentProfile === "object" && !Array.isArray(currentProfile)
			? currentProfile
			: {}),
	};

	const blockedRemovals = [];
	const changedCategories = [];

	for (const category of MEMORY_CATEGORIES) {
		const originalValues = getCategoryArray(nextProfile, category);
		let workingMap = toNormalizedMap(originalValues);

		const replaceValues = safePatch.replace[category];
		if (Array.isArray(replaceValues)) {
			workingMap = toNormalizedMap(replaceValues);
		}

		const removals = safePatch.remove[category] || [];
		const additions = safePatch.add[category] || [];

		if (removals.length) {
			if (
				SAFETY_SENSITIVE_CATEGORIES.has(category)
				&& safePatch.confidence < safetyRemovalMinConfidence
			) {
				blockedRemovals.push({
					category,
					values: removals,
				});
			} else {
				for (const value of removals) {
					workingMap.delete(normalizedKey(value));
				}
			}
		}

		if (additions.length) {
			if (category === "goals" && !Array.isArray(replaceValues)) {
				for (const goal of additions) {
					const newClass = classifyGoal(goal);
					if (newClass === "other") continue;

					for (const [key, existingGoal] of Array.from(workingMap.entries())) {
						const existingClass = classifyGoal(existingGoal);
						if (existingClass === "other") continue;
						if (existingClass !== newClass) workingMap.delete(key);
					}
				}
			}

			for (const value of additions) {
				const key = normalizedKey(value);
				if (!key) continue;
				if (!workingMap.has(key)) workingMap.set(key, normalizeText(value));
			}
		}

		let nextValues = Array.from(workingMap.values());

		if (category === "likedFoods" || category === "dislikedFoods") {
			const oppositeCategory = category === "likedFoods" ? "dislikedFoods" : "likedFoods";
			const oppositeValues = getCategoryArray(nextProfile, oppositeCategory);
			const oppositeMap = toNormalizedMap(oppositeValues);
			const controllingValues = [
				...(safePatch.add[category] || []),
				...(Array.isArray(safePatch.replace[category]) ? safePatch.replace[category] : []),
			];

			for (const value of controllingValues) {
				oppositeMap.delete(normalizedKey(value));
			}

			const nextOpposite = Array.from(oppositeMap.values());
			if (!arraysEqualNormalized(oppositeValues, nextOpposite)) {
				nextProfile[oppositeCategory] = nextOpposite;
				if (!changedCategories.includes(oppositeCategory)) changedCategories.push(oppositeCategory);
			}
		}

		nextValues = uniqueNaturalValues(nextValues, MAX_ITEMS_PER_CATEGORY);

		if (!arraysEqualNormalized(originalValues, nextValues)) {
			nextProfile[category] = nextValues;
			changedCategories.push(category);
		} else if (category in nextProfile && !nextValues.length) {
			nextProfile[category] = nextValues;
		}
	}

	return {
		updatedMemory: nextProfile,
		changed: changedCategories.length > 0,
		changedCategories,
		blockedRemovals,
	};
}
