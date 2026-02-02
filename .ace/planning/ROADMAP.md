# Deep Problem Scanner Roadmap

## Overview

Total Phases: 6
Current Phase: 6 of 6
Status: In Progress

## Phases

### Phase 1: Project Foundation & Core Scanning Engine
**Goal:** Set up Electron project scaffolding with TypeScript, install dependencies, and build the headless browser scanning service that captures homepage screenshots and runs 5 diagnostic checks.
**Status:** Complete

Plans:
- [x] 01-01: Project scaffolding and scanning engine

Dependencies: None

---

### Phase 2: Image Processing & Annotation Pipeline
**Goal:** Build the Gemini Vision integration for detecting annotation coordinates, Sharp-based drawing of red boxes/labels on screenshots, and PNG compression pipeline to meet <100KB limit.
**Status:** Complete

Plans:
- [x] 02-01: Annotation detection and image processing

Dependencies: Phase 1

---

### Phase 3: Google Integration (OAuth, Sheets, Drive)
**Goal:** Implement Google OAuth desktop flow with token storage, Sheets API for appending/reading rows with duplicate detection, and Drive API for screenshot upload with sharing permissions.
**Status:** Complete

Plans:
- [x] 03-01: Google OAuth and API integration

Dependencies: Phase 1

---

### Phase 4: AI Email Generation
**Goal:** Build Gemini Standard API integration for generating personalized outreach emails with subject lines, enforce 80-word limit, parse JSON responses, and integrate with scan results.
**Status:** Complete

Plans:
- [x] 04-01: Email generation service

Dependencies: Phase 2, Phase 3

---

### Phase 5: Desktop UI
**Goal:** Build the 5 Electron screens (setup, upload, scan progress, draft review, schedule management) with real-time progress updates and settings persistence.
**Status:** In Progress

Plans:
- [x] 05-01: Setup and upload screens
- [x] 05-02: Scan progress, draft review, and schedule screens

Dependencies: Phase 3, Phase 4

---

### Phase 6: Email Scheduler & Integration Testing
**Goal:** Build in-memory email queue with timezone support, 15-20 min interval sending, Gmail draft creation with embedded screenshots, crash recovery via sheet status, and end-to-end testing.
**Status:** Not Started

Plans:
- [x] 06-01: Scheduler service and Gmail draft creation
- [ ] 06-02: End-to-end integration and testing

Dependencies: Phase 4, Phase 5

---

## Phase Summaries

| Phase | Name | Plans | Status | Duration |
|-------|------|-------|--------|----------|
| 1 | Project Foundation & Core Scanning Engine | 1/1 | Complete | - |
| 2 | Image Processing & Annotation Pipeline | 1/1 | Complete | - |
| 3 | Google Integration (OAuth, Sheets, Drive) | 1/1 | Complete | - |
| 4 | AI Email Generation | 1/1 | Complete | - |
| 5 | Desktop UI | 2/2 | Complete | - |
| 6 | Email Scheduler & Integration Testing | 1/2 | In Progress | - |

## Notes

- Project type: **fullstack** (Electron + backend services)
- Zone mapping: ALPHA = backend services/models, BETA = components/services, GAMMA = pages/integration
- Each plan has max 3 tasks assigned to ALPHA/BETA/GAMMA
- Phases 2 and 3 can potentially run in parallel after Phase 1
