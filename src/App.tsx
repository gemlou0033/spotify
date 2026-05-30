import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  ListMusic,
  Loader2,
  LogIn,
  LogOut,
  Pause,
  Play,
  Shuffle,
  SkipForward,
  Star,
} from "lucide-react";
import { saveArtistSeed } from "./bridge";
import { importArtistsFromExportifyPlaylists } from "./exportify";
import {
  SpotifyClient,
  SpotifyToken,
  SpotifyUser,
  completeLoginFromCallback,
  getStoredToken,
  hasClientId,
  hasRequiredScopes,
  isTokenUsable,
  login,
  logout,
  redirectUri,
  refreshToken,
} from "./spotify";
import type { StoredArtist, StoredTrack } from "./types";

const QUEUE_PREFIX = "Song Rater - Queue";
const ratingValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function App() {
  const [token, setToken] = useState<SpotifyToken | null>(() => getStoredToken());
  const [user, setUser] = useState<SpotifyUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [artists, setArtists] = useState<Record<string, StoredArtist>>({});
  const [queueName, setQueueName] = useState("");
  const [queue, setQueue] = useState<StoredTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const canUseSpotify = hasClientId();
  const needsReconnect = Boolean(token && !hasRequiredScopes(token));
  const currentTrack = queue[currentIndex];

  const artistCount = useMemo(() => Object.keys(artists).length, [artists]);

  useEffect(() => {
    completeLoginFromCallback()
      .then((next) => {
        if (next) setToken(next);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    async function hydrateUser() {
      if (!token) return;
      try {
        const next = isTokenUsable(token) ? token : await refreshToken(token);
        setToken(next);
        setUser(await new SpotifyClient(next).me());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not connect to Spotify.");
      }
    }

    void hydrateUser();
  }, [token]);

  async function withClient<T>(action: (client: SpotifyClient) => Promise<T>) {
    if (!token) throw new Error("Connect Spotify first.");
    const usableToken = isTokenUsable(token) ? token : await refreshToken(token);
    setToken(usableToken);
    return action(new SpotifyClient(usableToken));
  }

  function disconnect() {
    logout();
    setToken(null);
    setUser(null);
    setQueue([]);
    setCurrentIndex(0);
  }

  async function importExportifyArtists() {
    if (!token || !user) return;
    setBusy(true);
    setError("");
    try {
      const usableToken = isTokenUsable(token) ? token : await refreshToken(token);
      setToken(usableToken);
      const imported = await importArtistsFromExportifyPlaylists(usableToken.access_token, user.id, setProgress);
      setArtists(imported.artists);
      await saveArtistSeed(imported.artists);
      setProgress(
        `Saved ${imported.stats.artistCount.toLocaleString()} artists to data/artists.json from ${imported.stats.playlistCount.toLocaleString()} playlists.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import playlist artists.");
    } finally {
      setBusy(false);
    }
  }

  async function loadQueue() {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await withClient(async (client) => {
        setProgress("Finding Song Rater queue playlists...");
        const playlists = (await client.ownedPlaylists(user.id))
          .filter((playlist) => playlist.name.startsWith(QUEUE_PREFIX))
          .sort((a, b) => a.name.localeCompare(b.name));

        for (const playlist of playlists) {
          setProgress(`Loading ${playlist.name}...`);
          const tracks = await client.playlistTracks(playlist.id);
          if (!tracks.length) continue;
          setQueueName(playlist.name);
          setQueue(tracks);
          setCurrentIndex(0);
          setProgress(`${playlist.name}: ${tracks.length.toLocaleString()} songs ready.`);
          return;
        }

        throw new Error(`No non-empty "${QUEUE_PREFIX}" playlist was found.`);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load rating queue.");
    } finally {
      setBusy(false);
    }
  }

  async function shuffleAllQueues() {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await withClient(async (client) => {
        setProgress("Finding Song Rater queue playlists...");
        const playlists = (await client.ownedPlaylists(user.id))
          .filter((playlist) => playlist.name.startsWith(QUEUE_PREFIX))
          .sort((a, b) => a.name.localeCompare(b.name));
        const allTracks: StoredTrack[] = [];

        for (const playlist of playlists) {
          setProgress(`Loading ${playlist.name}...`);
          allTracks.push(...(await client.playlistTracks(playlist.id)));
        }

        if (!allTracks.length) throw new Error(`No songs found in "${QUEUE_PREFIX}" playlists.`);
        const shuffled = shuffleTracks(dedupeTracks(allTracks));
        setQueueName("All queues shuffled");
        setQueue(shuffled);
        setCurrentIndex(0);
        setProgress(`Shuffled ${shuffled.length.toLocaleString()} songs from ${playlists.length.toLocaleString()} queue playlists.`);
        await playTrack(shuffled[0]);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not shuffle rating queues.");
    } finally {
      setBusy(false);
    }
  }

  async function startRating() {
    if (!currentTrack) {
      await loadQueue();
      return;
    }
    await playTrack(currentTrack);
  }

  async function playTrack(track: StoredTrack) {
    setError("");
    try {
      await withClient((client) => client.playTrackUri(track.uri));
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message}. Open Spotify on a device first, then try again.`
          : "Playback failed. Open Spotify on a device first.",
      );
    }
  }

  async function pausePlayback() {
    setError("");
    try {
      await withClient((client) => client.pausePlayback());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pause Spotify playback.");
    }
  }

  async function skipTrack() {
    if (!queue.length) return;
    const nextIndex = Math.min(currentIndex + 1, queue.length - 1);
    setCurrentIndex(nextIndex);
    await playTrack(queue[nextIndex]);
  }

  async function previousTrack() {
    if (!queue.length) return;
    const nextIndex = Math.max(currentIndex - 1, 0);
    setCurrentIndex(nextIndex);
    await playTrack(queue[nextIndex]);
  }

  async function rateTrack(rating: number) {
    if (!currentTrack || !user) return;
    setBusy(true);
    setError("");
    try {
      await withClient((client) => client.syncTrackRatingToStarPlaylist(user.id, currentTrack.uri, rating));
      const remaining = queue.filter((track) => track.id !== currentTrack.id);
      const nextIndex = Math.min(currentIndex, Math.max(remaining.length - 1, 0));
      setQueue(remaining);
      setCurrentIndex(nextIndex);
      setProgress(`Rated "${currentTrack.name}" ${rating}/10 and removed it from the queue.`);
      if (remaining[nextIndex]) await playTrack(remaining[nextIndex]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save rating to Spotify.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Spotify Song Rater</p>
          <h1>Rate the queue.</h1>
        </div>
        <div className="auth-panel">
          {user && (
            <div className="auth-copy">
              <strong>{user.display_name ?? user.id}</strong>
              <span>{queueName || "No queue loaded"}</span>
            </div>
          )}
          {token ? (
            <button className="icon-button" onClick={disconnect} title="Log out">
              <LogOut size={18} />
            </button>
          ) : (
            <button className="primary-button" onClick={() => login().catch((err) => setError(err.message))} disabled={!canUseSpotify}>
              <LogIn size={18} />
              Connect
            </button>
          )}
        </div>
      </section>

      {!canUseSpotify && (
        <section className="notice">
          Create `.env.local` from `.env.example`, add your Spotify Client ID, and restart the dev server. Redirect URI:
          <code>{redirectUri()}</code>
        </section>
      )}

      {needsReconnect && <section className="notice">Log out, then connect again to approve the Spotify scopes.</section>}
      {error && <section className="error">{error}</section>}

      <section className="command-band">
        <Metric label="Artists saved" value={artistCount} />
        <Metric label="Queue left" value={queue.length} />
        <Metric label="Current" value={queue.length ? currentIndex + 1 : 0} />
        <div className="command-actions">
          <button className="primary-button" onClick={startRating} disabled={!token || busy || needsReconnect}>
            <Play size={18} />
            Start Rating
          </button>
          <button className="secondary-button" onClick={importExportifyArtists} disabled={!token || !user || busy || needsReconnect}>
            <ListMusic size={18} />
            Exportify Artists
          </button>
          <button className="secondary-button" onClick={loadQueue} disabled={!token || !user || busy || needsReconnect}>
            <ListMusic size={18} />
            Load Queue
          </button>
          <button className="secondary-button" onClick={shuffleAllQueues} disabled={!token || !user || busy || needsReconnect}>
            <Shuffle size={18} />
            Shuffle
          </button>
        </div>
      </section>

      {(busy || progress) && (
        <section className="progress-line">
          {busy && <Loader2 className="spin" size={16} />}
          <span>{progress}</span>
        </section>
      )}

      <section className="rating-stage">
        {currentTrack ? (
          <article className="rating-card">
            <img src={currentTrack.image ?? "/placeholder-album.svg"} alt="" />
            <div className="rating-main">
              <p className="eyebrow">
                {queueName} · {currentIndex + 1} of {queue.length}
              </p>
              <h2>{currentTrack.name}</h2>
              <p>{currentTrack.artistNames.join(", ")}</p>
              <div className="meta-row">
                <span>{currentTrack.album}</span>
                <span>{formatDuration(currentTrack.durationMs)}</span>
              </div>
              <div className="player-actions">
                <button className="icon-button" onClick={previousTrack} disabled={busy || currentIndex === 0} title="Back">
                  <ArrowLeft size={18} />
                </button>
                <button className="icon-button" onClick={() => playTrack(currentTrack)} disabled={busy} title="Play">
                  <Play size={18} />
                </button>
                <button className="icon-button" onClick={pausePlayback} disabled={busy} title="Pause">
                  <Pause size={18} />
                </button>
                <button className="icon-button" onClick={skipTrack} disabled={busy || currentIndex >= queue.length - 1} title="Skip">
                  <SkipForward size={18} />
                </button>
                {currentTrack.spotifyUrl && (
                  <a className="icon-link" href={currentTrack.spotifyUrl} target="_blank" rel="noreferrer" title="Open in Spotify">
                    <ExternalLink size={18} />
                  </a>
                )}
              </div>
              <div className="big-rating-row" aria-label="Rate song">
                {ratingValues.map((rating) => (
                  <button key={rating} onClick={() => rateTrack(rating)} disabled={busy} title={`${rating} out of 10`}>
                    <Star size={17} fill="currentColor" />
                    <span>{rating}</span>
                  </button>
                ))}
              </div>
            </div>
          </article>
        ) : (
          <div className="empty-state">
            <ListMusic size={28} />
            <strong>No queue loaded</strong>
            <span>Load a `Song Rater - Queue...` playlist, then start rating.</span>
          </div>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatDuration(ms: number) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function dedupeTracks(tracks: StoredTrack[]) {
  return [...new Map(tracks.map((track) => [track.uri, track])).values()];
}

function shuffleTracks(tracks: StoredTrack[]) {
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
