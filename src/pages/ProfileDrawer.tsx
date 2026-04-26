import { useEffect, useState } from "react";
import { X, KeyRound, User, LogOut, CircleUserRound } from "lucide-react";
import { signOut, updateProfile } from "firebase/auth";
import { useNavigate } from "react-router";
import { doc, getDoc } from "firebase/firestore/lite";
import { auth, db } from "../firebase.js";

type ProfileDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  userName?: string | undefined;
  userEmail?: string | undefined;
};

export default function ProfileDrawer({
  isOpen,
  onClose,
  userName,
  userEmail,
}: ProfileDrawerProps) {
  const navigate = useNavigate();

  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");

  useEffect(() => {
    const loadProfile = async () => {
      const currentUser = auth.currentUser;

      if (!currentUser) {
        setProfileName(userName || "");
        setProfileEmail(userEmail || "");
        return;
      }

      try {
        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const data = userSnap.data();
          const firestoreName =
            data.username || data.displayName || data.name || data.fullName || "";
          const resolvedName =
            (userName || "").trim() ||
            (firestoreName || "").trim() ||
            (currentUser.displayName || "").trim() ||
            "משתמשת";

          if (!currentUser.displayName && firestoreName) {
            try {
              await updateProfile(currentUser, { displayName: firestoreName });
            } catch {
              // Non-blocking sync attempt
            }
          }

          setProfileName(resolvedName);

          setProfileEmail(
            userEmail ||
              data.email ||
              currentUser.email ||
              ""
          );
        } else {
          setProfileName((userName || currentUser.displayName || "").trim() || "משתמשת");
          setProfileEmail(userEmail || currentUser.email || "");
        }
      } catch (error) {
        console.error("Failed to load profile:", error);
        setProfileName((userName || currentUser.displayName || "").trim() || "משתמשת");
        setProfileEmail(userEmail || currentUser.email || "");
      }
    };

    loadProfile();
  }, [userName, userEmail]);

  const handleLogout = async () => {
    try {
      if (auth.currentUser) {
        await signOut(auth);
      }
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      localStorage.clear();
      onClose();
      navigate("/hello");
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-300 ${
          isOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        dir="rtl"
        className={`fixed top-0 right-0 z-50 h-full w-[78%] max-w-[340px] bg-white shadow-2xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-bbrown bg-cream px-4 py-4">
          <button
            type="button"
            onClick={onClose}
            className="text-orange transition hover:scale-105"
            aria-label="סגירה"
          >
            <X className="h-8 w-8" />
          </button>

          <div className="flex flex-col items-center justify-center text-center">
            <h3 className="text-lg font-bold text-orange">
              {profileName }
            </h3>
            <p className="text-xs text-[#8d7b6b]">{profileEmail}</p>
          </div>

          <div className="text-orange">
            <CircleUserRound className="h-8 w-8" />
          </div>
        </div>

        <div className="px-6 pt-8">
          <div className="flex items-center justify-between border-b border-bbrown py-5 text-dark">
            <KeyRound className="h-6 w-6" />
            <span className="text-s font-semibold">שינוי סיסמא</span>
          </div>

          <div className="flex items-center justify-between border-b border-bbrown py-5 text-dark">
            <User className="h-6 w-6" />
            <span className="text-s font-semibold">נתונים אישיים</span>
          </div>

          <div className="border-b border-bbrown py-5">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center justify-between text-dark"
            >
              <LogOut className="h-6 w-6" />
              <span className="text-s font-semibold">התנתקות</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}