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

## Lead Import Format

### Google Sheets (Recommended)

Import leads directly from Google Sheets. The app recognizes flexible column headers:

| Field | Recognized Headers |
|-------|-------------------|
| Company Name | `Company`, `Company Name`, `Business`, `Organization`, `Account` |
| Website URL | `Website`, `URL`, `Site`, `Domain`, `Homepage` |
| Contact Email | `Email`, `Contact Email`, `Mail`, `Email Address` |
| Contact Name | `Name`, `Contact Name`, `Full Name`, `Contact` |
| First Name | `First Name`, `First` |
| Last Name | `Last Name`, `Last`, `Surname` |

> **Note:** If `Contact Name` is not provided, the app will combine `First Name` + `Last Name` automatically.

### Example Sheet Structure

| Done | First Name | Last Name | Company Name | Website | Email |
|------|------------|-----------|--------------|---------|-------|
| ☐ | John | Smith | Acme Inc | acme.com | john@acme.com |
| ☑ | Jane | Doe | Beta Corp | beta.io | jane@beta.io |
| ☐ | Bob | Wilson | Gamma LLC | gamma.co | bob@gamma.co |

### Processed/Done Column

Add a **checkbox column** (recommended name: `Done` or `Processed`) to track which leads have been emailed:

- **On Import**: Rows with checkbox checked (TRUE) are skipped and shown as "Already processed"
- **After Scan**: The app automatically marks the checkbox TRUE for successfully scanned leads
- **Benefit**: Prevents duplicate emails when re-importing the same lead list

Recognized header names: `Done`, `Processed`, `Completed`, `Sent`, `Emailed`

### CSV Import

CSV files follow the same column format. Headers are matched case-insensitively.

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

## Email Generation

### Prompt Structure

The AI email generation uses a structured prompt with the following components:

```
RECIPIENT:
- First name, Company, Domain

SCAN FINDINGS:
- Intro metric (poorest PageSpeed score below threshold)
- Number of issues found
- Most critical issue
- Full diagnostics summary

EMAIL PATTERN:
Subject: [3-7 words, reference their main problem]

Hi {{firstName}},

{{introHook}}

[TRANSITION_SENTENCE]
[IMAGE]

{{cta}}
```

### Subject Line Formulas

Pick one based on available data:

**Formula 1: Problem + Metric** (when you have specific numbers)
```
your site takes 4.3 seconds to load
homepage loads in 4.3 seconds
homepage is 4.3 seconds slow
```

**Formula 2: Problem + Impact** (emphasize business cost)
```
your homepage might be losing conversions
losing 25% of visitors before they convert
hero section could be costing you leads
```

**Formula 3: Just the Metric** (maximum curiosity)
```
4.3 seconds
25% visitor drop
47 http requests
```

**Formula 4: Casual Observation** (fallback when no metric)
```
noticed a few issues on your site
quick thing about your homepage
saw something on your site
```

### Subject Line Rules

- ALL LOWERCASE (no caps except proper nouns)
- NO PUNCTUATION (no periods, exclamation marks, question marks)
- 3-7 words maximum
- NO clickbait ("you won't believe", "shocking")
- NO salesy words ("free", "opportunity", "limited time")

### Body Rules

| # | Rule |
|---|------|
| 1 | Body: 75-100 words max (under 80 ideal). Be concise. |
| 2 | First sentence MUST follow the intro hook pattern provided |
| 3 | First sentence MUST include the impact statement if a metric is provided |
| 4 | NO em dashes. Use commas instead. |
| 5 | Second paragraph: Output exactly "[TRANSITION_SENTENCE]" placeholder |
| 6 | CTA MUST match the provided CTA exactly |
| 7 | NO signature - Gmail will add it automatically |
| 8 | Tone: Direct, expert, helpful |
| 9 | NO: ROI claims, pricing, buzzwords, "hope this finds you well" |
| 10 | NEVER use "hero" or "hero section" in the OPENING sentence |

### Spacing Rules

- After `[TRANSITION_SENTENCE]` → single newline → `[IMAGE]` (NO blank line)
- After `[IMAGE]` → blank line → CTA (one blank line after image)

### CTA Rotation

Emails alternate between two CTAs based on email index:

| Email # | CTA |
|---------|-----|
| 1st, 3rd, 5th... | "Want me to walk you through the rest of the findings? Takes 15 minutes." |
| 2nd, 4th, 6th... | "Worth a 15-min call to see if the other issues are worth fixing?" |

### Buzzword Blacklist

The following words are automatically filtered from the opening paragraph:

| Pattern | Replacement |
|---------|-------------|
| "hero section" | "above-the-fold area" |
| "hero" | "header" |

### Industry Thresholds

PageSpeed metrics below these thresholds are flagged in outreach:

| Metric | Threshold |
|--------|-----------|
| Performance Score | 80 |
| Accessibility Score | 80 |
| SEO Score | 80 |
| Best Practices Score | 80 |

## License

UNLICENSED - Private repository

## Author

[NodeSparks](https://github.com/NodeSparks)
