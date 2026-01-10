# Frontend Setup Guide

## **Folder Structure You Need**

In your `frontend/` folder, create this structure:

```
frontend/
├── package.json                    (NEW - from frontend-package.json)
├── vite.config.js                  (NEW - from vite.config.js)
├── .gitignore                      (NEW - from frontend-.gitignore)
├── .env.example                    (NEW - from frontend-.env.example)
├── index.html                      (NEW - from frontend-index.html)
│
├── src/
│   ├── index.jsx                   (existing)
│   ├── App.jsx                     (existing)
│   ├── config.js                   (UPDATE - use frontend-config.js)
│   │
│   └── components/
│       ├── Login.jsx               (existing)
│       ├── AdminDashboard.jsx      (existing)
│       ├── CaregiverDashboard.jsx  (existing)
│       │
│       └── admin/
│           ├── DashboardOverview.jsx
│           ├── ReferralSources.jsx
│           ├── ClientsManagement.jsx
│           ├── CaregiverManagement.jsx
│           ├── BillingDashboard.jsx
│           └── SchedulesManagement.jsx
│
└── public/
    └── (any static files - can be empty)
```

---

## **Step 1: Move Files into `frontend/` folder**

Copy these files INTO the `frontend/` folder:

### From Root → `frontend/`:
- `index.html` (replace with `frontend-index.html`)
- `package.json` (use `frontend-package.json`)
- All `.jsx` files from root

### Create New Files in `frontend/`:
- `vite.config.js` (use the one provided)
- `.gitignore` (use `frontend-.gitignore`)
- `.env.example` (use `frontend-.env.example`)
- Update `config.js` (use `frontend-config.js`)

---

## **Step 2: Install Dependencies**

In PowerShell, in the `frontend/` folder:

```powershell
cd frontend
npm install
```

This installs React, Vite, and everything needed.

---

## **Step 3: Test Locally**

```powershell
npm run dev
```

Should start dev server at `http://localhost:3000`

---

## **Step 4: Build for Production**

```powershell
npm run build
```

Creates `dist/` folder with compiled files. This is what you upload to Netlify.

---

## **Step 5: Update Git**

In root folder:

```powershell
git add .
git commit -m "Add frontend Vite setup"
git push
```

---

## **Then Deploy to Netlify**

1. In `frontend/` folder: `npm run build`
2. Go to Netlify
3. Drag & drop the `dist/` folder
4. Done!

---

## **Files Provided**

- `frontend-package.json` → Rename to `frontend/package.json`
- `vite.config.js` → Copy to `frontend/vite.config.js`
- `frontend-.gitignore` → Rename to `frontend/.gitignore`
- `frontend-.env.example` → Rename to `frontend/.env.example`
- `frontend-index.html` → Copy to `frontend/index.html`
- `frontend-config.js` → Copy to `frontend/src/config.js`

---

**Ready to set this up?**
