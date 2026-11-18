# Setting up a Philips 65BDL4050Q display

One-time setup per display. It takes about 10 minutes and needs the display's IR remote.

> **Menu names and paths differ between firmware versions.** This guide says _what_ to set;
> look up _where_ in the official **65BDL4050Q user manual** for your firmware
> (philips.com → Professional displays → 65BDL4050Q → Support → User manual).
> Don't rely on menu paths from memory or from other models.

## Before you start

- The **SlideCast server** is running and has a **fixed IP address** (ask IT for a DHCP
  reservation). Below we call it `SERVER` and the port `8080`, e.g. `http://10.20.30.40:8080`.
- From a laptop on the same network, `http://SERVER:8080/admin/` opens the admin UI.
- The display is on the campus network (cable or Wi-Fi). It does **not** need a fixed IP.

## 1. Point the built-in browser at the player

In the display's settings, find the built-in **browser** app (Chromium-based) and set its
start / home URL to:

```
http://SERVER:8080/player
```

## 2. Make the browser the boot source

Set the display's **boot-on source** (the input it shows after power-on) to the browser, so that
after every power cut or scheduled power-on it opens the player by itself.

If the firmware offers a full-screen / kiosk option for the browser, turn it on.

## 3. Pair it

1. Restart the display (or open the browser source). It shows **SlideCast** and a large
   **6-character code**, plus the server address.
2. In the admin UI, log in as **super admin** → **Ekrani / Displays** → **Upari ekran / Pair a display**.
3. Type the code (case and spaces don't matter), choose the **faculty**, a **name**, the
   **location**, and the **orientation** (portrait displays: 90° or 270°).
4. Click **Upari / Pair**. Within a few seconds the display switches to the faculty clock (or
   to its playlist once one is chosen) and shows as **Connected** in the admin UI.

The admin UI also shows a **setup address** (`http://SERVER:8080/player/?token=…`).
Keep it somewhere safe: it is only needed if the display forgets its pairing (see below).

## 4. Choose what it plays

Any user of that faculty can now pick the display's **default playlist** on the Displays page.
With no playlist, the display shows the faculty name and a clock.

## 5. Optional: on/off times

Switching displays on and off is **not** part of SlideCast. If wanted, use the display's own
**on/off timer** (scheduling) settings. After power-on, the browser opens the player again and
it reconnects by itself.

## Troubleshooting

| What you see                                                | What to do                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Spajanje na poslužitelj… / Connecting to server…"          | The display can't reach `SERVER:8080`. Check the network cable/Wi-Fi, the server's IP, and that the server is running.                                                                                                   |
| The display asks for pairing again after every restart      | The browser is not keeping its storage. In the admin UI click **Nova adresa za postavljanje / New setup address** for that display and set _that_ URL (with `?token=…`) as the browser's start URL instead of `/player`. |
| A small red dot in the bottom-right corner                  | The server is unreachable. The display keeps looping what it already loaded and reconnects on its own.                                                                                                                   |
| Content is sideways                                         | Change **Orientation** for the display in the admin UI (super admin → Edit).                                                                                                                                             |
| Black bars / content cut off                                | Change **Fit** (show everything vs. fill the screen) in the display's settings in the admin UI.                                                                                                                          |
| "Greške pri prikazu / Playback errors" on the Displays page | Open it to see which file failed. Videos must be H.264 MP4.                                                                                                                                                              |

## Removing or replacing a display

Super admin → Displays → **Ukloni / Remove**. The display immediately returns to the pairing
screen and can be paired again (for example to another faculty).
