// Runs on supported chat pages after they finish loading.
// Notifies the background to auto-save this conversation if the setting is on.
// The background handles dedup — this script just announces presence.

if (typeof window.__autosave_check_registered === 'undefined') {
  window.__autosave_check_registered = true;

  // Give SPAs time to render their messages before we try to extract them.
  setTimeout(() => {
    chrome.runtime.sendMessage({
      action: 'checkAutoSave',
      url: window.location.href
    }).catch(() => {
      // Service worker may not be awake yet; the next page load will retry.
    });
  }, 4000);
}
