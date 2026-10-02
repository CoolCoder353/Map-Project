import { Link } from 'react-router';
import { useAppConfig } from '../lib/config';
import { DocPage, PRIVACY_CONTACT } from './DocPage';

export function PrivacyPage() {
  const { config } = useAppConfig();
  const app = config.appName;
  return (
    <DocPage title="Privacy policy" updated="2 October 2026">
      <p>
        {app} is a maps app for a small group of friends, run on one server by the people who invite you. This page says what it
        keeps about you, why, and how to get rid of it. It covers the website and the Android app.
      </p>

      <h2>What we keep</h2>
      <ul>
        <li><strong>Your account:</strong> your email address and your password (stored scrambled, never readable).</li>
        <li>
          <strong>Where you go:</strong> while you are navigating, the app uses your precise location to guide you and records the
          route. If you switch on <em>Background tracking</em> in Settings, the app also records your location when it is closed or in
          your pocket, to work out which roads you have travelled. Android shows a notification the whole time this is on. It is off
          until you turn it on, and you can turn it off at any time.
        </li>
        <li><strong>Your trips and coverage:</strong> the trips you have recorded, with their location points and times, and the roads travelled that are worked out from them.</li>
        <li>
          <strong>Your plans:</strong> routes you plan on the website and send to your phone, and your settings (travel mode, how far
          out of the way an explore route may go).
        </li>
        <li>
          <strong>Feedback you send:</strong> your message, the screen you were on, the app version and your phone model, and a
          screenshot only if you pick one yourself from your photo picker. We cannot see any other photos.
        </li>
      </ul>

      <h2>Your contacts</h2>
      <p>
        If you turn on <em>Search my contacts</em> in Settings, the phone asks to let the app read your contacts. When you type a
        name in a search box, the app looks through your contacts on the phone for matching names and shows their saved addresses.
        Your contacts are never uploaded as a list. Only when you pick one does the app send that one address, as text, to our server
        so it can be found on the map. The server searches for it like any other address, and the contact&rsquo;s name is not sent. If
        you leave the switch off, the app never reads your contacts.
      </p>

      <h2>Who else sees it</h2>
      <p>
        Nobody outside the server. Routing, map tiles and place search all run on our own server, so where you are is not passed to
        a map company, an advertiser or anyone else. The only outside download is the public OpenStreetMap data the map is built
        from. There are no ads and no analytics or tracking tools in the app or the website.
      </p>
      <p>
        The people who run the server can see accounts and, to help with problems, trips and feedback. Every time an administrator
        looks at someone else&rsquo;s data it is written to a log that cannot be edited; that log keeps only the fact that they looked, not your data. Logs and error reports do not hold
        coordinates, passwords or email addresses.
      </p>

      <h2>How it is protected</h2>
      <p>Everything between your device and the server travels over HTTPS. The app keeps its sign-in in the phone&rsquo;s secure storage.</p>

      <h2>Your choices</h2>
      <ul>
        <li><strong>See it:</strong> Settings on the website, <em>Download my data</em>, gives you everything stored about you as a file.</li>
        <li>
          <strong>Delete it:</strong> <em>Delete account</em> in Settings, on the website or in the Android app. See{' '}
          <Link to="/delete-account">how to delete your account</Link>. Your account is kept for 7 days in case you change your mind
          and an administrator can restore it. After that, your account, trips, coverage, planned routes and feedback are permanently removed.
        </li>
        <li><strong>Stop recording:</strong> turn off <em>Background tracking</em> in Settings, or remove Location permission from the app in your phone&rsquo;s settings.</li>
        <li><strong>Remove a trip:</strong> delete it from your trips list. It can be restored for 7 days, then it is permanently removed.</li>
      </ul>

      <h2>Questions</h2>
      <p>
        Write to <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>. If this page changes in a way that matters, the date at
        the top changes too.
      </p>
    </DocPage>
  );
}
