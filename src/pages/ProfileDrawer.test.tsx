import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const mockSignOut = vi.fn();
const mockUpdateProfile = vi.fn();
vi.mock("firebase/auth", () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

const mockGetDoc = vi.fn();
vi.mock("firebase/firestore/lite", () => ({
  doc: vi.fn(() => ({ id: "user-doc" })),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

const mockAuth = vi.hoisted(
  () =>
    ({ currentUser: null }) as {
      currentUser: null | { uid: string; displayName: string | null; email: string | null };
    }
);
vi.mock("../firebase.js", () => ({
  auth: mockAuth,
  db: {},
}));

import ProfileDrawer from "./ProfileDrawer.js";

describe("ProfileDrawer", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSignOut.mockReset();
    mockUpdateProfile.mockReset();
    mockGetDoc.mockReset();
    mockAuth.currentUser = null;
  });

  it("falls back to a generic display name when signed out and no props are given", async () => {
    render(<ProfileDrawer isOpen onClose={vi.fn()} />);
    expect(await screen.findByText("משתמשת")).toBeInTheDocument();
  });

  it("uses the userName/userEmail props directly without a Firestore read when both are known", async () => {
    render(<ProfileDrawer isOpen onClose={vi.fn()} userName="דנה" userEmail="dana@example.com" />);

    expect(await screen.findByText("דנה")).toBeInTheDocument();
    expect(screen.getByText("dana@example.com")).toBeInTheDocument();
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it("falls back to the auth/prop values when Firestore read fails with permission-denied", async () => {
    mockAuth.currentUser = { uid: "u1", displayName: null, email: null };
    mockGetDoc.mockRejectedValueOnce({ code: "permission-denied" });

    render(<ProfileDrawer isOpen onClose={vi.fn()} userName="נועה" userEmail="noa@example.com" />);

    expect(await screen.findByText("נועה")).toBeInTheDocument();
    expect(screen.getByText("noa@example.com")).toBeInTheDocument();
  });

  it("logs out, clears localStorage, closes the drawer, and navigates to /hello", async () => {
    mockAuth.currentUser = { uid: "u1", displayName: "דנה", email: "dana@example.com" };
    mockSignOut.mockResolvedValueOnce(undefined);
    const clearSpy = vi.spyOn(Storage.prototype, "clear").mockImplementation(() => {});

    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ProfileDrawer isOpen onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "התנתקות" }));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(clearSpy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/hello");
  });

  it("still navigates home and clears state even when signOut itself throws", async () => {
    mockAuth.currentUser = { uid: "u1", displayName: "דנה", email: "dana@example.com" };
    mockSignOut.mockRejectedValueOnce(new Error("network error"));

    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ProfileDrawer isOpen onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "התנתקות" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith("/hello");
  });

  it("calling onClose (backdrop click) invokes the provided handler", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ProfileDrawer isOpen onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onClose).toHaveBeenCalled();
  });
});
