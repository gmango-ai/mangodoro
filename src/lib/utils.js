import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { isMobileApp } from "./platform";

export function cn(...inputs) { return twMerge(clsx(inputs)); }

// ── Normalizers ──────────────────────────────────────────────
export function isUUID(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function normalizeTime(t) { return t ? t.slice(0, 5) : ""; }

export function normalizeEntry(row) {
  return { ...row, start: normalizeTime(row.start), end: normalizeTime(row.end_time) };
}

export function normalizeTemplate(row) {
  return { ...row, start: normalizeTime(row.start), end: normalizeTime(row.end_time) };
}

export function normalizeSettings(row) {
  return {
    name: row.name || "",
    defaultStart: normalizeTime(row.default_start),
    defaultEnd: normalizeTime(row.default_end),
    defaultTemplateId: row.default_template_id || undefined,
    reminderTime: normalizeTime(row.reminder_time),
    timeRounding: row.time_rounding || "none",
    dailyTarget: row.daily_target ?? 0,
    weeklyTarget: row.weekly_target ?? 0,
    defaultEntryMode: row.default_entry_mode || "manual",
    avatarUrl: row.avatar_url || "",
    status: row.status || "",
    presenceState: row.presence_state || "active",
    statusUpdatedAt: row.status_updated_at || null,
    lunchTime: normalizeTime(row.lunch_time),
    lunchMode: row.lunch_mode || "off",
    lunchDurationMin: row.lunch_duration_min ?? 60,
    notifQuietStart: normalizeTime(row.notif_quiet_start),
    notifQuietEnd: normalizeTime(row.notif_quiet_end),
    notifDesktopEnabled: row.notif_desktop_enabled ?? true,
    wellbeingReminders: row.wellbeing_reminders || {},
    reminderActiveStart: normalizeTime(row.reminder_active_start),
    reminderActiveEnd: normalizeTime(row.reminder_active_end),
    workStart: normalizeTime(row.work_start),
    workEnd: normalizeTime(row.work_end),
    lunchBreakPaid: row.lunch_break_paid ?? false,
    timezone: row.timezone || "",
    timezoneManual: row.timezone_manual ?? false,
    wageMode: row.wage_mode || "hourly",
    annualSalary: row.annual_salary ?? null,
    offHoursWarn: row.off_hours_warn ?? true,
    oooStart: row.ooo_start || null,
    oooEnd: row.ooo_end || null,
    oooNote: row.ooo_note || "",
    isGuest: !!row.is_guest,
    pomodoroSoundUrl: row.pomodoro_sound_url || "",
    pomodoroSoundName: row.pomodoro_sound_name || "",
    // Multi-sound list: [{ id, name, url, path }]. Empty array if the
    // user only ever set the legacy single sound — AppContext migrates
    // that on next save.
    customSounds: Array.isArray(row.custom_sounds) ? row.custom_sounds : [],
    accentColor: row.accent_color || "teal",
  };
}

// ── Time math ────────────────────────────────────────────────
export function parseTime(str) {
  if (!str) return null;
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

export function calcWorked(start, end, breaks) {
  const s = parseTime(start), e = parseTime(end);
  if (s === null || e === null || e <= s) return 0;
  const unpaidMins = (breaks || [])
    .filter((b) => b.unpaid)
    .reduce((acc, b) => {
      const bs = parseTime(b.start), be = parseTime(b.end);
      return bs !== null && be !== null && be > bs ? acc + (be - bs) : acc;
    }, 0);
  return Math.max(0, e - s - unpaidMins);
}

export function unpaidBreakMins(entry) {
  return (entry.breaks || [])
    .filter((b) => b.unpaid)
    .reduce((acc, b) => {
      const bs = parseTime(b.start), be = parseTime(b.end);
      return bs !== null && be !== null && be > bs ? acc + (be - bs) : acc;
    }, 0);
}

export function roundTimeStr(timeStr, rounding, direction = "nearest") {
  if (!timeStr || !rounding || rounding === "none") return timeStr;
  const mins = parseInt(rounding, 10);
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m;
  let rounded;
  if (direction === "down") rounded = Math.floor(total / mins) * mins;
  else if (direction === "up") rounded = Math.ceil(total / mins) * mins;
  else rounded = Math.round(total / mins) * mins;
  const rh = Math.floor(rounded / 60) % 24;
  const rm = rounded % 60;
  return `${rh.toString().padStart(2, "0")}:${rm.toString().padStart(2, "0")}`;
}

export function currentTimeStr() {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
}

// ── Formatters ───────────────────────────────────────────────
export function formatDuration(mins) {
  if (mins <= 0) return "0h 0m";
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function formatDecimal(mins) {
  return (mins / 60).toFixed(2);
}

export function formatMoney(amount) {
  return "$" + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatMonthLabel(yearMonth) {
  return new Date(yearMonth + "-15T12:00:00").toLocaleDateString("en-US", {
    month: "long", year: "numeric",
  });
}

export function formatDateLabel(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

export function weekRangeLabel(weekSunStr) {
  const sun = new Date(weekSunStr + "T12:00:00");
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(sun)} – ${fmt(sat)}`;
}

export function toDisplayTime(val) {
  if (!val) return "—";
  const [h, m] = val.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

// ── Date helpers ─────────────────────────────────────────────
function localStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayStr() {
  return localStr(new Date());
}

/** YYYY-MM-DD, `deltaDays` from `dateStr` (local calendar). */
export function offsetDateStr(dateStr, deltaDays) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + deltaDays);
  return localStr(d);
}

export function tomorrowStr() {
  return offsetDateStr(todayStr(), 1);
}

export function weekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() - d.getDay());
  return localStr(d);
}

export function makeEmptyForm(s = {}, templates = []) {
  if (s.defaultTemplateId) {
    const tmpl = templates.find((t) => t.id === s.defaultTemplateId);
    if (tmpl) {
      return {
        date: todayStr(),
        start: tmpl.start || "",
        end: tmpl.end || "",
        description: "",
        breaks: (tmpl.breaks || []).map((b) => ({ ...b, id: Date.now() + Math.random() })),
        projectIds: [],
        billable: true,
      };
    }
  }
  return {
    date: todayStr(),
    start: s.defaultStart || "",
    end: s.defaultEnd || "",
    description: "",
    breaks: [],
    projectId: null,
    billable: true,
  };
}

// Trigger a file download. On web this builds an <a download> and clicks
// it. iOS WebView ignores the download attribute (the blob just opens
// in-tab), so on native we write the blob to the app's cache directory
// and surface it via the platform Share sheet — Save to Files / AirDrop /
// email all become one-tap from there.
export async function downloadFile(blob, filename) {
  if (!isMobileApp) {
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: filename,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  try {
    const base64 = await blobToBase64(blob);
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({
      title: filename,
      url: uri,
      dialogTitle: `Save ${filename}`,
    });
  } catch (e) {
    // Share.share rejects when the user dismisses the sheet without
    // picking an action. That's a normal cancellation, not an error.
    // Filesystem failures (read-only volume, etc.) are rare but real —
    // log but don't throw, since most callers fire-and-forget.
    if (!/cancel/i.test(e?.message || "")) {
      console.warn("[downloadFile] native share failed", e);
    }
  }
}

// FileReader gives us a base64 string without blowing the JS stack on
// larger blobs — btoa(String.fromCharCode(...uint8)) chokes around a
// few MB, which timesheet XLSX exports can hit.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
