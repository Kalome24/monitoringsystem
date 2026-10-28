// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/shared/ToastProvider';
import SessionWatcher from './components/shared/SessionWatcher';
import ErrorBoundary from './components/shared/ErrorBoundary';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider position="top-right">
        <SessionWatcher />
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);