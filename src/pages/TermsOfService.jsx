import React from 'react';
import { Link } from 'react-router-dom';
import LegalFooter from '../components/LegalFooter.jsx';
import './terms.css';

const LAST_UPDATED = 'February 14, 2025';

export default function TermsOfService() {
  return (
    <div className="terms-root">
      <article className="terms-article">
        <h1 className="terms-title">TerraRun Terms of Service</h1>
        <p className="terms-meta">Last updated: {LAST_UPDATED}</p>

        <section className="terms-section">
          <h2 className="terms-heading">Acceptance of Terms</h2>
          <p className="terms-para">
            By accessing or using TerraRun (&quot;the Service&quot;), you agree to these Terms. If you do not agree, do not use the Service.
          </p>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">What TerraRun Does</h2>
          <p className="terms-para">
            TerraRun connects to Strava (with your permission) to display your activities and enable territory-based gameplay features like territory capture, leaderboards, friends, notifications, and badges.
          </p>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Eligibility</h2>
          <p className="terms-para">
            You must be at least 13 years old to use TerraRun.
          </p>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Your Account</h2>
          <ul className="terms-list">
            <li>You are responsible for activity on your account.</li>
            <li>Your nickname is unique and used as your in-app identifier.</li>
            <li>You agree not to impersonate others or use offensive or infringing nicknames.</li>
          </ul>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Strava Connection</h2>
          <ul className="terms-list">
            <li>TerraRun uses Strava OAuth for authorization.</li>
            <li>You can revoke access at any time in your Strava settings.</li>
            <li>The Service depends on Strava availability; we are not responsible for Strava outages or API changes.</li>
          </ul>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Gameplay and Fair Use</h2>
          <ul className="terms-list">
            <li>Territory results are computed from your activities and game rules may evolve.</li>
            <li>Do not attempt to manipulate territory capture, leaderboards, or spam friend requests.</li>
            <li>We may suspend or restrict accounts for abuse, cheating, harassment, or excessive automated behavior.</li>
          </ul>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Privacy</h2>
          <p className="terms-para">
            Your use is also governed by the <Link to="/privacy" className="terms-link">TerraRun Privacy Policy</Link>.
          </p>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Content and Data</h2>
          <ul className="terms-list">
            <li>You retain ownership of your Strava data.</li>
            <li>You grant TerraRun permission to process and display your activity-derived information inside the Service (routes/territories/badges) to provide features.</li>
            <li>You agree you have the right to connect your Strava account and provide activity data.</li>
          </ul>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Service Availability</h2>
          <p className="terms-para">
            We provide the Service &quot;as is&quot; and &quot;as available.&quot; We do not guarantee uninterrupted operation.
          </p>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Disclaimers</h2>
          <p className="terms-para">
            TerraRun is a fitness game and does not provide medical advice. Exercise at your own risk.
          </p>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Limitation of Liability</h2>
          <p className="terms-para">
            To the maximum extent permitted by law, TerraRun is not liable for indirect, incidental, special, consequential, or punitive damages, or any loss of data, profits, or goodwill.
          </p>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Termination</h2>
          <ul className="terms-list">
            <li>You may stop using the Service at any time.</li>
            <li>We may suspend or terminate access if you violate these Terms.</li>
            <li>You can request deletion of your account data by contacting us.</li>
          </ul>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Changes to Terms</h2>
          <p className="terms-para">
            We may update these Terms. Continued use after updates means you accept the revised Terms. We will update the &quot;Last updated&quot; date.
          </p>
        </section>

        <section className="terms-section">
          <h2 className="terms-heading">Contact</h2>
          <p className="terms-para">
            <a href="mailto:support@terrarun.app" className="terms-link">support@terrarun.app</a>
          </p>
        </section>

        <LegalFooter />
      </article>
    </div>
  );
}
