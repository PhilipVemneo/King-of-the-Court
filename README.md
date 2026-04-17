# King of the Court Scoreboard

A lightweight React frontend for managing a beach volleyball King / Queen of the Court game.

## Features
- Full-screen scoreboard UI
- Setup controls for gender, teams, starting positions, and queue order
- Game mode with `King wins`, `Challenger wins`, `Undo`, `Pause`, and `Reset`
- Local browser persistence via `localStorage`
- Google Sheets sync using browser OAuth and the Sheets API

## Setup
1. Copy `.env.example` to `.env`
2. Fill in your Google OAuth client ID and spreadsheet ID
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the app:
   ```bash
   npm run dev
   ```

## Google Sheets
- Use `VITE_GOOGLE_CLIENT_ID` for a browser OAuth client ID
- Use `VITE_GOOGLE_SPREADSHEET_ID` for the spreadsheet you want to append events to
- The app appends rows to a sheet called `Events`

## Notes
- This is a frontend-only application with no custom backend.
- All state is held in the browser and saved locally automatically.
- Google Sheets integration uses client-side OAuth and the public Google API library.
