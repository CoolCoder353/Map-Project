# Installing Wayfinder on Android

Wayfinder isn't in the Play Store, so you install it from a file (an APK). This takes about five minutes.

**You need:** an Android phone on **Android 8.0 or newer**, about **400 MB** free, and an **invite code** from whoever runs the server.

The app is set up for **https://maps.paulsjones.com** and covers **Queensland**.

## 1. Get the file onto your phone

The file is `wayfinder.apk` (about 158 MB). Any of these work:

- **USB cable:** plug the phone in, choose *File transfer* on the phone, and copy the file into `Downloads`.
- **Cloud or chat:** put it in Drive, Dropbox or a chat to yourself, then download it on the phone.
- **Email:** most providers block APK attachments, so use one of the above instead.

## 2. Open it and allow installing

1. Open **Files** (or **Downloads**) on the phone and tap **wayfinder.apk**.
2. Android will say something like *"For your security, your phone isn't allowed to install unknown apps from this source"*. Tap **Settings**, turn on **Allow from this source**, then press back.
3. Tap **Install**.
4. Play Protect may warn *"Unsafe app blocked"* or *"App scan recommended"*, because the app isn't from the Play Store. Choose **More details → Install anyway** (or **Install without scanning**).

Android 8 and 9 put the same setting under **Settings → Security → Unknown sources**.

## 3. Sign in

Open **Wayfinder**. The **Server** box is already filled in with `https://maps.paulsjones.com` — leave it as it is.

- **Have an account?** Enter your email and password and tap **Sign in**.
- **New?** Tap **Create an account with an invite code**, paste the code, and pick a password.

No invite code? Ask whoever runs the server; they create codes in the dashboard.

## 4. What the app asks for, and why

Nothing is collected unless you agree to it.

| Permission | When it's asked | What for |
|---|---|---|
| **Location (while using the app)** | First time you view the map | Showing where you are, and navigating |
| **Location (all the time)** | Only if you turn on background tracking | Recording where you've been while the app is closed |
| **Notifications** | First launch | The "recording your travels" notice while tracking runs |
| **Photos** | Only when you attach a screenshot to feedback | Picking that image |

**Background tracking is off until you turn it on.** To use it: **Settings** tab → **Background tracking**. Android asks for "Allow all the time" as a separate step, and the app won't record without it.

For reliable recording, also allow the app to run in the background: **Settings → Apps → Wayfinder → Battery → Unrestricted**. Without this, Android may stop the recording when the screen is off for a long time. On Samsung, Xiaomi, Oppo and OnePlus phones this is often enforced harder, so also exclude Wayfinder from any "battery optimisation" or "sleeping apps" list.

## 5. Everyday use

- **Plan** searches and compares the fastest route with ways you haven't been.
- **Discover** suggests places near you in areas you haven't reached.
- **Coverage** shows the hexagons you've travelled through.
- Routes you send from the website appear under **Settings → Planned routes**.

Routes, search and the map cover **Queensland only**. Ask for another state if you need one.

## Updating later

Install the newer `wayfinder.apk` the same way, straight over the top. Your account, recorded trips and settings stay as they are.

If you see **"App not installed"** while updating, the new file was signed with a different key than the installed app. Uninstall Wayfinder first, then install the new file. You'll sign in again, and anything not yet uploaded is lost — so sync first (**Settings → Sync now**).

## If something doesn't work

**"App not installed" on a first install** — usually not enough free space, or a part-downloaded file. Free some space and copy the file again.

**"Can't reach the server" / "No connection to the server"** — check the phone has internet, and that the **Server** box reads exactly `https://maps.paulsjones.com`.

**"There is no road or path near your start"** — you (or the destination) are outside Queensland, or too far from a mapped road.

**The map is blank but routes work** — usually a slow first load of map tiles; reopen the app. If it persists, tell the server admin.

**Recording stops when the screen is off** — the battery settings in step 4 haven't been applied, or "Allow all the time" wasn't granted.

**Nothing uploads** — open **Settings**: it shows how many points are waiting, and **Sync now** uploads them.

## Removing it

**Settings → Apps → Wayfinder → Uninstall** removes the app and everything it stored on the phone. That does not delete your account or your trips on the server: to do that, use **Settings → Delete my account** on the website, or ask an admin.
