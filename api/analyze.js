
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST method required" });
  }

  try {
    const { transcript } = req.body || {};

    if (!transcript || transcript.trim().length < 20) {
      return res.status(400).json({
        error: "Please provide a longer transcript."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY missing in Vercel settings"
      });
    }

    const prompt = `
You are an expert YouTube Shorts viral clip finder.

Analyze the transcript and identify the 5 most engaging moments
that could become viral YouTube Shorts.

TRANSCRIPT:
${transcript}

For each clip provide:
- Start timestamp
- End timestamp
- Catchy title
- Reason why it can go viral
- Viral score out of 10

Rules:
- Select interesting, emotional, surprising or valuable moments.
- Keep each clip approximately 20 to 60 seconds.
- Use timestamps from transcript when available.
- Never invent timestamps.
- Return ONLY valid JSON.

Format:
{
  "clips": [
    {
      "start": "00:00",
      "end": "00:30",
      "title": "Example title",
      "reason": "Why this moment is engaging",
      "score": 9
    }
  ]
}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" +
        encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 3000,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Gemini API failed"
      });
    }

    const result =
      data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!result) {
      return res.status(500).json({
        error: "Empty Gemini response"
      });
    }

    const parsed = JSON.parse(result);

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
