# Windows kiosk setup

The wall may also be an Elo 2402L touch monitor (24 inches, 1920 by 1080, 16:9, an LCD) driven by a Windows PC running Google Chrome in kiosk mode. The screen takes HDMI or DisplayPort for the picture and USB for touch; its touch is projected-capacitive, and Windows' own touch driver works, so no Elo driver is needed. It mounts on a VESA 100 by 100 bracket. Windows owns everything about the screen's behaviour; the app never dims, sleeps or locks anything itself (`docs/PLAN.md`, Home screen).

Do this once per PC, after the production site is deployed (`docs/go-live.md`). The tablet's counterpart is `docs/fully-kiosk.md`.

## Orientation

Settings, System, Display, Display orientation: Landscape, Portrait or Portrait (flipped), as the screen hangs. Touch follows the turn. If a tap lands off, calibrate in Windows' Tablet PC Settings (Control Panel) or in Elo's control panel. The Wall has a form for each (`docs/look.md`, "Portrait" and "A 24-inch screen") and follows the viewport; the app never locks an orientation.

## Scale

Settings, System, Display, Scale: 100 percent, which is the default for this screen. At 100 percent the browser sees 1920 by 1080 in landscape and 1080 by 1920 in portrait, and that is what the Wall is checked at.

## The browser

Use Google Chrome in kiosk mode with its own profile folder. The Device's pairing lives in the browser's site storage, and Edge's kiosk mode (`--kiosk` with either `--edge-kiosk-type`) runs InPrivate and forgets it on every launch.

Make a shortcut whose target is:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --user-data-dir="C:\NidusWall" https://<site>/
```

The address is the production site's root, not `/settings`: the screen only ever sees the wall. Never add `--incognito`. Close every other Chrome window before you start it, or the flags are ignored.

## Starting at sign-in

Put the shortcut in the Startup folder (`shell:startup` in the Run dialog), so the Wall comes back when the PC signs in. Set Windows to sign in without a password prompt (Settings, Accounts, Sign-in options), so a restart returns the Wall with nobody there.

To leave the Wall, press Alt+F4. That is a parent's job.

## Pairing

A screen that is not yet paired shows a Pairing Code. Pair it from a phone as `docs/go-live.md`, step 11, says. The pairing survives restarts only because the profile folder keeps it, so do not delete `C:\NidusWall`.

## Larger text

Chrome's Settings, Appearance, Font size: Large (20 px, 125 percent) grows every rem and keeps the viewport, the same as the tablet's Font size. The Wall holds its layout to 130 percent (`docs/look.md`, "Larger text"); Very large (24 px, 150 percent) is past that.

Zoom (Ctrl and plus, kept per site) shrinks the viewport instead. 125 percent is the ceiling either way (1536 by 864 and 864 by 1536). At 150 percent in portrait the viewport is 720 px wide and the Wall is a phone by its rule (`docs/look.md`, "The phone"); in landscape 1280 by 720 holds two Up next tiles, not three.

## The pointer

Windows hides the pointer while the screen is touched and shows it when a mouse moves. Unplug the mouse when the set-up is done.

## Sleep and night

Settings, System, Power (Power & battery), Screen and sleep: set screen off to Never and sleep to Never while the screen is meant to be lit. The Wall never dims, sleeps or locks anything itself, and dark mode at night is the Household's Appearance and the switch, as on the tablet.

If the household wants the screen dark at night, use the monitor's own power button and menu. Or use Windows' screen timeout with "Touch the screen to wake" (Settings, Bluetooth & devices, Touch) where the hardware offers it; otherwise a tap on the keyboard wakes it. Do not add dimming to the app.

## Reloading and updating

Chrome reloads nothing on its own. A stuck page is a parent's F5 or a restart. There is nothing to install per release: a new deploy shows up on the next load.
