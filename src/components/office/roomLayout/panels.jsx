import { Video, MessageSquare, PenLine } from "lucide-react";
import RoomChatPanel, { ChatHeaderActions } from "../../RoomChatPanel";
import RoomVideoStage from "../../video/RoomVideoStage";
import RoomWhiteboardPanel from "./RoomWhiteboardPanel";
import { VIEW_PANELS } from "./viewPanels";

// The room panel registry. Each entry is one thing a room can show.
// Adding a new feature to a room (e.g. a task viewer) = add an entry here
// and reference its id from a preset — the layout engine handles the rest.
//
// `render(ctx)` receives { room, userId, displayName, dark, whiteboardId,
// canLink }. It must fill its tile (w-full h-full) and own its surface /
// border styling, exactly like the standalone panes did.

// `min` = smallest comfortable size (px) for this panel type, in BOTH axes.
// The layout's resize clamp reads it so a whiteboard never shrinks to a
// useless sliver while a chat column can stay narrow. Video needs room for
// the grid + control bar; whiteboard needs the most canvas.
export const ROOM_PANELS = {
  video: {
    id: "video",
    title: "Video",
    icon: Video,
    min: 280,
    render: ({ room, displayName }) => <RoomVideoStage roomId={room.id} displayName={displayName} />,
  },
  chat: {
    id: "chat",
    title: "Chat",
    icon: MessageSquare,
    min: 200,
    render: ({ room, userId }) => <RoomChatPanel roomId={room.id} userId={userId} fillHeight chromeless />,
    headerActions: ({ room }) => <ChatHeaderActions roomId={room.id} />,
  },
  whiteboard: {
    id: "whiteboard",
    title: "Whiteboard",
    icon: PenLine,
    min: 360,
    render: ({ whiteboardId, canLink, dark }) => (
      <RoomWhiteboardPanel whiteboardId={whiteboardId} canLink={canLink} dark={dark} />
    ),
  },
  // "Widgets as views" — pomodoro clock, team, focus, world clock, meetings,
  // goals, big clock. They reuse the sidebar widget bodies (see viewPanels).
  ...VIEW_PANELS,
};

export const PANEL_IDS = Object.keys(ROOM_PANELS);

// The panels pinned as one-click quick toggles in the room header. Everything
// else in ROOM_PANELS is reachable from the "Add" menu (keeps the header from
// sprouting a dozen toggle buttons).
export const QUICK_PANEL_IDS = ["video", "chat", "whiteboard"];
