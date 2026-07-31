(function () {
  'use strict';

  const DEFAULTS = { chatUrl: 'https://192.168.1.129:5184' };
  const frame = document.getElementById('chat-frame');

  function getUrl(base) {
    const clean = base.replace(/\/+$/, '');
    const separator = clean.includes('?') ? '&' : '?';
    return clean + separator + 'newtab';
  }

  function loadFrame(url) {
    frame.src = url;
  }

  function focusIframe() {
    // Focus the iframe element so keyboard input goes there
    frame.focus();
    // Also send a postMessage requesting input focus inside the iframe
    try {
      frame.contentWindow.postMessage({
        source: 'ai-chat-ui-extension',
        type: 'FOCUS_INPUT',
      }, '*');
    } catch {}
  }

  // Focus as soon as the frame loads
  frame.addEventListener('load', () => {
    // Delay slightly to let React mount
    setTimeout(focusIframe, 200);
  }, { once: true });

  // Also try immediately if already loaded
  if (frame.contentWindow?.location?.href) {
    setTimeout(focusIframe, 500);
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get('chatUrl', (items) => {
      loadFrame(getUrl(items.chatUrl || DEFAULTS.chatUrl));
    });
  } else {
    loadFrame(getUrl(DEFAULTS.chatUrl));
  }
})();
