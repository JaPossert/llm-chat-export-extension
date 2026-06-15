// Universal LLM Conversation Exporter - Service Worker (Corrected)

console.log('Service worker starting...');

// Listen for messages from the popup script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // SECURITY FIX: Enhanced message origin validation
    if (sender.id !== chrome.runtime.id || !message.action) {
        console.warn('Rejected message from invalid sender:', sender);
        return;
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
async function downloadFileWithOffscreen(filename, content, format) {
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
