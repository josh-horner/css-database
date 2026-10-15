"use client";
/**
 * Small Leaflet map with OpenStreetMap tiles (fine for the demo; production should use a commercial tile
 * provider per OSM's usage policy). Import this with next/dynamic and ssr: false.
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color: string;
  /** Larger pulsing dot, e.g. the crew's live position. */
  live?: boolean;
}

export function PinMap({ pins, className, fitKey }: { pins: MapPin[]; className?: string; fitKey?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef<string | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([40.007, -105.266], 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    for (const p of pins) {
      const size = p.live ? 22 : 16;
      const icon = L.divIcon({
        className: "",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<div class="${p.live ? "css-live-pin" : ""}" style="width:${size}px;height:${size}px;border-radius:9999px;background:${p.color};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
      });
      L.marker([p.lat, p.lng], { icon, title: p.label }).bindTooltip(p.label).addTo(layer.current);
    }
    const key = fitKey ?? pins.map((p) => p.id).join(",");
    if (pins.length && fitted.current !== key) {
      fitted.current = key;
      map.current.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 16 });
    }
  }, [pins, fitKey]);

  return <div ref={el} className={className} />;
}
