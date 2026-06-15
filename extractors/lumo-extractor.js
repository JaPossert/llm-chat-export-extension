// Universal LLM Conversation Exporter - Lumo Extractor
// Lumo is Proton's privacy-first AI assistant (lumo.proton.me)

class LumoExtractor {
  constructor() {
    this.selectors = {
      messageChain: 'div.lumo-message-chain',
      messageItem: 'div.lumo-chat-item[data-message-role]',
      userText: '.lumo-markdown',
      assistantContent: '.assistant-msg-container',
      titleButton: '.conversation-header-title-view .hide-on-small-screens'
    };
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

  getTitle() {
    const titleEl = document.querySelector(this.selectors.titleButton);
    const text = titleEl ? titleEl.textContent.trim() : '';
    return text || 'Lumo Chat';
  }

  processChildNodes(childNodes) {
    let markdown = '';
    for (let n = 0; n < childNodes.length; n++) {
      const node = childNodes[n];

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (text.trim()) {
          markdown += text;
        }
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = node.tagName;
      const text = node.textContent;

      if (tag === 'P') {
        markdown += `${text}\n`;
      } else if (tag === 'H1') {
        markdown += `# ${text}\n`;
      } else if (tag === 'H2') {
        markdown += `## ${text}\n`;
      } else if (tag === 'H3') {
        markdown += `### ${text}\n`;
      } else if (tag === 'H4') {
        markdown += `#### ${text}\n`;
      } else if (tag === 'H5') {
        markdown += `##### ${text}\n`;
      } else if (tag === 'H6') {
        markdown += `###### ${text}\n`;
      } else if (tag === 'OL') {
        node.childNodes.forEach((li, index) => {
          if (li.nodeType === Node.ELEMENT_NODE && li.tagName === 'LI') {
            markdown += `${index + 1}. ${li.textContent}\n`;
          }
        });
      } else if (tag === 'UL') {
        node.childNodes.forEach((li) => {
          if (li.nodeType === Node.ELEMENT_NODE && li.tagName === 'LI') {
            markdown += `- ${li.textContent}\n`;
          }
        });
      } else if (tag === 'PRE') {
        const codeEl = node.querySelector('code');
        if (codeEl) {
          const lang = codeEl.classList[0] ? codeEl.classList[0].split('-')[1] || '' : '';
          markdown += `\`\`\`${lang}\n${codeEl.textContent}\n\`\`\`\n`;
        } else {
          markdown += `\`\`\`\n${node.textContent}\n\`\`\`\n`;
        }
      } else if (tag === 'TABLE') {
        let tableMarkdown = '';
        node.childNodes.forEach((section) => {
          if (section.nodeType !== Node.ELEMENT_NODE) return;
          if (section.tagName !== 'THEAD' && section.tagName !== 'TBODY') return;

          let colCount = 0;
          section.childNodes.forEach((row) => {
            if (row.nodeType !== Node.ELEMENT_NODE || row.tagName !== 'TR') return;
            let cells = '';
            row.childNodes.forEach((cell) => {
              if (cell.nodeType !== Node.ELEMENT_NODE) return;
              if (cell.tagName !== 'TD' && cell.tagName !== 'TH') return;
              cells += `| ${cell.textContent} `;
              if (section.tagName === 'THEAD') colCount++;
            });
            tableMarkdown += `${cells}|\n`;
          });

          if (section.tagName === 'THEAD' && colCount > 0) {
            tableMarkdown += `| ${Array(colCount).fill('---').join(' | ')} |\n`;
          }
        });
        markdown += tableMarkdown;
      } else {
        // Generic container — recurse
        const inner = this.processChildNodes(node.childNodes);
        if (inner.trim()) markdown += inner;
      }

      markdown += '\n';
    }
    return markdown;
  }

  extractUserText(messageEl) {
    const lumoMarkdown = messageEl.querySelector(this.selectors.userText);
    if (lumoMarkdown) {
      const text = lumoMarkdown.textContent.trim();
      if (text) return text;
    }
    // Fallback: raw text content of the message element
    return messageEl.textContent.trim();
  }

  extractAssistantText(messageEl) {
    const container = messageEl.querySelector(this.selectors.assistantContent);
    if (container) {
      return this.processChildNodes(container.childNodes);
    }
    return messageEl.textContent.trim();
  }

  async extractConversation() {
    console.log('LumoExtractor: Starting extraction...');

    const title = this.getTitle();
    const timestamp = this.getTimestamp();
    const messages = [];

    // Prefer the message chain container; fall back to document-wide search
    const chain = document.querySelector(this.selectors.messageChain);
    const scope = chain || document;
    const messageEls = scope.querySelectorAll(this.selectors.messageItem);

    console.log(`LumoExtractor: Found ${messageEls.length} message elements`);

    for (const el of messageEls) {
      const role = el.getAttribute('data-message-role');

      if (role === 'user') {
        const content = this.extractUserText(el);
        if (content) {
          messages.push({ role: 'user', content, isPlainText: true });
        }
      } else if (role === 'assistant') {
        const content = this.extractAssistantText(el).trim();
        if (content) {
          messages.push({ role: 'assistant', content, isPlainText: false });
        }
      }
    }

    console.log(`LumoExtractor: Extracted ${messages.length} messages`);

    if (messages.length === 0) {
      throw new Error('No messages found. Make sure you have a Lumo conversation open.');
    }

    // Attach metadata for the content processor
    messages._title = title;
    messages._timestamp = timestamp;

    return messages;
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
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Download failed in page context.' };
  }
}

function splitFilename(filename) {
  const safeName = (filename || 'conversation.txt').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const lastDotIndex = safeName.lastIndexOf('.');
  if (lastDotIndex > 0 && lastDotIndex < safeName.length - 1) {
    return { baseName: safeName.slice(0, lastDotIndex), extension: safeName.slice(lastDotIndex) };
  }
  return { baseName: safeName, extension: '.txt' };
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
    const header = `[Lumo export part ${partNumber} of ${chunks.length}]\n\n`;
    const result = await downloadFromPageContext(partFilename, `${header}${chunks[i]}`);
    if (!result.success) {
      return { success: false, error: result.error || `Failed downloading part ${partNumber}.` };
    }
    if (partNumber < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  }

  return { success: true, parts: chunks.length };
}

if (typeof window.lumo_extractor_injected === 'undefined') {
  window.lumo_extractor_injected = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'extractConversation') {
      (async () => {
        try {
          const extractor = new LumoExtractor();
          const conversationData = await extractor.extractConversation();

          if (conversationData && conversationData.length > 0) {
            const url = window.location.href;
            const urlStart = url.replace(/^https?:\/\//, '').substring(0, 10).replace(/[^a-z0-9]/gi, '_');
            const now = new Date();
            const datetime = now.toISOString().replace(/[-:T]/g, '_').split('.')[0];
            const filename = `${urlStart}_${datetime}.txt`;

            if (typeof window.ContentProcessor === 'undefined') {
              console.error('ContentProcessor not available, using fallback formatting');
              const formattedContent = `chat url: ${url}\n\n` +
                conversationData.map(msg => `${msg.role === 'user' ? 'Human' : 'Lumo'}:\n${msg.content}`).join('\n\n');
              const fallbackResult = await downloadStringInChunks(filename, formattedContent, 600000);
              if (!fallbackResult.success) {
                throw new Error(fallbackResult.error || 'Failed to start download.');
              }
              sendResponse({ success: true, downloaded: true, filename });
              return;
            }

            const contentProcessor = new window.ContentProcessor();
            const exportResult = await contentProcessor.downloadConversationInChunks(
              conversationData,
              {
                includeTimestamps: false,
                includeMetadata: true,
                platform: 'Lumo',
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
              console.log(`Lumo export split into ${exportResult.parts} files.`);
            }

            sendResponse({ success: true, downloaded: true, filename, partCount: exportResult.parts });
          } else {
            throw new Error('No valid messages were extracted from the page.');
          }
        } catch (error) {
          console.error('Lumo extraction failed:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
    }
    return true;
  });
}
