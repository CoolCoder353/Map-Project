# Play Console changes for the 2026-10-26 server move

The live server's address changed from `https://maps.paulsjones.com` to
`https://maps.coolcodertech.com`. The server and its data are the same; only the way in changed
(a Cloudflare Tunnel in place of the home router and nginx proxy). The old address goes away at
cut-over, so every place Play Console holds it has to change first. The repo files
([details.json](details.json), [console-answers.md](console-answers.md)) already say the new
address.

Tick each line when it's done in Play Console for **Wayfinder** (`app.wayfinder.maps`).

**Done 2026-10-26:** items 1, 2, 3, 5, 6 and 7. The website was published straight away (contact
details skip review). The privacy policy URL, the Data safety form's deletion URL and 0.5.1
(versionCode 7, on the closed and internal tracks with the release notes below) went to review
together, in place of the first submission (versionCode 5, old address) that was still in review.
The WAF items below are still open, so the review may fail on Google's URL check.

## Before anything else: let Google reach the pages

- [ ] **Cloudflare WAF, not Play Console.** The block rule lets in Australian visitors only.
      Google's reviewers and URL checkers are mostly outside Australia, so Play would see the
      privacy policy and deletion page as broken. Add this to the block rule's expression:
      `and not http.request.uri.path in {"/privacy" "/delete-account"}`.
      Check from outside Australia (a VPN, or a URL checker) that both pages load.
- [ ] **Decide about reviewers testing the app.** The rule above still blocks the app's own
      requests (sign-in, maps, search) from outside Australia, so a reviewer signing in with the
      reviewer account from the US gets "Can't reach". Either let the reviewer through (for example
      skip the rule for `/api/*` too, or for Google's ranges), or expect a rejection on App access.
      This is a separate decision from the pages.

## Change in Play Console

| # | Where in Play Console | Field | Old | New | How |
|---|---|---|---|---|---|
| 1 | Grow users → Store presence → Store settings → Store listing contact details | Website | `https://maps.paulsjones.com` | `https://maps.coolcodertech.com` | `pnpm play listing` sends it from `details.json` (or type it in) |
| 2 | Policy and programs → App content → Privacy policy | Privacy policy URL | `https://maps.paulsjones.com/privacy` | `https://maps.coolcodertech.com/privacy` | By hand; not in Play's API |
| 3 | Policy and programs → App content → Data safety → Data deletion | "Delete account URL" | `https://maps.paulsjones.com/delete-account` | `https://maps.coolcodertech.com/delete-account` | By hand; then **Save** and submit the Data safety form again |
| 4 | Policy and programs → App content → App access | Instructions ("Other information") | Unchanged text | No change needed | The notes say "the server address is already filled in", which is true for a build made for the new address (item 5) |
| 5 | Test and release → Testing (internal / closed) | New release | Bundles up to versionCode 6 are built for the old address | Upload `dist/wayfinder.aab` 0.5.1 (versionCode 7), built with `EXPO_PUBLIC_API_URL=https://maps.coolcodertech.com` | `pnpm play upload` ([play-store-android-auto.md](../../docs/play-store-android-auto.md#publishing-from-this-machine)) |
| 6 | Same release | Release notes | — | "Points at the server's new address. If you signed in before, you stay signed in." | With the upload |
| 7 | Publishing overview | Send changes for review | — | Send items 2, 3 and 5 together | Managed publishing is off, so `pnpm play upload` sends everything saved for review when it commits (`--no-review` is refused) |

## Not affected

- Contact email (`WeaponryAndResourcesGame@gmail.com`), app name, descriptions, graphics and
  screenshots: none name the address. The screenshots show the app, not the address.
- The background location video (`background-location.mp4`) shows Settings, not the address.
- The package name, upload key and Play App Signing: unchanged.
- The reviewer account: it lives in the server's database, which did not move, so the same
  username and password work at the new address.

## After it's live

- Keep the old address running until testers have the new build: a phone with versionCode 6 or
  older still talks to `maps.paulsjones.com`. Version 0.5.1 moves a saved old address to the new
  one by itself and keeps the sign-in.
- Once the old address is retired, a Play install of an old build can't reach anything. Halt or
  replace any release older than versionCode 7 on every track.
