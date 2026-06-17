# Deployment Notes

## Backend environment

Required:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=dental_clinic_db
DB_PORT=3306
PORT=8080
JWT_SECRET=change_this_to_a_long_random_secret_at_least_32_chars
CORS_ORIGIN=https://your-frontend-domain.com
```

Optional:

```env
NODE_ENV=production
BODY_LIMIT=1mb
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=500
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

## Frontend environment

```env
VITE_API_URL=https://your-api-domain.com/api
VITE_SOCKET_URL=https://your-api-domain.com
```

## Health check

Use this URL for uptime checks:

```text
GET /health
```

Expected healthy response:

```json
{
  "success": true,
  "status": "ok",
  "database": "ok"
}
```

## Pre-demo commands

```bash
npm run doctor
npm run db:setup
npm run smoke:api
```

```bash
cd frontend
npm run build
```

## Security notes

- Do not deploy with the local `JWT_SECRET`.
- Set `CORS_ORIGIN` to the real frontend domain in production.
- Keep `.env` out of git.
- Configure Cloudinary before using upload APIs.
