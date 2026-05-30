import type { StoredArtist } from "./types";

const BRIDGE_URL = "http://127.0.0.1:5174";

export function bridgeLog(message: string, level = "info") {
  return send("/log", { message, level });
}

export function saveArtistSeed(artists: Record<string, StoredArtist>) {
  return send("/artist-seed", { artists });
}

async function send(path: string, payload: unknown) {
  try {
    await fetch(`${BRIDGE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // The bridge is optional; the app should keep running if it is not started.
  }
}
