# Deep Problem Scanner

A desktop application that scans websites for conversion issues, annotates screenshots with AI-detected problems, and automates personalized outreach emails.

## Features

- **Quick Scan** - Instantly scan any website URL without importing a list
- **Website Scanning** - Scans websites using Playwright, measuring load times and capturing screenshots
- **AI-Powered Analysis** - Gemini Vision AI detects conversion issues (CTAs, headlines, trust signals)
- **PageSpeed Integration** - Fetches real Google PageSpeed scores for performance metrics
- **Annotated Screenshots** - Generates visual annotations highlighting specific problems
- **Email Generation** - Creates personalized cold outreach emails based on scan findings
- **Gmail Alias Support** - Send from any configured Gmail alias (sendAs address)
- **Google Workspace Integration** - Syncs with Sheets, Drive, and Gmail
- **Email Scheduling** - Schedule sends with random intervals and timezone-aware delivery

## Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop App | Electron |
| Frontend | React + TypeScript |
| Browser Automation | Playwright (Chromium) |
| AI Vision/Text | Google Gemini API |
| Performance Scores | Google PageSpeed Insights API |
| Image Processing | Sharp |
| Google Services | OAuth2 + Drive/Gmail/Sheets APIs |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ Google      │────▶│ Lead Import  │────▶│ Playwright  │
│ Sheets/CSV  │     │ & Validation │     │ Browser     │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                    ┌──────────────┐            │ Screenshot
                    │ PageSpeed    │◀───────────┤
                    │ API (scores) │            │
                    └──────┬───────┘            ▼
                           │            ┌─────────────┐
                           │            │ Gemini      │
                           │            │ Vision API  │
                           │            └──────┬──────┘
                           │                   │ Issues
                           ▼                   ▼
                    ┌──────────────────────────────┐
                    │ Annotate Screenshot (Sharp)  │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ Google Drive (upload image)  │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ Gemini (generate email)      │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ Gmail (create draft)         │
                    └──────────────────────────────┘
```

## Prerequisites

- Node.js 18+
- Google Cloud project with OAuth 2.0 credentials
- Gemini API key
- PageSpeed Insights API key (optional, for performance scores)

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
NODE_ENV=development
```

> **Note:** Gemini API key and PageSpeed API key are configured in the app's Setup page, not in `.env`.

### Google Cloud Setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable the following APIs:
   - Google Sheets API
   - Google Drive API
   - Gmail API
   - PageSpeed Insights API (optional)
3. Create OAuth 2.0 credentials (Desktop application)
4. Add `http://localhost` to authorized redirect URIs
5. Required OAuth scopes:
   - `gmail.modify` - Create and send drafts
   - `gmail.settings.basic` - Read signatures and sendAs addresses
   - `drive.file` - Upload screenshots
   - `spreadsheets` - Read/write lead data

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

1. **Setup** - Connect Google account, configure API keys, select sender email alias
2. **Upload** - Import leads from Google Sheets, CSV, or use Quick Scan for single URLs
3. **Scan** - App opens each website, captures screenshot, runs AI analysis
4. **Annotate** - Issues are highlighted on screenshot with explanation cards
5. **Email** - AI generates personalized email, draft created in Gmail
6. **Schedule** - Set send times with random intervals in lead's timezone

## Setup Page Configuration

| Setting | Description |
|---------|-------------|
| Google Account | OAuth connection for Sheets/Drive/Gmail |
| Send From Email | Select which Gmail alias to use for outreach |
| Gemini API Key | For AI vision analysis and email generation |
| PageSpeed API Key | For real performance/accessibility scores |
| Google Sheet URL | Output sheet for scan results |

## Quick Scan vs List Import

| Feature | Quick Scan | List Import |
|---------|------------|-------------|
| Input | Single URL | CSV or Google Sheets |
| Contact Info | Optional | Required for emails |
| Gmail Draft | Only if email provided | Created automatically |
| Best For | Quick website audits | Outreach campaigns |

## Lead Import Format

### Google Sheets (Recommended)

The app recognizes flexible column headers:

| Field | Recognized Headers |
|-------|-------------------|
| Company Name | `Company`, `Company Name`, `Business`, `Organization`, `Company Name - Cleaned` |
| Website URL | `Website`, `URL`, `Site`, `Domain`, `Homepage` |
| Contact Email | `Email`, `Contact Email`, `Primary Email`, `Email 1`, `Work Email` |
| Contact Name | `Name`, `Contact Name`, `Full Name`, `Contact Full Name` |
| First Name | `First Name`, `First` |
| Last Name | `Last Name`, `Last`, `Surname` |
| Processed | `Done`, `Processed`, `Completed`, `Sent`, `Emailed` |

> **Note:** If `Contact Name` is not provided, the app combines `First Name` + `Last Name` automatically.

### Processed/Done Column

Add a **checkbox column** to track which leads have been emailed:

- **On Import**: Rows with checkbox checked are skipped
- **After Scan**: App automatically marks checkbox TRUE for scanned leads
- **Benefit**: Prevents duplicate emails when re-importing

## Project Structure

```
├── electron/              # Electron main process
│   ├── main.ts           # App entry point
│   ├── ipc-handlers.ts   # IPC request handlers
│   └── service-registry.ts
├── src/
│   ├── renderer/         # React frontend
│   │   ├── pages/        # Setup, Upload, Scan, Drafts, Schedule
│   │   └── hooks/        # Custom React hooks
│   ├── services/
│   │   ├── annotation/   # Gemini vision + Sharp drawing
│   │   ├── email/        # Email generation with templates
│   │   ├── google/       # Drive, Gmail, Sheets services
│   │   ├── scanner/      # Playwright browser automation
│   │   ├── scheduler/    # Email scheduling logic
│   │   └── pagespeed/    # PageSpeed Insights integration
│   └── shared/           # Types and IPC channels
└── dist/                 # Compiled output
```

## AI Analysis

Gemini Vision analyzes screenshots for:

| Issue Type | Description |
|------------|-------------|
| Unclear Value Proposition | Missing or vague headline/subheadline |
| Weak CTA | Missing, vague, or low-contrast call-to-action |
| Missing Trust Signals | No social proof, logos, or testimonials |
| Poor Visual Hierarchy | Cluttered layout or competing elements |

## Email Scheduling

The scheduler supports:

- **Random intervals** - 10-20 minute gaps between emails (configurable)
- **Business hours** - Only sends during configured window (e.g., 9 AM - 5 PM)
- **Timezone-aware** - Sends based on lead's local time
- **Sender alias** - Emails sent from selected Gmail alias

## Services Overview

| Service | File | Purpose |
|---------|------|---------|
| PlaywrightScanner | `scanner/playwright-scanner.ts` | Opens websites, captures screenshots |
| GeminiVision | `annotation/gemini-vision.ts` | Analyzes screenshots for issues |
| Drawing | `annotation/drawing.ts` | Annotates screenshots with Sharp |
| GmailService | `google/gmail.ts` | Creates drafts, fetches signatures/aliases |
| DriveService | `google/drive.ts` | Uploads screenshots |
| SheetsService | `google/sheets.ts` | Reads/writes scan results |
| SheetsLeadImporter | `google/sheets-lead-importer.ts` | Imports leads from Google Sheets |
| EmailGenerator | `email/email-generator.ts` | Generates personalized emails |
| PageSpeedService | `pagespeed/pagespeed-service.ts` | Fetches performance scores |
| Scheduler | `scheduler/scheduler.ts` | Manages email send timing |

<details>
<summary><strong>Email Generation Details</strong> (click to expand)</summary>

### Prompt Structure

The AI email generation uses a structured prompt with:

- Recipient info (name, company, domain)
- PageSpeed scores (performance, accessibility, SEO, best practices)
- Detected issues from Gemini Vision
- Screenshot URL for inline embedding

### Subject Line Rules

- ALL LOWERCASE (no caps except proper nouns)
- NO PUNCTUATION
- 3-7 words maximum
- Reference their specific problem

### Body Rules

- 75-100 words max
- Direct, expert, helpful tone
- Includes `[IMAGE]` placeholder for screenshot
- No signature (Gmail adds automatically)

### CTA Rotation

Emails alternate between CTAs for variety:
- "Want me to walk you through the rest of the findings?"
- "Worth a 15-min call to see if the other issues are worth fixing?"

</details>

## License

UNLICENSED - Private repository

## Author

[NodeSparks](https://nodesparks.com)
