import { MOBILE_RICH_MARKDOWN_KEYBOARD_INSET_SCRIPT } from './mobile-rich-markdown-editor-keyboard-inset-script'
import { buildMobileRichMarkdownEditorCss } from './mobile-rich-markdown-editor-css'

export function escapeInjectedJavaScriptString(value: string): string {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script')
}

export function buildMobileRichMarkdownEditorHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>${buildMobileRichMarkdownEditorCss()}</style>
</head>
<body>
  <main id="editor" contenteditable="true" data-placeholder="Start writing..."></main>
  <script>
    (function () {
      var editor = document.getElementById('editor');
      var lastMarkdown = '';
      var inputTimer = null;
      var documentGeneration = 0;
      var editable = true;
      var suppressInput = false;

      function post(message) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }

      function decodeMarkdownEntities(value) {
        return String(value).replace(/&(#x[0-9a-f]+|#\\d+|amp|lt|gt|quot|apos);/gi, function (match, entity) {
          var lower = String(entity).toLowerCase();
          if (lower === 'amp') return '&';
          if (lower === 'lt') return '<';
          if (lower === 'gt') return '>';
          if (lower === 'quot') return '"';
          if (lower === 'apos') return "'";
          if (lower.indexOf('#x') === 0) {
            var hex = Number.parseInt(lower.slice(2), 16);
            return Number.isFinite(hex) && hex >= 0 && hex <= 0x10ffff ? String.fromCodePoint(hex) : match;
          }
          if (lower.indexOf('#') === 0) {
            var code = Number.parseInt(lower.slice(1), 10);
            return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
          }
          return match;
        });
      }

      function escapeHtml(value) {
        return decodeMarkdownEntities(value).replace(/[&<>"']/g, function (char) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
      }

      function escapeAttr(value) {
        return escapeHtml(value).replace(/\\n/g, ' ');
      }

      function isSafeUrl(value) {
        var trimmed = String(value || '').trim();
        return !/^javascript:/i.test(trimmed);
      }

      function splitTableRow(line) {
        return line.trim().replace(/^\\|/, '').replace(/\\|$/, '').split('|').map(function (cell) {
          return cell.trim();
        });
      }

      function isTableSeparator(line) {
        var cells = splitTableRow(line);
        return cells.length > 0 && cells.every(function (cell) {
          return /^:?-{3,}:?$/.test(cell);
        });
      }

      function renderInline(text) {
        var output = '';
        var pattern = /(!\\[[^\\]]*\\]\\([^)]+\\)|\`[^\`]+\`|~~[^~]+~~|\\*\\*[^*]+\\*\\*|__[^_]+__|\\*[^*\\n]+\\*|_[^_\\n]+_|\\[[^\\]]+\\]\\([^)]+\\)|https?:\\/\\/[^\\s<]+)/g;
        var lastIndex = 0;
        var match;
        while ((match = pattern.exec(text))) {
          output += escapeHtml(text.slice(lastIndex, match.index));
          var token = match[0];
          var image = token.match(/^!\\[([^\\]]*)\\]\\(([^)]+)\\)$/);
          var link = token.match(/^\\[([^\\]]+)\\]\\(([^)]+)\\)$/);
          if (image && isSafeUrl(image[2])) {
            output += '<img src="' + escapeAttr(image[2]) + '" alt="' + escapeAttr(image[1] || '') + '" />';
          } else if (link && isSafeUrl(link[2])) {
            output += '<a href="' + escapeAttr(link[2]) + '">' + renderInline(link[1]) + '</a>';
          } else if (/^https?:\\/\\//i.test(token)) {
            output += '<a href="' + escapeAttr(token) + '">' + escapeHtml(token) + '</a>';
          } else if (token.indexOf('\`') === 0) {
            output += '<code>' + escapeHtml(token.slice(1, -1)) + '</code>';
          } else if (token.indexOf('~~') === 0) {
            output += '<s>' + renderInline(token.slice(2, -2)) + '</s>';
          } else if (token.indexOf('**') === 0 || token.indexOf('__') === 0) {
            output += '<strong>' + renderInline(token.slice(2, -2)) + '</strong>';
          } else {
            output += '<em>' + renderInline(token.slice(1, -1)) + '</em>';
          }
          lastIndex = pattern.lastIndex;
        }
        output += escapeHtml(text.slice(lastIndex));
        return output;
      }

      function isBlockStart(line) {
        return /^(\`\`\`|#{1,6}\\s+|>\\s?|\\s*(?:[-*+]|\\d+[.)])\\s+|\\s*(-{3,}|\\*{3,}|_{3,})\\s*$)/.test(line);
      }

      function indentationWidth(value) {
        return String(value || '').replace(/\\t/g, '    ').length;
      }

      function parseListLine(line) {
        var match = String(line || '').match(/^(\\s*)((?:[-*+])|(?:\\d+[.)]))\\s+(.+)$/);
        if (!match) return null;
        var rawText = match[3] || '';
        var task = rawText.match(/^\\[([ xX])\\]\\s+(.+)$/);
        return {
          indent: indentationWidth(match[1] || ''),
          ordered: /^\\d/.test(match[2] || ''),
          orderedNumber: /^\\d/.test(match[2] || '') ? Number.parseInt(match[2], 10) : null,
          task: task ? task[1].toLowerCase() === 'x' : null,
          text: task ? task[2] : rawText,
          children: []
        };
      }

      function listKind(item) {
        if (item.task !== null) return 'task';
        return item.ordered ? 'ol' : 'ul';
      }

      function parseListTree(lines, startIndex) {
        var root = { indent: -1, children: [] };
        var stack = [root];
        var index = startIndex;
        while (index < lines.length) {
          var item = parseListLine(lines[index] || '');
          if (!item) break;
          while (stack.length > 1 && item.indent <= stack[stack.length - 1].indent) {
            stack.pop();
          }
          stack[stack.length - 1].children.push(item);
          stack.push(item);
          index += 1;
        }
        return { items: root.children, nextIndex: index };
      }

      function renderListItems(items) {
        var html = [];
        var index = 0;
        while (index < items.length) {
          var kind = listKind(items[index]);
          var group = [];
          while (index < items.length && listKind(items[index]) === kind) {
            group.push(items[index]);
            index += 1;
          }
          var tag = kind === 'ol' ? 'ol' : 'ul';
          var attrs = kind === 'task' ? ' data-type="taskList"' : kind === 'ol' && group[0].orderedNumber !== null ? ' start="' + group[0].orderedNumber + '"' : '';
          html.push('<' + tag + attrs + '>' + group.map(function (item) {
            var children = item.children.length ? renderListItems(item.children) : '';
            if (kind === 'task') {
              var checked = item.task === true;
              return '<li data-checked="' + String(checked) + '"><label contenteditable="false"><input type="checkbox" ' + (checked ? 'checked ' : '') + (editable ? '' : 'disabled ') + '/></label><div><p>' + renderInline(item.text) + '</p>' + children + '</div></li>';
            }
            var orderedAttrs = kind === 'ol' && item.orderedNumber !== null ? ' value="' + item.orderedNumber + '" data-list-number="' + item.orderedNumber + '"' : '';
            return '<li' + orderedAttrs + '><p>' + renderInline(item.text) + '</p>' + children + '</li>';
          }).join('') + '</' + tag + '>');
        }
        return html.join('');
      }

      function markdownToHtml(markdown) {
        var lines = String(markdown || '').replace(/\\r\\n?/g, '\\n').split('\\n');
        var html = [];
        var index = 0;
        while (index < lines.length) {
          var line = lines[index] || '';
          if (!line.trim()) {
            index += 1;
            continue;
          }
          var fence = line.match(/^\\\`\`\`([^\\s\`]*)\\s*$/);
          if (fence) {
            index += 1;
            var code = [];
            while (index < lines.length && !/^\\\`\`\`\\s*$/.test(lines[index] || '')) {
              code.push(lines[index] || '');
              index += 1;
            }
            if (index < lines.length) index += 1;
            html.push('<pre data-language="' + escapeAttr(fence[1] || '') + '"><code>' + escapeHtml(code.join('\\n')) + '</code></pre>');
            continue;
          }
          if (/^\\s*(-{3,}|\\*{3,}|_{3,})\\s*$/.test(line)) {
            html.push('<hr />');
            index += 1;
            continue;
          }
          if (line.indexOf('|') >= 0 && index + 1 < lines.length && isTableSeparator(lines[index + 1] || '')) {
            var headers = splitTableRow(line);
            index += 2;
            var rows = [];
            while (index < lines.length && (lines[index] || '').indexOf('|') >= 0 && (lines[index] || '').trim()) {
              rows.push(splitTableRow(lines[index] || ''));
              index += 1;
            }
            html.push('<table><thead><tr>' + headers.map(function (cell) { return '<th>' + renderInline(cell) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (row) {
              return '<tr>' + headers.map(function (_, cellIndex) { return '<td>' + renderInline(row[cellIndex] || '') + '</td>'; }).join('') + '</tr>';
            }).join('') + '</tbody></table>');
            continue;
          }
          var heading = line.match(/^(#{1,6})\\s+(.+)$/);
          if (heading) {
            html.push('<h' + heading[1].length + '>' + renderInline(heading[2].trim()) + '</h' + heading[1].length + '>');
            index += 1;
            continue;
          }
          if (/^>\\s?/.test(line)) {
            var quote = [];
            while (index < lines.length && /^>\\s?/.test(lines[index] || '')) {
              quote.push((lines[index] || '').replace(/^>\\s?/, ''));
              index += 1;
            }
            html.push('<blockquote><p>' + renderInline(quote.join('\\n').trim()).replace(/\\n/g, '<br />') + '</p></blockquote>');
            continue;
          }
          if (/^\\s*(?:[-*+]|\\d+[.)])\\s+/.test(line)) {
            var list = parseListTree(lines, index);
            html.push(renderListItems(list.items));
            index = list.nextIndex;
            continue;
          }
          var paragraph = [];
          while (index < lines.length && (lines[index] || '').trim() && !isBlockStart(lines[index] || '') && !(index + 1 < lines.length && (lines[index] || '').indexOf('|') >= 0 && isTableSeparator(lines[index + 1] || ''))) {
            paragraph.push(lines[index] || '');
            index += 1;
          }
          html.push('<p>' + renderInline(paragraph.join('\\n')).replace(/\\n/g, '<br />') + '</p>');
        }
        return html.join('\\n') || '<p class="is-empty"><br /></p>';
      }

      function textContent(node) {
        return (node.textContent || '').replace(/\\u00a0/g, ' ');
      }

      function inlineMarkdown(node) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) return textContent(node);
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        var el = node;
        var tag = el.tagName.toLowerCase();
        if (tag === 'br') return '\\n';
        if (tag === 'strong' || tag === 'b') return '**' + inlineChildren(el) + '**';
        if (tag === 'em' || tag === 'i') return '*' + inlineChildren(el) + '*';
        if (tag === 's' || tag === 'del' || tag === 'strike') return '~~' + inlineChildren(el) + '~~';
        if (tag === 'code' && el.parentElement && el.parentElement.tagName.toLowerCase() !== 'pre') return '\`' + textContent(el) + '\`';
        if (tag === 'a') return '[' + inlineChildren(el) + '](' + (el.getAttribute('href') || '') + ')';
        if (tag === 'img') return '![' + (el.getAttribute('alt') || '') + '](' + (el.getAttribute('src') || '') + ')';
        if (tag === 'label') return '';
        return inlineChildren(el);
      }

      function inlineChildren(el) {
        return Array.prototype.map.call(el.childNodes, inlineMarkdown).join('');
      }

      function listItemText(li) {
        var clone = li.cloneNode(true);
        Array.prototype.forEach.call(clone.querySelectorAll('label'), function (label) { label.remove(); });
        Array.prototype.forEach.call(clone.querySelectorAll('ul, ol'), function (list) { list.remove(); });
        return inlineChildren(clone).trim();
      }

      function directNestedLists(li) {
        return Array.prototype.filter.call(li.querySelectorAll('ul, ol'), function (list) {
          return list.closest('li') === li;
        });
      }

      function listMarkdown(el, depth) {
        var tag = el.tagName.toLowerCase();
        var isTask = el.getAttribute('data-type') === 'taskList';
        var orderedStart = tag === 'ol' ? Number.parseInt(el.getAttribute('start') || '1', 10) : 1;
        if (!Number.isFinite(orderedStart)) orderedStart = 1;
        var indent = '  '.repeat(depth);
        return Array.prototype.map.call(el.children, function (li, index) {
          if (li.tagName.toLowerCase() !== 'li') return '';
          var marker;
          if (isTask) {
            var input = li.querySelector('input[type="checkbox"]');
            marker = '- [' + (input && input.checked ? 'x' : ' ') + '] ';
          } else {
            var listNumber =
              li.getAttribute &&
              (li.getAttribute('data-list-number') || li.getAttribute('value'));
            marker = tag === 'ol' ? String(listNumber || orderedStart + index) + '. ' : '- ';
          }
          var line = indent + marker + listItemText(li);
          var nested = directNestedLists(li).map(function (list) {
            return listMarkdown(list, depth + 1);
          }).filter(Boolean).join('\\n');
          return nested ? line + '\\n' + nested : line;
        }).filter(Boolean).join('\\n');
      }

      function blockMarkdown(node) {
        if (node.nodeType === Node.TEXT_NODE) return textContent(node).trim();
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        var el = node;
        var tag = el.tagName.toLowerCase();
        if (tag.match(/^h[1-6]$/)) return '#'.repeat(Number(tag.slice(1))) + ' ' + inlineChildren(el).trim();
        if (tag === 'p' || tag === 'div') return inlineChildren(el).trim();
        if (tag === 'blockquote') {
          return inlineChildren(el).trim().split('\\n').map(function (line) { return '> ' + line; }).join('\\n');
        }
        if (tag === 'pre') {
          var lang = el.getAttribute('data-language') || '';
          var code = textContent(el.querySelector('code') || el).replace(/\\n+$/g, '');
          return '\`\`\`' + lang + '\\n' + code + '\\n\`\`\`';
        }
        if (tag === 'ul' || tag === 'ol') {
          return listMarkdown(el, 0);
        }
        if (tag === 'table') {
          var rows = Array.prototype.slice.call(el.querySelectorAll('tr'));
          if (rows.length === 0) return '';
          var cellsFor = function (row) {
            return Array.prototype.map.call(row.children, function (cell) { return inlineChildren(cell).trim(); });
          };
          var headers = cellsFor(rows[0]);
          var bodyRows = rows.slice(1).map(cellsFor);
          return '| ' + headers.join(' | ') + ' |\\n| ' + headers.map(function () { return '---'; }).join(' | ') + ' |' + (bodyRows.length ? '\\n' + bodyRows.map(function (row) { return '| ' + row.join(' | ') + ' |'; }).join('\\n') : '');
        }
        if (tag === 'hr') return '---';
        if (tag === 'img') return inlineMarkdown(el);
        return inlineChildren(el).trim();
      }

      function currentMarkdown() {
        return Array.prototype.map.call(editor.childNodes, blockMarkdown).filter(function (block) {
          return block.trim().length > 0;
        }).join('\\n\\n').trimEnd();
      }

      function syncTaskCheckboxesDisabled() {
        Array.prototype.forEach.call(editor.querySelectorAll('input[type="checkbox"]'), function (input) {
          input.disabled = !editable;
        });
      }

      function emitChange() {
        if (suppressInput || !editable) return;
        window.clearTimeout(inputTimer);
        var pendingGeneration = documentGeneration;
        lastMarkdown = currentMarkdown();
        post({ type: 'change', markdown: lastMarkdown, generation: pendingGeneration });
      }

      function setMarkdown(markdown, generation) {
        window.clearTimeout(inputTimer);
        documentGeneration = Number(generation) || 0;
        suppressInput = true;
        lastMarkdown = String(markdown || '');
        editor.innerHTML = markdownToHtml(lastMarkdown);
        syncTaskCheckboxesDisabled();
        suppressInput = false;
      }

      function setEditable(nextEditable) {
        editable = Boolean(nextEditable);
        editor.setAttribute('contenteditable', editable ? 'true' : 'false');
        syncTaskCheckboxesDisabled();
      }

      function focusEditor() {
        editor.focus();
      }

      function restoreSelectionOrEnd() {
        focusEditor();
        var selection = window.getSelection();
        if (!selection || selection.rangeCount > 0) return;
        var range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      function wrapSelection(tagName) {
        restoreSelectionOrEnd();
        var selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        var range = selection.getRangeAt(0);
        if (range.collapsed) return;
        var wrapper = document.createElement(tagName);
        try {
          range.surroundContents(wrapper);
        } catch (_error) {
          wrapper.appendChild(range.extractContents());
          range.insertNode(wrapper);
        }
        selection.removeAllRanges();
        selection.selectAllChildren(wrapper);
        emitChange();
      }

      function runCommand(command) {
        if (!editable || editor.getAttribute('contenteditable') !== 'true') return;
        restoreSelectionOrEnd();
        if (command === 'paragraph') document.execCommand('formatBlock', false, 'p');
        else if (command === 'heading1') document.execCommand('formatBlock', false, 'h1');
        else if (command === 'heading2') document.execCommand('formatBlock', false, 'h2');
        else if (command === 'heading3') document.execCommand('formatBlock', false, 'h3');
        else if (command === 'bold') document.execCommand('bold');
        else if (command === 'italic') document.execCommand('italic');
        else if (command === 'strike') document.execCommand('strikeThrough');
        else if (command === 'bulletList') document.execCommand('insertUnorderedList');
        else if (command === 'orderedList') document.execCommand('insertOrderedList');
        else if (command === 'quote') document.execCommand('formatBlock', false, 'blockquote');
        else if (command === 'inlineCode') wrapSelection('code');
        else if (command === 'codeBlock') document.execCommand('insertHTML', false, '<pre data-language=""><code>code</code></pre><p><br></p>');
        else if (command === 'taskList') document.execCommand('insertHTML', false, '<ul data-type="taskList"><li data-checked="false"><label contenteditable="false"><input type="checkbox" /></label><div><p>Task</p></div></li></ul>');
        else if (command === 'link') {
          var href = window.prompt('Link URL');
          if (href && isSafeUrl(href)) document.execCommand('createLink', false, href);
        } else if (command === 'image') {
          var src = window.prompt('Image URL');
          if (src && isSafeUrl(src)) document.execCommand('insertImage', false, src);
        }
        syncTaskCheckboxesDisabled();
        emitChange();
      }

      editor.addEventListener('input', function () {
        if (editable) emitChange();
      });
      editor.addEventListener('change', function (event) {
        var input = event.target && event.target.closest && event.target.closest('input[type="checkbox"]');
        if (input) {
          if (!editable) {
            event.preventDefault();
            return;
          }
          var li = input.closest('li');
          if (li) li.setAttribute('data-checked', input.checked ? 'true' : 'false');
        }
        if (editable) emitChange();
      });
      editor.addEventListener('click', function (event) {
        var link = event.target && event.target.closest && event.target.closest('a[href]');
        if (link) {
          event.preventDefault();
          post({ type: 'openLink', url: link.getAttribute('href') || '' });
          return;
        }
        var input = event.target && event.target.closest && event.target.closest('input[type="checkbox"]');
        if (!input) return;
        if (!editable) {
          event.preventDefault();
          return;
        }
        var li = input.closest('li');
        if (li) li.setAttribute('data-checked', input.checked ? 'true' : 'false');
        emitChange();
      });
      editor.addEventListener('keydown', function (event) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
          event.preventDefault();
          runCommand('bold');
        }
      });

      window.__orcaRichMarkdown = { setMarkdown: setMarkdown, setEditable: setEditable, runCommand: runCommand, currentMarkdown: currentMarkdown };
${MOBILE_RICH_MARKDOWN_KEYBOARD_INSET_SCRIPT}
      post({ type: 'ready' });
    })();
  </script>
</body>
</html>`
}
