import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { analyzeMealPhoto } from "../utils/mealsApi.js";
import type { AnalyzeMealResponse, MealType } from "../types/mealAnalysis.js";

type CameraCaptureProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (imageBase64: string) => void;
  onAnalysisComplete?: (result: AnalyzeMealResponse) => void;
  preselectedMealType?: MealType;
};

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [header, base64Data] = dataUrl.split(",");
  if (!header || !base64Data) {
    throw new Error("Invalid data URL");
  }

  const mimeMatch = header.match(/data:(.*?);base64/);
  const mimeType = mimeMatch?.[1] || "image/jpeg";

  const byteString = atob(base64Data);
  const bytes = new Uint8Array(byteString.length);

  for (let i = 0; i < byteString.length; i += 1) {
    bytes[i] = byteString.charCodeAt(i);
  }

  return new File([bytes], fileName, { type: mimeType });
}

function getCameraErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return "לא ניתן להפעיל את המצלמה כרגע.";
  }

  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "הגישה למצלמה נחסמה. יש לאשר הרשאה למצלמה.";
  }

  if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
    return "לא נמצאה מצלמה במכשיר.";
  }

  return "לא ניתן להפעיל את המצלמה כרגע.";
}

export default function CameraCapture({
  isOpen,
  onClose,
  onConfirm,
  onAnalysisComplete,
  preselectedMealType,
}: CameraCaptureProps) {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMessage("הדפדפן שלך לא תומך במצלמה.");
      return;
    }

    setIsStartingCamera(true);
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
        audio: false,
      });

      const [firstTrack] = stream.getVideoTracks();
      if (!firstTrack) {
        stream.getTracks().forEach((track) => track.stop());
        setErrorMessage("לא נמצאה מצלמה במכשיר.");
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch (error) {
      setErrorMessage(getCameraErrorMessage(error));
    } finally {
      setIsStartingCamera(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    setCapturedImage(null);
    void startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video) return;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      setErrorMessage("לא ניתן לצלם כרגע. נסי שוב.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      setErrorMessage("לא ניתן לצלם כרגע. נסי שוב.");
      return;
    }

    context.drawImage(video, 0, 0, width, height);
    const imageBase64 = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedImage(imageBase64);
    stopCamera();
  };

  const handleRetake = async () => {
    setCapturedImage(null);
    await startCamera();
  };

  const handleConfirm = async () => {
    if (!capturedImage) return;

    setIsAnalyzing(true);
    setErrorMessage(null);

    try {
      onConfirm(capturedImage);

      const file = dataUrlToFile(capturedImage, `meal-${Date.now()}.jpg`);
      const analysisResult = await analyzeMealPhoto(file);

      onAnalysisComplete?.(analysisResult);
      stopCamera();
      onClose();

      navigate("/meal-analysis-result", {
        state: {
          analysisResult,
          preselectedMealType,
        },
      });
    } catch (error) {
      console.error("Failed to analyze meal image:", error);
      setErrorMessage("ניתוח הארוחה נכשל. נסי שוב.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-4 py-6"
    >
      <div className="w-full max-w-md rounded-3xl bg-[#1A1A1A] p-4 text-white shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">צילום ארוחה</h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border border-white/30 px-3 py-1 text-sm font-semibold hover:bg-white/10"
          >
            סגור
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl bg-black">
          {capturedImage ? (
            <img
              src={capturedImage}
              alt="תצוגה מקדימה של הארוחה"
              className="h-[56vh] w-full object-cover sm:h-[480px]"
            />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-[56vh] w-full object-cover sm:h-[480px]"
            />
          )}
        </div>

        {errorMessage && (
          <p className="mt-3 rounded-xl bg-red-500/20 px-3 py-2 text-sm text-red-100">
            {errorMessage}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {!capturedImage ? (
            <button
              type="button"
              onClick={handleCapture}
              disabled={Boolean(errorMessage) || isStartingCamera || isAnalyzing}
              className="min-w-24 rounded-full bg-orange px-5 py-2 text-base font-bold text-white shadow-md transition hover:bg-orange/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              צלם
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleRetake}
                disabled={isAnalyzing}
                className="min-w-24 rounded-full bg-white/15 px-5 py-2 text-base font-bold text-white transition hover:bg-white/25"
              >
                צלם שוב
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isAnalyzing}
                className="min-w-24 rounded-full bg-orange px-5 py-2 text-base font-bold text-white shadow-md transition hover:bg-orange/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAnalyzing ? "מנתחת..." : "אישור"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
