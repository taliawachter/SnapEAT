import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { IoChevronBack } from "react-icons/io5";
import { FaMale, FaFemale } from "react-icons/fa";
import { MdOutlineDateRange, MdHeight, MdMonitorWeight } from "react-icons/md";
import { doc, updateDoc } from "firebase/firestore/lite";
import { auth, db } from "../firebase.js";

export default function PersonalDetailsScreen() {
  const navigate = useNavigate();

  const [selectedGender, setSelectedGender] = useState<"male" | "female" | "">(
    ""
  );
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  const [errors, setErrors] = useState<{
    gender?: string;
    birthDate?: string;
    height?: string;
    weight?: string;
  }>({});

  const days = Array.from({ length: 31 }, (_, i) => String(i + 1));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 100 }, (_, i) => String(currentYear - i));
  }, []);

  const isValidDate = (d: string, m: string, y: string) => {
    if (!d || !m || !y) return false;

    const dayNum = Number(d);
    const monthNum = Number(m);
    const yearNum = Number(y);

    const date = new Date(yearNum, monthNum - 1, dayNum);

    return (
      date.getFullYear() === yearNum &&
      date.getMonth() === monthNum - 1 &&
      date.getDate() === dayNum
    );
  };

  const handleContinue = async () => {
    const newErrors: {
      gender?: string;
      birthDate?: string;
      height?: string;
      weight?: string;
    } = {};

    if (!selectedGender) {
      newErrors.gender = "חובה לבחור מין";
    }

    if (!day || !month || !year) {
      newErrors.birthDate = "חובה לבחור תאריך לידה";
    } else if (!isValidDate(day, month, year)) {
      newErrors.birthDate = "תאריך הלידה לא תקין";
    }

    if (!height.trim()) {
      newErrors.height = "חובה להזין גובה";
    } else {
      const heightNum = Number(height);
      if (Number.isNaN(heightNum) || heightNum < 50 || heightNum > 250) {
        newErrors.height = "הגובה חייב להיות בין 50 ל-250 ס״מ";
      }
    }

    if (!weight.trim()) {
      newErrors.weight = "חובה להזין משקל";
    } else {
      const weightNum = Number(weight);
      if (Number.isNaN(weightNum) || weightNum < 20 || weightNum > 300) {
        newErrors.weight = "המשקל חייב להיות בין 20 ל-300 ק״ג";
      }
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) return;

    const user = auth.currentUser;

    if (!user) {
      alert("משתמש לא מחובר");
      return;
    }

    try {
      await updateDoc(doc(db, "users", user.uid), {
        gender: selectedGender,
        birthDate: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
        height: Number(height),
        weight: Number(weight),
      });

      navigate("/home");
    } catch (error) {
      console.error(error);
      alert("שגיאה בשמירת הנתונים");
    }
  };

  return (
    <section dir="rtl" className="min-h-screen w-full bg-cream px-6 py-10">
      <div className="mx-auto flex min-h-screen w-full max-w-150 flex-col">
        <div className="mb-16 flex items-center justify-between border-b border-placeholder pb-3">
          <button
            onClick={() => navigate("/signup")}
            className="text-orange"
            aria-label="חזרה"
          >
            <IoChevronBack className="text-3xl" />
          </button>

          <h1 className="text-2xl font-bold text-orange">נתונים אישיים</h1>

          <div className="w-7" />
        </div>

        <div className="mb-4 grid grid-cols-2 gap-6">
          <button
            type="button"
            onClick={() => setSelectedGender("female")}
            className={`flex h-12 items-center justify-center rounded-full border bg-white shadow-sm ${
              selectedGender === "female"
                ? "border-2 border-orange"
                : "border-placeholder"
            }`}
          >
            <FaFemale className="text-3xl text-orange" />
          </button>

          <button
            type="button"
            onClick={() => setSelectedGender("male")}
            className={`flex h-12 items-center justify-center rounded-full border bg-white shadow-sm ${
              selectedGender === "male"
                ? "border-2 border-orange"
                : "border-placeholder"
            }`}
          >
            <FaMale className="text-3xl text-orange" />
          </button>
        </div>

        {errors.gender && (
          <p className="mb-8 text-sm text-red-500">{errors.gender}</p>
        )}

        <div className="flex flex-col gap-10">
          <div className="border-b border-placeholder pb-3">
            <div className="mb-3 flex items-center gap-3">
              <MdOutlineDateRange className="text-3xl text-orange" />
              <label className="text-xl text-placeholder">תאריך לידה:</label>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <select
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  setErrors((prev) => ({ ...prev, birthDate: "" }));
                }}
                className="rounded-xl border border-placeholder px-3 py-3 text-center text-base outline-none"
              >
                <option value="">יום</option>
                {days.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              <select
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setErrors((prev) => ({ ...prev, birthDate: "" }));
                }}
                className="rounded-xl border border-placeholder px-3 py-3 text-center text-base outline-none"
              >
                <option value="">חודש</option>
                {months.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              <select
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  setErrors((prev) => ({ ...prev, birthDate: "" }));
                }}
                className="rounded-xl border border-placeholder px-3 py-3 text-center text-base outline-none"
              >
                <option value="">שנה</option>
                {years.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            {errors.birthDate && (
              <p className="mt-2 text-sm text-red-500">{errors.birthDate}</p>
            )}
          </div>

          <div className="border-b border-placeholder pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <MdHeight className="text-3xl text-orange" />
                <label className="text-xl text-placeholder">גובה:</label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={height}
                  onChange={(e) => {
                    setHeight(e.target.value.replace(/\D/g, ""));
                    setErrors((prev) => ({ ...prev, height: "" }));
                  }}
                  placeholder="170"
                  className="w-[90px] bg-transparent text-left text-xl outline-none placeholder:text-placeholder"
                />
                <span className="text-lg text-placeholder">ס״מ</span>
              </div>
            </div>

            {errors.height && (
              <p className="mt-2 text-sm text-red-500">{errors.height}</p>
            )}
          </div>

          <div className="border-b border-placeholder pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <MdMonitorWeight className="text-3xl text-orange" />
                <label className="text-xl text-placeholder">משקל:</label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={weight}
                  onChange={(e) => {
                    setWeight(e.target.value.replace(/\D/g, ""));
                    setErrors((prev) => ({ ...prev, weight: "" }));
                  }}
                  placeholder="65"
                  className="w-[90px] bg-transparent text-left text-xl outline-none placeholder:text-placeholder"
                />
                <span className="text-lg text-placeholder">ק״ג</span>
              </div>
            </div>

            {errors.weight && (
              <p className="mt-2 text-sm text-red-500">{errors.weight}</p>
            )}
          </div>
        </div>

        <div className="mt-20 flex justify-center">
          <button
            onClick={handleContinue}
            className="h-14 w-full max-w-90 rounded-full bg-orange text-xl font-bold text-white shadow-md transition hover:opacity-90"
          >
            המשך
          </button>
        </div>
      </div>
    </section>
  );
}