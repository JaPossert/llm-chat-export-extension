// Universal LLM Conversation Exporter - ChatGPT Extractor (Simplified and More Robust)

class ChatGPTExtractor {
    constructor() {
        this.selectors = {
            // ChatGPT now uses <section data-testid="conversation-turn-N"> instead of <article>
            conversationTurn: 'section[data-testid^="conversation-turn-"]',
            legacyConversationTurn: 'article',
            authorRoleElement: '[data-message-author-role]',
            markdownContent: '.markdown',
            // Keep UI elements removal for cleaner text
            uiElementsToRemove: '[data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"], [data-testid="bad-response-turn-action-button"], [aria-label="Edit message"], [aria-label="More actions"], button, .sr-only',
        };
    }

    /**
     * Entry point for extraction.
     */
    async extractConversation() {
        console.log('ChatGPTExtractor: Starting conversation extraction...');
        const messages = [];
        const articles = this.getConversationTurns();

        if (articles.length === 0) {
            console.error('No conversation turns found on page');
            throw new Error('No conversation turns found. Make sure you are on a ChatGPT conversation page with messages.');
        }

        console.log(`Found ${articles.length} conversation turns.`);

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

    getConversationTurns() {
        const modernTurns = Array.from(document.querySelectorAll(this.selectors.conversationTurn));

        if (modernTurns.length > 0) {
            return modernTurns;
        }

        return Array.from(document.querySelectorAll(this.selectors.legacyConversationTurn))
            .filter(article => !article.closest(this.selectors.conversationTurn));
    }

    yieldToMainThread() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    /**
     * Extracts a single message object from an article element.
     */
    extractMessageFromArticle(articleElement) {
        // Prefer the turn role. ChatGPT can render multiple assistant message
        // blocks inside one turn; all visible blocks are part of the answer.
        const role = this.getMessageRole(articleElement);
        const content = this.extractMessageContent(articleElement, role);

        if (content.trim().length === 0) {
            return null; // Skip empty articles
        }

        return {
            role: role,
            content: content.trim(),
            isPlainText: true
        };
    }

    getMessageRole(articleElement) {
        const turnRole = articleElement.getAttribute('data-turn');

        if (turnRole) {
            return turnRole;
        }

        const roleElement = articleElement.querySelector(this.selectors.authorRoleElement);

        if (roleElement) {
            return roleElement.getAttribute('data-message-author-role') || 'unknown';
        }

        // Fallback: try to determine role from content or position.
        const text = articleElement.innerText || '';
        if (text.toLowerCase().includes('you said:') || text.toLowerCase().includes('you:')) {
            return 'user';
        }

        if (text.toLowerCase().includes('chatgpt said:') || text.toLowerCase().includes('chatgpt:')) {
            return 'assistant';
        }

        return 'unknown';
    }

    extractMessageContent(articleElement, role) {
        const messageElements = this.getMessageElementsForTurn(articleElement, role);
        const contentBlocks = messageElements
            .map(element => this.extractCleanText(element))
            .filter(Boolean);
        const combinedContent = this.joinTextBlocks(contentBlocks);

        if (combinedContent) {
            return combinedContent;
        }

        return this.extractCleanText(articleElement);
    }

    getMessageElementsForTurn(articleElement, role) {
        const roleElements = this.getRoleElements(articleElement, role);

        if (roleElements.length === 0) {
            return [];
        }

        return roleElements.filter(element => this.isUsableMessageElement(element));
    }

    getRoleElements(articleElement, role) {
        if (role && role !== 'unknown') {
            return Array.from(articleElement.querySelectorAll(`[data-message-author-role="${role}"]`));
        }

        return Array.from(articleElement.querySelectorAll(this.selectors.authorRoleElement));
    }

    isUsableMessageElement(element) {
        if (!element) {
            return false;
        }

        if (element.closest('[hidden], [aria-hidden="true"], [inert]')) {
            return false;
        }

        if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
                return false;
            }
        }

        return true;
    }

    extractCleanText(rootElement) {
        if (!rootElement) {
            return '';
        }

        const contentElements = this.getTextExtractionRoots(rootElement);
        const textBlocks = contentElements
            .map(element => this.extractCleanTextFromSingleElement(element))
            .filter(Boolean);

        return this.joinTextBlocks(textBlocks);
    }

    getTextExtractionRoots(rootElement) {
        if (rootElement.matches && rootElement.matches(this.selectors.markdownContent)) {
            return [rootElement];
        }

        const markdownElements = Array.from(rootElement.querySelectorAll(this.selectors.markdownContent));

        if (markdownElements.length > 0) {
            return markdownElements;
        }

        return [rootElement];
    }

    extractCleanTextFromSingleElement(element) {
        const clone = element.cloneNode(true);
        const uiElements = clone.querySelectorAll(this.selectors.uiElementsToRemove);
        uiElements.forEach(el => el.remove());

        let renderedText = '';
        try {
            renderedText = clone.innerText || '';
        } catch (error) {
            renderedText = '';
        }

        const domText = this.extractTextFromNode(clone);
        const fallbackText = clone.textContent || '';
        return this.pickLongestMeaningfulText([renderedText, domText, fallbackText]);
    }

    joinTextBlocks(textBlocks) {
        const uniqueBlocks = [];

        textBlocks.forEach(block => {
            const normalizedBlock = this.normalizeExtractedText(block);
            const compactBlock = this.compactForComparison(normalizedBlock);

            if (!compactBlock) {
                return;
            }

            const overlappingIndex = uniqueBlocks.findIndex(existing => {
                const compactExisting = this.compactForComparison(existing);
                const shorterLength = Math.min(compactExisting.length, compactBlock.length);
                const longerLength = Math.max(compactExisting.length, compactBlock.length);
                const overlapRatio = longerLength === 0 ? 0 : shorterLength / longerLength;
                return compactExisting === compactBlock ||
                    ((compactExisting.includes(compactBlock) || compactBlock.includes(compactExisting)) &&
                        overlapRatio > 0.85);
            });

            if (overlappingIndex === -1) {
                uniqueBlocks.push(normalizedBlock);
                return;
            }

            const existing = uniqueBlocks[overlappingIndex];
            if (this.compactForComparison(normalizedBlock).length > this.compactForComparison(existing).length) {
                uniqueBlocks[overlappingIndex] = normalizedBlock;
            }
        });

        return uniqueBlocks.join('\n\n');
    }

    extractTextFromNode(node) {
        if (!node) {
            return '';
        }

        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
        }

        if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
            return '';
        }

        const tagName = node.tagName ? node.tagName.toLowerCase() : '';

        if (['script', 'style', 'noscript', 'svg'].includes(tagName)) {
            return '';
        }

        if (tagName === 'br') {
            return '\n';
        }

        const childText = Array.from(node.childNodes)
            .map(child => this.extractTextFromNode(child))
            .join('');

        if (!childText.trim()) {
            return '';
        }

        if (tagName === 'li') {
            const parentTagName = node.parentElement?.tagName?.toLowerCase();
            const siblingItems = Array.from(node.parentElement?.children || [])
                .filter(child => child.tagName?.toLowerCase() === 'li');
            const itemIndex = siblingItems.indexOf(node);
            const prefix = parentTagName === 'ol' ? `${itemIndex + 1}. ` : '- ';
            return `\n${prefix}${childText.trim()}\n`;
        }

        if (tagName === 'th' || tagName === 'td') {
            return `${childText.trim()}\t`;
        }

        if (tagName === 'tr') {
            return `\n${childText.trim().replace(/\t+$/g, '')}\n`;
        }

        const blockTags = new Set([
            'article', 'section', 'div', 'p', 'pre', 'blockquote',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'ul', 'ol', 'table', 'thead', 'tbody'
        ]);

        return blockTags.has(tagName) ? `\n${childText.trim()}\n` : childText;
    }

    pickLongestMeaningfulText(textCandidates) {
        const normalizedCandidates = textCandidates
            .map(text => this.normalizeExtractedText(text))
            .filter(Boolean);

        if (normalizedCandidates.length === 0) {
            return '';
        }

        return normalizedCandidates.reduce((best, current) => {
            return this.compactForComparison(current).length > this.compactForComparison(best).length
                ? current
                : best;
        }, normalizedCandidates[0]);
    }

    normalizeExtractedText(text) {
        if (!text) {
            return '';
        }

        return String(text)
            .replace(/\r\n/g, '\n')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    compactForComparison(text) {
        return this.normalizeExtractedText(text).replace(/\s+/g, ' ').trim();
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

