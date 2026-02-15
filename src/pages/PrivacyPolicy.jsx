import React from 'react';
import LegalFooter from '../components/LegalFooter.jsx';
import './privacy.css';

const LAST_UPDATED = 'February 14, 2025';

export default function PrivacyPolicy() {
  return (
    <div className="privacy-root">
      <article className="privacy-article">
        <h1 className="privacy-title">TerraRun Privacy Policy</h1>
        <p className="privacy-meta">Last updated: {LAST_UPDATED}</p>

        <p className="privacy-intro">
          TerraRun (&quot;we&quot;, &quot;us&quot;) provides a location-based running game that connects to Strava to help you visualize activities and compete for territory. This Privacy Policy explains what we collect, how we use it, and your choices.
        </p>

        <section className="privacy-section">
          <h2 className="privacy-heading">Information We Collect</h2>
          <ul className="privacy-list">
            <li><strong>Account info:</strong> your TerraRun nickname and your Strava athlete ID.</li>
            <li><strong>Strava OAuth tokens:</strong> access token and refresh token (stored securely on our backend) to fetch your activities when you authorize.</li>
            <li><strong>Strava activity data</strong> you authorize us to access, including activity metadata and route summaries (e.g., polyline/route geometry) required to render your routes and compute territories.</li>
            <li><strong>App-generated data:</strong> territory ownership, friend requests, friendships, notifications, and badges/progress.</li>
            <li><strong>Basic technical data:</strong> cookies used to maintain your login session.</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2 className="privacy-heading">How We Use Information</h2>
          <ul className="privacy-list">
            <li>Authenticate you via Strava and keep you signed in using a session cookie.</li>
            <li>Sync your Strava activities (incrementally) and show them in the app.</li>
            <li>Compute and display territory capture results based on your loop activities.</li>
            <li>Provide leaderboards (global and friends), friend requests, notifications, and badges.</li>
            <li>Maintain service reliability, prevent abuse, and debug issues.</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2 className="privacy-heading">Cookies</h2>
          <ul className="privacy-list">
            <li>We use an httpOnly session cookie to keep you logged in.</li>
            <li>In production, the cookie may be set with Secure and SameSite=None to work across our frontend (Vercel) and backend (Render).</li>
            <li>You can block cookies in your browser, but the app may not work correctly.</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2 className="privacy-heading">Sharing</h2>
          <ul className="privacy-list">
            <li>We do not sell your personal data.</li>
            <li>In global game views, other users do not see your identity on map territories (privacy by default).</li>
            <li>Your nickname may be visible to accepted friends and in friend-only experiences.</li>
            <li>We may share data only if required by law or to protect safety/security.</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2 className="privacy-heading">Data Retention</h2>
          <ul className="privacy-list">
            <li>We store your Strava-linked account info, tokens, and synced activities to avoid requiring re-login and to reduce repeated API calls.</li>
            <li>We retain territory and game history to support gameplay and progression.</li>
            <li>You can request deletion (see &quot;Your Choices&quot;).</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2 className="privacy-heading">Your Choices / Controls</h2>
          <ul className="privacy-list">
            <li>You can revoke TerraRun&apos;s access from Strava at any time in Strava settings; this stops future syncing.</li>
            <li>You can log out from TerraRun anytime.</li>
            <li>You can request deletion of your TerraRun account data by contacting us (provide a placeholder email).</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2 className="privacy-heading">Security</h2>
          <p className="privacy-para">
            We store tokens and user data on our backend database. We take reasonable measures to protect data, but no system is 100% secure.
          </p>
        </section>

        <section className="privacy-section">
          <h2 className="privacy-heading">Children</h2>
          <p className="privacy-para">
            TerraRun is not intended for children under 13.
          </p>
        </section>

        <section className="privacy-section">
          <h2 className="privacy-heading">Changes</h2>
          <p className="privacy-para">
            We may update this policy and will update the &quot;Last updated&quot; date.
          </p>
        </section>

        <section className="privacy-section">
          <h2 className="privacy-heading">Contact</h2>
          <p className="privacy-para">
            For privacy or account requests, contact us at:{' '}
            <a href="mailto:support@terrarun.app" className="privacy-link">support@terrarun.app</a>
          </p>
        </section>

        <LegalFooter />
      </article>
    </div>
  );
}
