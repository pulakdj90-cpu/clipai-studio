
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST method" });
  }

  try {
    const { transcript, language = "Hindi" } = req.body || {};

    if (!transcript || transcript.length < 30) {
      return res.status(400).json({
        error: "Please paste a longer transcript."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Gemini API key missing"
      });
    }

    const prompt = `
You are an expert YouTube Shorts editor.

Analyze this transcript and find the 5 most engaging moments.

Return valid JSON only in this format:

{
  "clips": [
    {
      "title": "Catchy clip title",
      "startTime": 0,
      "endTime": 30,
      "hook": "Strong opening hook",
      "startQuote": "Exact transcript beginning",
      "endQuote": "Exact transcript ending",
      "viralScore": 90,
      "reason": "Why viewers will watch"
    }
  ],
  "titles": [
    "YouTube title 1",
    "YouTube title 2",
    "YouTube title 3"
  ],
  "hashtags": [
    "#shorts",
    "#viral",
    "#youtube",
    "#trending",
    "#video"
  ]
}

Rules:
- Estimate realistic startTime and endTime in seconds for every clip. Never return blank or zero timestamps unless the clip genuinely starts at 0 seconds.
-For every clip, include startTime and endTime in seconds based on transcript timestamps. If timestamps are missing, estimate them and never leave them blank.Find 5 surprising, funny, emotional or useful moments.
- Do not invent transcript quotes.
- Write in ${language}.
- Return JSON only.

TRANSCRIPT:
${transcript}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Gemini API error"
      });
    }

    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!result) {
      return res.status(500).json({
        error: "AI returned empty response"
      });
    }

    return res.status(200).json({
      ...JSON.parse(result),
      mode: "gemini-ai"
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "AI analysis failed"
    });
  }
}
