module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // ── CLES API ──
  const claudeKey = process.env.CLAUDE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY; // Utilise pour Claude ET GPT-4o

  if (!claudeKey && !openaiKey) { res.status(500).json({ error: 'Aucune cle IA configuree.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  const prompt      = (body && body.prompt)      ? body.prompt      : '';
  const image       = (body && body.image)       ? body.image       : null;
  const pdf         = (body && body.pdf)         ? body.pdf         : null;
  const url         = (body && body.url)         ? body.url         : null;
  const lang        = (body && body.lang)        ? body.lang        : 'fr';
  const history     = (body && body.history)     ? body.history     : [];
  const forceClaude = !!(body && body.forceClaude);
  const forceGPT    = !!(body && body.forceGPT);
  const matchData   = (body && body.match)       ? body.match       : {};

  if (!prompt && !image && !pdf && !url) { res.status(400).json({ error: 'Contenu manquant' }); return; }

  const SYS_FR = `Tu es MAzemPro V7 ULTIMATE — analyste soccer UEFA Pro pour MAzem (Montreal, Mise-o-jeu+). Reponds TOUJOURS en francais. Tu as acces a des donnees web verifiees en temps reel via Tavily Search (93.3% de precision). Utilise OBLIGATOIREMENT ces donnees pour baser ton analyse sur des faits actuels et verifies. Structure ta reponse: 1) Donnees verifiees utilisees 2) Analyse complete (domicile/exterieur, forme 5 matchs, notes /10, 11 probables, absences, H2H) 3) Tableau pronostics (1X2/HT-FT/Over-Under/BTTS/Score Exact/Double Chance/DNB) avec confiance etoiles 4) Verdict final MISE ou EVITER avec justification basee sur donnees reelles.`;

  const SYS_EN = `You are MAzemPro V7 ULTIMATE — UEFA Pro soccer analyst. Always reply in English. You have access to real-time verified web data via Tavily Search (93.3% accuracy). ALWAYS use this data to base your analysis on current verified facts. Structure: 1) Verified data used 2) Full analysis 3) Predictions table 4) Final verdict BET or AVOID.`;

  const SYS_ES = `Eres MAzemPro V7 ULTIMATE — analista futbol UEFA Pro. Responde siempre en espanol. Tienes datos web verificados en tiempo real via Tavily (93.3% precision). USA estos datos para tu analisis.`;

  const SYS_AR = `انت MAzemPro V7 ULTIMATE. اجب دائما بالعربية. لديك بيانات ويب محققة عبر Tavily. استخدم هذه البيانات في تحليلك.`;

  const SYS = lang==='en'?SYS_EN:lang==='es'?SYS_ES:lang==='ar'?SYS_AR:SYS_FR;

  // ══════════════════════════════
  // TAVILY SEARCH (pour les deux)
  // ══════════════════════════════
  async function tavilySearch(queries) {
    if (!tavilyKey) return null;
    try {
      const results = [];
      for (const q of queries.slice(0, 3)) {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: q,
            search_depth: 'advanced',
            include_answer: true,
            max_results: 5,
            include_domains: [
              'transfermarkt.com', 'flashscore.com', 'sofascore.com',
              'fbref.com', 'soccerway.com', 'espn.com', 'goal.com',
              'bbc.com', 'skysports.com', 'marca.com', 'lequipe.fr'
            ]
          }),
          signal: AbortSignal.timeout(8000)
        });
        if (r.ok) {
          const d = await r.json();
          results.push({
            query: q,
            answer: d.answer || '',
            sources: (d.results || []).slice(0, 4).map(s => ({
              title: s.title,
              url: s.url,
              content: (s.content || '').substring(0, 500)
            }))
          });
        }
      }
      return results.length ? results : null;
    } catch(e) { console.log('Tavily error:', e.message); return null; }
  }

  // ══════════════════════════════
  // CONSTRUIRE REQUETES DE RECHERCHE
  // ══════════════════════════════
  function buildQueries(p, md) {
    const m = p.match(/([A-Za-z\u00C0-\u017E][a-z\u00C0-\u017E\-]+(?:\s+[A-Za-z\u00C0-\u017E][a-z\u00C0-\u017E\-]+)*)\s+(?:vs?\.?|contre|–)\s+([A-Za-z\u00C0-\u017E][a-z\u00C0-\u017E\-]+(?:\s+[A-Za-z\u00C0-\u017E][a-z\u00C0-\u017E\-]+)*)/i);
    const home = md.home || (m ? m[1] : null);
    const away = md.away || (m ? m[2] : null);
    if (home && away) return [
      `${home} vs ${away} lineup injuries suspended 2026`,
      `${home} ${away} head to head statistics recent form`,
      `${home} ${away} match prediction team news`
    ];
    return [
      `soccer ${p.substring(0, 80)} analysis 2026`,
      `football match ${p.substring(0, 60)} stats`
    ];
  }

  // ══════════════════════════════
  // FORMATER RESULTATS TAVILY
  // ══════════════════════════════
  function formatResults(results) {
    if (!results || !results.length) return '\n\n[Recherche web non disponible - analyse basee sur connaissances generales]\n';
    let t = '\n\nDONNEES WEB EN TEMPS REEL (Tavily Search - 93.3% precision):\n';
    t += '='.repeat(50) + '\n';
    results.forEach((r, i) => {
      t += `\nRecherche ${i+1}: "${r.query}"\n`;
      if (r.answer) t += `Resume: ${r.answer}\n`;
      (r.sources || []).forEach(s => {
        t += `[${s.title}] ${s.content}\nSource: ${s.url}\n`;
      });
    });
    t += '='.repeat(50) + '\n';
    t += 'IMPORTANT: Base OBLIGATOIREMENT ton analyse sur ces donnees verifiees ci-dessus.\n';
    return t;
  }

  // Fetch URL content
  let urlContent = '';
  if (url) {
    try {
      const r = await fetch(url, { headers: {'User-Agent':'Mozilla/5.0'}, signal: AbortSignal.timeout(7000) });
      const t = await r.text();
      urlContent = t.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0, 3000);
    } catch(e) { urlContent = `[Erreur URL: ${e.message}]`; }
  }

  const basePrompt = [
    prompt || '',
    url ? `\nContenu URL (${url}):\n${urlContent}` : ''
  ].filter(Boolean).join('') || 'Analyse et donne tous les pronostics soccer.';

  // ══════════════════════════════
  // CLAUDE + TAVILY
  // ══════════════════════════════
  async function runClaude(sharedSearchData) {
    if (!claudeKey) throw new Error('Cle Claude non configuree sur Vercel');

    const searchText = formatResults(sharedSearchData);
    const finalPrompt = basePrompt + searchText;

    let userContent = [];
    if (image) {
      const m = image.match(/^data:([^;]+);base64,(.+)$/);
      userContent.push({ type: 'image', source: { type: 'base64', media_type: m?m[1]:'image/jpeg', data: m?m[2]:image } });
    }
    if (pdf) {
      const m = pdf.match(/^data:([^;]+);base64,(.+)$/);
      userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m?m[2]:pdf } });
    }
    userContent.push({ type: 'text', text: finalPrompt });

    const messages = [];
    history.slice(-6).forEach(h => messages.push({ role: h.role, content: h.content }));
    messages.push({ role: 'user', content: userContent.length === 1 ? userContent[0].text : userContent });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25'
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 3000, system: SYS, messages })
    });

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error((e.error && e.error.message) || 'Claude error ' + r.status);
    }
    const d = await r.json();
    return {
      ok: true,
      analysis: d.content[0].text,
      provider: 'claude-sonnet-4-5',
      webSearch: !!sharedSearchData,
      searchSource: 'Tavily'
    };
  }

  // ══════════════════════════════
  // GPT-4o + TAVILY (meme source)
  // ══════════════════════════════
  async function runGPT(sharedSearchData, model = 'gpt-4o') {
    if (!openaiKey) throw new Error('Cle OpenAI non configuree sur Vercel');

    const searchText = formatResults(sharedSearchData);
    const finalPrompt = basePrompt + searchText;

    let userContent = image
      ? [{ type: 'image_url', image_url: { url: image, detail: 'high' } }, { type: 'text', text: finalPrompt }]
      : finalPrompt;

    const messages = [{ role: 'system', content: SYS }];
    history.slice(-6).forEach(h => messages.push({ role: h.role, content: h.content }));
    messages.push({ role: 'user', content: userContent });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openaiKey },
      body: JSON.stringify({ model, max_tokens: 3000, messages })
    });

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      const msg = (e.error && e.error.message) || 'OpenAI error ' + r.status;
      if (r.status === 401) { res.status(401).json({ error: 'Cle OpenAI invalide: ' + msg }); return null; }
      if (r.status === 429) { res.status(429).json({ error: 'Quota depasse: ' + msg }); return null; }
      throw new Error(msg);
    }
    const d = await r.json();
    return {
      ok: true,
      analysis: d.choices[0].message.content,
      provider: 'openai-' + model,
      webSearch: !!sharedSearchData,
      searchSource: 'Tavily'
    };
  }

  // ══════════════════════════════
  // LOGIQUE PRINCIPALE
  // ══════════════════════════════
  try {
    // MODE COMPARATEUR — Tavily UNE SEULE FOIS puis les deux IA en parallele
    if (forceClaude && forceGPT) {
      // 1. Recherche Tavily une seule fois (economise les credits)
      const queries = buildQueries(basePrompt, matchData);
      const sharedSearch = await tavilySearch(queries);

      // 2. Les deux IA analysent les memes donnees en parallele
      const [rC, rG] = await Promise.allSettled([
        runClaude(sharedSearch),
        runGPT(sharedSearch, 'gpt-4o')
      ]);

      res.status(200).json({
        ok: true,
        mode: 'comparator',
        searchUsed: !!sharedSearch,
        searchSource: 'Tavily (donnees communes aux deux IA)',
        claude: rC.status === 'fulfilled' ? rC.value : { ok: false, analysis: 'Claude non disponible: ' + (rC.reason && rC.reason.message) },
        gpt: rG.status === 'fulfilled' ? rG.value : { ok: false, analysis: 'GPT-4o non disponible: ' + (rG.reason && rG.reason.message) }
      });
      return;
    }

    // Force Claude uniquement
    if (forceClaude) {
      const queries = buildQueries(basePrompt, matchData);
      const search = await tavilySearch(queries);
      const r = await runClaude(search);
      res.status(200).json(r);
      return;
    }

    // Force GPT uniquement
    if (forceGPT) {
      const queries = buildQueries(basePrompt, matchData);
      const search = await tavilySearch(queries);
      const r = await runGPT(search, 'gpt-4o');
      if (r) res.status(200).json(r);
      return;
    }

    // Mode normal — recherche Tavily + Claude prioritaire, GPT fallback
    const queries = buildQueries(basePrompt, matchData);
    const search = await tavilySearch(queries);

    if (claudeKey) {
      try {
        const r = await runClaude(search);
        res.status(200).json(r);
        return;
      } catch(e) { console.log('Claude failed, trying GPT:', e.message); }
    }

    if (openaiKey) {
      try { const r = await runGPT(search, 'gpt-4o'); if(r){res.status(200).json(r);return;} } catch(e) {}
      try { const r = await runGPT(search, 'gpt-4o-mini'); if(r){res.status(200).json(r);return;} } catch(e) {}
      res.status(500).json({ error: 'Tous les modeles ont echoue.' });
      return;
    }

    res.status(500).json({ error: 'Aucune cle API configuree' });

  } catch(e) {
    console.error('Handler error:', e);
    res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
};
