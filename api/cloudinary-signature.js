import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const cloudinaryUrl = process.env.CLOUDINARY_URL;
  if (!cloudinaryUrl) return res.status(500).json({ error: 'CLOUDINARY_URL is not configured.' });
  try {
    const match = cloudinaryUrl.match(/^cloudinary:\/\/([^:]+):([^@]+)@([^/?#]+)$/);
    if (!match) return res.status(500).json({ error: 'CLOUDINARY_URL format is invalid.' });
    const [, apiKey, apiSecret, cloudName] = match;
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'clipai-uploads';
    const params = { folder, timestamp };
    const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    const signature = crypto.createHash('sha256').update(toSign + apiSecret).digest('hex');
    return res.status(200).json({ cloudName, apiKey, timestamp, folder, signature });
  } catch (e) {
    console.error('Cloudinary signature error:', e.message);
    return res.status(500).json({ error: 'Could not create upload signature.' });
  }
}
