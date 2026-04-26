import { useNavigate } from "react-router";

export default function WelcomeScreen() {
  const navigate = useNavigate();

  return (
    <section
      dir="rtl"
      className="flex min-h-screen w-full flex-col items-center justify-center bg-cream px-6 text-center sm:px-10"
    >
      <h1 className="mb-6 text-5xl font-bold text-orange ">
        היי!
      </h1>

      <p className="mb-10 max-w-150 whitespace-pre-line leading-8 text-black sm:text-2xl">
        {"כדי ש-SnapEAT תוכל להתאים לך\nיומן תזונה, נשמח למענה על מספר\nשאלות"}
      </p>

      <button
        onClick={() => navigate("/hello")}
        className="h-13 w-full max-w-70 rounded-full bg-orange text-lg font-bold text-white shadow-md"
      >
        מתחילים
      </button>
    </section>
  );
}