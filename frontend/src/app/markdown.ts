import React from 'react';

export function renderSimpleMarkdown(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let numberedBuffer: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    elements.push(
      React.createElement('ul', { key: key++, className: 'route-md-list' },
        bulletBuffer.map((item, i) => React.createElement('li', { key: i }, renderInline(item)))
      )
    );
    bulletBuffer = [];
  };

  const flushNumbered = () => {
    if (numberedBuffer.length === 0) return;
    elements.push(
      React.createElement('ol', { key: key++, className: 'route-md-list' },
        numberedBuffer.map((item, i) => React.createElement('li', { key: i }, renderInline(item)))
      )
    );
    numberedBuffer = [];
  };

  const flushLists = () => {
    flushBullets();
    flushNumbered();
  };

  const renderInline = (line: string): React.ReactNode[] =>
    line.split(/(\*\*[^*]+\*\*)/).map((seg, j) =>
      seg.startsWith('**') && seg.endsWith('**')
        ? React.createElement('strong', { key: j }, seg.slice(2, -2))
        : seg
    );

  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Blank line
    if (!line) {
      flushLists();
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushLists();
      const level = headingMatch[1].length;
      if (level === 1) elements.push(React.createElement('h3', { key: key++, className: 'route-md-heading' }, renderInline(headingMatch[2])));
      else if (level === 2) elements.push(React.createElement('h4', { key: key++, className: 'route-md-heading' }, renderInline(headingMatch[2])));
      else elements.push(React.createElement('h5', { key: key++, className: 'route-md-heading' }, renderInline(headingMatch[2])));
      i++;
      continue;
    }

    // Bullet list
    if (/^[-*]\s+/.test(line)) {
      flushNumbered();
      bulletBuffer.push(line.replace(/^[-*]\s+/, ''));
      i++;
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(line)) {
      flushBullets();
      numberedBuffer.push(line.replace(/^\d+\.\s+/, ''));
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-blank, non-special lines
    flushLists();
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next || /^(#{1,3}\s|[-*]\s|\d+\.\s)/.test(next)) break;
      paraLines.push(next);
      i++;
    }
    elements.push(React.createElement('p', { key: key++ }, renderInline(paraLines.join(' '))));
  }

  flushLists();
  return elements;
}
