import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/favorites" }),
}));

const mockOnAuthStateChanged = vi.fn();
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
}));

vi.mock("../firebase.js", () => ({
  auth: {},
}));

const mockGetFavorites = vi.fn();
const mockRemoveFavorite = vi.fn();
const mockAddFavorite = vi.fn();
const mockAddFavoriteToDiary = vi.fn();
vi.mock("../utils/favoritesApi.js", () => ({
  getFavorites: (...args: unknown[]) => mockGetFavorites(...args),
  removeFavorite: (...args: unknown[]) => mockRemoveFavorite(...args),
  addFavorite: (...args: unknown[]) => mockAddFavorite(...args),
  addFavoriteToDiary: (...args: unknown[]) => mockAddFavoriteToDiary(...args),
}));

vi.mock("../utils/mealsApi.js", () => ({
  toAbsoluteUploadUrl: (url: string) => url,
}));

import FavoriteMealsScreen from "./FavoriteMealsScreen.js";

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

describe("FavoriteMealsScreen", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockOnAuthStateChanged.mockReset();
    mockGetFavorites.mockReset();
    mockRemoveFavorite.mockReset();
    mockAddFavorite.mockReset();
    mockAddFavoriteToDiary.mockReset();
  });

  it("redirects an unauthenticated user to /hello instead of loading favorites", async () => {
    signedOut();

    render(<FavoriteMealsScreen />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/hello", { replace: true }));
    expect(mockGetFavorites).not.toHaveBeenCalled();
  });

  it("shows an empty state after loading zero favorites for a signed-in user", async () => {
    signInAs("user-1");
    mockGetFavorites.mockResolvedValueOnce([]);

    render(<FavoriteMealsScreen />);

    expect(await screen.findByText("אין עדיין מועדפים")).toBeInTheDocument();
  });

  it("falls back to an empty list (not a crash) when Firestore read fails", async () => {
    signInAs("user-1");
    mockGetFavorites.mockRejectedValueOnce(new Error("firestore down"));

    render(<FavoriteMealsScreen />);

    expect(await screen.findByText("אין עדיין מועדפים")).toBeInTheDocument();
  });

  it("renders favorite cards and removes one when the delete button is clicked", async () => {
    signInAs("user-1");
    mockGetFavorites.mockResolvedValueOnce([
      { id: "fav-1", name: "סלט עוף", calories: 300 },
      { id: "fav-2", name: "טוסט", calories: 250 },
    ]);
    mockRemoveFavorite.mockResolvedValueOnce(undefined);

    const user = userEvent.setup();
    render(<FavoriteMealsScreen />);

    expect(await screen.findByText("סלט עוף")).toBeInTheDocument();
    expect(screen.getByText("טוסט")).toBeInTheDocument();

    const removeButtons = screen.getAllByRole("button", { name: "הסרה ממועדפים" });
    await user.click(removeButtons[0]!);

    await waitFor(() => expect(mockRemoveFavorite).toHaveBeenCalledWith("user-1", "fav-1"));
    await waitFor(() => expect(screen.queryByText("סלט עוף")).not.toBeInTheDocument());
    expect(screen.getByText("טוסט")).toBeInTheDocument();
  });

  it("adds a favorite to today's diary and shows a success message", async () => {
    signInAs("user-1");
    mockGetFavorites.mockResolvedValueOnce([{ id: "fav-1", name: "סלט עוף", calories: 300 }]);
    mockAddFavoriteToDiary.mockResolvedValueOnce(undefined);

    const user = userEvent.setup();
    render(<FavoriteMealsScreen />);

    await screen.findByText("סלט עוף");
    await user.click(screen.getByRole("button", { name: "הוסף להיום" }));

    const confirmButton = await screen.findByRole("button", { name: "הוסף" });
    await user.click(confirmButton);

    await waitFor(() => expect(mockAddFavoriteToDiary).toHaveBeenCalledWith("user-1", expect.objectContaining({ id: "fav-1" }), "lunch"));
    expect(await screen.findByText("סלט עוף נוסף ליומן היום!")).toBeInTheDocument();
  });
});
