import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Hospital } from '../../api.ts';
import type { Coordinates } from './careMath.ts';

interface HospitalMapProps {
  hospitals: Hospital[];
  userLocation: Coordinates | undefined;
  selectedId: string | undefined;
  onSelect: (hospital: Hospital) => void;
}

const HTML_ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

const hospitalIcon = L.divIcon({ className: 'nv-marker-wrap', html: '<span class="nv-marker"></span>', iconSize: [26, 38], iconAnchor: [13, 36], popupAnchor: [0, -32] });
const userIcon = L.divIcon({ className: 'nv-marker-wrap', html: '<span class="nv-marker-user"></span>', iconSize: [18, 18], iconAnchor: [9, 9] });

export function HospitalMap({ hospitals, userLocation, selectedId, onSelect }: HospitalMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markersRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markersRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: L.LatLngTuple[] = [];
    if (userLocation) {
      L.marker([userLocation.latitude, userLocation.longitude], { icon: userIcon, zIndexOffset: 1000 })
        .addTo(layer)
        .bindPopup('You are here');
      bounds.push([userLocation.latitude, userLocation.longitude]);
    }
    hospitals.forEach((hospital) => {
      const isSelected = hospital.id === selectedId;
      const marker = L.marker([hospital.latitude, hospital.longitude], { icon: hospitalIcon, zIndexOffset: isSelected ? 500 : 0 });
      marker.bindPopup(`<strong>${escapeHtml(hospital.name)}</strong><br>${escapeHtml(hospital.address)}`);
      marker.on('click', () => onSelectRef.current(hospital));
      marker.addTo(layer);
      if (isSelected) marker.openPopup();
      bounds.push([hospital.latitude, hospital.longitude]);
    });
    if (bounds.length === 1) {
      map.setView(bounds[0], 13);
    } else if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [42, 42] });
    }
  }, [hospitals, userLocation, selectedId]);

  return <div className="nv-map" ref={containerRef} data-testid="hospital-map" aria-label="Street map of hospitals" />;
}
