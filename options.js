// LLM Chat Exporter — Settings page

document.addEventListener('DOMContentLoaded', async () => {
  const toggle      = document.getElementById('autoSaveToggle');
  const toggleText  = document.getElementById('toggleText');
  const status      = document.getElementById('saveStatus');
  const clearBtn    = document.getElementById('clearHistory');
  const folderInput = document.getElementById('folderInput');
  const flash       = document.getElementById('savedFlash');

  // Load current settings
  const { autoSaveEnabled, autoSaveFolder } = await chrome.storage.sync.get({
    autoSaveEnabled: false,
    autoSaveFolder: 'AI Chat Exports'
  });

  toggle.checked       = autoSaveEnabled;
  toggleText.textContent = autoSaveEnabled ? 'On' : 'Off';
  folderInput.value    = autoSaveFolder;

  await refreshStatus();

  // Auto-save toggle
  toggle.addEventListener('change', async () => {
    toggleText.textContent = toggle.checked ? 'On' : 'Off';
    await chrome.storage.sync.set({ autoSaveEnabled: toggle.checked });
    showFlash();
  });

  // Folder input — save on blur or Enter
  folderInput.addEventListener('change', saveFolder);
  folderInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveFolder(); });

  async function saveFolder() {
    await chrome.storage.sync.set({ autoSaveFolder: folderInput.value.trim() });
    showFlash();
  }

  // Clear history
  clearBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ autosaveHistory: {} });
    await refreshStatus();
  });

  async function refreshStatus() {
    const { autosaveHistory } = await chrome.storage.local.get({ autosaveHistory: {} });
    const today = new Date().toISOString().split('T')[0];
    const entries = Object.values(autosaveHistory);
    const todayCount = entries.filter(e => {
      const date = typeof e === 'string' ? e : e?.date;
      return date === today;
    }).length;
    const total = entries.length;
    status.textContent =
      `${todayCount} conversation${todayCount !== 1 ? 's' : ''} saved today` +
      (total > 0 ? ` · ${total} total` : '');
  }

  function showFlash() {
    flash.style.opacity = '1';
    setTimeout(() => { flash.style.opacity = '0'; }, 1800);
  }
});
