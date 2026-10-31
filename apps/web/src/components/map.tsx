"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { PublicUser, EventDto } from "@dixon/types";
export default function Map({
  users,
  events,
  onEvent,
  onUser,
}: {
  users: PublicUser[];
  events: EventDto[];
  onEvent: (e: EventDto) => void;
  onUser: (u: PublicUser) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style:
        process.env.NEXT_PUBLIC_MAP_STYLE_URL ||
        "https://tiles.openfreemap.org/styles/liberty",
      center: [27.56, 53.9],
      zoom: 11,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("error", () => setError(true));
    for (const e of events) {
      const el = document.createElement("button");
      el.className = "live-pin event-pin";
      const icon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("width", "24");
      icon.setAttribute("height", "24");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke", "currentColor");
      icon.setAttribute("stroke-width", "2");
      icon.setAttribute("stroke-linecap", "round");
      icon.setAttribute("stroke-linejoin", "round");
      icon.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", "M3 12h4l3-8 4 16 3-8h4");
      icon.appendChild(path);
      el.appendChild(icon);
      el.setAttribute("aria-label", e.title);
      el.onclick = () => onEvent(e);
      new maplibregl.Marker({ element: el })
        .setLngLat([e.longitude, e.latitude])
        .addTo(map);
    }
    for (const u of users) {
      if (!u.location) continue;
      const el = document.createElement("button");
      el.className = "live-pin";
      el.textContent = u.firstName.slice(0, 1);
      el.setAttribute("aria-label", `${u.firstName}, приблизительная область`);
      el.onclick = () => onUser(u);
      new maplibregl.Marker({ element: el })
        .setLngLat([u.location.longitude, u.location.latitude])
        .addTo(map);
    }
    return () => map.remove();
  }, [users, events, onEvent, onUser]);
  return (
    <>
      <div ref={ref} className="bigmap" style={{ height: 500 }} />
      {error && (
        <p role="status" className="subtle">
          Карта временно недоступна. Активности можно открыть в списке.
        </p>
      )}
      <p className="subtle">
        Люди показаны приблизительно. Точное место доступно только у публичных
        активностей.
      </p>
    </>
  );
}
