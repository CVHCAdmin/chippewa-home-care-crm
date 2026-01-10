# 🏥 Chippewa Valley Home Care - CRM Platform

**HIPAA-Compliant, Robust, Secure Home Care Management System**

---

## 📋 Features

### 🎯 Critical Features (Built & Ready)
- ✅ **Referral Source Tracking** - Track revenue per referral source
- ✅ **Billing & Invoicing** - Auto-generate invoices from time entries
- ✅ **Caregiver Schedules** - Manage availability across 45-mile service area
- ✅ **Time Tracking with GPS** - Real-time caregiver location tracking
- ✅ **Client Onboarding** - Comprehensive checklist and medical history
- ✅ **Admin Dashboard** - Complete analytics and reporting
- ✅ **Mobile-Responsive** - Works perfectly on phones, tablets, desktops
- ✅ **Role-Based Access** - Admin and Caregiver roles with promotion capability
- ✅ **HIPAA Audit Logging** - Every change tracked and logged
- ✅ **Secure Authentication** - JWT tokens with role-based access control
- ✅ **Push Notifications** - Email and web push alerts
- ✅ **Export Functionality** - CSV/Excel report export

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React SPA)                                     │
│  Deployed on Netlify                                      │
│  - Admin Dashboard                                        │
│  - Caregiver Interface                                    │
│  - Mobile-Responsive UI                                  │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS
                     ↓
┌─────────────────────────────────────────────────────────┐
│  Backend API (Node.js/Express)                           │
│  Deployed on Render                                      │
│  - RESTful API                                           │
│  - WebSockets for GPS tracking                           │
│  - JWT Authentication                                    │
│  - HIPAA Audit Logging                                   │
└────────────────────┬────────────────────────────────────┘
                     │ SQL
                     ↓
┌─────────────────────────────────────────────────────────┐
│  PostgreSQL Database                                      │
│  Deployed on Render                                      │
│  - HIPAA-compliant schema                               │
│  - Encryption at rest                                    │
│  - Automatic backups                                     │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL (local or Render)
- Git
- Netlify and Render accounts

### 1. Backend Setup
```bash
# Clone and setup
cd backend
npm install

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT_SECRET

# Initialize database
psql $DATABASE_URL < schema.sql

# Create admin user
psql $DATABASE_URL
# Run the INSERT statement from DEPLOYMENT.md

# Start server
npm run dev
# API running on http://localhost:5000
```

### 2. Frontend Setup
```bash
# Setup
cd frontend
npm install

# Configure environment
echo "REACT_APP_API_URL=http://localhost:5000" > .env

# Start development
npm start
# App running on http://localhost:3000
```

### 3. Login
- **Email**: admin@chippewahomecare.com
- **Password**: (whatever you set in database)

---

## 📊 Admin Dashboard Features

### 1. Dashboard Overview
- Active clients count
- Active caregivers count
- Pending invoices and amounts
- Monthly revenue tracking
- Referral source performance
- Caregiver hours and satisfaction

### 2. Referral Sources 🏥
- Track which hospitals, doctors, agencies refer clients
- Contact information management
- Revenue per source
- Referral count and trends

### 3. Clients 👥
- Client profiles with medical history
- Insurance information
- Emergency contacts
- Onboarding checklists
- Service type tracking
- Medical conditions and allergies

### 4. Caregivers 👔
- Caregiver management
- Role promotion (convert to admin)
- Certification tracking
- Hire dates and status
- Performance ratings

### 5. Billing 💰
- Auto-generate invoices from time entries
- Invoice tracking (pending, paid, overdue)
- Payment status management
- Monthly revenue reports
- CSV export for accounting
- Accounts receivable aging

### 6. Schedules 📅
- Recurring and one-time schedules
- Caregiver availability
- Timezone-aware
- Overtime tracking
- Vacation and sick time management

---

## 📱 Caregiver Dashboard Features

### Clock In/Out with GPS
1. Select client from dropdown
2. Tap **CLOCK IN** (GPS automatically records location)
3. Work with automatic GPS tracking every 60 seconds
4. Tap **CLOCK OUT** (GPS captures end location)

### Schedule View
- Today's shifts at a glance
- Start/end times
- Client assignments

### Settings
- Email notification preferences
- Push notification preferences
- Schedule alert settings

---

## 🔒 Security & Compliance

### HIPAA-Ready
- ✅ Audit logging for all data changes
- ✅ User authentication and authorization
- ✅ Role-based access control
- ✅ Encrypted password storage (bcrypt)
- ✅ JWT token-based API security
- ✅ HTTPS encryption in transit
- ✅ Database encryption at rest
- ✅ PHI handling ready

### Audit Trail
Every change is logged with:
- User who made the change
- What data changed
- Old and new values
- Timestamp
- Action type (CREATE, UPDATE, DELETE)

```sql
SELECT * FROM audit_logs 
WHERE table_name = 'clients' 
ORDER BY timestamp DESC;
```

---

## 📲 Mobile Responsiveness

All interfaces fully optimized for:
- 📱 Mobile phones (320px+)
- 📱 Tablets (768px+)
- 💻 Desktops (1024px+)

Tested on:
- iOS Safari
- Android Chrome
- Responsive Design Mode

---

## 🗄️ Database Schema

### Core Tables
- `users` - Admins and caregivers
- `clients` - Client information and medical history
- `referral_sources` - Where clients come from
- `caregiver_schedules` - Work schedules
- `time_entries` - Tracked hours with GPS
- `gps_tracking` - Continuous location data
- `invoices` - Generated bills
- `audit_logs` - HIPAA audit trail

### See schema.sql for complete structure with 20+ tables

---

## 🧪 Testing

### Test Login Credentials
```
Email: admin@chippewahomecare.com
Password: (set when creating user)
```

### Test Data
After deployment, you can add test data:

```bash
# Add test referral source
curl -X POST http://localhost:5000/api/referral-sources \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Eau Claire Hospital",
    "type": "hospital",
    "contactName": "Dr. Smith",
    "email": "dr.smith@hospital.com",
    "phone": "(715) 555-0100"
  }'
```

---

## 📚 API Documentation

### Authentication
```
POST /api/auth/login
Body: { email, password }
Returns: { token, user }
```

### Clients
```
GET    /api/clients              - List all active clients
POST   /api/clients              - Create new client
GET    /api/clients/:id          - Get client details
PUT    /api/clients/:id          - Update client
```

### Referral Sources
```
GET    /api/referral-sources     - List all sources
POST   /api/referral-sources     - Create new source
```

### Time Tracking
```
POST   /api/time-entries/clock-in      - Start shift with GPS
POST   /api/time-entries/:id/clock-out - End shift with GPS
POST   /api/gps-tracking               - Track GPS during shift
```

### Billing
```
GET    /api/invoices                      - List invoices
POST   /api/invoices/generate             - Generate invoice
PUT    /api/invoices/:id/payment-status   - Update payment status
GET    /api/export/invoices-csv           - Export to CSV
```

### Analytics
```
GET    /api/dashboard/summary      - Key metrics
GET    /api/dashboard/referrals    - Referral performance
GET    /api/dashboard/caregiver-hours - Caregiver metrics
```

---

## 🛠️ Deployment

### Deploy to Render (Backend)
1. Create Node.js service on Render
2. Connect Git repo or upload files
3. Set environment variables (see DEPLOYMENT.md)
4. Deploy!

### Deploy to Netlify (Frontend)
1. Build: `npm run build`
2. Deploy `/dist` folder to Netlify
3. Set environment variables
4. Custom domain (optional)

See **DEPLOYMENT.md** for complete step-by-step instructions.

---

## 🔧 PowerShell Commands

### Backup Database
```powershell
$env:PGPASSWORD = "your-password"
pg_dump -h "host.onrender.com" -U "user" -d "database" > backup-$(Get-Date -Format 'yyyy-MM-dd').sql
```

### Restore Database
```powershell
psql -h "host.onrender.com" -U "user" -d "database" < backup.sql
```

### Monitor Logs
```powershell
# Use Render or Netlify dashboard for real-time logs
# Or setup log streaming with your provider's CLI
```

---

## 💡 Tips for Success

### For Admins
1. Start by adding referral sources - these are critical
2. Add clients through the onboarding form
3. Generate schedules for caregivers
4. Monitor billing dashboard weekly
5. Review audit logs monthly

### For Caregivers
1. Enable location services on phone
2. Check schedule each morning
3. Clock in at client's location
4. Clock out when shift ends
5. Check notifications for alerts

### General
- Backup database weekly
- Review audit logs regularly
- Test notifications in staging
- Use strong passwords
- Enable 2FA if available

---

## 🆘 Troubleshooting

### Common Issues

**Database Connection Error**
```bash
# Test connection
psql "your-database-url"

# Check Render logs
# Dashboard → Services → Database → Logs
```

**API Not Starting**
- Check DATABASE_URL is set
- Check JWT_SECRET is set
- Check port 5000 is available
- Review Render logs

**Frontend Not Loading Data**
- Check REACT_APP_API_URL is correct
- Open browser console (F12)
- Check Network tab for API errors
- Verify CORS is enabled

**GPS Not Tracking**
- Ensure HTTPS is enabled (required)
- Check location services enabled on device
- Check browser permissions
- Look for geolocation errors in console

---

## 📞 Support

### Resources
- Render Docs: https://render.com/docs
- Netlify Docs: https://docs.netlify.com
- PostgreSQL: https://postgresql.org/docs
- React: https://react.dev
- Node.js: https://nodejs.org

### Getting Help
1. Check Render/Netlify logs
2. Review browser console (F12)
3. Check DEPLOYMENT.md
4. Review API responses in Network tab
5. Verify environment variables

---

## 📋 Checklist for Launch

- [ ] Database initialized with schema.sql
- [ ] Admin users created
- [ ] Backend deployed to Render
- [ ] Frontend deployed to Netlify
- [ ] Environment variables set
- [ ] HTTPS enabled
- [ ] Admin login works
- [ ] Caregiver login works
- [ ] GPS tracking tested
- [ ] Invoice generation tested
- [ ] Email notifications configured
- [ ] Database backups verified
- [ ] Audit logs reviewed
- [ ] Security checklist completed

---

## 📄 License

HIPAA-compliant | Production-Ready | January 2026

---

**Built for Chippewa Valley Home Care**
*Transforming home care operations with secure, intelligent technology*

For questions or issues: Contact your development team

---

Version 1.0.0 | Last Updated: January 10, 2026
