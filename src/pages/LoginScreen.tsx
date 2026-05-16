import { useState } from "react";
import { useNavigate } from "react-router";
import { IoChevronBack } from "react-icons/io5";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase.js";

export default function LoginScreen() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    general?: string;
  }>({});

  const validateEmail = (value: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  };

  const handleLogin = async () => {
    const newErrors: {
      email?: string;
      password?: string;
      general?: string;
    } = {};

    if (!email.trim()) {
      newErrors.email = "חובה להזין כתובת אימייל";
    } else if (!validateEmail(email)) {
      newErrors.email = "כתובת האימייל לא תקינה";
    }

    if (!password.trim()) {
      newErrors.password = "חובה להזין סיסמה";
    } else if (password.length < 6) {
      newErrors.password = "הסיסמה חייבת להכיל לפחות 6 תווים";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) return;

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);

      setErrors({});
      navigate("/home");
    } catch (error: any) {
      if (
        error.code === "auth/invalid-credential" ||
        error.code === "auth/user-not-found" ||
        error.code === "auth/wrong-password"
      ) {
        setErrors({ general: "האימייל או הסיסמה שגויים" });
      } else if (error.code === "auth/invalid-email") {
        setErrors({ email: "כתובת האימייל לא תקינה" });
      } else {
        setErrors({ general: "קרתה שגיאה בהתחברות, נסי שוב" });
      }
    }
  };

  return (
    <section
      dir="rtl"
      className="min-h-screen w-full bg-cream px-6 py-10 sm:px-10"
    >
      <div className="mx-auto flex min-h-screen w-full max-w-150 flex-col">
        <div className="mb-20 flex items-center justify-between border-b border-placeholder pb-3">
          <button
            onClick={() => navigate("/hello")}
            className="text-orange"
            aria-label="חזרה"
          >
            <IoChevronBack className="text-3xl" />
          </button>

          <h1 className="text-2xl font-bold text-orange">התחברות</h1>

          <div className="w-7" />
        </div>

        <div className="mt-24 flex flex-col gap-8">
          <div>
            <input
              type="email"
              placeholder="כתובת אימייל"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrors((prev) => ({
                  ...prev,
                  email: "",
                  general: "",
                }));
              }}
              className={`w-full border-b bg-transparent pb-3 text-right text-xl text-black outline-none placeholder:text-placeholder ${
                errors.email ? "border-red-500" : "border-placeholder"
              }`}
            />
            {errors.email && (
              <p className="mt-2 text-sm text-red-500">{errors.email}</p>
            )}
          </div>

          <div>
            <input
              type="password"
              placeholder="סיסמה"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((prev) => ({
                  ...prev,
                  password: "",
                  general: "",
                }));
              }}
              className={`w-full border-b bg-transparent pb-3 text-right text-xl text-black outline-none placeholder:text-placeholder ${
                errors.password ? "border-red-500" : "border-placeholder"
              }`}
            />
            {errors.password && (
              <p className="mt-2 text-sm text-red-500">{errors.password}</p>
            )}
          </div>

          {errors.general && (
            <p className="text-center text-sm text-red-500">{errors.general}</p>
          )}
        </div>

        <div className="mt-52 flex flex-col items-center">
          <button
            onClick={handleLogin}
            className="h-14 w-full max-w-90 rounded-full bg-orange text-xl font-bold text-white shadow-md transition hover:opacity-90"
          >
            התחברות
          </button>

        </div>
      </div>
    </section>
  );
}