// Universal LLM Conversation Exporter - Service Worker (Corrected)

console.log('Service worker starting...');

// Listen for messages from the popup script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // SECURITY FIX: Enhanced message origin validation
    if (sender.id !== chrome.runtime.id || !message.action) {
        console.warn('Rejected message from invalid sender:', sender);
        return;
    }

    // Auto-save trigger from content script — no response needed
    if (message.action === 'checkAutoSave') {
        if (sender.tab && sender.tab.id) {
            handleAutoSave(sender.tab.id, message.url).catch(err =>
                console.warn('Auto-save failed:', err.message)
            );
        }
        return false;
    }

    // Additional validation for tab-based messages
    if (message.action === 'exportConversation' && sender.tab) {
        if (!isValidUrl(sender.tab.url)) {
            console.warn('Rejected message from invalid tab URL:', sender.tab.url);
            sendResponse({ success: false, error: 'Invalid tab URL.' });
            return;
        }
    }

    if (message.action === 'exportConversation') {
        handleExport(message, sendResponse);
    }

    // Return true to indicate you wish to send a response asynchronously
    return true;
});

async function handleExport(message, sendResponse) {
    const { format, tabId, platform } = message;

    console.log(`Received export request for platform: ${platform}, format: ${format}`);

    if (!tabId) {
        console.error('Export failed: No active tab ID provided.');
        sendResponse({ success: false, error: 'No active tab found.' });
        return;
    }

    // SECURITY FIX: Validate platform parameter to prevent path traversal
    if (!isValidPlatform(platform)) {
        console.error('Export failed: Invalid platform specified:', platform);
        sendResponse({ success: false, error: 'Invalid platform specified.' });
        return;
    }

    // SECURITY FIX: Validate format parameter
    if (!isValidFormat(format)) {
        console.error('Export failed: Invalid format specified:', format);
        sendResponse({ success: false, error: 'Invalid format specified.' });
        return;
    }

    try {
        // Inject scripts only when they are not already present on this page.
        await ensureExportScriptsInjected(tabId, platform);
        console.log(`Export scripts are ready for ${platform}.`);

        // Send a message to the content script to start the extraction
        const response = await chrome.tabs.sendMessage(tabId, {
            action: 'extractConversation',
            format: format,
        });

        console.log('Received response from content script:', response);

        if (response && response.success) {
            // New fast path: content script already handled the file download.
            if (response.downloaded) {
                sendResponse({ success: true });
                return;
            }

            // Backward-compatible path: download from background/offscreen.
            if (typeof response.content === 'string' && response.content.length > 0) {
                try {
                    await downloadFileWithOffscreen(response.filename, response.content, format);
                    sendResponse({ success: true });
                } catch (downloadError) {
                    console.error('Download failed:', downloadError);
                    sendResponse({ success: false, error: 'Download failed: ' + downloadError.message });
                }
                return;
            }

            throw new Error('Extractor returned success without downloadable content.');
        } else {
            throw new Error(response.error || 'Extraction failed in content script.');
        }
    } catch (error) {
        console.error('Error during script injection or execution:', error);
        sendResponse({ success: false, error: `Failed to communicate with the page. Please refresh the tab and try again. Details: ${error.message}` });
    }
}

async function ensureExportScriptsInjected(tabId, platform) {
    const markerByPlatform = {
        chatgpt: 'chatGPT_extractor_injected',
        claude: 'claude_extractor_injected',
        gemini: 'gemini_extractor_injected',
        grok: 'grok_extractor_injected',
        lumo: 'lumo_extractor_injected'
    };

    const extractorMarker = markerByPlatform[platform];
    if (!extractorMarker) {
        throw new Error(`Unknown platform marker: ${platform}`);
    }

    let state = { hasProcessor: false, hasExtractor: false };

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: (markerName) => {
                return {
                    hasProcessor: typeof window.ContentProcessor !== 'undefined',
                    hasExtractor: Boolean(window[markerName])
                };
            },
            args: [extractorMarker]
        });

        if (results && results[0] && results[0].result) {
            state = results[0].result;
        }
    } catch (error) {
        console.warn('Could not check injected script state, falling back to fresh injection:', error);
    }

    const filesToInject = [];
    if (!state.hasProcessor) {
        filesToInject.push('utils/content-processor.js');
    }
    if (!state.hasExtractor) {
        filesToInject.push(`extractors/${platform}-extractor.js`);
    }

    if (filesToInject.length === 0) {
        return;
    }

    await chrome.scripting.executeScript({
        target: { tabId },
        files: filesToInject
    });
}

// Modern approach using offscreen document for blob handling
async function downloadFileWithOffscreen(filename, content, format, conflictAction = 'uniquify') {
    const mimeTypes = {
        'markdown': 'text/markdown',
        'text': 'text/plain',
        'json': 'application/json',
    };
    const mimeType = mimeTypes[format] || 'text/plain';

    try {
        // Create offscreen document if it doesn't exist
        await ensureOffscreenDocument();

        // Send content to offscreen document to create blob URL
        const response = await chrome.runtime.sendMessage({
            action: 'createDownloadUrl',
            content: content,
            mimeType: mimeType
        });

        if (!response.success) {
            throw new Error(response.error || 'Failed to create download URL');
        }

        // Use the blob URL for download
        return new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: response.url,
                filename: filename,
                saveAs: false,
                conflictAction: conflictAction,
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error('Download failed:', chrome.runtime.lastError.message);
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    console.log(`Download started with ID: ${downloadId}`);
                    resolve(downloadId);
                }
            });
        });

    } catch (error) {
        console.error('Error in downloadFileWithOffscreen:', error);
        throw error;
    }
}

// Ensure offscreen document exists
async function ensureOffscreenDocument() {
    try {
        // Check if offscreen document already exists
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL('offscreen.html')]
        });

        if (existingContexts.length > 0) {
            return; // Already exists
        }

        // Create offscreen document
        await chrome.offscreen.createDocument({
            url: chrome.runtime.getURL('offscreen.html'),
            reasons: ['BLOBS'],
            justification: 'Create blob URLs for file downloads in Manifest V3'
        });

        console.log('Offscreen document created');
    } catch (error) {
        console.error('Error creating offscreen document:', error);
        throw error;
    }
}

// Auto-save logic

const EXTRACTOR_CLASSES = {
    chatgpt: 'ChatGPTExtractor',
    claude:  'ClaudeExtractor',
    gemini:  'GeminiExtractor',
    grok:    'GrokExtractor',
    lumo:    'LumoExtractor',
};

async function handleAutoSave(tabId, url) {
    if (!url || !isValidUrl(url)) return;

    const enabled = await getAutoSaveEnabled();
    if (!enabled) return;

    const platform = detectPlatformFromUrl(url);
    if (!platform) return;

    try {
        await ensureExportScriptsInjected(tabId, platform);

        // Call the extractor class directly — no download triggered, just returns messages
        const extractorClass = EXTRACTOR_CLASSES[platform];
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: (className) => {
                const Cls = window[className];
                if (!Cls) return null;
                return new Cls().extractConversation().then(msgs => ({
                    messages: Array.from(msgs),
                    title: msgs._title || document.title || 'Chat'
                }));
            },
            args: [extractorClass]
        });

        const data = results?.[0]?.result;
        if (!data || !data.messages || data.messages.length === 0) return;

        const content = formatAutoSaveContent(data.messages, url);
        const hash = simpleHash(content);

        // Skip if content hasn't changed since last save
        const stored = await getStoredSave(url);
        if (stored && stored.hash === hash) {
            console.log(`Auto-save: no new content — ${url}`);
            return;
        }

        // Download with overwrite so continuing a chat updates the same file
        const subfolder = await getAutoSaveSubfolder();
        const filename = stableFilenameForUrl(url, subfolder);

        await downloadFileWithOffscreen(filename, content, 'text', 'overwrite');
        await markSaved(url, hash);
        console.log(`Auto-save: saved — ${filename}`);
    } catch (err) {
        console.warn(`Auto-save: failed — ${err.message}`);
    }
}

function formatAutoSaveContent(messages, url) {
    return `chat url: ${url}\n\n` +
        messages.map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}:\n${m.content}`).join('\n\n');
}

function stableFilenameForUrl(url, subfolder) {
    try {
        const u = new URL(url);
        const domain = u.hostname.split('.')[0]; // 'lumo', 'claude', 'chatgpt', etc.
        const path = u.pathname.replace(/^\//, '').replace(/\//g, '_').replace(/[^a-z0-9_-]/gi, '') || 'chat';
        const name = `${domain}_${path}.txt`;
        return subfolder ? `${subfolder}/${name}` : name;
    } catch {
        return subfolder ? `${subfolder}/chat.txt` : 'chat.txt';
    }
}

function simpleHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
}

async function getAutoSaveEnabled() {
    const { autoSaveEnabled } = await chrome.storage.sync.get({ autoSaveEnabled: false });
    return autoSaveEnabled;
}

async function getAutoSaveSubfolder() {
    const { autoSaveFolder } = await chrome.storage.sync.get({ autoSaveFolder: 'AI Chat Exports' });
    return autoSaveFolder.trim();
}

async function getStoredSave(url) {
    const { autosaveHistory } = await chrome.storage.local.get({ autosaveHistory: {} });
    const entry = autosaveHistory[normalizeUrlForHistory(url)];
    if (!entry) return null;
    // Handle both old string format and new object format
    return typeof entry === 'string' ? { date: entry, hash: null } : entry;
}

async function markSaved(url, hash) {
    const { autosaveHistory } = await chrome.storage.local.get({ autosaveHistory: {} });
    autosaveHistory[normalizeUrlForHistory(url)] = { date: todayString(), hash };
    await chrome.storage.local.set({ autosaveHistory });
}

function normalizeUrlForHistory(url) {
    try {
        const u = new URL(url);
        return u.origin + u.pathname;
    } catch {
        return url;
    }
}

function todayString() {
    return new Date().toISOString().split('T')[0];
}

function detectPlatformFromUrl(url) {
    const patterns = [
        { platform: 'chatgpt', tests: [/^https?:\/\/chat\.openai\.com/, /^https?:\/\/chatgpt\.com/] },
        { platform: 'claude',  tests: [/^https?:\/\/claude\.ai/] },
        { platform: 'gemini',  tests: [/^https?:\/\/gemini\.google\.com/] },
        { platform: 'grok',    tests: [/^https?:\/\/x\.com\/i\/grok/, /^https?:\/\/grok\.com\/c\//] },
        { platform: 'lumo',    tests: [/^https?:\/\/lumo\.proton\.me/] },
    ];
    for (const { platform, tests } of patterns) {
        if (tests.some(t => t.test(url))) return platform;
    }
    return null;
}

// SECURITY: Input validation functions
function isValidPlatform(platform) {
    const validPlatforms = ['chatgpt', 'claude', 'gemini', 'grok', 'lumo'];
    return typeof platform === 'string' && validPlatforms.includes(platform);
}

function isValidFormat(format) {
    const validFormats = ['text', 'markdown', 'json'];
    return typeof format === 'string' && validFormats.includes(format);
}

function isValidUrl(url) {
    if (typeof url !== 'string') return false;

    try {
        const urlObj = new URL(url);
        // Only allow https and http protocols
        if (!['https:', 'http:'].includes(urlObj.protocol)) {
            return false;
        }

        // Check against allowed domains
        const allowedDomains = [
            'chat.openai.com',
            'chatgpt.com',
            'claude.ai',
            'gemini.google.com',
            'x.com',
            'grok.com',
            'lumo.proton.me'
        ];

        return allowedDomains.some(domain =>
            urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
        );
    } catch {
        return false;
    }
}

chrome.runtime.onInstalled.addListener(() => {
    console.log('Universal LLM Conversation Exporter installed/updated.');
});
