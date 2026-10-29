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
      el.textContent = "↗";
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
