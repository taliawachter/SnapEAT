import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const mockSignIn = vi.fn();
vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignIn(...args),
}));

vi.mock("../firebase.js", () => ({
  auth: { currentUser: null },
}));

import LoginScreen from "./LoginScreen.js";

describe("LoginScreen", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSignIn.mockReset();
  });

  it("shows validation errors and does not call Firebase when fields are empty", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(screen.getByRole("button", { name: "התחברות" }));

    expect(await screen.findByText("חובה להזין כתובת אימייל")).toBeInTheDocument();
    expect(screen.getByText("חובה להזין סיסמה")).toBeInTheDocument();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("rejects a malformed email without calling Firebase", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(screen.getByPlaceholderText("כתובת אימייל"), "not-an-email");
    await user.type(screen.getByPlaceholderText("סיסמה"), "password123");
    await user.click(screen.getByRole("button", { name: "התחברות" }));

    expect(await screen.findByText("כתובת האימייל לא תקינה")).toBeInTheDocument();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("signs in and navigates to /home on success", async () => {
    mockSignIn.mockResolvedValueOnce({ user: { uid: "u1" } });
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(screen.getByPlaceholderText("כתובת אימייל"), "user@example.com");
    await user.type(screen.getByPlaceholderText("סיסמה"), "password123");
    await user.click(screen.getByRole("button", { name: "התחברות" }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/home"));
    expect(mockSignIn).toHaveBeenCalledWith(
      { currentUser: null },
      "user@example.com",
      "password123"
    );
  });

  it("shows a generic Hebrew error for wrong credentials without navigating", async () => {
    mockSignIn.mockRejectedValueOnce({ code: "auth/wrong-password" });
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(screen.getByPlaceholderText("כתובת אימייל"), "user@example.com");
    await user.type(screen.getByPlaceholderText("סיסמה"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "התחברות" }));

    expect(await screen.findByText("האימייל או הסיסמה שגויים")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows a generic fallback error for an unexpected Firebase error code", async () => {
    mockSignIn.mockRejectedValueOnce({ code: "auth/network-request-failed" });
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(screen.getByPlaceholderText("כתובת אימייל"), "user@example.com");
    await user.type(screen.getByPlaceholderText("סיסמה"), "password123");
    await user.click(screen.getByRole("button", { name: "התחברות" }));

    expect(await screen.findByText("קרתה שגיאה בהתחברות, נסי שוב")).toBeInTheDocument();
  });
});
