import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
const mockUseParams = vi.fn();
const mockUseSearchParams = vi.fn();

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockUseParams(),
  useSearchParams: () => mockUseSearchParams(),
}));

const mockOnAuthStateChanged = vi.fn();
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
}));

const mockGetDocs = vi.fn();
vi.mock("firebase/firestore/lite", () => ({
  collection: vi.fn(() => ({}) ),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  orderBy: vi.fn((field: string) => ({ field })),
  query: vi.fn((ref: unknown, _orderBy: unknown) => ({ ref })),
}));

vi.mock("../firebase.js", () => ({
  auth: { currentUser: { uid: "user-1" } },
  db: {},
}));

const mockAddFavorite = vi.fn();
const mockIsMealFavorited = vi.fn();
vi.mock("../utils/favoritesApi.js", () => ({
  addFavorite: (...args: unknown[]) => mockAddFavorite(...args),
  isMealFavorited: (...args: unknown[]) => mockIsMealFavorited(...args),
}));

const mockUpdateDiaryMeal = vi.fn();
const mockDeleteDiaryMeal = vi.fn();
vi.mock("../utils/mealsApi.js", () => ({
  updateDiaryMeal: (...args: unknown[]) => mockUpdateDiaryMeal(...args),
  deleteDiaryMeal: (...args: unknown[]) => mockDeleteDiaryMeal(...args),
}));

import MealCategoryScreen from "./MealCategoryScreen.js";

describe("MealCategoryScreen", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseParams.mockReset();
    mockUseSearchParams.mockReset();
    mockOnAuthStateChanged.mockReset();
    mockGetDocs.mockReset();
    mockAddFavorite.mockReset();
    mockIsMealFavorited.mockReset();
    mockUpdateDiaryMeal.mockReset();
    mockDeleteDiaryMeal.mockReset();

    mockUseParams.mockReturnValue({ mealType: "lunch" });
    mockUseSearchParams.mockReturnValue([new URLSearchParams("date=2026-07-26")]);
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      callback({ uid: "user-1" });
      return () => {};
    });
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: "meal-1",
          data: () => ({
            mealType: "lunch",
            mealName: "סלט עוף",
            totalCalories: 320,
            createdAt: new Date("2026-07-26T12:00:00.000Z"),
            analysisText: "הערכה סבירה: 320",
          }),
        },
      ],
    });
    mockIsMealFavorited.mockResolvedValue(false);
    mockDeleteDiaryMeal.mockResolvedValue(undefined);
  });

  it("asks for confirmation before deleting a meal and removes it from the visible list", async () => {
    const user = userEvent.setup();
    render(<MealCategoryScreen />);

    expect(await screen.findByText("סלט עוף")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "מחיקת ארוחה" }));

    expect(screen.getByText("Are you sure you want to delete this meal?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockDeleteDiaryMeal).toHaveBeenCalledWith("meal-1"));
    await waitFor(() => expect(screen.queryByText("סלט עוף")).not.toBeInTheDocument());
  });
});
