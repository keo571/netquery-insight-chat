import React, { useState, useEffect } from 'react';
import './styles/global.css';

// Components
import {
  StreamingMessage,
  ChatInput,
  ImageModal,
  WelcomeMessage
} from './components';

// Hooks
import { useChat, useScrollToBottom } from './hooks';
import { fetchSchemaOverview } from './services/api';

// Utils
import { AGENT_CONFIG } from './utils/constants';
import { getUserFriendlyError } from './utils/errorMessages';

function App() {
  const [currentQuery, setCurrentQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);

  // Custom hooks
  const { messages, loading, sendMessage, updateMessageAnalysis } = useChat();
  const [schemaOverview, setSchemaOverview] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [schemaError, setSchemaError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const loadOverview = async () => {
      try {
        const data = await fetchSchemaOverview();
        if (isMounted) {
          setSchemaOverview(data);
          setSchemaError(null);
        }
      } catch (err) {
        if (isMounted) {
          const friendlyError = err.message || getUserFriendlyError(err, 'schema');
          setSchemaError(friendlyError);
        }
      } finally {
        if (isMounted) {
          setSchemaLoading(false);
        }
      }
    };

    loadOverview();
    return () => {
      isMounted = false;
    };
  }, []);
  const messagesEndRef = useScrollToBottom(messages);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentQuery.trim() || loading) return;

    await sendMessage(currentQuery);
    setCurrentQuery('');
  };


  return (
    <div className="App">
      <div className="chat-container">
        <div className="chat-header">
          <h1>{AGENT_CONFIG.name} Chat</h1>
        </div>


        <div className="chat-messages">
          {messages.length === 0 ? (
            <WelcomeMessage 
              title={AGENT_CONFIG.welcomeTitle}
              message={AGENT_CONFIG.welcomeMessage}
              tables={schemaOverview?.tables}
              suggestedQueries={schemaOverview?.suggested_queries}
              loading={schemaLoading}
              error={schemaError}
            />
          ) : (
            messages.map((message) => (
              <StreamingMessage
                key={message.id}
                message={message}
                isUser={message.isUser}
                agentName={AGENT_CONFIG.name}
                onImageClick={setSelectedImage}
                onUpdateAnalysis={updateMessageAnalysis}
              />
            ))
          )}

          <div ref={messagesEndRef} />
        </div>

        <ChatInput
          currentQuery={currentQuery}
          setCurrentQuery={setCurrentQuery}
          loading={loading}
          onSubmit={handleSubmit}
          placeholder={AGENT_CONFIG.inputPlaceholder}
        />
      </div>

      <ImageModal 
        selectedImage={selectedImage} 
        onClose={() => setSelectedImage(null)} 
      />
    </div>
  );
}

export default App;
