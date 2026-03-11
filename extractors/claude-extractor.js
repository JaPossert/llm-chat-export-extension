// Universal LLM Conversation Exporter - Claude Extractor (Simple and Direct)

class ClaudeExtractor {
  constructor() {
    // Use the correct approach based on user feedback
    this.selectors = {
      // Main container selector
      chatContainer: "div.flex-1.flex.flex-col.gap-3.px-4",
      titleElement: "button[data-testid='chat-menu-trigger']",
      // Claude still uses font-claude-response, and we need to look for standard-markdown content
      messageElements: "div.font-claude-response, div.font-user-message, [data-testid='user-message']",
      // Key insight: Claude messages are in elements containing "standard-markdown"
      claudeContentSelector: '[class*="standard-markdown"]'
    };
  }

  // Test method to run extraction and log results without full extension
  testExtraction() {
    console.log('=== Claude Extractor Test ===');
    const { elements, title, centralContainer } = this.getContents();
    console.log(`Title: ${title}`);
    console.log(`Central container found: ${centralContainer ? 'Yes' : 'No'}`);
    console.log(`Elements found: ${elements.length}`);

    elements.forEach((el, i) => {
      const text = el.textContent?.trim();
      const preview = text ? text.substring(0, 100) + (text.length > 100 ? '...' : '') : 'No text';
      console.log(`Element ${i}: ${el.className} - ${preview}`);
    });

    return { elements, title, centralContainer };
  }

  getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  getContents() {
    const titleEle = document.querySelector(this.selectors.titleElement);
    const titleText = titleEle ? titleEle.textContent.trim() : "Claude Chat";

    // Get the chat container and find all message elements in order
    let elements = [];
    let chatContainer = null;

    try {
      chatContainer = document.querySelector(this.selectors.chatContainer);
      console.log('Chat container found:', chatContainer);

      if (chatContainer) {
        // Get all potential message elements in document order (top to bottom)
        elements = chatContainer.querySelectorAll(this.selectors.messageElements);
        console.log(`Found ${elements.length} elements in chat container with selectors: ${this.selectors.messageElements}`);
      }
    } catch (error) {
      console.log('Chat container approach failed:', error);
    }

    // Fallback to document-wide search if chat container method fails
    if (elements.length === 0) {
      console.log('Falling back to document-wide selector approach');
      elements = document.querySelectorAll(this.selectors.messageElements);
      console.log(`Found ${elements.length} total elements with selectors: ${this.selectors.messageElements}`);
    }

    return {
      elements: Array.from(elements),
      title: titleText,
      chatContainer: chatContainer
    };
  }

  consoleSave(data, title) {
    let filename = title ?
      title.trim()
        .toLowerCase()
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '-')
        .replace(/^[^\w\d]+|[^\w\d]+$/g, '')
        .substring(0, 100) || "claude"
      : "claude";

    filename += ".md";
    const mimeType = "text/markdown";

    const blob = new Blob([data], { type: mimeType });
    const a = document.createElement("a");
    a.download = filename;
    a.href = window.URL.createObjectURL(blob);

    const event = new MouseEvent("click", {
      canBubble: true,
      cancelable: false,
      view: window,
      detail: 0,
      screenX: 0,
      screenY: 0,
      clientX: 0,
      clientY: 0,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      button: 0,
      relatedTarget: null,
    });

    a.dispatchEvent(event);

    setTimeout(() => {
      window.URL.revokeObjectURL(a.href);
    }, 1000);
  }

  // Main extraction method
  async extractConversation() {
    console.log('ClaudeExtractor: Starting extraction with proven working approach...');

    let markdown = "";
    const { elements, title, chatContainer } = this.getContents();

    console.log(`Using chat container: ${chatContainer ? 'Yes' : 'No'}`);
    console.log(`Found ${elements.length} message elements`);

    const timestamp = this.getTimestamp();
    markdown += `# ${title}\n\`${timestamp}\`\n\n`;

    for (let i = 0; i < elements.length; i++) {
      const ele = elements[i];
      const elementText = (ele.textContent || '').trim();
      const preview = elementText.substring(0, 50).replace(/\n/g, ' ') + (elementText.length > 50 ? '...' : '');

      console.log(`Processing element ${i}: ${ele.className}`);
      console.log(`  Text preview: "${preview}"`);

      // Skip thinking sections (collapsible elements with specific structure)
      if (this.isThinkingSection(ele)) {
        console.log(`   SKIPPING thinking section ${i}: "${preview}"`);
        continue;
      }

      // Handle Claude responses - look for standard-markdown content
      if (ele.classList.contains("font-claude-response")) {
        console.log(`   PROCESSING Claude response ${i}: "${preview}"`);
        markdown += `_Claude_:\n`;

        // Look for standard-markdown content as suggested by user
        const standardMarkdownElements = ele.querySelectorAll(this.selectors.claudeContentSelector);
        console.log(`   Found ${standardMarkdownElements.length} standard-markdown elements`);

        if (standardMarkdownElements.length > 0) {
          // Process all standard-markdown elements in order
          for (const markdownEl of standardMarkdownElements) {
            const extractedContent = this.processChildNodes(markdownEl.childNodes);
            markdown += extractedContent;
            console.log(`   Extracted ${extractedContent.length} characters from standard-markdown element`);
          }
        } else {
          console.log(`   No standard-markdown elements found, using fallback`);
          // Fallback to original approach
          const firstChild = ele.firstChild;
          if (firstChild && firstChild.nodeType === Node.ELEMENT_NODE) {
            let secondChild = firstChild.firstChild;
            if (!secondChild) secondChild = firstChild;
            const extractedContent = this.processChildNodes(secondChild.childNodes);
            markdown += extractedContent;
            console.log(`   Extracted ${extractedContent.length} characters from Claude response (fallback)`);
          }
        }
      }
      // Handle user messages
      else {
        console.log(`   PROCESSING User message ${i}: "${preview}"`);
        markdown += `_Human_:\n`;

        // Check for attachments first
        const attachmentContent = this.processUserAttachments(ele);
        if (attachmentContent) {
          console.log(`   Found user attachments: "${attachmentContent.trim()}"`);
          markdown += attachmentContent;
        }

        // Then process text content
        const textContent = this.processChildNodes(ele.childNodes);
        if (textContent.trim()) {
          const textPreview = textContent.substring(0, 50).replace(/\n/g, ' ') + (textContent.length > 50 ? '...' : '');
          console.log(`   Extracted user text: "${textPreview}"`);
          markdown += textContent;
        } else {
          console.log(`   No text content extracted from user message`);
        }
      }

      markdown += "\n";
    }

    // Convert to messages format expected by the extension
    const messages = this.parseMarkdownToMessages(markdown);

    console.log(`ClaudeExtractor: Extracted ${messages.length} messages`);
    return messages;
  }

  // Check if element is a thinking section or should be filtered out
  isThinkingSection(element) {
    // Check for thinking section class indicators
    const hasThinkingClass = element.classList.contains('text-text-300');

    // Look for collapsible thinking sections - these have specific patterns
    const hasCollapsibleButton = element.querySelector('button.group\\/row');
    const hasCollapsibleContent = element.querySelector('.overflow-hidden.shrink-0');
    const hasThinkingStructure = element.querySelector('.ease-out.rounded-lg.border-0\\.5');

    const text = element.textContent || '';

    // Check if this is a collapsed thinking section (has the collapsible structure)
    const isCollapsibleThinking = hasCollapsibleButton && (hasCollapsibleContent || hasThinkingStructure);

    // Check if this is content inside a thinking section (has the thinking class)
    const isThinkingContent = hasThinkingClass;

    // Check if this is just a model name or very short content that should be filtered
    const isModelName = text.trim().length < 20 &&
                       (text.includes('Sonnet') || text.includes('Claude') || text.includes('GPT'));

    // For Claude responses, only filter if it has standard-markdown content but is a thinking section
    const isClaude = element.classList.contains('font-claude-response');
    const hasStandardMarkdown = element.querySelector('[class*="standard-markdown"]');

    // If it's a Claude response with standard-markdown, don't filter it (we want the content)
    if (isClaude && hasStandardMarkdown && !hasThinkingClass) {
      return false;
    }

    const shouldFilter = isCollapsibleThinking || isThinkingContent || isModelName;

    if (shouldFilter) {
      console.log(`   Filtering element - thinking: ${isThinkingContent}, collapsible: ${isCollapsibleThinking}, model: ${isModelName}, text: "${text.substring(0, 50)}..."`);
    }

    return shouldFilter;
  }

  // Process Claude content from standard-markdown container
  processClaudeContent(container) {
    return this.processChildNodes(container.childNodes);
  }

  // Process user attachments
  processUserAttachments(element) {
    let result = '';

    // Look for file attachments with various patterns
    const fileAttachments = element.querySelectorAll('[data-testid="file-thumbnail"]');
    if (fileAttachments.length > 0) {
      result += `[User uploaded ${fileAttachments.length} file(s)]\n`;
    }

    // Look for images
    const images = element.querySelectorAll('img');
    if (images.length > 0) {
      result += `[User uploaded ${images.length} image(s)]\n`;
    }

    // Look for pasted content (like the screenshot you showed)
    const pastedContent = element.querySelector('div[class*="border"][class*="rounded"]');
    if (pastedContent && element.textContent.includes('PASTED')) {
      result += `[User pasted content]\n`;
      // Try to extract any text from the pasted content
      const pastedText = pastedContent.textContent.trim();
      if (pastedText && pastedText !== 'PASTED') {
        result += `Pasted content: ${pastedText}\n`;
      }
    }

    // Look for any other attachment indicators
    const attachmentDivs = element.querySelectorAll('div[class*="bg-"][class*="border"]');
    if (attachmentDivs.length > 0 && !result) {
      // Check if any of these contain file-like content
      for (const div of attachmentDivs) {
        const text = div.textContent.trim();
        if (text && text.length > 10 && text.length < 500) { // Reasonable attachment text length
          result += `[User attachment: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}]\n`;
          break;
        }
      }
    }

    return result;
  }

  // Process child nodes (extracted from original logic)
  processChildNodes(childNodes) {
    let markdown = '';
    for (let n = 0; n < childNodes.length; n++) {
      const childNode = childNodes[n];

      if (childNode.nodeType === Node.ELEMENT_NODE) {
        const tag = childNode.tagName;
        const text = childNode.textContent;

        // Paragraphs
        if (tag === "P") {
          markdown += `${text}\n`;
        }

        // Headings
        if (tag === "H1") markdown += `# ${text}\n`;
        if (tag === "H2") markdown += `## ${text}\n`;
        if (tag === "H3") markdown += `### ${text}\n`;
        if (tag === "H4") markdown += `#### ${text}\n`;
        if (tag === "H5") markdown += `##### ${text}\n`;
        if (tag === "H6") markdown += `###### ${text}\n`;

        // Get list items
        if (tag === "OL") {
          childNode.childNodes.forEach((listItemNode, index) => {
            if (
              listItemNode.nodeType === Node.ELEMENT_NODE &&
              listItemNode.tagName === "LI"
            ) {
              markdown += `${index + 1}. ${listItemNode.textContent}\n`;
            }
          });
        }
        if (tag === "UL") {
          childNode.childNodes.forEach((listItemNode) => {
            if (
              listItemNode.nodeType === Node.ELEMENT_NODE &&
              listItemNode.tagName === "LI"
            ) {
              markdown += `- ${listItemNode.textContent}\n`;
            }
          });
        }

        // Code blocks
        if (tag === "PRE") {
          const codeEle = childNode.querySelector("code");
          if (codeEle) {
            const codeText = codeEle.textContent;
            const codeBlockLang = codeEle.classList[0] ? codeEle.classList[0].split("-")[1] : "";
            markdown += `\`\`\`${codeBlockLang}\n${codeText}\n\`\`\`\n`;
          }
        }

        // Tables
        if (tag === "TABLE") {
          // Get table sections
          let tableMarkdown = "";
          childNode.childNodes.forEach((tableSectionNode) => {
            if (
              tableSectionNode.nodeType === Node.ELEMENT_NODE &&
              (tableSectionNode.tagName === "THEAD" ||
                tableSectionNode.tagName === "TBODY")
            ) {
              // Get table rows
              let tableRows = "";
              let tableColCount = 0;
              tableSectionNode.childNodes.forEach((tableRowNode) => {
                if (
                  tableRowNode.nodeType === Node.ELEMENT_NODE &&
                  tableRowNode.tagName === "TR"
                ) {
                  // Get table cells
                  let tableCells = "";
                  tableRowNode.childNodes.forEach((tableCellNode) => {
                    if (
                      tableCellNode.nodeType === Node.ELEMENT_NODE &&
                      (tableCellNode.tagName === "TD" ||
                        tableCellNode.tagName === "TH")
                    ) {
                      tableCells += `| ${tableCellNode.textContent} `;
                      if (tableSectionNode.tagName === "THEAD") {
                        tableColCount++;
                      }
                    }
                  });
                  tableRows += `${tableCells}|\n`;
                }
              });

              tableMarkdown += tableRows;

              if (tableSectionNode.tagName === "THEAD") {
                const headerRowDivider = `| ${Array(tableColCount)
                  .fill("---")
                  .join(" | ")} |\n`;
                tableMarkdown += headerRowDivider;
              }
            }
          });
          markdown += tableMarkdown;
        }

        // Paragraph break after each element
        markdown += "\n";
      }
    }

    return markdown;
  }

  // Alternative extraction method using central container
  extractFromCentralContainer(centralContainer, title, timestamp) {
    console.log('Extracting from central container...');

    let markdown = `# ${title}\n\`${timestamp}\`\n\n`;

    // Look for message patterns in the central container
    // Try to find elements that look like messages based on structure
    const possibleMessages = centralContainer.querySelectorAll('div[class*="font-"], article, div[data-testid]');

    console.log(`Found ${possibleMessages.length} possible message elements in central container`);

    for (let i = 0; i < possibleMessages.length; i++) {
      const element = possibleMessages[i];
      const text = element.textContent?.trim();

      if (!text || text.length < 10) continue; // Skip very short content

      // Try to determine if this is a user or assistant message
      const isUserMessage = element.classList.contains('font-user-message') ||
                           element.hasAttribute('data-testid') && element.getAttribute('data-testid').includes('user');
      const isAssistantMessage = element.classList.contains('font-claude-response') ||
                                element.classList.contains('font-claude-message');

      if (isUserMessage) {
        markdown += `_Human_:\n${text}\n\n`;
        console.log(`Added user message: ${text.substring(0, 50)}...`);
      } else if (isAssistantMessage) {
        markdown += `_Claude_:\n${text}\n\n`;
        console.log(`Added Claude message: ${text.substring(0, 50)}...`);
      } else {
        // Try to guess based on content patterns
        const looksLikeUserMessage = text.includes('?') || text.length < 200;
        if (looksLikeUserMessage) {
          markdown += `_Human_:\n${text}\n\n`;
          console.log(`Guessed user message: ${text.substring(0, 50)}...`);
        } else {
          markdown += `_Claude_:\n${text}\n\n`;
          console.log(`Guessed Claude message: ${text.substring(0, 50)}...`);
        }
      }
    }

    return this.parseMarkdownToMessages(markdown);
  }

  // Helper method to convert markdown back to messages format
  parseMarkdownToMessages(markdown) {
    const messages = [];
    const lines = markdown.split('\n');
    let currentMessage = null;

    for (const line of lines) {
      if (line.startsWith('_Claude_:')) {
        if (currentMessage) messages.push(currentMessage);
        currentMessage = { role: 'assistant', content: '', isPlainText: true };
      } else if (line.startsWith('_Human_:')) {
        if (currentMessage) messages.push(currentMessage);
        currentMessage = { role: 'user', content: '', isPlainText: true };
      } else if (currentMessage && line.trim()) {
        currentMessage.content += (currentMessage.content ? '\n' : '') + line;
      }
    }

    if (currentMessage) messages.push(currentMessage);
    return messages.filter(m => m.content.trim());
  }
}

async function downloadFromPageContext(filename, content) {
  try {
    const safeName = (filename || 'conversation.txt').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const blob = new Blob([content ?? ''], { type: 'text/plain;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = safeName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 30000);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Download failed in page context.' };
  }
}

function splitFilename(filename) {
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

function buildPartFilename(filename, partNumber, totalParts) {
  const { baseName, extension } = splitFilename(filename);
  const digits = Math.max(3, String(totalParts).length);
  return `${baseName}_part_${String(partNumber).padStart(digits, '0')}${extension}`;
}

async function downloadStringInChunks(filename, content, maxChunkChars = 600000) {
  const safeContent = content || '';
  if (safeContent.length <= maxChunkChars) {
    return downloadFromPageContext(filename, safeContent);
  }

  const chunks = [];
  for (let offset = 0; offset < safeContent.length; offset += maxChunkChars) {
    chunks.push(safeContent.slice(offset, offset + maxChunkChars));
  }

  for (let i = 0; i < chunks.length; i++) {
    const partNumber = i + 1;
    const partFilename = buildPartFilename(filename, partNumber, chunks.length);
    const header = `[Claude export part ${partNumber} of ${chunks.length}]\n\n`;
    const result = await downloadFromPageContext(partFilename, `${header}${chunks[i]}`);
    if (!result.success) {
      return {
        success: false,
        error: result.error || `Failed downloading part ${partNumber}.`
      };
    }
    if (partNumber < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  }

  return { success: true, parts: chunks.length };
}

/**
 * Main execution logic for the content script.
 * Listens for the message from the background script to start extraction.
 */
if (typeof window.claude_extractor_injected === 'undefined') {
    window.claude_extractor_injected = true;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.action === 'extractConversation') {
            (async () => {
                try {
                    const extractor = new ClaudeExtractor();
                    const conversationData = await extractor.extractConversation();

                    if (conversationData && conversationData.length > 0) {
                        // Generate filename: first_ten_chars_of_url_datetime_with_underscores
                        const url = window.location.href;
                        const urlStart = url.replace(/^https?:\/\//, '').substring(0, 10).replace(/[^a-z0-9]/gi, '_');
                        const now = new Date();
                        const datetime = now.toISOString().replace(/[-:T]/g, '_').split('.')[0]; // YYYY_MM_DD_HH_MM_SS
                        const filename = `${urlStart}_${datetime}.txt`;

                        // Use the content processor for consistent formatting
                        // Check if ContentProcessor is available (it should be injected before this script)
                        if (typeof window.ContentProcessor === 'undefined') {
                            console.error('ContentProcessor not available, using fallback formatting');
                            const formattedContent = `chat url: ${url}\n\n` +
                                conversationData.map(msg => `${msg.role === 'user' ? 'Human' : 'Claude'}:\n${msg.content}`).join('\n\n');
                            const fallbackDownloadResult = await downloadStringInChunks(filename, formattedContent, 600000);

                            if (!fallbackDownloadResult.success) {
                                throw new Error(fallbackDownloadResult.error || 'Failed to start download.');
                            }

                            sendResponse({
                                success: true,
                                downloaded: true,
                                filename
                            });
                            return;
                        }

                        const contentProcessor = new window.ContentProcessor();
                        const exportResult = await contentProcessor.downloadConversationInChunks(
                            conversationData,
                            {
                                includeTimestamps: false,
                                includeMetadata: true,
                                platform: 'Claude',
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
                            console.log(`Claude export split into ${exportResult.parts} files.`);
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
