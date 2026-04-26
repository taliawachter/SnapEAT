import { useEffect } from "react";
import { useNavigate } from "react-router";

export default function SplashScreen() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate("/welcome");
    }, 2500);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <section className="flex min-h-screen w-full items-center justify-center bg-orange">
      <h1 className="text-5xl font-bold text-white sm:text-5xl md:text-6xl">
        SnapEAT.
      </h1>
    </section>
  );
}