# Deep Problem Scanner

A desktop application that scans websites for conversion issues, annotates screenshots with AI-detected problems, and automates personalized outreach emails.

## Features

- **Website Scanning** - Automatically scans websites using Playwright, measuring load times (LCP) and capturing viewport screenshots
- **AI-Powered Analysis** - Uses Gemini Vision AI to detect conversion issues in hero sections (CTAs, headlines, trust signals, imagery)
- **Annotated Screenshots** - Generates visually annotated screenshots highlighting specific problems with severity indicators
- **Email Generation** - Creates personalized cold outreach emails based on scan findings with conversion impact data
- **Google Workspace Integration** - Syncs with Google Sheets for lead management, Drive for screenshot storage, and Gmail for drafts
- **Email Scheduling** - Schedule email sends with configurable intervals and time windows

## Tech Stack

- **Electron** - Cross-platform desktop application
- **React + TypeScript** - Frontend UI
- **Playwright** - Website scanning and screenshot capture
- **Gemini Vision AI** - Screenshot analysis and issue detection
- **Google APIs** - Sheets, Drive, Gmail integration
- **Sharp** - Image processing and compression

## Prerequisites

- Node.js 18+
- Google Cloud project with OAuth 2.0 credentials
- Gemini API key

## Installation

```bash
# Clone the repository
git clone https://github.com/NodeSparks/deep-problem-scanner.git
cd deep-problem-scanner

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium
```

## Configuration

Create a `.env` file based on `.env.example`:

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GEMINI_API_KEY=your_gemini_api_key
NODE_ENV=development
MAX_CONCURRENT_SCANS=2
SCREENSHOT_WIDTH=1440
SCREENSHOT_HEIGHT=900
PAGE_TIMEOUT=30000
MAX_IMAGE_SIZE_KB=100
```

### Google Cloud Setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable the following APIs:
   - Google Sheets API
   - Google Drive API
   - Gmail API
3. Create OAuth 2.0 credentials (Desktop application)
4. Add `http://localhost` to authorized redirect URIs

## Usage

```bash
# Development mode
npm run dev

# Build for production
npm run build

# Start the application
npm start

# Package for distribution
npm run package
```

## Workflow

1. **Setup** - Configure Google authentication and Gemini API key
2. **Upload** - Import leads from CSV or Google Sheets (company name, website, contact info)
3. **Scan** - The app scans each website, capturing screenshots and running diagnostics
4. **Review** - AI analyzes hero sections and annotates screenshots with conversion issues
5. **Drafts** - Review and approve AI-generated personalized emails
6. **Schedule** - Set send intervals and time windows for approved emails

## Project Structure

```
├── electron/           # Electron main process files
├── src/
│   ├── renderer/       # React frontend
│   │   ├── pages/      # App pages (Setup, Upload, Scan, Drafts, Schedule)
│   │   ├── components/ # Reusable components
│   │   └── context/    # React context providers
│   ├── services/       # Backend services
│   │   ├── annotation/ # AI screenshot annotation
│   │   ├── email/      # Email generation
│   │   ├── google/     # Google APIs integration
│   │   ├── scanner/    # Playwright website scanner
│   │   └── scheduler/  # Email scheduling
│   ├── shared/         # Shared types and IPC channels
│   └── utils/          # Utility functions
└── tests/              # Test files
```

## Diagnostics

The scanner runs the following checks:

| Check | Description |
|-------|-------------|
| Page Speed | Measures Largest Contentful Paint (LCP) |
| Mobile Responsive | Viewport meta tag detection |
| HTTPS | Secure connection verification |
| No Broken Images | Image loading validation |
| Structured Data | JSON-LD/schema.org detection |

## AI Analysis

Gemini Vision analyzes hero sections for:

- **CTA Issues** - Missing, vague, or low-contrast call-to-action buttons
- **Headline Problems** - Unclear value propositions or missing H1/subheadline
- **Trust Signals** - Missing social proof, logos, or testimonials
- **Hero Image** - Generic stock photos or missing visual content

## License

UNLICENSED - Private repository

## Author

[NodeSparks](https://github.com/NodeSparks)
