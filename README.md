# MAzemPro V7 — Soccer Merge V4 + V5

Version préparée à partir de la base V4, avec amélioration ciblée depuis V5.

## Ce qui a été gardé de V4
- Front soccer complet
- Pages, chips, menus et logique métier soccer
- API `/api/ai` et `/api/football`
- Analyse image / PDF / URL / historique / comparaison

## Ce qui a été repris de V5
- Validation stricte des modèles GPT et Claude côté serveur
- Routage Vercel propre
- Structure de déploiement avec dossier `api/`
- Sélecteurs de modèles visibles dès l’ouverture

## Améliorations incluses
- Boutons supplémentaires visibles dès l’ouverture (menu `Plus` ouvert)
- Sélecteurs de modèles Claude / GPT visibles sur la page IA
- Sauvegarde rapide des modèles visibles
- Messages IA avec actions de sauvegarde/copie
- `api/ai.js` renforcé avec whitelist de modèles
- `vercel.json` corrigé pour Vercel

## Variables d’environnement Vercel
- `OPENAI_API_KEY`
- `CLAUDE_API_KEY`
- `TAVILY_API_KEY` (optionnel mais recommandé)
- `API_FOOTBALL_KEY`

## Structure
- `index.html`
- `manifest.json`
- `sw.js`
- `package.json`
- `vercel.json`
- `api/ai.js`
- `api/football.js`

## Déploiement
1. Uploade le contenu du dossier sur GitHub.
2. Connecte le repo à Vercel.
3. Ajoute les variables d’environnement.
4. Redéploie.
