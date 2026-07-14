import { useNavigate, useLocation } from "react-router";
import { CalendarDays, Heart, Plus } from "lucide-react";
import { MdOutlineWhatsapp } from "react-icons/md";
import { BsChatLeftDots } from "react-icons/bs";
import { openWhatsAppChat } from "../utils/whatsapp.js";

type BottomNavbarProps = {
  onPlusClick?: () => void;
  showAddButton?: boolean;
};

export default function BottomNavbar({ onPlusClick, showAddButton = true }: BottomNavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isFavoritesActive = location.pathname === "/favorites";
  const isJournalActive = location.pathname === "/home";

  return (
    <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-150 -translate-x-1/2 border-t border-line bg-cream shadow-[0_-3px_14px_rgba(0,0,0,0.08)]">
      <div className="relative flex h-20 items-center justify-around px-4">
        {showAddButton && (
          <button
            type="button"
            aria-label="הוספה חדשה"
            onClick={onPlusClick ?? (() => navigate("/my-meals"))}
            className="absolute -top-16 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-orange text-white shadow-lg hover:bg-orange/80 active:scale-95"
          >
            <Plus className="h-7 w-7" />
          </button>
        )}

        <button
          onClick={() => openWhatsAppChat()}
          className="flex flex-col items-center gap-1 text-placeholder"
        >
          <MdOutlineWhatsapp className="h-7 w-7" />
          <span className="text-sm">WhatsApp</span>
        </button>

<button
          onClick={() => navigate("/home")}
          className={`flex flex-col items-center gap-1 ${isJournalActive ? "text-orange" : "text-placeholder"}`}>
          <CalendarDays className="h-7 w-7" />
          <span className="text-sm">יומן</span>
        </button>
        
        <button
          onClick={() => navigate("/favorites")}
          className={`flex flex-col items-center gap-1 ${isFavoritesActive ? "text-orange" : "text-placeholder"}`}
        >
          <Heart className="h-7 w-7" />
          <span className="text-sm">מועדפים</span>
        </button>

        
      </div>
    </nav>
  );
}
