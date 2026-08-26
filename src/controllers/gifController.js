import axios from 'axios';

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;

export async function searchGifs(req, res) {
  try {
    if (!GIPHY_API_KEY) {
      return res.status(500).json({ success: false, error: 'GIF search is not configured' });
    }
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (!q) {
      return res.status(400).json({ success: false, error: 'Query is required' });
    }
    const { data } = await axios.get('https://api.giphy.com/v1/gifs/search', {
      params: {
        api_key: GIPHY_API_KEY,
        q,
        limit: 24,
        rating: 'pg-13',
      },
      timeout: 8000,
    });
    const results = (data.data || []).map((g) => ({
      id: g.id,
      title: g.title,
      previewUrl: g.images?.fixed_width_small?.url || g.images?.preview_gif?.url,
      url: g.images?.fixed_width?.url || g.images?.original?.url,
    }));
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: 'GIF search failed' });
  }
}