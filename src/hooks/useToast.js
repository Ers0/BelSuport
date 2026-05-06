import { useState, useRef, useCallback } from 'react';

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const showToast = useCallback((msg, type = 'default', duration = 2500) => {
    const id = ++idRef.current;
    setToasts(prev => [{ id, msg, type, leaving: false }, ...prev].slice(0, 4));
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 320);
    }, duration);
  }, []);

  // Legacy compat — single toast
  const toast = toasts[0] || null;

  return { toasts, toast, showToast };
}
