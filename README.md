# Mangodoro

A clean, fast time tracking app for freelancers and anyone who bills by the hour. Log work sessions, manage breaks, track earnings, and export professional timesheets — all from the browser with no account required.

## Features

- **Time entries** — log start/end times with unpaid break tracking
- **Templates** — save common schedules (start, end, breaks) and apply them in one click
- **Earnings** — set an hourly rate and see income calculated per entry, per day, per week
- **AI tools** — rewrite descriptions for client-facing clarity, or generate an end-of-month narrative summary (powered by DeepSeek)
- **Export to XLSX** — formatted, colour-coded timesheets with week sections, day totals, and a grand total row — ready for Excel or Google Sheets
- **Settings** — set your name, hourly rate, default times, and API key in one modal

## Tech Stack

- [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [ExcelJS](https://github.com/exceljs/exceljs) for XLSX export
- [DeepSeek API](https://platform.deepseek.com/) for AI features
- `localStorage` for persistence (no backend)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## AI Features

Mangodoro uses the DeepSeek API for two features:

- **✦ Rewrite** — polishes a raw entry description into clean, client-ready language
- **✦ Summarise** — generates a narrative summary of a month's work

To enable these, add your DeepSeek API key in Settings. Keys are stored only in your browser's localStorage and never sent anywhere except the DeepSeek API directly.

## Roadmap

See [.TODO](.TODO) for planned features.
