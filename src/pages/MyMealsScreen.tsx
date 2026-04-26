import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router";
import iphoneFrame from "../assets/iphone-frame.png";

export default function MyMealsScreen() {
  const navigate = useNavigate();

  return (
    <div dir="rtl" className="min-h-screen bg-cream">
      <div className="mx-auto flex min-h-screen w-full max-w-150 flex-col bg-cream pb-20">
        {/* Header */}
        <header className="px-4 pt-10 pb-4">
          <div className="flex items-center justify-between border-b border-[#CFC9C1] pb-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-full p-2 text-orange transition hover:bg-orange/10"
              aria-label="חזרה"
            >
              <ChevronRight className="h-7 w-7" />
            </button>

            <h1 className="text-2xl font-bold text-orange">הארוחות שלי</h1>

            <div className="h-11 w-11" />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 px-4 pt-6">
          <div className="flex justify-center">
            <button
              type="button"
              className="flex h-12 w-50 items-center justify-center rounded-full bg-orange text-xl font-bold text-white shadow-md transition hover:bg-orange/80 active:scale-95"
            >
              + צלם ארוחה
            </button>
          </div>

          <div className="mt-10">
            <img
              src={iphoneFrame}
              alt="camera preview"
              className="mx-auto w-full max-w-sm rounded-2xl shadow-md"
            />
          </div>
        </main>
      </div>
    </div>
  );
}
