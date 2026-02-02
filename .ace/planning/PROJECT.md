# Deep Problem Scanner

## Core Value

Desktop application that scans website homepages, generates annotated screenshots showing problems, writes personalized outreach emails using AI, and integrates with Google Sheets/Gmail for workflow management.

## Overview

Deep Problem Scanner is a cross-platform Electron desktop app designed for lead outreach automation. Users upload a CSV of leads, the app scans their homepages concurrently, captures screenshots, runs 5 diagnostic checks, annotates problems visually, generates personalized outreach emails via AI, and manages the full email workflow through Google Sheets and Gmail integration.

The app serves as an end-to-end pipeline: CSV upload → homepage scanning → AI-powered annotation → email generation → Google Sheet tracking → Gmail draft creation → scheduled sending. It uses Google Sheets as the source of truth for state management, with the app handling scanning, AI processing, and email orchestration.

## Requirements

### Must Have
- [ ] Headless browser scanning (Puppeteer/Playwright) with homepage screenshots at 1440x900
- [ ] 5 diagnostic checks: speed, mobile-friendliness, CTA analysis, SEO basics, broken links
- [ ] Visual annotation system: red boxes + labels on screenshots using Gemini Pro Vision for coordinates + Sharp for drawing
- [ ] Image compression pipeline: PNG format, <100KB hard limit, pngquant/Sharp compression
- [ ] Google OAuth flow for desktop app (Sheets, Drive, Gmail APIs)
- [ ] Google Drive upload for annotated screenshots with permission setting
- [ ] Google Sheets integration: append scan results, read approved status, duplicate detection by website_url
- [ ] AI email generation via Gemini API with strict 80-word limit, JSON output (subject + body)
- [ ] Gmail draft creation with embedded screenshots (img src=drive_url)
- [ ] Email scheduler: in-memory queue, 15-20 min intervals, timezone support
- [ ] CSV upload with validation (required columns check, duplicate email detection)
- [ ] Row range selection for batch scanning
- [ ] Concurrent scanning (1-5 simultaneous)
- [ ] Bot detection handling: puppeteer-extra-plugin-stealth + keyword detection (Cloudflare, CAPTCHA)
- [ ] 30-second timeout per site, skip with "Couldn't load" error
- [ ] Scan failure handling: continue batch, log errors, write FAILED status to sheet
- [ ] Status tracking: draft → scheduled → sent progression in sheet
- [ ] Electron desktop app with 5 main screens (setup, upload, scan, draft, schedule)
- [ ] Real-time progress updates during scanning

### Should Have
- [ ] Schedule overflow detection: calculate time needed upfront, show error with smart suggestion
- [ ] Scheduler crash recovery: read sheet on startup, filter status="scheduled", restore to queue
- [ ] Partial schedule recovery: warning dialog for approved but unscheduled rows
- [ ] Google OAuth revocation handling with clear error messages
- [ ] Email deliverability optimization: 60% text / 40% image ratio, descriptive filenames, alt text

### Nice to Have
- [ ] Cross-platform support (macOS, Windows, Linux)
- [ ] Settings persistence across sessions

## Technical Stack

- **Framework:** Electron (desktop) + React (renderer)
- **Language:** TypeScript
- **Browser Engine:** Puppeteer or Playwright with stealth plugin
- **AI Provider:** Google Gemini (Pro Vision for annotations, Standard for emails)
- **Image Processing:** Sharp + pngquant for compression
- **Google APIs:** OAuth2, Sheets API, Drive API, Gmail API
- **Styling:** TBD (simple UI, 5 screens)
- **State Management:** Google Sheets as source of truth

## Architecture

```
CSV Upload → Row Selection → Concurrent Scans (1-5) →
Screenshot + 5 Diagnostics → Gemini Vision (annotation coords) →
Sharp (draw annotations) → Compress (<100KB) →
Gemini Standard (email generation) →
Drive Upload (screenshot) → Append to Google Sheet →
User Approval (in Google Sheets) → Gmail Draft Creation →
Email Scheduling (in-memory queue, 15-20 min intervals)
```

### Backend Services
1. **Scanner Service:** Puppeteer/Playwright for homepage screenshots + diagnostics
2. **Image Processing:** Gemini Pro Vision for annotation positioning + Sharp for drawing + PNG compression
3. **AI Service:** Gemini API for email generation (~$0.001-0.0015 per lead)
4. **Google Integration:** OAuth + Sheets/Drive/Gmail APIs (unified Google ecosystem)
5. **Scheduler Service:** In-memory queue with smart overflow detection and persistence

## Key Decisions

| Date | Decision | Rationale | Phase |
|------|----------|-----------|-------|
| 2026-02-02 | Gemini as sole AI provider | Unified Google ecosystem, cost-effective ($1-1.50/1000 leads) | Init |
| 2026-02-02 | Google Sheets as state source of truth | Eliminates local DB, user can review/edit directly | Init |
| 2026-02-02 | Screenshots embedded via Drive URL | Host on Drive, use img src in Gmail HTML | Init |
| 2026-02-02 | PNG format with aggressive compression | Better quality than JPEG for annotated screenshots | Init |
| 2026-02-02 | In-memory scheduler with sheet-based recovery | Simple for MVP, sheet provides persistence | Init |
| 2026-02-02 | Homepage only scanning | MVP scope - no multi-page scans | Init |

## Constraints

- MVP: Homepage scanning only (no multi-page)
- Single-user app (no rate limit handling needed - 300 req/min sufficient)
- Images must be <100KB after compression
- Email body strict 80-word limit
- 30-second timeout per website scan
- User provides their own Google OAuth credentials and Gemini API key
- Credentials stored via Electron safeStorage API

## Success Criteria

- [ ] Scan 11 homepages in ~30 seconds (2 concurrent)
- [ ] All annotated images <100KB, professionally annotated
- [ ] Graceful handling of 2-3 site failures in a batch
- [ ] Correct Google Sheet appending with all fields
- [ ] Gmail drafts with embedded screenshots render correctly
- [ ] Scheduler persists across app restarts (via sheet recovery)
- [ ] Clean CSV validation with clear error messages

## Out of Scope

- Multi-page website scanning
- Multi-user support
- Custom email templates (AI generates all)
- CRM integrations beyond Google Sheets
- Analytics dashboard
- A/B testing for emails

## References

- Electron: https://www.electronjs.org/
- Google APIs: https://developers.google.com/apis-explorer
- Gemini API: https://ai.google.dev/
- Sharp: https://sharp.pixelplumbing.com/
- Puppeteer Stealth: https://github.com/nicorninja/puppeteer-extra-plugin-stealth
