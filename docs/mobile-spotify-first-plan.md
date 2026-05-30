# Mobile Spotify-First Plan

This app should use Spotify as the large track store. The app should be a thin mobile controller, not a database.

## Core Idea

Keep these things only while the app is open:

- Artist seeds discovered from playlists and liked songs.
- The active queue playlist id.
- The current track and navigation stack.
- A temporary in-memory rating cache for the current session.

Do not keep full discographies, per-song ratings, or round progress locally. Round 2 can be generated from Exportify playlists and Spotify star playlists once round 1 is completely done.

## Spotify Playlists

Use Spotify playlists as the work surface:

- `Song Rater - Queue 001`, `Song Rater - Queue 002`, etc.
- `Song Rater - 1 Star` through `Song Rater - 10 Stars`.
- Optional rollups later: `Song Rater - 8+ Stars` or genre playlists.

When a track is rated:

- Remove it from every `Song Rater - Queue...` playlist.
- Add it to exactly one star playlist.
- Keep the rating in memory only for the current app session.

Spotify playlist add/remove endpoints operate in batches of 100 items, so all queue syncs should be chunked.

## Mobile Rating UX

The main screen should be a one-song-at-a-time controller:

- Start Rating
- Back
- Pause
- Skip / Next
- Open in Spotify
- Large 1-10 rating buttons

When a rating button is tapped, the app should:

- Remove the song from the active `Song Rater - Queue...` playlist.
- Remove the song from any other `Song Rater - Queue...` playlist, as a cleanup guard.
- Remove the song from all `Song Rater - 1 Star` through `Song Rater - 10 Stars` playlists.
- Add the song to the selected star playlist.
- Advance to the next queue item.

## Rounds

Round 1:

- For every artist, fetch the top 5 popular Spotify songs.
- Add those songs to queue playlists, capped below Spotify's playlist item limit.
- Rate every queued round 1 song before moving to round 2.
- When round 1 is complete, generate round 2 externally from Exportify plus the Spotify star playlists.

Round 2:

- Include only artists where at least one round 1 song was rated 3 stars or higher.
- For each qualifying artist, fetch the current top 5 most popular Spotify songs.
- Exclude any songs already rated in Spotify star playlists.
- Replace excluded songs with the next most popular unrated songs from that artist.
- Rate every queued round 2 song before moving to the next round.

Later Rounds:

- Use the same pattern as round 2.
- The qualifying threshold can stay at 3+ unless changed later.
- Popularity should be fetched fresh each round because Spotify popularity can change and artists can release new songs.

This turns "rate everything by 10,000+ artists" into "keep refreshing a manageable Spotify queue."

## Rating Source of Truth

Spotify star playlists are the source of truth for song ratings:

- Read `Song Rater - 1 Star` through `Song Rater - 10 Stars` into memory when building a queue.
- Use that in-memory rating map to avoid re-adding already rated songs.
- Do not write per-song ratings to `localStorage`, JSON backups, CSVs, or the repo.

The app should not persist per-artist round outcomes either. Round generation should be reproducible from Exportify playlist exports and the Spotify rating playlists.

## Artist Groups

For 10,000+ artists, split the seed list into groups of about 2,000. The first grouping can be simple and deterministic:

- Primary genre if Spotify provides one.
- Fallback to playlist co-occurrence: artists that appear in the same playlists are near each other.
- Fallback to normalized artist name when no better signal exists.

Later, grouping can improve without changing the rating flow.

## Exportify Role

Exportify is useful as a manual bootstrap path:

- Export all playlist CSVs.
- Import only artist ids/names and existing playlist track counts.
- Discard the CSV after seeding if you do not want it stored.

The hosted mobile app can also read playlists directly through Spotify. The local `src/exportify.ts` module adapts the useful Exportify pieces:

- Load all playlists in pages of 50.
- Add Liked Songs as a pseudo-playlist.
- Load playlist tracks in pages of 50 or 100, matching Exportify's behavior.
- Retry Spotify 429 and 5xx responses with short backoff.
- Extract only artist ids, names, URIs, and playlist occurrence counts.

This import path writes the artist seed to `data/artists.json` when the local bridge is running.

## Hosting

GitHub Pages is enough for this as a static mobile app because Spotify PKCE does not require a client secret.

Required setup:

- In Spotify Developer Dashboard, add the GitHub Pages URL as an exact redirect URI.
- In GitHub repository variables, set `VITE_SPOTIFY_CLIENT_ID`.
- Set `VITE_SPOTIFY_REDIRECT_URI` to the exact same GitHub Pages URL.
- Enable GitHub Pages with GitHub Actions as the source.
