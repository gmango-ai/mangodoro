// Discord-style emoji shortcodes: type :smile: to get 🙂.
// A curated map of the common ones (no dependency). expandEmojiShortcodes runs
// on message send + live as you type; searchShortcodes powers the autocomplete.

export const EMOJI_SHORTCODES = {
  // faces / feelings
  smile: "🙂", smiley: "😃", grin: "😀", grinning: "😀", laughing: "😆", sweat_smile: "😅",
  joy: "😂", rofl: "🤣", rolling_on_the_floor_laughing: "🤣", slight_smile: "🙂",
  wink: "😉", blush: "😊", innocent: "😇", heart_eyes: "😍", kissing_heart: "😘",
  yum: "😋", sunglasses: "😎", smirk: "😏", unamused: "😒", disappointed: "😞",
  pensive: "😔", confused: "😕", worried: "😟", cry: "😢", sob: "😭", weary: "😩",
  tired_face: "😫", triumph: "😤", angry: "😠", rage: "😡", sleepy: "😪", sleeping: "😴",
  mask: "😷", thinking: "🤔", face_with_raised_eyebrow: "🤨", neutral_face: "😐",
  expressionless: "😑", no_mouth: "😶", relieved: "😌", flushed: "😳", scream: "😱",
  fearful: "😨", cold_sweat: "😰", cowboy: "🤠", partying_face: "🥳", exploding_head: "🤯",
  hugging: "🤗", shushing: "🤫", zipper_mouth: "🤐", nauseated: "🤢", star_struck: "🤩",
  woozy: "🥴", pleading: "🥺", melting: "🫠", salute: "🫡", upside_down: "🙃",
  // hands / gestures
  thumbsup: "👍", "+1": "👍", thumbsdown: "👎", "-1": "👎", ok_hand: "👌", wave: "👋",
  clap: "👏", raised_hands: "🙌", pray: "🙏", muscle: "💪", point_up: "☝️", point_down: "👇",
  point_left: "👈", point_right: "👉", fingers_crossed: "🤞", v: "✌️", fist: "✊",
  handshake: "🤝", writing_hand: "✍️", call_me: "🤙", metal: "🤘", vulcan: "🖖",
  // hearts / symbols
  heart: "❤️", orange_heart: "🧡", yellow_heart: "💛", green_heart: "💚", blue_heart: "💙",
  purple_heart: "💜", black_heart: "🖤", white_heart: "🤍", broken_heart: "💔",
  sparkling_heart: "💖", two_hearts: "💕", fire: "🔥", sparkles: "✨", star: "⭐",
  star2: "🌟", zap: "⚡", boom: "💥", collision: "💥", dizzy: "💫", 100: "💯",
  tada: "🎉", confetti_ball: "🎊", balloon: "🎈", gift: "🎁", trophy: "🏆", medal: "🏅",
  crown: "👑", rocket: "🚀", bulb: "💡", warning: "⚠️", x: "❌", white_check_mark: "✅",
  heavy_check_mark: "✔️", check: "✅", question: "❓", exclamation: "❗", bangbang: "‼️",
  eyes: "👀", brain: "🧠", skull: "💀", ghost: "👻", robot: "🤖", alien: "👽", poop: "💩",
  // work / objects
  coffee: "☕", tea: "🍵", beer: "🍺", pizza: "🍕", hamburger: "🍔", cake: "🎂",
  computer: "💻", desktop: "🖥️", keyboard: "⌨️", phone: "📱", email: "📧", memo: "📝",
  pencil: "✏️", pushpin: "📌", paperclip: "📎", calendar: "📅", clock: "🕐", hourglass: "⏳",
  chart: "📈", chart_down: "📉", moneybag: "💰", gem: "💎", key: "🔑", lock: "🔒",
  unlock: "🔓", bell: "🔔", mute: "🔕", mag: "🔍", gear: "⚙️", wrench: "🔧", hammer: "🔨",
  bug: "🐛", package: "📦", books: "📚", bookmark: "🔖", link: "🔗", email_incoming: "📨",
  // nature / misc
  sun: "☀️", cloud: "☁️", rain: "🌧️", snowflake: "❄️", rainbow: "🌈", moon: "🌙",
  earth: "🌍", seedling: "🌱", four_leaf_clover: "🍀", rose: "🌹", sunflower: "🌻",
  dog: "🐶", cat: "🐱", unicorn: "🦄", penguin: "🐧", turtle: "🐢", snail: "🐌",
  mango: "🥭", tangerine: "🍊",

  // Natural-language aliases people actually reach for (:happy:, :love:, …).
  happy: "😄", sad: "😢", laugh: "😆", lol: "😂", crying: "😭", love: "❤️",
  angry_face: "😠", mad: "😡", wow: "😮", omg: "😲", ok: "👌", okay: "👌",
  yes: "✅", no: "❌", thanks: "🙏", thank_you: "🙏", please: "🙏", cool: "😎",
  think: "🤔", shrug: "🤷", facepalm: "🤦", eyeroll: "🙄", kiss: "😘", hug: "🤗",
  cross: "❌", tick: "✔️", done: "✅", nice: "👍", yay: "🎉", woohoo: "🎉",
  celebrate: "🎉", party_popper: "🎉", clapping: "👏", goodbye: "👋", hi: "👋",
  hello: "👋", scared: "😱", shock: "😱", nervous: "😅", oops: "😬", grimace: "😬",
  drool: "🤤", sick: "🤢", dead: "💀", cool_sunglasses: "😎", heart_eyes_alt: "😍",
  love_you: "🥰", smiling: "🥰", grateful: "🙏", high_five: "🙌", perfect: "💯",
  bullseye: "🎯", target: "🎯", idea: "💡", coffee_break: "☕", lunch: "🍽️",
};

const RE = /:([a-z0-9_+-]+):/gi;

// Replace every closed :shortcode: with its emoji (unknown codes are left as-is).
export function expandEmojiShortcodes(text) {
  if (!text || text.indexOf(":") === -1) return text;
  return text.replace(RE, (m, name) => EMOJI_SHORTCODES[name.toLowerCase()] || m);
}

// Expand only the portion up to `caret` (what a forward-typer just completed),
// and return the adjusted caret so the cursor doesn't jump. { value, caret }.
export function expandShortcodesAtCaret(value, caret) {
  const before = value.slice(0, caret);
  if (before.indexOf(":") === -1) return { value, caret };
  const expanded = expandEmojiShortcodes(before);
  if (expanded === before) return { value, caret };
  return { value: expanded + value.slice(caret), caret: caret + (expanded.length - before.length) };
}

// Autocomplete: given the prefix after a lone ":", return matching shortcodes.
export function searchShortcodes(prefix, limit = 7) {
  const p = (prefix || "").toLowerCase();
  if (!p) return [];
  const names = Object.keys(EMOJI_SHORTCODES);
  const starts = names.filter((n) => n.startsWith(p));
  const contains = names.filter((n) => !n.startsWith(p) && n.includes(p));
  // De-dupe emoji (many codes alias one glyph) — keep the first/shortest code.
  const seen = new Set();
  const out = [];
  for (const n of [...starts, ...contains]) {
    const e = EMOJI_SHORTCODES[n];
    if (seen.has(e)) continue;
    seen.add(e);
    out.push({ code: n, emoji: e });
    if (out.length >= limit) break;
  }
  return out;
}
