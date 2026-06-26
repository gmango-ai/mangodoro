import { useEffect, useState } from "react";
import { Tablet, Plus, Trash2, RefreshCw, Copy, Check, DoorOpen, Clock } from "lucide-react";
import { supabase } from "../supabase";
import { useTheme } from "../context/ThemeContext";
import { listOrgDevices, provisionDevice, reissueDeviceCode, revokeDevice, adminSetDeviceRoom, adminSetDeviceMovable, adminSetDeviceSchedule } from "../lib/orgDevices";
import ConfirmRow from "./ConfirmRow";

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function scheduleLabel(d) {
  const hasTime = d.active_start && d.active_end;
  const hasDays = Array.isArray(d.active_days) && d.active_days.length;
  if (!hasTime && !hasDays) return "Always on";
  const t = hasTime ? `${d.active_start.slice(0, 5)}–${d.active_end.slice(0, 5)}` : "All day";
  return hasDays ? `${t} · ${d.active_days.length}d` : t;
}

// Per-device active hours/days editor. Empty start/end + no days = always on.
function ScheduleEditor({ device, dark, onSave, onCancel }) {
  const [start, setStart] = useState(device.active_start ? device.active_start.slice(0, 5) : "");
  const [end, setEnd] = useState(device.active_end ? device.active_end.slice(0, 5) : "");
  const [days, setDays] = useState(() => (Array.isArray(device.active_days) ? [...device.active_days] : []));
  const toggleDay = (d) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort((a, b) => a - b)));
  const inputCls = `h-8 px-2 rounded-md border text-sm ${dark ? "bg-white/5 border-[var(--color-border)] text-slate-200" : "bg-white border-slate-200"}`;
  return (
    <div className={`mt-2 rounded-lg border p-2.5 space-y-2 ${dark ? "border-[var(--color-border)] bg-black/20" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-[var(--color-muted)]">Active</span>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        <span className="text-[11px] text-[var(--color-muted)]">to</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
        <span className="text-[10px] text-[var(--color-muted)]">device's local time</span>
      </div>
      <div className="flex items-center gap-1">
        {DOW.map((lbl, i) => (
          <button
            key={lbl}
            type="button"
            onClick={() => toggleDay(i)}
            title={days.length === 0 ? "every day (click to restrict)" : ""}
            className={`w-7 h-7 rounded-full text-[11px] font-semibold transition-colors ${
              days.length === 0 || days.includes(i)
                ? "bg-[var(--color-accent)] text-white"
                : dark ? "bg-white/10 text-slate-400" : "bg-slate-100 text-slate-500"
            }`}
          >
            {lbl}
          </button>
        ))}
        {days.length === 0 && <span className="ml-1 text-[10px] text-[var(--color-muted)]">every day</span>}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => onSave("", "", [])} className="text-[11px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-text)]">Always on (24/7)</button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="text-[11px] font-semibold text-[var(--color-muted)] px-2 py-1">Cancel</button>
          <button type="button" onClick={() => onSave(start, end, days)} className="text-[11px] font-semibold text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-md px-2.5 py-1">Save hours</button>
        </div>
      </div>
    </div>
  );
}

function relTime(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function pinnedRoomOptionLabel(pinnedRooms, roomId) {
  const pinned = pinnedRooms.find((r) => r.id === roomId);
  return pinned ? `${pinned.name} (archived)` : "—";
}

// Pairing code shown once after create / re-issue. Big, copyable, with expiry.
function PairingCard({ pairing, dark, onDone }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(pairing.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
  };
  return (
    <div className={`rounded-xl border p-4 text-center ${dark ? "border-[var(--color-accent-border)] bg-[var(--color-accent-light)]" : "border-[var(--color-accent-border)] bg-[var(--color-accent-light)]"}`}>
      <p className="text-xs text-[var(--color-muted)] mb-1">
        Pairing code{pairing.name ? ` for “${pairing.name}”` : ""} — enter it on the device at <span className="font-mono">/device</span>
      </p>
      <button type="button" onClick={copy} title="Copy" className="inline-flex items-center gap-2 text-3xl font-bold tracking-[0.2em] text-[var(--color-accent)]">
        {pairing.code}
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4 opacity-60" />}
      </button>
      <p className="text-[11px] text-[var(--color-muted)] mt-2">
        Expires in ~10 minutes · single use. Generate a new one if it lapses.
      </p>
      <button type="button" onClick={onDone} className="mt-2 text-xs font-semibold text-[var(--color-accent)] hover:underline">Done</button>
    </div>
  );
}

// Org-admin panel: list / add / remove device accounts (shared kiosks pinned to
// a room). Rendered in TeamPage's manage tab. orgId = the org (teams.id).
export default function OrgDevicesPanel({ orgId }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [devices, setDevices] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [pinnedRooms, setPinnedRooms] = useState([]); // archived/missing rooms devices still point at
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pairing, setPairing] = useState(null); // { code, expires_at, name }
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [editHours, setEditHours] = useState(null); // device id whose schedule is open

  const reload = async () => {
    const { data } = await listOrgDevices(orgId);
    setDevices(data);
  };
  useEffect(() => { if (orgId) reload(); /* eslint-disable-next-line */ }, [orgId]);
  useEffect(() => {
    if (!orgId) return;
    setRoomsLoaded(false);
    supabase.from("rooms").select("id, name").eq("team_id", orgId).is("archived_at", null).order("name")
      .then(({ data }) => {
        setRooms(data || []);
        setRoomsLoaded(true);
      });
  }, [orgId]);
  useEffect(() => {
    if (!orgId || !roomsLoaded) {
      setPinnedRooms([]);
      return;
    }
    const activeIds = new Set(rooms.map((r) => r.id));
    const missingIds = [...new Set(devices.map((d) => d.room_id).filter((id) => id && !activeIds.has(id)))];
    if (!missingIds.length) { setPinnedRooms([]); return; }
    let cancelled = false;
    supabase.from("rooms").select("id, name").eq("team_id", orgId).in("id", missingIds)
      .then(({ data }) => {
        if (!cancelled) setPinnedRooms(data || []);
      });
    return () => { cancelled = true; };
  }, [orgId, devices, rooms, roomsLoaded]);

  const add = async () => {
    if (!name.trim() || !roomId || busy) return;
    setBusy(true); setErr("");
    const { data, error } = await provisionDevice(roomId, name.trim());
    setBusy(false);
    if (error) { setErr(error.message || "Could not add device"); return; }
    setPairing({ code: data.pairing_code, expires_at: data.expires_at, name: name.trim() });
    setName(""); setRoomId(""); setAdding(false);
    reload();
  };
  const reissue = async (id, dName) => {
    const { data, error } = await reissueDeviceCode(id);
    if (error) { setErr(error.message || "Could not re-issue code"); return; }
    setPairing({ code: data.pairing_code, expires_at: data.expires_at, name: dName });
  };
  const remove = async (id) => {
    setConfirmRemove(null);
    const { error } = await revokeDevice(id);
    if (error) { setErr(error.message || "Could not remove device"); return; }
    reload();
  };
  const reassign = async (id, newRoomId) => {
    setErr("");
    const { error } = await adminSetDeviceRoom(id, newRoomId);
    if (error) { setErr(error.message || "Could not move device"); return; }
    reload();
  };
  const toggleMovable = async (d) => {
    setErr("");
    const { error } = await adminSetDeviceMovable(d.id, !d.movable);
    if (error) { setErr(error.message || "Could not update device"); return; }
    reload();
  };
  const saveSchedule = async (deviceId, start, end, days) => {
    setErr("");
    const { error } = await adminSetDeviceSchedule(deviceId, start, end, days);
    if (error) { setErr(error.message || "Could not set hours"); return; }
    setEditHours(null);
    reload();
  };

  return (
    <section className={`rounded-xl border p-4 ${dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-bold inline-flex items-center gap-2">
          <Tablet className="w-4 h-4 text-[var(--color-accent)]" /> Devices
        </h3>
        {!adding && (
          <button type="button" onClick={() => { setAdding(true); setErr(""); }} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent)] hover:underline">
            <Plus className="w-3.5 h-3.5" /> Add device
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--color-muted)] mb-3">
        Shared screens (kiosks) that sign in without an email and display one room's timer. Read-only and scoped to their room.
      </p>

      {pairing && <div className="mb-3"><PairingCard pairing={pairing} dark={dark} onDone={() => setPairing(null)} /></div>}

      {adding && (
        <div className={`rounded-lg border p-3 mb-3 space-y-2 ${dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]" : "border-slate-200 bg-slate-50"}`}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Device name (e.g. Front desk iPad)"
            maxLength={80}
            className="w-full h-9 px-3 rounded-md border text-sm bg-[var(--color-input-bg)] border-[var(--color-border)]"
          />
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="w-full h-9 px-2 rounded-md border text-sm bg-[var(--color-input-bg)] border-[var(--color-border)]"
          >
            <option value="">Pin to a room…</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setErr(""); }} className="text-xs font-semibold text-[var(--color-muted)] hover:text-[var(--color-text)] px-2 py-1">Cancel</button>
            <button type="button" onClick={add} disabled={busy || !name.trim() || !roomId} className="text-xs font-semibold text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-md px-3 py-1.5 disabled:opacity-40">
              {busy ? "Adding…" : "Add device"}
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-xs text-red-500 mb-2">{err}</p>}

      {devices.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)] italic">No devices yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {devices.map((d) => (
            <li key={d.id} className={`rounded-lg border px-3 py-2 ${dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]" : "border-slate-200 bg-slate-50"}`}>
              {confirmRemove === d.id ? (
                <ConfirmRow
                  dark={dark}
                  prompt={`Remove “${d.name}”? Its session ends immediately.`}
                  confirmLabel="Remove"
                  confirmTone="danger"
                  onConfirm={() => remove(d.id)}
                  onCancel={() => setConfirmRemove(null)}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{d.name}</p>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      {/* Reassign the device's room (admin). */}
                      <select
                        value={d.room_id}
                        onChange={(e) => reassign(d.id, e.target.value)}
                        title="Room this device shows"
                        className={`text-[11px] rounded-md px-1.5 py-0.5 outline-none cursor-pointer ${dark ? "bg-white/10 text-slate-200" : "bg-slate-100 text-slate-700"}`}
                      >
                        {roomsLoaded && !rooms.some((r) => r.id === d.room_id) && d.room_id && (
                          <option value={d.room_id} className="text-slate-900">
                            {pinnedRoomOptionLabel(pinnedRooms, d.room_id)}
                          </option>
                        )}
                        {rooms.map((r) => <option key={r.id} value={r.id} className="text-slate-900">{r.name}</option>)}
                      </select>
                      {/* Whether this device may switch its OWN room at the kiosk. */}
                      <button
                        type="button"
                        onClick={() => toggleMovable(d)}
                        title={d.movable ? "Movable — this device can switch its own room" : "Fixed — only admins can move it"}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full transition-colors ${
                          d.movable
                            ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                            : dark ? "bg-white/10 text-slate-400 hover:text-slate-200" : "bg-slate-100 text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        <DoorOpen className="w-3 h-3" /> {d.movable ? "Movable" : "Fixed"}
                      </button>
                      {/* Active hours — outside them the kiosk sleeps (call + polling off). */}
                      <button
                        type="button"
                        onClick={() => setEditHours((id) => (id === d.id ? null : d.id))}
                        title="Set the hours this display is on (it sleeps outside them)"
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full transition-colors ${
                          scheduleLabel(d) === "Always on"
                            ? dark ? "bg-white/10 text-slate-400 hover:text-slate-200" : "bg-slate-100 text-slate-500 hover:text-slate-700"
                            : "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                        }`}
                      >
                        <Clock className="w-3 h-3" /> {scheduleLabel(d)}
                      </button>
                      <span className="text-[11px] text-[var(--color-muted)]">seen {relTime(d.last_seen_at)}</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => reissue(d.id, d.name)} title="New pairing code" className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-light)]">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(d.id)} title="Remove device" className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-red-500 hover:bg-red-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {editHours === d.id && confirmRemove !== d.id && (
                <ScheduleEditor
                  device={d}
                  dark={dark}
                  onSave={(start, end, days) => saveSchedule(d.id, start, end, days)}
                  onCancel={() => setEditHours(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
