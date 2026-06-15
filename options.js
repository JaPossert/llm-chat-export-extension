// LLM Chat Exporter — Settings page

document.addEventListener('DOMContentLoaded', async () => {
  const toggle   = document.getElementById('autoSaveToggle');
  const text     = document.getElementById('toggleText');
  const status   = document.getElementById('saveStatus');
  const clearBtn = document.getElementById('clearHistory');
  const flash    = document.getElementById('savedFlash');

  // Load and display current settings
  const { autoSaveEnabled } = await chrome.storage.sync.get({ autoSaveEnabled: false });
  toggle.checked = autoSaveEnabled;
  text.textContent = autoSaveEnabled ? 'On' : 'Off';
  await refreshStatus();

  // Save on toggle change
  toggle.addEventListener('change', async () => {
    text.textContent = toggle.checked ? 'On' : 'Off';
    await chrome.storage.sync.set({ autoSaveEnabled: toggle.checked });
    showFlash();
  });

  // Clear save history
  clearBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ autosaveHistory: {} });
    await refreshStatus();
  });

  async function refreshStatus() {
    const { autosaveHistory } = await chrome.storage.local.get({ autosaveHistory: {} });
    const today = new Date().toISOString().split('T')[0];
    const todayCount = Object.values(autosaveHistory).filter(d => d === today).length;
    const total = Object.keys(autosaveHistory).length;
    status.textContent =
      `${todayCount} conversation${todayCount !== 1 ? 's' : ''} saved today` +
      (total > 0 ? ` · ${total} total` : '');
  }

  function showFlash() {
    flash.style.opacity = '1';
    setTimeout(() => { flash.style.opacity = '0'; }, 1800);
  }
});
