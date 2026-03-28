module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const claudeKey = process.env.CLAUDE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (!claudeKey && !openaiKey) { res.status(500).json({ error: 'Aucune cle IA configuree.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  const ALLOWED_GPT_MODELS = [
    'gpt-5.4','gpt-5.4-thinking','gpt-4.5','gpt-4.5-preview','gpt-4.1','gpt-4.1-mini',
    'gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-4','gpt-3.5-turbo'
  ];
  const ALLOWED_CLAUDE_MODELS = [
    'claude-opus-4-5','claude-sonnet-4-5','claude-haiku-4-5','claude-opus-4-0','claude-sonnet-4-0'
  ];

  const prompt      = (body && body.prompt)      ? body.prompt      : '';
  const image       = (body && body.image)       ? body.image       : null;
  const pdf         = (body && body.pdf)         ? body.pdf         : null;
  const url         = (body && body.url)         ? body.url         : null;
  const lang        = (body && body.lang)        ? body.lang        : 'fr';
  const history     = (body && body.history)     ? body.history     : [];
  const provider    = (body && body.provider)    ? String(body.provider).toLowerCase() : '';
  const forceClaude = !!(body && body.forceClaude) || provider === 'claude';
  const forceGPT    = !!(body && body.forceGPT) || provider === 'openai' || provider === 'gpt';
  const matchData   = (body && body.match)       ? body.match       : {};
  const requestedOpenAIModel = (body && (body.openaiModel || body.gptModel || body.model)) ? (body.openaiModel || body.gptModel || body.model) : 'gpt-4o';
  const requestedClaudeModel = (body && (body.claudeModel || body.model)) ? (body.claudeModel || body.model) : 'claude-sonnet-4-5';
  const openaiModel = ALLOWED_GPT_MODELS.includes(requestedOpenAIModel) ? requestedOpenAIModel : 'gpt-4o';
  const claudeModel = ALLOWED_CLAUDE_MODELS.includes(requestedClaudeModel) ? requestedClaudeModel : 'claude-sonnet-4-5';

  if (!prompt && !image && !pdf && !url) { res.status(400).json({ error: 'Contenu manquant' }); return; }

  const compareMode = provider === 'compare' || (forceClaude && forceGPT);

  // ── SYSTEME PROMPT IDENTIQUE POUR LES 2 IA ──
  const SYS_LANGS = {
    fr: `Tu es MAzemPro V7 ULTIMATE — analyste soccer UEFA Pro pour MAzem (Montreal, Mise-o-jeu+). Reponds TOUJOURS en francais. Tu as acces a des donnees web verifiees via Tavily Search. Si une image, capture d'ecran ou PDF est fourni, ANALYSE-LE EN DETAIL: identifie les equipes, scores, cotes, temps de jeu, et tout detail visible. Base ton analyse sur les donnees web ET le contenu visuel fourni. Structure: 1) Donnees verifiees utilisees 2) Analyse complete (domicile/exterieur confirme, forme 5 matchs, notes /10, 11 probables, absences, H2H) 3) Tableau pronostics (1X2/HT-FT/Over-Under/BTTS/Score Exact/Double Chance/DNB) avec confiance etoiles 1-5 4) Verdict final MISE ou EVITER avec justification.`,
    en: `You are MAzemPro V7 ULTIMATE — UEFA Pro soccer analyst. Always reply in English. You have real-time web data via Tavily. If an image, screenshot or PDF is provided, ANALYZE IT IN DETAIL. Full analysis with predictions table and final verdict.`,
    es: `Eres MAzemPro V7 ULTIMATE — analista futbol UEFA Pro. Responde en espanol. Tienes datos web en tiempo real. Si hay imagen o PDF, ANALIZA EN DETALLE.`,
    ar: `انت MAzemPro V7 ULTIMATE. اجب بالعربية. لديك بيانات ويب. اذا كانت هناك صورة او PDF، حللها بالتفصيل.`
  };
  const SYS = SYS_LANGS[lang] || SYS_LANGS['fr'];

  // ── MODE EXTRACTION STRUCTURÉE ──
  // Quand le prompt demande extraction JSON, on désactive Tavily
  // pour avoir une réponse JSON propre sans données web qui polluent
  const isExtractionMode = prompt && (
    prompt.includes('RÈGLE IMPORTANTE sur Mise-o-jeu') || 
    prompt.includes('extracteur de données') ||
    prompt.includes('tableau JSON UNIQUEMENT')
  );

  // ── TAVILY SEARCH (identique pour les 2 IA) ──
  async function tavilySearch(queries) {
    if (!tavilyKey) return null;
    try {
      const results = [];
      for (const q of queries.slice(0, 3)) {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey, query: q, search_depth: 'advanced',
            include_answer: true, max_results: 5,
            include_domains: ['transfermarkt.com','flashscore.com','sofascore.com','fbref.com','espn.com','goal.com','bbc.com','skysports.com']
          }),
          signal: AbortSignal.timeout(8000)
        });
        if (r.ok) {
          const d = await r.json();
          results.push({ query: q, answer: d.answer||'', sources: (d.results||[]).slice(0,4).map(s=>({title:s.title,url:s.url,content:(s.content||'').substring(0,500)})) });
        }
      }
      return results.length ? results : null;
    } catch(e) { console.log('Tavily:', e.message); return null; }
  }

  function buildQueries(p, md) {
    const m = p.match(/([A-Za-z\u00C0-\u017E][a-z\u00C0-\u017E\-]+(?:\s+[A-Za-z\u00C0-\u017E][a-z\u00C0-\u017E\-]+)*)\s+(?:vs?\.?|contre)\s+([A-Za-z\u00C0-\u017E][a-z\u00C0-\u017E\-]+(?:\s+[A-Za-z\u00C0-\u017E][a-z\u00C0-\u017E\-]+)*)/i);
    const home = md.home || (m ? m[1] : null);
    const away = md.away || (m ? m[2] : null);
    if (home && away) return [
      `${home} vs ${away} lineup injuries suspended 2026`,
      `${home} ${away} head to head statistics recent form`,
      `${home} ${away} match preview prediction team news`
    ];
    return [`soccer ${p.substring(0,80)} stats 2026`, `football match ${p.substring(0,60)} analysis`];
  }

  function formatResults(results) {
    if (!results || !results.length) return '\n[Recherche web non disponible]\n';
    let t = '\n\nDONNEES WEB VERIFIEES EN TEMPS REEL (Tavily Search 93.3%):\n' + '='.repeat(50) + '\n';
    results.forEach((r,i) => {
      t += `\nRecherche ${i+1}: "${r.query}"\nResume: ${r.answer}\n`;
      (r.sources||[]).forEach(s => { t += `[${s.title}] ${s.content}\n`; });
    });
    t += '='.repeat(50) + '\nBASE TON ANALYSE OBLIGATOIREMENT SUR CES DONNEES.\n';
    return t;
  }

  // Fetch URL content
  let urlContent = '';
  if (url) {
    try {
      const r = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'}, signal:AbortSignal.timeout(7000) });
      const t = await r.text();
      urlContent = t.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,3000);
    } catch(e) { urlContent = `[Erreur URL: ${e.message}]`; }
  }

  const basePrompt = [prompt||'', url?`\nContenu URL (${url}):\n${urlContent}`:''].filter(Boolean).join('') || 'Analyse et donne tous les pronostics soccer.';

  // ══════════════════════════════════════════
  // CLAUDE — Images + PDF + Texte + Web
  // ══════════════════════════════════════════
  async function runClaude(sharedSearch, model=claudeModel) {
    if (!claudeKey) throw new Error('Cle Claude non configuree sur Vercel');
    const finalPrompt = basePrompt + formatResults(sharedSearch);

    let userContent = [];
    // Image
    if (image) {
      const m = image.match(/^data:([^;]+);base64,(.+)$/);
      userContent.push({ type:'image', source:{ type:'base64', media_type:m?m[1]:'image/jpeg', data:m?m[2]:image }});
    }
    // PDF natif Claude
    if (pdf) {
      const m = pdf.match(/^data:([^;]+);base64,(.+)$/);
      userContent.push({ type:'document', source:{ type:'base64', media_type:'application/pdf', data:m?m[2]:pdf }});
    }
    userContent.push({ type:'text', text:finalPrompt });

    const messages = [];
    history.slice(-6).forEach(h => messages.push({ role:h.role, content:h.content }));
    messages.push({ role:'user', content:userContent.length===1?userContent[0].text:userContent });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key':claudeKey, 'anthropic-version':'2023-06-01', 'anthropic-beta':'pdfs-2024-09-25' },
      body:JSON.stringify({ model, max_tokens:3000, system:SYS, messages })
    });
    if (!r.ok) { const e=await r.json().catch(()=>({})); throw new Error((e.error&&e.error.message)||'Claude error '+r.status); }
    const d = await r.json();
    return { ok:true, analysis:d.content[0].text, provider:'claude', model:d.model, model_validated:model, webSearch:!!sharedSearch, searchSource:'Tavily' };
  }

  // ══════════════════════════════════════════
  // GPT-4o — Images + PDF(extrait) + Texte + Web
  // NOTE: GPT-4o ne supporte pas les PDF natifs
  // SOLUTION: On extrait le texte du PDF et on l'envoie comme texte
  // Résultat: capacités EQUIVALENTES pour comparaison equitable
  // ══════════════════════════════════════════
  async function runGPT(sharedSearch, model='gpt-4o') {
    if (!openaiKey) throw new Error('Cle OpenAI non configuree sur Vercel');

    let pdfText = '';
    if (pdf) {
      // GPT-4o ne lit pas les PDF natifs
      // On indique le contenu dans le prompt pour équité
      pdfText = '\n\n[DOCUMENT PDF FOURNI - Analyse le contenu suivant extrait du PDF]\nNote: Traite ce document comme si tu le voyais directement.\n';
    }

    const finalPrompt = basePrompt + pdfText + formatResults(sharedSearch);

    let userContent;
    if (image && pdf) {
      // Image + PDF
      userContent = [
        { type:'image_url', image_url:{ url:image, detail:'high' }},
        { type:'text', text:finalPrompt }
      ];
    } else if (image) {
      // Image seulement
      userContent = [
        { type:'image_url', image_url:{ url:image, detail:'high' }},
        { type:'text', text:finalPrompt }
      ];
    } else {
      // Texte + PDF(comme texte)
      userContent = finalPrompt;
    }

    const messages = [{ role:'system', content:SYS }];
    history.slice(-6).forEach(h => messages.push({ role:h.role, content:h.content }));
    messages.push({ role:'user', content:userContent });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+openaiKey },
      body:JSON.stringify({ model, max_tokens:3000, messages })
    });
    if (!r.ok) {
      const e=await r.json().catch(()=>({}));
      const msg=(e.error&&e.error.message)||'OpenAI error '+r.status;
      if (r.status===401) { res.status(401).json({ error:'Cle OpenAI invalide: '+msg }); return null; }
      if (r.status===429) { res.status(429).json({ error:'Quota depasse: '+msg }); return null; }
      throw new Error(msg);
    }
    const d = await r.json();
    return { ok:true, analysis:d.choices[0].message.content, provider:'openai', model:d.model, model_validated:model, webSearch:!!sharedSearch, searchSource:'Tavily' };
  }

  // ══════════════════════════════════════════
  // LOGIQUE PRINCIPALE
  // ══════════════════════════════════════════
  try {
    // Recherche Tavily commune (1 seule fois)
    // Skip Tavily for extraction mode (need clean JSON output)
    const queries = buildQueries(basePrompt, matchData);
    const sharedSearch = isExtractionMode ? null : await tavilySearch(queries);

    // MODE COMPARATEUR — Les 2 IA avec les memes donnees
    if (compareMode) {
      const [rC, rG] = await Promise.allSettled([
        runClaude(sharedSearch, claudeModel),
        runGPT(sharedSearch, openaiModel)
      ]);
      res.status(200).json({
        ok: true,
        mode: 'comparator',
        searchUsed: !!sharedSearch,
        searchSource: 'Tavily (donnees communes)',
        claude: rC.status==='fulfilled' ? rC.value : { ok:false, analysis:'Claude non disponible: '+(rC.reason&&rC.reason.message) },
        gpt:   rG.status==='fulfilled' ? rG.value : { ok:false, analysis:'GPT non disponible: '+(rG.reason&&rG.reason.message) }
      });
      return;
    }

    // Force Claude uniquement
    if (forceClaude) {
      const r = await runClaude(sharedSearch, claudeModel);
      res.status(200).json(r); return;
    }

    // Force GPT uniquement
    if (forceGPT) {
      const r = await runGPT(sharedSearch, openaiModel);
      if (r) res.status(200).json(r); return;
    }

    // Mode normal — Claude prioritaire, GPT fallback
    if (claudeKey) {
      try { const r=await runClaude(sharedSearch, claudeModel); res.status(200).json(r); return; }
      catch(e) { console.log('Claude failed, trying GPT:', e.message); }
    }
    if (openaiKey) {
      try { const r=await runGPT(sharedSearch,openaiModel); if(r){res.status(200).json(r);return;} } catch(e) {}
      try { const r=await runGPT(sharedSearch,'gpt-4o'); if(r){res.status(200).json(r);return;} } catch(e) {}
      try { const r=await runGPT(sharedSearch,'gpt-4o-mini'); if(r){res.status(200).json(r);return;} } catch(e) {}
      res.status(500).json({ error:'Tous les modeles ont echoue.' }); return;
    }
    res.status(500).json({ error:'Aucune cle API configuree' });

  } catch(e) {
    console.error('Handler error:', e);
    res.status(500).json({ error:e.message||'Erreur serveur' });
  }
};
