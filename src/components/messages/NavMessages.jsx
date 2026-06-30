import { MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMessages } from "../../context/MessagesContext";
import { useTheme } from "../../context/ThemeContext";

// Nav entry to the messages page, with an unread badge from the live DM subscription.
export default function NavMessages() {
  const { unread } = useMessages();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate("/messages")}
      title="Messages"
      aria-label="Messages"
      className={`relative w-9 h-9 rounded-full flex items-center justify-center transition-colors ${dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"}`}
    >
      <MessageSquare className="w-5 h-5" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
