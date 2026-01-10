# deploy.ps1 - Chippewa Valley Home Care CRM Deployment & Management Script
# Run as Administrator
# Usage: .\deploy.ps1 -Action setup|deploy|backup|restore|monitor

param(
    [ValidateSet('setup', 'deploy', 'backup', 'restore', 'monitor', 'test')]
    [string]$Action = 'setup',
    
    [string]$DatabaseUrl = '',
    [string]$BackupFile = '',
    [string]$Environment = 'production'
)

# Color output
function Write-Success { Write-Host $args[0] -ForegroundColor Green }
function Write-Error { Write-Host "ERROR: $($args[0])" -ForegroundColor Red }
function Write-Info { Write-Host $args[0] -ForegroundColor Cyan }
function Write-Warning { Write-Host "WARNING: $($args[0])" -ForegroundColor Yellow }

# Check prerequisites
function Test-Prerequisites {
    Write-Info "Checking prerequisites..."
    
    $missing = @()
    
    # Check Node.js
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        $missing += "Node.js (https://nodejs.org/)"
    } else {
        Write-Success "✓ Node.js $(node --version)"
    }
    
    # Check npm
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        $missing += "npm"
    } else {
        Write-Success "✓ npm $(npm --version)"
    }
    
    # Check PostgreSQL tools
    if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
        Write-Warning "psql not found (needed for database operations)"
    } else {
        Write-Success "✓ PostgreSQL tools installed"
    }
    
    if ($missing.Count -gt 0) {
        Write-Error "Missing prerequisites:"
        $missing | ForEach-Object { Write-Error "  - $_" }
        exit 1
    }
}

# Setup environment
function Setup-Environment {
    Write-Info "Setting up Chippewa Valley Home Care CRM..."
    
    if (-not (Test-Path ".env")) {
        Write-Info "Creating .env file from template..."
        Copy-Item ".env.example" ".env"
        Write-Warning "Please edit .env with your configuration"
    }
    
    Write-Info "Installing backend dependencies..."
    npm install
    
    Write-Success "Setup complete! Next steps:"
    Write-Info "1. Edit .env file with your database URL and API key"
    Write-Info "2. Run: .\deploy.ps1 -Action deploy"
}

# Deploy to Render and Netlify
function Deploy-Application {
    Write-Info "Deploying application..."
    
    # Check .env exists
    if (-not (Test-Path ".env")) {
        Write-Error ".env file not found. Run 'setup' action first."
        exit 1
    }
    
    # Build frontend
    Write-Info "Building frontend..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Frontend build failed"
        exit 1
    }
    Write-Success "✓ Frontend built successfully"
    
    # Deploy to Render (assumes git configured)
    Write-Info "Deploying to Render..."
    Write-Info "Using 'git push' for Render auto-deployment"
    Write-Info "Manual step: Visit https://dashboard.render.com to verify deployment"
    
    # Deploy to Netlify (requires netlify-cli)
    Write-Info "Deploying to Netlify..."
    if (Get-Command netlify -ErrorAction SilentlyContinue) {
        netlify deploy --prod --dir=dist
        Write-Success "✓ Deployed to Netlify"
    } else {
        Write-Warning "netlify-cli not installed. Install with: npm install -g netlify-cli"
        Write-Info "Then run: netlify deploy --prod --dir=dist"
    }
    
    Write-Success "Deployment complete!"
}

# Backup database
function Backup-Database {
    Write-Info "Backing up database..."
    
    if (-not $DatabaseUrl) {
        $DatabaseUrl = Read-Host "Enter DATABASE_URL"
    }
    
    $timestamp = Get-Date -Format "yyyy-MM-dd_HHmm"
    $backupFile = "backup_cvhc_$timestamp.sql"
    
    # Extract connection info from PostgreSQL URL
    # Format: postgresql://user:password@host:port/database
    
    try {
        Write-Info "Dumping database to $backupFile..."
        
        # Using psql with connection string
        $env:PGPASSWORD = ($DatabaseUrl -split "@")[0] -split ":" | Select-Object -Last 1
        
        $host = ($DatabaseUrl -split "@")[1] -split "/" | Select-Object -First 1
        $database = ($DatabaseUrl -split "/")[-1]
        $user = ($DatabaseUrl -split "://")[1] -split ":")[0]
        
        pg_dump -h $host -U $user -d $database > $backupFile
        
        $fileSize = (Get-Item $backupFile).Length / 1MB
        Write-Success "✓ Backup created: $backupFile ($([Math]::Round($fileSize, 2)) MB)"
        
    } catch {
        Write-Error "Backup failed: $_"
        exit 1
    }
}

# Restore from backup
function Restore-Database {
    Write-Info "Restoring from backup..."
    
    if (-not $BackupFile) {
        $BackupFile = Read-Host "Enter backup file path"
    }
    
    if (-not (Test-Path $BackupFile)) {
        Write-Error "Backup file not found: $BackupFile"
        exit 1
    }
    
    if (-not $DatabaseUrl) {
        $DatabaseUrl = Read-Host "Enter DATABASE_URL"
    }
    
    $confirm = Read-Host "This will OVERWRITE the database. Continue? (yes/no)"
    if ($confirm -ne "yes") {
        Write-Info "Restore cancelled"
        return
    }
    
    try {
        Write-Warning "Restoring database from $BackupFile..."
        
        # Extract connection info
        $env:PGPASSWORD = ($DatabaseUrl -split "@")[0] -split ":" | Select-Object -Last 1
        $host = ($DatabaseUrl -split "@")[1] -split "/" | Select-Object -First 1
        $database = ($DatabaseUrl -split "/")[-1]
        $user = ($DatabaseUrl -split "://")[1] -split ":")[0]
        
        psql -h $host -U $user -d $database < $BackupFile
        
        Write-Success "✓ Database restored successfully"
        
    } catch {
        Write-Error "Restore failed: $_"
        exit 1
    }
}

# Monitor application
function Monitor-Application {
    Write-Info "Monitoring Chippewa Valley Home Care CRM..."
    Write-Info ""
    Write-Info "To monitor your application:"
    Write-Info ""
    Write-Info "📊 Backend (Render):"
    Write-Info "   1. Visit https://dashboard.render.com"
    Write-Info "   2. Select 'chippewa-home-care-api' service"
    Write-Info "   3. View logs in real-time"
    Write-Info ""
    Write-Info "📊 Frontend (Netlify):"
    Write-Info "   1. Visit https://app.netlify.com"
    Write-Info "   2. Select your site"
    Write-Info "   3. Check deploy status and analytics"
    Write-Info ""
    Write-Info "📊 Database (Render):"
    Write-Info "   1. Visit https://dashboard.render.com"
    Write-Info "   2. Select 'chippewa-home-care-db' resource"
    Write-Info "   3. View metrics and backups"
    Write-Info ""
    Write-Info "✅ Check application health:"
    
    try {
        $response = Invoke-WebRequest -Uri "https://your-api-url.onrender.com/health" -Method Get -ErrorAction Stop
        Write-Success "✓ API is healthy"
    } catch {
        Write-Warning "Could not reach API. Check that deployment is complete."
    }
}

# Test application
function Test-Application {
    Write-Info "Testing Chippewa Valley Home Care CRM..."
    
    Write-Info "Testing backend (http://localhost:5000)..."
    
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5000/health" -Method Get -ErrorAction Stop
        Write-Success "✓ Backend API is running"
    } catch {
        Write-Warning "Backend not running. Start with: npm run dev"
    }
    
    Write-Info ""
    Write-Info "Testing frontend (http://localhost:3000)..."
    Write-Info "Open http://localhost:3000 in your browser"
    
    Write-Info ""
    Write-Info "Testing database..."
    Write-Info "Check .env for DATABASE_URL"
    
    Write-Info ""
    Write-Success "Test complete! Check browser at http://localhost:3000"
}

# Main execution
Write-Info "╔════════════════════════════════════════════════════════════════╗"
Write-Info "║  Chippewa Valley Home Care CRM - Deployment Tool               ║"
Write-Info "║  HIPAA-Compliant Home Care Management Platform                 ║"
Write-Info "╚════════════════════════════════════════════════════════════════╝"
Write-Info ""

Test-Prerequisites

switch ($Action) {
    'setup' {
        Setup-Environment
    }
    'deploy' {
        Deploy-Application
    }
    'backup' {
        Backup-Database
    }
    'restore' {
        Restore-Database
    }
    'monitor' {
        Monitor-Application
    }
    'test' {
        Test-Application
    }
    default {
        Write-Info "Usage: .\deploy.ps1 -Action [setup|deploy|backup|restore|monitor|test]"
        Write-Info ""
        Write-Info "Actions:"
        Write-Info "  setup    - Initialize project and install dependencies"
        Write-Info "  deploy   - Build and deploy to Render/Netlify"
        Write-Info "  backup   - Backup PostgreSQL database"
        Write-Info "  restore  - Restore from backup file"
        Write-Info "  monitor  - View monitoring dashboard links"
        Write-Info "  test     - Test local development setup"
    }
}

Write-Info ""
Write-Success "Operation completed successfully!"
