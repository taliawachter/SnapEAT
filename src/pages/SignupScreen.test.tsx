import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const mockCreateUser = vi.fn();
const mockUpdateProfile = vi.fn();
vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: (...args: unknown[]) => mockCreateUser(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

const mockSetDoc = vi.fn();
vi.mock("firebase/firestore/lite", () => ({
  doc: vi.fn(() => ({ id: "doc-ref" })),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: () => "server-timestamp",
}));

vi.mock("../firebase.js", () => ({
  auth: {},
  db: {},
}));

import SignupScreen from "./SignupScreen.js";

async function fillValidForm(user: UserEvent) {
  await user.type(screen.getByPlaceholderText("כתובת אימייל"), "user@example.com");
  await user.type(screen.getByPlaceholderText("שם משתמש"), "תלי");
  await user.type(screen.getByPlaceholderText("מספר טלפון"), "0501234567");
  await user.type(screen.getByPlaceholderText("סיסמה"), "password123");
}

describe("SignupScreen", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockCreateUser.mockReset();
    mockUpdateProfile.mockReset();
    mockSetDoc.mockReset();
  });

  it("shows validation errors for empty required fields and does not call Firebase", async () => {
    const user = userEvent.setup();
    render(<SignupScreen />);

    await user.click(screen.getByRole("button", { name: "הרשמה" }));

    expect(await screen.findByText("חובה להזין כתובת אימייל")).toBeInTheDocument();
    expect(screen.getByText("חובה להזין שם משתמש")).toBeInTheDocument();
    expect(screen.getByText("חובה להזין מספר טלפון")).toBeInTheDocument();
    expect(screen.getByText("חובה להזין סיסמה")).toBeInTheDocument();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid Israeli phone number", async () => {
    const user = userEvent.setup();
    render(<SignupScreen />);

    await user.type(screen.getByPlaceholderText("כתובת אימייל"), "user@example.com");
    await user.type(screen.getByPlaceholderText("שם משתמש"), "תלי");
    await user.type(screen.getByPlaceholderText("מספר טלפון"), "123");
    await user.type(screen.getByPlaceholderText("סיסמה"), "password123");
    await user.click(screen.getByRole("button", { name: "הרשמה" }));

    expect(await screen.findByText("מספר הטלפון לא תקין")).toBeInTheDocument();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("creates the account, updates the profile, writes the Firestore user doc, and navigates to /details", async () => {
    mockCreateUser.mockResolvedValueOnce({ user: { uid: "u1" } });
    mockUpdateProfile.mockResolvedValueOnce(undefined);
    mockSetDoc.mockResolvedValueOnce(undefined);

    const user = userEvent.setup();
    render(<SignupScreen />);

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "הרשמה" }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/details"));
    expect(mockCreateUser).toHaveBeenCalledWith({}, "user@example.com", "password123");
    expect(mockUpdateProfile).toHaveBeenCalledWith({ uid: "u1" }, { displayName: "תלי" });
    // Israeli local number 0501234567 is normalized to international 972501234567
    expect(mockSetDoc).toHaveBeenCalledWith(
      { id: "doc-ref" },
      expect.objectContaining({ phone: "972501234567", uid: "u1" }),
      { merge: true }
    );
  });

  it("shows a Hebrew error when the email is already registered, without navigating", async () => {
    mockCreateUser.mockRejectedValueOnce({ code: "auth/email-already-in-use" });

    const user = userEvent.setup();
    render(<SignupScreen />);

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "הרשמה" }));

    expect(await screen.findByText("האימייל הזה כבר רשום במערכת")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows a generic fallback error for an unexpected signup failure", async () => {
    mockCreateUser.mockRejectedValueOnce(new Error("network down"));

    const user = userEvent.setup();
    render(<SignupScreen />);

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "הרשמה" }));

    expect(await screen.findByText("קרתה שגיאה בהרשמה, נסי שוב")).toBeInTheDocument();
  });
});
