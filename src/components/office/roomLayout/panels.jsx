import { Video, MessageSquare, PenLine } from "lucide-react";
import RoomChatPanel from "../../RoomChatPanel";
import RoomVideoStage from "../../video/RoomVideoStage";
import RoomWhiteboardPanel from "./RoomWhiteboardPanel";

// The room panel registry. Each entry is one thing a room can show.
// Adding a new feature to a room (e.g. a task viewer) = add an entry here
// and reference its id from a preset — the layout engine handles the rest.
//
// `render(ctx)` receives { room, userId, displayName, dark, whiteboardId,
// canLink }. It must fill its tile (w-full h-full) and own its surface /
// border styling, exactly like the standalone panes did.

export const ROOM_PANELS = {
  video: {
    id: "video",
    title: "Video",
    icon: Video,
    render: ({ room, displayName }) => <RoomVideoStage roomId={room.id} displayName={displayName} />,
  },
  chat: {
    id: "chat",
    title: "Chat",
    icon: MessageSquare,
    render: ({ room, userId }) => <RoomChatPanel roomId={room.id} userId={userId} fillHeight />,
  },
  whiteboard: {
    id: "whiteboard",
    title: "Whiteboard",
    icon: PenLine,
    render: ({ whiteboardId, canLink, dark }) => (
      <RoomWhiteboardPanel whiteboardId={whiteboardId} canLink={canLink} dark={dark} />
    ),
  },
};

export const PANEL_IDS = Object.keys(ROOM_PANELS);
