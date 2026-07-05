import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Car, X } from "lucide-react";
import { useVisibilityPausedInterval } from "../hooks/useVisibilityPausedInterval";

// "In the car?" prompt. The web layer can't observe Bluetooth directly, but a
// connected car surfaces its hands-free profile as an audio device whose label
// names the car / head unit — visible via enumerateDevices once mic permission
// has ever been granted (it has, for calls). Detection is therefore
// best-effort: no labels (permission never granted) or no devicechange support
// simply means no prompt. The 20s visibility-paused poll backstops WKWebView,
// where devicechange is unreliable; it also catches the common case of the
// phone pairing BEFORE the app opens (presence check, not just new-device).
// A native AVAudioSession route-change listener is the robust follow-up.

const CAR_LABEL = new RegExp(
  "(\\b(car ?play|car|auto|hands.?free|hfp|uconnect|mylink|comand|mbux|entune|sensus|idrive|sync \\d)\\b" +
  "|bmw|audi|mercedes|toyota|honda|ford|tesla|mazda|kia|hyundai|volkswagen|volvo|subaru" +
  "|chevrolet|nissan|lexus|acura|infiniti|porsche|jeep|cadillac|buick|gmc|skoda|renault|peugeot)",
  "i",
);

// One prompt per car per 8h — accepting or dismissing both start the cooldown,
// so leaving drive mode (or ignoring the card) doesn't re-nag at every glance.
const DISMISS_KEY = "ql_drive_suggest_dismissed";
const COOLDOWN_MS = 8 * 60 * 60 * 1000;

function coolingDown(label) {
  try {
    const { label: l, at } = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
    return l === label && Date.now() - (at || 0) < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function startCooldown(label) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ label, at: Date.now() }));
  } catch { /* private mode */ }
}

export default function DriveModeSuggest() {
  const navigate = useNavigate();
  const location = useLocation();
  const [carLabel, setCarLabel] = useState(null);
  // Touch devices only — a desktop paired to car audio isn't a driver.
  const touchRef = useRef(
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches,
  );

  const check = async () => {
    if (!touchRef.current || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const car = devices.find((d) => d.label && CAR_LABEL.test(d.label));
      setCarLabel(car && !coolingDown(car.label) ? car.label : null);
    } catch { /* enumeration blocked — stay quiet */ }
  };

  useEffect(() => {
    check();
    const md = navigator.mediaDevices;
    md?.addEventListener?.("devicechange", check);
    return () => md?.removeEventListener?.("devicechange", check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useVisibilityPausedInterval(check, 20000, { enabled: touchRef.current });

  if (!carLabel || location.pathname === "/drive") return null;

  const dismiss = () => {
    startCooldown(carLabel);
    setCarLabel(null);
  };
  const accept = () => {
    startCooldown(carLabel);
    setCarLabel(null);
    navigate("/drive");
  };

  return (
    <div
      className="fixed inset-x-3 z-[150]"
      style={{ bottom: "calc(var(--bottom-inset) + 5.5rem)" }}
      role="dialog"
      aria-label="Switch to drive mode"
    >
      <div className="rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl p-4 text-white">
        <div className="flex items-start gap-3 mb-3">
          <Car className="w-8 h-8 text-emerald-400 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold leading-tight">In the car?</p>
            <p className="text-sm text-slate-400 truncate">Connected to {carLabel}</p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Not now"
            className="flex items-center justify-center w-11 h-11 -m-1 rounded-xl text-slate-400 active:bg-slate-800"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <button
          type="button"
          onClick={accept}
          className="w-full h-16 rounded-2xl bg-emerald-600 active:bg-emerald-500 text-2xl font-bold"
        >
          Switch to Drive mode
        </button>
      </div>
    </div>
  );
}
