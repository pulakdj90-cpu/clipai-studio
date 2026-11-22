
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST method required" });
  }

  try {
    const { transcript, videoTitle } = req.body || {};

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

Analyze this transcript and find the 5 best moments
for YouTube Shorts.

VIDEO TITLE: ${videoTitle || "Unknown"}

TRANSCRIPT:
${transcript}

Return ONLY valid JSON in this exact format:
{
  "clips": [
    {
      "start": "00:00",
      "end": "00:30",
      "title": "Catchy Shorts title",
      "reason": "Why this moment can go viral"
    }
  ]
}

Rules:
- Find 5 interesting moments.
- Choose emotional, funny, surprising or valuable moments.
- Prefer moments approximately 20-60 seconds long.
- Use real timestamps from the transcript when available.
- Never invent exact timestamps if they are not provided.
- Make titles catchy.
- Return valid JSON only.
`;

    const models = [
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite"
    ];

    async function callGemini(model) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
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
        const error = new Error(
          data.error?.message || `Gemini error ${response.status}`
        );
        error.status = response.status;
        throw error;
      }

      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        throw new Error("Gemini returned an empty response");
      }

      return JSON.parse(text);
    }

    let lastError;

    for (const model of models) {
      // Retry each model once for temporary server problems
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await callGemini(model);
          return res.status(200).json(result);
        } catch (error) {
          lastError = error;

          // Don't retry invalid key or invalid request
          if (
            error.status === 400 ||
            error.status === 401 ||
            error.status === 403
          ) {
            return res.status(error.status).json({
              error: error.message
            });
          }

          // Retry temporary errors
          if (attempt === 1) {
            continue;
          }

          // After retry, switch to fallback model
          break;
        }
      }
    }

    return res.status(503).json({
      error:
        "Both Gemini models are busy or unavailable. Please try again shortly.",
      details: lastError?.message || "Unknown Gemini error"
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
