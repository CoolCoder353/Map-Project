# Play Console answers

What to type into each Play Console form for **Wayfinder** (`app.wayfinder.maps`). Drafted
2026-10-02 from the code. Re-check anything marked _check_ against the current build before
submitting. The plan and status are in
[docs/play-store-android-auto.md](../../docs/play-store-android-auto.md).

## Store listing

- **App name:** Wayfinder
- **Short description (80 max):** Maps that show the roads you haven't driven yet, and routes to explore them.
- **Full description:**

  > Wayfinder is a map for people who like to explore. It remembers the roads you've travelled and
  > points you to the ones you haven't.
  >
  > • Turn-by-turn directions on your phone and in your car through Android Auto
  > • Explore routes: a slightly longer way that takes in new roads
  > • Discover nearby places in areas you haven't been
  > • See the roads you've covered and replay past trips
  > • Spoken directions with lane-level turn icons and roundabout exits
  >
  > Your trips stay on the group's own server. Routing, maps and search all run there, with no
  > ads and no outside tracking. Recording trips in the background is off until you turn it on.
  >
  > Wayfinder is invite-only: you need an invite code from the group running your server.
  > Maps currently cover Queensland, Australia.
  >
  > Map data © OpenStreetMap contributors.

- **Category:** Maps & Navigation. **Tags:** Navigation, Maps.
- **Contact email:** googledev@gmail.com (Play shows it publicly; the privacy page uses it too).
- **Privacy policy URL:** `https://maps.paulsjones.com/privacy`
- **Graphics:** `store/play/icon-512.png`, `store/play/feature-graphic.png`. Phone screenshots
  (2 to 8) and Android Auto screenshots are still to take ([README.md](README.md)).

## App access (reviewer sign-in)

Choose **All or some functionality is restricted** and add one instruction set:

- **Name:** Reviewer account
- **Username / password:** from `infra/android/play-review.env` (on the build machine, not in git).
  The account is a normal user on the live server.
- **Other information:** paste the reviewer notes below.

### Reviewer notes

> Sign in with the account provided; the server address is already filled in. Maps, routing and
> search cover Queensland, Australia only. Outside Queensland, set a mock location (Developer
> options → Select mock location app) to Brisbane, for example −27.4698, 153.0251, then search
> for "Mt Coot-tha Lookout" or "South Bank" and tap Go.
>
> Android Auto: open Wayfinder from the launcher. With a mock location in Brisbane, search for a
> place while parked, choose a route and press Go. To see navigation without driving, start the
> Desktop Head Unit's auto drive (or run "adb shell dumpsys activity service
> app.wayfinder.car.WayfinderCarAppService AUTO_DRIVE"). This runs a short simulated trip anywhere
> and records nothing.
>
> Background location is optional: Settings → Location history → Background tracking. It is used only to record which
> roads the user has travelled, so the app can suggest roads they haven't.

## Ads

No, the app contains no ads.

## Content rating (IARC questionnaire)

- Category: **Reference, News, or Educational**. If asked, it is a navigation utility.
- Violence, sexuality, language, controlled substances, gambling: **No** to all.
- Users can interact or exchange content with each other: **No**. Feedback goes to the server's admins only.
- Shares the user's current location with other users: **No**.
- Digital purchases: **No**.

Expected rating: Everyone / PEGI 3.

## Target audience and content

- Target age: **18 and over** (it is a driving app, and this avoids the Families policy).
- Appeals to children: **No**.

## Data safety

Data is encrypted in transit: **Yes**. Users can request deletion: **Yes** (in the app, and at
`https://maps.paulsjones.com/delete-account`). Data is shared with third parties: **No**.

| Data type                       | Collected      | Optional?                                              | Purpose                            | Notes                                                                                                                                                  |
| ------------------------------- | -------------- | ------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Location: precise               | Yes            | Required for navigation; background recording optional | App functionality, Personalization | Trip points uploaded to the group's server                                                                                                             |
| Location: approximate           | Yes            | Same                                                   | App functionality                  | Implied by precise                                                                                                                                     |
| Personal info: email address    | Yes            | Required                                               | Account management                 | Sign-in                                                                                                                                                |
| App activity: other actions     | Yes            | Required                                               | App functionality                  | Trip history, planned routes, coverage                                                                                                                 |
| App info and performance: other | Yes            | Optional                                               | App functionality                  | App version, device model and screen sent with a feedback report                                                                                       |
| Photos                          | Yes            | Optional                                               | App functionality                  | A screenshot the user chooses to attach to feedback                                                                                                    |
| Messages: other in-app messages | Yes            | Optional                                               | App functionality                  | Feedback text                                                                                                                                          |
| Contacts                        | Yes, ephemeral | Optional (contact search is opt-in)                    | App functionality                  | Names are matched on the phone; only the address of the one contact picked is sent to our search, which doesn't store it. Tick "processed ephemerally" |

Collected data is **not** processed ephemerally (it is stored).

## Sensitive permissions

### Location permissions (background location declaration)

- **Core feature that needs background location:** Recording the roads the user travels so the app
  can show which roads they have and haven't driven, and suggest new ones. Without background
  access, trips are only recorded while the app is on screen, so most drives would be missed.
- **Is it the main purpose of the app?** Yes. Coverage of roads travelled is the app's core feature.
- **Video (YouTube, unlisted, under 30 s):** Settings → Location history → Background tracking →
  the in-app "Use your location in the background?" dialog → Continue → "Allow all the time" in the system dialog → the ongoing "Wayfinder is recording your
  travels" notification while driving.
- **In-app disclosure:** "Use your location in the background?", shown before every system
  prompt, naming location, collection when the app is closed, the purpose, and how to turn it off
  (`apps/mobile/src/tracking/disclosure.ts`).

### Foreground service types

- `location`. **Task:** navigation with turn-by-turn directions, and recording a trip the user
  turned on. **User-visible:** an ongoing notification for as long as it runs. **Impact if
  deferred:** directions stop and the trip's route is lost.

### Health, contacts, photos

- Contacts: read-only and opt-in, used to find an address saved with a contact. No declaration is
  needed for `READ_CONTACTS` beyond the data safety entry.
- Photos: the system photo picker, so no permission is needed.

## Advanced settings → Form factors → Android Auto

Add **Android Auto** after the first bundle is on a testing track. The review is non-blocking on
closed testing and blocking on open testing and production. The car app declares the navigation
category and template-only rendering.

## Countries

Australia. Adding the United States does not help reviewers (the maps cover Queensland) and lists
an app that can't route there.

## Government apps, financial features, health, news

None apply. Answer **No** to each.
