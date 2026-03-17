/**
 * CatGPT — script.js
 * ══════════════════════════════════════════════════════════
 *
 *  PIPELINE (runs on every user message):
 *
 *  Step 1 — EXTRACT CAT TOPICS
 *           Scan the sentence for any cat-related nouns/concepts.
 *           e.g. "what color cat is aggressive" → topics: {color, aggressive, cat}
 *
 *  Step 2 — DETECT QUESTION WORD (intent filter)
 *           what / which → attribute   (color, size, name…)
 *           why          → reason      (behavior, biology…)
 *           how          → method      (speed, process…)
 *           where        → location    (habitat, range…)
 *           when         → time        (history, age…)
 *           who          → entity      (owner, record…)
 *           can/does/are → ability/fact
 *
 *  Step 3 — MAP topics → required answer tags
 *           color + attribute → look for entries tagged [color, coat, fur, orange…]
 *           aggressive + attribute → [aggressive, behavior, breed, territorial…]
 *
 *  Step 4 — SCORE knowledge.json + facts.json
 *           against (topics × attribute tags)
 *           → return highest-scoring match above threshold
 *
 *  Step 5 — FALLBACK: Wikipedia REST API (free, no key)
 *           Build a targeted query from topics + intent,
 *           pick the most relevant sentence from the extract.
 *
 *  Step 6 — FALLBACK: catfact.ninja (free, no key)
 *           If Wikipedia also fails, fetch a live random cat fact.
 *
 * ══════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────
   STATE
───────────────────────────────────────── */
const App = {
  facts:     [],
  knowledge: [],
  math:      [],
  science:   [],
  busy:      false,
  mood:      'happy',
  quiz: {
    active:    false,
    type:      null,      // 'math' or 'science'
    questions: [],        // shuffled questions for this session
    current:   0,         // current question index
    score:     0,         // points earned
    answered:  [],        // tracking answers [{ questionId, correct }]
  }
};

/* ─────────────────────────────────────────
   MOOD CONFIG
───────────────────────────────────────── */
const MOODS = {
  happy:    { emoji: '😸', label: 'Happy' },
  curious:  { emoji: '🤔', label: 'Curious' },
  excited:  { emoji: '🎉', label: 'Excited' },
  sleepy:   { emoji: '😴', label: 'Sleepy' },
  playful:  { emoji: '😹', label: 'Playful' },
  surprised:{ emoji: '🙀', label: 'Surprised' },
};

/* ─────────────────────────────────────────
   SOCIAL RESPONSE POOLS
───────────────────────────────────────── */
const POOL = {
  greeting: [
    "Purrrr… hi there! I was just napping! 😸",
    "Meow! Hello hooman! *slow blinks lovingly* 💕",
    "Oh hey! *bumps head against your hand* 🐾",
    "Hi! You interrupted nap #4 but I forgive you! 😄",
  ],
  farewell: [
    "Bye! I'll be napping right here when you return. 😴",
    "See you later! *flicks tail goodbye* 🐾",
    "Goodbye! Leave your laptop open for me to sit on! 🖥️😸",
  ],
  thanks: [
    "You're welcome! Now open a can of tuna please. 🐟",
    "Anytime! *purrs loudly* 😸",
    "Happy to help! *kneads your lap* 🐾",
  ],
  play: [
    "ZOOM! *knocks everything off the table* Totally on purpose! 🏃💨",
    "LASER DOT! WHERE IS IT?! 🔴😱 *spins in circles*",
    "Let's play! *pounces on your shadow* Gotcha! 👤🐱",
    "YARN! YAAARN! *tangles self completely* I'm fine! 🧶😂",
  ],
  compliment: [
    "Aww stop it! *blushes under fur* 😻",
    "You're so sweet! *purrs extra loud* ✨",
    "*rubs face on your leg* I like you a lot, hooman! 💕",
  ],
  sad: [
    "Aw, sounds rough. *sits on your lap and purrs* 🐾💕",
    "Here — therapeutic cat purring. Studies show it helps! 🌀",
    "You've got a cat who cares! *headbonks gently* 😸",
  ],
  confused: [
    "Hmm... *tilts head adorably* Try asking something about cats! 🐱",
    "Mrrrow? That's beyond my cat brain. Ask me a cat question! 🤔",
    "I gave that 110% cat brain power and got... nothing. 🐾",
  ],
  no_result: [
    "I searched everywhere but couldn't find that! Try rephrasing? 🐱",
    "Even Wikipedia couldn't help with that one! Try another cat question? 🤔",
    "My cat knowledge ran dry on that one! Ask me something else! 😅",
  ],
  cat_click: [
    "*stares at you with zero expression* Mrow.",
    "OW! ...jk I loved that, do it again! 🐾",
    "Purrrr~ 😸 A little to the left... yes, right there.",
    "*bites your finger affectionately* Oops. Still love you! 🦷❤️",
    "*slow blink* That means I trust you, you know! 💕",
  ],
};

/* ══════════════════════════════════════════════════════
   STEP 1 — CAT TOPIC EXTRACTION
   
   Maps words in the sentence → normalized topic tokens.
   e.g. "what color cat is aggressive"
     → topics: Set { 'color', 'aggressive', 'cat' }
══════════════════════════════════════════════════════ */
const TOPIC_MAP = [
  // Physical appearance
  { words: ['color','colour','colored','coloured','coat','fur','orange','ginger','black','white','gray','grey','tabby','calico','tortoiseshell','pattern','markings'], topic: 'color' },
  { words: ['size','big','small','large','tiny','weight','heavy','tall','short','length'], topic: 'size' },
  { words: ['eye','eyes','sight','vision','see','seeing','blind','pupil','iris','retina'], topic: 'vision' },
  { words: ['ear','ears','hear','hearing'], topic: 'hearing' },
  { words: ['whisker','whiskers','vibrissae'], topic: 'whiskers' },
  { words: ['tail','tails'], topic: 'tail' },
  { words: ['paw','paws','claw','claws','nail','nails'], topic: 'paws' },
  { words: ['anatomy','body','biology','organ','bone','spine','skeleton','muscle'], topic: 'anatomy' },

  // Behavior
  { words: ['aggressive','aggression','attack','attacks','bite','biting','scratch','hostile','mean','angry','fierce','territorial'], topic: 'aggressive' },
  { words: ['annoying','irritating','annoyed','irritate','bother','bothering','needy','clingy','demanding','loud','noisy','vocal','talkative','hyper','crazy','wild','chaotic','naughty','mischievous','troublesome','pest','pestering'], topic: 'annoying' },
  { words: ['personality','trait','traits','character','temperament','disposition','nature','attitude'], topic: 'personality' },
  { words: ['most','least','best','worst','top','ranking','rank','popular','common','famous','known'], topic: 'ranking' },
  { words: ['friendly','tame','gentle','sweet','calm','affectionate','loving','social','sociable'], topic: 'friendly' },
  { words: ['purr','purring','purrs'], topic: 'purr' },
  { words: ['meow','meowing','vocalize','talk','communicate','language'], topic: 'meow' },
  { words: ['knead','kneading','biscuit','biscuits'], topic: 'knead' },
  { words: ['sleep','sleeping','nap','napping','rest','lazy','sleepy'], topic: 'sleep' },
  { words: ['groom','grooming','clean','lick','licking'], topic: 'groom' },
  { words: ['hunt','hunting','prey','predator','chase','stalk','stalking'], topic: 'hunt' },
  { words: ['hiss','hissing','growl','growling'], topic: 'hiss' },
  { words: ['play','playing','toy','yarn','laser'], topic: 'play' },
  { words: ['jump','jumping','leap','climb','climbing'], topic: 'jump' },
  { words: ['run','running','speed','fast','sprint','mph'], topic: 'speed' },
  { words: ['land','fall','falling','righting','reflex'], topic: 'righting' },

  // Biology / Health / Diet
  { words: ['eat','eating','food','diet','nutrition','hungry','feed','tuna','fish','meat'], topic: 'diet' },
  { words: ['drink','water','milk','hydrate'], topic: 'drink' },
  { words: ['catnip','nip','herb'], topic: 'catnip' },
  { words: ['age','lifespan','live','life','old','year','years','long','oldest'], topic: 'lifespan' },
  { words: ['breed','breeds','type','types','kind','kinds','species','race'], topic: 'breed' },
  { words: ['domestic','indoor','outdoor','house','wild','feral'], topic: 'domestic' },
  { words: ['pregnant','pregnancy','birth','kitten','kittens','baby','babies'], topic: 'birth' },
  { words: ['health','sick','disease','ill','vet','vaccine','parasite','flea'], topic: 'health' },
  { words: ['smell','nose','scent','sniff'], topic: 'smell' },
  { words: ['taste','tongue','flavor','sweet','bitter'], topic: 'taste' },
  { words: ['allergy','allergic','sneeze','dander'], topic: 'allergy' },

  // General
  { words: ['cat','cats','feline','felines','kitty','kitten','tabby','tomcat','moggy'], topic: 'cat' },
  { words: ['history','origin','ancient','egypt','ancestor','evolve','evolution'], topic: 'history' },
  { words: ['group','clowder','colony','pack'], topic: 'group' },
  { words: ['name','called','record','famous','known'], topic: 'name' },
];

function extractTopics(sentence) {
  const lower = sentence.toLowerCase();
  const words = lower.split(/\W+/).filter(Boolean);
  const topics = new Set();

  for (const entry of TOPIC_MAP) {
    for (const trigger of entry.words) {
      const matched = trigger.includes(' ')
        ? lower.includes(trigger)
        : words.includes(trigger);
      if (matched) { topics.add(entry.topic); break; }
    }
  }

  return topics;
}

/* ══════════════════════════════════════════════════════
   STEP 2 — QUESTION WORD → INTENT
   
   Tells us WHAT KIND of answer the user wants.
   e.g. "what color" → intent: 'attribute'
        "why do cats" → intent: 'reason'
        "how fast"    → intent: 'method'
══════════════════════════════════════════════════════ */
const QUESTION_PATTERNS = [
  { pattern: /^what\b/i,            intent: 'attribute' },
  { pattern: /^which\b/i,           intent: 'attribute' },
  { pattern: /^why\b/i,             intent: 'reason'    },
  { pattern: /^how\b/i,             intent: 'method'    },
  { pattern: /^where\b/i,           intent: 'location'  },
  { pattern: /^when\b/i,            intent: 'time'      },
  { pattern: /^who\b/i,             intent: 'entity'    },
  { pattern: /\bcan cats?\b/i,      intent: 'ability'   },
  { pattern: /\bdo(es)? cats?\b/i,  intent: 'fact'      },
  { pattern: /\bare cats?\b/i,      intent: 'fact'      },
  { pattern: /\bis (a )?cat\b/i,    intent: 'fact'      },
  { pattern: /\btell me\b/i,        intent: 'fact'      },
  { pattern: /\bgive me\b/i,        intent: 'fact'      },
  { pattern: /\bfact\b/i,           intent: 'fact'      },
  { pattern: /\bexplain\b/i,        intent: 'reason'    },
];

function detectIntent(sentence) {
  const trimmed = sentence.trim();
  for (const { pattern, intent } of QUESTION_PATTERNS) {
    if (pattern.test(trimmed)) return intent;
  }
  return 'statement';
}

/* ══════════════════════════════════════════════════════
   STEP 3 — TOPICS → REQUIRED ANSWER TAGS
   
   Given the topics + intent, build the tag set
   we need the answer to contain.
   e.g. topics={color, aggressive} + intent=attribute
     → tags: {color, coat, fur, orange, aggressive, behavior, breed}
══════════════════════════════════════════════════════ */
const TOPIC_TO_TAGS = {
  color:     ['color','coat','fur','orange','black','white','gray','calico','tabby','pattern','appearance','breed'],
  size:      ['size','weight','body','anatomy','breed'],
  vision:    ['eye','vision','sight','color','see','body','anatomy'],
  hearing:   ['ear','hearing','sound','body','anatomy'],
  whiskers:  ['whisker','sense','navigate','body','anatomy'],
  tail:      ['tail','body','behavior','signal'],
  paws:      ['paw','claw','body','scratch','anatomy'],
  anatomy:   ['body','anatomy','biology','bone','spine'],
  aggressive: ['aggressive','anger','behavior','attack','bite','scratch','territorial','breed','color'],
  annoying:   ['annoying','vocal','loud','needy','behavior','breed','personality','temperament','siamese','demanding'],
  personality:['personality','temperament','behavior','breed','trait','character','annoying','friendly','aggressive'],
  ranking:    ['breed','personality','behavior','annoying','aggressive','friendly','most','popular','type'],
  friendly:   ['friendly','behavior','social','breed','calm'],
  purr:      ['purr','sound','heal','behavior','body'],
  meow:      ['meow','sound','communicate','behavior','language'],
  knead:     ['knead','behavior','comfort','kitten'],
  sleep:     ['sleep','behavior','rest','lazy'],
  groom:     ['groom','clean','behavior','body'],
  hunt:      ['hunt','prey','predator','behavior','speed'],
  hiss:      ['hiss','aggressive','behavior','warning'],
  play:      ['play','behavior','fun','kitten','toy'],
  jump:      ['jump','athletic','speed','body'],
  speed:     ['speed','fast','run','body','athletic'],
  righting:  ['land','fall','body','reflex','anatomy'],
  diet:      ['food','eat','diet','meat','nutrition'],
  drink:     ['drink','water','food','diet'],
  catnip:    ['catnip','herb','behavior','plant'],
  lifespan:  ['age','lifespan','old','life','record'],
  breed:     ['breed','type','kinds','domestic','color','behavior'],
  domestic:  ['domestic','indoor','outdoor','behavior','lifespan'],
  birth:     ['birth','kitten','baby','pregnant','biology'],
  health:    ['health','sick','disease','vet','biology'],
  smell:     ['smell','nose','scent','body','anatomy'],
  taste:     ['taste','food','biology','sweet'],
  allergy:   ['allergy','dander','health','biology'],
  cat:       ['cat','behavior','body','biology'],
  history:   ['history','origin','ancient','breed'],
  group:     ['group','social','name'],
  name:      ['name','record','history','famous'],
};

// Bonus tags by intent — reinforce what TYPE of info we need
const INTENT_BONUS_TAGS = {
  attribute: ['color','size','name','breed','body','appearance','coat'],
  reason:    ['behavior','biology','reason','cause'],
  method:    ['process','speed','body','ability','how'],
  location:  ['habitat','wild','domestic','range'],
  time:      ['age','history','lifespan','ancient'],
  entity:    ['record','famous','name','history'],
  ability:   ['ability','body','biology','behavior'],
  fact:      [],
  statement: [],
};

function getRequiredTags(topics, intent) {
  const tagSet = new Set();
  for (const topic of topics) {
    const tags = TOPIC_TO_TAGS[topic] || [topic];
    tags.forEach(t => tagSet.add(t));
  }
  const bonus = INTENT_BONUS_TAGS[intent] || [];
  bonus.forEach(t => tagSet.add(t));
  return tagSet;
}

/* ══════════════════════════════════════════════════════
   STEP 4 — SCORE & FILTER LOCAL JSON

   KEY LOGIC: Every extracted topic must be satisfied
   by the entry. "color + annoying" requires an entry
   that covers BOTH color tags AND annoying tags.
   An entry about annoying breeds with no color tags
   will lose to one that covers both.
══════════════════════════════════════════════════════ */

// Does this entry's tags cover a given topic at all?
function topicSatisfied(topic, entryTags) {
  const topicTags = TOPIC_TO_TAGS[topic] || [topic];
  return entryTags.some(tag =>
    topicTags.some(tt => tt === tag || tt.includes(tag) || tag.includes(tt))
  );
}

// Base tag overlap score (tiebreaker)
function scoreEntry(entryTags, requiredTags) {
  let score = 0;
  for (const req of requiredTags) {
    for (const tag of entryTags) {
      if (tag === req)                            { score += 2; break; }
      if (tag.includes(req) || req.includes(tag)) { score += 1; break; }
    }
  }
  return score;
}

function searchLocalJSON(userInput) {
  // Extract search words directly from user input (no TOPIC_MAP needed!)
  const userWords = userInput.toLowerCase().split(/\W+/).filter(w => w.length > 2);

  function calcScore(entry) {
    const entryKeywords = (entry.keywords || []).map(k => k.toLowerCase());
    const entryTags = entry.tags || [];

    // Keyword matches = main score
    const keywordMatches = entryKeywords.filter(kw => 
      userWords.some(uw => kw.includes(uw) || uw.includes(kw))
    ).length;

    // Tag matches as tiebreaker
    const tagMatches = entryTags.filter(tag =>
      userWords.some(uw => tag.includes(uw) || uw.includes(tag))
    ).length;

    const finalScore = (keywordMatches * 10) + (tagMatches * 2);

    return {
      finalScore,
      keywordMatches,
      tagMatches
    };
  }

  // Score all knowledge entries
  const kbResults = App.knowledge
    .map(entry => ({ entry, ...calcScore(entry) }))
    .sort((a, b) => b.finalScore - a.finalScore);

  // Score all fact entries
  const factResults = App.facts
    .map(entry => ({ entry, ...calcScore(entry) }))
    .sort((a, b) => b.finalScore - a.finalScore);

  const bestKB   = kbResults[0];
  const bestFact = factResults[0];

  console.log("[Score] KB best:", bestKB?.entry?.id, "score=", bestKB?.finalScore?.toFixed(1),
              "keywords matched=", bestKB?.keywordMatches);

  // KB wins if it has better keyword matches, or same matches but higher tag score
  const kbWins = bestKB && (!bestFact ||
    bestKB.keywordMatches > bestFact.keywordMatches ||
    (bestKB.keywordMatches === bestFact.keywordMatches && bestKB.finalScore >= bestFact.finalScore));

  if (kbWins && bestKB.finalScore > 0) return { text: "🧠 " + bestKB.entry.answer, source: "local-kb" };
  if (bestFact && bestFact.finalScore > 0) return { text: "📖 " + bestFact.entry.text, source: "local-fact" };
  return null;
}

/* ══════════════════════════════════════════════════════
   STEP 5 — WIKIPEDIA API  (free, no key, CORS-safe)
   
   1. Search Wikipedia for best matching page title
   2. Fetch the page summary extract
   3. Pick the sentence most relevant to our query
══════════════════════════════════════════════════════ */
function buildWikiQuery(topics, intent) {
  // Priority topics per intent
  const priority = {
    attribute: ['color','breed','anatomy'],
    reason:    ['behavior','biology'],
    method:    ['speed','anatomy','behavior'],
    location:  ['domestic','history'],
    time:      ['history','lifespan'],
    ability:   ['biology','anatomy'],
    fact:      [],
    statement: [],
  }[intent] || [];

  const sorted = [...topics]
    .filter(t => t !== 'cat')
    .sort((a, b) => {
      const ai = priority.indexOf(a), bi = priority.indexOf(b);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  // e.g. "cat color aggressive" or "domestic cat"
  return sorted.length
    ? `cat ${sorted.slice(0, 2).join(' ')}`
    : 'domestic cat';
}

function pickBestSentence(sentences, queryWords) {
  let best = null, bestScore = 0;
  for (const s of sentences) {
    const lower = s.toLowerCase();
    let score = queryWords.filter(w => lower.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best || sentences[0] || null;
}

async function fetchWikipediaSimple(userInput) {
  try {
    const query = `cat ${userInput}`;
    const queryWords = userInput.toLowerCase().split(/\W+/).filter(w => w.length > 2);

    // Search Wikipedia for best matching page title
    const searchURL = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=3`;
    const searchRes = await fetch(searchURL);
    if (!searchRes.ok) throw new Error('Search failed');
    const searchData = await searchRes.json();

    const results = searchData?.query?.search;
    if (!results?.length) return null;

    // Get summary for top result
    const title = results[0].title;
    const summaryURL = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await fetch(summaryURL);
    if (!summaryRes.ok) throw new Error('Summary failed');
    const summaryData = await summaryRes.json();

    const extract = summaryData?.extract;
    if (!extract) return null;

    // Pick most relevant sentence
    const sentences = extract.match(/[^.!?]+[.!?]+/g) || [];
    const best = pickBestSentence(sentences, queryWords);

    return best
      ? `🌐 ${best.trim()} *(via Wikipedia: ${title})*`
      : null;

  } catch (e) {
    console.warn('Wikipedia failed:', e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   STEP 6 — CATFACT.NINJA  (free, no key)
   Final fallback: random live cat fact
══════════════════════════════════════════════════════ */
async function fetchCatFactNinja() {
  try {
    const res = await fetch('https://catfact.ninja/fact');
    if (!res.ok) throw new Error('catfact.ninja failed');
    const data = await res.json();
    return data?.fact ? `🐾 ${data.fact}` : null;
  } catch (e) {
    console.warn('catfact.ninja failed:', e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   MASTER PIPELINE
   Now simplified: search JSON files directly, then fallback to APIs
══════════════════════════════════════════════════════ */
async function pipeline(userInput) {
  // Search directly in knowledge.json and facts.json using keywords
  const local = searchLocalJSON(userInput);
  if (local) {
    console.log(`[Pipeline] Found match in ${local.source} for: "${userInput}"`);
    return { text: local.text, mood: 'curious', anim: null };
  }

  // Fallback 1 — Wikipedia
  const wiki = await fetchWikipediaSimple(userInput);
  if (wiki) {
    console.log(`[Pipeline] Found answer in Wikipedia for: "${userInput}"`);
    return { text: wiki, mood: 'curious', anim: null };
  }

  // Fallback 2 — catfact.ninja
  const ninja = await fetchCatFactNinja();
  if (ninja) {
    console.log(`[Pipeline] Using random cat fact`);
    return { text: ninja, mood: 'happy', anim: null };
  }

  // Total fallback
  return { text: pick(POOL.no_result), mood: 'happy', anim: null };
}

/* ══════════════════════════════════════════════════════
   SOCIAL ROUTE — fast-path for non-question inputs
══════════════════════════════════════════════════════ */
function socialRoute(lower) {
  if (/\b(hi|hello|hey|meow|howdy|sup|hiya|good morning|good evening)\b/.test(lower))
    return { text: pick(POOL.greeting),   mood: 'happy',   anim: 'wiggle' };
  if (/\b(bye|goodbye|see you|cya|later|goodnight|farewell)\b/.test(lower))
    return { text: pick(POOL.farewell),   mood: 'happy',   anim: null };
  if (/\b(thank|thanks|thank you|ty|thx)\b/.test(lower))
    return { text: pick(POOL.thanks),     mood: 'happy',   anim: 'wiggle' };
  if (/\b(cute|adorable|love you|good cat|best cat|amazing|awesome)\b/.test(lower))
    return { text: pick(POOL.compliment), mood: 'excited', anim: 'bounce' };
  if (/\b(play|game|chase|yarn|laser|pounce|fetch)\b/.test(lower))
    return { text: pick(POOL.play),       mood: 'playful', anim: 'spin'   };
  if (/\b(sad|hurt|lonely|miss|terrible|awful|horrible)\b/.test(lower))
    return { text: pick(POOL.sad),        mood: 'happy',   anim: 'wiggle' };
  return null;
}

/* ══════════════════════════════════════════════════════
   RANDOM MATH PROBLEM GENERATOR
   Generates questions, calculates correct answer, 
   creates similar wrong answers (±2, 3, 4, 6)
══════════════════════════════════════════════════════ */

function generateMathQuestion() {
  const categories = ['arithmetic', 'algebra', 'geometry'];
  const category = pick(categories);
  
  let question, correctAnswer, explanation;
  
  if (category === 'arithmetic') {
    const type = Math.floor(Math.random() * 4);
    
    if (type === 0) { // Addition
      const a = Math.floor(Math.random() * 50) + 10;
      const b = Math.floor(Math.random() * 50) + 10;
      correctAnswer = a + b;
      question = `What is ${a} + ${b}?`;
      explanation = `${a} + ${b} = ${correctAnswer} ✓`;
    } else if (type === 1) { // Subtraction
      const a = Math.floor(Math.random() * 80) + 30;
      const b = Math.floor(Math.random() * a);
      correctAnswer = a - b;
      question = `What is ${a} - ${b}?`;
      explanation = `${a} - ${b} = ${correctAnswer} ✓`;
    } else if (type === 2) { // Multiplication
      const a = Math.floor(Math.random() * 12) + 3;
      const b = Math.floor(Math.random() * 12) + 3;
      correctAnswer = a * b;
      question = `What is ${a} × ${b}?`;
      explanation = `${a} × ${b} = ${correctAnswer} ✓`;
    } else { // Division
      const a = Math.floor(Math.random() * 12) + 3;
      const b = a * (Math.floor(Math.random() * 10) + 2);
      correctAnswer = b / a;
      question = `What is ${b} ÷ ${a}?`;
      explanation = `${b} ÷ ${a} = ${correctAnswer} ✓`;
    }
  } else if (category === 'algebra') {
    const type = Math.floor(Math.random() * 3);
    
    if (type === 0) { // x + a = b
      const a = Math.floor(Math.random() * 20);
      const x = Math.floor(Math.random() * 30);
      const b = x + a;
      correctAnswer = x;
      question = `Solve: x + ${a} = ${b}. What is x?`;
      explanation = `x + ${a} = ${b} → x = ${b} - ${a} = ${correctAnswer} ✓`;
    } else if (type === 1) { // 2x = b
      const x = Math.floor(Math.random() * 25) + 1;
      const b = x * 2;
      correctAnswer = x;
      question = `Solve: 2x = ${b}. What is x?`;
      explanation = `2x = ${b} → x = ${b} ÷ 2 = ${correctAnswer} ✓`;
    } else { // 3x - a = b
      const x = Math.floor(Math.random() * 20) + 1;
      const a = Math.floor(Math.random() * 15);
      const b = 3 * x - a;
      correctAnswer = x;
      question = `Solve: 3x - ${a} = ${b}. What is x?`;
      explanation = `3x - ${a} = ${b} → 3x = ${b + a} → x = ${correctAnswer} ✓`;
    }
  } else { // geometry
    const type = Math.floor(Math.random() * 3);
    
    if (type === 0) { // Rectangle area
      const length = Math.floor(Math.random() * 20) + 5;
      const width = Math.floor(Math.random() * 20) + 5;
      correctAnswer = length * width;
      question = `Area of rectangle: length=${length}, width=${width}. What is the area?`;
      explanation = `Area = length × width = ${length} × ${width} = ${correctAnswer} ✓`;
    } else if (type === 1) { // Square perimeter
      const side = Math.floor(Math.random() * 15) + 3;
      correctAnswer = 4 * side;
      question = `Perimeter of square with side ${side}. What is it?`;
      explanation = `Perimeter = 4 × side = 4 × ${side} = ${correctAnswer} ✓`;
    } else { // Triangle area
      const base = Math.floor(Math.random() * 20) + 5;
      const height = Math.floor(Math.random() * 20) + 5;
      correctAnswer = Math.round((base * height) / 2);
      question = `Area of triangle: base=${base}, height=${height}. What is the area?`;
      explanation = `Area = (base × height) ÷ 2 = (${base} × ${height}) ÷ 2 = ${correctAnswer} ✓`;
    }
  }
  
  return { question, correctAnswer, category, explanation };
}

function generateMultipleChoices(correctAnswer) {
  const offsets = [2, 3, 4, 6];
  const wrongAnswers = new Set();
  
  // Generate 3 wrong answers that are close to correct
  while (wrongAnswers.size < 3) {
    const offset = pick(offsets);
    const direction = Math.random() > 0.5 ? 1 : -1;
    const wrong = correctAnswer + (offset * direction);
    
    if (wrong !== correctAnswer && wrong > 0 && !wrongAnswers.has(wrong)) {
      wrongAnswers.add(wrong);
    }
  }
  
  // Convert to array and mix with correct answer
  const options = [correctAnswer, ...Array.from(wrongAnswers)];
  const shuffled = options.sort(() => Math.random() - 0.5);
  
  return {
    options: shuffled.map(String),
    correct: shuffled.indexOf(correctAnswer)
  };
}

function getMathQuiz() {
  const questions = [];
  for (let i = 0; i < 10; i++) {
    const { question, correctAnswer, category, explanation } = generateMathQuestion();
    const { options, correct } = generateMultipleChoices(correctAnswer);
    
    questions.push({
      id: i + 1,
      category,
      question,
      options,
      correct,
      explanation,
      correctAnswer
    });
  }
  return questions;
}
const QUIZ_COMPLIMENTS = {
  // 0-20%: Needs work
  poor: [
    "Don't give up! Every mistake is a learning opportunity! 💪",
    "You tried your best! Keep practicing and you'll improve! 📚",
    "No worries! Learning is a journey, not a race! 🚀",
  ],
  // 21-50%: Getting there
  fair: [
    "Good effort! You're on the right track! 👍",
    "You've got the basics down! Keep studying! 📖",
    "Nice try! A bit more practice and you'll ace it! 💫",
  ],
  // 51-70%: Pretty good
  good: [
    "Nice work! You're doing better than average! 🌟",
    "Great job! You know your stuff pretty well! 🎯",
    "Impressive! Keep this momentum going! ⚡",
  ],
  // 71-85%: Excellent
  excellent: [
    "Wow! You really know your stuff! 🏆",
    "Outstanding performance! You're a star! ⭐",
    "Fantastic! You crushed that quiz! 🔥",
  ],
  // 86-100%: Perfect/Near Perfect
  perfect: [
    "PERFECT! You're a genius! 👑 *slow blinks approvingly*",
    "FLAWLESS! You absolutely dominated! 🎖️✨",
    "INCREDIBLE! You're a master! 🌟💯 *purrs intensely*",
  ]
};

function getScoreCompliment(percentage) {
  if (percentage === 100) return pick(QUIZ_COMPLIMENTS.perfect);
  if (percentage >= 86)  return pick(QUIZ_COMPLIMENTS.perfect);
  if (percentage >= 71)  return pick(QUIZ_COMPLIMENTS.excellent);
  if (percentage >= 51)  return pick(QUIZ_COMPLIMENTS.good);
  if (percentage >= 21)  return pick(QUIZ_COMPLIMENTS.fair);
  return pick(QUIZ_COMPLIMENTS.poor);
}

/* ══════════════════════════════════════════════════════
   QUIZ LOGIC
══════════════════════════════════════════════════════ */
function startQuiz(quizType) {
  App.quiz.active = true;
  App.quiz.type = quizType;
  App.quiz.answered = [];
  App.quiz.score = 0;
  App.quiz.current = 0;
  
  // Generate questions
  if (quizType === 'math') {
    // Generate random math questions
    App.quiz.questions = getMathQuiz();
  } else {
    // Use static science questions from JSON
    const allQuestions = App.science;
    if (!allQuestions || allQuestions.length === 0) {
      showBubble(`Sorry, the science quiz isn't loaded yet! 😅`);
      return;
    }
    App.quiz.questions = allQuestions.sort(() => Math.random() - 0.5).slice(0, 10);
  }
  
  // Show quiz modal
  showQuizModal();
  loadQuizQuestion();
}

function showQuizModal() {
  const modal = document.getElementById('quizModal');
  modal.classList.remove('hidden');
  
  const title = App.quiz.type === 'math' ? '📐 Math Quiz' : '🧪 Science Quiz';
  document.getElementById('quizTitle').textContent = title;
  
  // Hide results, show question
  document.getElementById('quizContent').classList.remove('hidden');
  document.getElementById('quizResults').classList.add('hidden');
}

function loadQuizQuestion() {
  const q = App.quiz.questions[App.quiz.current];
  if (!q) return;
  
  // Update progress
  document.getElementById('quizProgress').textContent = `${App.quiz.current + 1}/${App.quiz.questions.length}`;
  
  // Show question
  document.getElementById('quizQuestion').textContent = q.question;
  
  // Clear previous explanation
  document.getElementById('quizExplanation').classList.add('hidden');
  document.getElementById('quizExplanation').textContent = '';
  
  // Render options
  const optionsDiv = document.getElementById('quizOptions');
  optionsDiv.innerHTML = '';
  
  q.options.forEach((option, index) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-option';
    btn.textContent = option;
    btn.disabled = false;
    btn.addEventListener('click', () => answerQuestion(index, btn, q));
    optionsDiv.appendChild(btn);
  });
}

function answerQuestion(selectedIndex, buttonEl, question) {
  const isCorrect = selectedIndex === question.correct;
  
  // Mark answer
  App.quiz.answered.push({
    questionId: question.id,
    correct: isCorrect
  });
  
  if (isCorrect) App.quiz.score++;
  
  // Show visual feedback
  const allButtons = document.querySelectorAll('.quiz-option');
  allButtons.forEach(b => b.disabled = true);
  
  buttonEl.classList.add(isCorrect ? 'correct' : 'incorrect');
  
  if (!isCorrect) {
    document.querySelectorAll('.quiz-option')[question.correct].classList.add('correct');
  }
  
  // Show explanation
  const explanationDiv = document.getElementById('quizExplanation');
  explanationDiv.textContent = question.explanation;
  explanationDiv.classList.remove('hidden');
  
  // Next button or end quiz
  setTimeout(() => {
    if (App.quiz.current < App.quiz.questions.length - 1) {
      App.quiz.current++;
      loadQuizQuestion();
    } else {
      endQuiz();
    }
  }, 2000);
}

function endQuiz() {
  const percentage = Math.round((App.quiz.score / App.quiz.questions.length) * 100);
  
  // Hide question content
  document.getElementById('quizContent').classList.add('hidden');
  
  // Show results
  const resultsDiv = document.getElementById('quizResults');
  document.getElementById('resultsScore').textContent = `Score: ${App.quiz.score}/${App.quiz.questions.length}`;
  document.getElementById('resultsMessage').textContent = `${percentage}%`;
  document.getElementById('resultsCompliment').textContent = getScoreCompliment(percentage);
  resultsDiv.classList.remove('hidden');
}

function resetQuiz() {
  App.quiz.active = false;
  App.quiz.type = null;
  App.quiz.questions = [];
  App.quiz.current = 0;
  App.quiz.score = 0;
  App.quiz.answered = [];
  
  const modal = document.getElementById('quizModal');
  modal.classList.add('hidden');
  
  showBubble("Ready for another quiz? Or chat about cats? 😸");
}

/* ══════════════════════════════════════════════════════
   DATA LOADING
══════════════════════════════════════════════════════ */
async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Cannot load ${path}`);
  return r.json();
}

async function loadAll() {
  try {
    [App.facts, App.knowledge, App.math, App.science] = await Promise.all([
      loadJSON('facts.json'),
      loadJSON('knowledge.json'),
      loadJSON('math.json'),
      loadJSON('science.json'),
    ]);
    console.log(`✅ ${App.facts.length} facts, ${App.knowledge.length} knowledge entries, ${App.math.length} math questions, ${App.science.length} science questions loaded`);
  } catch (e) {
    console.warn('⚠️ JSON load failed — live APIs still active.', e);
  }
}

/* ══════════════════════════════════════════════════════
   UI HELPERS
══════════════════════════════════════════════════════ */
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function showBubble(text) {
  const bubble = document.getElementById('speechBubble');
  const bt     = document.getElementById('bubbleText');
  document.getElementById('typingIndicator').classList.add('hidden');
  bt.textContent = '';
  bubble.classList.remove('hidden');
  bubble.style.animation = 'none';
  void bubble.offsetWidth;
  bubble.style.animation = '';
  bt.textContent = text;
}

function showTyping() {
  document.getElementById('speechBubble').classList.remove('hidden');
  document.getElementById('bubbleText').textContent = '';
  document.getElementById('typingIndicator').classList.remove('hidden');
}

function setMood(key) {
  const m = MOODS[key] || MOODS.happy;
  App.mood = key;
  document.getElementById('moodIcon').textContent  = m.emoji;
  document.getElementById('moodLabel').textContent = m.label;
}

function animateCat(type) {
  if (!type) return;
  const cat = document.getElementById('cat');
  cat.classList.remove('bounce','wiggle','spin');
  void cat.offsetWidth;
  cat.classList.add(type);
  setTimeout(() => cat.classList.remove(type), 2000);
}

function showDebugBadge(topics, intent, source) {
  const badge = document.getElementById('nlpBadge');
  badge.textContent = `${intent} · [${topics.slice(0,3).join(', ')}] · ${source}`;
  badge.classList.add('show');
  setTimeout(() => badge.classList.remove('show'), 3000);
}

/* ══════════════════════════════════════════════════════
   SEND HANDLER
══════════════════════════════════════════════════════ */
async function handleSend() {
  if (App.busy) return;
  const input   = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const text    = input.value.trim();
  if (!text) return;

  App.busy = input.disabled = sendBtn.disabled = true;
  input.value = '';
  showTyping();

  const social = socialRoute(text.toLowerCase());
  if (social) {
    await new Promise(r => setTimeout(r, 350));
    showBubble(social.text);
    setMood(social.mood);
    animateCat(social.anim);
  } else {
    const { text: answer, mood, anim } = await pipeline(text);
    showBubble(answer);
    setMood(mood);
    animateCat(anim);
  }

  App.busy = false;
  input.disabled = sendBtn.disabled = false;
  if (window.innerWidth >= 600) input.focus();
}

/* ══════════════════════════════════════════════════════
   EVENT LISTENERS + INIT
══════════════════════════════════════════════════════ */
function bindEvents() {
  document.getElementById('sendBtn').addEventListener('click', handleSend);
  document.getElementById('userInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  document.getElementById('chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    
    // Handle quiz chips
    if (chip.dataset.quiz) {
      startQuiz(chip.dataset.quiz);
      return;
    }
    
    // Handle regular chat chips
    document.getElementById('userInput').value = chip.dataset.q;
    handleSend();
  });
  document.getElementById('cat').addEventListener('click', () => {
    showBubble(pick(POOL.cat_click));
    animateCat('wiggle');
  });
  
  // Quiz modal event listeners
  document.getElementById('quizExitBtn').addEventListener('click', resetQuiz);
  document.getElementById('quizRetryBtn').addEventListener('click', () => {
    startQuiz(App.quiz.type);
  });
  document.getElementById('quizBackBtn').addEventListener('click', resetQuiz);
}

async function init() {
  await loadAll();
  bindEvents();
  setMood('happy');
  console.log('🐱 CatGPT ready');
}

document.addEventListener('DOMContentLoaded', init);
