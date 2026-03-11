// Universal LLM Conversation Exporter - ChatGPT Extractor (Simplified and More Robust)

class ChatGPTExtractor {
    constructor() {
        this.selectors = {
            // Just get all article elements - much simpler
            conversationTurn: 'article',
            authorRoleElement: '[data-message-author-role]',
            // Keep UI elements removal for cleaner text
            uiElementsToRemove: '[data-testid="copy-turn-action-button"], [aria-label="Edit message"], [aria-label="More actions"], button, .sr-only',
        };
    }

    /**
     * Entry point for extraction.
     */
    async extractConversation() {
        console.log('ChatGPTExtractor: Starting simple article text extraction...');
        const messages = [];
        const articles = document.querySelectorAll(this.selectors.conversationTurn);

        if (articles.length === 0) {
            console.error('No articles found on page');
            throw new Error('No conversation articles found. Make sure you are on a ChatGPT conversation page.');
        }

        console.log(`Found ${articles.length} articles.`);

        for (let index = 0; index < articles.length; index++) {
            const article = articles[index];
            try {
                const message = this.extractMessageFromArticle(article);
                if (message) {
                    messages.push(message);
                }
            } catch (error) {
                console.warn('Could not extract message from article:', error);
            }

            // Yield periodically so very large chats don't block the tab for too long.
            if ((index + 1) % 25 === 0) {
                await this.yieldToMainThread();
            }
        }

        console.log(`Successfully extracted ${messages.length} messages.`);
        return messages;
    }

    yieldToMainThread() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    /**
     * Extracts a single message object from an article element.
     * Simplified approach - just get all text from the article.
     */
    extractMessageFromArticle(articleElement) {
        // 1. Try to find the role element to determine if this is user or assistant
        const roleElement = articleElement.querySelector(this.selectors.authorRoleElement);
        let role = 'unknown';

        if (roleElement) {
            role = roleElement.getAttribute('data-message-author-role') || 'unknown';
        } else {
            // Fallback: try to determine role from content or position
            const text = articleElement.innerText || '';
            if (text.toLowerCase().includes('you said:') || text.toLowerCase().includes('you:')) {
                role = 'user';
            } else if (text.toLowerCase().includes('chatgpt said:') || text.toLowerCase().includes('chatgpt:')) {
                role = 'assistant';
            }
        }

        // 2. Prefer the role container when present to reduce copied DOM size.
        const contentRoot = roleElement ? roleElement : articleElement;
        const articleClone = contentRoot.cloneNode(true);

        // 3. Remove UI elements for cleaner text
        const uiElements = articleClone.querySelectorAll(this.selectors.uiElementsToRemove);
        uiElements.forEach(el => el.remove());

        // 4. Extract plain text for fast processing and lower memory footprint.
        let content = '';
        try {
            content = articleClone.innerText || articleClone.textContent || '';
        } catch (error) {
            content = articleClone.textContent || '';
        }

        if (content.trim().length === 0) {
            return null; // Skip empty articles
        }

        return {
            role: role,
            content: content.trim(),
            isPlainText: true
        };
    }
}

/**
 * Main execution logic for the content script.
 * Listens for the message from the background script to start extraction.
 */
if (typeof window.chatGPT_extractor_injected === 'undefined') {
    window.chatGPT_extractor_injected = true;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.action === 'extractConversation') {
            (async () => {
                try {
                    const extractor = new ChatGPTExtractor();
                    const conversationData = await extractor.extractConversation();

                    if (conversationData && conversationData.length > 0) {
                        // Generate filename: first_ten_chars_of_url_datetime_with_underscores
                        const url = window.location.href;
                        const urlStart = url.replace(/^https?:\/\//, '').substring(0, 10).replace(/[^a-z0-9]/gi, '_');
                        const now = new Date();
                        const datetime = now.toISOString().replace(/[-:T]/g, '_').split('.')[0]; // YYYY_MM_DD_HH_MM_SS
                        const filename = `${urlStart}_${datetime}.txt`;

                        // Use chunked export to avoid creating one massive output file.
                        const contentProcessor = new window.ContentProcessor();
                        const exportResult = await contentProcessor.downloadConversationInChunks(
                            conversationData,
                            {
                                includeTimestamps: false,
                                includeMetadata: true,
                                platform: 'ChatGPT',
                                url: url
                            },
                            {
                                filename,
                                mimeType: 'text/plain;charset=utf-8',
                                maxChunkChars: 600000,
                                delayMs: 120
                            }
                        );

                        if (!exportResult.success) {
                            throw new Error(exportResult.error || 'Failed to start download.');
                        }

                        if (exportResult.parts > 1) {
                            console.log(`ChatGPT export split into ${exportResult.parts} files.`);
                        }

                        sendResponse({
                            success: true,
                            downloaded: true,
                            filename,
                            partCount: exportResult.parts
                        });
                    } else {
                        throw new Error('No valid messages were extracted from the page.');
                    }
                } catch (error) {
                    console.error('Extraction failed in content script:', error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
        }
        return true; // Keep message channel open for async response.
    });
}

