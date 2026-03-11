// Universal LLM Conversation Exporter - Grok Extractor

class GrokExtractor {
    constructor() {
        this.selectors = {
            // Message bubbles containing both user and Grok messages
            messageBubble: 'div[class*="message-bubble"]',

            // Elements to exclude (thinking containers)
            thinkingContainer: 'div[class*="thinking-container"]'
        };
    }

    /**
     * Extract conversation from Grok interface
     */
    extractConversation() {
        console.log('Grok Extractor: Starting extraction...');

        const messages = [];

        // Find all message bubble elements
        const messageBubbles = Array.from(document.querySelectorAll(this.selectors.messageBubble));

        // Filter out thinking containers
        const validMessages = messageBubbles.filter(element => {
            // Check if this element or any parent contains thinking-container class
            let current = element;
            while (current) {
                if (current.className && current.className.includes('thinking-container')) {
                    return false;
                }
                current = current.parentElement;
            }
            return true;
        });

        console.log(`Found ${messageBubbles.length} total message bubbles, ${validMessages.length} valid messages after filtering`);

        // Process each valid message bubble
        validMessages.forEach((element) => {
            // Use plain text extraction for lower memory usage on large threads.
            let content = '';
            try {
                content = element.innerText || element.textContent || '';
            } catch (error) {
                content = element.textContent || '';
            }

            if (content.trim()) {
                // Try to determine if this is a user or assistant message
                // This is a simple heuristic - you may need to adjust based on Grok's actual HTML structure
                const isUserMessage = this.isUserMessage(element);
                const role = isUserMessage ? 'user' : 'assistant';
                const prefix = isUserMessage ? 'User: ' : 'Grok: ';

                messages.push({
                    role: role,
                    content: `${prefix}${content.trim()}`,
                    isPlainText: true
                });
            }
        });

        if (messages.length === 0) {
            throw new Error('No messages found. Make sure you are on a Grok conversation page.');
        }

        console.log(`Grok Extractor: Successfully extracted ${messages.length} messages`);
        return messages;
    }

    /**
     * Determine if a message bubble is from the user
     * This is a heuristic that may need adjustment based on Grok's actual HTML structure
     */
    isUserMessage(element) {
        // Look for common indicators of user messages
        const elementText = element.className || '';
        const parentText = element.parentElement?.className || '';

        // Common patterns for user messages (adjust as needed)
        if (elementText.includes('user') || parentText.includes('user')) {
            return true;
        }

        // If we can't determine, alternate between user and assistant
        // This is a fallback - ideally we'd have better selectors
        const allMessages = Array.from(document.querySelectorAll(this.selectors.messageBubble));
        const index = allMessages.indexOf(element);
        return index % 2 === 0; // Assume first message is user, then alternating
    }

    // All complex methods removed - using simple element selection
}

// Export for use in main extractor
if (typeof window !== 'undefined') {
    window.GrokExtractor = GrokExtractor;
}

// Message listener for content script
if (typeof window.grok_extractor_injected === 'undefined') {
    window.grok_extractor_injected = true;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.action === 'extractConversation') {
            (async () => {
                try {
                    const extractor = new GrokExtractor();
                    const conversationData = extractor.extractConversation();

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
                                platform: 'Grok',
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
                            console.log(`Grok export split into ${exportResult.parts} files.`);
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
                    console.error('Grok extraction error:', error);
                    sendResponse({
                        success: false,
                        error: error.message,
                    });
                }
            })();
        }
        return true;
    });
}
