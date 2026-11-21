export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });

  const { videoUrl, language = 'Hindi', clipCount = 5 } = req.body || {};
  if (typeof videoUrl !== 'string' || !/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(videoUrl)) {
    return res.status(400).json({ error: 'Please provide a public YouTube video URL.' });
  }
  const count = Math.min(10, Math.max(1, Number(clipCount) || 5));
  const prompt = `Analyze this YouTube video and suggest ${count} compelling short-form clip moments for YouTube Shorts, Instagram Reels, or TikTok. Respond in ${language}. Return ONLY valid JSON with this structure: {"clips":[{"start_seconds":0,"end_seconds":30,"title":"...","hook":"...","reason":"..."}]}. Each clip should be self-contained, have a strong hook, avoid overlapping moments where possible, and be 15-60 seconds long. Do not invent timestamps; use moments actually present in the video. If exact timestamps cannot be determined, say so in an "error" field instead of guessing.`;

  try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { file_data: { file_uri: videoUrl, mime_type: 'video/mp4' } }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
      })
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error?.message || 'Gemini request failed' });
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: 'Server error while analyzing video.' });
  }
}
