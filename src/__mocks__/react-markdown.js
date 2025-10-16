const React = require('react');

function ReactMarkdown({ children }) {
    // Render plain children for tests
    return React.createElement('div', { 'data-testid': 'react-markdown' }, children);
}

module.exports = ReactMarkdown;
