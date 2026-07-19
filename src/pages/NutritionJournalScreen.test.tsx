import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {userEvent} from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/home" }),
}));

const mockOnAuthStateChanged = vi.fn();
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
}));

const mockGetDocs = vi.fn();
vi.mock("firebase/firestore/lite", () => ({
  collection: vi.fn(() => ({})),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  doc: vi.fn(() => ({})),
  orderBy: vi.fn(),
  query: vi.fn(() => ({})),
}));

vi.mock("../firebase.js", () => ({
  auth: { currentUser: null },
  db: {},
}));

import NutritionJournalScreen from "./NutritionJournalScreen.js";

function signInAs(uid: string) {
  mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
    callback({ uid });
    return () => {};
  });
}

function signedOut() {
  mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
    callback(null);
    return () => {};
  });
}

function docsSnapshot(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
}

describe("NutritionJournalScreen", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockOnAuthStateChanged.mockReset();
    mockGetDocs.mockReset();
    localStorage.clear();
  });

  it("shows the zero-calorie fallback for a signed-out user without reading Firestore", async () => {
    signedOut();

    render(<NutritionJournalScreen />);

    expect(await screen.findByText("סטטוס קלוריות")).toBeInTheDocument();
    expect(screen.getByText("0 קל'")).toBeInTheDocument();
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("sums today's meals from Firestore into the calories card", async () => {
    signInAs("user-1");
    const today = new Date();
    mockGetDocs.mockResolvedValueOnce(
      docsSnapshot([
        { id: "m1", data: { mealType: "lunch", totalCalories: 300, createdAt: today } },
        { id: "m2", data: { mealType: "breakfast", totalCalories: 150, createdAt: today } },
      ])
    );

    render(<NutritionJournalScreen />);

    await waitFor(() => expect(screen.getByText("450 קל'")).toBeInTheDocument());
  });

  it("shows a permission-denied banner but keeps the app usable when Firestore rejects the read", async () => {
    signInAs("user-1");
    mockGetDocs.mockRejectedValueOnce({ code: "permission-denied" });

    render(<NutritionJournalScreen />);

    expect(
      await screen.findByText(
        "אין הרשאה לטעון את הארוחות מהשרת כרגע. אפשר להמשיך להשתמש באפליקציה, ולנסות שוב לאחר התחברות מחדש."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("0 קל'")).toBeInTheDocument();
  });

  it("switching to the weekly tab resets the period and persists the tab choice", async () => {
    signInAs("user-1");
    mockGetDocs.mockResolvedValueOnce(docsSnapshot([]));

    const user = userEvent.setup();
    render(<NutritionJournalScreen />);

    await screen.findByText("סטטוס קלוריות");
    await user.click(screen.getByRole("button", { name: "שבועי" }));

    await waitFor(() => expect(localStorage.getItem("nutritionJournal_activeTab")).toBe("weekly"));
  });
});
