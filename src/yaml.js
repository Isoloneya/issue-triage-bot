'use strict';

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      if (i === 0 || /[\s:[,-]/.test(line[i - 1])) {
        quote = ch;
      }
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitInline(text) {
  const parts = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"') {
        i++;
        current += text[i] === undefined ? '' : text[i];
      } else if (ch === quote) {
        quote = null;
      }
    } else if ((ch === '"' || ch === "'") && current.trim() === '') {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.filter((part) => part.trim() !== '');
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s[0] === '[' && s[s.length - 1] === ']') {
    return splitInline(s.slice(1, -1)).map(parseScalar);
  }
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function findColon(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
    } else if ((ch === '"' || ch === "'") && i === 0) {
      quote = ch;
    } else if (ch === ':' && (i === text.length - 1 || text[i + 1] === ' ')) {
      return i;
    }
  }
  return -1;
}

function indentOf(line) {
  return line.match(/^ */)[0].length;
}

function expandBlockScalars(text) {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < raw.length) {
    const line = raw[i];
    const match = /^(\s*)([^\s#][^#]*?):\s+\|[+-]?\s*$/.exec(line);
    if (!match) {
      out.push(line);
      i++;
      continue;
    }
    const baseIndent = match[1].length;
    const block = [];
    let j = i + 1;
    while (j < raw.length && (raw[j].trim() === '' || indentOf(raw[j]) > baseIndent)) {
      block.push(raw[j]);
      j++;
    }
    while (block.length > 0 && block[block.length - 1].trim() === '') block.pop();
    const first = block.find((l) => l.trim() !== '');
    const blockIndent = first ? indentOf(first) : baseIndent + 1;
    const value = block.map((l) => l.slice(Math.min(blockIndent, l.length))).join('\n');
    out.push(`${match[1]}${match[2]}: ${JSON.stringify(value)}`);
    i = j;
  }
  return out;
}

function parseYaml(text) {
  const lines = expandBlockScalars(String(text))
    .map((line) => {
      const stripped = stripComment(line).replace(/\s+$/, '');
      return { indent: indentOf(stripped), text: stripped.trim() };
    })
    .filter((line) => line.text !== '' && line.text !== '---');

  if (lines.length === 0) return {};

  let pos = 0;
  const isItem = (line) => line.text === '-' || line.text.startsWith('- ');

  function parseList(indent) {
    const items = [];
    while (pos < lines.length && lines[pos].indent === indent && isItem(lines[pos])) {
      items.push(parseScalar(lines[pos].text.slice(1)));
      pos++;
    }
    return items;
  }

  function parseMap(indent) {
    const map = {};
    while (pos < lines.length && lines[pos].indent === indent && !isItem(lines[pos])) {
      const { text: content } = lines[pos];
      const colon = findColon(content);
      if (colon === -1) throw new Error(`Expected "key: value" but found "${content}"`);
      const key = String(parseScalar(content.slice(0, colon)));
      const rest = content.slice(colon + 1).trim();
      pos++;
      if (rest !== '') {
        map[key] = parseScalar(rest);
        continue;
      }
      const next = lines[pos];
      if (next && next.indent > indent) {
        map[key] = parseBlock(next.indent);
      } else if (next && next.indent === indent && isItem(next)) {
        map[key] = parseList(indent);
      } else {
        map[key] = null;
      }
    }
    return map;
  }

  function parseBlock(indent) {
    return isItem(lines[pos]) ? parseList(indent) : parseMap(indent);
  }

  const result = parseBlock(lines[0].indent);
  if (pos < lines.length) {
    throw new Error(`Unexpected content "${lines[pos].text}"`);
  }
  return result;
}

module.exports = { parseYaml };
