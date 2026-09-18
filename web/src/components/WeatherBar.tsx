import { useEffect, useState } from "react";
import { api, type WeatherPack } from "../api";

/** 深圳今日天气 + 每日名言（server 聚合 open-meteo，3h 缓存） */
export default function WeatherBar() {
  const [wx, setWx] = useState<WeatherPack | null>(null);
  useEffect(() => { api.weather().then(setWx).catch(() => {}); }, []);

  const w = wx?.weather;
  return (
    <div className="wxbar" data-reveal>
      {w?.ok ? (
        <span className="wx-now">
          <span className="wx-emoji" aria-hidden="true">{w.emoji}</span>
          {w.city} {w.temp}°C {w.desc}
          <span className="wx-range mono">{w.tmin}–{w.tmax}°C · 降水 {w.rain}%{Number(w.rain) >= 60 ? " · 带伞" : ""}</span>
        </span>
      ) : <span className="wx-now muted">天气读取中…</span>}
      {wx?.quote && (
        <span className="wx-quote">「{wx.quote.text.trim()}」<span className="wx-author mono">— {wx.quote.author}</span></span>
      )}
    </div>
  );
}
