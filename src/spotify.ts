import type { StoredTrack } from "./types";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_URL = "https://api.spotify.com/v1";
const TOKEN_KEY = "spotify-song-rater-token";
const VERIFIER_KEY = "spotify-song-rater-code-verifier";
const STATE_KEY = "spotify-song-rater-auth-state";
const CALLBACK_LOCK_KEY = "spotify-song-rater-callback-lock";
const REQUEST_TIMEOUT_MS = 30000;
const RATE_LIMIT_KEY_PREFIX = "spotify-song-rater-rate-limit:";

export const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-library-read",
];

export type SpotifyToken = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type: string;
  scope: string;
};

export type SpotifyUser = {
  id: string;
  display_name?: string;
  country?: string;
};

type SpotifyImage = { url: string; width?: number; height?: number };
type SpotifyArtist = {
  id: string;
  name: string;
  uri: string;
};
type SpotifyTrack = {
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  popularity?: number;
  external_urls?: { spotify?: string };
  artists: SpotifyArtist[];
  album: {
    id: string;
    name: string;
    album_type: string;
    release_date?: string;
    images?: SpotifyImage[];
  };
};
type SpotifyPlaylist = {
  id: string;
  name: string;
  owner: { id: string };
};
type PlaylistTrackItem = { item?: SpotifyTrack | null; track?: SpotifyTrack | null };

const clientId = () => import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim();
export const redirectUri = () =>
  window.location.hostname === "gemlou0033.github.io"
    ? "https://gemlou0033.github.io/spotify/"
    : import.meta.env.VITE_SPOTIFY_REDIRECT_URI?.trim() || new URL(import.meta.env.BASE_URL || "/", window.location.href).toString();

export function hasClientId() {
  return Boolean(clientId());
}

export function getStoredToken(): SpotifyToken | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isTokenUsable(token: SpotifyToken | null) {
  return Boolean(token?.access_token && token.expires_at > Date.now() + 60000);
}

export async function login() {
  const id = clientId();
  if (!id) throw new Error("Missing VITE_SPOTIFY_CLIENT_ID in .env.local.");

  const verifier = generateRandomString(96);
  const challenge = await sha256Challenge(verifier);
  const state = generateRandomString(32);
  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: id,
    scope: SCOPES.join(" "),
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });

  window.location.assign(`${AUTH_URL}?${params.toString()}`);
}

export async function completeLoginFromCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return null;

  if (sessionStorage.getItem(CALLBACK_LOCK_KEY) === code) {
    return getStoredToken();
  }
  sessionStorage.setItem(CALLBACK_LOCK_KEY, code);

  const returnedState = params.get("state");
  const expectedState = localStorage.getItem(STATE_KEY);
  if (!expectedState || returnedState !== expectedState) {
    sessionStorage.removeItem(CALLBACK_LOCK_KEY);
    throw new Error("Spotify login state did not match. Try logging in again.");
  }

  const verifier = localStorage.getItem(VERIFIER_KEY);
  const id = clientId();
  if (!verifier || !id) {
    sessionStorage.removeItem(CALLBACK_LOCK_KEY);
    throw new Error("Missing login verifier or client ID.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: id,
    code_verifier: verifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    sessionStorage.removeItem(CALLBACK_LOCK_KEY);
    throw new Error(await readableSpotifyError(response));
  }

  const token = normalizeToken(await response.json());
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(CALLBACK_LOCK_KEY);
  window.history.replaceState({}, document.title, window.location.pathname);
  return token;
}

export async function refreshToken(token: SpotifyToken) {
  const id = clientId();
  if (!token.refresh_token || !id) return token;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
    client_id: id,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(await readableSpotifyError(response));

  const next = normalizeToken(await response.json(), token.refresh_token);
  localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
  return next;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasRequiredScopes(token: SpotifyToken | null) {
  if (!token?.scope) return false;
  const granted = new Set(token.scope.split(/\s+/).filter(Boolean));
  return SCOPES.every((scope) => granted.has(scope));
}

export class SpotifyClient {
  constructor(private token: SpotifyToken) {}
  private rateLimitAttempts = new Map<string, number>();

  async me(): Promise<SpotifyUser> {
    return this.request("/me");
  }

  async playTrackUri(uri: string) {
    await this.request("/me/player/play", {
      method: "PUT",
      body: JSON.stringify({ uris: [uri] }),
    });
  }

  async pausePlayback() {
    await this.request("/me/player/pause", {
      method: "PUT",
    });
  }

  async ownedPlaylists(userId: string) {
    return (await this.paginate<SpotifyPlaylist>("/me/playlists?limit=50")).filter((playlist) => playlist.owner.id === userId);
  }

  async playlistTracks(playlistId: string) {
    const fields =
      "items(track(id,uri,name,artists(id,name,uri),album(id,name,album_type,release_date,images),duration_ms,popularity,external_urls)),next";
    const items = await this.paginate<PlaylistTrackItem>(`/playlists/${playlistId}/items?limit=100&fields=${fields}`);
    return items
      .map((item) => item.item ?? item.track)
      .filter((track): track is SpotifyTrack => Boolean(track?.id))
      .map((track) => toStoredTrack(track));
  }

  async syncTrackRatingToStarPlaylist(userId: string, trackUri: string, rating: number) {
    const playlists = await this.ownedPlaylists(userId);
    const starNames = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => starPlaylistName(value));
    const existingStarPlaylists = playlists.filter((playlist) => starNames.includes(playlist.name));
    const ratingQueuePlaylists = playlists.filter((playlist) => playlist.name.startsWith("Song Rater - Queue"));

    for (const playlist of [...existingStarPlaylists, ...ratingQueuePlaylists]) {
      await this.request(`/playlists/${playlist.id}/items`, {
        method: "DELETE",
        body: JSON.stringify({ items: [{ uri: trackUri }] }),
      });
    }

    if (rating < 1 || rating > 10) return;

    const targetName = starPlaylistName(rating);
    let target = existingStarPlaylists.find((playlist) => playlist.name === targetName);
    if (!target) {
      target = await this.request<SpotifyPlaylist>(`/users/${userId}/playlists`, {
        method: "POST",
        body: JSON.stringify({
          name: targetName,
          description: `Songs you rated ${rating}/10 in Spotify Song Rater.`,
          public: false,
        }),
      });
    }

    await this.request(`/playlists/${target.id}/items`, {
      method: "POST",
      body: JSON.stringify({ uris: [trackUri] }),
    });
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | null = path;
    const seen = new Set<string>();

    while (next) {
      if (seen.has(next)) {
        throw new SpotifyApiError(500, "Spotify returned the same pagination URL twice", next);
      }
      seen.add(next);
      const page: { items: T[]; next: string | null } = await this.request(next);
      items.push(...page.items);
      next = page.next;
    }

    return items;
  }

  private async request<T>(pathOrUrl: string, init: RequestInit = {}, retriedAuth = false): Promise<T> {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${API_URL}${pathOrUrl}`;
    await this.waitForSharedRateLimit(pathOrUrl);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${this.token.access_token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new SpotifyApiError(408, "Spotify request timed out", pathOrUrl);
        }
        throw err;
      })
      .finally(() => window.clearTimeout(timeout));

    if (response.status === 429) {
      const retry = Number(response.headers.get("Retry-After") ?? "0");
      const attempts = this.rateLimitAttempts.get(pathOrUrl) ?? 0;
      const exponential = Math.min(900, 60 * 2 ** attempts);
      const waitSeconds = Math.max(retry + 1, exponential);
      this.rateLimitAttempts.set(pathOrUrl, attempts + 1);
      localStorage.setItem(rateLimitKey(pathOrUrl), String(Date.now() + waitSeconds * 1000));
      await delay(waitSeconds * 1000);
      return this.request(pathOrUrl, init);
    }

    this.rateLimitAttempts.delete(pathOrUrl);

    if (response.status === 401 && !retriedAuth && this.token.refresh_token) {
      this.token = await refreshToken(this.token);
      return this.request(pathOrUrl, init, true);
    }

    if (!response.ok) throw new SpotifyApiError(response.status, await readableSpotifyError(response), pathOrUrl);
    if (response.status === 204) return undefined as T;
    return response.json();
  }

  private async waitForSharedRateLimit(pathOrUrl: string) {
    const until = Number(localStorage.getItem(rateLimitKey(pathOrUrl)) ?? "0");
    const waitMs = until - Date.now();
    if (waitMs > 0) await delay(waitMs);
  }
}

class SpotifyApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public path: string,
  ) {
    super(`${message} (${status}) while calling ${path}`);
    this.name = "SpotifyApiError";
  }
}

function normalizeToken(payload: Record<string, unknown>, fallbackRefresh?: string): SpotifyToken {
  return {
    access_token: String(payload.access_token),
    refresh_token: String(payload.refresh_token ?? fallbackRefresh ?? ""),
    expires_at: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
    token_type: String(payload.token_type ?? "Bearer"),
    scope: String(payload.scope ?? ""),
  };
}

function toStoredTrack(track: SpotifyTrack): StoredTrack {
  return {
    id: track.id ?? track.uri,
    uri: track.uri,
    name: track.name,
    album: track.album.name,
    albumId: track.album.id,
    albumType: track.album.album_type,
    artistIds: track.artists.map((artist) => artist.id),
    artistNames: track.artists.map((artist) => artist.name),
    genres: [],
    durationMs: track.duration_ms,
    popularity: track.popularity ?? 0,
    releaseDate: track.album.release_date,
    image: bestImage(track.album.images),
    spotifyUrl: track.external_urls?.spotify,
  };
}

function generateRandomString(length: number) {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return [...values].map((value) => possible[value % possible.length]).join("");
}

async function sha256Challenge(verifier: string) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function readableSpotifyError(response: Response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message ?? parsed.error_description ?? `${response.status} ${response.statusText}`;
  } catch {
    return text || `${response.status} ${response.statusText}`;
  }
}

function bestImage(images?: SpotifyImage[]) {
  return images?.[1]?.url ?? images?.[0]?.url;
}

function starPlaylistName(rating: number) {
  return `Song Rater - ${rating} Star${rating === 1 ? "" : "s"}`;
}

function rateLimitKey(pathOrUrl: string) {
  const normalized = pathOrUrl.replace(/([?&])offset=\d+/g, "$1offset=*").replace(/([?&])limit=\d+/g, "$1limit=*");
  return `${RATE_LIMIT_KEY_PREFIX}${normalized}`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
