import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const mockAnalyzeMealPhoto = vi.fn();
vi.mock("../utils/mealsApi.js", () => ({
  analyzeMealPhoto: (...args: unknown[]) => mockAnalyzeMealPhoto(...args),
}));

import CameraCapture from "./CameraCapture.js";

function fakeStream() {
  const track = { stop: vi.fn() };
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

describe("CameraCapture (meal photo upload)", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockAnalyzeMealPhoto.mockReset();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows an unsupported-browser message when the device has no camera API", async () => {
    vi.stubGlobal("navigator", { mediaDevices: undefined });

    render(<CameraCapture isOpen onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(await screen.findByText("הדפדפן שלך לא תומך במצלמה.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "צלם" })).toBeDisabled();
  });

  it("shows a permission-denied message when getUserMedia is blocked by the user", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(
      Object.assign(new DOMException("denied", "NotAllowedError"))
    );
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    render(<CameraCapture isOpen onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(
      await screen.findByText("הגישה למצלמה נחסמה. יש לאשר הרשאה למצלמה.")
    ).toBeInTheDocument();
  });

  it("shows a no-camera-found message distinctly from a permission error", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(
      Object.assign(new DOMException("none", "NotFoundError"))
    );
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    render(<CameraCapture isOpen onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(await screen.findByText("לא נמצאה מצלמה במכשיר.")).toBeInTheDocument();
  });

  it("captures a photo, analyzes it, and navigates to the result screen on success", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,ZmFrZS1pbWFnZQ=="
    );
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { value: 640, configurable: true });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { value: 480, configurable: true });

    const analysisResult = {
      imageUrl: "/uploads/meal-images/meal-1.jpg",
      analysis: { mealName: "סלט", totalCalories: 300 },
    };
    mockAnalyzeMealPhoto.mockResolvedValueOnce(analysisResult);

    const onConfirm = vi.fn();
    const onAnalysisComplete = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <CameraCapture
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        onAnalysisComplete={onAnalysisComplete}
      />
    );

    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    await user.click(await screen.findByRole("button", { name: "צלם" }));
    expect(await screen.findByRole("button", { name: "אישור" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "אישור" }));

    await waitFor(() => expect(mockAnalyzeMealPhoto).toHaveBeenCalled());
    expect(onConfirm).toHaveBeenCalledWith("data:image/jpeg;base64,ZmFrZS1pbWFnZQ==");
    await waitFor(() => expect(onAnalysisComplete).toHaveBeenCalledWith(analysisResult));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      "/meal-analysis-result",
      expect.objectContaining({ state: expect.objectContaining({ analysisResult }) })
    );
  });

  it("shows a Hebrew failure message and stays open when analysis fails", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,ZmFrZS1pbWFnZQ=="
    );
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { value: 640, configurable: true });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { value: 480, configurable: true });

    mockAnalyzeMealPhoto.mockRejectedValueOnce(new Error("network error"));

    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<CameraCapture isOpen onClose={onClose} onConfirm={vi.fn()} />);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await user.click(await screen.findByRole("button", { name: "צלם" }));
    await user.click(await screen.findByRole("button", { name: "אישור" }));

    expect(await screen.findByText("ניתוח הארוחה נכשל. נסי שוב.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders nothing when isOpen is false", () => {
    vi.stubGlobal("navigator", { mediaDevices: undefined });
    const { container } = render(<CameraCapture isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
