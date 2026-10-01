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
| **Contacts** | Only if you turn on contacts search | Finding a contact's saved address when you type their name |

**Searching your contacts is off until you turn it on.** With it on (**Settings → Search my contacts**), typing a contact's name offers their saved address. Contacts are read on the phone; only the address of the one you pick is sent to the server, to be located.

**Background tracking is off until you turn it on.** To use it: **Settings** tab → **Background tracking**. Android asks for "Allow all the time" as a separate step, and the app won't record without it.

For reliable recording, also allow the app to run in the background: **Settings → Apps → Wayfinder → Battery → Unrestricted**. Without this, Android may stop the recording when the screen is off for a long time. On Samsung, Xiaomi, Oppo and OnePlus phones this is often enforced harder, so also exclude Wayfinder from any "battery optimisation" or "sleeping apps" list.

## 5. Everyday use

- **Plan** searches and compares the fastest route with ways you haven't been.
- **Discover** suggests places near you in areas you haven't reached.
- **Coverage** shows the roads you've travelled.
- Routes you send from the website appear under **Settings → Planned routes**.

Routes, search and the map cover **Queensland only**. Ask for another state if you need one.

## 6. Android Auto

Wayfinder works on a car screen through Android Auto. Because it isn't from the Play Store,
Android Auto hides it until you allow it once:

1. On the phone, open **Settings → Connected devices → Connection preferences → Android Auto**
   (or search Settings for "Android Auto").
2. Scroll to the bottom and tap **Version** ten times, then **OK** to turn on developer settings.
3. Open the **⋮** menu → **Developer settings**, and turn on **Unknown sources**.
4. Connect to the car. Wayfinder is in the car's app list.

In the car you can search (while parked), pick a planned route, find places nearby you haven't
explored, choose between the fastest route and new ways, and follow directions. Directions keep
going with the phone locked. Start a trip on the phone and the car shows it too.

Android Auto updates occasionally turn **Unknown sources** off again; if Wayfinder disappears
from the car, repeat step 3.

## Updating later

Install the newer `wayfinder.apk` the same way, straight over the top. Your account, recorded trips and settings stay as they are.

If you see **"App not installed"** while updating, the new file was signed with a different key than the installed app. Uninstall Wayfinder first, then install the new file. You'll sign in again, and anything not yet uploaded is lost — so sync first (**Settings → Sync now**).

## If something doesn't work

**"App not installed" on a first install** — usually not enough free space, or a part-downloaded file. Free some space and copy the file again.

**"Can't reach …"** — the message names the address the app tried. If it isn't
`maps.paulsjones.com`, the app is pointed at the wrong server: sign out, correct the **Server**
box on the sign-in screen, and sign in again. (Signed in, the address is shown at the top of
**Settings**.) If the address is right, check the phone has internet.

**"No server address set"** — the file you installed was built without a server address. Ask for
a corrected APK rather than typing an address you aren't sure of.

**"There is no road or path near your start"** — you (or the destination) are outside Queensland, or too far from a mapped road.

**The map is blank but routes work** — usually a slow first load of map tiles; reopen the app. If it persists, tell the server admin.

**Recording stops when the screen is off** — the battery settings in step 4 haven't been applied, or "Allow all the time" wasn't granted.

**Nothing uploads** — open **Settings**: it shows how many points are waiting, and **Sync now** uploads them.

## Removing it

**Settings → Apps → Wayfinder → Uninstall** removes the app and everything it stored on the phone. That does not delete your account or your trips on the server: to do that, use **Settings → Delete my account** on the website, or ask an admin.
