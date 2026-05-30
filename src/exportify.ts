import type { AppState, StoredArtist } from "./types";

const API_URL = "https://api.spotify.com/v1";
const REQUEST_RETRY_BUFFER_MS = 1000;
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_ERROR_RETRIES = 2;
const PLAYLIST_LIMIT = 50;

type ExportifyOwner = {
  id: string;
  display_name?: string;
  uri?: string;
};

type ExportifyArtist = {
  id?: string;
  name?: string;
  uri?: string;
};

type ExportifyTrack = {
  id?: string | null;
  artists?: ExportifyArtist[];
};

type ExportifyPlaylist = {
  id: string;
  name: string;
  public?: boolean;
  collaborative?: boolean;
  owner: ExportifyOwner;
  tracks: {
    href: string;
    limit?: number;
    total: number;
  };
  uri?: string;
};

type ExportifyPlaylistPage = {
  total: number;
  items: ExportifyPlaylist[];
};

type ExportifyTrackItem = {
  track?: ExportifyTrack | null;
};

type ExportifyTrackPage = {
  items: ExportifyTrackItem[];
};

// Adapted from Exportify's PlaylistsData, TracksBaseData, and retry helper.
// We keep only the parts needed to read every playlist and extract artist seeds.
export async function importArtistsFromExportifyPlaylists(
  accessToken: string,
  userId: string,
  onProgress: (message: string) => void,
): Promise<AppState> {
  onProgress("Exportify import: loading playlists...");
  const playlists = await loadAllPlaylists(accessToken, userId);
  const artists = new Map<string, StoredArtist>();
  let playlistTrackCount = 0;
  let skippedPlaylistCount = 0;

  for (const [index, playlist] of playlists.entries()) {
    onProgress(`Exportify import: scanning ${index + 1} of ${playlists.length}: ${playlist.name}`);
    try {
      const items = await loadPlaylistTrackItems(accessToken, playlist);
      playlistTrackCount += items.length;
      items.forEach((item) => {
        item.track?.artists?.forEach((artist) => rememberArtist(artists, artist));
      });
    } catch (err) {
      skippedPlaylistCount += 1;
      const detail = err instanceof Error ? err.message : "unknown error";
      onProgress(`Exportify import: skipped ${playlist.name}: ${detail}`);
    }
  }

  return {
    artists: Object.fromEntries(artists),
    tracks: {},
    ratings: {},
    stats: {
      playlistCount: playlists.length,
      playlistTrackCount,
      discoveredArtistCount: artists.size,
      skippedPlaylistCount,
      sourceNote: "Exportify playlist artist import",
      artistCount: artists.size,
      albumCount: 0,
      trackCount: 0,
      importedAt: new Date().toISOString(),
    },
  };
}

async function loadAllPlaylists(accessToken: string, userId: string) {
  const firstPage = await apiCall<ExportifyPlaylistPage>(
    `${API_URL}/users/${encodeURIComponent(userId)}/playlists?offset=0&limit=${PLAYLIST_LIMIT}`,
    accessToken,
  );
  const playlists = [...firstPage.items];

  for (let offset = PLAYLIST_LIMIT; offset < firstPage.total; offset += PLAYLIST_LIMIT) {
    const page = await apiCall<ExportifyPlaylistPage>(
      `${API_URL}/users/${encodeURIComponent(userId)}/playlists?offset=${offset}&limit=${PLAYLIST_LIMIT}`,
      accessToken,
    );
    playlists.push(...page.items);
  }

  return [await loadLikedTracksPlaylist(accessToken, userId), ...playlists.filter(Boolean)];
}

async function loadLikedTracksPlaylist(accessToken: string, userId: string): Promise<ExportifyPlaylist> {
  const likedTracks = await apiCall<{ limit: number; total: number }>(`${API_URL}/me/tracks`, accessToken);

  return {
    id: "liked",
    name: "Liked",
    public: false,
    collaborative: false,
    owner: {
      id: userId,
      display_name: userId,
      uri: `spotify:user:${userId}`,
    },
    tracks: {
      href: `${API_URL}/me/tracks`,
      limit: likedTracks.limit,
      total: likedTracks.total,
    },
    uri: `spotify:user:${userId}:saved`,
  };
}

async function loadPlaylistTrackItems(accessToken: string, playlist: ExportifyPlaylist) {
  const items: ExportifyTrackItem[] = [];
  const limit = playlist.tracks.limit ? 50 : 100;
  const baseHref = playlist.tracks.href.split("?")[0];

  for (let offset = 0; offset < playlist.tracks.total; offset += limit) {
    const page = await apiCall<ExportifyTrackPage>(`${baseHref}?offset=${offset}&limit=${limit}`, accessToken);
    items.push(...page.items.filter((item) => item.track));
  }

  return items;
}

async function apiCall<T>(url: string, accessToken: string, attempt = 0): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "1");
    await delay(retryAfter * 1000 + REQUEST_RETRY_BUFFER_MS);
    return apiCall<T>(url, accessToken, attempt + 1);
  }

  if (response.status >= 500 && attempt < MAX_ERROR_RETRIES) {
    await delay(response.status === 502 ? REQUEST_RETRY_BUFFER_MS * 3 : REQUEST_RETRY_BUFFER_MS);
    return apiCall<T>(url, accessToken, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(await readableSpotifyError(response));
  }

  return response.json();
}

function rememberArtist(artists: Map<string, StoredArtist>, artist: ExportifyArtist) {
  if (!artist.id) return;
  const existing = artists.get(artist.id);
  artists.set(artist.id, {
    id: artist.id,
    name: artist.name || existing?.name || "Unknown artist",
    uri: artist.uri || existing?.uri || `spotify:artist:${artist.id}`,
    genres: existing?.genres ?? [],
    image: existing?.image,
    playlistTrackCount: (existing?.playlistTrackCount ?? 0) + 1,
  });
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

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
