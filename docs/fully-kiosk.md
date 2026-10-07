# Fully Kiosk Browser setup

The wall is an Android tablet, a Lenovo Tab P12 (12.7 inches, 2944 by 1840, 16:10, an LCD), running [Fully Kiosk Browser](https://www.fully-kiosk.com/). Fully Kiosk owns everything about the screen's behaviour; the app never dims, sleeps or locks anything itself (`docs/PLAN.md`, Home screen).

Do this once per tablet, after the production site is deployed (`docs/go-live.md`).

## Start URL

Settings, Web Content Settings, Start URL: the production site's root, for example `https://nidus.example.app/`. The root, not `/settings`: the tablet only ever sees the wall. A tablet that is not yet paired shows a Pairing Code there; pairing is done from a phone (`docs/go-live.md`, last step).

Turn on Reload on Internet Reconnect, and set Auto Reload on Idle to a few hours as a safety net. The wall reconnects on its own, but a stuck page is cheaper to reload than to diagnose.

## Orientation

Settings, Device Management, Screen Orientation: Landscape or Portrait, as the tablet hangs. The Wall has a form for each (`docs/look.md`, "Portrait") and follows the viewport; the app never locks an orientation itself, so Auto works too, though a tablet on a wall is better locked.

## Display size and font size

Leave the tablet's Display size (Android Settings, Display) at the default: it sets the device pixel ratio, and the default (near 1.7 on the P12, so about 1730 by 1080 CSS px in landscape and 1080 by 1730 in portrait) is what the Wall is checked at. Use the tablet's Font size for larger text: the Wall grows every rem with it and holds its layout to 130 percent (`docs/look.md`, "Larger text").

## No app-side dimming

Nidus has no dimming, screensaver or night mode of its own. Night dimming and the screensaver belong to Fully Kiosk:

- Settings, Device Management, Screen Brightness: set a day level, and use Screen Off Timer or Screensaver for the night.
- Settings, Motion Detection (Visual or Acoustic), or the tablet's own schedule, wakes the screen when someone walks in.
- Keep Screen On: on while the screen is meant to be lit.

Do not add a dimming overlay or brightness setting to the app.

## Kiosk mode

Settings, Kiosk Mode: turn on Kiosk Mode, so the address bar, navigation and the tablet's own system bars stay out of the way. Set a Kiosk Exit PIN so only a parent can leave it.

## Installing and updating

Fully Kiosk loads the site like any browser, so there is nothing to install per release: a new deploy shows up on the next reload.
