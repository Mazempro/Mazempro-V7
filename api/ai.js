module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const openaiKey = process.env.OPENAI_API_KEY;
  const claudeKey = process.env.CLAUDE_API_KEY;
  if (!openaiKey && !claudeKey) { res.status(500).json({ error: 'Aucune clé API configurée.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  const prompt      = (body && body.prompt)      ? body.prompt      : '';
  const image       = (body && body.image)       ? body.image       : null;
  const pdf         = (body && body.pdf)         ? body.pdf         : null;
  const url         = (body && body.url)         ? body.url         : null;
  const lang        = (body && body.lang)        ? body.lang        : 'fr';
  const history     = (body && body.history)     ? body.history     : [];
  const forceClaude = (body && body.forceClaude) ? true             : false;
  const forceGPT    = (body && body.forceGPT)    ? true             : false;

  if (!prompt && !image && !pdf && !url) { res.status(400).json({ error: 'Contenu manquant' }); return; }

  const SYS_LANGS = {
    fr: `Tu es MAzemPro V7 ULTIMATE — analyste soccer UEFA Pro pour MAzem (Montréal, Mise-o-jeu+). Réponds en français. Si une capture, PDF ou URL est fourni, analyse en détail: équipes, scores, cotes, temps. Analyse complète: domicile/extérieur confirmé, forme 5 matchs, notes attaque/défense/milieu/gardien /10, 11 probables, absences clés, H2H récent, tableau pronostics (1X2/HT-FT/Over-Under/BTTS/Score Exact/Double Chance/DNB) avec confiance ⭐1-5, verdict final MISE ✅ ou ÉVITER ❌.`,
    en: `You are MAzemPro V7 ULTIMATE — UEFA Pro soccer analyst. Reply in English. Full analysis with predictions table and final verdict.`,
    es: `Eres MAzemPro V7 ULTIMATE — analista de fútbol UEFA Pro. Responde en español. Análisis completo con tabla de pronósticos y veredicto final.`,
    ar: `أنت MAzemPro V7 ULTIMATE — محلل كرة القدم الاحترافي. أجب باللغة العربية. تحليل كامل مع جدول التوقعات والحكم النهائي.`
  };
  const SYS = SYS_LANGS[lang] || SYS_LANGS['fr'];

  // Fetch URL content
  let urlContent = '';
  if (url) {
    try {
      const urlRes = await fetch(url, { headers: {'User-Agent':'Mozilla/5.0'}, signal: AbortSignal.timeout(8000) });
      const text = await urlRes.text();
      urlContent = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,3000);
    } catch(e) { urlContent = `[Erreur URL: ${e.message}]`; }
  }

  const finalPrompt = [prompt||'', url?`\n\n🔗 Contenu URL (${url}):\n${urlContent}`:''].filter(Boolean).join('') || 'Analyse ce contenu et donne tous les pronostics.';

  // Helper to build Claude messages
  function buildClaudeMessages() {
    let userContent = [];
    if (image) {
      const m = image.match(/^data:([^;]+);base64,(.+)$/);
      userContent.push({ type:'image', source:{ type:'base64', media_type:m?m[1]:'image/jpeg', data:m?m[2]:image }});
    }
    if (pdf) {
      const m = pdf.match(/^data:([^;]+);base64,(.+)$/);
      userContent.push({ type:'document', source:{ type:'base64', media_type:'application/pdf', data:m?m[2]:pdf }});
    }
    userContent.push({ type:'text', text:finalPrompt });
    const messages = [];
    if (history.length > 0) history.slice(-8).forEach(h => messages.push({ role:h.role, content:h.content }));
    messages.push({ role:'user', content: userContent.length===1 ? userContent[0].text : userContent });
    return messages;
  }

  // Helper to build OpenAI messages
  function buildOpenAIMessages() {
    let userContent;
    if (image) userContent = [{ type:'image_url', image_url:{ url:image, detail:'high' }}, { type:'text', text:finalPrompt }];
    else userContent = finalPrompt;
    const messages = [{ role:'system', content:SYS }];
    if (history.length > 0) history.slice(-8).forEach(h => messages.push({ role:h.role, content:h.content }));
    messages.push({ role:'user', content:userContent });
    return messages;
  }

  // ── CLAUDE ──
  async function tryClaude() {
    if (!claudeKey) throw new Error('Clé Claude non configurée');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key':claudeKey, 'anthropic-version':'2023-06-01', 'anthropic-beta':'pdfs-2024-09-25' },
      body: JSON.stringify({ model:'claude-sonnet-4-5', max_tokens:3000, system:SYS, messages:buildClaudeMessages() })
    });
    if (!response.ok) { const e=await response.json().catch(()=>({})); throw new Error((e.error&&e.error.message)||'Claude error '+response.status); }
    const data = await response.json();
    return { ok:true, analysis:data.content[0].text, provider:'claude-sonnet-4-5' };
  }

  // ── OPENAI ──
  async function tryOpenAI(model='gpt-4o') {
    if (!openaiKey) throw new Error('Clé OpenAI non configurée');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+openaiKey },
      body: JSON.stringify({ model, max_tokens:3000, messages:buildOpenAIMessages() })
    });
    if (!response.ok) {
      const e=await response.json().catch(()=>({}));
      const msg=(e.error&&e.error.message)||'OpenAI error '+response.status;
      if (response.status===401) { res.status(401).json({ error:'Clé OpenAI invalide: '+msg }); return null; }
      if (response.status===429) { res.status(429).json({ error:'Quota dépassé: '+msg }); return null; }
      throw new Error(msg);
    }
    const data = await response.json();
    return { ok:true, analysis:data.choices[0].message.content, provider:'openai-'+model };
  }

  try {
    // Comparator mode: force specific provider
    if (forceClaude) {
      const r = await tryClaude();
      res.status(200).json(r); return;
    }
    if (forceGPT) {
      const r = await tryOpenAI('gpt-4o');
      if (r) res.status(200).json(r); return;
    }

    // Normal mode: Claude first, OpenAI fallback
    if (claudeKey) {
      try { const r = await tryClaude(); res.status(200).json(r); return; } catch(e) { console.log('Claude failed:', e.message); }
    }
    if (openaiKey) {
      try { const r = await tryOpenAI('gpt-4o'); if(r){res.status(200).json(r);return;} } catch(e) { console.log('GPT-4o failed:', e.message); }
      try { const r = await tryOpenAI('gpt-4o-mini'); if(r){res.status(200).json(r);return;} } catch(e) { console.log('GPT-4o-mini failed:', e.message); }
      res.status(500).json({ error:'Tous les modèles ont échoué.' }); return;
    }
    res.status(500).json({ error:'Aucune clé API configurée' });
  } catch(e) {
    res.status(500).json({ error:e.message||'Erreur serveur' });
  }
};
