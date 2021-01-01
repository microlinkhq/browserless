/* PrismJS 1.23.0
https://prismjs.com/download.html#themes=prism&languages=clike+javascript */
var _self =
    'undefined' != typeof window
      ? window
      : 'undefined' != typeof WorkerGlobalScope && self instanceof WorkerGlobalScope
      ? self
      : {},
  Prism = (function (u) {
    var c = /\blang(?:uage)?-([\w-]+)\b/i,
      n = 0,
      _ = {
        manual: u.Prism && u.Prism.manual,
        disableWorkerMessageHandler: u.Prism && u.Prism.disableWorkerMessageHandler,
        util: {
          encode: function e (n) {
            return n instanceof M
              ? new M(n.type, e(n.content), n.alias)
              : Array.isArray(n)
              ? n.map(e)
              : n
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/\u00a0/g, ' ')
          },
          type: function (e) {
            return Object.prototype.toString.call(e).slice(8, -1)
          },
          objId: function (e) {
            return e.__id || Object.defineProperty(e, '__id', { value: ++n }), e.__id
          },
          clone: function t (e, r) {
            var a, n
            switch (((r = r || {}), _.util.type(e))) {
              case 'Object':
                if (((n = _.util.objId(e)), r[n])) return r[n]
                for (var i in ((a = {}), (r[n] = a), e)) e.hasOwnProperty(i) && (a[i] = t(e[i], r))
                return a
              case 'Array':
                return (
                  (n = _.util.objId(e)),
                  r[n]
                    ? r[n]
                    : ((a = []),
                      (r[n] = a),
                      e.forEach(function (e, n) {
                        a[n] = t(e, r)
                      }),
                      a)
                )
              default:
                return e
            }
          },
          getLanguage: function (e) {
            for (; e && !c.test(e.className); ) e = e.parentElement
            return e ? (e.className.match(c) || [, 'none'])[1].toLowerCase() : 'none'
          },
          currentScript: function () {
            if ('undefined' == typeof document) return null
            if ('currentScript' in document) return document.currentScript
            try {
              throw new Error()
            } catch (e) {
              var n = (/at [^(\r\n]*\((.*):.+:.+\)$/i.exec(e.stack) || [])[1]
              if (n) {
                var t = document.getElementsByTagName('script')
                for (var r in t) if (t[r].src == n) return t[r]
              }
              return null
            }
          },
          isActive: function (e, n, t) {
            for (var r = 'no-' + n; e; ) {
              var a = e.classList
              if (a.contains(n)) return !0
              if (a.contains(r)) return !1
              e = e.parentElement
            }
            return !!t
          }
        },
        languages: {
          extend: function (e, n) {
            var t = _.util.clone(_.languages[e])
            for (var r in n) t[r] = n[r]
            return t
          },
          insertBefore: function (t, e, n, r) {
            var a = (r = r || _.languages)[t],
              i = {}
            for (var l in a)
              if (a.hasOwnProperty(l)) {
                if (l == e) for (var o in n) n.hasOwnProperty(o) && (i[o] = n[o])
                n.hasOwnProperty(l) || (i[l] = a[l])
              }
            var s = r[t]
            return (
              (r[t] = i),
              _.languages.DFS(_.languages, function (e, n) {
                n === s && e != t && (this[e] = i)
              }),
              i
            )
          },
          DFS: function e (n, t, r, a) {
            a = a || {}
            var i = _.util.objId
            for (var l in n)
              if (n.hasOwnProperty(l)) {
                t.call(n, l, n[l], r || l)
                var o = n[l],
                  s = _.util.type(o)
                'Object' !== s || a[i(o)]
                  ? 'Array' !== s || a[i(o)] || ((a[i(o)] = !0), e(o, t, l, a))
                  : ((a[i(o)] = !0), e(o, t, null, a))
              }
          }
        },
        plugins: {},
        highlightAll: function (e, n) {
          _.highlightAllUnder(document, e, n)
        },
        highlightAllUnder: function (e, n, t) {
          var r = {
            callback: t,
            container: e,
            selector:
              'code[class*="language-"], [class*="language-"] code, code[class*="lang-"], [class*="lang-"] code'
          }
          _.hooks.run('before-highlightall', r),
            (r.elements = Array.prototype.slice.apply(r.container.querySelectorAll(r.selector))),
            _.hooks.run('before-all-elements-highlight', r)
          for (var a, i = 0; (a = r.elements[i++]); ) _.highlightElement(a, !0 === n, r.callback)
        },
        highlightElement: function (e, n, t) {
          var r = _.util.getLanguage(e),
            a = _.languages[r]
          e.className = e.className.replace(c, '').replace(/\s+/g, ' ') + ' language-' + r
          var i = e.parentElement
          i &&
            'pre' === i.nodeName.toLowerCase() &&
            (i.className = i.className.replace(c, '').replace(/\s+/g, ' ') + ' language-' + r)
          var l = { element: e, language: r, grammar: a, code: e.textContent }
          function o (e) {
            ;(l.highlightedCode = e),
              _.hooks.run('before-insert', l),
              (l.element.innerHTML = l.highlightedCode),
              _.hooks.run('after-highlight', l),
              _.hooks.run('complete', l),
              t && t.call(l.element)
          }
          if ((_.hooks.run('before-sanity-check', l), !l.code))
            return _.hooks.run('complete', l), void (t && t.call(l.element))
          if ((_.hooks.run('before-highlight', l), l.grammar))
            if (n && u.Worker) {
              var s = new Worker(_.filename)
              ;(s.onmessage = function (e) {
                o(e.data)
              }),
                s.postMessage(
                  JSON.stringify({ language: l.language, code: l.code, immediateClose: !0 })
                )
            } else o(_.highlight(l.code, l.grammar, l.language))
          else o(_.util.encode(l.code))
        },
        highlight: function (e, n, t) {
          var r = { code: e, grammar: n, language: t }
          return (
            _.hooks.run('before-tokenize', r),
            (r.tokens = _.tokenize(r.code, r.grammar)),
            _.hooks.run('after-tokenize', r),
            M.stringify(_.util.encode(r.tokens), r.language)
          )
        },
        tokenize: function (e, n) {
          var t = n.rest
          if (t) {
            for (var r in t) n[r] = t[r]
            delete n.rest
          }
          var a = new i()
          return (
            z(a, a.head, e),
            (function e (n, t, r, a, i, l) {
              for (var o in r)
                if (r.hasOwnProperty(o) && r[o]) {
                  var s = r[o]
                  s = Array.isArray(s) ? s : [s]
                  for (var u = 0; u < s.length; ++u) {
                    if (l && l.cause == o + ',' + u) return
                    var c = s[u],
                      g = c.inside,
                      f = !!c.lookbehind,
                      h = !!c.greedy,
                      d = c.alias
                    if (h && !c.pattern.global) {
                      var v = c.pattern.toString().match(/[imsuy]*$/)[0]
                      c.pattern = RegExp(c.pattern.source, v + 'g')
                    }
                    for (
                      var p = c.pattern || c, m = a.next, y = i;
                      m !== t.tail && !(l && y >= l.reach);
                      y += m.value.length, m = m.next
                    ) {
                      var k = m.value
                      if (t.length > n.length) return
                      if (!(k instanceof M)) {
                        var b,
                          x = 1
                        if (h) {
                          if (!(b = W(p, y, n, f))) break
                          var w = b.index,
                            A = b.index + b[0].length,
                            P = y
                          for (P += m.value.length; P <= w; ) (m = m.next), (P += m.value.length)
                          if (((P -= m.value.length), (y = P), m.value instanceof M)) continue
                          for (
                            var S = m;
                            S !== t.tail && (P < A || 'string' == typeof S.value);
                            S = S.next
                          )
                            x++, (P += S.value.length)
                          x--, (k = n.slice(y, P)), (b.index -= y)
                        } else if (!(b = W(p, 0, k, f))) continue
                        var w = b.index,
                          E = b[0],
                          O = k.slice(0, w),
                          L = k.slice(w + E.length),
                          N = y + k.length
                        l && N > l.reach && (l.reach = N)
                        var j = m.prev
                        O && ((j = z(t, j, O)), (y += O.length)), I(t, j, x)
                        var C = new M(o, g ? _.tokenize(E, g) : E, d, E)
                        ;(m = z(t, j, C)),
                          L && z(t, m, L),
                          1 < x && e(n, t, r, m.prev, y, { cause: o + ',' + u, reach: N })
                      }
                    }
                  }
                }
            })(e, a, n, a.head, 0),
            (function (e) {
              var n = [],
                t = e.head.next
              for (; t !== e.tail; ) n.push(t.value), (t = t.next)
              return n
            })(a)
          )
        },
        hooks: {
          all: {},
          add: function (e, n) {
            var t = _.hooks.all
            ;(t[e] = t[e] || []), t[e].push(n)
          },
          run: function (e, n) {
            var t = _.hooks.all[e]
            if (t && t.length) for (var r, a = 0; (r = t[a++]); ) r(n)
          }
        },
        Token: M
      }
    function M (e, n, t, r) {
      ;(this.type = e), (this.content = n), (this.alias = t), (this.length = 0 | (r || '').length)
    }
    function W (e, n, t, r) {
      e.lastIndex = n
      var a = e.exec(t)
      if (a && r && a[1]) {
        var i = a[1].length
        ;(a.index += i), (a[0] = a[0].slice(i))
      }
      return a
    }
    function i () {
      var e = { value: null, prev: null, next: null },
        n = { value: null, prev: e, next: null }
      ;(e.next = n), (this.head = e), (this.tail = n), (this.length = 0)
    }
    function z (e, n, t) {
      var r = n.next,
        a = { value: t, prev: n, next: r }
      return (n.next = a), (r.prev = a), e.length++, a
    }
    function I (e, n, t) {
      for (var r = n.next, a = 0; a < t && r !== e.tail; a++) r = r.next
      ;((n.next = r).prev = n), (e.length -= a)
    }
    if (
      ((u.Prism = _),
      (M.stringify = function n (e, t) {
        if ('string' == typeof e) return e
        if (Array.isArray(e)) {
          var r = ''
          return (
            e.forEach(function (e) {
              r += n(e, t)
            }),
            r
          )
        }
        var a = {
            type: e.type,
            content: n(e.content, t),
            tag: 'span',
            classes: ['token', e.type],
            attributes: {},
            language: t
          },
          i = e.alias
        i && (Array.isArray(i) ? Array.prototype.push.apply(a.classes, i) : a.classes.push(i)),
          _.hooks.run('wrap', a)
        var l = ''
        for (var o in a.attributes)
          l += ' ' + o + '="' + (a.attributes[o] || '').replace(/"/g, '&quot;') + '"'
        return (
          '<' +
          a.tag +
          ' class="' +
          a.classes.join(' ') +
          '"' +
          l +
          '>' +
          a.content +
          '</' +
          a.tag +
          '>'
        )
      }),
      !u.document)
    )
      return (
        u.addEventListener &&
          (_.disableWorkerMessageHandler ||
            u.addEventListener(
              'message',
              function (e) {
                var n = JSON.parse(e.data),
                  t = n.language,
                  r = n.code,
                  a = n.immediateClose
                u.postMessage(_.highlight(r, _.languages[t], t)), a && u.close()
              },
              !1
            )),
        _
      )
    var e = _.util.currentScript()
    function t () {
      _.manual || _.highlightAll()
    }
    if (
      (e && ((_.filename = e.src), e.hasAttribute('data-manual') && (_.manual = !0)), !_.manual)
    ) {
      var r = document.readyState
      'loading' === r || ('interactive' === r && e && e.defer)
        ? document.addEventListener('DOMContentLoaded', t)
        : window.requestAnimationFrame
        ? window.requestAnimationFrame(t)
        : window.setTimeout(t, 16)
    }
    return _
  })(_self)
'undefined' != typeof module && module.exports && (module.exports = Prism),
  'undefined' != typeof global && (global.Prism = Prism)
Prism.languages.clike = {
  comment: [
    { pattern: /(^|[^\\])\/\*[\s\S]*?(?:\*\/|$)/, lookbehind: !0, greedy: !0 },
    { pattern: /(^|[^\\:])\/\/.*/, lookbehind: !0, greedy: !0 }
  ],
  string: { pattern: /(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/, greedy: !0 },
  'class-name': {
    pattern: /(\b(?:class|interface|extends|implements|trait|instanceof|new)\s+|\bcatch\s+\()[\w.\\]+/i,
    lookbehind: !0,
    inside: { punctuation: /[.\\]/ }
  },
  keyword: /\b(?:if|else|while|do|for|return|in|instanceof|function|new|try|throw|catch|finally|null|break|continue)\b/,
  boolean: /\b(?:true|false)\b/,
  function: /\w+(?=\()/,
  number: /\b0x[\da-f]+\b|(?:\b\d+(?:\.\d*)?|\B\.\d+)(?:e[+-]?\d+)?/i,
  operator: /[<>]=?|[!=]=?=?|--?|\+\+?|&&?|\|\|?|[?*/~^%]/,
  punctuation: /[{}[\];(),.:]/
}
;(Prism.languages.javascript = Prism.languages.extend('clike', {
  'class-name': [
    Prism.languages.clike['class-name'],
    {
      pattern: /(^|[^$\w\xA0-\uFFFF])(?!\s)[_$A-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\.(?:prototype|constructor))/,
      lookbehind: !0
    }
  ],
  keyword: [
    { pattern: /((?:^|})\s*)(?:catch|finally)\b/, lookbehind: !0 },
    {
      pattern: /(^|[^.]|\.\.\.\s*)\b(?:as|async(?=\s*(?:function\b|\(|[$\w\xA0-\uFFFF]|$))|await|break|case|class|const|continue|debugger|default|delete|do|else|enum|export|extends|for|from|function|(?:get|set)(?=\s*[\[$\w\xA0-\uFFFF])|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)\b/,
      lookbehind: !0
    }
  ],
  function: /#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*(?:\.\s*(?:apply|bind|call)\s*)?\()/,
  number: /\b(?:(?:0[xX](?:[\dA-Fa-f](?:_[\dA-Fa-f])?)+|0[bB](?:[01](?:_[01])?)+|0[oO](?:[0-7](?:_[0-7])?)+)n?|(?:\d(?:_\d)?)+n|NaN|Infinity)\b|(?:\b(?:\d(?:_\d)?)+\.?(?:\d(?:_\d)?)*|\B\.(?:\d(?:_\d)?)+)(?:[Ee][+-]?(?:\d(?:_\d)?)+)?/,
  operator: /--|\+\+|\*\*=?|=>|&&=?|\|\|=?|[!=]==|<<=?|>>>?=?|[-+*/%&|^!=<>]=?|\.{3}|\?\?=?|\?\.?|[~:]/
})),
  (Prism.languages.javascript[
    'class-name'
  ][0].pattern = /(\b(?:class|interface|extends|implements|instanceof|new)\s+)[\w.\\]+/),
  Prism.languages.insertBefore('javascript', 'keyword', {
    regex: {
      pattern: /((?:^|[^$\w\xA0-\uFFFF."'\])\s]|\b(?:return|yield))\s*)\/(?:\[(?:[^\]\\\r\n]|\\.)*]|\\.|[^/\\\[\r\n])+\/[gimyus]{0,6}(?=(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/)*(?:$|[\r\n,.;:})\]]|\/\/))/,
      lookbehind: !0,
      greedy: !0,
      inside: {
        'regex-source': {
          pattern: /^(\/)[\s\S]+(?=\/[a-z]*$)/,
          lookbehind: !0,
          alias: 'language-regex',
          inside: Prism.languages.regex
        },
        'regex-flags': /[a-z]+$/,
        'regex-delimiter': /^\/|\/$/
      }
    },
    'function-variable': {
      pattern: /#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*[=:]\s*(?:async\s*)?(?:\bfunction\b|(?:\((?:[^()]|\([^()]*\))*\)|(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*)\s*=>))/,
      alias: 'function'
    },
    parameter: [
      {
        pattern: /(function(?:\s+(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*)?\s*\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\))/,
        lookbehind: !0,
        inside: Prism.languages.javascript
      },
      {
        pattern: /(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*=>)/i,
        inside: Prism.languages.javascript
      },
      {
        pattern: /(\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\)\s*=>)/,
        lookbehind: !0,
        inside: Prism.languages.javascript
      },
      {
        pattern: /((?:\b|\s|^)(?!(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)(?![$\w\xA0-\uFFFF]))(?:(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*\s*)\(\s*|\]\s*\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\)\s*\{)/,
        lookbehind: !0,
        inside: Prism.languages.javascript
      }
    ],
    constant: /\b[A-Z](?:[A-Z_]|\dx?)*\b/
  }),
  Prism.languages.insertBefore('javascript', 'string', {
    'template-string': {
      pattern: /`(?:\\[\s\S]|\${(?:[^{}]|{(?:[^{}]|{[^}]*})*})+}|(?!\${)[^\\`])*`/,
      greedy: !0,
      inside: {
        'template-punctuation': { pattern: /^`|`$/, alias: 'string' },
        interpolation: {
          pattern: /((?:^|[^\\])(?:\\{2})*)\${(?:[^{}]|{(?:[^{}]|{[^}]*})*})+}/,
          lookbehind: !0,
          inside: {
            'interpolation-punctuation': { pattern: /^\${|}$/, alias: 'punctuation' },
            rest: Prism.languages.javascript
          }
        },
        string: /[\s\S]+/
      }
    }
  }),
  Prism.languages.markup && Prism.languages.markup.tag.addInlined('script', 'javascript'),
  (Prism.languages.js = Prism.languages.javascript)
