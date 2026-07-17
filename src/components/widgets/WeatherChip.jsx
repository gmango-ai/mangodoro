import { Cloud } from "lucide-react";
import { weatherInfo } from "../../lib/weather";
import WeatherWidget, { useWeather, WEATHER_ICONS } from "../office/WeatherWidget";
import WidgetChip from "./WidgetChip";

// Pinned-strip chip for weather: the current condition icon + temperature in the
// pill, the full weather card (with the city picker + forecast) in the popover.
// Shares the city config with the card via useWeather.
export default function WeatherChip({ dark }) {
  const { cfg, data, hasPlace } = useWeather();
  const cur = data?.current;
  const info = cur ? weatherInfo(cur.weather_code, cur.is_day) : null;
  const Icon = info ? (WEATHER_ICONS[info.kind] || Cloud) : Cloud;

  return (
    <WidgetChip
      icon={Icon}
      name={hasPlace ? undefined : "Weather"}
      value={cur ? `${Math.round(cur.temperature_2m)}°` : (hasPlace ? "…" : null)}
      title={hasPlace ? `${cfg.name}${info ? ` · ${info.label}` : ""}` : "Set your weather city"}
      dark={dark}
    >
      <WeatherWidget dark={dark} />
    </WidgetChip>
  );
}
