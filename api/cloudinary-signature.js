import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const cloudinaryUrl = process.env.CLOUDINARY_URL;

  if (!cloudinaryUrl) {
    return res.status(500).json({
      error: 'CLOUDINARY_URL is not configured.'
    });
  }

  try {
    const parsed = new URL(cloudinaryUrl.trim());

    if (parsed.protocol !== 'cloudinary:') {
      throw new Error('Invalid Cloudinary URL');
    }

    const apiKey = decodeURIComponent(parsed.username);
    const apiSecret = decodeURIComponent(parsed.password);
    const cloudName = parsed.hostname;

    if (!apiKey || !apiSecret || !cloudName) {
      throw new Error('Missing Cloudinary credentials');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'clipai-uploads';

    const params = {
      folder,
      timestamp
    };

    const signString = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&') + apiSecret;

    const signature = crypto
      .createHash('sha1')
      .update(signString)
      .digest('hex');

    return res.status(200).json({
      success: true,
      cloudName,
      apiKey,
      timestamp,
      folder,
      signature
    });

  } catch (error) {
    console.error('Cloudinary signature error:', error.message);

    return res.status(500).json({
      error: 'Cloudinary configuration is invalid.'
    });
  }
}
