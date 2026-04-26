import { FaFacebookSquare } from "react-icons/fa";
import { SiGmail } from "react-icons/si";

import { useNavigate } from "react-router";
import foodImage from "../assets/hello-food.png";

export default function HelloScreen() {
  const navigate = useNavigate();

  return (
   
      <section  dir="rtl"
      className="w-full h-full min-h-screen bg-cream flex flex-col items-center px-6 py-10 sm:px-10 md:px-16">

        <div className="mb-8 text-center">
          <p className="text-xl text-black sm:text-2xl">
            Welcome to
          </p>
          <h1 className="text-4xl font-bold text-orange sm:text-4xl md:text-5xl">
            .SnapEAT
          </h1>
        </div>

        <div className="mb-8 w-full max-w-90 overflow-hidden rounded-4xl">
          <div className="relative aspect-square w-full">
            <img
              src={foodImage}
              alt="SnapEAT bowl"
              className="h-full w-full object-cover"
            />
          </div>
        </div>

        <div className="mb-6 max-w-150 grid w-full grid-cols-2 gap-4">
          <button
            onClick={() => navigate("/signup")}
            className="h-14 rounded-2xl bg-orange font-bold text-white shadow-md sm:text-xl"
          >
            הרשמה
          </button>

          <button
            onClick={() => navigate("/login")}
            className="h-14 rounded-2xl bg-orange font-bold text-white shadow-md sm:text-xl"
          >
            התחברות
          </button>
        </div>

        <div className="w-full max-w-150 flex flex-col gap-4">
          <button className="flex h-14 items-center justify-center gap-3 rounded-2xl bg-facebook text-white shadow-md">
            <span className="text-xl sm:text-xl "> התחברות עם Facebook </span>
            <FaFacebookSquare className="text-xl font-bold" />
          </button>

          <button className="flex h-14 items-center justify-center gap-3 rounded-2xl border border-white bg-white text-black shadow-sm">
            <span className="text-xl sm:text-xl ">התחברות עם Gmail</span>
            <SiGmail className="text-xl text-red-600" />
          </button>
        </div>
    </section>
  );
}