
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST method required" });
  }

  try {
    const {
      videoTitle = "",
      captions = "",
      language = "Hindi"
    } = req.body || {};

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY missing in Vercel"
      });
    }

    if (!captions.trim()) {
      return res.status(400).json({
        error: "Please paste video transcript/captions"
      });
    }

    const prompt = `
You are an expert YouTube Shorts creator and viral content strategist.

Analyze this video transcript and create a complete Shorts content package.

VIDEO TITLE: ${videoTitle || "Unknown"}

LANGUAGE: ${language}

TRANSCRIPT:
${captions}

Create the following:

1. 5 viral YouTube Shorts titles
2. 5 powerful opening hooks
3. A short viral video description
4. 15 relevant hashtags
5. 3 potential viral moments from the transcript
6. A strong call to action
7. Rewrite the transcript into short, engaging captions
8. Make captions easy to read on mobile
9. Keep the output organized with clear headings
10. Do not invent information that is not in the transcript

Write everything in ${language}.
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
            temperature: 0.8,
            maxOutputTokens: 4000
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Gemini API request failed"
      });
    }

    const result =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!result) {
      return res.status(500).json({
        error: "Gemini returned an empty response"
      });
    }

    return res.status(200).json({
      success: true,
      result
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
