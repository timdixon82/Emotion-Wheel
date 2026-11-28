// Emotion search: pure matching, ranking, alias, stem and highlight logic.
// No DOM access in this file, so node can test it (tests/emotion-search.cjs).
// Display only: it reads the emotions rows and a descriptions object passed in
// by the page. It never stores or sends anything.
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.EmotionSearch = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  // Alias list: only for the six inner words. A query that is exactly one of
  // these finds that inner emotion. Short and visible on purpose.
  var aliases = {
    anger: ['angry', 'angrier', 'angriest', 'angrily'],
    sad: ['sadness', 'sadly', 'sadder', 'saddened'],
    happy: ['happiness', 'happily', 'happier'],
    fear: ['fearful', 'fearing', 'fears'],
    disgust: ['disgusted', 'disgusting'],
    surprise: ['surprised', 'surprising', 'surprisingly']
  };

  // ---------------------------------------------------------------------
  // MATCHING RULES.
  //
  // The query is normalised (accents removed, lower case, trimmed) and split on
  // spaces into "typed words". A thing matches only if EVERY typed word matches.
  //
  // 0. Minimum length: a query shorter than MIN_QUERY (2) characters is not
  //    searched. A hint is shown instead.
  // 1. DESCRIPTIONS: a typed word matches only at the START of a word in the
  //    description ("care" matches "careful", never "scared"; "anger" never
  //    matches "dangerous"). A word start is the first letter, or a letter after
  //    a character that is not a letter, digit or apostrophe (so "conscious"
  //    starts a word in "self-conscious"). No stem or alias rule.
  // 2. NAMES: a typed word matches a name when ANY of these is true:
  //    a. it matches the start of a name word (same as rule 1);
  //    b. it is NAME_INSIDE_MIN (5) letters or more and sits inside the name
  //       ("shame" finds "Ashamed"). Never used for descriptions;
  //    c. it is exactly a listed alias of an inner emotion ("angry" finds Anger);
  //    d. it shares a stem with a name word (typed word four letters or more).
  // 3. HIGHLIGHT: only description matches (rule 1) and name matches are marked.
  //    A description match marks the whole word that starts with the typed word.
  //    The marked text never begins in the middle of a word.
  // 4. MATCH SENTENCE: lists the typed words that matched (up to three), not the
  //    words of the description.
  // ---------------------------------------------------------------------
  var MIN_QUERY = 2;
  var NAME_INSIDE_MIN = 5;
  var AUTO_OPEN_MAX = 3;
  var MAX_SHOWN = 10;
  var letterChar = /[a-z0-9'’]/;

  function norm(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function typedWords(nq) { return nq.split(/\s+/).filter(Boolean); }

  // Stem rule, for words of four letters or more. A word gets itself plus the
  // word with ONE common ending removed, if what is left is still four letters
  // or more. Two words match when they share any candidate. Endings are
  // removed only, never added, and only for names, never for descriptions.
  var endings = ['ness', 'ful', 'ing', 'ly', 'ed', 'es', 'er', 's', 'y', 'd'];
  function candidates(word) {
    var out = [];
    if (word.length < 4) { return out; }
    out.push(word);
    endings.forEach(function (suf) {
      if (word.length - suf.length >= 4 && word.slice(-suf.length) === suf) {
        out.push(word.slice(0, word.length - suf.length));
      }
    });
    return out;
  }
  function sharesStem(a, b) {
    var ca = candidates(a), cb = candidates(b);
    return ca.some(function (x) { return cb.indexOf(x) !== -1; });
  }

  // Index of every word start in lower (already normalised) where a word begins
  // with the typed word.
  function wordStarts(lower, word) {
    var out = [], pos = 0, i;
    while ((i = lower.indexOf(word, pos)) !== -1) {
      if (i === 0 || !letterChar.test(lower.charAt(i - 1))) { out.push(i); }
      pos = i + 1;
    }
    return out;
  }

  // Rule 1. Does the description contain every typed word at a word start?
  function descriptionMatches(text, nq) {
    var lower = norm(text || ''), words = typedWords(nq);
    return words.length > 0 && words.every(function (w) { return wordStarts(lower, w).length > 0; });
  }

  // Rule 2, for one typed word and one normalised name.
  function wordMatchesName(w, n, level, insideOk) {
    var nameWords = n.split(/[^a-z0-9'’]+/).filter(Boolean);
    if (wordStarts(n, w).length) { return true; }
    if (insideOk && w.length >= NAME_INSIDE_MIN && n.indexOf(w) !== -1) { return true; }
    if (level === 'inner' && has(aliases, n) && aliases[n].indexOf(w) !== -1) { return true; }
    return nameWords.some(function (nw) { return sharesStem(w, nw); });
  }

  // Does this name (object with name and level) match the query? nq is already
  // normalised. startsOnly leaves out the inside-the-name rule (2b).
  function nameMatches(e, nq, startsOnly) {
    var n = norm(e.name), words = typedWords(nq);
    return words.length > 0 && words.every(function (w) { return wordMatchesName(w, n, e.level, !startsOnly); });
  }

  // Rule 0. Returns the hint to show when the query is too short, else "".
  function queryHint(nq) {
    return nq.length < MIN_QUERY ? 'Type at least ' + MIN_QUERY + ' letters.' : '';
  }

  // A missing, blank or non-string description is "", so search never breaks.
  // Always looked up by the full path key, never by a bare name.
  function getDescription(descriptions, path) {
    if (!descriptions || !has(descriptions, path)) { return ''; }
    var d = descriptions[path];
    return typeof d === 'string' ? d : '';
  }

  // Every path of the emotions rows, in table order: a parent, then its
  // children, depth first (as long as the rows are grouped, as they are).
  function buildEntries(rows) {
    var entries = [], seen = {};
    function add(path, level) {
      if (seen[path]) { return; }
      seen[path] = true;
      var parts = path.split('|');
      entries.push({ path: path, parts: parts, level: level, name: parts[parts.length - 1] });
    }
    rows.forEach(function (r) {
      add(r[0], 'inner');
      add(r[0] + '|' + r[1], 'middle');
      add(r[0] + '|' + r[1] + '|' + r[2], 'outer');
    });
    return entries;
  }

  // Ordered results. Order:
  // 1. Name matches (names with a word starting with the query first, then the
  //    rest), each followed straight away by its own sub-items in table order.
  // 2. Description-only matches (word starts only), in table order.
  // A name matched only inside a word (rule 2b) ranks after the others and is
  // never treated as a description match (descMatch stays false).
  // Each result: { path, parts, level, name, nameMatch, descMatch, child }.
  function findMatches(entries, descriptions, nq) {
    if (queryHint(nq)) { return []; }
    var starts = [], inside = [], listed = {}, info = {};
    entries.forEach(function (e) {
      var r = {
        path: e.path, parts: e.parts, level: e.level, name: e.name,
        descMatch: descriptionMatches(getDescription(descriptions, e.path), nq),
        nameMatch: nameMatches(e, nq),
        child: false
      };
      info[e.path] = r;
      if (r.nameMatch) { (nameMatches(e, nq, true) ? starts : inside).push(r); }
    });
    var ordered = [];
    starts.concat(inside).forEach(function (r) {
      if (listed[r.path]) { return; }
      listed[r.path] = true;
      ordered.push(r);
      entries.forEach(function (c) {
        if (c.path.indexOf(r.path + '|') === 0 && !listed[c.path]) {
          listed[c.path] = true;
          if (!info[c.path].nameMatch) { info[c.path].child = true; }
          ordered.push(info[c.path]);
        }
      });
    });
    var descOnly = entries.filter(function (e) { return !listed[e.path] && info[e.path].descMatch; })
      .map(function (e) { return info[e.path]; });
    return ordered.concat(descOnly);
  }

  // Splits text into plain and marked pieces. Each typed word is matched at word
  // starts only (rule 1) and the whole word that starts there is marked. Marking
  // whole words keeps screen readers from splitting a word in two. Returns
  // { segments: [{ text, mark }], words } where words are the typed words that
  // matched, in typed order. If normalising changes the length (unusual
  // characters), it falls back to one plain piece and no words.
  function highlight(text, nq) {
    var lower = norm(text), typed = typedWords(nq), matched = [], spans = [];
    if (lower.length !== text.length || !typed.length) {
      return { segments: [{ text: text, mark: false }], words: matched };
    }
    typed.forEach(function (w) {
      var starts = wordStarts(lower, w);
      if (starts.length && matched.indexOf(w) === -1) { matched.push(w); }
      starts.forEach(function (s) {
        var e = s + w.length;
        while (e < lower.length && letterChar.test(lower.charAt(e))) { e++; }
        spans.push([s, e]);
      });
    });
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    spans.forEach(function (sp) {
      var last = merged[merged.length - 1];
      if (last && sp[0] <= last[1]) { last[1] = Math.max(last[1], sp[1]); } else { merged.push([sp[0], sp[1]]); }
    });
    var segments = [], at = 0;
    merged.forEach(function (sp) {
      if (sp[0] > at) { segments.push({ text: text.slice(at, sp[0]), mark: false }); }
      segments.push({ text: text.slice(sp[0], sp[1]), mark: true });
      at = sp[1];
    });
    if (at < text.length) { segments.push({ text: text.slice(at), mark: false }); }
    return { segments: segments, words: matched };
  }

  // The one sentence that starts an opened description which matched the
  // search. Names up to three distinct typed words, so a screen reader user can
  // find them without any cue inside the text.
  function matchSentence(words) {
    if (!words.length) { return 'Description contains your search.'; }
    var shown = words.slice(0, 3).join(', ');
    var more = words.length > 3 ? ' and ' + (words.length - 3) + ' more' : '';
    return 'Description contains your search: ' + shown + more + '.';
  }

  // Descriptions that matched open on their own only when the whole result list
  // is short (three results or fewer).
  function autoOpen(descMatch, total) { return Boolean(descMatch) && total <= AUTO_OPEN_MAX; }

  function statusText(total, shown) {
    if (shown < total) { return total + ' results, showing the first ' + shown + '. Show all button follows the list.'; }
    return total + (total === 1 ? ' result' : ' results');
  }

  // "Anger, Mad, Furious": what a screen reader hears for a result. The visible
  // separator " > " is hidden from the accessibility tree.
  function pathLabel(parts) { return parts.join(', '); }

  return {
    MIN_QUERY: MIN_QUERY, NAME_INSIDE_MIN: NAME_INSIDE_MIN, AUTO_OPEN_MAX: AUTO_OPEN_MAX, MAX_SHOWN: MAX_SHOWN,
    norm: norm, typedWords: typedWords, wordStarts: wordStarts,
    descriptionMatches: descriptionMatches, nameMatches: nameMatches, queryHint: queryHint,
    getDescription: getDescription, buildEntries: buildEntries, findMatches: findMatches,
    highlight: highlight, matchSentence: matchSentence, autoOpen: autoOpen,
    statusText: statusText, pathLabel: pathLabel
  };
}));
