# Rook Chess

A clean, responsive chess website starter.

## Features

- Responsive chessboard for desktop and mobile
- Legal moves, check/checkmate, castling, en passant and pawn promotion (powered by chess.js)
- Selectable time controls: 1, 3, 5, 10, 15 and 30 minutes, or no clock
- Board flip, move history and undo
- Runs as a static website; no build step required

## Run locally

Open `index.html` in a modern browser with an internet connection. The page loads chess.js from a CDN.

## Publish with GitHub Pages

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select the `main` branch and `/ (root)` folder, then save.

## Current limitations

This is a local two-player prototype. Online multiplayer, user accounts, server-authoritative clocks, persistent ELO ratings and anti-cheat are not implemented yet. Those require a backend and database; browser-only ratings would be easy to manipulate.
