// Selma — a slow book journal.
// A shelf of the books you've read. Pull one down to see, or add, what you want to remember from it.
// Everything is stored in this browser (localStorage); there is no server.

const STORE_KEY = 'selma-read.v1';
const BACKUP_KEY = 'selma-read.backup'; // the day the last backup was saved

// Spine colors, drawn from the other Selma journals. Repeats are fine; neighbors differ.
// Each pairs a cloth with a title color that reads at 4.5:1 or better.
const CLOTHS = [
  { bg: '#8FA596', fg: '#1F2A2E' }, // sage
  { bg: '#C98B6B', fg: '#1F2A2E' }, // clay
  { bg: '#A9BDCA', fg: '#1F2A2E' }, // pale blue
  { bg: '#5F7A6B', fg: '#FFFFFF' }, // deep sage
  { bg: '#D9BC6A', fg: '#1F2A2E' }, // honey
  { bg: '#A892B0', fg: '#1F2A2E' }, // lavender
  { bg: '#B9CBBE', fg: '#1F2A2E' }, // light sage
  { bg: '#DDA0A0', fg: '#1F2A2E' }, // rose
  { bg: '#55707F', fg: '#FFFFFF' }, // slate
  { bg: '#7FAFA8', fg: '#1F2A2E' }, // teal
  { bg: '#E3B7A0', fg: '#1F2A2E' }, // blush
];

// The first question every book is asked.
const REMEMBER = 'What do you want to remember from this book?';
// Other questions, offered one at a time.
const PROMPTS = [
  'Where were you in life when you read it?',
  'What did it change, or confirm, in how you see things?',
  'What does it have to say to your work, even if it wasn’t for work?',
  'A line, a scene or an idea you keep coming back to',
  'Who would you hand this book to, and why?',
  'What would you ask the author over coffee?',
  'What did it leave unanswered?',
  'What did it remind you of: another book, a place, a person?',
  'What was it like to be inside this book?',
  'Will you do anything differently because of it?',
];
const NOTE_ONLY = 'Just a note, no question';

// A heart drawn in line, so it looks the same on every device; filled for a favorite.
const HEART = '<svg class="heart-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>';

const state = loadState();
const shelfFilter = { tag: '', q: '', arrange: 'year' };
let view = 'shelf';
let openId = null;     // the book pulled from the shelf
let jotting = null;    // { id } of the note being edited, or {} for a new one
let importItems = [];

const $ = (sel) => document.querySelector(sel);
const bookDialog = $('#book-dialog');
const editDialog = $('#edit-dialog');
const editForm = $('#edit-form');
const importDialog = $('#import-dialog');

function blankState() {
  return { books: [], tags: ['work', 'pleasure'] };
}

function loadState() {
  try {
    return { ...blankState(), ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return blankState();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    toast('This browser would not save that.');
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function keyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const longDate = (key) => keyDate(key).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
const daysBetween = (a, b) => Math.round((keyDate(b) - keyDate(a)) / 864e5);

const bookById = (id) => state.books.find((b) => b.id === id);
const cloth = (book) => CLOTHS[book.cloth % CLOTHS.length];

// A small, steady number from a book's id, so its height and width never change.
function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// A cloth that differs from the book shelved just before.
function nextCloth() {
  const last = state.books[state.books.length - 1];
  const options = CLOTHS.map((_, i) => i).filter((i) => i !== last?.cloth);
  return options[Math.floor(Math.random() * options.length)];
}

// For finding duplicates: lower case, no punctuation, no subtitle.
const plain = (s) => String(s || '').toLowerCase().split(/[:(]/)[0].replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const sameBook = (a, b) => plain(a.title) === plain(b.title) && (!a.author || !b.author || plain(a.author) === plain(b.author));

// The surname a library would shelve by: the last word of the first author.
function surname(author) {
  const first = String(author || '').split(/,| and | & /)[0].trim();
  const words = first.split(/\s+/).filter((w) => !/^(jr\.?|sr\.?|ii|iii|phd)$/i.test(w));
  return words[words.length - 1] || '';
}

/* ---------- Shelf ---------- */

function matches(book) {
  if (shelfFilter.tag === '♥' && !book.fav) return false;
  if (shelfFilter.tag && shelfFilter.tag !== '♥' && !book.tags.includes(shelfFilter.tag)) return false;
  const q = shelfFilter.q.trim().toLowerCase();
  if (!q) return true;
  const text = [book.title, book.author, book.elsewhere, ...book.tags, ...book.notes.flatMap((n) => [n.q, n.text])].join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => text.includes(word));
}

// The title as a spine would show it: before any subtitle or series.
const shortTitle = (title) => title.split(/:|\s\(/)[0].trim() || title;

// Measures a title in the spine's own type, so each book is just tall enough for it.
const ruler = Object.assign(document.createElement('span'), { className: 'ruler' });
document.body.append(ruler);
function titleLength(text) {
  ruler.textContent = text;
  return ruler.getBoundingClientRect().width;
}

function spineSize(book) {
  const h = hash(book.id);
  const room = 34 + (book.fav ? 14 : 0); // the bands at top and bottom, and the heart
  const height = Math.min(262, Math.max(112, Math.ceil(titleLength(shortTitle(book.title))) + room + (h % 10)));
  const width = 32 + ((h >> 6) % 11);
  return { height, width };
}

function spineHTML(book) {
  const { height, width } = spineSize(book);
  const c = cloth(book);
  const label = `${book.title}${book.author ? `, ${book.author}` : ''}${book.fav ? ' (a favorite)' : ''}`;
  return `<div class="slot"><button class="spine${book.fav ? ' has-fav' : ''}" data-action="pull" data-id="${book.id}"
      style="--bg:${c.bg};--fg:${c.fg};--h:${height}px;--w:${width}px" aria-label="${esc(label)}" title="${esc(label)}">
    ${book.notes.length ? '<i class="ribbon" aria-hidden="true"></i>' : ''}
    <span class="t" aria-hidden="true">${esc(shortTitle(book.title))}</span>
    ${book.fav ? `<span class="fav">${HEART}</span>` : ''}
  </button></div>`;
}

const byRead = (a, b) => (a.read || '').localeCompare(b.read || '') || a.added - b.added;

// Shelves by year: the newest year on top; within a year, books stand in the order they were finished,
// so a newly finished book goes on the right-hand end of the top shelf.
function groups(books) {
  if (shelfFilter.arrange === 'author') {
    const sorted = [...books].sort((a, b) =>
      (surname(a.author) || a.title).localeCompare(surname(b.author) || b.title, 'en', { sensitivity: 'base' })
      || a.title.localeCompare(b.title));
    const out = new Map();
    for (const book of sorted) {
      const letter = (surname(book.author) || '').charAt(0).toUpperCase();
      const name = /\p{L}/u.test(letter) ? letter : 'No author';
      if (!out.has(name)) out.set(name, []);
      out.get(name).push(book);
    }
    return [...out].map(([name, list]) => ({ name, list }));
  }
  const out = new Map();
  for (const book of [...books].sort(byRead)) {
    const year = book.read ? book.read.slice(0, 4) : '';
    if (!out.has(year)) out.set(year, []);
    out.get(year).push(book);
  }
  return [...out]
    .sort(([a], [b]) => (b || '0').localeCompare(a || '0'))
    .map(([year, list]) => ({ name: year || 'Some time ago', list }));
}

function renderFilter() {
  const used = state.tags.filter((t) => state.books.some((b) => b.tags.includes(t)));
  const options = [['', 'All books'], ...(state.books.some((b) => b.fav) ? [['♥', 'Favorites']] : []), ...used.map((t) => [t, t])];
  if (!options.some(([v]) => v === shelfFilter.tag)) shelfFilter.tag = '';
  $('#filter').innerHTML = state.books.length ? `
    <div class="segmented" role="radiogroup" aria-label="Show">
      ${options.map(([value, name]) => `<label><input type="radio" name="tag" value="${esc(value)}" ${value === shelfFilter.tag ? 'checked' : ''}><span>${value === '♥' ? HEART + ' ' : ''}${esc(name)}</span></label>`).join('')}
    </div>
    <div class="arrange">Arrange by
      <button data-action="arrange" data-by="year" aria-pressed="${shelfFilter.arrange === 'year'}">year</button>
      <button data-action="arrange" data-by="author" aria-pressed="${shelfFilter.arrange === 'author'}">author</button>
    </div>` : '';
}

function renderShelf() {
  renderFilter();
  $('#nudges').innerHTML = backupDue()
    ? `<p class="nudge">${localStorage.getItem(BACKUP_KEY) ? 'It has been a while since the last backup.' : 'This shelf has not been backed up yet.'}
        <button class="link" data-action="export">Save a backup</button><button class="link" data-action="backup-later">Later</button></p>`
    : '';
  const el = $('#shelves');
  if (!state.books.length) {
    el.innerHTML = `<div class="empty">
      <img src="selma-read.svg" width="96" height="96" alt="">
      <h2>An empty shelf, for now</h2>
      <p>Shelve the book you finished most recently, or bring in the books you've read from Libby or Goodreads.</p>
      <button class="btn primary" data-action="add-book">Shelve a book</button>
      <button class="btn quiet" data-action="import-list">Bring in books</button>
    </div>`;
    return;
  }
  const books = state.books.filter(matches);
  if (!books.length) {
    el.innerHTML = `<p class="empty">Nothing on the shelf matches that.</p>`;
    return;
  }
  el.innerHTML = groups(books).map(({ name, list }) => `
    <section class="shelf-group">
      <h2>${esc(name)}</h2>
      <div class="shelf" style="--slot:${Math.max(...list.map((b) => spineSize(b).height)) + 30}px">${list.map(spineHTML).join('')}</div>
    </section>`).join('');
}

/* ---------- A book pulled from the shelf ---------- */

function noteHTML(note, { tools = true } = {}) {
  return `<li class="note">
    <p class="q">${esc(note.q || 'A note')}</p>
    <p class="a">${esc(note.text)}</p>
    <div class="meta">
      <span>${note.at ? `Jotted ${longDate(dayKey(new Date(note.at)))}` : ''}</span>
      ${tools ? `<button class="btn danger" data-action="edit-note" data-id="${note.id}">Edit</button>
      <button class="btn danger" data-action="remove-note" data-id="${note.id}">Remove</button>` : ''}
    </div>
  </li>`;
}

// A list of questions, each with a box for an answer that opens when the question is checked.
function questionsHTML(list, checked = []) {
  return list.map((q, i) => `<div class="question">
    <label class="q-check"><input type="checkbox" name="ask" value="${i}" ${checked.includes(q) ? 'checked' : ''}><span>${esc(q)}</span></label>
    <textarea name="answer-${i}" rows="3" aria-label="${esc(q)}" ${checked.includes(q) ? '' : 'hidden'}></textarea>
  </div>`).join('');
}

// The answers written under checked questions. "Just a note" is kept with no question.
function answers(form, list) {
  return [...form.querySelectorAll('[name="ask"]:checked')]
    .map((box) => ({ q: list[box.value] === NOTE_ONLY ? '' : list[box.value], text: form.querySelector(`[name="answer-${box.value}"]`).value.trim() }))
    .filter((a) => a.text);
}

const jotList = () => [REMEMBER, ...PROMPTS, NOTE_ONLY];

function jotHTML(book) {
  const editing = jotting.id ? book.notes.find((n) => n.id === jotting.id) : null;
  // A book's first note answers the main question, so it starts out checked.
  const fields = editing
    ? `<label class="q-edit">${esc(editing.q || 'A note')}<textarea name="text" rows="5">${esc(editing.text)}</textarea></label>`
    : `<fieldset class="questions"><legend>Do any of these questions resonate? <span class="optional">check as many as you like</span></legend>
        ${questionsHTML(jotList(), book.notes.some((n) => n.q === REMEMBER) ? [] : [REMEMBER])}</fieldset>`;
  return `<form class="jot" id="jot-form">
    ${fields}
    <div class="actions">
      <button type="button" class="btn quiet" data-action="jot-cancel">Cancel</button>
      <button type="submit" class="btn primary">Keep it</button>
    </div>
  </form>`;
}

function renderBook() {
  const book = bookById(openId);
  if (!book) return bookDialog.close();
  const notes = [...book.notes].sort((a, b) => a.at - b.at);
  $('#book-card').innerHTML = `<article class="book" style="--book:${cloth(book).bg}">
    <div class="band"></div>
    <div class="inner">
      <div class="head">
        <div>
          <h2>${esc(book.title)}</h2>
          ${book.author ? `<p class="by">${esc(book.author)}</p>` : ''}
          <p class="when">${book.read ? `Finished ${longDate(book.read)}` : 'Finished some time ago'}</p>
        </div>
        <button class="heart" data-action="fav" aria-pressed="${!!book.fav}" aria-label="A favorite" title="${book.fav ? 'A favorite' : 'Mark as a favorite'}">${HEART}</button>
      </div>
      ${book.tags.length ? `<ul class="tags">${book.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${notes.length ? `<ul class="notes">${notes.map((n) => noteHTML(n)).join('')}</ul>`
        : jotting ? '' : '<p class="no-notes">No notes yet. Is there anything you remember?</p>'}
      ${jotting ? jotHTML(book) : ''}
      ${book.elsewhere ? `<p class="elsewhere"><b>Notes elsewhere:</b> ${esc(book.elsewhere)}</p>` : ''}
      <div class="foot">
        ${jotting ? '' : '<button class="btn primary" data-action="jot">Jot something down</button>'}
        <button class="btn quiet" data-action="edit-book">Edit details</button>
        <span class="spacer"></span>
        <button class="btn quiet" data-action="close-dialog">Back on the shelf</button>
      </div>
    </div>
  </article>`;
  if (jotting) $('#jot-form textarea:not([hidden])')?.focus();
}

function pull(id) {
  openId = id;
  jotting = null;
  document.querySelector(`.spine[data-id="${id}"]`)?.classList.add('pulled');
  renderBook();
  if (!bookDialog.open) bookDialog.showModal();
  bookDialog.scrollTop = 0;
}

bookDialog.addEventListener('close', () => {
  document.querySelectorAll('.spine.pulled').forEach((s) => s.classList.remove('pulled'));
  openId = null;
  jotting = null;
});

// A click on the dim backdrop puts the book back, unless a note is half written.
bookDialog.addEventListener('click', (event) => {
  if (event.target === bookDialog && ![...document.querySelectorAll('#jot-form textarea')].some((t) => t.value.trim())) bookDialog.close();
});

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'jot-form') return;
  event.preventDefault();
  const book = bookById(openId);
  if (jotting.id) {
    const text = event.target.text.value.trim();
    if (!text) return toast('Write something first, or remove the note.');
    book.notes.find((n) => n.id === jotting.id).text = text;
  } else {
    const written = answers(event.target, jotList());
    if (!written.length) return toast('Check a question and write something first.');
    const now = Date.now();
    written.forEach((a, i) => book.notes.push({ id: newId(), ...a, at: now + i }));
  }
  jotting = null;
  save();
  renderBook();
  RENDER[view]();
  toast('Kept.');
});

/* ---------- Shelving and editing ---------- */

function tagChips(selected) {
  return state.tags.map((t) => `<label><input type="checkbox" name="tags" value="${esc(t)}" ${selected.includes(t) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('');
}

function openEdit(book) {
  editForm.reset();
  const isNew = !book;
  $('#edit-heading').textContent = isNew ? 'Shelve a book' : 'Edit details';
  $('#edit-submit').textContent = isNew ? 'Shelve it' : 'Save';
  $('#remove-book').hidden = isNew;
  $('#first-notes').hidden = !isNew;
  $('#edit-tags').innerHTML = `<legend>Tags <span class="optional">as many as apply</span></legend>${tagChips(book?.tags || [])}`;
  $('#authors').innerHTML = [...new Set(state.books.map((b) => b.author).filter(Boolean))].sort()
    .map((a) => `<option value="${esc(a)}">`).join('');
  editForm.id.value = book?.id || '';
  editForm.title.value = book?.title || '';
  editForm.author.value = book?.author || '';
  editForm.read.value = isNew ? dayKey() : book.read || '';
  editForm.fav.checked = !!book?.fav;
  editForm.elsewhere.value = book?.elsewhere || '';
  $('#edit-questions').innerHTML = `<legend>Do any of these questions resonate? <span class="optional">check as many as you like</span></legend>${questionsHTML(PROMPTS)}`;
  editDialog.showModal();
}

editForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(editForm);
  const title = form.get('title').trim();
  if (!title) return;
  const newTags = form.get('newTag').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  for (const t of newTags) if (!state.tags.includes(t)) state.tags.push(t);
  const details = {
    title,
    author: form.get('author').trim(),
    read: form.get('read') || '',
    tags: [...new Set([...form.getAll('tags'), ...newTags])],
    fav: form.get('fav') === 'on',
    elsewhere: form.get('elsewhere').trim(),
  };
  const id = form.get('id');
  if (id) {
    Object.assign(bookById(id), details);
    toast('Saved.');
  } else {
    const twin = state.books.find((b) => sameBook(b, details));
    if (twin && !confirm(`“${twin.title}” is already on the shelf. Shelve it again as a second reading?`)) return;
    const now = Date.now();
    const notes = [];
    if (form.get('remember').trim()) notes.push({ id: newId(), q: REMEMBER, text: form.get('remember').trim(), at: now });
    answers(editForm, PROMPTS).forEach((a, i) => notes.push({ id: newId(), ...a, at: now + 1 + i }));
    state.books.push({ id: newId(), ...details, notes, added: now, cloth: nextCloth() });
    toast('On the shelf.');
  }
  save();
  editDialog.close();
  RENDER[view]();
  if (id && bookDialog.open) renderBook();
});

/* ---------- Commonplace book ---------- */

function renderCommonplace() {
  const latest = (b) => Math.max(...b.notes.map((n) => n.at || 0));
  const books = state.books.filter((b) => b.notes.length).sort((a, b) => latest(b) - latest(a));
  $('#commonplace').innerHTML = books.length ? books.map((book) => `
    <article class="cp-book" style="--book:${cloth(book).bg}">
      <h3><button data-action="pull" data-id="${book.id}"><span class="swatch" aria-hidden="true"></span>${esc(book.title)}</button>${book.fav ? ` <span class="cp-fav" title="A favorite">${HEART}</span>` : ''}</h3>
      <p class="by">${esc([book.author, book.read ? book.read.slice(0, 4) : ''].filter(Boolean).join(' · '))}</p>
      <ul class="notes">${[...book.notes].sort((a, b) => a.at - b.at).map((n) => noteHTML(n, { tools: false })).join('')}</ul>
    </article>`).join('')
    : `<p class="empty">Nothing here yet. Pull a book from the shelf and jot down something you remember.</p>`;
}

/* ---------- Views ---------- */

const RENDER = { shelf: renderShelf, commonplace: renderCommonplace };

function show(next) {
  view = next;
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === next) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  for (const name of Object.keys(RENDER)) $(`#view-${name}`).hidden = name !== next;
  RENDER[next]();
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Clicks ---------- */

document.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) return show(tab.dataset.view);
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const book = bookById(openId);

  if (action === 'add-book') openEdit();
  else if (action === 'pull') pull(el.dataset.id);
  else if (action === 'close-dialog') el.closest('dialog').close();
  else if (action === 'arrange') { shelfFilter.arrange = el.dataset.by; renderShelf(); }
  else if (action === 'fav') {
    book.fav = !book.fav;
    save();
    renderBook();
    RENDER[view]();
    document.querySelector(`.spine[data-id="${book.id}"]`)?.classList.add('pulled');
  }
  else if (action === 'jot') { jotting = {}; renderBook(); }
  else if (action === 'jot-cancel') { jotting = null; renderBook(); }
  else if (action === 'edit-note') { jotting = { id: el.dataset.id }; renderBook(); }
  else if (action === 'remove-note') {
    if (!confirm('Remove this note?')) return;
    book.notes = book.notes.filter((n) => n.id !== el.dataset.id);
    save();
    renderBook();
    RENDER[view]();
  }
  else if (action === 'edit-book') openEdit(book);
  else if (action === 'remove-book') {
    const target = bookById(editForm.id.value);
    if (!confirm(`Take “${target.title}” off the shelf? Its notes go with it.`)) return;
    state.books = state.books.filter((b) => b.id !== target.id);
    save();
    editDialog.close();
    bookDialog.close();
    RENDER[view]();
    toast('Taken off the shelf.');
  }
  else if (action === 'export') exportBackup();
  else if (action === 'import') $('#import-file').click();
  else if (action === 'import-list') $('#list-file').click();
  else if (action === 'import-all' || action === 'import-none') {
    for (const box of document.querySelectorAll('#import-list input:not(:disabled)')) box.checked = action === 'import-all';
    countImport();
  }
  else if (action === 'backup-later') {
    const later = new Date();
    later.setDate(later.getDate() + 3);
    localStorage.setItem(BACKUP_KEY + '-later', dayKey(later));
    renderShelf();
  }
});

document.addEventListener('change', (event) => {
  if (event.target.name === 'tag' && event.target.closest('#filter')) {
    shelfFilter.tag = event.target.value;
    renderShelf();
  }
  if (event.target.closest('#import-list')) countImport();
  // Checking a question opens a box under it for the answer.
  if (event.target.name === 'ask') {
    const area = event.target.closest('.question').querySelector('textarea');
    area.hidden = !event.target.checked;
    if (event.target.checked) area.focus();
  }
});

$('#search').addEventListener('input', (event) => {
  shelfFilter.q = event.target.value;
  renderShelf();
});

/* ---------- Bringing in books from Libby or Goodreads ---------- */

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.some((x) => x.trim()));
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()])));
}

// A value from a record, whatever the column is called and whether it is text or { text }.
function field(record, ...names) {
  for (const name of names) {
    const key = Object.keys(record).find((k) => k.toLowerCase() === name);
    const value = key === undefined ? undefined : record[key];
    if (value && typeof value === 'object') return String(value.text ?? value.name ?? '');
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function toDay(value) {
  if (!value) return '';
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(value)) {
    const [y, m, d] = value.split(/[/-]/).map(Number);
    return dayKey(new Date(y, m - 1, d));
  }
  const date = new Date(/^\d+$/.test(value) ? Number(value) : value);
  return isNaN(date) ? '' : dayKey(date);
}

// Goodreads: every book on the "read" shelf, with the date read when Goodreads has one.
function fromGoodreads(records) {
  return records
    .filter((r) => field(r, 'exclusive shelf') === 'read')
    .map((r) => ({ title: field(r, 'title'), author: field(r, 'author'), read: toDay(field(r, 'date read')), tags: [] }));
}

// Libby's timeline lists borrows, returns and holds. Each title becomes one book, dated by its
// last return (or, failing that, its last borrow). Holds that were never borrowed are left out.
function fromLibby(records) {
  const titles = new Map();
  for (const r of records) {
    const title = field(r, 'title');
    if (!title) continue;
    const author = field(r, 'author', 'creator');
    const activity = field(r, 'activity').toLowerCase();
    const day = toDay(field(r, 'timestamp', 'date'));
    const key = plain(title) + '|' + plain(author);
    const t = titles.get(key) || { title, author, returned: '', borrowed: '', audio: false };
    if (activity.includes('return') && day > t.returned) t.returned = day;
    if (activity.includes('borrow') && day > t.borrowed) t.borrowed = day;
    if (/audiobook/i.test(JSON.stringify(r))) t.audio = true;
    titles.set(key, t);
  }
  return [...titles.values()]
    .filter((t) => t.returned || t.borrowed)
    .map((t) => ({ title: t.title, author: t.author, read: t.returned || t.borrowed, tags: t.audio ? ['audiobook'] : [] }));
}

$('#list-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  let records, from;
  try {
    const text = (await file.text()).replace(/^﻿/, '');
    if (/^\s*[[{]/.test(text)) {
      const json = JSON.parse(text);
      records = Array.isArray(json) ? json : json.timeline || json.books || [];
    } else records = parseCSV(text);
  } catch {
    return toast('That file could not be read.');
  }
  let found;
  if (records.some((r) => field(r, 'exclusive shelf'))) { found = fromGoodreads(records); from = 'Goodreads'; }
  else if (records.some((r) => field(r, 'activity'))) { found = fromLibby(records); from = 'Libby'; }
  else {
    found = records.map((r) => ({ title: field(r, 'title'), author: field(r, 'author'), read: toDay(field(r, 'date read', 'date', 'finished')), tags: [] }));
    from = 'your list';
  }
  found = found.filter((b) => b.title);
  // Leave out repeats within the file, and mark the ones already on the shelf.
  importItems = [];
  for (const b of found.sort((a, b) => (b.read || '').localeCompare(a.read || ''))) {
    if (importItems.some((x) => sameBook(x, b))) continue;
    importItems.push({ ...b, have: state.books.some((x) => sameBook(x, b)) });
  }
  if (!importItems.length) return toast('No books found in that file.');
  $('#import-from').textContent = `From ${from}${from === 'Libby' ? ', dated by when each was returned' : ''}.`;
  $('#import-list').innerHTML = importItems.map((b, i) => `<li class="${b.have ? 'have' : ''}"><label>
    <input type="checkbox" value="${i}" ${b.have ? 'disabled' : 'checked'}>
    <span class="it"><b>${esc(b.title)}</b>${b.author ? ` <span>${esc(b.author)}</span>` : ''}${b.have ? ' <span>· already on the shelf</span>' : ''}</span>
    <span class="d">${b.read ? esc(keyDate(b.read).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })) : ''}</span>
  </label></li>`).join('');
  countImport();
  importDialog.showModal();
});

function countImport() {
  const n = document.querySelectorAll('#import-list input:checked').length;
  $('#import-submit').textContent = n === 1 ? 'Shelve 1 book' : `Shelve ${n} books`;
  $('#import-submit').disabled = !n;
}

$('#import-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const chosen = [...document.querySelectorAll('#import-list input:checked')].map((box) => importItems[box.value]);
  const now = Date.now();
  // Oldest first, so the shelf's order of shelving matches the order of reading.
  chosen.reverse().forEach((b, i) => {
    for (const t of b.tags) if (!state.tags.includes(t)) state.tags.push(t);
    state.books.push({ id: newId(), title: b.title, author: b.author, read: b.read, tags: b.tags, fav: false, elsewhere: '', notes: [], added: now + i, cloth: nextCloth() });
  });
  save();
  importDialog.close();
  show('shelf');
  toast(chosen.length === 1 ? 'One book shelved.' : `${chosen.length} books shelved.`);
});

/* ---------- Backup ---------- */

function renderBackup() {
  const last = localStorage.getItem(BACKUP_KEY);
  $('#backup-status').textContent = last ? `Last backup saved ${longDate(last)}.` : 'No backup saved yet.';
}

function exportBackup() {
  const file = new Blob([JSON.stringify({ app: 'selma-read', version: 1, data: state }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = `selma-read-backup-${dayKey()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  localStorage.setItem(BACKUP_KEY, dayKey());
  renderBackup();
  RENDER[view]();
}

// A gentle reminder on the shelf: a week after the first book if there has never been a backup,
// or two weeks after the last one. "Later" puts it off for three days.
function backupDue() {
  if (!state.books.length) return false;
  const later = localStorage.getItem(BACKUP_KEY + '-later');
  if (later && later > dayKey()) return false;
  const last = localStorage.getItem(BACKUP_KEY);
  const first = dayKey(new Date(Math.min(...state.books.map((b) => b.added))));
  return last ? daysBetween(last, dayKey()) >= 14 : daysBetween(first, dayKey()) >= 7;
}

// Restoring replaces everything on this device with what the backup holds.
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  let data;
  try {
    const parsed = JSON.parse(await file.text());
    data = parsed.app === 'selma-read' ? parsed.data : parsed;
    if (!Array.isArray(data.books)) throw new Error();
  } catch {
    return toast('That file is not a Selma book journal backup.');
  }
  if (!confirm(`Replace everything on this device with this backup? It holds ${data.books.length} books. What is here now will be gone.`)) return;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, blankState(), data);
  save();
  show(view);
  toast('Restored.');
});

renderBackup();
show('shelf');
// Spines are measured in the shelf's typeface, so measure again once it has loaded.
document.fonts?.ready.then(() => RENDER[view]());

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
