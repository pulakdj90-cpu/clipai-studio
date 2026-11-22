
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST method required"
    });
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
        error: "GEMINI_API_KEY is missing in Vercel"
      });
    }

    if (!captions.trim()) {
      return res.status(400).json({
        error: "Video transcript/captions required"
      });
    }

    const prompt = `
You are an expert YouTube Shorts creator and caption writer.

Analyze the supplied transcript and create:

1. 3 catchy viral Shorts titles
2. 5 powerful opening hooks
3. Short, engaging captions for the video
4. A short viral description
5. 15 relevant hashtags
6. 3 potential viral moments from the transcript
7. A call to action

Video title: ${videoTitle || "Unknown"}

Language: ${language}

Transcript:
${captions}

Write naturally in ${language}.
Make the result engaging, easy to understand,
and suitable for YouTube Shorts, Instagram Reels,
and TikTok.

Do not invent facts that are not in the transcript.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 2500
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data.error?.message ||
          "Gemini AI request failed"
      });
    }

    const result =
      data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("") || "";

    if (!result) {
      return res.status(500).json({
        error: "AI returned an empty response"
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
