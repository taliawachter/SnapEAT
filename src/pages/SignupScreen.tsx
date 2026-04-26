import { useState } from "react";
import { useNavigate } from "react-router";
import { IoChevronBack } from "react-icons/io5";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore/lite";
import { auth, db } from "../firebase.js";

export default function SignupScreen() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const [errors, setErrors] = useState<{
    email?: string;
    username?: string;
    password?: string;
    phone?: string;
    general?: string;
  }>({});

  const validateEmail = (value: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  };

  const validatePhone = (value: string) => {
    return /^0\d{8,9}$/.test(value);
  };

  function normalizePhone(phone: string) {
    let cleaned = phone.replace(/\D/g, "");

    if (cleaned.startsWith("0")) {
      cleaned = "972" + cleaned.slice(1);
    }

    return cleaned;
  }

  const handleSignup = async () => {
    if (loading) return;

    const newErrors: {
      email?: string;
      username?: string;
      password?: string;
      phone?: string;
      general?: string;
    } = {};

    if (!email.trim()) {
      newErrors.email = "חובה להזין כתובת אימייל";
    } else if (!validateEmail(email)) {
      newErrors.email = "כתובת האימייל לא תקינה";
    }

    if (!username.trim()) {
      newErrors.username = "חובה להזין שם משתמש";
    } else if (username.trim().length < 2) {
      newErrors.username = "שם המשתמש חייב להכיל לפחות 2 תווים";
    }

    if (!phone.trim()) {
      newErrors.phone = "חובה להזין מספר טלפון";
    } else if (!validatePhone(phone)) {
      newErrors.phone = "מספר הטלפון לא תקין";
    }

    if (!password.trim()) {
      newErrors.password = "חובה להזין סיסמה";
    } else if (password.length < 6) {
      newErrors.password = "הסיסמה חייבת להכיל לפחות 6 תווים";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) return;

    try {
      setLoading(true);

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      const user = userCredential.user;
      const fixedPhone = normalizePhone(phone);
      const trimmedUsername = username.trim();

      await updateProfile(user, {
        displayName: trimmedUsername,
      });

      await setDoc(
        doc(db, "users", user.uid),
        {
          uid: user.uid,
          email: email.trim(),
          username: trimmedUsername,
          displayName: trimmedUsername,
          phone: fixedPhone,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      console.log("✅ user saved with phone:", fixedPhone);

      setErrors({});
      navigate("/details");
    } catch (error: any) {
      if (error.code === "auth/email-already-in-use") {
        setErrors({ email: "האימייל הזה כבר רשום במערכת" });
      } else if (error.code === "auth/invalid-email") {
        setErrors({ email: "כתובת האימייל לא תקינה" });
      } else if (error.code === "auth/weak-password") {
        setErrors({ password: "הסיסמה חלשה מדי" });
      } else {
        setErrors({ general: "קרתה שגיאה בהרשמה, נסי שוב" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section dir="rtl" className="min-h-screen w-full bg-cream px-6 py-10">
      <div className="mx-auto flex min-h-screen w-full max-w-150 flex-col">
        <div className="mb-20 flex items-center justify-between border-b border-placeholder pb-3">
          <button
            onClick={() => navigate("/hello")}
            className="text-orange"
            aria-label="חזרה"
            type="button"
          >
            <IoChevronBack className="text-3xl" />
          </button>

          <h1 className="text-2xl font-bold text-orange">הרשמה</h1>

          <div className="w-7" />
        </div>

        <div className="mt-20 flex flex-col gap-8">
          <div>
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="כתובת אימייל"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border-b border-placeholder pb-3 text-xl"
            />
            {errors.email && (
              <p className="mt-2 text-sm text-red-500">{errors.email}</p>
            )}
          </div>

          <div>
            <input
              type="text"
              name="username"
              autoComplete="nickname"
              placeholder="שם משתמש"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border-b border-placeholder pb-3 text-xl"
            />
            {errors.username && (
              <p className="mt-2 text-sm text-red-500">{errors.username}</p>
            )}
          </div>

          <div>
            <input
              type="text"
              name="phone"
              autoComplete="tel"
              inputMode="numeric"
              placeholder="מספר טלפון"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              className="w-full border-b border-placeholder pb-3 text-xl"
            />
            {errors.phone && (
              <p className="mt-2 text-sm text-red-500">{errors.phone}</p>
            )}
          </div>

          <div>
            <input
              type="password"
              name="new-password"
              autoComplete="new-password"
              placeholder="סיסמה"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border-b border-placeholder pb-3 text-xl"
            />
            {errors.password && (
              <p className="mt-2 text-sm text-red-500">{errors.password}</p>
            )}
          </div>

          {errors.general && (
            <p className="text-sm text-red-500">{errors.general}</p>
          )}
        </div>

        <div className="mt-40 flex justify-center">
          <button
            onClick={handleSignup}
            disabled={loading}
            className="h-14 w-full max-w-90 rounded-full bg-orange text-xl font-bold text-white disabled:opacity-50"
          >
            {loading ? "נרשמת..." : "הרשמה"}
          </button>
        </div>
      </div>
    </section>
  );
}