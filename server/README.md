# Hot Dog Tycoon — Leaderboard API

Tiny Node/Express service that backs the global leaderboard for the Hot Dog Tycoon game.

## Endpoints

- `GET  /health` — readiness check (`{ status: 'ok' }`)
- `GET  /api/leaderboard` — top 20 scores (sorted by fewest days, then highest net worth)
- `POST /api/leaderboard` — submit a score `{ name, career, days, networth }`

CORS is restricted via `ALLOWED_ORIGINS`. Submissions are rate-limited (10 per IP per 5 min).

## Local dev

```bash
cd server
cp .env.example .env       # then edit values
npm install
npm run init-db            # creates the table
npm run dev                # starts on :8080
```

## Schema

See [`schema.sql`](./schema.sql). Single table `hdt_leaderboard`.

## Deploy to Azure Container Apps

The Dockerfile is ready. Typical flow (run with your `az` CLI; this matches your AI_Hosting workflow):

```bash
# 1) Build & push image (use your existing ACR)
az acr build \
  --registry <YOUR_ACR_NAME> \
  --resource-group AI_Hosting \
  --image hot-dog-tycoon-api:latest \
  ./server

# 2) Read DB creds from the shared Postgres keyvault
PGHOST=$(az keyvault secret show --vault-name <SHARED_PG_KV> --name pg-host    --query value -o tsv)
PGUSER=$(az keyvault secret show --vault-name <SHARED_PG_KV> --name pg-user    --query value -o tsv)
PGPASS=$(az keyvault secret show --vault-name <SHARED_PG_KV> --name pg-password --query value -o tsv)

# 3) Create or update the container app (zero-downtime — second revision)
az containerapp create \
  --name hot-dog-tycoon-api \
  --resource-group AI_Hosting \
  --environment <YOUR_CONTAINERAPP_ENV> \
  --image <YOUR_ACR_NAME>.azurecr.io/hot-dog-tycoon-api:latest \
  --registry-server <YOUR_ACR_NAME>.azurecr.io \
  --target-port 8080 \
  --ingress external \
  --min-replicas 1 --max-replicas 3 \
  --revision-suffix v1 \
  --secrets pg-password="$PGPASS" \
  --env-vars \
      PGHOST="$PGHOST" \
      PGPORT=5432 \
      PGDATABASE=hot_dog_tycoon \
      PGUSER="$PGUSER" \
      PGPASSWORD=secretref:pg-password \
      PGSSL=true \
      ALLOWED_ORIGINS="https://codeforgames823.github.io"

# Update later: same command with `containerapp update` + new --revision-suffix
# (each new revision is created alongside the old one, then traffic shifts)
```

After deploy:

1. Run the schema once (locally with the pulled creds, or via `psql` from a jump box).
2. Grab the FQDN: `az containerapp show --name hot-dog-tycoon-api --resource-group AI_Hosting --query properties.configuration.ingress.fqdn -o tsv`
3. Tell the frontend about it. Two options:
   - Edit `hot-dog-tycoon/game.js`, set `window.HDT_API_URL = 'https://<fqdn>'` in `index.html` before `game.js`.
   - Or, in the browser console: `localStorage.setItem('hdt_api', 'https://<fqdn>')` then refresh.

## Rollback

Container Apps creates a new revision every deploy and keeps the old one. To roll back:

```bash
az containerapp revision list -n hot-dog-tycoon-api -g AI_Hosting -o table
az containerapp ingress traffic set -n hot-dog-tycoon-api -g AI_Hosting \
  --revision-weight <previous-revision-name>=100
```
