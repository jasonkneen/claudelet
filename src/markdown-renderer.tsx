import { marked, type Token } from 'marked';
import hljs from 'highlight.js';
import React from 'react';

/**
 * Syntax highlight a code block for terminal display
 */
function highlightCode(code: string, lang?: string): Array<{ text: string; color: string }> {
  try {
    const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
    const highlighted = hljs.highlight(code, { language, ignoreIllegals: true });

    // Parse highlight.js HTML output into styled segments
    const segments: Array<{ text: string; color: string }> = [];
    const html = highlighted.value;

    // Simple HTML parser to extract text and classes
    const regex = /<span class="([^"]+)">([^<]*)<\/span>|([^<]+)/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
      if (match[1]) {
        // Span with class
        const className = match[1];
        const text = match[2];
        const color = getColorForClass(className);
        segments.push({ text, color });
      } else if (match[3]) {
        // Plain text
        segments.push({ text: match[3], color: 'white' });
      }
    }

    return segments;
  } catch {
    // Fallback to plain text if highlighting fails
    return [{ text: code, color: 'white' }];
  }
}

/**
 * Map highlight.js token classes to terminal colors
 */
function getColorForClass(className: string): string {
  // Common highlight.js classes
  if (className.includes('keyword')) return 'magenta';
  if (className.includes('string')) return 'green';
  if (className.includes('number')) return 'cyan';
  if (className.includes('comment')) return 'gray';
  if (className.includes('function')) return 'blue';
  if (className.includes('class')) return 'yellow';
  if (className.includes('variable')) return 'cyan';
  if (className.includes('operator')) return 'magenta';
  if (className.includes('punctuation')) return 'white';
  if (className.includes('property')) return 'cyan';
  if (className.includes('tag')) return 'blue';
  if (className.includes('attr')) return 'cyan';

  return 'white';
}

/**
 * Render inline tokens (bold, italic, code, text, etc.)
 */
function renderInlineToken(token: Token, key: string): React.ReactNode {
  switch (token.type) {
    case 'text': {
      const textToken = token as marked.Tokens.Text;
      return <text key={key} content={textToken.text} fg="white" />;
    }

    case 'strong': {
      const strongToken = token as marked.Tokens.Strong;
      return <text key={key} content={strongToken.text} fg="white" bold />;
    }

    case 'em': {
      const emToken = token as marked.Tokens.Em;
      return <text key={key} content={emToken.text} fg="white" italic />;
    }

    case 'codespan': {
      const codeToken = token as marked.Tokens.Codespan;
      return <text key={key} content={`\`${codeToken.text}\``} fg="yellow" />;
    }

    case 'link': {
      const linkToken = token as marked.Tokens.Link;
      return <text key={key} content={linkToken.text} fg="blue" underline />;
    }

    case 'br': {
      return <text key={key} content="\n" />;
    }

    default: {
      const text = 'text' in token ? (token as any).text : '';
      return text ? <text key={key} content={text} fg="white" /> : null;
    }
  }
}

/**
 * Render a single token as OpenTUI text element(s)
 */
function renderToken(token: Token, key: string): React.ReactNode {
  switch (token.type) {
    case 'heading': {
      const headingToken = token as marked.Tokens.Heading;
      const prefix = '#'.repeat(headingToken.depth) + ' ';
      return (
        <box key={key} style={{ flexDirection: 'row', marginTop: 1, marginBottom: 1 }}>
          <text content={prefix} fg="cyan" bold />
          <text content={headingToken.text} fg="cyan" bold />
        </box>
      );
    }

    case 'code': {
      const codeToken = token as marked.Tokens.Code;
      const lines = codeToken.text.split('\n');

      return (
        <box key={key} style={{ flexDirection: 'column', marginTop: 1, marginBottom: 1 }}>
          {codeToken.lang && (
            <text content={`\`\`\`${codeToken.lang}`} fg="gray" />
          )}
          {lines.map((line, i) => {
            const segments = highlightCode(line, codeToken.lang);
            return (
              <box key={`code-line-${key}-${i}`} style={{ flexDirection: 'row' }}>
                {segments.map((seg, j) => (
                  <text key={`seg-${key}-${i}-${j}`} content={seg.text} fg={seg.color as any} />
                ))}
              </box>
            );
          })}
          <text content="```" fg="gray" />
        </box>
      );
    }

    case 'blockquote': {
      const blockquoteToken = token as marked.Tokens.Blockquote;
      return (
        <box key={key} style={{ flexDirection: 'column', marginLeft: 2 }}>
          <text content="│" fg="gray" />
          {blockquoteToken.tokens.map((t, i) => renderToken(t, `${key}-bq-${i}`))}
        </box>
      );
    }

    case 'list': {
      const listToken = token as marked.Tokens.List;
      return (
        <box key={key} style={{ flexDirection: 'column', marginTop: 1 }}>
          {listToken.items.map((item, i) => {
            const bullet = listToken.ordered ? `${i + 1}.` : '•';
            return (
              <box key={`${key}-li-${i}`} style={{ flexDirection: 'row' }}>
                <text content={`${bullet} `} fg="yellow" />
                <text content={item.text} fg="white" />
              </box>
            );
          })}
        </box>
      );
    }

    case 'paragraph': {
      const paragraphToken = token as marked.Tokens.Paragraph;
      // Render inline elements if present
      if ('tokens' in paragraphToken && paragraphToken.tokens) {
        return (
          <box key={key} style={{ flexDirection: 'row', marginTop: 0, flexWrap: 'wrap' }}>
            {paragraphToken.tokens.map((t, i) => renderInlineToken(t, `${key}-inline-${i}`))}
          </box>
        );
      }
      return (
        <box key={key} style={{ marginTop: 0 }}>
          <text content={paragraphToken.text} fg="white" />
        </box>
      );
    }

    case 'space': {
      return <box key={key} style={{ height: 1 }} />;
    }

    default: {
      // Handle other token types as plain text
      const text = 'text' in token ? (token as any).text : '';
      if (text) {
        return (
          <box key={key}>
            <text content={text} fg="white" />
          </box>
        );
      }
      return null;
    }
  }
}

/**
 * Parse and render markdown content for OpenTUI
 */
export function renderMarkdown(content: string): React.ReactNode {
  try {
    const tokens = marked.lexer(content);
    return (
      <box style={{ flexDirection: 'column' }}>
        {tokens.map((token, i) => renderToken(token, `token-${i}`))}
      </box>
    );
  } catch (err) {
    // Fallback to plain text if parsing fails
    return <text content={content} fg="white" />;
  }
}

/**
 * Detect if content contains markdown formatting
 */
export function isMarkdown(content: string): boolean {
  // Check for common markdown patterns
  const patterns = [
    /^#{1,6}\s/m,           // Headers
    /```[\s\S]*?```/,       // Code blocks
    /`[^`]+`/,              // Inline code
    /^\* /m,                // Unordered list
    /^\d+\. /m,             // Ordered list
    /\*\*[^*]+\*\*/,        // Bold
    /\*[^*]+\*/,            // Italic
    /\[.+\]\(.+\)/,         // Links
    /^>/m,                  // Blockquote
  ];

  return patterns.some(pattern => pattern.test(content));
}
