# Getting Wayfinder onto Google Play, with Android Auto

Started 2026-10-02. Google's name for what Apple calls CarPlay is **Android Auto**. Wayfinder's car
app is a Car App Library navigation app (`apps/mobile/modules/wayfinder-car`). Android Auto lists
only apps Google Play installed, so approval means: get the app onto Play, opt in to the Android
Auto form factor, and pass Google's car app review. Today the app is shared as an APK
([build-android.md](build-android.md)) and isn't on Play at all.

Sources: [Distribute to cars](https://developer.android.com/training/cars/distribute),
[Car app quality](https://developer.android.com/docs/quality-guidelines/car-app-quality), checked
2026-10-02. Re-read them before submitting; Play's rules change.

## What Play does at each track

| Track            | Android Auto review | Notes                                                          |
| ---------------- | ------------------- | -------------------------------------------------------------- |
| Internal testing | None                | Where to start. Testers install from Play and see the car app. |
| Closed testing   | Runs, non-blocking  | Review results arrive by email; the release is not held up.    |
| Open testing     | **Blocks**          | Needs Tier 2 (Car Optimized) quality.                          |
| Production       | **Blocks**          | Same.                                                          |

A new personal developer account must also run a closed test with 12 testers for 14 days before it
can apply for production access. An organisation account does not.

## Status

| Step                                                                          | Who                | State                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Car app uses `CarAppService`, NAVIGATION category, template-only              | done               | Manifest in `modules/wayfinder-car/android/src/main/AndroidManifest.xml`                                                                                                                                                                                       |
| `com.google.android.gms.car.application` metadata + `automotive_app_desc.xml` | done               | Declares `template`                                                                                                                                                                                                                                            |
| Target SDK 36                                                                 | done               | Confirmed in the built manifest                                                                                                                                                                                                                                |
| Quality gaps NF-3, NF-6, NF-7, VC-1, EP-2 fixed                               | done               | [quality-gaps.md](quality-gaps.md); only checked by tests, not on a head unit                                                                                                                                                                                  |
| Run the Android Auto checklist on a Desktop Head Unit                         | open               | [verification.md](verification.md#android-auto-desktop-head-unit): nothing ticked yet. Do this before open testing                                                                                                                                             |
| Remaining car items: DR-2/DR-3 launch time, NF-5, NF-2                        | open               | Need a head unit to measure                                                                                                                                                                                                                                    |
| **Play Console developer account** ($25, identity check)                      | **you**            | Not started                                                                                                                                                                                                                                                    |
| Build an Android App Bundle (.aab)                                            | done               | `build-apk.sh` now also runs `bundleRelease` and writes `dist/wayfinder.aab`; version 0.4.0 / versionCode 5. Not yet built                                                                                                                                     |
| **Play App Signing / upload key**                                             | you                | Enrol in Play App Signing. The current `infra/android/release.keystore` can become the upload key; keep it backed up                                                                                                                                           |
| **Server address baked in**                                                   | decision           | A Play build points at `https://maps.paulsjones.com`. Reviewers need to reach it, so it must stay up                                                                                                                                                           |
| Privacy policy at a public URL                                                | done               | `https://maps.paulsjones.com/privacy` (web `PrivacyPage`, no sign-in; Settings in the app opens it). Contact is `googledev@gmail.com`                                                                                                                          |
| Account deletion web page                                                     | done               | `https://maps.paulsjones.com/delete-account`, linked from the privacy page. Android Settings now also has Delete account. Live after the next web deploy                                                                                                       |
| Data safety form                                                              | you                | Answers below                                                                                                                                                                                                                                                  |
| Background location declaration + demo video                                  | you                | Answers below. Play reviews this separately and it is the likeliest rejection                                                                                                                                                                                  |
| Foreground service (location) declaration                                     | you                | Declared in the manifest; Play asks what it does                                                                                                                                                                                                               |
| Test account for reviewers (App access)                                       | you                | Required for navigation apps. Create a throwaway user on the live server, not admin                                                                                                                                                                            |
| Reviewer location                                                             | decided 2026-10-02 | Reviewers set a mock location in Brisbane (reviewer notes in store/play/console-answers.md), and the app is listed in Australia only. If the Android Auto review rejects it for not working outside Queensland, build a demo location for the reviewer account |
| Store listing text, icon, feature graphic, phone screenshots                  | you                | None made yet                                                                                                                                                                                                                                                  |
| Android Auto screenshots                                                      | you                | Take from the DHU; no OEM branding                                                                                                                                                                                                                             |
| Content rating questionnaire, target audience, ads declaration                | you                | App is for a private group; no ads                                                                                                                                                                                                                             |
| Opt in to Android Auto in Play Console                                        | you                | Advanced settings, Form factors, Add form factor, Android Auto, after a bundle is on a track                                                                                                                                                                   |

## Order of work

1. **Code, in this repo** (written and tested; deploy the web app and build the bundle):
   - The build script also writes `dist/wayfinder.aab` ([build-android.md](build-android.md)).
   - Privacy policy and account deletion pages (public, web app), linked from Settings.
   - Version 0.4.0, versionCode 5 in `apps/mobile/app.config.ts` for the first Play build.
2. **Head unit pass.** Install the release APK on a phone, run the DHU, tick the verification.md checklist, fix failures with tests.
3. **Console setup.** Create the developer account, the app (`app.wayfinder.maps`, which can never change once uploaded), the store listing and the declarations.
4. **Internal testing.** Upload the bundle, add testers, confirm the app shows in Android Auto from a Play install.
5. **Closed testing.** Opt in to Android Auto; collect the non-blocking review result and fix what it names. For a personal account, this is also the 12-testers-for-14-days step.
6. **Open testing or production.** Blocking review. Fix anything it rejects, remove the rejected artifact, resubmit.

## Answers for the Play forms (from the code)

- **Location, precise, collected:** yes. Used for navigation and for recording roads travelled to suggest unexplored ones.
- **Background location:** the core feature is recording trips so coverage counts roads travelled. Off until the user turns it on in Settings, with a foreground notification while running. Needs a short screen recording showing the Settings switch, the permission prompt and the notification.
- **Contacts:** read only, only when the user turns on contact search, never uploaded as a list. Addresses are looked up on the phone.
- **Photos:** the system photo picker, for feedback screenshots only.
- **Data sent to our server:** account email, trip points, trip history, feedback. **Nothing to third parties:** routing, tiles and search all run on our server (CLAUDE.md rule).
- **Encryption in transit:** yes, cleartext is off in release builds.
- **Deletion:** users can export and delete their account in Settings ([operations.md](operations.md#data-and-privacy)). Android Settings has **Delete account** too (email typed to confirm, same 7-day restore). Play's web deletion page is `/delete-account`; enter `https://maps.paulsjones.com/delete-account` in the Data safety form.
- **Permissions to justify:** `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`.

## Things that will bite

- An invite-only app with sign-in is fine, but reviewers must be able to register or use the test account on the live server.
- Play may ask why a navigation app records location while not navigating. The answer above is the one to give; do not describe the feature as "tracking".
- Package name `app.wayfinder.maps` and the upload key are permanent. Decide on the app name shown on Play (`APP_DISPLAY_NAME`) first.
- The car app declares `minCarApiLevel` 1 and templates only, which keeps it compatible but means no custom map on the cluster (Tier 1, NF-9 in quality-gaps.md). Not needed for approval.
