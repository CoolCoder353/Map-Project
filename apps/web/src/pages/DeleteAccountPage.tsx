import { Link } from 'react-router';
import { useAppConfig } from '../lib/config';
import { DocPage, PRIVACY_CONTACT } from './DocPage';

export function DeleteAccountPage() {
  const { config } = useAppConfig();
  const app = config.appName;
  return (
    <DocPage title="Delete your account">
      <p>You can delete your {app} account yourself, on the website or in the Android app. It takes a minute.</p>

      <h2>On the website</h2>
      <ol>
        <li><Link to="/settings">Sign in and open Settings</Link>. If you are not signed in, you are asked to, then brought straight back.</li>
        <li>Scroll to <strong>Delete account</strong> and choose <strong>Delete my account</strong>.</li>
        <li>Type your email address to confirm, then choose <strong>Delete account</strong>.</li>
      </ol>

      <h2>In the Android app</h2>
      <ol>
        <li>Open <strong>Settings</strong> and scroll to the bottom.</li>
        <li>Choose <strong>Delete account</strong>.</li>
        <li>Type your email address to confirm, then choose <strong>Delete my account</strong>. The app signs you out.</li>
      </ol>

      <h2>What happens next</h2>
      <ul>
        <li>You are signed out everywhere straight away.</li>
        <li>Your account, trips, coverage and planned routes are kept for 7 days in case you change your mind. An administrator can restore them in that time; ask at <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>.</li>
        <li>After 7 days they are permanently removed, and cannot be brought back.</li>
        <li>Feedback you sent is removed with your account.</li>
      </ul>
      <p>
        Want a copy first? <em>Download my data</em> in Settings on the website saves everything stored about you as a file. If you cannot sign in,
        write to <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a> from the email address on the account. More in the <Link to="/privacy">privacy policy</Link>.
      </p>
    </DocPage>
  );
}
