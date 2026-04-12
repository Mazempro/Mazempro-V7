module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'API_FOOTBALL_KEY non configurée dans Vercel Environment Variables' });
    return;
  }

  const path = (req.query && req.query.path) ? req.query.path : 'fixtures?live=all';
  
  try {
    const response = await fetch('https://v3.football.api-sports.io/' + path, {
      headers: { 'x-apisports-key': apiKey }
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: 'API-Football error: ' + e.message });
  }
};
