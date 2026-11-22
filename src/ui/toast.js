// Toast notification service

function resolveContainer(containerOrSelector) {
  if (!containerOrSelector) {
    return typeof document !== 'undefined' ? document.getElementById('toast-container') : null;
  }
  if (typeof containerOrSelector === 'string') {
    if (typeof document === 'undefined') return null;
    if (containerOrSelector.startsWith('#') || containerOrSelector.startsWith('.')) {
      return document.querySelector(containerOrSelector);
    }
    return document.getElementById(containerOrSelector) || document.querySelector(containerOrSelector);
  }
  return containerOrSelector;
}

export function showToast(message, type = 'info', durationMs = 3500, containerOrSelector = '#toast-container') {
  const container = resolveContainer(containerOrSelector);
  if (!container || typeof document === 'undefined') return null;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    setTimeout(() => {
      if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 300);
  }, durationMs);

  return toast;
}

export function createToastManager(containerOrSelector = '#toast-container') {
  return {
    showToast(message, type = 'info', durationMs = 3500) {
      return showToast(message, type, durationMs, containerOrSelector);
    },
  };
}
