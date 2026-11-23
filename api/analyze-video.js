// ClipAI Studio — Stage 2: AI video moment detection
// Requires GEMINI_API_KEY in Vercel Environment Variables.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });

  try {
    const { videoUrl, duration, language = 'Hindi', clipCount = 5 } = req.body || {};
    if (!videoUrl || typeof videoUrl !== 'string') return res.status(400).json({ error: 'videoUrl is required.' });
    // Only allow Cloudinary-hosted video URLs to prevent arbitrary server-side fetches.
    const url = new URL(videoUrl);
    if (url.protocol !== 'https:' || !/(^|\.)cloudinary\.com$/.test(url.hostname)) {
      return res.status(400).json({ error: 'Only HTTPS Cloudinary video URLs are accepted.' });
    }
    const videoResponse = await fetch(url.toString(), { signal: AbortSignal.timeout(90000) });
    if (!videoResponse.ok) throw new Error(`Video download failed (${videoResponse.status}).`);
    const mimeType = videoResponse.headers.get('content-type')?.split(';')[0] || 'video/mp4';
    if (!mimeType.startsWith('video/')) throw new Error('The Cloudinary URL did not return a video file.');
    const bytes = Buffer.from(await videoResponse.arrayBuffer());
    const maxBytes = 100 * 1024 * 1024;
    if (!bytes.length || bytes.length > maxBytes) throw new Error('For this Vercel analysis step, video must be under 100 MB.');

    // Gemini Files API resumable upload
    const startUpload = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { display_name: 'ClipAI-video-analysis' } }),
      signal: AbortSignal.timeout(30000)
    });
    if (!startUpload.ok) throw new Error(`Gemini upload start failed (${startUpload.status}): ${(await startUpload.text()).slice(0,300)}`);
    const uploadUrl = startUpload.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('Gemini did not return an upload URL.');
    const finishUpload = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
        'Content-Length': String(bytes.length),
        'Content-Type': mimeType
      },
      body: bytes,
      signal: AbortSignal.timeout(90000)
    });
    const file = await finishUpload.json();
    if (!finishUpload.ok) throw new Error(`Gemini file upload failed (${finishUpload.status}): ${file?.error?.message || 'unknown error'}`);

    // Poll until Gemini has processed the uploaded video.
    let activeFile = file;
    for (let i = 0; i < 30 && activeFile.state && activeFile.state !== 'ACTIVE'; i++) {
      if (activeFile.state === 'FAILED') throw new Error('Gemini could not process this video file.');
      await new Promise(r => setTimeout(r, 2000));
      const poll = await fetch(`https://generativelanguage.googleapis.com/v1beta/${activeFile.name}?key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(15000) });
      activeFile = await poll.json();
      if (!poll.ok) throw new Error(activeFile?.error?.message || 'Gemini file status check failed.');
    }
    if (activeFile.state && activeFile.state !== 'ACTIVE') throw new Error('Video processing timed out. Please try a shorter video.');

    const prompt = `You are an expert short-form video editor. Analyze the actual video content and identify up to ${Math.max(1, Math.min(10, Number(clipCount) || 5))} compelling moments suitable for vertical short videos. Language: ${language}. Video duration (seconds, if known): ${Number(duration) || 'unknown'}. Choose moments with strong hooks, emotional reactions, surprising information, humor, story turns, or useful advice. Avoid intros, dead air, and repetitive sections. Each clip should be 20–60 seconds when the source allows; shorter clips are okay for very short source videos. Return JSON only in this shape: {"clips":[{"title":"...","startTime":0,"endTime":30,"hook":"...","reason":"...","viralScore":0,"caption":"..."}],"overallSummary":"..."}. Use exact video timeline seconds, no overlaps, chronological order, and never invent moments not present in the video. Scores are 0–100.`;
    const analysis = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ fileData: { fileUri: activeFile.uri, mimeType: activeFile.mimeType || mimeType } }, { text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
      signal: AbortSignal.timeout(90000)
    });
    const result = await analysis.json();
    if (!analysis.ok) throw new Error(result?.error?.message || `Gemini analysis failed (${analysis.status}).`);
    const text = result?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    const parsed = parseJson(text);
    if (!parsed || !Array.isArray(parsed.clips)) throw new Error('AI returned an unexpected analysis format. Please try again.');
    const safeDuration = Number(duration) || 0;
    const clips = parsed.clips.map(c => ({
      title: String(c.title || 'AI Moment'), startTime: Math.max(0, Number(c.startTime) || 0), endTime: Math.max(0, Number(c.endTime) || 0),
      hook: String(c.hook || ''), reason: String(c.reason || ''), viralScore: Math.max(0, Math.min(100, Number(c.viralScore) || 0)), caption: String(c.caption || '')
    })).filter(c => c.endTime > c.startTime && (!safeDuration || c.endTime <= safeDuration + 2)).sort((a,b) => a.startTime-b.startTime).slice(0,10);
    return res.status(200).json({ success: true, model: 'gemini-3.5-flash-lite', summary: String(parsed.overallSummary || ''), clips, fileState: activeFile.state || 'ACTIVE' });
  } catch (err) {
    console.error('ClipAI video analysis:', err?.message);
    return res.status(500).json({ error: err?.message || 'Video analysis failed.' });
  }
}
function parseJson(text) {
  if (!text) return null;
  const clean = String(text).replace(/```json/gi,'').replace(/```/g,'').trim();
  try { return JSON.parse(clean); } catch {}
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(clean.slice(a,b+1)); } catch {} }
  return null;
}
