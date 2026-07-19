import test, { mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// ---------------------------------------------------------------------
// Fakes for every external service the API routes touch. These are
// installed BEFORE app.harness.js (and therefore the real production
// service modules it imports) are loaded, so the harness runs its real
// code paths against fakes instead of live Firebase / OpenAI.
// ---------------------------------------------------------------------

process.env.OPENAI_API_KEY = ""; // first test exercises the "not configured" path

function createFakeFirestore() {
  const store = new Map();

  function docRef(fullPath) {
    return {
      collection: (name) => collectionRef(`${fullPath}/${name}`),
      get: async () => {
        const data = store.get(fullPath);
        return {
          exists: data !== undefined,
          id: fullPath.split("/").pop(),
          data: () => (data ? { ...data } : undefined),
        };
      },
      set: async (data, opts = {}) => {
        if (opts.merge) {
          store.set(fullPath, { ...(store.get(fullPath) || {}), ...data });
        } else {
          store.set(fullPath, { ...data });
        }
      },
    };
  }

  function collectionRef(fullPath) {
    return {
      doc: (id) => docRef(`${fullPath}/${id}`),
      add: async (data) => {
        const id = `auto-${Math.random().toString(36).slice(2, 10)}`;
        store.set(`${fullPath}/${id}`, { ...data });
        return { id };
      },
    };
  }

  return {
    collection: (name) => collectionRef(name),
    _seed(fullPath, data) {
      store.set(fullPath, { ...data });
    },
  };
}

let currentDb = createFakeFirestore();
let currentVerifyIdToken = async () => {
  throw new Error("no token configured for this test");
};
let currentChatCompletionsCreate = async () => {
  throw new Error("no OpenAI response configured for this test");
};

mock.module("../firebase-admin.js", {
  namedExports: {
    db: new Proxy({}, { get: (_t, prop) => currentDb[prop] }),
    bucket: {},
  },
});

mock.module("firebase-admin/auth", {
  namedExports: {
    getAuth: () => ({
      verifyIdToken: (token) => currentVerifyIdToken(token),
    }),
  },
});

class FakeOpenAI {
  constructor() {
    this.chat = {
      completions: {
        create: (params) => currentChatCompletionsCreate(params),
      },
    };
  }
}

mock.module("openai", { defaultExport: FakeOpenAI });

const { createTestApp } = await import("./app.harness.js");

async function startServer() {
  const app = createTestApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function fakeChatCompletion(jsonPayload) {
  return {
    choices: [{ message: { content: JSON.stringify(jsonPayload) } }],
  };
}

const HIGH_CONFIDENCE_MEAL_RESPONSE = {
  mealName: "סלט עוף",
  description: "סלט עוף עם ירקות",
  totalEstimatedQuantityGrams: 350,
  ingredients: [
    {
      name: "חזה עוף",
      estimatedQuantity: "150 גרם",
      estimatedQuantityGrams: 150,
      calories: 250,
      proteinGrams: 40,
      carbohydratesGrams: 0,
      fatGrams: 8,
      confidence: 0.9,
    },
    {
      name: "ירקות",
      estimatedQuantity: "200 גרם",
      estimatedQuantityGrams: 200,
      calories: 60,
      proteinGrams: 3,
      carbohydratesGrams: 10,
      fatGrams: 1,
      confidence: 0.9,
    },
  ],
  totalCalories: 310,
  totalProteinGrams: 43,
  totalCarbohydratesGrams: 10,
  totalFatGrams: 9,
  confidence: 0.9,
  estimationNotes: "",
};

// -------------------------
// POST /api/meals/analyze
// -------------------------

test("POST /api/meals/analyze returns 503 AI_NOT_CONFIGURED-shaped error when OPENAI_API_KEY is missing", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const form = new FormData();
    form.append("mealImage", new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "meal.jpg");

    const res = await fetch(`${baseUrl}/api/meals/analyze`, { method: "POST", body: form });
    const body = await res.json();

    assert.equal(res.status, 503);
    assert.equal(body.error, "AI analysis is not configured");
  } finally {
    server.close();
  }
});

test("POST /api/meals/analyze returns 400 when no image file is attached", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const { server, baseUrl } = await startServer();
  try {
    const form = new FormData();
    form.append("note", "no image here");

    const res = await fetch(`${baseUrl}/api/meals/analyze`, { method: "POST", body: form });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error, "Missing meal image");
  } finally {
    server.close();
  }
});

test("POST /api/meals/analyze returns normalized analysis on a successful OpenAI call", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  currentChatCompletionsCreate = async () => fakeChatCompletion(HIGH_CONFIDENCE_MEAL_RESPONSE);

  const { server, baseUrl } = await startServer();
  try {
    const form = new FormData();
    form.append("mealImage", new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "meal.jpg");

    const res = await fetch(`${baseUrl}/api/meals/analyze`, { method: "POST", body: form });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.analysis.mealName, "סלט עוף");
    assert.equal(body.analysis.totalCalories, 310);
    assert.match(body.imageUrl, /^\/uploads\/meal-images\/meal-/);
  } finally {
    server.close();
  }
});

test("POST /api/meals/analyze returns 500 without leaking internal error details when OpenAI fails", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  currentChatCompletionsCreate = async () => {
    throw new Error("upstream rate limit exceeded: sk-abc123secret");
  };

  const { server, baseUrl } = await startServer();
  try {
    const form = new FormData();
    form.append("mealImage", new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "meal.jpg");

    const res = await fetch(`${baseUrl}/api/meals/analyze`, { method: "POST", body: form });
    const text = await res.text();

    assert.equal(res.status, 500);
    assert.doesNotMatch(text, /sk-abc123secret/);
  } finally {
    server.close();
  }
});

// -------------------------
// POST /api/diary/meals
// -------------------------

test("POST /api/diary/meals returns 400 when required fields are missing", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/diary/meals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "u1" }),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error, "Missing required fields");
  } finally {
    server.close();
  }
});

test("POST /api/diary/meals returns 400 for an invalid mealType", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/diary/meals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "u1",
        mealType: "midnight-snack",
        mealName: "toast",
        imageUrl: "/uploads/meal-images/x.jpg",
        ingredients: [],
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error, "Invalid meal type");
  } finally {
    server.close();
  }
});

test("POST /api/diary/meals persists a valid meal to Firestore (mocked) and returns 201", async () => {
  currentDb = createFakeFirestore();
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/diary/meals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        mealType: "lunch",
        mealName: "סלט עוף",
        imageUrl: "/uploads/meal-images/x.jpg",
        ingredients: [{ name: "חזה עוף", calories: 250 }],
        totalCalories: 310,
        protein: 43,
        carbs: 10,
        fat: 9,
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.ok, true);
    assert.ok(body.id);
  } finally {
    server.close();
  }
});

// -------------------------
// PATCH /api/diary/meals/:mealId (authenticated)
// -------------------------

test("PATCH /api/diary/meals/:mealId returns 401 UNAUTHORIZED with no Authorization header", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/diary/meals/meal-1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mealName: "x" }),
    });
    const body = await res.json();

    assert.equal(res.status, 401);
    assert.equal(body.code, "UNAUTHORIZED");
  } finally {
    server.close();
  }
});

test("PATCH /api/diary/meals/:mealId returns 401 UNAUTHORIZED for a token that fails verification", async () => {
  currentVerifyIdToken = async () => {
    throw new Error("invalid token");
  };
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/diary/meals/meal-1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer bad-token" },
      body: JSON.stringify({ mealName: "x" }),
    });
    const body = await res.json();

    assert.equal(res.status, 401);
    assert.equal(body.code, "UNAUTHORIZED");
  } finally {
    server.close();
  }
});

test("PATCH /api/diary/meals/:mealId returns 404 MEAL_NOT_FOUND for a valid user editing a meal that doesn't exist", async () => {
  currentVerifyIdToken = async () => ({ uid: "user-1" });
  currentDb = createFakeFirestore();

  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/diary/meals/does-not-exist`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer good-token" },
      body: JSON.stringify({
        mealName: "סלט",
        mealType: "lunch",
        totalCalories: 200,
        ingredients: [],
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.code, "MEAL_NOT_FOUND");
  } finally {
    server.close();
  }
});

test("PATCH /api/diary/meals/:mealId rejects an invalid draft (negative calories) with 400 INVALID_MEAL_PAYLOAD", async () => {
  currentVerifyIdToken = async () => ({ uid: "user-1" });
  currentDb = createFakeFirestore();
  currentDb._seed("users/user-1/meals/meal-1", {
    mealType: "lunch",
    mealName: "סלט",
    imageUrl: "/uploads/meal-images/x.jpg",
    ingredients: [],
    totalCalories: 200,
    createdAt: new Date(),
    source: "app",
  });

  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/diary/meals/meal-1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer good-token" },
      body: JSON.stringify({
        mealName: "סלט",
        mealType: "lunch",
        totalCalories: -50,
        ingredients: [],
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.code, "INVALID_MEAL_PAYLOAD");
  } finally {
    server.close();
  }
});

test("PATCH /api/diary/meals/:mealId updates an existing meal end-to-end for the authenticated owner", async () => {
  currentVerifyIdToken = async () => ({ uid: "user-1" });
  currentDb = createFakeFirestore();
  currentDb._seed("users/user-1/meals/meal-1", {
    mealType: "lunch",
    mealName: "סלט ישן",
    imageUrl: "/uploads/meal-images/x.jpg",
    ingredients: [],
    totalCalories: 200,
    createdAt: new Date(),
    source: "app",
  });

  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/diary/meals/meal-1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer good-token" },
      body: JSON.stringify({
        mealName: "סלט מעודכן",
        mealType: "lunch",
        totalCalories: 400,
        totalProteinGrams: 50,
        totalCarbohydratesGrams: 30,
        totalFatGrams: 13,
        ingredients: [{ name: "עוף", calories: 400, proteinGrams: 50, carbohydratesGrams: 30, fatGrams: 13 }],
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.meal.mealName, "סלט מעודכן");
    assert.equal(body.meal.totalCalories, 400);
  } finally {
    server.close();
  }
});

test("GET / responds so basic liveness/health checks pass", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});
