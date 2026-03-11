// Universal LLM Conversation Exporter - Content Processing Engine

class ContentProcessor {
    constructor() {
        this.markdownConverters = {
            'h1': (text) => `# ${text}\n\n`,
            'h2': (text) => `## ${text}\n\n`,
            'h3': (text) => `### ${text}\n\n`,
            'h4': (text) => `#### ${text}\n\n`,
            'h5': (text) => `##### ${text}\n\n`,
            'h6': (text) => `###### ${text}\n\n`,
            'p': (text) => `${text}\n\n`,
            'br': () => '\n',
            'strong': (text) => `**${text}**`,
            'b': (text) => `**${text}**`,
            'em': (text) => `*${text}*`,
            'i': (text) => `*${text}*`,
            'code': (text) => `\`${text}\``,
            'a': (text, element) => {
                const href = element.getAttribute('href');
                return href ? `[${text}](${href})` : text;
            },
            'img': (text, element) => {
                const src = element.getAttribute('src');
                const alt = element.getAttribute('alt') || text;
                return src ? `![${alt}](${src})` : `[Image: ${alt}]`;
            },
            'blockquote': (text) => text.split('\n').map(line => `> ${line}`).join('\n') + '\n\n',
            'ul': (text) => `${text}\n`,
            'ol': (text) => `${text}\n`,
            'li': (text, element, index) => {
                const parent = element.parentElement;
                const prefix = parent.tagName.toLowerCase() === 'ol' ? `${index + 1}. ` : '- ';
                return `${prefix}${text}\n`;
            }
        };
    }

    /**
     * Trigger a browser download from a content-script DOM context.
     */
    static async downloadContentAsFile({ filename, content, mimeType = 'text/plain' }) {
        if (typeof document === 'undefined' || typeof URL === 'undefined') {
            return { success: false, error: 'DOM download context is unavailable.' };
        }

        try {
            const safeName = (filename || 'conversation.txt').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
            const blob = new Blob([content ?? ''], { type: mimeType });
            const blobUrl = URL.createObjectURL(blob);

            const anchor = document.createElement('a');
            anchor.href = blobUrl;
            anchor.download = safeName;
            anchor.style.display = 'none';
            anchor.rel = 'noopener';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();

            setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
            }, 30000);

            return { success: true };
        } catch (error) {
            console.error('Failed to download content from page context:', error);
            return { success: false, error: error.message || 'Unknown download error.' };
        }
    }

    static splitFilename(filename) {
        const safeName = (filename || 'conversation.txt').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        const lastDotIndex = safeName.lastIndexOf('.');

        if (lastDotIndex > 0 && lastDotIndex < safeName.length - 1) {
            return {
                baseName: safeName.slice(0, lastDotIndex),
                extension: safeName.slice(lastDotIndex)
            };
        }

        return {
            baseName: safeName,
            extension: '.txt'
        };
    }

    static buildPartFilename(filename, partNumber, totalParts) {
        const { baseName, extension } = ContentProcessor.splitFilename(filename);
        const digits = Math.max(3, String(totalParts).length);
        const paddedPart = String(partNumber).padStart(digits, '0');
        return `${baseName}_part_${paddedPart}${extension}`;
    }

    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Process conversation data into text format
     * @param {Array} conversationData - Array of message objects
     * @param {string} format - Output format (always 'text')
     * @param {Object} options - Processing options
     * @returns {string} - Formatted conversation content
     */
    processConversation(conversationData, format, options = {}) {
        const {
            includeTimestamps = false,
            includeMetadata = true,
            platform = 'unknown',
            url = ''
        } = options;

        // Always return text format
        return this.toText(conversationData, { includeTimestamps, includeMetadata, platform, url });
    }

    /**
     * Convert conversation to plain text format
     */
    toText(conversationData, options) {
        let text = '';

        // Add URL at the top with validation
        if (options.url && this.isValidUrl(options.url)) {
            text += `chat url: ${options.url}\n\n`;
        }

        // Process each message with two newlines between articles
        conversationData.forEach((message, index) => {
            text += this.messageToText(message, options);

            // Add two newlines between articles (except after the last one)
            if (index < conversationData.length - 1) {
                text += '\n\n';
            }
        });

        return text.trim();
    }

    /**
     * Convert conversation to chunked plain text parts.
     */
    toTextChunks(conversationData, options = {}, chunkOptions = {}) {
        const maxChunkCharsRaw = Number(chunkOptions.maxChunkChars);
        const maxChunkChars = Number.isFinite(maxChunkCharsRaw)
            ? Math.max(50000, Math.floor(maxChunkCharsRaw))
            : 700000;

        const chunks = [];
        const hasValidUrl = options.url && this.isValidUrl(options.url);
        let currentText = hasValidUrl ? `chat url: ${options.url}\n\n` : '';
        let currentChunkMessageCount = 0;
        let chunkStartMessageIndex = 0;

        for (let index = 0; index < conversationData.length; index++) {
            const messageText = this.messageToText(conversationData[index], options);
            const separator = index < conversationData.length - 1 ? '\n\n' : '';
            const messageBlock = `${messageText}${separator}`;

            // Avoid producing a header-only chunk when first message is large.
            if (currentChunkMessageCount > 0 && (currentText.length + messageBlock.length > maxChunkChars)) {
                chunks.push({
                    text: currentText.trimEnd(),
                    startMessageIndex: chunkStartMessageIndex,
                    endMessageIndex: index - 1
                });
                currentText = '';
                currentChunkMessageCount = 0;
                chunkStartMessageIndex = index;
            }

            currentText += messageBlock;
            currentChunkMessageCount++;
        }

        if (currentText.trim().length > 0) {
            chunks.push({
                text: currentText.trimEnd(),
                startMessageIndex: chunkStartMessageIndex,
                endMessageIndex: Math.max(0, conversationData.length - 1)
            });
        }

        return chunks;
    }

    buildChunkHeader(partNumber, totalParts, chunk, platform = 'LLM') {
        if (totalParts <= 1) {
            return '';
        }

        const safePlatform = platform || 'LLM';
        const start = chunk.startMessageIndex + 1;
        const end = chunk.endMessageIndex + 1;
        return `[${safePlatform} export part ${partNumber} of ${totalParts}]\nmessages: ${start}-${end}\n\n`;
    }

    /**
     * Export conversation as one or more files based on chunk size limits.
     */
    async downloadConversationInChunks(conversationData, options = {}, downloadOptions = {}) {
        const {
            filename = 'conversation.txt',
            mimeType = 'text/plain;charset=utf-8',
            maxChunkChars = 700000,
            delayMs = 120
        } = downloadOptions;

        const chunks = this.toTextChunks(conversationData, options, { maxChunkChars });
        if (chunks.length === 0) {
            return { success: false, error: 'No conversation content to export.' };
        }

        const totalParts = chunks.length;
        const downloadedFiles = [];

        for (let i = 0; i < chunks.length; i++) {
            const partNumber = i + 1;
            const chunk = chunks[i];
            const partFilename = totalParts === 1
                ? filename
                : ContentProcessor.buildPartFilename(filename, partNumber, totalParts);
            const content = `${this.buildChunkHeader(partNumber, totalParts, chunk, options.platform)}${chunk.text}`;

            const result = await ContentProcessor.downloadContentAsFile({
                filename: partFilename,
                content,
                mimeType
            });

            if (!result.success) {
                return {
                    success: false,
                    error: result.error || `Failed downloading part ${partNumber}.`,
                    failedPart: partNumber,
                    parts: totalParts,
                    files: downloadedFiles
                };
            }

            downloadedFiles.push(partFilename);

            if (partNumber < totalParts && delayMs > 0) {
                await ContentProcessor.sleep(delayMs);
            }
        }

        return {
            success: true,
            parts: totalParts,
            files: downloadedFiles
        };
    }

    /**
     * Convert a single message to plain text
     */
    messageToText(message, options) {
        let text = '';

        // Add role header
        const roleDisplay = this.getRoleDisplay(message.role);
        text += `${roleDisplay}:\n`;

        // Convert content to plain text (no timestamps)
        const content = message && message.isPlainText
            ? this.normalizePlainText(message.content)
            : this.htmlToText(message.content);
        text += content;

        return text;
    }

    normalizePlainText(text) {
        if (!text) return '';
        return String(text).replace(/\r\n/g, '\n').trim();
    }

    /**
     * Convert HTML content to Markdown
     */
    htmlToMarkdown(htmlContent) {
        if (!htmlContent) return '';

        // Only works in content script context where document is available
        if (typeof document === 'undefined') {
            console.warn('htmlToMarkdown: document not available, returning plain text');
            return this.stripHtmlTags(htmlContent);
        }

        // Create a temporary DOM element to parse HTML safely
        const tempDiv = document.createElement('div');
        // SECURITY FIX: Use safe HTML parsing instead of innerHTML
        this.safeSetHTML(tempDiv, htmlContent);

        return this.processElementToMarkdown(tempDiv);
    }

    /**
     * Convert HTML content to plain text
     */
    htmlToText(htmlContent) {
        if (!htmlContent) return '';

        // Only works in content script context where document is available
        if (typeof document === 'undefined') {
            return this.stripHtmlTags(htmlContent);
        }

        // Create a temporary DOM element to parse HTML safely
        const tempDiv = document.createElement('div');
        // SECURITY FIX: Use safe HTML parsing instead of innerHTML
        this.safeSetHTML(tempDiv, htmlContent);

        // Handle special elements for better formatting
        // Use try-catch for each processing step to ensure one failure doesn't stop everything
        try {
            this.processTablesForText(tempDiv);
        } catch (error) {
            console.warn('Table processing failed, continuing with text extraction:', error);
        }

        try {
            this.processCodeBlocksForText(tempDiv);
        } catch (error) {
            console.warn('Code block processing failed, continuing with text extraction:', error);
        }

        try {
            this.processListsForText(tempDiv);
        } catch (error) {
            console.warn('List processing failed, continuing with text extraction:', error);
        }

        try {
            this.processBlockElementsForText(tempDiv);
        } catch (error) {
            console.warn('Block element processing failed, continuing with text extraction:', error);
        }

        return tempDiv.textContent || tempDiv.innerText || '';
    }

    /**
     * Safely set HTML content without XSS vulnerabilities
     * Uses DOMParser for safe HTML parsing
     */
    safeSetHTML(element, htmlContent) {
        if (!htmlContent) return;

        try {
            // Use DOMParser for safe HTML parsing
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');

            // Remove potentially dangerous elements
            this.sanitizeDocument(doc);

            // Clear the target element
            element.innerHTML = '';

            // Append sanitized content
            while (doc.body.firstChild) {
                element.appendChild(doc.body.firstChild);
            }
        } catch (error) {
            console.warn('Failed to parse HTML safely, falling back to text content:', error);
            element.textContent = this.stripHtmlTags(htmlContent);
        }
    }

    /**
     * Remove potentially dangerous elements and attributes from parsed document
     */
    sanitizeDocument(doc) {
        // Remove script tags
        const scripts = doc.querySelectorAll('script');
        scripts.forEach(script => script.remove());

        // Remove style tags
        const styles = doc.querySelectorAll('style');
        styles.forEach(style => style.remove());

        // Remove on* event attributes from all elements
        const allElements = doc.querySelectorAll('*');
        allElements.forEach(element => {
            // Remove all event handler attributes
            for (let i = element.attributes.length - 1; i >= 0; i--) {
                const attr = element.attributes[i];
                if (attr.name.toLowerCase().startsWith('on')) {
                    element.removeAttribute(attr.name);
                }
            }

            // Remove dangerous attributes
            const dangerousAttrs = ['javascript:', 'data:', 'vbscript:', 'file:'];
            ['href', 'src', 'action', 'formaction', 'data'].forEach(attrName => {
                const attrValue = element.getAttribute(attrName);
                if (attrValue) {
                    const lowerValue = attrValue.toLowerCase().trim();
                    if (dangerousAttrs.some(dangerous => lowerValue.startsWith(dangerous))) {
                        element.removeAttribute(attrName);
                    }
                }
            });
        });
    }

    /**
     * Process DOM element to Markdown recursively
     */
    processElementToMarkdown(element) {
        let result = '';

        for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                result += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tagName = node.tagName.toLowerCase();
                const textContent = this.processElementToMarkdown(node);

                if (tagName === 'table') {
                    result += this.tableToMarkdown(node);
                } else if (tagName === 'pre') {
                    result += this.preToMarkdown(node);
                } else if (this.markdownConverters[tagName]) {
                    const converter = this.markdownConverters[tagName];
                    const index = Array.from(node.parentElement?.children || []).indexOf(node);
                    result += converter(textContent, node, index);
                } else {
                    result += textContent;
                }
            }
        }

        return result;
    }

    /**
     * Convert HTML table to Markdown table
     */
    tableToMarkdown(tableElement) {
        const rows = Array.from(tableElement.querySelectorAll('tr'));
        if (rows.length === 0) return '';

        let markdown = '\n';
        
        rows.forEach((row, rowIndex) => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            const cellContents = cells.map(cell => 
                this.htmlToText(cell.innerHTML).replace(/\|/g, '\\|').trim()
            );
            
            markdown += `| ${cellContents.join(' | ')} |\n`;
            
            // Add header separator after first row
            if (rowIndex === 0 && cells.length > 0) {
                markdown += `| ${cells.map(() => '---').join(' | ')} |\n`;
            }
        });
        
        return markdown + '\n';
    }

    /**
     * Convert pre/code blocks to Markdown
     */
    preToMarkdown(preElement) {
        const codeElement = preElement.querySelector('code');
        const content = codeElement ? codeElement.textContent : preElement.textContent;
        const language = this.detectCodeLanguage(preElement);
        
        return `\n\`\`\`${language}\n${content}\n\`\`\`\n\n`;
    }

    /**
     * Process tables for plain text output
     */
    processTablesForText(element) {
        const tables = element.querySelectorAll('table');
        tables.forEach(table => {
            try {
                const textTable = this.tableToText(table);
                table.replaceWith(document.createTextNode(textTable));
            } catch (error) {
                console.warn('Failed to process table, falling back to text content:', error);
                // Fallback: just get the text content of the table
                const fallbackText = `\n${table.textContent || ''}\n`;
                table.replaceWith(document.createTextNode(fallbackText));
            }
        });
    }

    /**
     * Convert table to plain text format
     */
    tableToText(tableElement) {
        try {
            const rows = Array.from(tableElement.querySelectorAll('tr'));
            let text = '\n';

            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td, th'));
                const cellContents = cells.map(cell => {
                    try {
                        return (cell.textContent || '').trim();
                    } catch (e) {
                        return '';
                    }
                });
                text += cellContents.join('\t') + '\n';
            });

            return text + '\n';
        } catch (error) {
            // If table parsing completely fails, just return the text content
            return `\n${tableElement.textContent || ''}\n`;
        }
    }

    /**
     * Process code blocks for plain text
     */
    processCodeBlocksForText(element) {
        const codeBlocks = element.querySelectorAll('pre, code');
        codeBlocks.forEach(block => {
            try {
                const content = block.textContent || '';
                block.replaceWith(document.createTextNode(`\n${content}\n`));
            } catch (error) {
                console.warn('Failed to process code block, falling back to text content:', error);
                // Fallback: just get the text content
                const fallbackText = `\n${block.textContent || ''}\n`;
                block.replaceWith(document.createTextNode(fallbackText));
            }
        });
    }

    /**
     * Process lists for plain text
     */
    processListsForText(element) {
        const lists = element.querySelectorAll('ul, ol');
        lists.forEach(list => {
            try {
                const items = Array.from(list.querySelectorAll('li'));
                const isOrdered = list.tagName.toLowerCase() === 'ol';

                let text = '\n';
                items.forEach((item, index) => {
                    try {
                        const prefix = isOrdered ? `${index + 1}. ` : '• ';
                        text += `${prefix}${(item.textContent || '').trim()}\n`;
                    } catch (e) {
                        // Skip problematic list items but continue with others
                        console.warn('Failed to process list item, skipping:', e);
                    }
                });
                text += '\n';

                list.replaceWith(document.createTextNode(text));
            } catch (error) {
                console.warn('Failed to process list, falling back to text content:', error);
                // Fallback: just get the text content of the list
                const fallbackText = `\n${list.textContent || ''}\n`;
                list.replaceWith(document.createTextNode(fallbackText));
            }
        });
    }

    /**
     * Process block elements to ensure proper line breaks
     */
    processBlockElementsForText(element) {
        // STEP 1: Add spacing between sibling elements BEFORE destroying DOM structure
        this.addSpacingBetweenSiblings(element);

        // STEP 2: Handle line break elements
        const lineBreaks = element.querySelectorAll('br');
        lineBreaks.forEach(br => {
            br.replaceWith(document.createTextNode('\n'));
        });

        // STEP 3: Process block elements to ensure proper line breaks
        const blockElements = element.querySelectorAll('div, p, h1, h2, h3, h4, h5, h6, blockquote, section, article, header, footer, nav, aside, main');
        blockElements.forEach(block => {
            // Add line breaks around block elements if they don't already have them
            const text = block.textContent;
            if (text && text.trim()) {
                // Only add breaks if this element has meaningful content
                const textNode = document.createTextNode(`\n${text.trim()}\n`);
                block.replaceWith(textNode);
            }
        });
    }

    /**
     * Add spacing between sibling elements that should be separated
     * This runs BEFORE elements are replaced, preserving DOM structure for better decisions
     */
    addSpacingBetweenSiblings(element) {
        // Recursively process all containers first
        const containers = element.querySelectorAll('div, span, section, article, header, footer, nav, aside, main');
        containers.forEach(container => {
            this.processDirectChildren(container);
        });

        // Process the root element's direct children
        this.processDirectChildren(element);
    }

    /**
     * Process direct children of a container to add appropriate spacing
     */
    processDirectChildren(container) {
        const children = Array.from(container.children);

        for (let i = 0; i < children.length - 1; i++) {
            const current = children[i];
            const next = children[i + 1];

            // Get text content for both elements
            const currentText = current.textContent ? current.textContent.trim() : '';
            const nextText = next.textContent ? next.textContent.trim() : '';

            // Skip if either element doesn't have meaningful content
            if (!currentText || !nextText || currentText.length < 3 || nextText.length < 3) {
                continue;
            }

            // Determine if these elements should be separated
            const shouldSeparate = this.shouldSeparateElements(current, next, currentText, nextText);

            if (shouldSeparate) {
                // Insert spacing between the elements
                const spacer = document.createTextNode('\n');
                container.insertBefore(spacer, next);
            }
        }
    }

    /**
     * Determine if two sibling elements should be separated with a newline
     */
    shouldSeparateElements(current, next, currentText, nextText) {
        // Always separate if one is a block element
        const blockTags = ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'section', 'article'];
        if (blockTags.includes(current.tagName?.toLowerCase()) || blockTags.includes(next.tagName?.toLowerCase())) {
            return true;
        }

        // Separate spans that contain substantial content (likely UI messages)
        if (current.tagName?.toLowerCase() === 'span' && next.tagName?.toLowerCase() === 'span') {
            // If both spans have substantial content, separate them
            if (currentText.length > 10 && nextText.length > 10) {
                return true;
            }
        }

        // Separate buttons from other content
        if (current.tagName?.toLowerCase() === 'button' || next.tagName?.toLowerCase() === 'button') {
            return true;
        }

        // Don't separate short inline elements (like single words, icons, etc.)
        return false;
    }

    /**
     * Generate Markdown header with metadata
     */
    generateMarkdownHeader(conversationData, platform) {
        const now = new Date();
        const title = this.generateConversationTitle(conversationData);
        
        return `# ${title}\n\n` +
               `**Platform:** ${platform}\n` +
               `**Export Date:** ${now.toISOString()}\n` +
               `**Message Count:** ${conversationData.length}\n\n` +
               `---\n\n`;
    }

    /**
     * Generate conversation title from first message
     */
    generateConversationTitle(conversationData) {
        if (conversationData.length === 0) return 'Empty Conversation';
        
        const firstMessage = conversationData.find(msg => msg.role === 'user');
        if (!firstMessage) return 'LLM Conversation';
        
        const content = this.htmlToText(firstMessage.content);
        const title = content.substring(0, 50).trim();
        return title.length < content.length ? `${title}...` : title;
    }

    /**
     * Get display name for message role
     */
    getRoleDisplay(role) {
        const roleMap = {
            'user': 'User',
            'assistant': 'Assistant',
            'system': 'System',
            'claude': 'Claude',
            'gpt': 'ChatGPT',
            'gemini': 'Gemini',
            'grok': 'Grok'
        };
        return roleMap[role] || role.charAt(0).toUpperCase() + role.slice(1);
    }

    /**
     * Detect programming language from code block
     */
    detectCodeLanguage(element) {
        // Look for language hints in class names
        const classNames = element.className || '';
        const langMatch = classNames.match(/language-(\w+)|lang-(\w+)/);
        if (langMatch) {
            return langMatch[1] || langMatch[2];
        }
        
        // Look for data attributes
        const dataLang = element.getAttribute('data-language');
        if (dataLang) return dataLang;
        
        return '';
    }

    /**
     * Validate URL for security
     */
    isValidUrl(url) {
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
                'grok.com'
            ];

            return allowedDomains.some(domain =>
                urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
            );
        } catch {
            return false;
        }
    }

    /**
     * Fallback method to strip HTML tags when DOM is not available
     */
    stripHtmlTags(html) {
        if (!html) return '';

        // Simple regex-based HTML tag removal (fallback for service worker context)
        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove style tags
            .replace(/<[^>]*>/g, '') // Remove all other HTML tags
            .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
            .replace(/&amp;/g, '&') // Replace HTML entities
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }
}

// Export for use in other modules - Context aware
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContentProcessor;
} else {
    // Detect execution context and use appropriate global scope
    const isServiceWorker = typeof window === 'undefined' && typeof self !== 'undefined';
    const globalScope = isServiceWorker ? self : (typeof window !== 'undefined' ? window : globalThis);

    globalScope.ContentProcessor = ContentProcessor;
}
