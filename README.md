# Pepper's ghost portal: phases 1 and 2

Oppo K10 (`/send`) streams live video peer-to-peer (WebRTC) to the iPhone (`/view`).
The Worker + Durable Object only passes signaling messages; video never touches Cloudflare.

## Run it

```bash
npm install
npx wrangler login        # once
npx wrangler deploy       # gives you https://pepper-portal.<you>.workers.dev
```

Phone cameras need HTTPS, so test on the deployed URL (not http://192.168.x.x).

1. Open the URL on both phones, pick a room code (it's remembered).
2. iPhone: **Hologram**, tap Start. Then Share → Add to Home Screen and reopen from there for fullscreen.
3. Oppo: **Send**, tap Start. The hologram page goes live within a second or two.

## Calibrating the optics (iPhone, tap the faint ⚙ top-left)

1. **Test pattern** + **Show frame**: a ring, a block at the top-left and a bar at the bottom. Use this to see how the pane flips things.
2. **Flip X / Flip Y / Rotate** until the pattern reads correctly in the reflection (the block should appear at the top-left of what you see in the pane).
3. **Frame width/height/X/Y**: move the green frame to the area of the screen that actually reflects into the pane (about 70×90 mm at 45°).
4. **Black cut / White point / Gamma**: raise Black cut until the background inside the box is pure black. Anything black is invisible in the pane.
Settings are saved on the phone.

## Object-only mode (project only the marked object)

Stick a piece of **bright coloured paper** (magenta or green, nothing like your room) on the object, on a side that faces away from the pane. Clear tape can't be seen by a camera, so it can't be used. Then, on the iPhone's ⚙ panel:

1. Lock exposure on the Oppo, then **1 · Capture empty** with nothing in the picture (3 s countdown).
2. **2 · Sample paper**: hold the paper in the middle of the picture during the countdown.
3. Put the object in. Only the changed region that touches the paper is shown, and everything else stays black. The paper itself is blanked (toggle **Hide paper**).
- **Mask debug** shows changed pixels in red and paper in green over a dim video, which is handy for tuning **Change thresh.**, the paper hue/saturation sliders, and **Edge grow**.
- Recapture the empty scene if the lighting or camera moves. If the paper is hidden by your hand, the last mask is kept for "Keep if paper lost" seconds.

## Sender tips

- **Light** = torch (Android Chrome only if the camera exposes it). Use it as your light while the strip is broken.
- **Lock exposure / Lock white bal.** stop the black backdrop from "breathing" when your hand enters. Lock after the box is lit and empty.
- **Exposure** slider lowers brightness so the background drops toward black.
- **Blackout screen** keeps the Oppo's own screen from lighting up the box. Tap to wake.

## Optional: TURN fallback

If the phones can't connect (some routers isolate Wi-Fi clients), create a TURN key in the Cloudflare dashboard (Realtime → TURN) and run:

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_API_TOKEN
```

`/ice` then returns TURN credentials automatically. (Not tested against the live API.)

## Files

- `src/index.js`: Worker + `Room` Durable Object (hibernating WebSocket relay, `/ice`)
- `public/send.html`: camera page
- `public/view.html`: WebGL viewer (black crush, flip/rotate, frame, zoom/pan)
- `public/index.html`: room code launcher
