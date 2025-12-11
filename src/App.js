import React, { useState, useEffect } from 'react';
import './styles/global.css';

// Components
import {
  StreamingMessage,
  ChatInput,
  ImageModal,
  Sidebar,
  SchemaModal,
  AcknowledgementModal,
  Toast
} from './components';

// Hooks
import { useChat, useScrollToBottom } from './hooks';
import { fetchSchemaOverview } from './services/api';

// Utils
import { AGENT_CONFIG } from './utils/constants';

function App() {
  const [currentQuery, setCurrentQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Database selection state
  // TODO: Fetch available databases from backend instead of hardcoding
  const availableDatabases = ['sample', 'neila'];
  const [selectedDatabase, setSelectedDatabase] = useState(
    sessionStorage.getItem('selectedDatabase') || 'sample'
  );

  // Custom hooks
  const { messages, loading, sendMessage, updateMessageAnalysis } = useChat(selectedDatabase);
  const [schemaOverview, setSchemaOverview] = useState(null);

  // Fetch schema overview on mount and when database changes
  useEffect(() => {
    const loadSchema = async () => {
      try {
        const data = await fetchSchemaOverview(selectedDatabase);
        setSchemaOverview(data);
      } catch (error) {
        console.error('Failed to load schema:', error);
      }
    };
    loadSchema();
  }, [selectedDatabase]);

  // Handle database change
  const handleDatabaseChange = (database) => {
    setSelectedDatabase(database);
    sessionStorage.setItem('selectedDatabase', database);
  };
  const messagesEndRef = useScrollToBottom(messages);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentQuery.trim() || loading) return;

    await sendMessage(currentQuery);
    setCurrentQuery('');
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const showToast = (message) => {
    setToastMessage(message);
    setToastVisible(true);
  };

  const handleQuerySelect = (query) => {
    if (query === 'VIEW_SCHEMA_DIAGRAM') {
      setIsSchemaModalOpen(true);
      if (window.innerWidth <= 768) setIsSidebarOpen(false);
    } else {
      setCurrentQuery(query);
      showToast('Question copied to input box!');
      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        setIsSidebarOpen(false);
      }
    }
  };

  const handleSidebarAction = (action) => {
    if (action.type === 'SELECT_QUERY') {
      handleQuerySelect(action.query);
    } else if (action.type === 'VIEW_SCHEMA_DIAGRAM') {
      setIsSchemaModalOpen(true);
      if (window.innerWidth <= 768) setIsSidebarOpen(false);
    }
  };

  return (
    <div className="App">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={toggleSidebar}
        schema={schemaOverview}
        onAction={handleSidebarAction}
        selectedDatabase={selectedDatabase}
        databases={availableDatabases}
        onDatabaseChange={handleDatabaseChange}
      />

      <SchemaModal
        key={selectedDatabase}
        isOpen={isSchemaModalOpen}
        onClose={() => setIsSchemaModalOpen(false)}
        schema={schemaOverview}
      />

      <div className={`chat-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="chat-header">
          {!isSidebarOpen && (
            <button className="menu-btn" onClick={toggleSidebar}>
              ☰
            </button>
          )}
          <h1>{AGENT_CONFIG.name} Chat</h1>
        </div>


        <div className="chat-messages">
          {messages.map((message) => (
            <StreamingMessage
              key={message.id}
              message={message}
              isUser={message.isUser}
              agentName={AGENT_CONFIG.name}
              onImageClick={setSelectedImage}
              onUpdateAnalysis={updateMessageAnalysis}
            />
          ))}

          <div ref={messagesEndRef} />
        </div>

        <ChatInput
          currentQuery={currentQuery}
          setCurrentQuery={setCurrentQuery}
          loading={loading}
          onSubmit={handleSubmit}
          placeholder={AGENT_CONFIG.inputPlaceholder}
          autoFocus={toastVisible}
        />
      </div>

      <ImageModal
        selectedImage={selectedImage}
        onClose={() => setSelectedImage(null)}
      />

      <AcknowledgementModal onAccept={() => {}} />

      <Toast
        message={toastMessage}
        isVisible={toastVisible}
        onClose={() => setToastVisible(false)}
      />
    </div>
  );
}

export default App;
