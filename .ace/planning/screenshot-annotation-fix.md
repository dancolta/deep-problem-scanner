# Plan: Fix Screenshot Capture & Annotation Placement

## Problem Summary
1. Annotations are stacked in the top-left corner instead of being placed ON problematic elements
2. Screenshot has large empty margins (site content doesn't fill 1440px viewport)
3. No red visual highlights directly on the problematic UI elements

---

## TASK 1: Smart Content-Width Screenshot Cropping

**Goal**: Detect actual content boundaries and crop screenshot to eliminate empty margins.

**Approach**:
- After capturing full viewport screenshot, detect the content area boundaries
- Crop to content width (typically the max-width container of the site)
- Preserve full height

**Implementation in `scanner-service.ts`**:
```javascript
// After screenshot capture:
// 1. Use sharp to analyze the image
// 2. Detect content edges (where non-background pixels start/end)
// 3. Crop to content boundaries with small padding
```

**Files**: `src/services/scanner/scanner-service.ts`

---

## TASK 2: Fix Annotation Coordinate System

**Goal**: Gemini returns coordinates for the FULL screenshot, but annotations must be placed ON the actual UI elements.

**Root Cause**: The current prompt tells Gemini the screenshot dimensions, but Gemini is returning coordinates that don't match where elements actually appear.

**Fix in `gemini-vision.ts`**:
- Improve prompt to emphasize: "Place annotation coordinates DIRECTLY on the problematic element, not in corners"
- Add examples of correct vs incorrect placement
- Request element-specific bounding boxes

**Files**: `src/services/annotation/gemini-vision.ts`

---

## TASK 3: Red Border/Highlight Drawing System

**Goal**: Draw red visual highlights directly ON the problematic elements (not just callout boxes).

**Current**: Only draws callout boxes with labels
**Needed**:
- Red border around the problematic element (2-3px)
- Semi-transparent red overlay (20-30% opacity)
- Number marker adjacent to (not overlapping) the highlight

**Implementation in `drawing.ts`**:
```javascript
// For each annotation:
// 1. Draw semi-transparent red fill on the element area
// 2. Draw 3px red border around the element
// 3. Position number badge adjacent (top-right corner of element)
// 4. Position label/description box OUTSIDE the element area
```

**Files**: `src/services/annotation/drawing.ts`

---

## TASK 4: Playwright Research (Evaluation Only)

**Question**: Would Playwright improve screenshot quality over Puppeteer?

**Evaluate**:
- Font rendering quality
- High-DPI/Retina support
- Element-specific capture
- Dynamic content handling
- Integration complexity

**Deliverable**: Recommendation document

---

## Testing

After each task:
1. Run scan on https://huswell.com
2. Check screenshot in Google Drive
3. Verify:
   - No excessive margins
   - Annotations placed ON elements
   - Red highlights visible
   - Labels readable and not overlapping

---

## Priority Order
1. TASK 3 (Drawing) - Most impactful visual fix
2. TASK 2 (Gemini Prompt) - Fix coordinate accuracy
3. TASK 1 (Cropping) - Remove empty margins
4. TASK 4 (Playwright) - Research only
