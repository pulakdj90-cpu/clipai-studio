# ClipAI Studio - Vercel API starter

This folder contains a Vercel serverless endpoint at `api/analyze.js` that accepts a public YouTube video URL and asks Gemini to suggest clip timestamps and hooks.


## Important limitations
- This endpoint analyzes a public YouTube URL; it does not process local uploads yet.
- It returns suggested timestamps only. It does not cut or render video files.
- The existing `index.html` UI is not connected to this endpoint yet; frontend integration is a separate next step.
- Gemini API video URL support and exact timestamp accuracy may vary by video/provider/model. Review suggestions before publishing.

## Deploy
1. Copy `api/analyze.js` into the repository under the folder `api/` (create the folder if needed).
2. In Vercel Project Settings -> Environment Variables, set `GEMINI_API_KEY` for Production (and Preview/Development if needed).
3. Redeploy.
4. Endpoint path: `POST /api/analyze` with JSON:
   `{ "videoUrl": "https://www.youtube.com/watch?v=...", "language": "Hindi", "clipCount": 5 }`

Do not expose the Gemini API key in frontend JavaScript or commit it to GitHub.
