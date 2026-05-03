# Stores Backloggd

Chrome extension that adds **store links** (Steam, Epic, GOG, Xbox, PlayStation, Nintendo, itch.io) to game pages on [Backloggd](https://backloggd.com), using the IGDB API.

![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- Adds a compact **Stores** block on Backloggd game pages
- Fetches official/known store URLs from IGDB
- Supports Turbo SPA navigation (re-renders on in-site page transitions)
- Caches OAuth token and game-store responses to reduce API calls

## Screenshots

![Game page with stores](assets/screenshots/01-game-page.png)
![Options page](assets/screenshots/02-options-page.png)

## Installation (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/alyreniko/backloggd-stores-extension.git
   cd stores-backloggd
   ```
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the project folder

## Configuration

This extension requires IGDB/Twitch API credentials.

1. Create an app in Twitch Developer Console to get:
   - **Client ID**
   - **Client Secret**
2. Open extension **Options**
3. Paste credentials and click **Save**

## How it works

- `content.js` injects a Stores widget into Backloggd game pages.
- `background.js`:
  - gets OAuth token from Twitch
  - queries IGDB `/v4/games`
  - normalizes website links to known stores
  - caches results in `chrome.storage.local`

## Tech stack

- Chrome Extension Manifest V3
- Vanilla JavaScript
- IGDB API + Twitch OAuth Client Credentials flow

## Project structure

```text
.
├─ manifest.json
├─ content.js
├─ background.js
├─ options.html
├─ options.js
├─ styles.css
├─ icons/
└─ assets/
   └─ screenshots/
```

## Privacy / Data

- Credentials are stored in `chrome.storage.sync` (your browser profile sync storage).
- Token and game cache are stored in `chrome.storage.local`.
- No external analytics or tracking is included by default.

## Roadmap

- [ ] Add Firefox-compatible build
- [ ] Add per-store enable/disable toggles
- [ ] Optional localization

## Contributing

Issues and PRs are welcome.  
If reporting a bug, include:
- Backloggd URL
- Expected vs actual result
- Console logs (if any)

## License

MIT