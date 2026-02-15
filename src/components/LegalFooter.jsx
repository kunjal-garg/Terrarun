import React from 'react';
import { Link } from 'react-router-dom';
import './legal-footer.css';

export default function LegalFooter() {
  return (
    <footer className="legal-footer">
      <Link to="/" className="legal-footer-link">Home</Link>
      <span className="legal-footer-sep">·</span>
      <Link to="/privacy" className="legal-footer-link">Privacy</Link>
      <span className="legal-footer-sep">·</span>
      <Link to="/terms" className="legal-footer-link">Terms</Link>
    </footer>
  );
}
