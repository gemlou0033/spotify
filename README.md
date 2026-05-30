# Spotify Song Rater

A mobile-friendly Spotify rating controller.

The app does three things:

- Imports artist seeds from all Spotify playlists plus Liked Songs using a small adapted subset of Exportify's playlist-loading flow.
- Saves that artist seed to `data/artists.json` when the local bridge is running.
- Lets you rate tracks from `Song Rater - Queue...` playlists into `Song Rater - 1 Star` through `Song Rater - 10 Stars`.

Ratings and queue membership live in Spotify playlists. The app does not store per-song ratings locally.

## Spotify Setup

1. Go to the Spotify Developer Dashboard.
2. Open your app.
3. Copy the app's **Client ID**.
4. Add this redirect URI for local development:

```text
http://127.0.0.1:5173/
```

5. Create `.env.local`:

```text
VITE_SPOTIFY_CLIENT_ID=paste_your_client_id_here
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/
```

Do not use a Client Secret in this browser app. PKCE only needs the Client ID.

## Run Locally

```bash
.\install.cmd
.\bridge.cmd
.\dev.cmd
```

Open:

```text
http://127.0.0.1:5173/
```

The bridge writes the artist seed to an ignored local file:

```text
data/artists.json
```

Because this repo is public, do not commit your real `data/artists.json`. The tracked `data/artists.example.json` is only a placeholder.

## Mobile Hosting

This repo includes a GitHub Pages workflow for the static app.

1. Push the repo to GitHub.
2. In **Settings > Pages**, choose **GitHub Actions** as the source.
3. In **Settings > Secrets and variables > Actions > Variables**, add:

```text
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id_here
VITE_SPOTIFY_REDIRECT_URI=https://gemlou0033.github.io/spotify/
```

4. Add the exact same GitHub Pages URL as a Spotify redirect URI.

The hosted mobile app can rate Spotify playlists, but it cannot write back into this repo. To refresh `data/artists.json`, run locally with `.\bridge.cmd`.

## Rating Flow

1. Create or generate one or more playlists named `Song Rater - Queue 001`, `Song Rater - Queue 002`, etc.
2. Open the app and connect Spotify.
3. Click `Load Queue`.
4. Click `Start Rating`.
5. Use Back, Play, Pause, Skip, and the large 1-10 rating buttons.

When you rate a song, the app:

- removes it from every `Song Rater - Queue...` playlist
- removes it from any existing `Song Rater - 1 Star` through `Song Rater - 10 Stars` playlist
- adds it to the selected star playlist
- moves to the next song

## Exportify Artist Import

The `Exportify Artists` button reads all playlists and Liked Songs through Spotify and extracts only artist ids, names, URIs, and occurrence counts.

It adapts the useful Exportify mechanics from the local Exportify repo:

- playlist paging in batches of 50
- Liked Songs as a pseudo-playlist
- track paging in batches of 50/100
- short retries for Spotify rate limits and server errors
