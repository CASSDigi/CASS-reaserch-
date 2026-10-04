# CASS by abdul: Research

Live-web deep research. It plans sub-questions, searches the web for each one in parallel, and writes a structured report with numbered, linked citations. Includes follow-up Q&A, history, Markdown export and print to PDF.

## Run locally
```bash
cp .env.example .env     # add your ANTHROPIC_API_KEY
npm run dev              # needs Node 20.6+, no dependencies to install
```
Open http://localhost:3000

## Deploy
Any Node host (Render, Railway, Fly.io). Start command: `npm start`. Set `ANTHROPIC_API_KEY`, `MODEL` and `ACCESS_CODE` as environment variables. Without `ACCESS_CODE`, anyone with the URL can spend your API credits.

## Notes
- Never commit `.env`. The API key stays on the server.
- Research depth is set in `server.js` (`DEPTH`); report format is the synthesis prompt in `research()`.
- Private individuals are refused by design; there is no face or person lookup.
