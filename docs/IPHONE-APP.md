# The iPhone app

The site is also an iPhone app. It is the same code, packaged with
[Capacitor](https://capacitorjs.com) into an Xcode project in `ios/`. Everything on the
website works in the app, with these differences:

- **No local proxy.** The app sends your signed Coinbase requests to `api.coinbase.com`
  itself, so you don't run `node cors-proxy.js` for the phone.
- **Your Coinbase key, Twelve Data key and paper account are separate** from the
  website's, because each device keeps its own. Enter the keys again in the app.
- **It only runs while it is open on screen.** iPhone pauses apps in the background, so
  the desk and automatic trading stop when you leave the app or the phone locks. The app
  keeps the screen on while it is open (switch on the Live page). For automatic trading,
  leave the phone on a charger with the app open.
- **Run automatic trading in one place only**, either the phone or the website. Each
  keeps its own records, so running both would place every trade twice.
- **Use a Coinbase key without an IP allowlist.** A phone on mobile data changes IP
  address all the time.
- **Phone alerts** still come through the free ntfy app. Tapping an alert opens this app
  on the right page.
- **Sign in with email or `Admin`.** The Google/Apple buttons are hidden in the app,
  because those sign-in pages can't return to the app.

## Getting it onto your iPhone

Apple only lets apps onto an iPhone through Xcode (on a Mac), TestFlight or the App
Store. All three need the app to be built and signed with an Apple account.

### Option A: from a Mac with Xcode (free Apple ID works)

You need a Mac with **Xcode 26 or newer** (free in the Mac App Store), **Node.js 22 or
newer** ([nodejs.org](https://nodejs.org)), and a USB cable for the iPhone.

1. Get the code onto the Mac (GitHub → Code → Download ZIP, or `git clone`), and open
   Terminal in that folder.
2. Run:
   ```
   npm install
   npm run ios:open
   ```
   This builds the app's files, copies them into the Xcode project and opens Xcode.
3. In Xcode, click **App** in the left sidebar → **Signing & Capabilities** → **Team** →
   *Add an Account…* and sign in with your Apple ID. Pick that team.
   If Xcode says the bundle identifier is taken, change `com.prometheaprograms.trader` to
   something unique, e.g. `com.yourname.promethea`.
4. Plug in the iPhone and tap **Trust** on it. On the iPhone, turn on
   **Settings → Privacy & Security → Developer Mode** (it restarts).
5. Pick your iPhone in the device menu at the top of Xcode and press **Run (▶)**.
6. With a free Apple ID the first launch is blocked until you allow it: on the iPhone,
   **Settings → General → VPN & Device Management → your Apple ID → Trust**.

With a **free Apple ID the app stops opening after 7 days.** Plug the phone in and press
Run again to renew it. With a paid Apple Developer account ($99/year) it lasts a year.

**After the site changes:** download the new code, then `npm install` and
`npm run ios:open`, and press Run again.

### Option B: TestFlight (paid Apple Developer account)

TestFlight installs the app like a normal App Store app, from Apple's TestFlight app on
the iPhone, with no cable and no 7-day limit (each build lasts 90 days). It needs the
Apple Developer Program ($99/year) and one upload from Xcode: **Product → Archive →
Distribute App → TestFlight & App Store**. In
[App Store Connect](https://appstoreconnect.apple.com), first create the app
(**Apps → + → New App**, same bundle identifier). Then add yourself as an internal tester
under **TestFlight** and install it from the TestFlight app. Internal testing (up to 100
people on your team) does not need Apple's review.

### What about the public App Store?

It is possible to submit, but Apple is likely to reject this app as it is:

- **Guideline 5.1.1(ix):** apps offering financial services such as trading must be
  submitted by a company, not an individual developer account.
- **Guideline 3.1.5:** crypto trading apps are held to licensing rules.
- **Guideline 4.2:** apps that are mainly a website in an app wrapper can be rejected.
- **Guideline 3.1.1:** a paid subscription sold inside the app has to use Apple's in-app
  purchase, not a Stripe link.

For an app only you (and a few people you invite) use, Option A or B is the way.

## For developers

| Command | What it does |
| --- | --- |
| `npm run build` | Website build → `dist/` (GitHub Pages, served from `/Website/`) |
| `npm run build:ios` | App build → `dist-ios/` (relative paths for the app bundle) |
| `npm run ios:sync` | `build:ios` + copy into `ios/` and update the plugin list |
| `npm run ios:open` | `ios:sync` + open the project in Xcode (Mac only) |

- App-only code is in `src/lib/platform.js` (`IS_NATIVE`, `nativeRequest`, `pageLink`)
  and `src/lib/nativeApp.js` (app links, keep-awake, resume). Plugins: `@capacitor/app`,
  `@capacitor-community/keep-awake`.
- The generated web files (`ios/App/App/public`, `ios/App/App/capacitor.config.json`) are
  not committed. Run `npm run ios:sync` before building in Xcode.
- `.github/workflows/ios.yml` builds the app on GitHub's Macs and runs it in the iOS
  Simulator with a self-test (`src/lib/nativeSelfTest.js`, only in builds made with
  `VITE_NATIVE_SELFTEST=1`). Screenshots and the app's console log are under the run's
  **Artifacts**. To run the same check on a Mac:
  ```
  VITE_NATIVE_SELFTEST=1 npm run build:ios && npx cap sync ios
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath build/dd CODE_SIGNING_ALLOWED=NO build
  scripts/ios-simulator-test.sh build/dd/Build/Products/Debug-iphonesimulator/App.app
  ```
