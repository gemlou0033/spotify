export type StoredArtist = {
  id: string;
  name: string;
  uri: string;
  genres: string[];
  image?: string;
  playlistTrackCount?: number;
  expandedAt?: string;
};

export type StoredTrack = {
  id: string;
  uri: string;
  name: string;
  album: string;
  albumId: string;
  albumType: string;
  artistIds: string[];
  artistNames: string[];
  genres: string[];
  durationMs: number;
  popularity: number;
  releaseDate?: string;
  image?: string;
  spotifyUrl?: string;
};

export type ImportStats = {
  playlistCount: number;
  playlistTrackCount: number;
  discoveredArtistCount?: number;
  savedTrackCount?: number;
  topArtistCount?: number;
  skippedPlaylistCount?: number;
  sourceNote?: string;
  completedArtistIds?: string[];
  completedArtistCount?: number;
  deepCompletedArtistIds?: string[];
  deepCompletedArtistCount?: number;
  activeArtistId?: string;
  importInProgress?: boolean;
  artistCount: number;
  albumCount: number;
  trackCount: number;
  importedAt?: string;
};

export type AppState = {
  artists: Record<string, StoredArtist>;
  tracks: Record<string, StoredTrack>;
  ratings: Record<string, never>;
  stats: ImportStats;
};
