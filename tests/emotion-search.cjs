// Tests for the emotion search: the pure logic in assets/emotion-search.js
// (ported from the validated prototype's self test) and the wiring in index.html.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const searchSource = fs.readFileSync(path.join(root, 'assets/emotion-search.js'), 'utf8');
const ES = require('../assets/emotion-search.js');

let checks = 0;
function check(label, ok) { checks++; assert.ok(ok, label); }

// Prototype sample data: 25 rows and their approved descriptions. The prototype
// cases below depend on this exact text, so it is a fixed fixture, not the
// live data. Live data is checked in the second half of this file.
  var rows = [
    ["Anger", "Hurt", "Embarrassed"],
    ["Anger", "Hurt", "Devastated"],
    ["Anger", "Mad", "Furious"],
    ["Anger", "Mad", "Enraged"],
    ["Anger", "Frustrated", "Infuriated"],
    ["Anger", "Frustrated", "Irritated"],
    ["Anger", "Threatened", "Insecure"],
    ["Anger", "Threatened", "Jealous"],
    ["Sad", "Guilty", "Remorseful"],
    ["Sad", "Guilty", "Ashamed"],
    ["Sad", "Abandoned", "Ignored"],
    ["Sad", "Abandoned", "Victimized"],
    ["Sad", "Lonely", "Isolated"],
    ["Sad", "Lonely", "Abandoned"],
    ["Disgust", "Disapproval", "Judgmental"],
    ["Disgust", "Disapproval", "Loathing"],
    ["Disgust", "Awful", "Revulsion"],
    ["Happy", "Joyful", "Liberated"],
    ["Happy", "Joyful", "Ecstatic"],
    ["Happy", "Interested", "Inquisitive"],
    ["Happy", "Interested", "Amused"],
    ["Surprise", "Startled", "Shocked"],
    ["Surprise", "Startled", "Dismayed"],
    ["Fear", "Scared", "Frightened"],
    ["Fear", "Scared", "Terrified"]
  ];

  // Approved descriptions, keyed by path. Copied from outputs/descriptions/batch-1.md
  // (inner and middle) and batch-2.md (outer). Approved by Tim, 2026-11-28.
  var descriptions = {
    "Anger": "A strong feeling of displeasure. It often comes when something seems unfair, hurtful or in the way.",
    "Sad": "A feeling of sorrow or low mood. It often follows a loss, a disappointment or a hard day.",
    "Anger|Hurt": "Feeling emotionally wounded. It often follows words or actions that seemed unkind or unfair.",
    "Anger|Threatened": "Feeling that something you value, or your place in a situation, is at risk. It can happen when others seem to challenge you.",
    "Anger|Mad": "Feeling angry and worked up. It often happens when something has gone wrong or felt unfair.",
    "Anger|Frustrated": "Feeling blocked or held up. It often happens when plans go wrong or effort seems wasted.",
    "Sad|Guilty": "Feeling that you have done something wrong or let someone down. It often comes with a wish to put things right.",
    "Sad|Abandoned": "Feeling left behind or left without support. It often happens when someone you counted on is not there.",
    "Sad|Lonely": "Feeling alone or cut off from others. It can happen even when people are nearby.",
    "Anger|Hurt|Embarrassed": "Feeling self-conscious and stung after being exposed or teased. It can bring heat to the face and a wish to hide.",
    "Anger|Hurt|Devastated": "Feeling crushed by a painful blow. It often follows a serious betrayal or loss, and can feel overwhelming.",
    "Anger|Threatened|Insecure": "Feeling unsure of your standing, which can show up as irritation. It often happens when you worry others may be doing better.",
    "Anger|Threatened|Jealous": "Feeling uneasy that someone may take what you have or want. It often comes when a person or thing you value seems to be at risk.",
    "Anger|Mad|Furious": "Very angry, with strong heat and tension. It often comes when something feels deeply unfair, but you can still think and speak.",
    "Anger|Mad|Enraged": "Anger at its most intense, so strong it can push out clear thought. It often comes after being pushed past your limit.",
    "Anger|Frustrated|Infuriated": "Very angry because something keeps getting in your way. It often builds when a problem will not go away.",
    "Anger|Frustrated|Irritated": "Mildly annoyed, like a small thing that keeps nagging at you. It often comes from noise, delays or minor mistakes.",
    "Sad|Guilty|Remorseful": "Feeling genuine regret for something you did. It often comes with a wish that you had acted differently.",
    "Sad|Guilty|Ashamed": "Feeling that you are not good enough, not only that you did wrong. It can bring a wish to hide from others.",
    "Sad|Abandoned|Ignored": "Feeling unseen or unheard. It often happens when your words or presence get no response.",
    "Sad|Abandoned|Victimized": "Feeling that you were treated unfairly or harmed by others and could not stop it. It can leave you feeling helpless.",
    "Sad|Lonely|Isolated": "Being cut off from other people, by circumstance or by feeling. It can be about being physically apart or feeling unreachable.",
    "Sad|Lonely|Abandoned": "Feeling left on your own by someone who mattered. Here the focus is on the loneliness that follows being left.",
    // Batches 1 to 3, Disgust, Happy, Surprise and Fear (approved by Tim, 2026-11-28).
    "Disgust": "A feeling of strong dislike, as if you want to turn away. It can be about a smell, a person or an action.",
    "Happy": "A feeling of pleasure, warmth or lightness. It often comes when things go well or you feel connected to others.",
    "Surprise": "A quick reaction to something unexpected. It can be pleasant, unpleasant or neutral, and it often passes fast.",
    "Fear": "A feeling that something might go wrong or cause harm. It often comes with a wish to stay safe.",
    "Disgust|Disapproval": "Feeling that something or someone is not acceptable. It often happens when it goes against your values.",
    "Disgust|Awful": "Feeling that something is very unpleasant or bad. It can be a sight, an event or an experience that sits badly with you.",
    "Happy|Joyful": "Feeling bright, glad and full of life. It often comes with good news or time with people you enjoy.",
    "Happy|Interested": "Feeling curious and drawn in. It often happens when something new or engaging has your attention.",
    "Surprise|Startled": "A sudden jolt in reaction to something unexpected. It can be a loud noise or an abrupt event.",
    "Fear|Scared": "Feeling afraid of something that seems dangerous. It often comes with a wish to get away.",
    "Disgust|Disapproval|Judgmental": "Feeling quick to decide that someone or something is wrong. It often happens when their choices differ from your own.",
    "Disgust|Disapproval|Loathing": "A deep, lasting dislike of someone or something. It is stronger and more settled than simple disapproval.",
    "Disgust|Awful|Revulsion": "A sharp pull away from something that feels very unpleasant. It is quick and strong, and can be felt in the body.",
    "Happy|Joyful|Liberated": "Feeling free of something that held you back. It often brings lightness and a sense of room to move.",
    "Happy|Joyful|Ecstatic": "Feeling joy at its peak, far beyond ordinary happiness. It can feel energising, as if you could burst with delight.",
    "Happy|Interested|Inquisitive": "Feeling curious and keen to find out more. It often shows up as asking questions and wanting to look closer.",
    "Happy|Interested|Amused": "Feeling entertained by something funny or odd. It often brings a smile or a laugh, and holds your attention lightly.",
    "Surprise|Startled|Shocked": "Feeling jolted by something sudden and unexpected. It can leave you stunned for a moment, with a racing heart.",
    "Surprise|Startled|Dismayed": "Feeling troubled and let down by something unwelcome. It is a quieter upset than shock, often with a sinking feeling.",
    "Fear|Scared|Frightened": "Feeling afraid because something seems unsafe. It can bring a racing heart and a wish to get away.",
    "Fear|Scared|Terrified": "Feeling intense, overpowering fear. It is stronger than being frightened, and can leave you frozen or unable to think."
  };

const sampleEntries = ES.buildEntries(rows);
const sampleFind = q => ES.findMatches(sampleEntries, descriptions, ES.norm(q));
const pathsFor = q => sampleFind(q).map(m => m.path);
const startsWith = (p, head) => p === head || p.indexOf(head + '|') === 0;

// ---------------------------------------------------------------------
// Name matching cases: [query, name, level, expected].
// ---------------------------------------------------------------------
const nameCases = [
  ['angry', 'Anger', 'inner', true], ['angrier', 'Anger', 'inner', true],
  ['angered', 'Anger', 'inner', true], ['angers', 'Anger', 'inner', true],
  ['ang', 'Anger', 'inner', true], ['anger', 'Anger', 'inner', true],
  ['sadness', 'Sad', 'inner', true], ['sadly', 'Sad', 'inner', true],
  ['happiness', 'Happy', 'inner', true], ['fearful', 'Fear', 'inner', true],
  ['disgusted', 'Disgust', 'inner', true], ['surprised', 'Surprise', 'inner', true],
  ['hurting', 'Hurt', 'middle', true], ['hurts', 'Hurt', 'middle', true],
  ['jealousy', 'Jealous', 'outer', true], ['irritating', 'Irritated', 'outer', true],
  ['furiously', 'Furious', 'outer', true],
  ['terrified', 'Terrified', 'outer', true], ['scares', 'Scared', 'middle', true],
  ['shocking', 'Shocked', 'outer', true], ['amazing', 'Amazed', 'middle', true],
  ['joy', 'Joyful', 'middle', true], ['loathing', 'Loathing', 'outer', true],
  ['disapproving', 'Disapproval', 'middle', false], ['dismay', 'Dismayed', 'outer', true],
  ['dismissed', 'Dismayed', 'outer', false], ['revolt', 'Revulsion', 'outer', false],
  ['fear', 'Scared', 'middle', false], ['happy', 'Joyful', 'middle', false],
  ['surprised', 'Startled', 'middle', false], ['angry', 'Happy', 'inner', false],
  ['scared', 'Scarred', 'outer', false],
  ['angry', 'Sad', 'inner', false], ['angry', 'Mad', 'middle', false],
  ['angry', 'Furious', 'outer', false], ['angry', 'Hurt', 'middle', false],
  ['sadness', 'Mad', 'middle', false], ['sad', 'Mad', 'middle', false],
  ['made', 'Mad', 'middle', false], ['mads', 'Mad', 'middle', false],
  ['alone', 'Lonely', 'middle', false], ['loner', 'Lonely', 'middle', false],
  ['hurdle', 'Hurt', 'middle', false], ['ashamed', 'Shame', 'outer', false],
  ['fearful', 'Anger', 'inner', false], ['sadness', 'Sad', 'middle', false],
  ['sadness', 'Guilty', 'middle', false], ['angry', 'Anger', 'middle', false],
  ['shame', 'Ashamed', 'outer', true], ['ashame', 'Ashamed', 'outer', true],
  ['sham', 'Ashamed', 'outer', false], ['sha', 'Ashamed', 'outer', false],
  ['care', 'Scared', 'middle', false], ['scar', 'Scared', 'middle', true],
  ['e', 'Anger', 'inner', false], ['r', 'Anger', 'inner', false],
  ['ange', 'Anger', 'inner', true], ['ger', 'Anger', 'inner', false]
];
nameCases.forEach(c => {
  check(`${c[0]} vs ${c[1]} (${c[2]}): expected ${c[3]}`, ES.nameMatches({ name: c[1], level: c[2] }, ES.norm(c[0])) === c[3]);
});

// Description rule 1: [description text, typed query, expected]. Word starts only.
const descCases = [
  ['Something seems dangerous', 'anger', false], ['Something seems dangerous', 'dang', true],
  ['Something seems dangerous', 'danger', true], ['Something seems dangerous', 'ger', false],
  ['Be careful now', 'care', true], ['Feeling scared', 'care', false],
  ['Feeling unsafe', 'safe', false], ['Feeling unsafe', 'unsafe', true],
  ['To stay safe', 'safe', true], ['Feeling self-conscious', 'conscious', true],
  ['Feeling self-conscious', 'self-con', true], ['Feeling self-conscious', 'f-c', false],
  ["It's here", 's', false], ['Feeling afraid', 'feeling afr', true],
  ['Feeling afraid', 'afraid feel', true], ['Feeling afraid', 'feeling zzz', false],
  ['Feeling afraid', '', false], ['Anger at its peak', 'anger', true],
  ['Angry', 'anger', false], ['Feeling', 'e', false]
];
descCases.forEach(c => {
  check(`description '${c[0]}' vs '${c[1]}': expected ${c[2]}`, ES.descriptionMatches(c[0], ES.norm(c[1])) === c[2]);
});

// ---------------------------------------------------------------------
// Behaviour of the pure functions on the sample data.
// ---------------------------------------------------------------------
const entryFor = p => sampleEntries.filter(x => x.path === p)[0];
const infoFor = (q, p) => sampleFind(q).filter(m => m.path === p)[0];
const words = (text, q) => ES.highlight(text, ES.norm(q)).words;
const marks = (text, q) => ES.highlight(text, ES.norm(q)).segments.filter(s => s.mark).map(s => s.text);
const plain = (text, q) => ES.highlight(text, ES.norm(q)).segments.map(s => s.text).join('');

// Auto-open: three results or fewer open, four or more stay collapsed.
const few = sampleFind('hide');
check('hide gives three results or fewer', few.length >= 1 && few.length <= 3);
check('hide: every description opens on its own', few.every(r => ES.autoOpen(r.descMatch, few.length)));
const many = sampleFind('fe');
check('fe gives more than three results', many.length > 3);
check('fe: every Description button starts collapsed', many.every(r => !ES.autoOpen(r.descMatch, many.length)));
check('name-only results never auto-open', !ES.autoOpen(false, 1));
check('the sentence has no match: cue', !/match:/.test(ES.matchSentence(['hide'])));
const emb = infoFor('hide', 'Anger|Hurt|Embarrassed');
check('hide: Embarrassed matched by description', !!emb && emb.descMatch);
check('hide: Embarrassed description starts with the naming sentence',
  ES.matchSentence(words(descriptions[emb.path], 'hide')) === 'Description contains your search: hide.');
check('hide: matched word is still marked', marks(descriptions[emb.path], 'hide').length === 1);
check('Description button name uses the full path', 'Description for ' + ES.pathLabel(['Anger', 'Mad', 'Furious']) === 'Description for Anger, Mad, Furious');
check('inner Description button name is the single word', 'Description for ' + ES.pathLabel(['Anger']) === 'Description for Anger');
check('status with 25 results, 10 shown', ES.statusText(25, 10) === '25 results, showing the first 10. Show all button follows the list.');
check('status with all shown', ES.statusText(25, 25) === '25 results' && ES.statusText(1, 1) === '1 result');
check('new parents exist with approved text', ['Happy', 'Fear', 'Disgust', 'Surprise'].every(n => descriptions[n] && sampleEntries.some(e => e.path === n)));

// Rule 1 and the false positives found in the browser test.
check('anger lists only Anger paths, not Fear > Scared via dangerous', pathsFor('anger').length > 0 && pathsFor('anger').every(p => startsWith(p, 'Anger')));
check('anger does not mark dangerous', sampleFind('anger').every(r => !r.descMatch || marks(descriptions[r.path], 'anger').every(m => m !== 'dangerous')));
check('care does not match Scared, Frightened or Terrified', pathsFor('care').every(p => !startsWith(p, 'Fear|Scared')));
check('safe finds Fear (stay safe)', pathsFor('safe').indexOf('Fear') !== -1);
check('safe does not match Frightened via unsafe', pathsFor('safe').indexOf('Fear|Scared|Frightened') === -1);
check('unsafe matches Frightened', pathsFor('unsafe').indexOf('Fear|Scared|Frightened') !== -1);
check('dang finds Scared through dangerous', pathsFor('dang').indexOf('Fear|Scared') !== -1);
check('dang: dangerous is marked as a whole word', marks(descriptions['Fear|Scared'], 'dang').join() === 'dangerous');
check('dang: sentence lists the typed word, not the description word',
  ES.matchSentence(words(descriptions['Fear|Scared'], 'dang')) === 'Description contains your search: dang.');

// Rule 0: minimum length.
check('one letter gives a hint', ES.queryHint('e') === 'Type at least 2 letters.' && ES.queryHint('') !== '');
check('two letters give no hint', ES.queryHint('fe') === '');
['e', 'a', 's', 'r'].forEach(q => check(`one letter '${q}' finds nothing`, pathsFor(q).length === 0));
check('two letters match word starts only (ee is not found inside feeling)', pathsFor('ee').length === 0);
check('two letters match word starts (fe finds Fear)', pathsFor('fe').indexOf('Fear') !== -1);

// Rule 2: shame finds Ashamed by name only.
check('shame finds only Ashamed', JSON.stringify(pathsFor('shame')) === JSON.stringify(['Sad|Guilty|Ashamed']));
const sh = infoFor('shame', 'Sad|Guilty|Ashamed');
check('shame: Ashamed name is matched', sh.nameMatch);
check('shame: no description mark and no matched-words sentence', marks(descriptions[sh.path], 'shame').length === 0 && words(descriptions[sh.path], 'shame').length === 0);
check('shame: Ashamed is not a description match', sh.descMatch === false);

// Rule 4: the sentence names typed words.
check('two typed words: both listed in typed order',
  ES.matchSentence(words(descriptions['Anger|Hurt|Embarrassed'], 'wish hide')) === 'Description contains your search: wish, hide.');
check('matched words capped at three', ES.matchSentence(['a', 'b', 'c', 'd']) === 'Description contains your search: a, b, c and 1 more.');
check('no matched words gives the plain sentence', ES.matchSentence([]) === 'Description contains your search.');

// Highlight on its own text.
check('careful matches care and the whole word is marked', marks('Be careful now', 'care').join() === 'careful' && words('Be careful now', 'care').join() === 'care' && plain('Be careful now', 'care') === 'Be careful now');
check('scared is not marked for care', marks('Feeling scared', 'care').length === 0 && words('Feeling scared', 'care').length === 0);
check('only the word safe is marked, not unsafe', marks('Feeling unsafe and safe', 'safe').join() === 'safe');
check('hyphenated word part is a word start', marks('Feeling self-conscious', 'conscious').join() === 'conscious');
check('each word start is marked once and listed once', marks('Feeling feeling', 'fe').length === 2 && words('Feeling feeling', 'fe').join() === 'fe');
check('highlight never starts mid-word', ['anger', 'ger', 'e', 'care'].every(q =>
  marks('Something seems dangerous and scared, feeling careful', q).every(m => /^(careful|feeling)$/.test(m))));
check('highlight text is never changed', plain('Something seems dangerous and scared', 'dang') === 'Something seems dangerous and scared');

// Path text of result buttons.
check('Anger, Hurt label reads with the comma tight', ES.pathLabel(['Anger', 'Hurt']) === 'Anger, Hurt');
check('no result label has a space before a comma', sampleFind('anger').concat(sampleFind('fe')).every(r => ES.pathLabel(r.parts).indexOf(' ,') === -1));

// ---------------------------------------------------------------------
// Ranking, parent expansion, duplicates (sample data).
// ---------------------------------------------------------------------
const hurt = pathsFor('hurt');
check('a parent lists all its sub-items in table order, parent first',
  JSON.stringify(hurt.slice(0, 3)) === JSON.stringify(['Anger|Hurt', 'Anger|Hurt|Embarrassed', 'Anger|Hurt|Devastated']));
const ang = sampleFind('anger');
check('searching Anger lists every descendant', sampleEntries.filter(e => startsWith(e.path, 'Anger')).every(e => ang.some(r => r.path === e.path)));
check('sub-items that matched only through the parent are flagged', ang.filter(r => r.path.indexOf('|') !== -1 && !r.nameMatch).every(r => r.child));
const dangerHits = sampleFind('dang');
check('name matches rank before description-only matches', (() => {
  const q = sampleFind('fe');
  const firstDescOnly = q.findIndex(r => !r.nameMatch && !r.child);
  return firstDescOnly === -1 || q.slice(firstDescOnly).every(r => !r.nameMatch);
})());
check('description-only results follow all name results', (() => {
  const q = sampleFind('disgust');
  return q[0].path === 'Disgust' && q.filter(r => !r.nameMatch && !r.child).every(r => q.indexOf(r) > 0);
})());
check('a row never appears twice', ['fe', 'anger', 'hurt', 'abandoned', 'ed'].every(q => {
  const p = pathsFor(q);
  return new Set(p).size === p.length;
}));
check('duplicate word Abandoned shows both paths', ['Sad|Abandoned', 'Sad|Lonely|Abandoned'].every(p => pathsFor('abandoned').indexOf(p) !== -1));
check('dang results exist and every row is listed once', dangerHits.length >= 1 && new Set(dangerHits.map(r => r.path)).size === dangerHits.length);
check('accents are ignored', pathsFor('ánger').length === pathsFor('anger').length);
check('leading and trailing spaces are ignored', JSON.stringify(sampleFind('  anger ').map(r => r.path)) === JSON.stringify(pathsFor('anger')));
check('upper case matches', pathsFor('ANGER').length === pathsFor('anger').length);

// A missing description never breaks search: name search still works, description search finds nothing.
check('missing descriptions: name search still works', ES.findMatches(sampleEntries, {}, 'anger').length > 0);
check('missing descriptions: description-only word finds nothing', ES.findMatches(sampleEntries, {}, 'dang').length === 0);
check('missing descriptions: undefined object is safe', ES.findMatches(sampleEntries, undefined, 'anger').length > 0);
check('non-string description is treated as missing', ES.getDescription({ Anger: 7 }, 'Anger') === '' && ES.getDescription({}, 'Anger') === '' && ES.getDescription({ Anger: '  ' }, 'Anger').trim() === '');
check('description lookup uses the full path, never a bare name', ES.getDescription({ Mad: 'x' }, 'Anger|Mad') === '');
check('prototype keys are not found as descriptions', ES.getDescription({}, 'constructor') === '' && ES.getDescription({}, '__proto__') === '');

// ---------------------------------------------------------------------
// Live data: the real emotions array and approved descriptions.
// ---------------------------------------------------------------------
const emotions = JSON.parse(html.match(/const emotions = (\[\[.*?\]\]);/)[1]);
const liveDescriptions = new Function(fs.readFileSync(path.join(root, 'assets/emotion-descriptions.js'), 'utf8') + '\nreturn EMOTION_DESCRIPTIONS;')();
const live = ES.buildEntries(emotions);
const liveFind = q => ES.findMatches(live, liveDescriptions, ES.norm(q));
check('live data has 114 paths (6, 36, 72)', live.length === 114 && live.filter(e => e.level === 'inner').length === 6 && live.filter(e => e.level === 'middle').length === 36 && live.filter(e => e.level === 'outer').length === 72);
check('live entries are in table order, parent first', live[0].path === 'Anger' && live[1].path === 'Anger|Hurt' && live[2].path === 'Anger|Hurt|Embarrassed');
check('live: every path has a description by full path', live.every(e => ES.getDescription(liveDescriptions, e.path) !== ''));
check('live: Inferior returns both paths', ['Sad|Depressed|Inferior', 'Fear|Insecure|Inferior'].every(p => liveFind('inferior').some(r => r.path === p)));
check('live: Abandoned returns both Abandoned paths', ['Sad|Abandoned', 'Sad|Lonely|Abandoned'].every(p => liveFind('abandoned').some(r => r.path === p)));
check('live: Inadequate returns both paths', ['Fear|Insecure|Inadequate', 'Fear|Rejected|Inadequate'].every(p => liveFind('inadequate').some(r => r.path === p)));
check('live: Angry finds Anger and lists every descendant right after it', (() => {
  const r = liveFind('angry').map(x => x.path);
  const kids = live.filter(e => e.path.indexOf('Anger|') === 0).map(e => e.path);
  return r[0] === 'Anger' && JSON.stringify(r.slice(1, 1 + kids.length)) === JSON.stringify(kids);
})());
check('live: a result list never repeats a row', ['fe', 'ang', 'sad', 'feel', 'ab'].every(q => { const p = liveFind(q).map(x => x.path); return new Set(p).size === p.length; }));
check('live: each description-only result matches by description and not by name', liveFind('feel').filter(r => !r.nameMatch && !r.child).every(r => r.descMatch));
check('live: a word only in a description finds that emotion after the name matches', (() => {
  // Pick a description word that is in no name, for the first few paths.
  let tested = 0;
  for (const e of live.slice(0, 40)) {
    const w = ES.norm(liveDescriptions[e.path]).split(/[^a-z]+/).find(x => x.length >= 6 && !live.some(n => ES.nameMatches(n, x)));
    if (!w) continue;
    const res = liveFind(w);
    const idx = res.findIndex(r => r.path === e.path);
    if (idx === -1 || !res[idx].descMatch) return false;
    tested++;
  }
  return tested >= 10;
})());
check('live: the description group comes after every name or sub-item result', ['feel', 'wish', 'often'].every(q => {
  const res = liveFind(q);
  const i = res.findIndex(r => !r.nameMatch && !r.child);
  return i === -1 || res.slice(i).every(r => !r.nameMatch && !r.child);
}));
check('live: highlight text equals the description for every description', live.every(e => plain(liveDescriptions[e.path], 'feel') === liveDescriptions[e.path]));

// ---------------------------------------------------------------------
// The real index.html: markup, scripts and wiring.
// ---------------------------------------------------------------------
const version = fs.readFileSync(path.join(root, 'assets/version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
check('search form has role search and a name', /<form role="search" id="searchForm" aria-label="Find an emotion">/.test(html) && !/<form role="search"[^>]*aria-labelledby/.test(html));
check('search input is type search with a label and described by help', /<label for="searchInput">Find an emotion<\/label>/.test(html) && /<input type="search" id="searchInput" maxlength="200" autocomplete="off" aria-describedby="searchHelp">/.test(html) && /<p id="searchHelp" class="help">/.test(html));
check('search input has maxlength 200', /<input type="search" id="searchInput"[^>]*maxlength="200"/.test(html));
check('search heading has the 4px focus ring', /#search-heading:focus[^{]*\{ outline: 4px solid var\(--focus\)/.test(html));
const oddRows = [['constructor', 'a', 'b'], ['__proto__', 'c', 'd'], ['constructor', 'a', 'b']];
const oddPaths = ES.buildEntries(oddRows).map(e => e.path);
check('buildEntries keeps paths named constructor and __proto__, once each', oddPaths.length === 6 && oddPaths.includes('constructor') && oddPaths.includes('__proto__') && oddPaths.includes('__proto__|c|d'));
const helpText = html.match(/<p id="searchHelp" class="help">([^<]*)<\/p>/)[1];
check('the input description is one or two short sentences', helpText.split('. ').length <= 2 && helpText.split(/\s+/).length <= 30);
check('Search tips is a collapsed disclosure button with the detail outside the description', /<button type="button" id="searchTipsButton" class="search-tips-button" aria-expanded="false" aria-controls="searchTips">Search tips<\/button>/.test(html) && /<div id="searchTips" class="help" hidden>/.test(html) && /Down Arrow enters the results/.test(html.match(/<div id="searchTips"[\s\S]*?<\/div>/)[0]) && /\.search-tips-button \{ min-height: 2\.75rem/.test(html));
check('search form has a visible Search submit button between the input and Search tips', /<input type="search" id="searchInput"[^>]*>\s*<button type="submit" id="searchSubmit" class="search-tips-button">Search<\/button>\s*<button type="button" id="searchTipsButton"/.test(html) && /id="searchSubmit"/.test(html.match(/<form role="search"[\s\S]*?<\/form>/)[0]));
check('searchShowAll has a non-empty accessible name in the source markup', />\s*\S[^<]*<\/button>/.test(html.match(/<button[^>]*id="searchShowAll"[^>]*>[^<]*<\/button>/)[0]));
check('the wcag/h32 disable comment is gone from the search form', !/html-validate-disable[^\]]*wcag\/h32/.test(html));
check('search sits above Step 1', html.indexOf('id="emotion-search"') !== -1 && html.indexOf('id="emotion-search"') < html.indexOf('id="emotion-selector"'));
check('status region, results list, Show all and Skip results exist', /<p id="searchStatus" class="visually-hidden" role="status"><\/p>/.test(html) && /<ul id="searchResults" class="search-results" role="list" aria-label="Matching emotions" hidden>/.test(html) && /<button type="button" id="searchShowAll" hidden>Show all results<\/button>/.test(html) && /<a href="#inner-heading" id="searchSkip" hidden>Skip results<\/a>/.test(html));
check('the minimum length paragraph is hidden until needed', /<p id="searchEmpty" class="help" hidden><\/p>/.test(html));
check('Skip results link is not counted as a page skip link', !/class="skip-link"[^>]*>Skip results/.test(html));
const descTag = `<script src="assets/emotion-descriptions.js?v=${version}"></script>`;
const searchTag = `<script src="assets/emotion-search.js?v=${version}"></script>`;
const inlineStart = html.indexOf('// Emotion search (display only)');
check('both script tags use the version query', html.includes(descTag) && html.includes(searchTag));
check('scripts load in order before the search code', html.indexOf(descTag) < html.indexOf(searchTag) && html.indexOf(searchTag) < inlineStart);
const searchCode = html.slice(inlineStart, html.indexOf('</script>', inlineStart));
const mainCode = html.slice(html.indexOf('const emotions = '), html.indexOf(descTag));
const code = (searchCode + '\n' + searchSource).replace(/\/\/.*$/gm, '');
check('typing delay is 800 ms and the Show all delay is 400 ms', /const TYPING_DELAY = 800;/.test(searchCode) && /const AFTER_SHOW_ALL_DELAY = 400;/.test(searchCode));
check('Escape announces Search cleared', /announce\('searchStatus', 'Search cleared'/.test(searchCode));
check('search code uses no innerHTML', !/innerHTML|insertAdjacentHTML|outerHTML/.test(code));
check('pure file has no DOM access', !/\bdocument\b|\bwindow\b|createElement/.test(searchSource.replace(/\/\/.*$/gm, '')));
check('search code never touches storage, export, backup or Drive', !/localStorage|sessionStorage|saveLog|JSON\.stringify|indexedDB|fetch\(|createObjectURL|googleDrive|driveSync|storageKey/.test(code));
check('nothing before the search code refers to the search', !/EmotionSearch|searchInput|searchResults|runSearch|searchStatus/.test(mainCode));
// Display only: no save, export, backup, Drive or serialising function mentions the search or descriptions.
for (const m of html.matchAll(/function\s+(\w*(?:save|export|backup|drive|sync|serial|stringify)\w*)\s*\([^)]*\)\s*\{/gi)) {
  let depth = 0, i = m.index + m[0].length - 1, end = i;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) { end = i; break; } }
  check(`${m[1]} does not use the search`, !/EmotionSearch|searchInput|EMOTION_DESCRIPTIONS|selectedSearch/.test(html.slice(m.index, end)));
}
const recordHandler = html.match(/recordButton\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\);/)[1];
check('the Record handler is unchanged by search', !/search/i.test(recordHandler));
check('the Reset handler is unchanged by search', !/search/i.test(html.match(/resetButton\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\);/)[1]));
check('review dataset mode turns search off and says why', /reviewdatasetchange/.test(searchCode) && /input\.disabled = reviewing/.test(searchCode) && /id="searchReviewNote" class="help" hidden>Search is unavailable while you view shared data/.test(html));

// ---------------------------------------------------------------------
// Run the real page code against a small fake DOM, to check that choosing a
// result sets the three selection variables exactly as the step buttons do.
// ---------------------------------------------------------------------
class El {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.hidden = false; this.own = ''; this.value = ''; this.disabled = false; this.className = ''; this.classList = { contains: c => this.className.split(' ').includes(c) }; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren() { this.children = []; this.own = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t, ev) { const e = Object.assign({ preventDefault() {}, stopPropagation() {}, target: this, key: '' }, ev); (this.listeners[t] || []).forEach(f => f(e)); }
  set textContent(v) { this.own = String(v); this.children = []; }
  get textContent() { return this.own + this.children.map(c => c.textContent).join(''); }
  all(test, out = []) { this.children.forEach(c => { if (test(c)) out.push(c); c.all(test, out); }); return out; }
  querySelectorAll(sel) { return this.all(c => sel[0] === '.' ? c.className.split(' ').includes(sel.slice(1)) : c.tagName === sel); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  focus() { ctx.focused = this; }
}
const nodes = {};
const doc = new El('document');
doc.getElementById = id => (nodes[id] = nodes[id] || new El('x'));
doc.createElement = tag => new El(tag);
doc.createTextNode = t => { const n = new El('#text'); n.own = String(t); return n; };
const log = { renderAll: 0, nextControl: 0 };
const ctx = vm.createContext({
  document: doc, setTimeout, clearTimeout, console, Array, Object,
  MutationObserver: class { observe() {} },
  emotions, selectedInner: null, selectedMiddle: null, selectedOuter: null,
  selectionText: new El('p'), recordButton: nodes.recordButton = new El('button'), resetButton: nodes.resetButton = new El('button'),
  getReviewDataset: () => ctx.review, review: null,
  closeAddDetail() { return ""; }, renderAll() { log.renderAll++; }, focusNextRecordingControl() { log.nextControl++; }, focused: null
});
vm.runInContext('var window = this;', ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/emotion-descriptions.js'), 'utf8'), ctx);
vm.runInContext(searchSource, ctx);
vm.runInContext(searchCode, ctx);
const input = nodes.searchInput, list = nodes.searchResults, form = nodes.searchForm;
const resultFor = p => list.querySelectorAll('.result-select').filter(b => b.getAttribute('data-path') === p)[0];
const type = q => { input.value = q; form.fire('submit'); };

type('furious');
check('searching lists results and shows the list', !list.hidden && list.children.length >= 1 && !nodes.searchSkip.hidden);
check('a result button is named with commas', resultFor('Anger|Mad|Furious').getAttribute('aria-label') === 'Anger, Mad, Furious');
check('the visible path separator is hidden from the accessibility tree', resultFor('Anger|Mad|Furious').all(c => c.attrs['aria-hidden'] === 'true' && c.own === ' > ').length === 2);
const toggle = list.querySelectorAll('.desc-toggle')[0];
check('Description button has aria-expanded and aria-controls', toggle.getAttribute('aria-expanded') !== null && /^rdesc-/.test(toggle.getAttribute('aria-controls')));
check('Description button name uses the full path', /^Description for Anger, Mad, Furious$/.test(list.children.filter(li => li.querySelector('.result-select').getAttribute('data-path') === 'Anger|Mad|Furious')[0].querySelector('.desc-toggle').textContent));

resultFor('Anger|Mad|Furious').fire('click');
check('choosing an outer result sets all three variables', ctx.selectedInner === 'Anger' && ctx.selectedMiddle === 'Mad' && ctx.selectedOuter === 'Furious');
check('choosing renders the page and moves focus to the next recording control', log.renderAll === 1 && log.nextControl === 1);
type('mad');
resultFor('Anger|Mad').fire('click');
check('choosing a middle result sets inner and middle and clears outer', ctx.selectedInner === 'Anger' && ctx.selectedMiddle === 'Mad' && ctx.selectedOuter === null);
check('choosing a middle result moves focus to the Step 3 heading', nodes['outer-heading'] === ctx.focused);
type('anger');
resultFor('Anger').fire('click');
check('choosing an inner result clears middle and outer', ctx.selectedInner === 'Anger' && ctx.selectedMiddle === null && ctx.selectedOuter === null);
check('choosing an inner result moves focus to the Step 2 heading', nodes['middle-heading'] === ctx.focused);
type('inferior');
resultFor('Fear|Insecure|Inferior').fire('click');
check('a duplicate name selects its own path', ctx.selectedInner === 'Fear' && ctx.selectedMiddle === 'Insecure' && ctx.selectedOuter === 'Inferior');

type('x');
check('one letter shows the hint and no list', !nodes.searchEmpty.hidden && nodes.searchEmpty.textContent === 'Type at least 2 letters.' && list.hidden);
type('zzzzz');
check('no match shows a message and no list', !nodes.searchEmpty.hidden && /^No emotions found for 'zzzzz'/.test(nodes.searchEmpty.textContent) && list.hidden);
type('fe');
check('many results show Show all and the first 10 only', !nodes.searchShowAll.hidden && list.querySelectorAll('.result-select').length === 10 && /^Show all \d+ results$/.test(nodes.searchShowAll.textContent));
nodes.searchShowAll.fire('click');
check('Show all lists every result and hides itself', nodes.searchShowAll.hidden && list.querySelectorAll('.result-select').length > 10);
check('Show all moves focus to the first new result', ctx.focused === list.querySelectorAll('.result-select')[10]);

type('anger');
nodes.resetButton.fire('click');
check('Reset clears the search text, results and status', input.value === '' && list.hidden && nodes.searchStatus.textContent === '');
type('anger');
ctx.selectedInner = null;
nodes.recordButton.fire('click');
check('Record clears the search once the selection is cleared', input.value === '' && list.hidden);
type('anger');
ctx.selectedInner = 'Anger';
nodes.recordButton.fire('click');
check('a failed save leaves the search alone', input.value === 'anger' && !list.hidden);
input.fire('keydown', { key: 'Escape' });
check('Escape clears the search', input.value === '' && list.hidden);

type('anger');
ctx.review = { label: 'shared' };
doc.fire('reviewdatasetchange');
check('review dataset mode disables search, clears it and shows the note', input.disabled && input.value === '' && list.hidden && !nodes.searchReviewNote.hidden);
type('anger');
check('review dataset mode lists nothing even if a search is forced', list.hidden);
ctx.review = null;
doc.fire('reviewdatasetchange');
check('leaving review dataset mode turns search back on', !input.disabled && nodes.searchReviewNote.hidden);

// Search tips disclosure.
const tipsBtn = nodes.searchTipsButton;
tipsBtn.fire('click');
check('Search tips opens: aria-expanded true and panel shown', tipsBtn.getAttribute('aria-expanded') === 'true' && !nodes.searchTips.hidden);
tipsBtn.fire('click');
check('Search tips closes again', tipsBtn.getAttribute('aria-expanded') === 'false' && nodes.searchTips.hidden);

// Review mode with focus in the input: note is described, focus moves, note is announced once.
check('outside review mode the input is described by the hint only', input.getAttribute('aria-describedby') === 'searchHelp');
doc.activeElement = input;
ctx.review = { label: 'shared' };
doc.fire('reviewdatasetchange');
check('review mode adds the note to the input description', input.getAttribute('aria-describedby') === 'searchHelp searchReviewNote');
check('review mode moves focus off the disabled input to the search heading', ctx.focused === nodes['search-heading'] && nodes['search-heading'].getAttribute('tabindex') === '-1');
ctx.review = null;
doc.fire('reviewdatasetchange');
check('leaving review mode restores the description', input.getAttribute('aria-describedby') === 'searchHelp');
doc.activeElement = null;

// Typing timer: submit and list focus or keys cancel a pending debounce.
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const rebuilds = () => { let n = 0; const orig = list.replaceChildren; list.replaceChildren = function () { n++; return orig.apply(this, arguments); }; return { get n() { return n; }, stop() { list.replaceChildren = orig; } }; };
  let spy = rebuilds();
  input.value = 'anger'; input.fire('input'); form.fire('submit');
  await wait(1000);
  check('submit cancels the typing timer so the list is built once', spy.n === 1);
  spy.stop();

  type('anger');
  input.value = 'fe'; input.fire('input');
  spy = rebuilds();
  list.fire('focusin');
  await wait(1000);
  check('focus in the results cancels a pending rebuild', spy.n === 0);
  input.value = 'fe'; input.fire('input');
  list.fire('keydown', { key: 'ArrowDown', target: { closest: () => null, classList: { contains: () => false } } });
  await wait(1000);
  check('a key in the results cancels a pending rebuild', spy.n === 0);
  spy.stop();

console.log(`emotion-search: ok (${checks} checks)`);
setTimeout(() => process.exit(0), 0);
})();
