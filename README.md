# MAzemPro V7 Pro Plus

Améliorations intégrées sans casser l'architecture premium existante :

- boutons Claude / ChatGPT / Comparer IA mieux visibles
- sélection IA réellement prise en compte même pour les requêtes texte
- lecture de captures via le serveur Vercel courant, sans devoir reconfigurer l'URL après nettoyage local
- correction du bug `SYS is not defined`
- boutons actifs Analyse IA / Comparer / Enregistrer / Partager sur les matchs live et pré-match
- lexique enrichi sans doublons majeurs
- partage/enregistrement plus uniformisés
- service worker versionné pour mieux forcer la mise à jour

Variables d'environnement Vercel requises :
- `CLAUDE_API_KEY`
- `OPENAI_API_KEY`
- `API_FOOTBALL_KEY`
- `TAVILY_API_KEY` (recommandée)

Structure :
- `index.html`
- `manifest.json`
- `sw.js`
- `package.json`
- `vercel.json`
- `api/ai.js`
- `api/football.js`
