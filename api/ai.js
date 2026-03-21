module.exports = async function handler(req, res) {
  // CORS headers - allow all origins
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const claudeKey = process.env.CLAUDE_API_KEY;

  if (!openaiKey && !claudeKey) {
    res.status(500).json({ 
      error: 'OPENAI_API_KEY non trouvée dans les variables Vercel. Va dans Settings > Environment Variables.' 
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  }

  const prompt = (body && body.prompt) ? body.prompt : '';
  if (!prompt) {
    res.status(400).json({ error: 'prompt manquant dans la requête' });
    return;
  }

  const SYS = `Tu es MAzemPro V7 ULTIMATE — analyste soccer UEFA Pro pour MAzem (Montréal, Mise-o-jeu+). Réponds en français. Analyse complète: domicile/extérieur confirmé, forme 5 matchs, attaque/défense/milieu/gardien avec notes, 11 probables, absences, H2H, tableau pronostics (1X2/HT-FT/Over-Under/BTTS/Score Exact/Double Chance/DNB) avec confiance ⭐, verdict final MISE ✅ ou ÉVITER ❌.`;

  // Try Claude first
  if (claudeKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 2000,
          system: SYS,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (response.ok) {
        const data = await response.json();
        res.status(200).json({ ok: true, analysis: data.content[0].text, provider: 'claude' });
        return;
      }
    } catch (e) {
      console.log('Claude failed, trying OpenAI:', e.message);
    }
  }

  // Try OpenAI with multiple models
  if (openaiKey) {
    const modelsToTry = ['gpt-4o', 'gpt-4o-mini'];
    
    for (const model of modelsToTry) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + openaiKey
          },
          body: JSON.stringify({
            model: model,
            max_tokens: 2000,
            messages: [
              { role: 'system', content: SYS },
              { role: 'user', content: prompt }
            ]
          })
        });

        if (response.ok) {
          const data = await response.json();
          res.status(200).json({ 
            ok: true, 
            analysis: data.choices[0].message.content, 
            provider: 'openai ' + model 
          });
          return;
        }

        const errData = await response.json().catch(() => ({}));
        const errMsg = (errData.error && errData.error.message) || ('OpenAI error ' + response.status);
        
        // Stop on auth error
        if (response.status === 401) {
          res.status(401).json({ error: 'Clé OpenAI invalide: ' + errMsg });
          return;
        }
        
        // Stop on quota
        if (response.status === 429) {
          res.status(429).json({ error: 'Quota dépassé: ' + errMsg });
          return;
        }

        // Model not available, try next
        console.log('Model ' + model + ' failed: ' + errMsg);
        
      } catch (e) {
        console.log('OpenAI request failed:', e.message);
      }
    }
    
    res.status(500).json({ error: 'Tous les modèles OpenAI ont échoué. Vérifie ta clé API.' });
    return;
  }

  res.status(500).json({ error: 'Aucune clé API configurée' });
};
