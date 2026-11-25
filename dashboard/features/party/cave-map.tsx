'use client';
import { AddonSlot } from '../../../runtime/hooks/dashboard/slots';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { mapFrameFailure } from './map-render-buffer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type {
  CaveObservation,
  CavePoint,
  DungeonView,
} from '../../../runtime/hunting/api';
import { caveFloorMap } from '../../../runtime/hunting/api.ts';
import { API } from './api';
import type { MapFrame } from './map-frame';
import { MapCanvas } from './map-canvas';
import { dungeonButton } from './dungeon-settings';
import { MapCaptureButton, type MapCaptureState } from './map-capture-button';
import type { MapDefinition } from './map-definition';
import { useVisible } from './query-cache';

// The fork's Cave destinations commit (34092356) picked 80 map units: a click that close to a room
// or stairs pin selects it, and a click on open floor selects nothing.
const PIN_PICK_RADIUS = 80;

export function CaveMap({
  view,
  cave,
  action,
  actionsReady,
  waitingForReports,
  error,
  open,
  onOpenChange,
  destinations,
  onSelectPoint,
}: {
  view: DungeonView;
  cave: NonNullable<CaveObservation['cave']>;
  action: (body: Record<string, unknown>) => Promise<unknown>;
  actionsReady: boolean;
  waitingForReports: boolean;
  error: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // DungeonPanel moves its one destination list in here while the map is open.
  destinations: ReactNode;
  onSelectPoint: (point: CavePoint) => void;
}) {
  const setOpen = onOpenChange,
    [adding, setAdding] = useState(false);
  const capture = useRef<MapCaptureState | null>(null);
  const [waypoint, setWaypoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [frames, setFrames] = useState<Record<string, MapFrame>>({});
  // Each stream delivers the floor definition once; later frames omit it.
  const [definition, setDefinition] = useState<MapDefinition | null>(null);
  const visible = useVisible();
  const [busy, setBusy] = useState(false);
  const [nativeSize, setNativeSize] = useState(false);
  const names = view.state.participants.join(',');
  const map = caveFloorMap(cave.run, cave.floor);
  useEffect(() => {
    if (!open || !visible) return;
    const streams = names.split(',').map((name) => {
      const stream = new EventSource(
        `${API}/map-stream/${encodeURIComponent(name)}`,
      );
      const failed = mapFrameFailure(name);
      stream.onmessage = (event) => {
        try {
          const frame: MapFrame = JSON.parse(event.data);
          if (frame.map !== map) return;
          const supplied = frame.definition;
          if (supplied?.name === map) setDefinition(supplied);
          setFrames((old) => ({ ...old, [name]: frame }));
        } catch (error) {
          failed(error);
        }
      };
      return stream;
    });
    return () => streams.forEach((s) => s.close());
  }, [open, visible, names, map]);
  const currentFrames = Object.fromEntries(Object.entries(frames).filter(([, frame]) => frame.map === map));
  const shown = definition?.name === map ? definition : null;
  const frame = shown ? currentFrames[view.state.participants[0]] || Object.values(currentFrames)[0] : undefined;
  const floorPoints = cave.points.filter((p) => p.map === map && !p.exit);
  // selectNear hands the nearest pin within the radius to the panel's own room pick.
  const selectNear = (point: { x: number; y: number }) => {
    const near = floorPoints
      .map((p) => ({ p, d: Math.hypot(p.x - point.x, p.y - point.y) }))
      .filter(({ d }) => d <= PIN_PICK_RADIUS)
      .sort((a, b) => a.d - b.d)[0];
    if (near) onSelectPoint(near.p);
  };
  const pins = [
    ...floorPoints
      .map((p) => ({
        x: p.x,
        y: p.y,
        label: p.label,
        color: p.done ? '#4ade80' : p.required ? '#fb923c' : '#facc15',
      })),
    ...Object.values(currentFrames).map((f) => ({
      x: f.x,
      y: f.y,
      label: f.name,
      color: '#67e8f9',
    })),
    ...(waypoint ? [{ ...waypoint, label: 'Waypoint', color: '#f472b6' }] : []),
  ];
  return (
    <>
      <button className={dungeonButton + ' mt-2'} onClick={() => setOpen(true)}>
        View full map
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-area="cave-map" aria-label={`Cave of Many Dreams — Floor ${cave.floor + 1}`} className="max-h-[95vh] w-[min(1000px,calc(100vw-2rem))] max-w-none overflow-auto lg:w-[min(calc(1000px+18.75rem),calc(100vw-2rem))] border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-none [&_[data-slot=dialog-close]]:border [&_[data-slot=dialog-close]]:border-emerald-600 [&_[data-slot=dialog-close]]:bg-slate-950 [&_[data-slot=dialog-close]]:text-emerald-50 [&_[data-slot=dialog-close]]:hover:bg-emerald-950">
          <DialogHeader>
            <div className="flex items-center gap-3 pr-8">
              <DialogTitle>
                Cave of Many Dreams — Floor {cave.floor + 1}
              </DialogTitle>
              <MapCaptureButton capture={capture} />
            </div>
            <DialogDescription className="text-slate-300">
              Cyan: party · Orange: required · Green: complete · Yellow: events
              · Pink: waypoint
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="h-[min(600px,calc(100vh-16rem))] overflow-hidden rounded border border-emerald-800 bg-[#07110f]">
            <AddonSlot name="map-layer" part="cave" map={shown?.name ?? ''} pins={pins}>{pins => <MapCanvas
              definition={shown}
              frame={
                frame
                  ? {
                      ...frame,
                      entities: Array.from(
                        new Map(
                          Object.values(currentFrames)
                            .flatMap((f) => f.entities)
                            .map((e) => [e.id, e]),
                        ).values(),
                      ),
                    }
                  : null
              }
              previous={null}
              receivedAt={0}
              scale={1}
              detailed
              capture={capture}
              fullMap={!nativeSize}
              pins={pins}
              active={open}
              fps={15}
              onWaypoint={
                adding
                  ? (point) => {
                      setWaypoint(point);
                      setAdding(false);
                    }
                  : selectNear
              }
            />}</AddonSlot>
          </div>
          <section aria-label="Cave destinations" className="lg:max-h-[min(600px,calc(100vh-16rem))] lg:overflow-auto">
            {destinations}
          </section>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {Object.values(frames).map((f) => (
              <span key={f.name}>{f.name}</span>
            ))}
          </div>
          <div className="h-5 text-sm text-amber-200">
            {waitingForReports && <output className="block">Waiting for fresh participant reports.</output>}
          </div>
          <div className="flex items-center gap-2">
            <button className={dungeonButton} disabled={!frame} onClick={()=>setNativeSize(value=>!value)}>{nativeSize?'Fit full floor':'Native-size view'}</button>
            <button
              className={dungeonButton}
              disabled={!frame || !(actionsReady || waitingForReports)}
              onClick={() => setAdding(true)}
            >
              Add waypoint
            </button>
            <button
              className={dungeonButton}
              disabled={!waypoint || busy || !actionsReady || cave.paused}
              onClick={async () => {
                if (!waypoint || !actionsReady || cave.paused) return;
                setBusy(true);
                try {
                  if (await action({ action: 'waypoint', map, ...waypoint }))
                    setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Set waypoint
            </button>
            <span className="text-sm text-slate-300">
              {adding
                ? 'Click the map to place your waypoint.'
                : waypoint
                  ? `${Math.round(waypoint.x)}, ${Math.round(waypoint.y)}`
                  : 'One waypoint at a time.'}
            </span>
          </div>
          {error && (
            <p role="alert" className="text-red-200">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
