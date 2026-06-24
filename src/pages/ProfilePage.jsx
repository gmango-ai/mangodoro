import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ProfileCard from "../components/profile/ProfileCard";
import ProfileGoals from "../components/profile/ProfileGoals";
import ProfileLunch from "../components/profile/ProfileLunch";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";

// Full profile page (/u/:userId). For now it frames the shared ProfileCard;
// room to grow (recent activity, "Message" for DMs, calendar availability).
export default function ProfilePage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { session } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const isMe = session?.user?.id === userId;
  const cardStyle = { background: dark ? "var(--color-surface)" : "#fff", borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)" };
  return (
    <main className="max-w-md mx-auto px-4 pt-6 pb-24">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className={`inline-flex items-center gap-1 text-sm mb-4 ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div className="rounded-2xl border shadow-sm" style={cardStyle}>
        <ProfileCard userId={userId} />
      </div>
      <div className="rounded-2xl border shadow-sm mt-3 p-3.5" style={cardStyle}>
        <ProfileGoals userId={userId} />
      </div>
      {isMe && (
        <div className="rounded-2xl border shadow-sm mt-3 p-3.5" style={cardStyle}>
          <ProfileLunch />
        </div>
      )}
    </main>
  );
}
