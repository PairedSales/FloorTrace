# FloorTrace

## The Fast, Private Floor Plan Area Calculator for Real Estate Professionals

**[Try it now → pairedsales.github.io/FloorTrace](https://pairedsales.github.io/FloorTrace/)**

If you work in real estate appraisal or as an agent in Chicago, you've run into this problem: **the city doesn't record the square footage of condos.** When you're doing an appraisal, you need that number — but getting it from a floor plan sketch is surprisingly painful. Some listing services charge extra just to show the square footage. Some realtors leave it off entirely. Other general-purpose tools can technically do the job, but they weren't built for this workflow and they're slow.

FloorTrace was built specifically to solve this problem, and it does it faster than anything else out there.

---

## What It Does

You upload a photo or scan of a floor plan sketch — the kind you'd find in a listing or pull from a file. FloorTrace reads the room dimensions printed on the sketch and automatically calculates the total area of the unit. No manual measuring. No counting grid squares. No redrawing the floor plan from scratch.

You can click on individual rooms to capture them one at a time, or trace the full outer boundary of the unit to get the gross living area. The measurements update instantly as you work.

---

## Your Data Never Leaves Your Computer

This is important, and it's worth saying plainly: **FloorTrace runs entirely on your computer, inside your web browser.** No floor plan images, no measurements, and no client information is ever uploaded to a server. Nothing is stored online. Nothing is sent anywhere.

For real estate professionals, this matters. Your clients' property information stays private. You don't have to worry about uploading sensitive appraisal materials to a third-party service or agreeing to some company's data policy before you can do your job. The tool works completely offline once the page has loaded.

---

## Why It's Faster

Most tools that can measure area from an image are general-purpose — they were designed for architects or engineers, not for someone working through a stack of condo appraisals. FloorTrace is built around the specific workflow of reading a floor plan sketch with printed dimensions. It recognizes the room labels and numbers already on the sketch and uses them to do the math automatically. What would take several minutes with another tool takes seconds here.

---

## Who It's For

- **Real estate appraisers** who need gross living area calculations from floor plan sketches for condo appraisals in markets like Chicago where unit sizes aren't publicly recorded
- **Real estate agents** who want to verify or calculate square footage from a floor plan without paying extra for a third-party service

---

## How to Use It

1. Open the app in your web browser
2. Upload a floor plan image (photo, scan, or screenshot)
3. Click on rooms or trace the outer boundary of the unit
4. Read the calculated area — it updates in real time

That's it. No account required. No subscription. Nothing to install.

---

## Technical Details

FloorTrace is a browser-based web application. All image processing runs locally using a Web Worker so the page stays responsive while it works. It uses classical computer vision techniques to detect walls and read dimension text from floor plan images. The source code is open and available under the MIT license for anyone who wants to inspect it, modify it, or run their own copy.

### Running Locally (for developers)

```bash
npm install
npm run dev
```

Tests: `npm run test` — Lint: `npm run lint`

---

## License

MIT
