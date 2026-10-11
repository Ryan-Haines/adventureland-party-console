"use client";
import { Image as PictureFrame } from "lucide-react";
import { useState, type RefObject } from "react";

export interface MapCaptureState {
  canvas: HTMLCanvasElement;
  map: string;
  x: number;
  y: number;
}

export function MapCaptureButton({ capture }: { capture: RefObject<MapCaptureState | null> }) {
  const [error, setError] = useState("");
  function takePicture() {
    const view = capture.current;
    if (!view || !view.canvas.isConnected) { setError("Wait for the map to finish drawing."); return; }
    const tab = window.open("about:blank", "_blank");
    if (!tab) { setError("Allow popups to open the map screenshot."); return; }
    tab.opener = null;
    try {
      const image = document.createElement("canvas");
      const ratio = Math.max(1, view.canvas.width / view.canvas.clientWidth);
      const footer = Math.ceil(64 * ratio);
      image.width = view.canvas.width;
      image.height = view.canvas.height + footer;
      const context = image.getContext("2d");
      if (!context) throw Error("Image capture is unavailable.");
      context.drawImage(view.canvas, 0, 0);
      context.fillStyle = "#081713";
      context.fillRect(0, view.canvas.height, image.width, footer);
      context.fillStyle = "#ecfdf5";
      context.font = `${14 * ratio}px monospace`;
      const coordinates = `Center: ${view.x.toFixed(2)}, ${view.y.toFixed(2)}`;
      context.fillText(`Map: ${view.map}`, 12 * ratio, view.canvas.height + 24 * ratio);
      context.fillText(coordinates, 12 * ratio, view.canvas.height + 47 * ratio);
      const png = image.toDataURL("image/png");
      const screenshotDocument = tab.document;
      screenshotDocument.title = `Map screenshot — ${view.map} — ${coordinates}`;
      screenshotDocument.body.style.cssText = "margin:0;background:#081713;color:#ecfdf5;display:flex;justify-content:center";
      const picture = screenshotDocument.createElement("img");
      picture.src = png;
      picture.alt = `Map: ${view.map}. ${coordinates}`;
      picture.style.cssText = "max-width:100%;height:auto;align-self:flex-start";
      screenshotDocument.body.appendChild(picture);
      setError("");
    } catch {
      tab.close();
      setError("Could not capture the map image. Reload the view and try again.");
    }
  }
  return <>
    <button type="button" aria-label="Capture map screenshot" title="Capture map screenshot"
      onClick={takePicture}
      className="rounded border border-emerald-700 bg-[#07110f] p-1.5 text-emerald-100 hover:bg-emerald-900 hover:text-white">
      <PictureFrame className="h-4 w-4" />
    </button>
    {error && <span role="alert" className="text-xs text-red-300">{error}</span>}
  </>;
}
