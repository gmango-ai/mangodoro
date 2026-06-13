import { useEffect } from "react";
import { useNavigate, useParams, NavLink } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import LogPage from "./LogPage";
import OverviewPage from "./OverviewPage";
import PlannerPage from "./PlannerPage";

const TABS = [
  { key: "log", label: "Log", path: "/time-tracker/log" },
  { key: "overview", label: "Overview", path: "/time-tracker/overview" },
  { key: "planner", label: "Planner", path: "/time-tracker/planner" },
];

export default function TimeTrackerPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const dark = theme === "dark";

  // Default to /log if visiting /time-tracker bare.
  useEffect(() => {
    if (!tab) navigate("/time-tracker/log", { replace: true });
  }, [tab, navigate]);

  const tabCls = ({ isActive }) =>
    `px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${
      isActive
        ? dark
          ? "bg-slate-700 text-white"
          : "bg-white text-slate-800 shadow-sm"
        : dark
          ? "text-slate-400 hover:text-slate-200"
          : "text-slate-500 hover:text-slate-700"
    }`;

  return (
    <div>
      {/* Tab bar */}
      <div className={`sticky top-0 z-30 backdrop-blur-md border-b ${
        dark ? "bg-slate-900/60 border-slate-700/40" : "bg-white/70 border-slate-200/70"
      }`}>
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-2">
          <div className={`inline-flex rounded-lg p-0.5 ${dark ? "bg-slate-800/60" : "bg-slate-100"}`}>
            {TABS.map((t) => (
              <NavLink key={t.key} to={t.path} className={tabCls}>
                {t.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      {/* Content — each tab renders its existing page component as-is so
          we get all the data flows, skeletons, and behaviors for free. */}
      <div>
        {tab === "log" && <LogPage />}
        {tab === "overview" && <OverviewPage />}
        {tab === "planner" && <PlannerPage />}
      </div>
    </div>
  );
}
