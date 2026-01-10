# Chippewa Valley Home Care CRM - Deployment Guide

## Architecture Overview
- **Frontend**: React SPA deployed on Netlify (static hosting)
- **Backend**: Node.js/Express API on Render (serverless with webhooks)
- **Database**: PostgreSQL on Render
- **Real-time**: WebSockets for GPS tracking and notifications
- **Compliance**: HIPAA-ready with audit logging

---

## 1. DATABASE SETUP (Render PostgreSQL)

### Create PostgreSQL Database on Render
1. Go to https://render.com
2. Create new PostgreSQL database
3. Name: `chippewa-home-care-db`
4. Plan: Standard (you can upgrade later)
5. Region: Choose closest to Eau Claire (Chicago recommended)
6. Copy the connection string (DATABASE_URL)

### Initialize Database Schema
```bash
# After getting DATABASE_URL from Render:
psql $DATABASE_URL < schema.sql

# Or using psql directly with the provided connection string:
psql "postgresql://user:password@host:port/database" < schema.sql
```

### Create Initial Admin User
```sql
-- Using your psql connection:
INSERT INTO users (
  id, email, password_hash, first_name, last_name, phone, role
) VALUES (
  uuid_generate_v4(),
  'admin@chippewahomecare.com',
  crypt('YourSecurePassword123!', gen_salt('bf')),
  'Admin',
  'User',
  '(715) 555-0100',
  'admin'
);

-- Second admin (for backup):
INSERT INTO users (
  id, email, password_hash, first_name, last_name, phone, role
) VALUES (
  uuid_generate_v4(),
  'admin2@chippewahomecare.com',
  crypt('AnotherSecurePassword456!', gen_salt('bf')),
  'Admin',
  'Two',
  '(715) 555-0101',
  'admin'
);
```

---

## 2. BACKEND SETUP (Render Node.js)

### Create Node.js Service on Render
1. Go to https://render.com/dashboard
2. Create new "Web Service"
3. Connect your GitHub repo (or upload files)
4. Configuration:
   - **Name**: `chippewa-home-care-api`
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Standard ($12/month minimum)

### Environment Variables (Add in Render)
```
DATABASE_URL=postgresql://user:password@host:5432/database
JWT_SECRET=YourVerySecureRandomSecret32CharactersMinimum!
NODE_ENV=production
FRONTEND_URL=https://yourdomain.netlify.app
PORT=3000
```

### Files to Deploy
```
/server.js
/package.json
/schema.sql
/.env.example
/Procfile (optional, for deployment)
```

### Create Procfile (for Render)
```
web: node server.js
```

---

## 3. FRONTEND SETUP (Netlify React)

### Build React App
```bash
# Create production build
npm run build

# This creates /dist folder with optimized static files
```

### Deploy to Netlify
1. Go to https://app.netlify.com
2. "Add new site" → "Deploy manually"
3. Drag and drop the `/dist` folder
4. Or connect Git repo and auto-deploy from main branch

### Configure Netlify
1. **Site settings** → **Build & deploy**
2. Build command: `npm run build`
3. Publish directory: `dist`

### Environment Variables (Netlify)
In Netlify dashboard → **Site settings** → **Build & deploy** → **Environment**:
```
REACT_APP_API_URL=https://chippewa-home-care-api.onrender.com
NODE_ENV=production
```

### Connect Custom Domain (Optional)
1. Go to **Site settings** → **Domain management**
2. Add your custom domain (e.g., crm.chippewahomecare.com)
3. Update DNS records if needed

---

## 4. LOCAL DEVELOPMENT SETUP

### Backend
```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env with local postgres connection
DATABASE_URL=postgresql://user:password@localhost:5432/cvhc
JWT_SECRET=dev-secret-key-change-in-production
FRONTEND_URL=http://localhost:3000

# Run migrations
psql $DATABASE_URL < schema.sql

# Start server
npm run dev
# Server runs on http://localhost:5000
```

### Frontend
```bash
# Install dependencies
npm install

# Create .env file
REACT_APP_API_URL=http://localhost:5000

# Start development server
npm start
# App runs on http://localhost:3000
```

---

## 5. DATABASE BACKUPS (CRITICAL)

### Render Automatic Backups
- Render automatically backs up PostgreSQL
- Go to Database → Backups
- Keep automatic backups enabled
- Download backup files periodically

### Manual Backup (PowerShell)
```powershell
# Backup to file
$env:PGPASSWORD = "password"
pg_dump -h "host.onrender.com" -U "user" -d "database" > backup-$(Get-Date -Format 'yyyy-MM-dd').sql

# Restore from backup
psql -h "host.onrender.com" -U "user" -d "database" < backup-2026-01-10.sql
```

---

## 6. SECURITY CHECKLIST

- [ ] Change all default passwords
- [ ] Set strong JWT_SECRET (minimum 32 characters)
- [ ] Enable HTTPS on all domains
- [ ] Use environment variables (never hardcode secrets)
- [ ] Enable IP whitelisting on database if possible
- [ ] Regular audit log reviews
- [ ] Set up log monitoring
- [ ] Enable rate limiting on API
- [ ] Use HTTPS for all external APIs (SendGrid, PayPal, etc.)
- [ ] Implement CORS properly

---

## 7. HIPAA COMPLIANCE

### Data Protection
- ✅ Database encryption at rest (Render provides)
- ✅ HTTPS encryption in transit
- ✅ Audit logging (all changes tracked)
- ✅ Role-based access control
- ✅ User authentication with JWT
- ✅ PHI field encryption ready (SSN example in schema)

### Audit Logs
```sql
-- View all audit logs
SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100;

-- View user activity
SELECT * FROM audit_logs WHERE user_id = 'user-uuid' ORDER BY timestamp DESC;

-- Export audit trail
COPY (SELECT * FROM audit_logs WHERE timestamp > NOW() - INTERVAL '30 days') 
TO '/tmp/audit_trail.csv' WITH CSV HEADER;
```

### Monitoring
```sql
-- Check for suspicious activity
SELECT user_id, COUNT(*) as changes, MAX(timestamp) as last_change
FROM audit_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY user_id
ORDER BY changes DESC;
```

---

## 8. NOTIFICATIONS SETUP

### Email (SendGrid)
```bash
# Install SendGrid
npm install @sendgrid/mail

# Add to .env
SENDGRID_API_KEY=your-api-key
SENDGRID_FROM_EMAIL=noreply@chippewahomecare.com
```

### SMS (Twilio) - Optional
```bash
npm install twilio

# Add to .env
TWILIO_ACCOUNT_SID=your-sid
TWILIO_AUTH_TOKEN=your-token
TWILIO_PHONE_NUMBER=+1234567890
```

### Push Notifications (Web Push)
```bash
npm install web-push

# Generate keys
npx web-push generate-vapid-keys

# Add to .env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

---

## 9. DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] All tests passing
- [ ] No console errors
- [ ] Environment variables set in Render
- [ ] Environment variables set in Netlify
- [ ] Database migrations run
- [ ] Admin users created
- [ ] Audit logging verified

### Post-Deployment
- [ ] Test login from both admin and caregiver accounts
- [ ] Verify GPS tracking works
- [ ] Test invoice generation
- [ ] Check notification emails send
- [ ] Verify database backups running
- [ ] Monitor Render logs for errors
- [ ] Check Netlify build logs
- [ ] Test from mobile device

---

## 10. TROUBLESHOOTING

### Database Connection Issues
```bash
# Test connection
psql "your-database-url"

# Check Render logs
# Render Dashboard → Services → chippewa-home-care-db → Logs
```

### API Not Starting
```bash
# Check Render logs
# Render Dashboard → Services → chippewa-home-care-api → Logs

# Common issues:
# - DATABASE_URL not set
# - Missing environment variables
# - Port already in use
```

### Frontend Not Loading Data
```javascript
// Check browser console (F12)
// Check network tab for API calls
// Verify REACT_APP_API_URL is correct
// Check CORS settings in server.js
```

### GPS Not Tracking
- [ ] User has enabled location services
- [ ] HTTPS is enabled (required for geolocation)
- [ ] Mobile browser has permission
- [ ] Location accuracy ±30m typical

---

## 11. SCALING FOR 45-MILE COVERAGE

### Multi-Location Support
Database schema includes `service_locations` table:
```sql
INSERT INTO service_locations (name, city, state, latitude, longitude, service_radius_miles)
VALUES (
  'Eau Claire Main',
  'Eau Claire',
  'WI',
  44.8113,
  -91.4989,
  25
);
```

### Performance Optimization
- Add indexes for queries (schema includes them)
- Cache dashboard data with 5-minute TTL
- Use connection pooling on database
- Compress API responses
- CDN for static assets (Netlify provides)

---

## 12. MONITORING & LOGGING

### Render Logs
- Render Dashboard → Services → Select Service → Logs
- View real-time application logs
- Export logs for auditing

### Database Monitoring
```sql
-- Check database size
SELECT pg_size_pretty(pg_database_size('database_name'));

-- Monitor active connections
SELECT * FROM pg_stat_activity;

-- Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## 13. COST BREAKDOWN

- **Render PostgreSQL**: $15/month
- **Render Node.js Service**: $12/month
- **Netlify Free**: $0 (with custom domain)
- **Twilio SMS**: Pay as you go (~$0.0075 per message)
- **SendGrid Email**: Free up to 100/day
- **Total**: ~$27/month baseline + usage

---

## QUICK REFERENCE

```powershell
# PowerShell commands for management

# Backup database
$env:PGPASSWORD = "your-password"
pg_dump -h "host" -U "user" -d "database" > backup.sql

# Restore database
psql -h "host" -U "user" -d "database" < backup.sql

# Monitor Render logs
# Use Render Dashboard web interface

# Check database connection
psql "your-database-url"
```

---

For questions or issues, check:
- Render documentation: https://render.com/docs
- Netlify documentation: https://docs.netlify.com
- PostgreSQL documentation: https://www.postgresql.org/docs/

---

**Last Updated**: January 2026
**Status**: Production Ready ✅
