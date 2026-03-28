# MAzemPro V7 — Final

Analyseur de courses hippiques avec IA (OpenAI GPT + Claude fallback).

## Corrections JS appliquées (V4 → V7-Final)

1. **Apostrophe commentaire** : `/* don't clear */` → `/* do not clear */`
2. **String multiligne** : `callAI('Résume en 3-4 lignes...\n'+...)` → concaténation propre sans retour ligne littéral
3. **filter/join** : `.filter(Boolean).join('\n')` → `.filter(Boolean).join('\\n')`
4. **notify apostrophe** : `notify('Sélectionne d'abord...')` → `notify("Sélectionnez d'abord...", "error")`

## Fonctionnalités V7-Final

- ✅ **Modèle GPT dynamique** : sélecteur gpt-4o / gpt-4o-mini / gpt-4-turbo / gpt-4 / gpt-3.5-turbo
- ✅ **57 types Mise-o-jeu** : Simple, Couplé, Trio, Tiercé, Quarté+, Quinté+, Multi, Pick, Systèmes, Exotiques, E/W, PMU spéciaux
- ✅ **Calculateur combinaisons** : calcul automatique du nombre de combos et mise totale
- ✅ **Modal Pari** : score de confiance IA + calcul gain/perte simulé + historique
- ✅ **Lexique 3 onglets** : Termes, Types de Paris, Analyse
- ✅ **Épingles partout** : bouton 📌 sur analyses + chevaux + exportable
- ✅ **Vercel serveur** : API `/api/chat.js` côté serveur, clé OpenAI jamais exposée au client

## Déploiement Vercel

```bash
# 1. Installer Vercel CLI
npm i -g vercel

# 2. Configurer la clé API (jamais dans le code)
vercel env add OPENAI_API_KEY
# Entrez votre clé OpenAI quand demandé

# 3. Déployer
vercel --prod
```

## Variables d'environnement requises

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Clé API OpenAI (sk-...) |

## Structure

```
MAzemPro-V7-Final/
├── index.html          # App principale (HTML/CSS/JS)
├── api/
│   └── chat.js         # Serverless proxy OpenAI (Vercel)
├── vercel.json         # Config Vercel (routing + headers)
├── package.json        # Node metadata
└── README.md
```

## Notes

- Le fallback par défaut utilise l'API Anthropic Claude (claude-sonnet-4)
- En production Vercel, les appels IA passent par `/api/chat` → OpenAI
- La clé API est stockée dans les env vars Vercel, jamais dans le HTML


## Correctif 2026-03-28
- Suppression du bloc `functions.runtime` invalide dans `vercel.json`
- Routage Vercel conservé vers `/api/ai` et `/api/football`
- Détection automatique de `window.location.origin` quand l'app est déjà déployée sur Vercel
- Préremplissage des sélecteurs de modèles visibles
