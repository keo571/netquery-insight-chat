import React, { useState, useEffect } from 'react';
import './AcknowledgementModal.css';

const AcknowledgementModal = ({ onAccept }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if user has already acknowledged in this session
    const hasAcknowledged = sessionStorage.getItem('netquery-acknowledged');
    if (!hasAcknowledged) {
      setIsVisible(true);
    }
  }, []);

  const handleAccept = () => {
    // Store acknowledgement for this session only
    sessionStorage.setItem('netquery-acknowledged', 'true');
    setIsVisible(false);
    onAccept();
  };

  if (!isVisible) return null;

  return (
    <div className="acknowledgement-overlay">
      <div className="acknowledgement-modal">
        <div className="acknowledgement-header">
          <h2>Welcome to Netquery!</h2>
        </div>

        <div className="acknowledgement-content">
          <section className="acknowledgement-section">
            <h3>What Netquery Does</h3>
            <p className="acknowledgement-description">
              Meet Netquery, your secure AI data assistant. Powered by RAG-based NL2SQL, it transforms your plain English questions into instant data retrieval, analysis, and visualization. Plus, it's ready for AI agents to use as a tool.
            </p>
          </section>

          <section className="acknowledgement-section">
            <h3>Tips for Best Results</h3>
            <ul>
              <li><strong>Ask Clearly:</strong> Rephrase or ask follow-ups if results aren't what you expected.</li>
              <li><strong>Explore the Menu:</strong> Use ☰ to switch databases, view schema, and explore diagrams.</li>
              <li><strong>Help Netquery Learn:</strong> Unsatisfied? Click 'Thumbs Down' and leave a comment. Your feedback directly trains the system to get better.</li>
            </ul>
          </section>

          <section className="acknowledgement-section">
            <h3>Please Be Aware</h3>
            <ul>
              <li><strong>Data is Accurate:</strong> Values come directly from the database. Previews are truncated to reduce database load, but you can always download the full dataset.</li>
              <li><strong>AI Interpretations:</strong> Explanations and charts are AI-generated. Please review them for context.</li>
              <li><strong>Secure by Design:</strong> Protected by a three-layer security model: strict read-only access, LLM query validation, and embedding guards for precise access control.</li>
            </ul>
          </section>

          <section className="acknowledgement-section acknowledgement-note">
            <p>By clicking below, you understand these points and agree to use this tool responsibly.</p>
          </section>
        </div>

        <div className="acknowledgement-footer">
          <button className="acknowledgement-btn" onClick={handleAccept}>
            I Understand - Let's Get Started!
          </button>
        </div>
      </div>
    </div>
  );
};

export default AcknowledgementModal;
